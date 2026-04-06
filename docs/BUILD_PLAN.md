# Slack HR Bot — Build Plan

Architecture, Phased Build, File Structure & Implementation Guide

---

## 1. Project Overview

| Field | Details |
|-------|---------|
| **Stack** | Slack Free + Google Apps Script + Google Sheets (100% free) |
| **Team Size** | 10–15 contractors (Nepal-based, Japan KK/GK company) |
| **Developer** | Solo (Subash) |
| **Slack Plan** | Free plan (slash commands + interactive messages + Block Kit work) |
| **Data Volume** | ~60 events/day, ~1,200/month, ~15K/year — trivial for Sheets |
| **Language** | JavaScript (Google Apps Script, V8 runtime) |
| **Deployment** | Apps Script Web App (single URL handles all Slack payloads) |

---

## 2. Architecture

### 2.1 System Flow

Every interaction follows this flow:

```
User types /command in Slack
        ↓
Slack sends HTTP POST to Apps Script Web App URL
        ↓
doPost(e) receives payload, routes to handler
        ↓
Handler reads/writes Google Sheets via SheetsService
        ↓
Handler returns JSON response (shown to user in Slack)
```

For interactive messages (approval buttons), Slack sends a different payload type to the same URL. The router detects the payload type and dispatches accordingly.

### 2.2 Key Design Decisions

**Sheets = dumb storage.** No formulas in Google Sheets. Every calculation (hours, deficit, payroll, pro-rata, banking) happens in Apps Script. Sheets is just rows of data. This prevents formula breakage from manual edits and keeps all logic in version-controllable code.

**Acknowledge-first, respond-later (every command).** Every slash command uses the deferred response pattern — no exceptions, even for simple commands like `/in`. This eliminates any risk of hitting Slack's 3-second timeout from cold starts, LockService waits, or slow Sheets reads.

The flow for every command:

```
1. doPost() receives slash command payload (includes response_url)
2. Immediately return {"text": "⏳ Processing..."} (< 100ms, beats 3s timeout)
3. Apps Script continues executing the actual handler
4. Handler does sheet reads/writes, calculations
5. Handler POSTs the real response back to response_url via UrlFetchApp
```

```javascript
function doPost(e) {
  var responseUrl = e.parameter.response_url;
  var command = e.parameter.command;

  // Step 1: Acknowledge immediately
  var ack = ContentService.createTextOutput(
    JSON.stringify({ response_type: "ephemeral", text: "⏳ Processing..." })
  ).setMimeType(ContentService.MimeType.JSON);

  // Step 2: Process and send real response via response_url
  try {
    var result = routeCommand(command, e.parameter);
    UrlFetchApp.fetch(responseUrl, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(result)  // full Block Kit response
    });
  } catch (err) {
    UrlFetchApp.fetch(responseUrl, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ text: "❌ Error: " + err.message })
    });
  }

  return ack;
}
```

**Important:** `response_url` is valid for 30 minutes and supports up to 5 responses. For group commands (`/in`, `/out`, `/break`, `/back`), the deferred response uses `response_type: "in_channel"`. For personal commands (`/hours`, `/payroll`, `/balance`), it uses `response_type: "ephemeral"`.

**Why every command?** Even `/in` (a simple append) can be slow if: (a) Apps Script has a cold start (~1-2s), (b) LockService is waiting for another concurrent write, (c) Sheets API is momentarily slow. The acknowledge-first pattern makes all of this invisible to the user.

**Batch-read, compute in memory.** Every handler that touches multiple tabs (e.g., `/team-payroll` needs Employees + MonthlySummary + SalaryHistory) must read each tab ONCE into memory at the start, then do all lookups and calculations in-memory. Never read a sheet inside a loop. This is critical because salary is calculated on the fly from SalaryHistory (not stored in MonthlySummary), so a per-employee sheet read would be unnecessarily slow. Pattern:

