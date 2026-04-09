# Database Schema Design - Google Sheets

## Overview
All data is stored in a single Google Spreadsheet with 13 tabs (Overrides appears twice in detailed sections below — original and updated schema — but is one physical tab).
The Events tab uses an append-only event log pattern for integrity.

---

## Tab 1: Employees

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| user_id | string | Unique ID (auto-gen) | `EMP001` |
| slack_id | string | Slack member ID | `U04ABCDEF` |
| name | string | Full name | `Jane Smith` |
| email | string | Email | `jane@example.com` |
| position | string | FK to Positions.position | `CEO` |
| salary | number | Monthly salary (NPR) | `400000` |
| join_date | date | Start date | `2026-01-15` |
| leave_accrual_start_month | number | Months after join before accrual | `3` |
| leave_accrual_rate | number | Days granted per month | `1` |
| max_leave_cap | number | Max accumulated days (0=unlimited) | `20` |
| manager_id | string | FK to Employees.user_id | `EMP000` |
| is_admin | boolean | TRUE = admin role (set via direct sheet edit only) | `TRUE` |
| leave_balance | number | Materialized cache of current leave days remaining (updated by accrual trigger + leave approval; recalculated monthly for reconciliation) | `8` |
| status | enum | ACTIVE / INACTIVE | `ACTIVE` |

---

## Tab 2: Events (Attendance Log)

**Append-only. Never edit rows — only add new ones.**

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| timestamp | datetime | When the event occurred | `2026-03-28 09:00:15` |
| user_id | string | FK to Employees | `EMP001` |
| user_name | string | Denormalized for readability | `Subash` |
| action | enum | IN / OUT / BREAK_START / BREAK_END | `IN` |
| source | string | How it was logged | `slack_command` |

### Hours Calculation Logic

For a given user on a given date:
```
1. Find all IN/OUT pairs → compute gross work periods
2. Find all BREAK_START/BREAK_END pairs → compute break periods
3. total_hours = SUM(work_periods) - SUM(break_periods)
```

**Edge cases:**
- No OUT found → session is "open" (flag for admin)
- Multiple IN without OUT → use latest IN
- BREAK without matching END → treat as still on break
- **Cross-midnight sessions**: If employee clocks in at 22:00 Mar 28 and out at 02:00 Mar 29, ALL hours count toward the **clock-in date** (Mar 28). The system uses the IN event's date to determine which day the session belongs to. This avoids split-day complexity.
- **Open break at day boundary**: If break started at 23:50 and never ended, the daily trigger at 23:55 JST auto-closes it (logs a BREAK_END at 23:55) and flags the session for admin review.
- **Open session at day boundary**: Daily trigger at 23:55 JST flags unclosed sessions. Does NOT auto-close — admin resolves manually.

---

## Tab 3: Leave Requests

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| id | string | Unique request ID | `LV-2026-001` |
| user_id | string | FK to Employees | `EMP001` |
| date | date | Leave date | `2026-04-02` |
| type | enum | PAID / UNPAID / SHIFT | `PAID` |
| status | enum | PENDING / APPROVED / REJECTED | `APPROVED` |
| requested_at | datetime | When requested | `2026-03-28 14:00` |
| approved_by | string | Manager user_id | `EMP000` |
| approved_at | datetime | When resolved | `2026-03-28 16:30` |
| notes | string | Optional comments | `Family event` |

### Leave Balance Calculation
```
total_accrued = months_since_accrual_start × accrual_rate
               (capped at max_leave_cap if set)
used_paid = COUNT(Leave Requests WHERE type=PAID AND status=APPROVED)
balance = total_accrued - used_paid
```

---

## Tab 4: DailyReports

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| date | date | Report date | `2026-03-28` |
| user_id | string | FK to Employees | `EMP001` |
| user_name | string | Denormalized | `Subash` |
| yesterday | text | What was done yesterday | `Fixed login bug (JIRA-123), reviewed PR #42` |
| today | text | Plan for today | `Working on payment API (JIRA-456)` |
| blockers | text | Any blockers | `Waiting for design approval` |
| submitted_at | datetime | When submitted | `2026-03-28 09:05` |

---

