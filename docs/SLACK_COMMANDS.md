# Slack Commands & Workflow Specification

## Command Reference

### Employee Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/in` | Clock in (start work) | `/in` |
| `/out` | Clock out (end work) | `/out` |
| `/break` | Start a break | `/break` |
| `/back` | End break, resume work | `/back` |
| `/report` | Submit or view daily standup report | `/report` or `/report @Alex` |
| `/request-leave` | Request leave | `/leave 2026-04-02` |
| `/hours` | View hours (current, date, week, month) | `/hours` or `/hours month 2026-02` |
| `/balance` | View leave balance + history | `/balance` |
| `/clock-status` | Check current clock state | `/clock-status` |
| `/my-bank` | View your banked surplus hours | `/my-bank` |
| `/payroll` | View your payroll calculation | `/payroll` or `/payroll 2026-02` |
| `/hr-help` | Show available commands (role-aware: shows only commands the caller can use) | `/hr-help` |
| `/team-leave` | View who's on leave (visible to all employees) | `/team-leave` or `/team-leave week` |

### Manager Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/team-hours` | View team hours summary | `/team-hours` |
| `/team-flags` | View pending shortfall flags | `/team-flags` |
| `/approve-surplus` | Proactively approve surplus banking at month-end | `/approve-surplus @Alex 2026-03 40 5` |
| `/approve-absence` | Pre-approve employee absence | `/approve-absence @Alex 2026-04-10 reason: doctor` |
| `/adjust-quota` | Redistribute hours across periods | `/adjust-quota @Alex monthly` |
| `/team-bank` | View team hours bank balances | `/team-bank` |
| `/team-reports` | View team daily reports | `/team-reports` or `/team-reports week` |
| `/team-payroll` | View team payroll summary | `/team-payroll` or `/team-payroll 2026-02` |
| `/salary-history` | View/update employee salary history | `/salary-history @Alex` |

### Admin Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/onboard` | Add new employee to system (opens modal) | `/onboard` |
| `/offboard` | Deactivate employee | `/offboard @Alex` |
| `/edit-employee` | Edit employee details (opens modal) | `/edit-employee @Alex` |

---

## Authentication & Request Verification

Every request to the Apps Script Web App must be verified as coming from Slack. This prevents spoofed requests.

**Slack Request Signature Verification (HMAC-SHA256):**

```javascript
// src/auth.gs — verifySlackRequest()
// Called at the TOP of doPost() before any routing
function verifySlackRequest(e) {
  var signingSecret = PropertiesService.getScriptProperties().getProperty("SLACK_SIGNING_SECRET");
  var timestamp = e.parameter["X-Slack-Request-Timestamp"] || e.postData.headers["X-Slack-Request-Timestamp"];
  var slackSignature = e.postData.headers["X-Slack-Signature"];

  // Reject requests older than 5 minutes (replay attack protection)
  var now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) {
    throw new Error("Request too old");
  }

  // Compute expected signature: v0=HMAC-SHA256(signing_secret, "v0:{timestamp}:{body}")
  var basestring = "v0:" + timestamp + ":" + e.postData.contents;
  var hmac = Utilities.computeHmacSha256Signature(basestring, signingSecret);
  var expectedSignature = "v0=" + hmac.map(function(b) {
    return ("0" + (b & 0xFF).toString(16)).slice(-2);
  }).join("");

  if (expectedSignature !== slackSignature) {
    throw new Error("Invalid signature");
  }
}
```

**Note:** In Google Apps Script, request headers may not be directly accessible via `e.parameter`. The actual implementation may need to use `e.postData.headers` or parse raw headers. Test during Phase 0 and adjust. If Apps Script strips Slack headers, an alternative is to include a shared secret as a query parameter in the Web App URL (less secure but functional).

**Token Storage:**
- `SLACK_BOT_TOKEN` (xoxb-...) — stored in Script Properties, used for `chat.postMessage`, `views.open`
- `SLACK_SIGNING_SECRET` — stored in Script Properties, used for request verification
- NEVER hardcoded in source code

---

## Authorization & Role Model

**Three roles** resolved from the Employees sheet. Every command handler calls `requireRole()` before executing.

**Inclusive role hierarchy:** Roles are inclusive, not exclusive. Each higher role inherits all capabilities of lower roles:
- **Employee** = employee commands only
- **Manager** = employee + manager commands (a manager IS an employee)
- **Admin** = employee + manager + admin commands (an admin IS a manager AND an employee)

This means a manager can always use `/in`, `/hours`, `/payroll` etc. for themselves, and an admin can use all manager commands (like `/team-hours`) in addition to admin-only commands.

```javascript
// src/auth.gs — getRole() and requireRole()
function getRole(slackUserId) {
  // Look up user in Employees tab by slack_id
  // Returns: { user_id, role, manager_id, is_admin, status }
  // role is derived:
  //   - is_admin=TRUE or user is CEO → "admin"
  //   - has direct reports (other employees' manager_id = this user_id) → "manager"
  //   - otherwise → "employee"
  // If status=INACTIVE → throw "Your account is inactive. Contact admin."
  // If not found → throw "You're not registered. Contact admin to onboard you."
}

function requireRole(slackUserId, minimumRole) {
  // minimumRole: "employee" | "manager" | "admin"
  // Hierarchy: admin > manager > employee (inclusive — each level includes all below)
  // Admin can do everything. Manager can do manager + employee. Employee can only do employee.
  // Returns user object if authorized, throws if not.
}
```

**Permission Matrix (complete):**

| Command | Min Role | Scope | Error if unauthorized |
|---------|----------|-------|----------------------|
| `/in` | employee | self | "You're not registered." |
| `/out` | employee | self | "You're not registered." |
| `/break` | employee | self | "You're not registered." |
| `/back` | employee | self | "You're not registered." |
| `/hours` | employee | self | "You're not registered." |
| `/balance` | employee | self | "You're not registered." |
| `/clock-status` | employee | self | "You're not registered." |
| `/my-bank` | employee | self | "You're not registered." |
| `/payroll` | employee | self | "You're not registered." |
| `/report` (no args) | employee | self | "You're not registered." |
| `/report @employee` | manager | direct reports only | "You don't have permission to view this employee's reports." |
| `/request-leave` | employee | self | "You're not registered." |
| `/hr-help` | employee | n/a (role-aware output) | "You're not registered." |
| `/team-leave` | employee | all active employees | "You're not registered." |
| `/team-hours` | manager | direct reports | "This command is for managers only." |
| `/team-flags` | manager | direct reports | "This command is for managers only." |
| `/team-bank` | manager | direct reports | "This command is for managers only." |
| `/team-reports` | manager | direct reports | "This command is for managers only." |
| `/team-payroll` | manager | direct reports | "This command is for managers only." |
| `/salary-history` (view) | manager | direct reports | "This command is for managers only." |
| `/salary-history set` | admin | any employee | "Only admins can update salary." |
| `/approve-surplus` | manager | direct reports | "This command is for managers only." |
| `/approve-absence` | manager | direct reports | "This command is for managers only." |
| `/adjust-quota` | manager | direct reports | "This command is for managers only." |
| `/onboard` | admin | n/a | "Only admins can onboard employees." |
| `/offboard` | admin | any employee | "Only admins can offboard employees." |
| `/edit-employee` | admin | any employee | "Only admins can edit employee details." |

**Scope rules:**
- "self" = command only affects the calling user's own data
- "direct reports" = manager can only see/act on employees where `Employees.manager_id = caller's user_id`. Admin/CEO can see all.
- "any employee" = admin can act on any employee

**Unregistered users:** Any Slack user NOT in the Employees sheet (or with status=INACTIVE) gets: "You're not registered in the HR system. Contact admin." for ALL commands.

---

## Role Assignment — How Roles Are Created & Managed

Roles are **not** set via a dedicated "role" column. Instead, they are **derived** from existing data in the Employees sheet at runtime:

### How Each Role Is Determined