```javascript
// GOOD — 3 API calls total, regardless of team size
var allSalary = sheets.getAll("SalaryHistory");   // ~200ms
var allSummary = sheets.getAll("MonthlySummary");  // ~200ms
var employees = sheets.getAll("Employees");         // ~200ms
// all lookups below are pure in-memory, sub-ms
team.forEach(emp => {
  var salary = findEffective(allSalary, emp.user_id, month);
  var summary = allSummary.find(...);
});

// BAD — N API calls, 200ms × N employees
team.forEach(emp => {
  var salary = sheets.query("SalaryHistory", emp.user_id);  // 200ms each!
});
```

**Single Web App endpoint.** One doPost() function handles everything: slash commands, interactive button clicks, modal submissions. The router inspects the payload to determine the type and dispatches to the correct handler.

**LockService for concurrency.** When two people /in at the same time, Apps Script's LockService.getScriptLock() ensures one write completes before the other starts. Critical for the append-only Events log.

**Time-driven triggers for cron.** Apps Script supports installable triggers that run on a schedule. We use: (a) daily at 23:55 JST — check for unclosed sessions and daily shortfalls, (b) 1st of each month at 00:30 JST — monthly summary, surplus expiry, payroll calculation, (c) weekly Monday 00:15 JST — weekly shortfall check.

### 2.3 Slack App Setup

You need ONE Slack App (not a bot). Steps:

1. Go to api.slack.com/apps, create new app "Slack HR"
2. Enable Slash Commands — add all 24 commands, all pointing to the same Apps Script Web App URL
3. Enable Interactivity — set Request URL to the same Apps Script Web App URL
4. Enable Incoming Webhooks — create webhooks for #hr-flags and #hr-alerts channels
5. Bot Token Scopes: chat:write, commands, incoming-webhook, users:read
6. Install to workspace, save the Bot Token and Signing Secret in Apps Script Properties

**Slack Free plan note:** Free plan allows 10 app integrations. Your custom app counts as 1. You have 9 slots left for other apps (GitHub, JIRA, etc.). Slash commands, interactive messages, and Block Kit all work on Free plan.

---

## 3. File Structure

All files are .gs (Google Apps Script). Use clasp (Command Line Apps Script) for local development and version control.

### 3.1 Core Files

| File | Purpose | Dependencies |
|------|---------|--------------|
| `src/main.gs` | doPost() entry point, payload router, doGet() health check | config.gs |
| `src/config.gs` | Sheet names, column indices, Slack tokens (from Properties), constants | None |
| `src/auth.gs` | Slack signature verification, role checks (employee/manager/admin) | config.gs |

### 3.2 Command Handlers

| File | Purpose | Dependencies |
|------|---------|--------------|
| `src/commands/attendance.gs` | /in, /out, /break, /back, /clock-status — append events, state checks | sheets.gs |
| `src/commands/hours.gs` | /hours (with date/week/month query), /balance, /my-bank — self-service views with warnings | calculator.gs |
| `src/commands/leave.gs` | /leave — create leave request, notify manager with approval buttons | sheets.gs, slack.gs |
| `src/commands/report.gs` | /report — show modal for daily standup, save to DailyReports | sheets.gs, slack.gs |
| `src/commands/manager.gs` | /team-hours, /team-flags, /team-bank — team views for managers | calculator.gs |
| `src/commands/approval.gs` | /approve-surplus, /approve-absence, /adjust-quota — manager approvals | sheets.gs, banking.gs |
| `src/commands/payroll.gs` | /payroll (self-service), /team-payroll (manager), /salary-history (manager) | calculator.gs, salary.gs |
| `src/commands/admin.gs` | /onboard, /offboard, /edit-employee, payroll export — admin operations (modals) | sheets.gs, calculator.gs, slack.gs |

### 3.3 Service Layer