## Tab 5: Policies (Hour Requirement Groups)

Defines hour minimums per policy group. Multiple positions can share the same policy group.

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| policy_group | string | PK - policy group name | `Full-Time` |
| min_daily_hours | number | Minimum hours per day | `3` |
| min_weekly_hours | number | Minimum hours per week | `30` |
| min_monthly_hours | number | Minimum hours per month | `160` |
| description | string | Group description | `Full-time contract staff (3h/30h/160h)` |

### Default Policy Groups
```
Full-Time | 4  | 30  | 160 | Full-time contract staff (4h/30h/160h)
Intern    | 4  | 15  | 80  | Interns (4h/15h/80h)
```

---

## Tab 13: Positions

Lookup table for all positions in the company. Each position maps to a policy group for hour requirements. The Employees sheet references this tab.

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| position | string | PK - position title | `Full Time Developer` |
| policy_group | string | FK to Policies.policy_group | `Full-Time` |
| description | string | Position description | `Full-time software developer` |

### Default Positions
```
CEO                          | Full-Time | Chief Executive Officer
CTO                          | Full-Time | Chief Technology Officer
Team Lead                    | Full-Time | Team Lead
Full Time Contract Developer | Full-Time | Full-time contract developer
Full Time Developer          | Full-Time | Full-time developer
Contract Intern              | Intern    | Contract intern
Intern                       | Intern    | Intern
```

**Hour requirement resolution chain:**
`Employees.position` → `Positions.policy_group` → `Policies.min_*_hours`

Example: Employee with position "CTO" → Positions maps CTO to policy_group "Full-Time" → Policies says Full-Time = 3h/30h/160h.

---

## Tab 6: Overrides

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| user_id | string | FK to Employees | `EMP001` |
| year_month | string | YYYY-MM format | `2026-04` |
| required_hours | number | Override monthly hours | `140` |
| reason | string | Why override | `Approved reduced schedule` |
| approved_by | string | Admin user_id | `EMP000` |

### Resolution Priority
```
1. Check Overrides for user_id + year_month → use if exists
2. Else → use Policies.min_monthly_hours for user's group
```

---

## Tab 7: Flags

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| id | string | Unique flag ID | `FLG-2026-001` |
| user_id | string | FK to Employees | `EMP001` |
| period_type | enum | DAILY / WEEKLY / MONTHLY | `MONTHLY` |
| period_value | string | The specific period | `2026-03` |
| expected_hours | number | Required hours | `160` |
| actual_hours | number | Hours worked | `120` |
| shortfall_hours | number | Deficit | `40` |
| status | enum | PENDING / APPROVED_DEDUCT / APPROVED_NO_PENALTY / BANK_OFFSET / DISMISSED | `PENDING` |
| bank_offset_hours | number | Hours offset from bank (if used) | `40` |
| effective_deficit | number | Deficit after bank offset | `0` |
| manager_id | string | Reviewing manager | `EMP000` |
| resolved_at | datetime | When resolved | `2026-04-01 10:00` |
| notes | string | Resolution reason | `Offset using March surplus` |

---

## Tab 8: HoursBank

**Tracks surplus hours for carry-forward/banking. Entries are only created when manager approves surplus banking (not automatic).**

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| user_id | string | FK to Employees | `EMP001` |
| period_type | enum | DAILY / MONTHLY | `MONTHLY` |
| period_value | string | The specific period | `2026-03` |
| required_hours | number | Required for that period | `160` |
| actual_hours | number | Actually worked | `200` |
| surplus_hours | number | actual - required | `40` |
| used_hours | number | How much has been applied to offsets | `40` |
| remaining_hours | number | surplus - used | `0` |
| approved_by | string | Manager who approved banking | `EMP000` |
| max_leave_days | number | Max leave days convertible from this surplus | `5` |
| expires_at | date | When this surplus expires | `2027-03-31` |

**Rules:**
- Only created when manager approves surplus banking (not automatic)
- Unapproved surplus hours are NOT eligible for banking or future offset
- `remaining_hours` = `surplus_hours` - `used_hours`
- When manager approves bank offset, `used_hours` increases
- Expired entries (expires_at < today) are ignored in calculations
- Default expiry: 12 months for monthly, 1 month for daily

