# Research & Design Decisions

---
**Purpose**: Capture discovery findings and rationale that inform the technical design.
---

## Summary
- **Feature**: `slack-hr-bot`
- **Discovery Scope**: New Feature (greenfield)
- **Key Findings**:
  1. GAS doPost() cannot access HTTP request headers — Slack HMAC signature verification is impossible natively; must use verification token (deprecated) or accept the security trade-off
  2. GAS is synchronous — deferred response pattern requires doing all work THEN returning, posting to response_url via UrlFetchApp BEFORE the ContentService return
  3. Google Sheets handles 20K rows x 20 cols in 2-8 seconds with batch getValues() — sufficient for 15-employee scale

## Research Log

### GAS Web App Request Handling
- **Context**: Need to verify Slack requests and handle 3-second timeout
- **Sources**: Google Apps Script docs, Slack API docs
- **Findings**:
  - `doPost(e)` receives `e.postData.contents` (raw body) and `e.parameter` (parsed params)
  - **HTTP request headers are NOT accessible** in GAS web apps — no `X-Slack-Signature`, no `X-Slack-Request-Timestamp`
  - `ContentService.createTextOutput()` always returns HTTP 200; cannot set custom status codes
  - Max execution time: 6 minutes per invocation
  - Daily URL fetch quota: 20K calls (consumer) / 100K (Workspace)
  - Simultaneous executions: 30 max
  - Total trigger runtime: 90 min/day (consumer) / 6 hr/day (Workspace)
- **Implications**:
  - Signature verification must fall back to Slack's verification token (sent in payload) or be skipped
  - Deferred response: do work → POST to response_url → return ack (GAS is sync, no true async)
  - Actually, GAS executes top-to-bottom: we POST to response_url mid-execution, then return the initial ack. The ack is what Slack sees as the HTTP response.

### Slack Deferred Response in GAS (Critical Pattern)
- **Context**: Slack requires HTTP 200 within 3 seconds; GAS has no async
- **Sources**: Slack API docs, community GAS+Slack implementations
- **Findings**:
  - In GAS doPost(), the function runs to completion, THEN the return value is sent as HTTP response
  - The correct pattern for GAS:
    1. Parse payload, do all sheet reads/writes/calculations
    2. POST the real response to `response_url` via `UrlFetchApp.fetch()`
    3. Return a minimal ack via `ContentService.createTextOutput()` (this goes back to Slack as HTTP 200)
  - If total processing < 3 seconds, Slack gets the ack in time
  - If processing > 3 seconds, Slack shows "operation_timeout" but the response_url POST still delivers the real response (within 30-minute window)
  - For most commands with 15 employees, batch reads take 2-8 seconds — some commands may exceed 3 seconds on cold starts
- **Implications**: Design all handlers to: process → POST to response_url → return ack. Cold start mitigation: keep-alive pings or accept occasional timeout messages.

### Slack Interactive Messages & Modals
- **Context**: Need buttons for flag resolution, leave approval; modals for onboard/edit/report
- **Sources**: Slack API docs
- **Findings**:
  - Interactive payloads arrive as `application/x-www-form-urlencoded` with a `payload` JSON parameter
  - `trigger_id` for modals expires in **3 seconds** and is **single-use**
  - Must call `views.open` immediately upon receiving interaction — cannot defer
  - Block Kit limits: 50 blocks/message, 100 blocks/modal, 25 elements/actions block
  - response_url supports max 5 responses within 30 minutes
- **Implications**: Modal commands (`/onboard`, `/edit-employee`, `/report`) must call views.open synchronously before doing any sheet work. Use `trigger_id` immediately.

### Google Sheets Performance at Scale
- **Context**: 13-tab database, ~25K rows/year for 15 employees
- **Sources**: GAS best practices, benchmarks
- **Findings**:
  - Single getValues() for 20K rows x 20 cols: 2-8 seconds
  - Individual getValue() in loop: 80%+ slower than batch
  - CacheService: 100KB per value, 6-hour TTL — good for Policies/Positions (rarely change)
  - Sheets API (advanced service) faster than SpreadsheetApp for reads
  - 10M cells max per spreadsheet; 13 tabs well within limit
  - LockService: tryLock(10000) preferred over waitLock to avoid blocking
  - **Must call SpreadsheetApp.flush() before releasing lock**
- **Implications**: Cache config tables (Policies, Positions, Employees). Read Events/DailyReports in batch. Lock only for writes.