| File | Purpose | Dependencies |
|------|---------|--------------|
| `src/services/sheets.gs` | Read/write Google Sheets. All sheet access goes through here. Handles locking. | config.gs |
| `src/services/calculator.gs` | Hours calculation, payroll, pro-rata, deficit/surplus. Pure functions, no side effects. | sheets.gs |
| `src/services/banking.gs` | Surplus banking: approve, offset, expire, convert to leave. HoursBank tab operations. | sheets.gs |
| `src/services/salary.gs` | Salary history: get history, update salary, format payroll response. SalaryHistory tab operations. | sheets.gs |
| `src/services/flags.gs` | Shortfall detection, flag generation, flag resolution. Flags tab operations. | sheets.gs, calculator.gs |
| `src/services/slack.gs` | Send messages, post to channels, update interactive messages, open modals. | config.gs |

### 3.4 Triggers (Cron)

| File | Purpose | Dependencies |
|------|---------|--------------|
| `src/triggers/daily.gs` | 23:55 JST: check unclosed sessions, generate daily shortfall flags | flags.gs, slack.gs |
| `src/triggers/weekly.gs` | Monday 00:15 JST: weekly shortfall summary (informational only) | calculator.gs, slack.gs |
| `src/triggers/monthly.gs` | 1st 00:30 JST: monthly summary, payroll calc, surplus expiry, bank forfeiture | calculator.gs, banking.gs |
| `src/triggers/reminders.gs` | Every 4 hours: check pending leave requests >24h, send reminders | sheets.gs, slack.gs |

### 3.5 Utilities

| File | Purpose | Dependencies |
|------|---------|--------------|
| `src/utils/dates.gs` | Date math, JST conversion, calendar days, pro-rata helpers, period ranges | None |
| `src/utils/format.gs` | Slack Block Kit message builders — approval buttons, modals, summaries | None |
| `src/utils/validate.gs` | Input validation: date formats, user existence, permission checks | sheets.gs |

### 3.6 Tests

| File | Purpose | Dependencies |
|------|---------|--------------|
| `tests/test_calculator.gs` | Manual test functions for hours/payroll/pro-rata. Run from Apps Script editor. | calculator.gs |
| `tests/test_banking.gs` | Test surplus banking, offset, expiry scenarios | banking.gs |
| `tests/test_dates.gs` | Test date math, JST conversion, edge cases | dates.gs |

---

## 4. Phased Build Order

Build in this order. Each phase produces a working, testable increment. Don't skip phases — later phases depend on earlier ones.

### Phase 0: Project Setup & Slack App (~2 hours)

Create the Slack App, Apps Script project, Google Sheet with all 12 tabs, and clasp setup. Verify the round-trip: slash command → Apps Script → response in Slack. This phase proves the pipeline works before writing any business logic.

**Deliverables:**
- Slack App created with /ping command pointing to Apps Script Web App URL
- Apps Script project with main.gs containing doPost() that returns "pong"
- Google Sheet created with all 12 tabs (empty, just headers per SCHEMA.md)
- config.gs with sheet ID, tab names, column indices, Slack tokens stored in Script Properties
- auth.gs with Slack request signature verification (HMAC-SHA256)
- clasp configured for local development and push/pull

**Test:** Type /ping in Slack → see "pong" response. Verify signature verification rejects tampered requests.

---

### Phase 1: Attendance Tracking (~4 hours)

Core clock-in/out with event logging. This is the foundation — everything else depends on the Events tab having data.

**Files:**
- `src/commands/attendance.gs` — /in, /out, /break, /back, /clock-status
- `src/services/sheets.gs` — appendEvent(), getLastEvent(), getUserEvents()
- `src/utils/dates.gs` — toJST(), today(), formatTime()
- `src/utils/format.gs` — attendanceResponse() Block Kit message

**Logic:**

Each command checks the user's current state (last event for today) before appending. /in checks no open session exists. /out checks an open session exists and user isn't on break. /break checks user is clocked in and not already on break. /back checks user is on break. /clock-status reads last event and returns current state.

**Edge cases:** Double /in → reject with "Already clocked in since HH:MM." /out while on break → "End your break first with /back." /break without /in → "Clock in first."