---

## Tab 9: QuotaPlans

**Tracks linked quota redistribution plans (manager-approved schedule adjustments).**

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| plan_id | string | Unique plan ID | `QRP-2026-001` |
| user_id | string | FK to Employees | `EMP001` |
| plan_type | enum | DAILY / WEEKLY / MONTHLY | `MONTHLY` |
| created_by | string | Manager who created it | `EMP000` |
| created_at | datetime | When created | `2026-03-25 10:00` |
| status | enum | ACTIVE / COMPLETED / CANCELLED | `ACTIVE` |
| notes | string | Reason for redistribution | `Employee conference in April` |

**Linked to Overrides via plan_id.** Each plan creates multiple override entries.

---

## Tab 10: PreApprovals

**Pre-approved absences that skip flag generation.**

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| id | string | Unique ID | `PA-2026-001` |
| user_id | string | FK to Employees | `EMP001` |
| date | date | Approved absence date | `2026-04-10` |
| type | enum | PAID_LEAVE / UNPAID_LEAVE / MAKE_UP / CREDITED_ABSENCE | `CREDITED_ABSENCE` |
| credit_hours | number | Hours credited for this day | `8` |
| approved_by | string | Manager who approved | `EMP000` |
| approved_at | datetime | When approved | `2026-04-08 14:00` |
| reason | string | Why absent | `Family emergency` |

**Types explained:**
- `PAID_LEAVE`: Deducts from leave balance, credits 8h
- `UNPAID_LEAVE`: 0h credited, no flag, no leave deduction
- `MAKE_UP`: 0h credited now, employee expected to compensate via hours bank
- `CREDITED_ABSENCE`: 8h credited WITHOUT using leave balance (special manager approval)

---

## Tab 11: Overrides (Updated)

**Now supports daily/weekly/monthly overrides, linked to quota plans.**

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| user_id | string | FK to Employees | `EMP001` |
| period_type | enum | DAILY / WEEKLY / MONTHLY | `MONTHLY` |
| period_value | string | The specific period | `2026-04` |
| required_hours | number | Adjusted requirement | `140` |
| reason | string | Why adjusted | `Reduced schedule per plan` |
| approved_by | string | Manager user_id | `EMP000` |
| plan_id | string | FK to QuotaPlans (nullable) | `QRP-2026-001` |

**Resolution Priority:**
```
1. Check Overrides for user_id + period_type + period_value → use if exists
2. Else → use Policies default for that period level
```

---

## Tab 12: SalaryHistory

**Tracks salary changes per employee over time. Append-only — never edit rows.**

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| id | string | Unique ID | `SAL-2026-001` |
| user_id | string | FK to Employees | `EMP001` |
| effective_date | date | When new salary takes effect | `2026-04-01` |
| old_salary | number | Previous monthly salary (NPR) | `350000` |
| new_salary | number | New monthly salary (NPR) | `400000` |
| change_type | enum | PROBATION_END / REVIEW / PROMOTION / ADJUSTMENT / INITIAL | `REVIEW` |
| reason | string | Why salary changed | `6-month performance review` |
| approved_by | string | Manager/admin user_id | `EMP000` |
| created_at | datetime | When this record was created | `2026-03-28 10:00` |

**Rules:**
- First entry for every employee has change_type = `INITIAL` (onboarding salary, old_salary = 0)
- When salary changes, both SalaryHistory gets a new row AND Employees.salary is updated to new_salary
- Employees.salary always reflects the CURRENT salary; SalaryHistory provides the audit trail
- change_type values:
  - `INITIAL` — onboarding salary
  - `PROBATION_END` — salary adjustment after probation
  - `REVIEW` — periodic performance review
  - `PROMOTION` — role change / promotion
  - `ADJUSTMENT` — ad-hoc correction or market adjustment

---

## Tab 13: MonthlySummary (Calculated)

**MonthlySummary stores hours and deficit data only — NOT salary.** All salary-dependent fields (hourly_rate, deduction, final_salary) are **calculated on the fly** by `getEffectiveSalary()` at display time. This means if a salary correction is backdated, all past payroll views automatically reflect the corrected salary without regenerating anything.

