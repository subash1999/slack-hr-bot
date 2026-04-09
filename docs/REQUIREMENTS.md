# Slack HR Bot - Complete Requirements Specification

## 1. System Overview

**Project Name:** Slack HR Bot
**Purpose:** A 100% free, Slack-based employee management system for a 10-15 member team.

### What it does:
- Attendance tracking (clock in/out with multiple breaks)
- Leave management (paid/unpaid with manager approval workflow)
- Daily standup reports (natural language, linked to JIRA tickets & GitHub PRs)
- Work hours tracking with daily/weekly/monthly minimum enforcement
- Salary/payroll calculation based on hours deficit
- Employee onboarding & configuration
- Manager-level flags and approvals for hour shortfalls

### Architecture:
```
Slack (slash commands + bot)
        ↓
Google Apps Script (webhook backend, deployed as Web App)
        ↓
Google Sheets (event log database + formulas + reports)
```

### Key Constraint: 100% Free Stack
- Slack Free Plan (slash commands + bot)
- Google Apps Script (free serverless backend)
- Google Sheets (free database + calculation engine)
- No Notion, no n8n cloud, no paid tools

---

## 2. User Roles

Role is determined from the Employees sheet: `is_admin=TRUE` or CEO → admin; has direct reports → manager; otherwise → employee. A user can be both manager and admin.