**Test:** Clock in, take break, end break, clock out. Verify Events tab has 4 rows with correct timestamps. Try edge cases.

---

### Phase 2: Hours Calculation Engine (~6 hours)

The calculation core. Given a user and a date range, compute total hours worked. This is used by /hours, payroll, flags, and everything else.

**Files:**
- `src/services/calculator.gs` — the brain of the system
- `src/commands/hours.gs` — /hours command (uses calculator)
- `tests/test_calculator.gs` — test scenarios

**Key functions in calculator.gs:**

- `getDailyHours(userId, date)` — Pair IN/OUT events, subtract breaks. Returns { worked, breaks, net }.
- `getWeeklyHours(userId, weekStart)` — Sum daily hours for Mon–Fri.
- `getMonthlyHours(userId, yearMonth)` — Sum daily hours for entire month. Add paid leave credits (8h/day). Add credited absence hours.
- `getRequiredHours(userId, yearMonth)` — Check Overrides tab first, then fall back to group policy. Handle pro-rata for mid-month join/termination.
- `getDeficit(userId, yearMonth)` — required − actual. Returns { deficit, surplus, hourlyRate }.
- `getEffectiveSalary(userId, yearMonth)` — Resolve salary from SalaryHistory: find most recent entry where effective_date <= last day of month. Returns the salary that was active during that month. **Critical: all payroll calculations must use this, never Employees.salary directly.** This ensures past months use the correct historical salary even if salary has since changed.

**Pro-rata logic:** If join_date is mid-month, calculate remaining_days / total_days and scale both required hours and fee (using effective salary). Same for termination. Use calendar days, not working days.

**Test:** Manually insert Events rows for a known scenario. Run test_calculator.gs. Verify daily/weekly/monthly hours match hand calculations. Test pro-rata with mid-month join date.

---

### Phase 3: Employee Setup & Self-Service Views (~5 hours)

Populate Employees/Policies tabs. Build the full /hours command with date/week/month query support, /report viewing, /balance with history, and automatic warnings. This is the employee's primary interface for tracking their own work.

**Files:**
- `src/commands/admin.gs` — /onboard modal (add employee via Slack form)
- `src/commands/hours.gs` — /hours with argument parsing: (none), date, week, week last, month, month YYYY-MM
- `src/commands/report.gs` — /report with view mode: (none)=submit, date=view, week=summary, month=summary
- `src/utils/format.gs` — Block Kit formatters for all view types + automatic warnings

**Key feature — argument parsing in /hours:**

- `/hours` → parseArgs("") → showCurrentSnapshot()
- `/hours 2026-03-15` → parseArgs("2026-03-15") → showDateDetail(date)
- `/hours week` → parseArgs("week") → showWeekBreakdown(thisWeek)
- `/hours month 2026-02` → parseArgs("month ...") → showMonthReport(yearMonth)

**Automatic warnings (included in every response):**

Daily shortfall (↓ below 3h min), weekly shortfall (↓ below 30h min), monthly pace warning ("You need Xh in Y remaining days"), bank expiry (within 30 days), deficit status (PENDING/DEDUCTED/OFFSET/NO PENALTY).

**Test:** Onboard yourself. Clock in/out for a few days. Type /hours. Verify numbers match.

---

### Phase 4: Leave Management (~6 hours)

Full leave workflow: request, approval buttons, balance tracking, leave accrual. This is the first feature with interactive messages (Slack buttons).

**Files:**
- `src/commands/leave.gs` — /request-leave, /balance
- `src/services/slack.gs` — postInteractiveMessage(), updateMessage()
- `src/utils/format.gs` — leaveApprovalMessage() with Block Kit buttons

**Interaction flow:**

1. Employee types /request-leave 2026-04-15
2. Bot creates LeaveRequest row (status: PENDING), posts to manager DM with [Approve Paid] [Approve Unpaid] [Reject] buttons
3. Manager clicks a button → Slack sends interaction payload to same doPost() URL
4. Handler updates LeaveRequest status, updates the message (replace buttons with result), notifies employee