| Role | How it's assigned | Employees Sheet Column | Value |
|------|-------------------|----------------------|-------|
| **Employee** | Automatically — any row in Employees with `status=ACTIVE` | `status` | `ACTIVE` |
| **Manager** | Automatically — when another employee's `manager_id` points to this user | `manager_id` (on the *report's* row) | e.g. `EMP002` |
| **Admin** | Manually — set `is_admin=TRUE` in the Employees sheet, OR be CEO (EMP000) | `is_admin` | `TRUE` |

### Detailed Steps

**Creating an Admin:**
1. Open the Google Sheet → **Employees** tab
2. Find the employee's row (or use `/onboard` to create them first)
3. Set the `is_admin` column to `TRUE`
4. That user now has admin privileges immediately (role is checked on every command)
5. **Note:** The `is_admin` column must be added to the Employees schema. Only direct sheet editing can set this — there is no slash command to grant admin. This is intentional (security).

**Creating a Manager:**
1. A user becomes a manager automatically when at least one other employee's `manager_id` is set to their `user_id`
2. This happens during `/onboard` (the onboarding modal asks for the new employee's manager)
3. It can also be changed via `/edit-employee @someone` → update their manager field
4. Or directly in the sheet: set the report's `manager_id` column to the manager's `user_id` (e.g., `EMP002`)
5. **Example:** If Employees row for "Subash" has `manager_id = EMP002`, then EMP002 is automatically a manager

**Removing a Manager:**
- If all employees who had `manager_id = EMP005` are offboarded or reassigned to another manager, EMP005 is no longer a manager (role falls back to employee)

**Removing an Admin:**
- Set `is_admin` to `FALSE` (or blank) in the Employees sheet. If they still have direct reports, they remain a manager.

### Role Resolution Logic (in `getRole()`)

```javascript
function getRole(slackUserId) {
  var emp = findEmployeeBySlackId(slackUserId);
  if (!emp) throw "You're not registered. Contact admin to onboard you.";
  if (emp.status === "INACTIVE") throw "Your account is inactive. Contact admin.";

  // Determine role (inclusive hierarchy)
  if (emp.is_admin === true || emp.user_id === "EMP000") {
    emp.role = "admin";    // Admin = can do everything (admin + manager + employee)
  } else if (hasDirectReports(emp.user_id)) {
    emp.role = "manager";  // Manager = can do manager + employee commands
  } else {
    emp.role = "employee"; // Employee = employee commands only
  }
  return emp;
}
```

### Employees Sheet — Updated Column Reference for Roles

| Column | Type | Role Impact | Set By |
|--------|------|-------------|--------|
| `status` | enum: ACTIVE/INACTIVE | INACTIVE = locked out of all commands | `/onboard`, `/offboard`, direct sheet edit |
| `manager_id` | string (FK to user_id) | If OTHER employees point to you → you're a manager | `/onboard` modal, `/edit-employee`, direct sheet edit |
| `is_admin` | boolean | TRUE → admin role | Direct sheet edit only (intentional — no slash command) |

**Key point:** There is no `/make-admin` or `/assign-role` command. Admin is a privileged role set only via direct Google Sheet access. Manager is derived automatically from the org structure. This keeps role escalation secure.

---

## Channel & Privacy Model

### Channels

| Channel | Purpose | Who can see | Bot posts |
|---------|---------|-------------|-----------|
| `#attendance` | Daily clock in/out log | All employees | Auto — `/in`, `/out`, `/break`, `/back` responses |
| `#daily-reports` | Standup report summaries | All employees | Auto — from `/report` submissions |
| `#leave-requests` | Leave request notifications (for manager approval) | All employees + managers | Auto — from `/request-leave` submissions |
| `#hr-flags` | Hour shortfall alerts | Managers + admin only | Auto — from monthly flag trigger |
| `#hr-alerts` | System alerts (onboard/offboard, salary changes) | Admin only | Auto — system events |

### Response Types per Command

**Public (`response_type: "in_channel"`)** — visible to everyone in the channel:
- `/in`, `/out`, `/break`, `/back` — shows ONLY: name + action + time. Example: "Subash clocked in at 09:00"
- **NEVER** includes: hours worked, deficit, salary, leave balance, or any personal data

**Private (`response_type: "ephemeral"`)** — visible ONLY to the user who typed the command:
- ALL other commands (24 minus the 4 attendance commands)
- All error messages
- All modal triggers
- All DM notifications (warnings, reminders, welcome messages)

### Privacy Rules

1. **Personal data NEVER appears in group channels.** Hours, deficit, salary, leave balance, payroll, flags — all ephemeral or DM only.
2. **Attendance channel shows only public info:** name, action, timestamp. No hours totals, no salary, no deficit.
3. **Manager commands are ephemeral.** Even `/team-payroll` only shows to the manager who typed it.
4. **Bot DMs for sensitive notifications:** deficit warnings, surplus expiry, flag alerts, welcome messages — all sent via `chat.postMessage` to the user's DM channel, never to a group.
5. **Admin channels (#hr-flags, #hr-alerts) should be private channels** with restricted membership (managers/admin only).

### Bot DM Interactions

Employees can DM the bot directly. All slash commands work in DMs. This is the recommended way to use personal data commands (`/hours`, `/payroll`, `/balance`, etc.) so the command itself isn't visible to others in a group channel.

---

## Detailed Command Flows

### Attendance State Machine

Every employee has a **clock state** derived from their most recent event in the Events tab (for the current session). The state determines which commands are valid.

**States:**
- `IDLE` — Not clocked in (no open session)
- `CLOCKED_IN` — Working (IN event, no matching OUT)
- `ON_BREAK` — On break (BREAK_START, no matching BREAK_END)

**Transition Table:**

| Current State | Command | Action | New State | Error if invalid |
|--------------|---------|--------|-----------|-----------------|
| `IDLE` | `/in` | Append IN event | `CLOCKED_IN` | — |
| `IDLE` | `/out` | — | — | "You haven't clocked in today" |
| `IDLE` | `/break` | — | — | "Clock in first with /in" |
| `IDLE` | `/back` | — | — | "You're not on a break" |
| `CLOCKED_IN` | `/in` | — | — | "Already clocked in since HH:MM" |
| `CLOCKED_IN` | `/out` | Append OUT event, show hours | `IDLE` | — |
| `CLOCKED_IN` | `/break` | Append BREAK_START | `ON_BREAK` | — |
| `CLOCKED_IN` | `/back` | — | — | "You're not on a break" |
| `ON_BREAK` | `/in` | — | — | "Already clocked in since HH:MM" |
| `ON_BREAK` | `/out` | — | — | "You're on break. Use /back first, then /out" |
| `ON_BREAK` | `/break` | — | — | "Already on break since HH:MM" |
| `ON_BREAK` | `/back` | Append BREAK_END | `CLOCKED_IN` | — |

**State diagram:**
```
                    /in                          /break
    ┌──────┐  ──────────►  ┌────────────┐  ──────────►  ┌──────────┐
    │ IDLE │                │ CLOCKED_IN │               │ ON_BREAK │
    └──────┘  ◄──────────  └────────────┘  ◄──────────  └──────────┘
                    /out                          /back
```

**Multiple sessions per day:** After `/out` (state → IDLE), the employee CAN `/in` again. Each IN/OUT pair is a separate session. Daily hours = sum of all sessions minus all breaks.

**Idempotency:** If the same user sends the same command within 60 seconds (e.g., double-tap /in), the bot rejects the duplicate to prevent accidental double-entry after Slack timeout messages.

**State resolution logic:** Read the Events tab for this user, find the most recent event. The state is derived as:
- Last event = OUT (or no events today) → `IDLE`
- Last event = IN or BREAK_END → `CLOCKED_IN`
- Last event = BREAK_START → `ON_BREAK`

---

### `/in` - Clock In

**Flow:**
1. User types `/in` in any Slack channel/DM
2. Apps Script receives POST with user_id, command
3. Check state: must be `IDLE` (last event = OUT or no events)
   - State is `CLOCKED_IN` → "Already clocked in since HH:MM"
   - State is `ON_BREAK` → "Already clocked in since HH:MM"
   - State is `IDLE` → append `IN` event to Events sheet
4. Idempotency check: reject if last IN event for this user was < 60 seconds ago
5. Respond: "Clocked in at 09:00. Have a productive day!"

**Response:**
```
✅ Clocked in at 09:00
Status: Working
```

---

### `/out` - Clock Out

**Flow:**
1. User types `/out`
2. Check state: must be `CLOCKED_IN`
   - State is `IDLE` → "You haven't clocked in today"
   - State is `ON_BREAK` → "You're on break. Use /back first, then /out"
   - State is `CLOCKED_IN` → append `OUT` event
3. Calculate today's hours (all sessions, minus all breaks)
4. Respond with summary

**Response:**
```
✅ Clocked out at 18:00
Today's hours: 7h 45m
Breaks: 45m
Net work: 7h 00m
```

---

### `/break` - Start Break

**Flow:**
1. Check state: must be `CLOCKED_IN`
   - State is `IDLE` → "Clock in first with /in"
   - State is `ON_BREAK` → "Already on break since HH:MM"
   - State is `CLOCKED_IN` → append `BREAK_START`
2. Respond: "Break started at 11:00. Use /back when you're back."

---

### `/back` - End Break

**Flow:**
1. Check state: must be `ON_BREAK`
   - State is `IDLE` → "You're not on a break"
   - State is `CLOCKED_IN` → "You're not on a break"
   - State is `ON_BREAK` → append `BREAK_END`
2. Calculate break duration
3. Respond: "Welcome back! Break was 15 minutes."

---

### `/report` - Daily Standup Report

**Flow:**
1. User types `/report`
2. Bot opens Slack modal/dialog with 3 fields:
   - "What did you do yesterday?" (mention JIRA tickets, PR numbers)
   - "What will you do today?" (mention JIRA tickets, PR numbers)
   - "Any blockers/issues?"
3. User fills and submits
4. Apps Script saves to DailyReports sheet
5. Respond: "Report submitted for March 28."
6. Optionally post summary to `#daily-reports` channel

**Inline alternative** (for quick entry without modal):
```
/report yesterday: Fixed login bug JIRA-123, reviewed PR #42 | today: Payment API JIRA-456 | blockers: Waiting on design approval
```
Bot parses the `|` separated sections. If text is provided inline, skip the modal.

---

### `/request-leave` - Request Leave

**Flow:**
1. User types `/request-leave 2026-04-02` (or `/request-leave 2026-04-02 2026-04-05` for range)
2. System checks paid leave balance
3. Creates Leave Request row (status: PENDING)
4. Sends approval message to manager:

**Manager receives:**
```
📋 Leave Request
Employee: Subash
Date: Apr 2, 2026
Paid Leave Balance: 5 days

[✅ Approve Paid] [⚠️ Approve Unpaid] [❌ Reject]
```

If balance = 0:
```
📋 Leave Request
Employee: Subash
Date: Apr 2, 2026
Paid Leave Balance: 0 days

[🔄 Shift Permission] [⚠️ Approve Unpaid] [❌ Reject]
```

5. Manager clicks button → Apps Script updates Leave Request row
6. Bot notifies employee of decision

**Employee notification:**
```
Your leave request for Apr 2 has been approved as Paid Leave.
Remaining balance: 4 days.
```

---

### `/hours` - View Hours (with date/week/month query)

**Usage:**
```
/hours                    → current snapshot (today + this week + this month)
/hours 2026-03-15         → specific date detail
/hours week               → this week (day-by-day breakdown)
/hours week last          → last week
/hours week 2026-W12      → specific ISO week
/hours month              → this month (detailed with weekly breakdown)
/hours month 2026-02      → specific month (full report)
```

**Response — `/hours` (default, current snapshot):**
```
📊 Your Hours — March 28, 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Today:      2.5h / 4h min   ⚠️ -1.5h (still working)
This Week:  18h / 30h min   ⚠️ -12h (2 days left)
This Month: 142h / 160h min ⚠️ -18h (3 days left)

Leave: 2 days (16h credited)
Bank:  12h available (expires Sep 2026)

⚠️ You need 18h in 3 remaining days to avoid a
   monthly deficit. Talk to your manager if needed.
```

**Response — `/hours 2026-03-15` (specific date):**
```
📊 Saturday, March 15, 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Worked: 6h 30m
Breaks: 45m (2 breaks)
Net:    5h 45m  ✅ (daily min: 4h)

Sessions:
  09:15 → 12:00  (2h 45m)
    Break: 11:00–11:15 (15m)
  13:00 → 18:15  (5h 15m)
    Break: 15:30–16:00 (30m)
```

**Response — `/hours week` (this week breakdown):**
```
📊 This Week — Mar 23–28, 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Mon Mar 23:  6.5h  ✅
Tue Mar 24:  7.0h  ✅
Wed Mar 25:  2.0h  ⚠️ below daily min (4h)
Thu Mar 26:  5.5h  ✅
Fri Mar 27:  3.0h  ✅ min
Sat Mar 28:  2.5h  🔵 in progress
─────────────────────────
Total:       26.5h / 30h min  ⚠️ -3.5h

⚠️ Weekly shortfall: -3.5h. This is a warning only.
   Monthly deficit is the metric that affects salary.
```

**Response — `/hours month 2026-02` (specific month, full report):**
```
📊 February 2026 — Monthly Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Required:   160h
Worked:     142h
Leave:      2 days (16h credited)
Credited:   0h
Total:      158h
─────────────────
Deficit:    2h ⚠️
Status:     DEDUCTED (manager approved)
Deduction:  NPR 5,000 (2h × NPR 2,500/h)

Weekly Breakdown:
  W1 (Feb 2–6):    32h / 30h  ✅ +2h
  W2 (Feb 9–13):   28h / 30h  ⚠️ -2h
  W3 (Feb 16–20):  30h / 30h  ✅
  W4 (Feb 23–27):  26h / 30h  ⚠️ -4h
  Weekend work:     10h

Daily Detail:
  Mon Feb 2:   6.5h ✅    Tue Feb 3:  7.0h ✅
  Wed Feb 4:   3.0h ✅    Thu Feb 5:  8.0h ✅
  Fri Feb 6:   7.5h ✅    Sat Feb 7:  0.0h
  Sun Feb 8:   0.0h
  Mon Feb 9:   5.0h ✅    Tue Feb 10: 6.0h ✅
  ...
  (full daily breakdown)

Bank Used:  0h
Bank Avail: 12h (from Jan 2026, expires Jan 2027)
Leave Bal:  4 days remaining
```

**Warnings included automatically:**
- Daily shortfall: shown in daily detail with ⚠️
- Weekly shortfall: shown in weekly summary with ⚠️
- Monthly deficit: shown with deduction amount or PENDING status
- Bank expiry: shown if any bank entries expire within 30 days
- Pace warning: "You need Xh in Y remaining days" when behind pace

---

### `/report` - Submit or View Daily Report

**Routing logic:**
```
/report                       → submit today's report (open modal)
/report 2026-03-15            → view YOUR report for that date
/report week                  → view YOUR report submission summary for this week
/report month 2026-02         → view YOUR reports for that month
/report @Alex                 → view Alex's report for today (manager only)
/report @Alex 2026-03-15      → view Alex's report for that date (manager only)
/report @Alex week            → view Alex's report summary this week (manager only)
/report alex@example.com   → same as @Alex (lookup by email, manager only)
/report EMP003                → same as @Alex (lookup by user_id, manager only)
```

**Employee lookup (manager commands):** The system resolves the target employee by:
1. Slack mention (`@Alex`) → match slack_id in Employees tab
2. Email (`alex@example.com`) → match email in Employees tab
3. User ID (`EMP003`) → match user_id in Employees tab

If the caller is not a manager of the target employee, return: "You don't have permission to view this employee's reports."

**Submit (no argument or today):**
```
/report
```
Opens Slack modal with 3 fields (yesterday/today/blockers). Same as before.

**View your own report for a date:**
```
/report 2026-03-15
```
**Response:**
```
📝 Your Report — March 15, 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Yesterday: Fixed login bug (JIRA-123), reviewed PR #42
Today:     Working on payment API (JIRA-456)
Blockers:  Waiting for design approval on dashboard

Submitted at: 09:30 JST
Hours worked: 5h 45m
```

**View your weekly summary:**
```
/report week
```
**Response:**
```
📝 Your Reports — This Week (Mar 23–28)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Mon Mar 23: ✅ Submitted (JIRA-456, JIRA-457)
Tue Mar 24: ✅ Submitted (PR #52, JIRA-458)
Wed Mar 25: ❌ Not submitted
Thu Mar 26: ✅ Submitted (JIRA-459)
Fri Mar 27: ✅ Submitted (JIRA-460, PR #53)
Sat Mar 28: ⏳ Today (not yet submitted)

Submitted: 4/5 working days (80%)
```

**View a specific employee's report (manager only):**
```
/report @Alex 2026-03-15
```
**Response:**
```
📝 Alex's Report — March 15, 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Yesterday: Dashboard UI redesign (JIRA-450)
Today:     API integration (JIRA-451)
Blockers:  Waiting for design specs

Submitted at: 10:15 JST
Hours worked: 6h 20m
```

**View monthly reports:**
Lists all reports for the month with submission rate and missing dates.

---

### `/balance` - View Leave Balance + History

**Response:**
```
🏖️ Leave Balance
━━━━━━━━━━━━━━━━

Total Accrued:  10 days
Used (Paid):     7 days
Remaining:       3 days
Next accrual:    Apr 1 (+1 day)
Max cap:         20 days

Recent Leave:
  Mar 15: Paid Leave (approved by Sanjay)
  Mar 3:  Unpaid Leave (approved by Sanjay)
  Feb 14: Paid Leave (approved by Sanjay)

Surplus Leave Available: 2 days (from banked hours)
```

---

### `/clock-status` - Current State

**Response (working):**
```
🟢 Status: Working
Clocked in at: 09:00
Current session: 3h 15m
Breaks today: 30m
```

**Response (on break):**
```
🟡 Status: On Break
Break started: 13:00
Break duration: 12m
```

**Response (not clocked in):**
```
⚪ Status: Not Clocked In
Last session: Yesterday, 8h 15m
```

---

### `/my-bank` - View Your Banked Surplus Hours (Employee)

**Response:**
```
📦 Your Banked Surplus Hours
──────────────────────────────
March 2026:  +40h surplus
  Remaining: 35h (used 5h)
  Max leave convertible: 5 days
  Expires: Mar 31, 2027

February 2026: +8h surplus
  Remaining: 8h (not used)
  Max leave convertible: 1 day
  ⚠️ Expires in 15 days (Feb 15, 2027)

April 2026: +2h surplus
  Remaining: 2h (not used)
  Max leave convertible: 0 days
  🔴 EXPIRED (Apr 30, 2027)

Total available: 45h
Total usable as leave: 6 days
```

**Highlighted entries:** Any entries expiring within 30 days are shown with warning.

---

### `/team-leave` - Team Leave Calendar (All Employees)

**Min role:** employee (visible to everyone — not restricted to managers)

**Privacy:** Response is always ephemeral (private to caller). **Leave type (paid/unpaid/shift) is NOT shown to regular employees** — only whether someone is on leave or not. Managers and admins see leave types for their scope (direct reports / all employees respectively).

**Usage:**
```
/team-leave              → Who's on leave today
/team-leave week         → Who's on leave this week
/team-leave 2026-04      → Monthly leave calendar
```

**Response for EMPLOYEE (today, ephemeral) — names only, no leave types:**
```
📅 Team Leave — Today (Sat, Mar 28)
────────────────────────────────────
🏖️ Jane Smith — On Leave
🏖️ Yuki Tanaka — On Leave

2 members on leave today.
```

**Response for MANAGER/ADMIN (today, ephemeral) — includes leave type:**
```
📅 Team Leave — Today (Sat, Mar 28)
────────────────────────────────────
🏖️ Jane Smith — Paid Leave
🏖️ Yuki Tanaka — Unpaid Leave

2 members on leave today.
```

**Response (week) — same for all roles (names only, no types in week view):**
```
📅 Team Leave — This Week (Mar 23 – Mar 29)
─────────────────────────────────────────────
Mon 23  —  (none)
Tue 24  —  (none)
Wed 25  —  Jane Smith
Thu 26  —  Jane Smith, Yuki Tanaka
Fri 27  —  Yuki Tanaka
Sat 28  —  (none)
Sun 29  —  (none)
```

**Response for EMPLOYEE (month) — names only:**
```
📅 Team Leave — April 2026
───────────────────────────
Apr 02  —  Jane Smith
Apr 03  —  Jane Smith
Apr 10  —  Yuki Tanaka
Apr 15  —  Ram Sharma

Total: 4 leave days across 3 members
```

**Response for MANAGER/ADMIN (month) — includes leave types:**
```
📅 Team Leave — April 2026
───────────────────────────
Apr 02  —  Jane Smith (Paid Leave)
Apr 03  —  Jane Smith (Paid Leave)
Apr 10  —  Yuki Tanaka (Shift Permission)
Apr 15  —  Ram Sharma (Unpaid Leave)

Total: 4 leave days across 3 members
```

**Data source:** Reads from LeaveRequests tab (status=APPROVED) + PreApprovals tab. Only shows approved leave, not pending requests.

**Implementation:**
```javascript
function handleTeamLeave(caller, text) {
  // Min role: employee — any registered user can see this
  // Parse argument: empty = today, "week" = this week, "YYYY-MM" = month
  // Query LeaveRequests (status=APPROVED) + PreApprovals for the date range
  // Show all active employees' leave — not scoped to direct reports
  // Response type: ephemeral (private to caller)
  //
  // Privacy rule: leave type visibility depends on caller's role
  //   - Employee: show "On Leave" only (no type)
  //   - Manager: show leave type for direct reports, "On Leave" for others
  //   - Admin: show leave type for all employees
  var showTypes = (caller.role === "manager" || caller.role === "admin");
}
```

---

### `/team-hours` - Manager View

**Response:**
```
📊 Team Hours Summary (March 2026)
───────────────────────────────────
Subash  → 140h / 160h  ⚠️ -20h deficit
John    → 165h / 160h  ✅ +5h
Alex    → 120h / 160h  🔴 -40h deficit
Yuki    → 158h / 160h  ✅ -2h (within grace)
```

---

### `/team-flags` - Pending Flags

**Response (updated with banking info):**
```
🚩 Pending Shortfall Flags
───────────────────────────
1. Alex - Monthly -40h (April 2026)
   📦 Bank available: 40h (from March — requires your prior approval)
   [✅ Use Bank*] [⚠️ Partial Bank*] [💰 Deduct] [❌ No Penalty] [⏳ Discuss]
   *Only manager-approved banked surplus can offset deficits

2. Subash - Daily -1.5h (Apr 7)
   📦 Bank available: 3h (from Apr 4 — requires your prior approval)
   [✅ Use Bank*] [💰 Deduct] [❌ No Penalty]
   *Only manager-approved banked surplus can offset deficits
```

---

### `/approve-absence` - Pre-Approve Absence (Manager)

**Usage:**
```
/approve-absence @Alex 2026-04-10 reason: doctor appointment
```

**Flow:**
1. Manager types command with employee mention, date, and reason
2. Bot responds with options:
```
Pre-Approve Absence for Alex on Apr 10
Reason: doctor appointment

How should this day be counted?
[🏖️ Paid Leave] [⚠️ Unpaid Leave] [🔄 Make-Up Day] [✅ Credited Absence]
```
3. Manager selects option:
   - **Paid Leave** → deducts from leave balance, credits 8h toward hours
   - **Unpaid Leave** → 0h credited, no flag will fire, accepted deficit
   - **Make-Up Day** → 0h credited, employee expected to compensate via extra hours later
   - **Credited Absence** → 8h credited WITHOUT using leave balance (special cases: sick, emergency)
4. System creates PreApproval record → that day skips flag generation
5. Confirmation:
```
✅ Absence pre-approved for Alex on Apr 10
Type: Credited Absence (8h credited)
Reason: doctor appointment
No shortfall flag will be generated for this day.
```

---

### `/adjust-quota` - Redistribute Hours (Manager)

**Usage:**
```
/adjust-quota @Alex monthly
/adjust-quota @Alex daily 2026-04-07
/adjust-quota @Alex weekly 2026-04
```

**Monthly Flow:**
1. Manager types `/adjust-quota @Alex monthly`
2. Bot shows form:
```
📋 Quota Redistribution: Alex
Group default: 160h/month

Set adjusted hours per month:
April 2026: [____] hours
May 2026:   [____] hours

Original total (2 months): 320h
Your total: [calculated live]
```
3. Manager fills in: April=140, May=180 (total=320 ✅)
4. Bot confirms:
```
✅ Quota plan created (QRP-2026-001)
Alex's adjusted requirements:
  April 2026: 140h (was 160h)
  May 2026: 180h (was 160h)
  Total: 320h = original 320h ✅

Flags will use these adjusted targets.
```

**Daily Flow:**
1. Manager types `/adjust-quota @Alex daily 2026-04-07`
2. Bot shows the week containing Apr 7:
```
📋 Daily Redistribution: Alex (Week of Apr 7-11)
Daily default: 4h | Weekly total: 30h

Mon Apr 7:  [____] hours
Tue Apr 8:  [____] hours
Wed Apr 9:  [____] hours
Thu Apr 10: [____] hours
Fri Apr 11: [____] hours

Weekly total: [calculated live] / 30h
```
3. Manager fills in: Mon=3, Tue=9, Wed=6, Thu=6, Fri=6 (total=30 ✅)

**Rules:**
- If adjusted total < original total → bot warns: "This reduces Alex's requirement by Xh. Confirm?"
- Plans can be edited before the period starts
- Once a period has passed, its override is locked
- Plans are linked via plan_id for audit trail

---

### `/approve-surplus` - Proactively Approve Surplus Banking (Manager)

**Usage:**
```
/approve-surplus @Alex 2026-03 40 5
```

**Flow:**
1. Manager types command with employee mention, period (YYYY-MM), hours to bank, max leave days
2. System creates entry in HoursBank with:
   - surplus_hours = 40
   - approved_by = manager
   - max_leave_days = 5
   - expires_at = 2027-03-31 (12 months from period start)
3. Confirmation:
```
✅ Surplus approved for Alex
Period: March 2026
Banked: 40h
Max convertible to leave: 5 days
Expires: Mar 31, 2027
```

**Rules:**
- Manager proactively approves at month-end before flags are generated
- Locks in max_leave_days at approval time
- Entry appears in HoursBank and can be used for future deficit offset or leave conversion
- No separate approval needed later

---

### `/team-bank` - View Team Hours Bank (Manager)

**Response:**
```
📦 Team Hours Bank (Manager-Approved Only)
──────────────────────────────────────────
Entries shown are ONLY those where you (or another manager) approved banking.
Unapproved surplus hours are NOT listed here and cannot be used for offset.

Alex:
  March 2026: +40h surplus (expires Mar 31, 2027) - 40h remaining - Max 5 leave days - Approved by You

John:
  March 2026: +10h surplus (expires Mar 31, 2027) - 10h remaining - Max 1 leave day - Approved by You

Subash:
  (no approved banked hours)

Yuki:
  Feb 2026:   +8h surplus (EXPIRED Mar 31, 2027)
  March 2026: +2h surplus (expires Mar 31, 2027) - 2h remaining - Max 0 leave days - Approved by You
```

---

### `/hr-help` - Command Reference (Role-Aware)

**Behavior:** `/hr-help` dynamically shows only the commands available to the caller's role. Since roles are inclusive (admin > manager > employee), higher roles see more sections.

**Implementation:**
```javascript
function handleHelp(caller) {
  var role = caller.role; // "employee", "manager", or "admin"
  var sections = [];

  // Everyone sees employee commands (all registered users are at least employees)
  sections.push(HELP_EMPLOYEE);

  // Manager+ sees manager commands (a manager is also an employee)
  if (role === "manager" || role === "admin") {
    sections.push(HELP_MANAGER);
  }

  // Admin sees admin commands (an admin is also a manager and employee)
  if (role === "admin") {
    sections.push(HELP_ADMIN);
  }

  return formatHelpResponse(sections);
}
```

**Response for EMPLOYEE (ephemeral):**
```
📖 Slack HR Bot — Your Commands
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🕐 Attendance & Leave (use in group channel):
  /in          Clock in
  /out         Clock out
  /break       Start a break
  /back        End break
  /request-leave 2026-04-02              Request leave (single day)
  /request-leave 2026-04-02 2026-04-05   Request leave (date range)

📊 Your Data (use anywhere, private):
  /hours                Current hours snapshot
  /hours 2026-03-15     Specific date detail
  /hours week           This week breakdown
  /hours month 2026-02  Monthly report
  /report               Submit daily report
  /report 2026-03-15    View a past report
  /report week          This week's reports
  /payroll              View your payroll
  /payroll 2026-02      Specific month payroll
  /balance              Leave balance + history
  /my-bank              Surplus hours bank
  /clock-status               Current clock state

📅 Team Leave Calendar (visible to all):
  /team-leave           Who's on leave today
  /team-leave week      Who's on leave this week
  /team-leave 2026-04   Monthly leave calendar

ℹ️ All personal data commands are private.
   Attendance commands post to the group channel.
```

**Response for MANAGER (ephemeral) — includes employee + manager sections:**
```
📖 Slack HR Bot — Your Commands
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🕐 Attendance & Leave (use in group channel):
  /in          Clock in
  /out         Clock out
  /break       Start a break
  /back        End break
  /request-leave 2026-04-02              Request leave (single day)
  /request-leave 2026-04-02 2026-04-05   Request leave (date range)

📊 Your Data (use anywhere, private):
  /hours                Current hours snapshot
  /hours 2026-03-15     Specific date detail
  /hours week           This week breakdown
  /hours month 2026-02  Monthly report
  /report               Submit daily report
  /report 2026-03-15    View a past report
  /report week          This week's reports
  /payroll              View your payroll
  /payroll 2026-02      Specific month payroll
  /balance              Leave balance + history
  /my-bank              Surplus hours bank
  /clock-status               Current clock state

📅 Team Leave Calendar (visible to all):
  /team-leave           Who's on leave today
  /team-leave week      Who's on leave this week
  /team-leave 2026-04   Monthly leave calendar

👤 Manager Commands (your direct reports):
  /team-hours         Team hours summary
  /team-flags         Pending shortfall flags
  /team-bank          Team surplus bank
  /team-reports       Team daily reports (daily/week/month)
  /team-payroll       Team payroll summary
  /salary-history     View/update salary history
  /report @employee   View employee's report
  /approve-surplus    Approve surplus banking
  /approve-absence    Pre-approve absence
  /adjust-quota       Redistribute hours

ℹ️ All personal data commands are private.
   Attendance commands post to the group channel.
```

**Response for ADMIN (ephemeral) — includes employee + manager + admin sections:**
```
📖 Slack HR Bot — Your Commands
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🕐 Attendance & Leave (use in group channel):
  /in          Clock in
  /out         Clock out
  /break       Start a break
  /back        End break
  /request-leave 2026-04-02              Request leave (single day)
  /request-leave 2026-04-02 2026-04-05   Request leave (date range)

📊 Your Data (use anywhere, private):
  /hours                Current hours snapshot
  /hours 2026-03-15     Specific date detail
  /hours week           This week breakdown
  /hours month 2026-02  Monthly report
  /report               Submit daily report
  /report 2026-03-15    View a past report
  /report week          This week's reports
  /payroll              View your payroll
  /payroll 2026-02      Specific month payroll
  /balance              Leave balance + history
  /my-bank              Surplus hours bank
  /clock-status               Current clock state

📅 Team Leave Calendar (visible to all):
  /team-leave           Who's on leave today
  /team-leave week      Who's on leave this week
  /team-leave 2026-04   Monthly leave calendar

👤 Manager Commands (your direct reports):
  /team-hours         Team hours summary
  /team-flags         Pending shortfall flags
  /team-bank          Team surplus bank
  /team-reports       Team daily reports (daily/week/month)
  /team-payroll       Team payroll summary
  /salary-history     View/update salary history
  /report @employee   View employee's report
  /approve-surplus    Approve surplus banking
  /approve-absence    Pre-approve absence
  /adjust-quota       Redistribute hours

🔧 Admin Commands (all employees):
  /onboard            Add new employee (opens form)
  /offboard @employee Deactivate employee
  /edit-employee @emp Edit employee details (opens form)

ℹ️ All personal data commands are private.
   Attendance commands post to the group channel.
```

---

---

### `/payroll` - View Your Payroll (Employee)

**Usage:**
```
/payroll              → this month (or last month if before 15th)
/payroll 2026-02      → specific month
```

**Response — `/payroll` (current/last month):**
```
💰 Your Payroll — February 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Effective Salary: NPR 400,000 (since Jan 2026)
Required Hours:   160h
─────────────────────────────
Worked Hours:    142h
Paid Leave:      2 days (+16h)
Credited Abs:    0h
Total Counted:   158h
─────────────────────────────
Deficit:         2h
Bank Offset:     0h (none approved)
Effective Deficit: 2h
─────────────────────────────
Hourly Rate:     NPR 2,500 (400,000 ÷ 160)
Deduction:       NPR 5,000 (2h × NPR 2,500)
Status:          DEDUCTED (approved by Sanjay)
─────────────────────────────
Final Salary:    NPR 395,000

Payment: Within 15 days of following month via Wise/bank transfer
```

**Response — `/payroll` (current month, not yet finalized):**
```
💰 Your Payroll — March 2026 (In Progress)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Effective Salary: NPR 400,000 (since Jan 2026)
Required Hours:   160h
─────────────────────────────
Worked So Far:   142h (3 days remaining)
Paid Leave:      1 day (+8h)
Projected Total: ~158h
─────────────────────────────
Projected Deficit: ~2h
⚠️ Month not finalized yet. Work 18h in 3 days to clear deficit.

Salary History:
  Current: NPR 400,000 (since Jan 2026)
  Previous: NPR 350,000 (Jul–Dec 2025)
```

**Rules:**
- **Salary is resolved per-month from SalaryHistory** via `getEffectiveSalary(userId, month)` — NOT from Employees.salary. This ensures past months use the salary that was active at that time.
- Before the 15th of a month, `/payroll` with no argument shows LAST month (since that's what's being paid out)
- After the 15th, shows current month (in-progress projection)
- Specific month always shows that month's data
- Only finalized months show actual deduction; in-progress months show projection
- Salary history snippet included showing current and previous salary

---

### `/team-payroll` - Team Payroll Summary (Manager)

**Usage:**
```
/team-payroll              → last finalized month
/team-payroll 2026-02      → specific month
```

**Response:**
```
💰 Team Payroll — February 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Name     | Salary    | Req  | Actual | Deficit | Deduction  | Final
─────────|───────────|──────|────────|─────────|────────────|──────────
Subash   | 400,000   | 160h | 158h   | 2h      | 5,000      | 395,000
Alex     | 350,000   | 160h | 120h   | 40h     | 87,500     | 262,500
John     | 300,000   | 160h | 170h   | 0h      | 0          | 300,000
Yuki     | 250,000   | 80h  | 82h    | 0h      | 0          | 250,000
─────────|───────────|──────|────────|─────────|────────────|──────────
Total    | 1,300,000 |      |        |         | 92,500     | 1,207,500

⚠️ Alex: 40h deficit — flag PENDING (awaiting your decision)
   [View Flag] to approve deduction or use bank offset

Pending Flags: 1
Finalized: 3/4 employees
```

**Rules:**
- Manager sees only their direct reports
- Admin sees all employees
- Pending flags are highlighted — payroll isn't final until all flags are resolved
- Shows total payroll outflow for the team

---

### `/salary-history` - View/Update Salary History (Manager/Admin)

**Usage:**
```
/salary-history @Alex                → view Alex's salary history
/salary-history @Alex set 450000     → open salary change form for Alex
```

**View response:**
```
📊 Salary History — Alex
━━━━━━━━━━━━━━━━━━━━━━━

Current: NPR 400,000/month (since Apr 2026)

History:
  Apr 2026:  NPR 400,000  ← REVIEW (6-month performance review)
  Oct 2025:  NPR 350,000  ← PROBATION_END (completed 3-month probation)
  Jul 2025:  NPR 300,000  ← INITIAL (onboarding)

Next review due: Oct 2026 (6 months from last review)
```

**Set response — `/salary-history @Alex set 450000`:**
```
💰 Salary Change — Alex
━━━━━━━━━━━━━━━━━━━━━━

Current Salary:  NPR 400,000
New Salary:      NPR 450,000
Change:          +NPR 50,000 (+12.5%)
Effective Date:  Apr 1, 2026

Change Type:
[📋 Performance Review] [🎯 Promotion] [🔧 Adjustment] [📝 Other]
```

Manager selects type → system:
1. Creates SalaryHistory row (old=400000, new=450000, type, reason)
2. Updates Employees.salary to 450000
3. Confirms:
```
✅ Salary updated for Alex
  NPR 400,000 → NPR 450,000
  Effective: Apr 1, 2026
  Type: Performance Review
  Recorded in salary history.
```

**Rules:**
- Only managers (of the employee) and admins can view/update salary history
- Employees see their own salary info only via `/payroll` (includes salary history snippet)
- Salary changes are always effective from the 1st of a month (no mid-month salary changes)
- SalaryHistory is append-only — corrections are done by adding a new ADJUSTMENT entry

---

### `/team-reports` - View Team Daily Reports (Manager) — Updated

**Usage:**
```
/team-reports              → today's reports for your team
/team-reports 2026-03-15   → specific date
/team-reports daily        → same as today (alias)
/team-reports week         → this week's submission summary
/team-reports week last    → last week's summary
/team-reports month        → this month's submission summary
/team-reports month 2026-02 → specific month's summary
```

**Response — `/team-reports` or `/team-reports daily` (today):**
```
📝 Team Reports — March 28, 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Subash (09:30):
   Yesterday: Fixed login bug (JIRA-123), reviewed PR #42
   Today: Working on payment API (JIRA-456)
   Blockers: None

✅ Alex (10:15):
   Yesterday: Dashboard UI (JIRA-450)
   Today: API integration (JIRA-451)
   Blockers: Waiting for design specs

❌ John: Not submitted
❌ Yuki: Not submitted

Submitted: 2/4 (50%)
```

**Response — `/team-reports week`:**
```
📝 Team Report Summary — Week of Mar 23–28
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Subash:  ✅✅✅✅✅  5/5 (100%)
Alex:    ✅✅❌✅✅  4/5 (80%)
John:    ✅❌❌✅✅  3/5 (60%)
Yuki:    ✅✅✅✅❌  4/5 (80%)

Team average: 80% submission rate
```

**Response — `/team-reports month 2026-02`:**
```
📝 Team Report Summary — February 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Subash:  20/20 days (100%) ⭐
Alex:    18/20 days (90%)
John:    14/20 days (70%) ⚠️
Yuki:    19/20 days (95%)

Missing reports:
  John: Feb 5, Feb 11, Feb 12, Feb 18, Feb 19, Feb 25
  Alex: Feb 7, Feb 21

Team average: 89% submission rate
```

---

### `/onboard` - Add New Employee (Admin)

**Usage:**
```
/onboard
```

**Modal Implementation:**

Slack Free plan supports modals via `views.open`. The slash command payload includes `trigger_id` which is required to open a modal. The modal must be opened within 3 seconds of receiving the trigger_id.

```javascript
// In doPost(), for /onboard:
// 1. Use trigger_id to open modal immediately (NOT via response_url)
// 2. Modal submission comes back as a view_submission interaction payload
function handleOnboardTrigger(trigger_id) {
  var modal = {
    trigger_id: trigger_id,
    view: {
      type: "modal",
      callback_id: "onboard_modal",
      title: { type: "plain_text", text: "Onboard Employee" },
      submit: { type: "plain_text", text: "Onboard" },
      blocks: [/* see fields below */]
    }
  };
  UrlFetchApp.fetch("https://slack.com/api/views.open", {
    method: "post",
    contentType: "application/json",
    headers: { "Authorization": "Bearer " + BOT_TOKEN },
    payload: JSON.stringify(modal)
  });
}
```

**Modal Fields:**
1. Name — `plain_text_input` (required)
2. Email — `email_text_input` (required)
3. Slack User — `users_select` (required, auto-resolves Slack ID)
4. Group — `static_select` with options: Full-Time Contract Developer / Contract Intern (required)
5. Monthly Salary NPR — `number_input` (required, min 1)
6. Join Date — `datepicker` (required, default: today)
7. Manager — `users_select` (required, validated against active employees)
8. Leave Accrual Start — `number_input` (months after join, default: 3)
9. Leave Accrual Rate — `number_input` (days/month, default: 1)
10. Max Leave Cap — `number_input` (default: 20)

**Flow:**
1. Admin types `/onboard`
2. Bot opens modal (via `views.open` + `trigger_id`)
3. Admin fills fields and submits
4. Apps Script receives `view_submission` interaction payload
5. System:
   - Validates all fields (see below)
   - Creates Employees row (auto-generates user_id: EMP + next number)
   - Creates SalaryHistory row (change_type=INITIAL, old_salary=0, new_salary=entered)
   - Sends welcome DM to the new employee via Slack
6. Responds via `response_action` or posts to admin DM:
```
✅ Employee onboarded: Taro Tanaka (EMP015)
  Group: Full-Time Contract Developer
  Salary: NPR 350,000
  Manager: Subash (EMP001)
  Join Date: Apr 1, 2026
  Leave accrual starts: Jul 2026
  Welcome DM sent.
```

**Validation:**
- Slack ID must not already exist in Employees tab
- Email must not already exist
- Salary must be > 0
- Join date cannot be in the past (unless admin override)
- Manager must be an active employee with manager or admin role

---

### `/offboard` - Deactivate Employee (Admin)

**Usage:**
```
/offboard @Alex
/offboard EMP003
```

**Flow:**
1. Admin types `/offboard @Alex`
2. Bot shows confirmation with final settlement preview:
```
⚠️ Offboard Alex (EMP003)?

Current month: March 2026 (28 days elapsed / 31 total)
Effective salary: NPR 400,000
Pro-rata required: 160h × 28/31 = 144.5h
Hours worked so far: 130h
Projected deficit: 14.5h
Projected deduction: NPR 36,250 (14.5h × NPR 2,500, rounded up)
Pro-rata salary: NPR 361,290
Projected settlement: NPR 325,040

Unused paid leave: 3 days → FORFEITED (no encashment)
Active quota plans: None

[✅ Confirm Offboard] [❌ Cancel]
```
3. Admin confirms
4. System:
   - Sets Employees.status = INACTIVE
   - Cancels any active QuotaPlans (status → CANCELLED)
   - Generates final MonthlySummary row for the termination month
   - Posts to #hr-alerts: "Alex (EMP003) has been offboarded. Final settlement pending."
5. Bot rejects future commands from this user: "Your account is inactive. Contact admin."

---

### `/edit-employee` - Edit Employee Details (Admin)

**Usage:**
```
/edit-employee @Alex
/edit-employee EMP003
```

**Modal Implementation:**

Uses the same `trigger_id` → `views.open` pattern as `/onboard`. The modal is pre-populated with the employee's current data.

```javascript
function handleEditEmployeeTrigger(trigger_id, user_id, target_employee) {
  // 1. Look up current employee data from Employees tab
  // 2. Pre-populate modal fields with current values
  // 3. Include employee's user_id in private_metadata for the submission handler
  var modal = {
    trigger_id: trigger_id,
    view: {
      type: "modal",
      callback_id: "edit_employee_modal",
      private_metadata: JSON.stringify({ employee_id: target_employee.user_id }),
      title: { type: "plain_text", text: "Edit Employee" },
      submit: { type: "plain_text", text: "Save Changes" },
      blocks: [/* pre-populated fields */]
    }
  };
  UrlFetchApp.fetch("https://slack.com/api/views.open", { /* same as onboard */ });
}
```

**Modal Fields (all pre-populated with current values):**
1. Name — `plain_text_input`
2. Email — `email_text_input`
3. Group — `static_select` (Full-Time Contract Developer / Contract Intern)
4. Manager — `users_select`
5. Join Date — `datepicker`
6. Leave Accrual Start — `number_input` (months after join)
7. Leave Accrual Rate — `number_input` (days/month)
8. Max Leave Cap — `number_input`
9. Status — `static_select` (ACTIVE / INACTIVE) — allows reactivating offboarded employees

**Not editable via this modal (use dedicated commands instead):**
- Salary → use `/salary-history @Alex set <amount>` (creates proper SalaryHistory audit trail)
- Slack User ID → cannot change (system identifier)
- Employee ID (EMP###) → cannot change (auto-generated)

**Flow:**
1. Admin types `/edit-employee @Alex`
2. Bot resolves employee (by @mention, email, or EMP-id)
3. Bot opens pre-populated modal (via `views.open` + `trigger_id`)
4. Admin modifies fields and submits
5. System:
   - Validates changes (same rules as onboard)
   - Updates Employees row
   - If position changed: logs to #hr-alerts, recalculates hours requirements going forward (via new position → policy group → Policies)
   - If status changed to INACTIVE: triggers same offboard logic (settlement calc, quota cancellation)
   - If status changed to ACTIVE (reactivation): requires admin confirmation, resets leave balance
6. Responds:
```
✅ Employee updated: Alex (EMP003)
  Changed:
  • Position: Contract Intern → Full Time Developer
  • Manager: Subash (EMP001) → Sanjay (EMP000)
  No other fields changed.
```

**Validation:**
- Only admin or CEO can use this command
- Target employee must exist
- If changing position, warn about hours requirement change (if new position maps to a different policy group)
- If reactivating, must set new join date and salary (creates new SalaryHistory entry)

**Edge Cases:**
- Editing an INACTIVE employee: allowed (e.g., to correct records), but cannot change status to ACTIVE without full reactivation flow
- Changing position mid-month: new hours requirements apply from the first of the NEXT month (current month keeps old requirements)
- Changing manager: immediate effect, no recalculation needed

---

### Modals — General Implementation Notes

All modals in this bot (`/onboard`, `/edit-employee`, `/report`) follow the same pattern:

1. **Opening:** Slash command provides `trigger_id` in `e.parameter.trigger_id`. Call `views.open` within 3 seconds.
2. **Submission:** Slack sends a `view_submission` interaction payload to the same Web App URL. Parse `e.parameter.payload` (JSON) to get `view.callback_id` and `view.state.values`.
3. **doPost routing:** Check for `e.parameter.payload` first — if present, it's an interaction (modal submit or button click), not a slash command. Route by `callback_id`:
   ```javascript
   function doPost(e) {
     // Check if this is an interaction payload (modal/button)
     if (e.parameter.payload) {
       var payload = JSON.parse(e.parameter.payload);
       if (payload.type === "view_submission") {
         return handleModalSubmission(payload);
       }
       if (payload.type === "block_actions") {
         return handleButtonAction(payload);
       }
     }
     // Otherwise, it's a slash command — use acknowledge-first pattern
     // ...existing doPost logic...
   }

   function handleModalSubmission(payload) {
     var callback_id = payload.view.callback_id;
     var values = payload.view.state.values;
     var user_id = payload.user.id;
     switch(callback_id) {
       case "onboard_modal":        return processOnboard(user_id, values);
       case "edit_employee_modal":  return processEditEmployee(user_id, values, payload.view.private_metadata);
       case "report_modal":         return processReport(user_id, values);
       default: return { response_action: "errors", errors: { general: "Unknown form" } };
     }
   }
   ```
4. **Validation errors:** Return `{ response_action: "errors", errors: { block_id: "Error message" } }` to show inline errors without closing the modal.
5. **Success:** Return `{ response_action: "clear" }` to close the modal, then post confirmation via `chat.postMessage` to the admin's DM.

---

## Slack Channels

| Channel | Purpose | Who posts |
|---------|---------|-----------|
| `#attendance` | Optional: daily clock in/out log | Bot (auto) |
| `#daily-reports` | Daily standup summaries | Bot (from /report) |
| `#hr-flags` | Hour shortfall notifications | Bot (auto) |
| `#leave-requests` | Leave request notifications | Bot (auto) |

---

## Apps Script Webhook Routing

All slash commands point to the same Apps Script Web App URL.

**Every command uses the acknowledge-first pattern:** doPost() immediately returns a "⏳ Processing..." acknowledgment (< 100ms), then processes the command and sends the real response back via `response_url`. This avoids Slack's 3-second timeout for all commands — even simple ones like `/in` — protecting against cold starts, LockService waits, and slow Sheets reads.

```javascript
function doPost(e) {
  // --- Step 0: Verify request is from Slack (HMAC-SHA256) ---
  verifySlackRequest(e);  // throws if invalid — see auth.gs

  // --- Handle interaction payloads (modal submissions, button clicks) ---
  if (e.parameter.payload) {
    var payload = JSON.parse(e.parameter.payload);
    if (payload.type === "view_submission") {
      return handleModalSubmission(payload);
    }
    if (payload.type === "block_actions") {
      // Button callbacks (leave approve/deny, offboard confirm, flag resolve)
      handleButtonAction(payload);
      return ContentService.createTextOutput("");
    }
  }

  // --- Handle slash commands (acknowledge-first pattern) ---
  var command = e.parameter.command;
  var user_id = e.parameter.user_id;
  var user_name = e.parameter.user_name;
  var text = e.parameter.text;
  var trigger_id = e.parameter.trigger_id;
  var response_url = e.parameter.response_url;

  // Commands that open modals must do so immediately (within 3s) using trigger_id
  // These do NOT use the acknowledge-first pattern — they return empty ack and open modal
  var modalCommands = ["/onboard", "/edit-employee"];
  if (modalCommands.indexOf(command) > -1) {
    try {
      routeModalCommand(command, user_id, text, trigger_id);
    } catch (err) {
      sendToResponseUrl(response_url, { text: "❌ Error: " + err.message });
    }
    return ContentService.createTextOutput("");
  }

  // All other commands: acknowledge immediately, then process via response_url
  var ack = ContentService.createTextOutput(
    JSON.stringify({ response_type: "ephemeral", text: "⏳ Processing..." })
  ).setMimeType(ContentService.MimeType.JSON);

  try {
    var result = routeCommand(command, user_id, user_name, text);
    sendToResponseUrl(response_url, result);
  } catch (err) {
    sendToResponseUrl(response_url, { text: "❌ Error: " + err.message });
  }

  return ack;
}

// Sends the actual response back to Slack via response_url
function sendToResponseUrl(url, payload) {
  UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  });
}

// Routes to the correct handler
// EVERY handler receives the caller object from requireRole() which includes
// { user_id, slack_id, name, role, manager_id, is_admin, status }
function routeCommand(command, user_id, user_name, text) {
  // Step 1: Identify caller (throws if unregistered or inactive)
  var caller = getRole(user_id);  // user_id here is Slack's user_id (UXXXXXXXXX)

  switch(command) {
    // Employee commands — group channel (response_type: "in_channel")
    // Min role: employee (any registered user)
    case "/in":      return handleClockIn(caller, user_name);
    case "/out":     return handleClockOut(caller, user_name);
    case "/break":   return handleBreakStart(caller, user_name);
    case "/back":    return handleBreakEnd(caller, user_name);

    // Employee commands — personal (response_type: "ephemeral")
    // Min role: employee (any registered user)
    case "/request-leave":   return handleLeaveRequest(caller, user_name, text);
    case "/report":  return handleReport(caller, user_name, text);  // Note: /report @employee requires manager check inside handler
    case "/hours":   return handleViewHours(caller, text);
    case "/balance": return handleViewBalance(caller);
    case "/clock-status":  return handleStatus(caller);
    case "/payroll": return handlePayroll(caller, text);
    case "/hr-help":    return handleHelp(caller);  // Role-aware: shows commands based on caller.role
    case "/my-bank": return handleMyBank(caller);
    case "/team-leave": return handleTeamLeave(caller, text);  // All employees — leave types shown only to manager+

    // Manager commands — personal (response_type: "ephemeral")
    // Min role: manager (requireRole checks inside each handler)
    case "/team-hours":       requireRole(caller, "manager"); return handleTeamHours(caller);
    case "/team-flags":       requireRole(caller, "manager"); return handleTeamFlags(caller);
    case "/team-bank":        requireRole(caller, "manager"); return handleTeamBank(caller);
    case "/team-reports":     requireRole(caller, "manager"); return handleTeamReports(caller, text);
    case "/team-payroll":     requireRole(caller, "manager"); return handleTeamPayroll(caller, text);
    case "/salary-history":   requireRole(caller, "manager"); return handleSalaryHistory(caller, text);
    case "/approve-absence":  requireRole(caller, "manager"); return handleApproveAbsence(caller, text);
    case "/adjust-quota":     requireRole(caller, "manager"); return handleAdjustQuota(caller, text);
    case "/approve-surplus":  requireRole(caller, "manager"); return handleApproveSurplus(caller, text);

    // Admin commands — personal (response_type: "ephemeral")
    // Note: /onboard and /edit-employee are modal commands routed via routeModalCommand()
    case "/offboard":         requireRole(caller, "admin"); return handleOffboard(caller, text);

    default: return { response_type: "ephemeral", text: "❓ Unknown command. Try /hr-help" };
  }
}

// Routes commands that open modals (called with trigger_id, not response_url)
function routeModalCommand(command, user_id, text, trigger_id) {
  var caller = getRole(user_id);  // identify + check active
  switch(command) {
    case "/onboard":        requireRole(caller, "admin"); return handleOnboardTrigger(trigger_id, caller);
    case "/edit-employee":  requireRole(caller, "admin"); return handleEditEmployeeTrigger(trigger_id, caller, text);
    default: throw new Error("Unknown modal command: " + command);
  }
}
```

**Note on response_type:** Each handler returns an object with `response_type` set appropriately. Group commands (`/in`, `/out`, `/break`, `/back`) use `"in_channel"` so the team sees the action. All other commands use `"ephemeral"` so only the user sees the response. The `sendToResponseUrl()` function respects whatever `response_type` the handler returns.

---

## Interactive Messages (Button Callbacks)

For leave approvals and flag resolutions, use Slack interactive messages.
Apps Script handles the button callback via a separate endpoint or the same doPost with action payload parsing.

**Payload structure (from Slack button click):**
```json
{
  "type": "interactive_message",
  "actions": [{"name": "leave_approve", "value": "PAID|LV-2026-001"}],
  "user": {"id": "U_MANAGER_ID"},
  "original_message": {...}
}
```