| Column | Type | Description | Formula |
|--------|------|-------------|---------|
| user_id | string | FK to Employees | - |
| month | string | YYYY-MM | - |
| worked_hours | number | From Events calculation | `=CALCULATED` |
| paid_leave_hours | number | Paid leave days × 8 | `=COUNTIFS(...) × 8` |
| total_hours | number | worked + leave | `=SUM` |
| required_hours | number | From Override or Policy | `=IF(override, override, policy)` |
| deficit | number | required - total (if > 0) | `=MAX(0, required - total)` |
| bank_offset | number | Hours offset from bank | `=from HoursBank` |
| effective_deficit | number | deficit after bank offset | `=MAX(0, deficit - bank_offset)` |
| flag_status | enum | PENDING / DEDUCTED / NO_PENALTY / BANK_OFFSET | `PENDING` |

**Derived at display time (not stored):**
```
effective_salary = getEffectiveSalary(user_id, month)   ← from SalaryHistory
hourly_rate      = effective_salary / required_hours
deduction        = IF(flag_status=DEDUCTED, effective_deficit × hourly_rate, 0)
final_salary     = effective_salary - deduction
```

### Salary Resolution Logic

**Every payroll calculation uses `getEffectiveSalary()`, never `Employees.salary` directly.**

```
getEffectiveSalary(userId, yearMonth):
  1. Get all SalaryHistory rows WHERE user_id = userId
  2. Filter: effective_date <= last day of yearMonth
  3. Sort by effective_date DESC
  4. Return new_salary from first match

  Fallback: if no SalaryHistory entry → use Employees.salary
```

**Example:**
```
SalaryHistory for EMP001:
  Jul 2025: INITIAL     → NPR 300,000
  Oct 2025: PROBATION   → NPR 350,000
  Apr 2026: REVIEW      → NPR 400,000

getEffectiveSalary("EMP001", "2025-09") → 300,000 (Jul entry)
getEffectiveSalary("EMP001", "2026-02") → 350,000 (Oct entry)
getEffectiveSalary("EMP001", "2026-04") → 400,000 (Apr entry)
```

**Why calculate on the fly?** If a salary correction is backdated (e.g., "Alex's raise should've started March, not April"), all payroll views for affected months automatically use the corrected salary. No need to regenerate MonthlySummary rows. The hours data in MonthlySummary is stable; only the salary layer changes.

**Mid-month salary change (pro-rata blend):** If two SalaryHistory entries fall within the same month (e.g., 300K effective Apr 1, 350K effective Apr 15), the system blends:
```
effective_salary = (old_salary × days_at_old / total_days) + (new_salary × days_at_new / total_days)
Example: (300000 × 14/30) + (350000 × 16/30) = 140000 + 186667 = NPR 326,667
```
This is rare since the policy is salary changes effective from 1st of month, but the system handles it correctly.

---

## Edge Case Rules (Global)

These rules apply across the entire system:

**Cross-midnight sessions:** All hours count toward the **clock-in date**. If IN=22:00 Mar 28 and OUT=02:00 Mar 29, the 4 hours count for Mar 28.

**Deduction rounding:** All deductions are rounded **up** to the nearest whole NPR (ceiling). NPR 187.3 → NPR 188.

**Leave on termination:** Unused paid leave is **forfeited** — no encashment. This is standard for contractor agreements under Nepal Contract Act 2056.

**Timezone:** All timestamps are stored and calculated in JST (UTC+9). Nepal contractors' clock events are recorded in JST. "Today" = JST date.

**Permission model (inclusive role hierarchy — admin > manager > employee):**
- **Employee**: Can only see/act on own data. Identified by slack_id → Employees.user_id lookup.
- **Manager**: A manager IS also an employee. Determined automatically when other employees' `manager_id` points to this user. Can see/act on direct reports + own data.
- **Admin**: An admin IS also a manager AND an employee. Set via `is_admin=TRUE` in Employees sheet (direct sheet edit only — no slash command). Full access to all data and all employees.
- **CEO (EMP000)**: Top of hierarchy, `manager_id = "none"`, always treated as admin.