**Leave accrual:** Run monthly trigger to add accrual. Check join_date + leave_accrual_start_month to determine if accrual has started. Add leave_accrual_rate to balance. Cap at max_leave_cap.

**Test:** Request leave. See approval message in manager DM. Click approve. Verify LeaveRequest updated. Check /balance reflects the change.

---

### Phase 5: Flags & Shortfall Detection (~5 hours)

Automated shortfall detection with manager approval workflow. Daily/weekly are warnings, monthly triggers actual salary deduction decisions.

**Files:**
- `src/services/flags.gs` — detectShortfalls(), createFlag(), resolveFlag()
- `src/triggers/daily.gs` — end-of-day shortfall check
- `src/triggers/weekly.gs` — weekly summary
- `src/commands/manager.gs` — /team-flags view

**Flag resolution options (interactive message to manager):**

[No Penalty] [Deduct] [Use Bank] [Partial Bank] [Pending]

**Anti-double-penalty:** Daily and weekly flags are informational. Only the monthly flag at end-of-month triggers the actual deduction decision. The monthly flag shows the net position after accounting for good days offsetting bad days within the month.

**Test:** Set up a scenario where an employee has a monthly shortfall. Run the monthly trigger manually. Verify flag appears in #hr-flags. Click resolution buttons. Verify Flags tab updated.

---

### Phase 6: Hours Banking & Surplus (~5 hours)

Surplus banking with manager approval, offset against deficits, 12-month expiry, leave conversion with max_leave_days.

**Files:**
- `src/services/banking.gs` — bankSurplus(), offsetDeficit(), expireSurplus(), convertToLeave()
- `src/commands/approval.gs` — /approve-surplus (manager specifies hours + max_leave_days)
- `src/commands/hours.gs` — add /my-bank command

**Key rules enforced:**

1. Surplus without prior manager approval = not bankable.
2. Only monthly surplus tracked (no weekly).
3. Manager specifies max_leave_days when approving.
4. Banked hours expire 12 months after accrual.
5. Expired hours auto-forfeit.
6. Surplus never results in additional payment.
7. Offset requires manager approval at flag resolution time.
8. Past deductions are final — no retroactive reversal.

**Test:** Create a surplus month, approve banking. Create a deficit month, use bank to offset. Verify HoursBank rows. Test expiry by backdating an entry.

---

### Phase 7: Payroll, Salary Tracking & Slack Payroll Views (~6 hours)

Monthly payroll with all edge cases: pro-rata, banking offsets, quota redistribution, force majeure adjustments. MonthlySummary tab generation. Employee and manager payroll visibility via Slack. Salary change tracking with audit trail.

**Files:**
- `src/triggers/monthly.gs` — end-of-month payroll run
- `src/commands/admin.gs` — admin payroll export
- `src/commands/payroll.gs` — /payroll (employee self-service), /team-payroll (manager view), /salary-history (manager view/update)
- `src/services/salary.gs` — getSalaryHistory(), updateSalary(), formatPayrollResponse()

**Monthly trigger flow:**

1. For each active employee: calculate actual hours (worked + leave + credited)
2. Get required hours (check override/quota plan first, then group policy)
3. Calculate deficit or surplus
4. For surplus: create HoursBank entry (pending manager approval)
5. For deficit: create flag for manager (with bank offset option if available)
6. Generate MonthlySummary row per employee
7. Check surplus expiry — forfeit anything older than 12 months
8. Post summary to #hr-alerts channel

**Slack payroll commands:**

- `/payroll` — Employee sees their own payroll breakdown: salary, hours, deficit, deduction, final. Shows in-progress projection for current month, finalized data for past months. Includes salary history snippet.
- `/team-payroll` — Manager sees table of all direct reports with salary/hours/deficit/deduction/final. Highlights pending flags. Shows team total.
- `/salary-history @employee` — Manager views full salary change history for an employee.
- `/salary-history @employee set <amount>` — Manager initiates salary change: creates SalaryHistory row, updates Employees.salary.