### Slack Verification Token vs HMAC Signature
- **Context**: Req 1 requires request authentication
- **Sources**: Slack API security docs
- **Findings**:
  - HMAC-SHA256 verification requires HTTP headers → impossible in GAS
  - Verification token (deprecated since 2019) is still sent in payloads
  - Token is a static string per app — weaker than HMAC but better than nothing
  - Alternative: Cloudflare Worker proxy that verifies signature and forwards to GAS
- **Implications**: Use verification token for MVP. Document the security limitation. Consider proxy for production hardening.

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Monolithic GAS | Single script project, all code in one deployment | Simple deployment, no infrastructure, free | No horizontal scaling, 6-min timeout, 30 concurrent | Best fit for 15-employee scale |
| GAS + Cloudflare Proxy | CF Worker verifies Slack signatures, forwards to GAS | Proper security, header access | Added complexity, CF free tier limits | Consider for production hardening |
| GAS + Advanced Sheets API | Use Sheets API (advanced service) for reads, SpreadsheetApp for writes | Faster reads | Mixed APIs add complexity | Worth it if cold-start reads are slow |

## Design Decisions

### Decision: Monolithic GAS Architecture
- **Context**: Need to choose deployment model for a free-stack HR bot
- **Alternatives**: (1) Monolithic GAS (2) GAS + CF proxy (3) GAS + external DB
- **Selected**: Monolithic GAS — single Apps Script Web App handles everything
- **Rationale**: Zero cost, sufficient for 15 employees, ~25K rows/year well within Sheets limits. No infrastructure to manage.
- **Trade-offs**: No proper HMAC verification (use verification token instead). 30 concurrent execution limit (acceptable for 15 users). Cold starts may cause occasional 3-second timeout messages.
- **Follow-up**: Monitor performance with 15 users. If cold starts are frequent, add a keep-alive trigger.

### Decision: Verification Token Instead of HMAC
- **Context**: GAS doPost() cannot access HTTP headers
- **Alternatives**: (1) Verification token (2) Cloudflare Worker proxy (3) Skip verification
- **Selected**: Verification token from payload
- **Rationale**: Only viable option in pure GAS. Token is app-specific and non-public. Acceptable risk for internal tool with 15 users.
- **Trade-offs**: Weaker than HMAC (token is static, no timestamp check). Deprecated by Slack but still supported.
- **Follow-up**: If security requirements increase, add a Cloudflare Worker proxy layer.

### Decision: CacheService for Config Tables
- **Context**: Policies, Positions, and Employees data rarely change but are read on every command
- **Selected**: Cache these tables in CacheService with 10-minute TTL
- **Rationale**: Reduces cold-start Sheets reads. Config tables are small (<100 rows). 100KB cache limit is sufficient.
- **Trade-offs**: Stale data for up to 10 minutes after direct sheet edits. Acceptable since admin edits are rare.

### Decision: Deferred Response via UrlFetchApp
- **Context**: GAS is synchronous; need to handle Slack's 3-second timeout
- **Selected**: Process everything → POST to response_url → return ack
- **Rationale**: GAS executes doPost() to completion before sending HTTP response. We must POST the real response to response_url mid-execution, then return the ack as the HTTP body.
- **Trade-offs**: If processing takes >3 seconds, Slack shows timeout but user still gets the response via response_url. Acceptable UX for internal tool.

## Risks & Mitigations
- **Cold start timeout**: First request after idle period may exceed 3 seconds → Mitigate with keep-alive trigger (every 5 min) or accept occasional timeout message
- **Lock contention**: 15 simultaneous /in commands → 10-second tryLock handles this; return "busy" message on failure
- **Sheet corruption from manual edits**: Users accidentally editing Sheets → Protect sheets with editor-only access; bot uses service account
- **Verification token deprecation**: Slack may remove verification token → Monitor Slack changelog; proxy fallback ready
- **6-minute execution limit**: Complex payroll calculations for 15 employees → batch reads + in-memory compute keeps execution under 30 seconds

## References
- [Google Apps Script Quotas](https://developers.google.com/apps-script/guides/services/quotas)
- [Google Apps Script LockService](https://developers.google.com/apps-script/reference/lock)
- [Google Apps Script ContentService](https://developers.google.com/apps-script/guides/content)
- [Slack Slash Commands](https://api.slack.com/interactivity/slash-commands)
- [Slack Request Verification](https://api.slack.com/authentication/verifying-requests-from-slack)
- [Slack Interactive Messages](https://api.slack.com/interactivity/handling)
- [Slack views.open](https://docs.slack.dev/reference/methods/views.open/)
- [Slack Block Kit Reference](https://docs.slack.dev/reference/block-kit/blocks/)