### 2.1 Employee (any registered active user)
- Clock in/out, start/end breaks via Slack (`/in`, `/out`, `/break`, `/back`)
- Submit daily reports via `/report`
- Request leave via `/request-leave` (part of attendance & leave)
- View own data: `/hours`, `/balance`, `/clock-status`, `/my-bank`, `/payroll`
- View team leave calendar: `/team-leave` (see who's on leave — visible to ALL employees, not just managers)
- Cannot see other employees' personal data (hours, salary, etc.)

### 2.2 Manager (has direct reports)
- Everything an employee can do, plus:
- Approve/reject leave requests (paid/unpaid/shift) for direct reports
- Approve/reject hour shortfall flags for direct reports
- View team data: `/team-hours`, `/team-flags`, `/team-bank`, `/team-reports`, `/team-payroll`
- View specific employee's reports: `/report @employee`
- Manage surplus/absence/quota: `/approve-surplus`, `/approve-absence`, `/adjust-quota`
- View/update salary history: `/salary-history @employee`
- Scope: can ONLY see/act on employees where `Employees.manager_id = this manager's user_id`

### 2.3 Admin (is_admin=TRUE or CEO)
- Everything a manager can do, plus:
- Scope: can see/act on ALL employees (not limited to direct reports)
- Onboard employees: `/onboard` (opens Slack modal form)
- Offboard employees: `/offboard @employee` (interactive settlement)
- Edit employee details: `/edit-employee @employee` (opens Slack modal form)
- Update salary: `/salary-history @employee set <amount>`
- Configure positions & policy groups via Google Sheets (Positions tab + Policies tab)
- View payroll reports & export data

---

## 3. Core Features

### 3.1 Attendance Tracking (Event-Based Model)

**Electronic Attendance Tracking:**
Attendance is tracked electronically. Slack is the current medium for submitting attendance data (clock in/out), but this may change in the future to other electronic systems.

**Commands:**
| Command | Action | Event Logged |
|---------|--------|-------------|
| `/in` | Clock in | `IN` |
| `/out` | Clock out | `OUT` |
| `/break` | Start break | `BREAK_START` |
| `/back` | End break | `BREAK_END` |
| `/clock-status` | Show current state | (no event) |

**Event Log Format (Google Sheet: Events tab):**
```
timestamp | user_id | user_name | action
```

**Example:**
```
2026-03-28 09:00 | U123 | Subash | IN
2026-03-28 11:00 | U123 | Subash | BREAK_START
2026-03-28 11:15 | U123 | Subash | BREAK_END
2026-03-28 13:00 | U123 | Subash | BREAK_START
2026-03-28 13:30 | U123 | Subash | BREAK_END
2026-03-28 18:00 | U123 | Subash | OUT
```

**Supports:**
- Multiple breaks per day
- Multiple sessions (IN/OUT multiple times)
- Corrections by admin in sheet

**Edge Cases:**
- Double `/in` → ignore or log anyway (admin fixes later)
- Missing `/out` → flag as incomplete session
- `/break` without `/in` → ignore with error message
- Late check-in → allowed (no restriction)

**Hours Calculation:**
```
work_time = SUM(OUT - IN)
break_time = SUM(BREAK_END - BREAK_START)
total_hours = work_time - break_time
```

---

### 3.2 Leave Management

**Command:**
```
/request-leave YYYY-MM-DD
/request-leave YYYY-MM-DD YYYY-MM-DD   (multi-day)
```

**Leave Types:**
| Type | Status | Hours Credited | Balance Impact |
|------|--------|---------------|----------------|
| Paid Leave | Absent | 8 hours/day | Deduct 1 day |
| Unpaid Leave | Absent | 0 hours | No deduction |
| Shift Permission | Present | 0 hours (initially) | No deduction |

**Approval Workflow:**

**Case A: Paid leave balance > 0**
→ Manager options: `[Approve Paid]` `[Approve Unpaid]` `[Reject]`

**Case B: Paid leave balance = 0**
→ Manager options: `[Shift Permission]` `[Approve Unpaid]` `[Reject]`

**Case C: Manager force override**
→ Manager can convert any request to: Paid / Unpaid / Shift

**No-response fallback:**
- If manager doesn't respond in 24h → bot sends reminder
- If still no action → keep pending (do NOT auto-decide)
- Optional: escalate to admin

**Rules:**
- No negative leave balance (force unpaid or shift instead)
- Paid leave always = 8 hours credited
- Multi-day leave → apply logic per day
- Shift permission ≠ leave (no deduction, 0 hours until compensated)

---

### 3.3 Daily Standup Report

**Command:** `/report`
**Triggered:** Separate from `/in` (independent command)

**Report Format (prompted by bot):**
```
What did you do yesterday?
> Fixed login bug (JIRA-123), reviewed PR #42

What will you do today?
> Working on payment API (JIRA-456), will create PR for auth module

Any blockers?
> Waiting for design approval on dashboard layout
```

**Storage:** Google Sheet "DailyReports" tab
```
date | user_id | user_name | yesterday | today | blockers | submitted_at
```

**Rules:**
- Employees should submit daily (tracked, not enforced initially)
- Reports stored for later cross-verification with JIRA/GitHub (Phase 2)
- Admin can view all reports; employees see only their own
- Reports in natural language — mention JIRA ticket IDs and GitHub PR numbers

**Phase 2 (Future):**
- Auto-fetch JIRA tasks assigned to user
- Auto-fetch GitHub commits/PRs by user
- Compare daily report claims vs actual JIRA/GitHub activity
- Flag discrepancies for manager review

---

### 3.4 Positions & Policy Groups

**Two separate sheets work together:**

1. **Positions tab** (lookup table) — lists all job titles, each mapped to a policy group
2. **Policies tab** — defines hour minimums per policy group

**Google Sheet: Positions tab**
```
position | policy_group | description
```

**Available Positions:**
```
CEO                          | Full-Time | Chief Executive Officer
CTO                          | Full-Time | Chief Technology Officer
Team Lead                    | Full-Time | Team Lead
Full Time Contract Developer | Full-Time | Full-time contract developer
Full Time Developer          | Full-Time | Full-time developer
Contract Intern              | Intern    | Contract intern
Intern                       | Intern    | Intern
```

**Google Sheet: Policies tab**
```
policy_group | min_daily_hours | min_weekly_hours | min_monthly_hours
```

**Policy Groups:**
```
Full-Time | 4  | 30  | 160
Intern    | 4  | 15  | 80
```

**Hour requirement resolution:** `Employees.position` → `Positions.policy_group` → `Policies.min_*_hours`

**Rules:**
- Each employee has exactly one position (FK to Positions tab)
- Position maps to a policy group which defines DEFAULT hour minimums
- Multiple positions can share the same policy group (e.g., CEO, CTO, Team Lead all use Full-Time)
- Individual overrides possible (see 3.5)
- Admin can add new positions directly in the Positions sheet; add new policy groups in Policies sheet first if needed

---

### 3.5 Minimum Hours Enforcement (3-Level System)

**All three levels are tracked and enforced:**

#### Daily Minimum
```
IF worked_hours < group.min_daily_hours AND NOT (paid_leave OR approved_absence):
    flag = DAILY_SHORTFALL
    shortfall_hours = min_daily_hours - worked_hours
```

#### Weekly Minimum
```
IF week_hours < group.min_weekly_hours:
    flag = WEEKLY_SHORTFALL
    shortfall_hours = min_weekly_hours - week_hours
```

#### Monthly Minimum
```
IF month_hours < group.min_monthly_hours:
    flag = MONTHLY_SHORTFALL
    shortfall_hours = min_monthly_hours - month_hours
```

**Flag Workflow:**
1. System auto-detects shortfall at end of period (daily/weekly/monthly)
2. Flags are posted to `#hr-flags` channel or DM to manager
3. Manager reviews flag and decides:
   - `[Approve - No Penalty]` → Employee had valid reason (discussed with manager)
   - `[Approve - Deduct]` → Apply salary deduction for shortfall
   - `[Pending]` → Discuss with employee first
4. Only MANAGER-APPROVED flags result in salary deduction

**Anti-Double-Penalty Rule:**
- If daily shortfall is already accounted in weekly, don't double-count
- Monthly is the PRIMARY deduction metric
- Daily/weekly are early warnings + flags
- Final salary deduction = based on monthly deficit ONLY (after manager approval)

**Employee Self-Service Views:**

Employees can query their own data for any date, week, or month. All data is scoped to the calling user — they can only see their own records.

```
/hours                    → current snapshot (today + this week + this month + warnings)
/hours 2026-03-15         → specific date (sessions, breaks, net hours)
/hours week               → this week (day-by-day breakdown with daily min check)
/hours week last          → last week
/hours month              → this month (weekly breakdown + daily detail + deficit/surplus)
/hours month 2026-02      → specific month (full report with deduction status)

/report                   → submit today's report (opens modal)
/report 2026-03-15        → view your report for a specific date
/report week              → view submission status for this week
/report month 2026-02     → all reports for a month with submission rate

/balance                  → leave balance + recent leave history + surplus leave available
/my-bank                  → surplus bank entries with expiry dates and warnings
/clock-status                   → current clock state (working/break/not clocked in)
```

**Automatic warnings in responses:**
- Daily shortfall: ⚠️ when below 4h daily min
- Weekly shortfall: ⚠️ when below 30h weekly min
- Monthly pace warning: "You need Xh in Y remaining days" when behind pace
- Bank expiry warning: shown when entries expire within 30 days
- Deficit status: PENDING / DEDUCTED / OFFSET BY BANK / NO PENALTY

**Example — `/hours` (current snapshot):**
```
📊 Your Hours — March 28, 2026
Today:      2.5h / 4h min   ⚠️ -1.5h (still working)
This Week:  18h / 30h min   ⚠️ -12h (2 days left)
This Month: 142h / 160h min ⚠️ -18h (3 days left)
Leave: 2 days (16h credited) | Bank: 12h available
⚠️ You need 18h in 3 remaining days to avoid deficit.
```

**Access Control:**
- Employee commands: scoped to own data via slack_id → Employees lookup
- Manager commands: scoped to their direct reports (manager_id match)
- Admin commands: full access (is_admin flag or hardcoded admin list)

---

### 3.6 Individual Monthly Overrides

**Google Sheet: Overrides tab**
```
user_id | year_month | required_hours | reason
```

**Resolution Logic:**
```
IF override exists for user+month:
    use override_hours
ELSE:
    use group.min_monthly_hours
```

**Example:**
```
Subash | 2026-04 | 140 | Approved reduced hours (personal reason)
```

---

### 3.6b Hours Banking & Carry-Forward System

**Problem:** An employee works 200h in March (40h surplus) but only 120h in April (40h deficit). If both months have a 160h requirement, the system would flag April as a shortfall. But the employee already compensated in March. We need a way to handle this fairly.

**Solution: Hours Banking with Manager Approval**

#### Important: Manager Pre-Approval Required
**Surplus hours WITHOUT prior manager approval are NOT eligible for carry-forward, transfer to next month, additional payment, or any compensation. Only manager-approved surplus hours can be banked or taken as leave. Surplus hours are NEVER cashable under any circumstances.**

#### Manager Pre-Approval with Max Leave Days Convertible
**When manager approves surplus banking, they specify both:**
- **(a)** Hours to bank
- **(b)** Maximum leave days convertible from those hours (e.g., "40h surplus, can convert up to 5 leave days")

This is decided at approval time. No separate leave conversion approval is needed later — the max_leave_days field locks in the maximum the employee can use.

#### How It Works

1. **Surplus hours are tracked automatically (but NOT cashable and require manager approval)**
   - At end of each month, if actual_hours > required_hours → surplus is recorded
   - Surplus does NOT auto-carry and is NOT cashable (employee cannot receive payment for excess hours)
   - Surplus requires MANAGER APPROVAL to be eligible for banking or leave conversion
   - Unapproved surplus hours cannot be used to offset future deficits
   - Surplus can ONLY be taken as leave within 12 months with manager permission
   - Surplus sits in a "bank" awaiting manager approval and potential conversion to leave or use as offset

2. **Deficit triggers normal flag workflow**
   - At end of April, deficit of 40h is flagged as usual

3. **Manager can approve "Use Banked Hours"**
   - When reviewing a monthly shortfall flag, manager sees:
   ```
   🚩 Monthly Shortfall: Alex
   April 2026: 120h / 160h (-40h deficit)

   Banked surplus available:
     March 2026: +40h surplus

   [✅ Use Bank (offset -40h)] [⚠️ Partial Bank] [💰 Deduct] [❌ No Penalty]
   ```
   - **Use Bank**: Apply 40h from March surplus → April deficit becomes 0
   - **Partial Bank**: Apply part of surplus (e.g., 20h) → remaining 20h deficit
   - **Deduct**: Ignore bank, deduct full 40h from salary
   - **No Penalty**: Forgive entirely

4. **Banked hours expire** (configurable, default: 12 months)
   - Surplus hours must be converted to leave or used as offset within 12 months of accrual
   - After 12 months, unused surplus hours are forfeited
   - No weekly surplus tracking; only daily and monthly carry-forward are tracked
   - When manager approves surplus banking, they also specify max leave days convertible from those hours

#### The Same Logic Applies at Daily and Weekly Levels

**Daily carry-forward:**
- Employee works 2h on Monday (daily min: 4h → -2h shortfall)
- Works 8h on Tuesday (+5h surplus)
- Manager can approve: "Monday's shortfall offset by Tuesday's surplus"
- The daily flag for Monday gets resolved as `OFFSET_BY_SURPLUS`

**Weekly carry-forward:**
- Week 1: 30h (min 40h → -10h)
- Week 2: 50h (+10h surplus)
- Manager can approve weekly offset

#### Data Model Addition

**Google Sheet: HoursBank tab**
```
user_id | period_type | period_value | required | actual | surplus | used | remaining | approved_by | max_leave_days | expires_at
```

**Example:**
```
EMP001 | MONTHLY | 2026-03 | 160 | 200 | 40 | 0  | 40 | EMP000 | 5 | 2027-03-31
EMP001 | MONTHLY | 2026-04 | 160 | 120 | 0  | 40 | 0  | EMP000 | - | -
EMP001 | DAILY   | 2026-03-25 | 8 | 12 | 4  | 4  | 0  | EMP000 | 0 | 2026-04-25
```

#### Deficit and Surplus Interaction Rules

**Four core rules for handling deficit/surplus interactions across months:**

1. **Surplus first → Deficit later (OFFSET POSSIBLE):** If contractor has manager-approved banked surplus from a previous month, those hours can offset a deficit in a later month (reducing/eliminating salary deduction). Requires manager approval at flag resolution.

2. **Deficit first → Surplus later (NO RETROACTIVE REVERSAL):** If a deficit causes a salary deduction in Month 1, that deduction is FINAL. Surplus in Month 2 cannot retroactively reverse or compensate for the Month 1 deduction.

3. **Prevention via Quota Redistribution:** If contractor knows in advance they'll work less one month and more the next, they should request quota redistribution BEFORE the period starts (e.g., manager pre-adjusts April to 140h and May to 180h, total unchanged at 320h). This prevents deficits and deductions entirely.

   **Quota Redistribution and Salary:** When a manager approves quota redistribution (e.g., April = 140h, May = 180h), the total hours across the period remain unchanged (140 + 180 = 320 = 160 + 160). The monthly salary remains THE SAME for both months regardless of the redistributed hours. The contractor receives the same salary in the light month (140h) as in the heavy month (180h), because quota redistribution is a schedule adjustment — not additional work. No extra compensation is payable for months where the redistributed requirement exceeds the standard monthly minimum. *Example:* Standard: April 160h + May 160h = 320h total, salary NPR X each month. Redistributed: April 140h + May 180h = 320h total, salary NPR X each month (SAME). Contractor works 180h in May but gets same salary as April's 140h — this is by design.

4. **Unapproved surplus = no offset:** Surplus without manager pre-approval for banking is not eligible for any offset.

**Key constraint:** Monthly fee is the maximum. Surplus hours never result in additional payment beyond the agreed service fee.

**Examples:**

- *Surplus first → offset:* March 200h (req 160h) = 40h banked. April 120h (req 160h) = 40h deficit. Manager approves offset → no deduction.
- *Deficit first → no retroactive fix:* April 120h (req 160h) → deduction approved. May 180h (req 160h) = 20h surplus. May surplus cannot undo April deduction.
- *Proactive redistribution:* Contractor says "April light, May heavy." Manager sets April=140h, May=180h (total 320h = 2×160h). Both months hit targets; no flags.

#### Termination During Active Quota Redistribution

When termination occurs while a quota redistribution plan is active:
1. Final settlement is calculated using STANDARD hours requirement (not redistributed) for the entire plan period up to termination date
2. If contractor benefited from reduced hours in a prior month but hasn't fulfilled increased hours in the subsequent month, the net shortfall is calculated across the entire plan period
3. Net shortfall is deducted from final settlement at the hourly rate
4. Company pays: final settlement minus (shortfall × hourly_rate). No further claims by either party
5. Example: Plan = April 140h + May 180h. Contractor works 140h April (full salary). Terminates May 10th with 40h worked. Standard for that period = 160h + ~53h (pro-rata) = 213h. Actual = 180h. Shortfall = 33h. Deduction = 33h × hourly_rate from final May payment.

---

### 3.6c Manager-Approved Quota Redistribution

**Problem:** Employee discusses with manager BEFORE the month: "I can only work 140h in April, but I'll do 180h in May." Manager agrees. We need to pre-set adjusted quotas for both months as a linked pair.

**Solution: Linked Quota Adjustments**

#### How It Works

1. **Employee discusses with manager** (in Slack or in person)
2. **Manager creates a redistribution plan:**
   ```
   /adjust-quota @Alex monthly
   ```
   Bot shows form:
   ```
   Quota Redistribution Plan
   Employee: Alex
   Group default: 160h/month

   April 2026: [140] hours (reason: personal commitment)
   May 2026:   [180] hours (compensation month)

   Total across period: 320h (same as 2× 160h) ✅
   [Submit Plan]
   ```

3. **System creates linked overrides:**
   - Override: Alex, April = 140h (linked to plan #QRP-001)
   - Override: Alex, May = 180h (linked to plan #QRP-001)
   - Both reference the same plan ID so they're traceable

4. **During April:** Alex's required = 140h (not 160h). No flag if Alex hits 140h.
5. **During May:** Alex's required = 180h. Flag only if Alex falls below 180h.

#### Same for Daily and Weekly

**Daily redistribution:**
```
/adjust-quota @Alex daily 2026-04-07
```
```
Mon Apr 7:  [3h]  (doctor appointment morning)
Tue Apr 8:  [11h] (make up hours)
Wed Apr 9:  [8h]  (normal)
...
Week total: 40h ✅
```

**Weekly redistribution:**
```
/adjust-quota @Alex weekly 2026-04
```
```
Week 1 (Apr 1-7):   [30h] (conference week)
Week 2 (Apr 8-14):  [50h] (crunch week)
Week 3 (Apr 15-21): [40h]
Week 4 (Apr 22-28): [40h]
Month total: 160h ✅
```

#### Rules
- Total hours across the redistribution period SHOULD equal original total (but manager can override)
- If total is less than original → manager explicitly acknowledges the reduction
- Plans are linked and auditable (plan ID tracks the pair)
- Plans can be modified before the period starts (with manager re-approval)
- Once a period passes, its override is locked

#### Data Model Addition

**Google Sheet: QuotaPlans tab**
```
plan_id | user_id | plan_type | created_by | created_at | status | notes
```

**Google Sheet: Overrides tab (updated)**
```
user_id | period_type | period_value | required_hours | reason | approved_by | plan_id
```

Now the Overrides tab supports daily/weekly/monthly overrides, not just monthly.

---

### 3.6d Pre-Approved Absence (No-Flag Mode)

**Problem:** Employee tells manager "I can't work Thursday, family emergency." Manager says OK. But the system will still flag Thursday as a daily shortfall. We don't want that.

**Solution: Pre-Approved Absence**

#### How It Works

1. **Manager types:**
   ```
   /approve-absence @Alex 2026-04-10 reason: family emergency
   ```

2. **System creates a pre-approval record:**
   - Date: Apr 10
   - Type: PRE_APPROVED_ABSENCE
   - No flag will be generated for this date

3. **On Apr 10:** Alex works 0h (or less than daily min). System checks pre-approvals → finds one → skips flag generation entirely.

4. **For hours calculation:** The day counts as 0h worked (unless manager chose to credit it).

#### Manager Options When Pre-Approving
```
/approve-absence @Alex 2026-04-10
```
Bot asks:
```
Pre-Approve Absence for Alex on Apr 10

How should this day be counted?
[🏖️ Paid Leave] - Deduct from leave balance, credit 8h
[⚠️ Unpaid Leave] - No leave deduction, 0h credited
[🔄 Make-Up Day] - 0h credited, employee will compensate later
[✅ Credited Absence] - No leave deduction, credit 8h anyway (special approval)
```

- **Paid Leave**: Same as normal paid leave flow but pre-approved
- **Unpaid Leave**: 0h, no flag, accepted deficit
- **Make-Up Day**: 0h, but expected to offset via hours banking later
- **Credited Absence**: Manager gives full 8h credit without using leave balance (exceptional cases only — sick, emergency, etc.)

#### Data Model

**Google Sheet: PreApprovals tab**
```
id | user_id | date | type | credit_hours | approved_by | approved_at | reason
```

**Types:** PAID_LEAVE, UNPAID_LEAVE, MAKE_UP, CREDITED_ABSENCE

---

### 3.7 Payroll Calculation

**Inputs:**
- Effective salary for the month (resolved from SalaryHistory, NOT Employees.salary)
- Required hours (from group policy or individual override)
- Actual hours (worked + paid leave hours)

**Salary Resolution (critical for historical accuracy):**
```
getEffectiveSalary(userId, yearMonth):
  1. Get all SalaryHistory rows WHERE user_id = userId
  2. Filter: effective_date <= last day of yearMonth
  3. Sort by effective_date DESC → return new_salary from first match
  Fallback: if no SalaryHistory entry → use Employees.salary
```

**Calculation:**
```
effective_salary = getEffectiveSalary(userId, yearMonth)
hourly_rate = effective_salary / required_monthly_hours
actual_hours = worked_hours + (paid_leave_days × 8) + credited_absence_hours
deficit = required_hours - actual_hours

IF deficit > 0:
    # Check hours bank first
    banked_hours = available surplus from previous months (not expired)

    IF manager chose "Use Bank":
        offset = MIN(banked_hours, deficit)
        effective_deficit = deficit - offset
        UPDATE bank: used += offset
    ELSE:
        effective_deficit = deficit

    IF effective_deficit > 0 AND manager_approved_deduction:
        deduction = effective_deficit × hourly_rate
    ELSE:
        deduction = 0
ELSE:
    # Surplus month
    surplus = actual_hours - required_hours
    STORE in HoursBank for potential future offset
    deduction = 0

final_salary = effective_salary - deduction
```

**Rules:**
- Paid leave counts as 8 hours (full day)
- Unpaid leave counts as 0 hours
- Shift permission counts as 0 hours (employee must compensate)
- Credited absence counts as 8 hours (special manager approval)
- Banked surplus hours can offset future deficits (with manager approval)
- Banked hours expire after 12 months from accrual date
- No negative salary (floor at 0)
- Deductions only happen after manager approval of flags
- Pre-approved absences skip flag generation entirely

**Employee Report:**
```
Salary: NPR 400,000
Required: 160h
Worked: 140h
Paid Leave: 2 days (16h)
Total Counted: 156h
Deficit: 4h
Deduction: NPR 10,000 (pending manager approval)
Final: NPR 390,000
Payment: Within 15 days of following month in NPR (no TDS withholding)
```

**Manager/Admin Report:**
```
Team Summary (March 2026):
Subash → 156h / 160h (✅ OK)
John   → 170h / 160h (✅ +10h overtime)
Alex   → 120h / 160h (⚠️ -40h deficit, flag pending)
```

### Mid-Month Joining
If contractor joins on any day other than the 1st, the first month's service fee and hours requirement are calculated pro-rata:
```
pro_rata_fee = monthly_fee × (remaining_calendar_days / total_calendar_days_in_month)
pro_rata_hours = required_monthly_hours × (remaining_calendar_days / total_calendar_days_in_month)
```
**Example:** Joins March 15, monthly fee = NPR 100,000, hours = 160h. March has 31 days, remaining = 17. Pro-rata fee = 100,000 × (17/31) ≈ NPR 54,839. Pro-rata hours = 160 × (17/31) ≈ 88h.

### Mid-Month Termination
If agreement terminates mid-month, final month's fee and hours are pro-rated:
```
pro_rata_fee = monthly_fee × (days_worked / total_calendar_days)
pro_rata_hours = required_monthly_hours × (days_worked / total_calendar_days)
```
**Example:** Terminates April 20, fee = NPR 100,000, hours = 160h. April has 30 days. Pro-rata fee = 100,000 × (20/30) ≈ NPR 66,667. Pro-rata hours = 160 × (20/30) ≈ 107h. If worked 90h, deficit = 17h, deduction applied if manager approves.

### Contract Term & Termination
- **Monthly Rolling**: Agreement auto-extends at 24:00 JST end of each month if no termination notice
- **Notice Period**: 1 month from date of notice (not end of month)
- **Probation Period**: First 3 months from join_date; during probation, notice period is 7 days
- **Termination for Cause**: 7 days written notice for material breach or work failures
- **Immediate Termination**: For extreme cases (IP breach, fraud, theft)
- **Final Settlement**: By 15th of month following termination date

### Probation & Performance Reviews
- **Probation Duration**: First 3 months from join_date
- **Probation Notice Period**: 7 days written notice (shorter than standard 1 month)
- **Probation Leave Accrual**: No leave accrual during probation period
- **Performance Reviews**: After probation (3 months) + every 6 months thereafter
- **Salary Review**: After probation (3 months) + every 6 months thereafter

### Subcontracting
- **Prohibited**: Contractor may NOT subcontract work or hire others to perform duties
- Referenced in onboarding and policy documents

### Nepal Holidays
The following are optional holidays for contractors (company will not require regular work on these days, but production incidents still require response):
- **Dashain** (September/October)
- **Tihar** (October/November)
- **Teej** (August/September)
- **Shiva Ratri** (February/March)

Contractors can choose to work on these days for additional compensation (if agreed separately).

### Force Majeure
During force majeure events (bandhs, earthquakes, internet outages >24h, etc.):
- Hours requirements adjusted proportionally based on outage duration
- No salary deduction for time lost due to force majeure
- If force majeure event exceeds 30 days, either party may terminate with 7 days notice
- Normal terms resume once force majeure ends

### Background Check Requirements (Onboarding)
Admin must verify and retain copies of:
- Citizenship document (or national ID)
- Photo ID
- Academic certificates
- Experience certificates
- PAN (Permanent Account Number)

---

### 3.7b Payroll Visibility via Slack

**Problem:** Employees can only see their payroll in Google Sheets. We want employees to see their payroll breakdown directly in Slack, and managers to see a team payroll summary.

**Employee Command: `/payroll`**
```
/payroll              → current or last finalized month
/payroll 2026-02      → specific month
```

Shows: base salary, required hours, worked hours, leave credits, deficit, bank offset, hourly rate, deduction, final salary, and payment info. Also includes a brief salary history snippet.

**Manager Command: `/team-payroll`**
```
/team-payroll              → last finalized month
/team-payroll 2026-02      → specific month
```

Shows: table of all direct reports with salary, required, actual, deficit, deduction, and final salary. Highlights pending flags that block payroll finalization. Includes team total.

**Rules:**
- Employee only sees their own data
- Manager sees only direct reports
- Admin sees all employees
- Payroll is "final" only after all flags for that month are resolved by manager
- Before the 15th of the month, default view shows last month (payment period)

---

### 3.7c Salary Change Tracking

**Problem:** Salaries change over time (after probation, performance reviews, promotions). We need an audit trail of all salary changes per employee.

**Storage: Google Sheet "SalaryHistory" tab**
```
id | user_id | effective_date | old_salary | new_salary | change_type | reason | approved_by | created_at
```

**Change Types:**
- `INITIAL` — onboarding salary (old_salary = 0)
- `PROBATION_END` — adjustment after probation completion
- `REVIEW` — periodic performance review (every 6 months per contract)
- `PROMOTION` — role change
- `ADJUSTMENT` — market correction or other ad-hoc change

**Manager Command: `/salary-history @employee`**
View full salary history for an employee.

**Manager Command: `/salary-history @employee set <amount>`**
Initiate a salary change — shows confirmation with change type selection, records to SalaryHistory, updates Employees.salary.

**Rules:**
- First entry per employee is INITIAL (created during onboarding)
- Salary changes are effective from 1st of a month (no mid-month changes)
- SalaryHistory is append-only — corrections add a new ADJUSTMENT entry
- Employees.salary always reflects current salary; history is the audit trail
- Payroll calculation uses Employees.salary (current) — for historical months, MonthlySummary already has the snapshot
- Only managers/admins can update salary

---

### 3.7d Enhanced /report Routing

**Problem:** Managers need to view individual employee reports without going to Google Sheets. Employees need their own report with no arguments.

**Routing logic:**
- `/report` (no args) → submit today's report (modal)
- `/report <date>` → view own report for that date
- `/report week` / `month` → own submission summary
- `/report @employee` → view that employee's today report (manager only)
- `/report @employee <date>` → view that employee's report for a date (manager only)
- `/report employee@email.com` → same, lookup by email
- `/report EMP003` → same, lookup by user_id

**Employee lookup precedence:**
1. Slack mention (@) → match slack_id
2. Email format → match email column
3. EMP-prefixed ID → match user_id

**Access control:** Caller must be manager_id of the target employee (or admin).

---

### 3.8 Leave Accrual System

**Employee Fields:**
```
join_date
leave_accrual_start_month (N months after joining)
leave_accrual_rate_per_month (e.g., 1 day/month)
max_leave_cap (optional)
```

**Accrual Rules:**
- No leave granted until N months after join_date
- After that: paid_leave += accrual_rate (every month)
- Balance = total_accrued - used_paid_leave
- Optional cap on maximum accumulated leave

**Example:**
```
Join: Jan 2026, Accrual starts: after 3 months
Apr → +1 day, May → +1 day, Jun → +1 day ...
```

---

### 3.9 Employee Onboarding & Offboarding (via Slack)

**Onboarding** — `/onboard` (Admin only, opens Slack modal):

The `/onboard` command opens a Slack modal (via `views.open` + `trigger_id`) with 10 fields: Name, Email, Slack User, Group, Monthly Salary NPR, Join Date, Manager, Leave Accrual Start, Leave Accrual Rate, Max Leave Cap.

On submission:
1. System auto-generates user_id (EMP + next number)
2. Creates Employees row with all fields
3. Creates SalaryHistory row (change_type=INITIAL, old_salary=0)
4. Bot sends welcome DM to new employee with command guide
5. Admin receives confirmation with summary

Validations: no duplicate Slack ID or email, salary > 0, manager must be active, join date defaults to today.

**Offboarding** — `/offboard @employee` (Admin only):

Shows interactive settlement preview (pro-rata salary, projected deficit, forfeited leave, quota plan cancellation) with Confirm/Cancel buttons. On confirmation:
1. Sets Employees.status = INACTIVE
2. Cancels active QuotaPlans
3. Generates final MonthlySummary row
4. Posts to #hr-alerts
5. Future commands from this user are rejected

**Editing** — `/edit-employee @employee` (Admin only, opens Slack modal):

Opens a pre-populated modal with editable fields: Name, Email, Group, Manager, Join Date, Leave Accrual Start/Rate/Cap, Status (ACTIVE/INACTIVE).

Not editable via this modal (use dedicated commands): Salary (use `/salary-history set`), Slack User ID (immutable), Employee ID (auto-generated).

Special cases: group change takes effect from next month (current month keeps old hours requirements). Status change to INACTIVE triggers offboard logic. Reactivation (INACTIVE → ACTIVE) requires new join date and salary.

See `SLACK_COMMANDS.md` for detailed modal fields, code patterns, and interaction flows.

---

## 4. Reporting

### Employee Self-Service
| Command | Shows |
|---------|-------|
| `/hours` | Today/week/month hours vs required |
| `/balance` | Paid leave remaining + accrued |
| `/payroll` | Personal payroll calculation (current or specific month) |
| `/clock-status` | Current clock state (working/break/off) |
| `/my-bank` | Personal banked surplus hours and expiry dates |

### Manager Views
| Command | Shows |
|---------|-------|
| `/team-hours` | All team members' monthly summary |
| `/team-flags` | Pending hour shortfall flags |
| `/team-reports` | Team daily reports (daily/week/month summary) |
| `/team-payroll` | Team payroll summary with totals |
| `/salary-history` | View/update employee salary history |
| `/report @employee` | View a specific employee's report |
| `/approve-surplus` | Proactively approve surplus banking |
| `/team-bank` | Team hours bank balances |

### Admin Commands
| Command | Shows |
|---------|-------|
| `/onboard` | Opens modal to add new employee |
| `/offboard @employee` | Settlement preview + deactivation |
| `/edit-employee @employee` | Opens modal to edit employee details |

### Admin Reports (Google Sheet)
- Monthly payroll summary (auto-calculated)
- Attendance log export (CSV)
- Leave history per employee
- Daily report archive
- Flag resolution history
- Salary change history per employee

---

## 5. Data Model (Google Sheets)

### Tab 1: Employees
```
user_id | slack_id | name | email | group | salary | join_date |
leave_accrual_start_month | leave_accrual_rate | max_leave_cap |
manager_id | status (ACTIVE/INACTIVE)
```

**CEO:** John Doe (top of organizational hierarchy)

### Tab 2: Events (attendance log)
```
timestamp | user_id | user_name | action (IN/OUT/BREAK_START/BREAK_END)
```

### Tab 3: Leave Requests
```
id | user_id | date | type (PAID/UNPAID/SHIFT) | status (PENDING/APPROVED/REJECTED) |
approved_by | approved_at | notes
```

### Tab 4: DailyReports
```
date | user_id | user_name | yesterday | today | blockers | submitted_at
```

### Tab 5: Policies
```
group | min_daily_hours | min_weekly_hours | min_monthly_hours
```

### Tab 6: Overrides
```
user_id | year_month | required_hours | reason | approved_by
```

### Tab 7: Flags
```
id | user_id | period_type (DAILY/WEEKLY/MONTHLY) | period_value |
shortfall_hours | status (PENDING/APPROVED_DEDUCT/APPROVED_NO_PENALTY) |
manager_id | resolved_at | notes
```

### Tab 8: MonthlySummary (calculated)
```
user_id | month | worked_hours | paid_leave_hours | total_hours |
required_hours | deficit | deduction | final_salary
```

### Tab 11: SalaryHistory (append-only)
```
id | user_id | effective_date | old_salary | new_salary | change_type | reason | approved_by | created_at
```

---

## 6. Automation Requirements

### Slack → Google Sheets (via Apps Script webhook)
- `/in` → append IN event row
- `/out` → append OUT event row
- `/break` → append BREAK_START row
- `/back` → append BREAK_END row
- `/request-leave DATE` → insert leave request row
- `/report` → trigger report dialog, save to DailyReports

### Google Sheets → Slack (via Apps Script triggers)
- Leave approval notifications to manager
- Approval/rejection confirmation to employee
- Reminder for pending approvals (24h)
- Daily "who is off today" notification
- Hour shortfall flags to managers
- End-of-day summary (optional)

### Cron Jobs (Apps Script time triggers)
- Monthly: calculate leave accrual
- Monthly: generate payroll summary
- Weekly: check weekly hour shortfalls
- Daily: check daily hour shortfalls + missing checkouts
- Monthly: check for surplus expiring within 30 days, send warning DM to employee + manager
- Daily: on expiry date, auto-mark expired entries in HoursBank, send expiry notification

---

## 7. Edge Case Rules

### Cross-Midnight Work Sessions
If an employee clocks in before midnight and out after midnight, all hours count toward the **clock-in date**. Example: IN at 22:00 Mar 28, OUT at 02:00 Mar 29 → 4 hours credited to Mar 28. The system uses the IN event's date to assign the session.

### Deduction Rounding
All deductions are rounded **up** (ceiling) to the nearest whole NPR. Example: 0.3h deficit × NPR 625/h = NPR 187.5 → NPR 188. Rounding is applied per employee per month (not per-day aggregation).

### Leave on Termination
Unused paid leave is **forfeited** — no encashment. This is a contractor agreement, not employment. Leave is a benefit during the contract term only.

### Mid-Month Salary Change (Pro-Rata Blend)
If salary changes mid-month (rare — policy is changes effective from 1st), the system blends:
```
effective_salary = (old_salary × days_at_old / total_days) + (new_salary × days_at_new / total_days)
```
Example: 300K for Apr 1-14 (14 days) + 350K for Apr 15-30 (16 days) in a 30-day month:
= (300000 × 14/30) + (350000 × 16/30) = NPR 326,667

### Mid-Month Join — Daily/Weekly Pro-Rata
For mid-month joiners, only monthly hours are pro-rated. Daily (3h) and weekly (30h) minimums apply in full from the first working day. Rationale: daily/weekly are core availability thresholds, not volume targets. If you work that day, you should work at least 3h.

### Termination During Active Quota Plan
If termination occurs during an active quota redistribution plan:
1. Plan status → CANCELLED
2. Final settlement uses STANDARD hours (not redistributed) for the entire plan period up to termination
3. Calculate net shortfall across the plan period, deduct at hourly rate
4. See REQUIREMENTS.md section 3.6b "Termination During Active Quota Redistribution" for full example

### Concurrent Access
LockService.getScriptLock() with 10-second wait timeout. If lock fails, return: "System is busy, please try again in a few seconds." Each command acquires one global lock. For 15 users this is fine (~60 events/day).

### Timezone
All timestamps stored and calculated in JST (UTC+9). Nepal-based contractors see times in JST. "Today" = JST date. Future: could add per-employee timezone setting.

### Force Majeure
Manager uses `/adjust-quota` to reduce requirements for affected periods. No special flag type — the reduced quota means flags won't fire for the adjusted amount. If >30 days, either party can terminate with 7 days notice per contract.

---

## 8. Non-Functional Requirements

### Performance
- Support up to 20 users
- Every slash command uses acknowledge-first pattern (immediate "⏳ Processing..." response, then deferred real response via response_url) — eliminates 3-second timeout risk
- Apps Script execution < 30 seconds per request
- Batch-read sheets into memory, compute in-memory (never read sheets in a loop)

### Reliability
- No data loss (append-only event log)
- All actions logged with timestamps
- Graceful error handling with user-friendly messages
- Error logging to a Logs tab in Google Sheets (timestamp, command, user, error, stack trace)
- response_url valid for 30 minutes; if processing takes >30min (shouldn't for 15 users), user gets no response — manual retry needed

### Security & Authentication

**Request verification:** Every doPost() call verifies the Slack request signature (HMAC-SHA256 using SLACK_SIGNING_SECRET) before any processing. Replay attacks prevented by rejecting requests older than 5 minutes.

**Token storage:** SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET stored in Google Apps Script Properties (never hardcoded).

**Role-based access control (RBAC):**
- Every command calls `getRole(slack_user_id)` to identify the caller from the Employees sheet
- Unregistered or INACTIVE users are rejected with a friendly error for ALL commands
- `requireRole(caller, minimumRole)` enforces the role hierarchy: Employee → Manager → Admin/CEO
- **Roles are inclusive (not exclusive):** A manager IS an employee. An admin IS a manager AND an employee. Each higher role inherits all capabilities of lower roles.
- Manager scope is limited to direct reports (`Employees.manager_id = caller.user_id`); admin/CEO can see all

**Permission rules:**
- Employee commands: any registered active user can access their own data only
- Manager commands (`/team-*`, `/approve-*`, `/adjust-quota`, `/salary-history`): requires manager role, scoped to direct reports
- Admin commands (`/onboard`, `/offboard`, `/edit-employee`, `/salary-history set`): requires admin or CEO role

**Role-aware `/hr-help` command:**
- `/hr-help` dynamically shows only the commands available to the caller's role
- Employee sees: attendance + personal data + leave commands
- Manager sees: all employee commands + manager commands (team, approvals, salary)
- Admin sees: all employee + manager + admin commands (onboard, offboard, edit)
- This ensures no user sees commands they cannot use
- Employees NEVER access Google Sheets directly — all interactions through Slack bot only

**Channel privacy:**
- `#attendance` — public channel, shows only name + action + time (no personal data ever)
- `#daily-reports` — public channel, standup summaries
- `#leave-requests` — public channel, leave notifications for manager visibility
- `#hr-flags`, `#hr-alerts` — PRIVATE channels, managers/admin only
- All slash command responses containing personal data (hours, salary, deficit, leave balance) use `response_type: "ephemeral"` — visible ONLY to the user who typed the command
- Bot DMs used for sensitive notifications (deficit warnings, welcome messages, flag alerts)

See `SLACK_COMMANDS.md` → "Authentication & Request Verification" and "Authorization & Role Model" for full implementation details and permission matrix.

### Usability
- Commands must be simple and memorable
- Bot responses must be clear and concise
- Error messages must guide the user

---

## 8. Constraints & Limitations
- Google Sheets as database (not ACID-compliant)
- No real-time strict validation (append-only is safer)
- Payroll is indicative (not legal-grade)
- Slack free plan has message history limits
- Apps Script has execution time limits (6 min/execution)
- Google Sheets has cell limits (10M cells)

---

## 9. Future Enhancements (Phase 2+)
- JIRA integration: auto-fetch assigned tasks, compare with daily reports
- GitHub integration: auto-fetch commits/PRs, cross-verify reports
- Half-day leave support
- Overtime tracking & compensation
- Admin dashboard UI (web app)
- Export to accounting tools
- Notion integration for report dashboards
- Mobile-friendly Slack app home tab