**SalaryHistory tab (new — Tab 12):**

Append-only audit trail. First entry per employee = INITIAL (onboarding). Change types: INITIAL, PROBATION_END, REVIEW, PROMOTION, ADJUSTMENT. Effective always from 1st of month.

**Test:** Populate a full month of data for 2–3 test employees (mix of surplus, deficit, leave). Run monthly trigger. Verify MonthlySummary tab, flags, and Slack notifications. Test /payroll as employee, /team-payroll as manager. Create a salary change via /salary-history, verify SalaryHistory tab and Employees.salary updated.

---

### Phase 8: Quota Redistribution & Pre-Approved Absence (~4 hours)

Manager-initiated schedule adjustments: redistribute hours across months/weeks/days. Pre-approve absences to suppress flags.

**Files:**
- `src/commands/approval.gs` — /adjust-quota, /approve-absence

**/adjust-quota flow:** Manager specifies employee + period type (daily/weekly/monthly) + hours per sub-period. System validates total equals original (warns if not). Creates linked Override rows with a shared plan_id. QuotaPlans tab tracks the plan metadata.

**/approve-absence flow:** Manager specifies employee + date + type (paid leave / unpaid / make-up / credited absence). Creates PreApproval row. When daily trigger runs, it checks PreApprovals before generating a flag. Credited absence adds 8h to the employee's monthly actual.

**Test:** Create a redistribution plan (April 140h, May 180h). Verify Overrides tab. Work 140h in April — verify no flag. Pre-approve an absence for a specific date — verify no daily flag generated.

---

### Phase 9: Daily Reports, Admin Modals & Remaining Commands (~4 hours)

/report with Slack modal, /team-hours, /team-bank, /edit-employee modal, /offboard. Polish and UX improvements.

**Files:**
- `src/commands/report.gs` — /report (opens Slack modal with yesterday/today/blockers fields)
- `src/commands/manager.gs` — /team-hours (summary), /team-bank (bank balances)
- `src/commands/admin.gs` — /offboard (settlement preview + confirmation), /edit-employee (pre-populated modal)

**/report modal:** Slash command triggers a Slack modal (views.open API). Modal has 3 text fields: yesterday, today, blockers. On submit, save to DailyReports tab.

**/edit-employee modal:** Opens pre-populated modal with current employee data. Admin can edit name, email, group, manager, join date, leave config, status. Salary changes use `/salary-history` for audit trail. Group changes take effect next month.

**Modal routing in doPost():** Commands that open modals (`/onboard`, `/edit-employee`) use `trigger_id` + `views.open` directly (not the acknowledge-first pattern). Modal submissions arrive as `view_submission` interaction payloads routed by `callback_id`.

**Test:** Submit a report via modal. Verify DailyReports tab. Check /team-hours as manager. View /team-bank. Onboard a test employee, then edit their group via /edit-employee.

---

### Phase 10: Reminders, Alerts & Hardening (~3 hours)

Leave approval reminders, surplus expiry warnings, unclosed session alerts, error handling, and edge case hardening.

**Files:**
- `src/triggers/reminders.gs` — pending leave >24h, surplus expiring in 30 days, unclosed sessions at EOD

**Hardening checklist:**

1. Error handling: try/catch in every handler, log errors to a Logs tab, respond with friendly error message
2. Input validation: validate dates, check user exists in Employees tab, check permissions
3. Timezone handling: all dates stored in JST, conversion helpers in dates.gs
4. Rate limiting: Apps Script has 20K URL fetches/day and 6-min execution limit — neither will be hit for 15 users
5. Manual correction: admin can edit Sheets directly for corrections (add override row, adjust event)

**Test:** Leave a leave request pending for 24+ hours. Verify reminder sent. Create a surplus entry expiring in 29 days. Verify warning sent. Force an error in a command. Verify friendly error response and Logs tab entry.