**Role assignment:** See `SLACK_COMMANDS.md` → "Role Assignment — How Roles Are Created & Managed" for detailed steps.

**Concurrent access:** LockService.getScriptLock() with 10-second timeout. If lock acquisition fails, return: "System is busy, please try again in a few seconds."

### Materialized Caches & Retroactive Corrections

**Employees.leave_balance** is a materialized cache of current leave days remaining. It is updated by:
- Monthly accrual trigger (adds days)
- Leave approval handler (deducts days for paid leave)
- `recalculateLeaveBalance()` — full recomputation from LeaveRequests (used for reconciliation)

**Retroactive correction scenarios:**

| Scenario | What Happens | Cache Invalidation |
|----------|-------------|-------------------|
| **Salary correction** (e.g., March was 2000, should be 1800) | Add new SalaryHistory entry with backdated effective_date. `getEffectiveSalary()` reads from SalaryHistory → automatically picks up correction. MonthlySummary stores hours only, salary computed on-the-fly. | **None needed** — salary is never cached |
| **Leave correction** (e.g., change March leave from PAID→UNPAID) | Update LeaveRequests row. Call `recalculateLeaveBalance()` to recompute from scratch. Write result to Employees.leave_balance. | **Explicit refresh** of leave_balance |
| **Hours correction** (e.g., missed /out entry) | Append corrective event to Events tab. Recalculate affected month hours. Regenerate MonthlySummary if monthly total changed. | **Regenerate** MonthlySummary for affected month |
| **Employee data change** (position, join_date) | Update Employees row. Invalidate CacheService. If position changed, hour requirements change for future months. | **Invalidate** CacheService for Employees tab |

**Reconciliation safety net:** The monthly trigger runs `recalculateLeaveBalance()` for all employees, comparing cached vs computed values and logging discrepancies.

---

## Relationships Diagram

```
Employees ──┬── Events (1:many via user_id)
             ├── Leave Requests (1:many via user_id)
             ├── DailyReports (1:many via user_id)
             ├── Overrides (1:many via user_id + plan_id → QuotaPlans)
             ├── Flags (1:many via user_id, with bank_offset from HoursBank)
             ├── HoursBank (1:many via user_id)
             ├── PreApprovals (1:many via user_id)
             ├── QuotaPlans (1:many via user_id)
             ├── SalaryHistory (1:many via user_id)
             └── MonthlySummary (1:many via user_id)

Positions ──── Employees (1:many via position)
Policies ──── Positions (1:many via policy_group)

QuotaPlans ──── Overrides (1:many via plan_id)

Employees (as manager) ──── Employees (1:many via manager_id)
                       ──── Leave Requests (1:many via approved_by)
                       ──── Flags (1:many via manager_id)
                       ──── PreApprovals (1:many via approved_by)
                       ──── QuotaPlans (1:many via created_by)
```

---

## Total Tabs: 13

| # | Tab Name | Type | Purpose |
|---|----------|------|---------|
| 1 | Employees | Config | Employee master data |
| 2 | Events | Append-only log | Attendance events (IN/OUT/BREAK) |
| 3 | LeaveRequests | Transactional | Leave requests & approvals |
| 4 | DailyReports | Append-only log | Daily standup reports |
| 5 | Policies | Config | Policy group hour requirements (Full-Time, Intern) |
| 6 | Overrides | Config | Per-employee period overrides (daily/weekly/monthly + plan_id) |
| 7 | Flags | Transactional | Hour shortfall flags & resolutions |
| 8 | HoursBank | Calculated | Surplus hours for carry-forward |
| 9 | QuotaPlans | Transactional | Linked quota redistribution plans |
| 10 | PreApprovals | Transactional | Manager pre-approved absences |
| 11 | SalaryHistory | Append-only log | Salary change audit trail |
| 12 | MonthlySummary | Calculated | Monthly payroll summary |
| 13 | Positions | Config (lookup) | Position titles mapped to policy groups |

**Note:** Tab 6 (Overrides) uses the extended schema from "Tab 11: Overrides (Updated)" in the detailed sections above — supporting daily/weekly/monthly period types with optional plan_id linking to QuotaPlans.