---

## 5. Effort Summary

| Phase | Description | Effort | Cumulative |
|-------|-------------|--------|-----------|
| 0 | Project Setup & Slack App | ~2h | 2h |
| 1 | Attendance Tracking | ~4h | 6h |
| 2 | Hours Calculation Engine | ~6h | 12h |
| 3 | Employee Self-Service Views | ~5h | 17h |
| 4 | Leave Management | ~6h | 23h |
| 5 | Flags & Shortfall Detection | ~5h | 28h |
| 6 | Hours Banking & Surplus | ~5h | 33h |
| 7 | Payroll, Salary Tracking & Slack Views | ~6h | 39h |
| 8 | Quota Redistribution & Absence | ~4h | 43h |
| 9 | Daily Reports, Admin Modals & Remaining | ~4h | 47h |
| 10 | Reminders & Hardening | ~3h | 50h |

**Total: ~50 hours of focused development.** At ~3 hours/day of focused coding, this is roughly 3.5 weeks. At full-time focus, about 1.5 weeks.

**After Phase 3 (~17h), you have a working attendance + self-service hours system.** Employees can track their hours, view historical data, and get warnings. That's usable immediately. Every subsequent phase adds a layer.

---

## 6. Development Workflow

### 6.1 Local Development with clasp

```bash
npm install -g @google/clasp
clasp login
clasp clone <script-id>

# Edit .gs files locally, then:
clasp push        # Upload to Apps Script
clasp deploy      # Create new deployment version
```

**Important:** After clasp push, you must create a new deployment (or use HEAD deployment for testing). Slack's slash command URL should point to a versioned deployment for production, or HEAD for development.

### 6.2 Testing Strategy

Apps Script doesn't have a built-in test framework. Strategy:

1. Write test functions in tests/*.gs that call service functions with known inputs and Logger.log() the results
2. Run tests from the Apps Script editor (select function → Run)
3. For integration tests: create a #hr-test channel, use test employee entries, run slash commands manually
4. For trigger tests: run trigger functions manually from the editor, inspect Sheets and Slack output

### 6.3 Debugging

Apps Script debugging is limited. Tips:

**Logger.log():** Use extensively. View logs in Apps Script editor → Executions. Logs persist for 7 days.

**console.log():** Also works in V8 runtime. Shows in Cloud Logging (linked from Apps Script editor).

**Error logging:** Catch errors in doPost() and write them to a Logs tab in your Sheet. Include timestamp, command, user, error message, and stack trace. This is your production debugging tool.

---

## 7. Google Sheets Tab Reference

Per SCHEMA.md. All 12 tabs, with their role:

| Tab | Purpose | Write Frequency |
|-----|---------|-----------------|
| Employees | Master data: name, salary, group, join date, leave config | Rare (onboard/offboard) |
| Events | Append-only attendance log: IN/OUT/BREAK_START/BREAK_END | ~60 rows/day |
| LeaveRequests | Leave requests with approval status | ~5–10 rows/month |
| DailyReports | Standup reports: yesterday/today/blockers | ~15 rows/day |
| Policies | Group definitions: min hours (daily/weekly/monthly) | Rare (config change) |
| Flags | Shortfall flags with resolution status | ~20–50 rows/month |
| HoursBank | Surplus banking: hours, used, remaining, expiry | ~5–15 rows/month |
| QuotaPlans | Redistribution plans: linked override sets | Rare |
| PreApprovals | Pre-approved absences: date, type, credit hours | ~5–10 rows/month |
| Overrides | Individual hour overrides (daily/weekly/monthly) | ~5–10 rows/month |
| SalaryHistory | Salary change audit trail | ~20–40 rows/year |
| MonthlySummary | Payroll snapshot: hours, deficit, deduction, final salary | ~15 rows/month |

**Total rows after 1 year:** ~20,000 events + ~5,000 reports + ~500 other = ~25,500 rows. Google Sheets handles 10 million cells. You're fine for years.
