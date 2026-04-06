# Daily Reporting & Hours Policy Specification

## Part 1: Daily Standup Reports

### Purpose
Track what each employee is working on daily, in natural language, with references to JIRA tickets and GitHub PRs. This creates an audit trail for later cross-verification.

### Report Structure
Each daily report has 3 sections:

1. **What you did yesterday** - Completed work, referencing JIRA ticket IDs and GitHub PR numbers
2. **What you will do today** - Planned work for the day
3. **Blockers/Issues** - Anything preventing progress

### How It Works

**Submission:** Via `/report` command (separate from `/in`)

**Example report:**
```
Yesterday: Completed user authentication flow (JIRA-123),
           reviewed and merged PR #42 for payment module,
           fixed CSS bug on dashboard (JIRA-145)

Today:     Working on payment API integration (JIRA-456),
           will create PR for auth module refactor,
           team meeting at 2pm

Blockers:  Waiting for design approval on new dashboard layout,
           need access to staging DB credentials
```

### Storage
Stored in Google Sheet `DailyReports` tab as plain text. No parsing required initially.

### Tracking & Compliance
- Reports are tracked per employee per day
- Missing reports are flagged (warning, not penalty)
- Admin can view all reports; employees see only their own
- `/report-status` (future) shows who has/hasn't reported today

### Phase 2: JIRA & GitHub Cross-Verification

**Goal:** Automatically compare what employees say they did vs what JIRA/GitHub shows.

**How it will work (future):**
1. Extract JIRA ticket IDs from daily reports (regex: `JIRA-\d+`, `[A-Z]+-\d+`)
2. Extract GitHub PR numbers (regex: `PR #\d+`, `#\d+`)
3. Fetch from JIRA API: tasks assigned to user, status changes today
4. Fetch from GitHub API: commits by user, PRs opened/merged
5. Compare:
   - Did the mentioned JIRA tickets actually change status?
   - Did the mentioned PRs actually have activity?
   - Are there JIRA tasks with activity NOT mentioned in report?
6. Flag discrepancies for manager review

**This is Phase 2.** Phase 1 just stores the reports in Google Sheets.

---

## Part 2: Hours Policy (3-Level Enforcement)

### Overview
Every employee group has 3 levels of minimum hour requirements. All three are tracked. Shortfalls generate flags that require manager approval before any salary deduction.

### Policy Configuration

**Per Policy Group (resolved via Employees.position → Positions.policy_group → Policies):**
```
Policy Group | Daily Min | Weekly Min | Monthly Min | Positions Using This Group
─────────────┼───────────┼────────────┼─────────────┼──────────────────────────────────────────────────────────
Full-Time    |    3h     |    30h     |    160h     | CEO, CTO, Team Lead, Full Time Contract Developer, Full Time Developer
Intern       |    3h     |    15h     |     80h     | Contract Intern, Intern
```

**Core Working Hours:**
- Core working hours are 3 hours per day (mutually agreed between contractor and company)
- Additional hours beyond core hours must be approved by manager

**Per Individual Override (Overrides sheet):**
Any employee can have a monthly override that supersedes their group policy for a specific month.

### How Hours Are Counted

```
Daily Hours = SUM(work sessions) - SUM(breaks)
            + Paid Leave hours (8h per paid leave day)

Weekly Hours = SUM(daily hours for Mon-Sun)

Monthly Hours = SUM(daily hours for the month)
```

**What counts:**
| Type | Hours | Toward Minimum? |
|------|-------|----------------|
| Normal work (IN/OUT minus breaks) | Actual | Yes |
| Paid Leave | 8h per day | Yes |
| Unpaid Leave | 0h | No |
| Shift Permission | 0h (until compensated) | No |
| Credited Absence (manager special) | 8h | Yes |
| Weekend/Holiday (if worked) | Actual | Yes |

### Flag Generation

**Daily Check (runs at end of each day via Apps Script trigger):**
```
IF employee worked today (has IN event):
    IF daily_hours < group.min_daily_hours:
        IF NOT on approved leave:
            CREATE flag: DAILY_SHORTFALL
```

**Weekly Check (runs every Sunday midnight):**
```
IF week_hours < group.min_weekly_hours:
    CREATE flag: WEEKLY_SHORTFALL
```

**Monthly Check (runs 1st of each month for previous month):**
```
IF month_hours < required_hours (override or group policy):
    CREATE flag: MONTHLY_SHORTFALL
```

### Flag Generation — Pre-Approval Check

Before generating a flag, the system checks:
```
IF pre_approval exists for this user + date:
    SKIP flag generation for that day
    (the absence was already approved by manager)
```

This prevents flags from firing for days the manager already signed off on.

### Flag Resolution Workflow

1. **System creates flag** → posts to `#hr-flags` or DMs manager
2. **Manager sees flag with banking info:**
   ```
   🚩 Monthly Shortfall: Alex
   April 2026: 120h / 160h (-40h deficit)
   Potential Deduction: ¥100,000

   📦 Banked surplus available:
     March 2026: +40h surplus (expires May 31)

   [✅ Use Bank (-40h)] [⚠️ Partial Bank] [💰 Deduct Full] [❌ No Penalty] [⏳ Discuss]
   ```
3. **Manager decides:**
   - **Use Bank** → Apply banked surplus to offset deficit entirely → no deduction
   - **Partial Bank** → Apply part of surplus, deduct remaining
   - **Deduct Full** → Ignore bank, full salary deduction
   - **No Penalty** → employee had valid reason, forgive entirely
   - **Discuss First** → flag stays pending, manager talks to employee

### Salary Deduction Logic

**Key rule: Only MONTHLY flags result in actual salary deduction.**
Daily and weekly flags are early warnings so employees can adjust their schedule.

```
IF monthly_flag.status == APPROVED_DEDUCT:
    hourly_rate = salary / required_monthly_hours
    deduction = deficit_hours × hourly_rate
    final_salary = salary - deduction
ELSE:
    final_salary = salary  (no deduction)
```

### Anti-Double-Penalty

The system tracks all three levels but only deducts based on monthly:
- Daily shortfall → warning flag (employee can make up hours later in the week)
- Weekly shortfall → warning flag (employee can make up hours later in the month)
- Monthly shortfall → actual deduction (after manager approval)

This way, if an employee works 3h on Monday but 12h on Tuesday, the daily flag for Monday is informational. As long as they hit the monthly target, no deduction occurs.

### Employee Self-Adjustment

The whole point of the 3-level system: employees see their progress and adjust:

```
/hours
→ Today: 3h / 8h min ⚠️ (you need 5 more hours today)
→ This Week: 25h / 40h ⚠️ (15h remaining, 3 days left)
→ This Month: 100h / 160h ⚠️ (60h remaining, 8 work days left)
```

If an employee knows they can't meet the minimum on a given day, they should discuss with their manager BEFORE the day ends. The manager can then pre-approve a "No Penalty" flag or arrange a shift adjustment.

### Grace Period / Buffer (Configurable)

Optional tolerance before flagging:
- Daily: 15 minutes (so 7h 45m doesn't flag for 8h min)
- Weekly: 1 hour (39h doesn't flag for 40h min)
- Monthly: 2 hours (158h doesn't flag for 160h min)

These are configurable per policy group in the Policies sheet (future columns).

### Manager Pre-Approval Flow

When an employee knows in advance they can't meet hours:

1. Employee messages manager in Slack
2. Manager types `/approve-absence @employee 2026-03-28 reason: doctor appointment`
3. Bot asks how to count the day:
   - **Paid Leave** → deduct from leave balance, credit 8h
   - **Unpaid Leave** → 0h, no flag
   - **Make-Up Day** → 0h now, employee compensates later via hours bank
   - **Credited Absence** → 8h credited without using leave (special cases)
4. System creates a pre-approval record → that day's shortfall won't trigger a flag

### Manager Quota Redistribution

When employee and manager agree to redistribute hours across periods:

**Monthly redistribution:**
```
/adjust-quota @Alex monthly
→ April: 140h (reduced)
→ May: 180h (compensation)
→ Total: 320h = 2× 160h ✅
```

**Daily redistribution (within a week):**
```
/adjust-quota @Alex daily 2026-04-07
→ Mon: 3h, Tue: 11h, Wed: 8h, Thu: 10h, Fri: 8h
→ Week total: 40h ✅
```

**Weekly redistribution (within a month):**
```
/adjust-quota @Alex weekly 2026-04
→ Week 1: 30h, Week 2: 50h, Week 3: 40h, Week 4: 40h
→ Month total: 160h ✅
```

System creates linked overrides for each period in the plan. The employee's required hours for each period become the adjusted values. No flags fire as long as employee meets the adjusted targets.

### Hours Banking (Carry-Forward)

Surplus hours require MANAGER PRE-APPROVAL to be eligible for banking. Surplus hours are NOT cashable and can only be taken as leave within 12 months with manager permission. When a deficit flag fires, the manager can choose to offset it using banked surplus from previous periods. When approving surplus banking, manager specifies max_leave_days convertible from that surplus.

**How it works:**
- March: worked 200h, required 160h → manager pre-approves banking of 40h surplus with max 5 leave days convertible
- April: worked 120h, required 160h → 40h deficit flagged
- Manager sees the bank balance and can apply it → deficit offset, no deduction
- Employee can convert up to 5 leave days from March's 40h surplus (within 12 months)

**Banking rules:**
- Surplus hours worked WITHOUT prior manager approval are NOT eligible for banking or any compensation
- Only manager-approved surplus hours can be carried forward or taken as leave
- Surplus is tracked per period (daily/monthly only — no weekly surplus tracking)
- Banked hours expire after 12 months from accrual date
- Surplus hours are NOT cashable under any circumstances (cannot be paid out as additional salary)
- When manager approves banking, they specify max_leave_days convertible from that surplus
- Surplus can ONLY be:
  1. Offset against future deficits (with manager approval)
  2. Taken as leave within 12 months (up to max_leave_days, with manager permission)
  3. Forfeited if not used within 12 months
- Manager must explicitly approve bank usage (no auto-offset)
- Partial bank usage is supported
- Bank is per-employee, not transferable
- Expiry warnings: System sends DM warning to employee + manager when surplus within 30 days of expiry
- Auto-forfeiture: On expiry date, surplus marked as expired; no longer usable

### Deficit and Surplus Interaction across Months

**Four core rules for handling deficit/surplus interactions:**

1. **Surplus first → Deficit later (OFFSET POSSIBLE):** If contractor has manager-approved banked surplus from a previous month, those hours can offset a deficit in a later month (reducing/eliminating salary deduction). Requires manager approval at flag resolution.

2. **Deficit first → Surplus later (NO RETROACTIVE REVERSAL):** If a deficit causes a salary deduction in Month 1, that deduction is FINAL. Surplus in Month 2 cannot retroactively reverse or compensate for the Month 1 deduction.

3. **Prevention via Quota Redistribution:** If contractor knows in advance they'll work less one month and more the next, they should request quota redistribution BEFORE the period starts. Manager pre-adjusts hours (e.g., April 140h + May 180h = 320h total, same as 2× 160h). This prevents deficits and deductions entirely.

   **Quota Redistribution and Salary:** When a manager approves quota redistribution (e.g., April = 140h, May = 180h), the total hours across the period remain unchanged (140 + 180 = 320 = 160 + 160). The monthly salary remains THE SAME for both months regardless of the redistributed hours. The contractor receives the same salary in the light month (140h) as in the heavy month (180h), because quota redistribution is a schedule adjustment — not additional work. No extra compensation is payable for months where the redistributed requirement exceeds the standard monthly minimum. *Example:* Standard: April 160h + May 160h = 320h total, salary NPR X each month. Redistributed: April 140h + May 180h = 320h total, salary NPR X each month (SAME). Contractor works 180h in May but gets same salary as April's 140h — this is by design.

4. **Unapproved surplus = no offset:** Surplus without manager pre-approval for banking is not eligible for any offset.

**Key point:** Monthly fee is the maximum. Surplus hours never result in additional payment beyond the agreed service fee.

**Concrete examples:**

- *Surplus first → offset:* March 200h (req 160h) = 40h banked. April 120h (req 160h) = 40h deficit. Manager reviews April flag, sees March banked hours, approves "Use Bank" → April deficit offset entirely, no salary deduction.

- *Deficit first → no retroactive fix:* April works 120h (req 160h) = 40h deficit. Manager approves deduction → salary reduced by NPR 10,000. May works 180h (req 160h) = 20h surplus. This May surplus cannot undo or retroactively compensate for the April deduction; the April deduction stands as final.

- *Proactive redistribution:* Contractor tells manager "April will be light (140h), May will be heavy (180h)." Manager runs `/adjust-quota @Alex monthly` and sets April=140h, May=180h (total 320h = same as 2×160h). Both months now hit adjusted targets. No flags fire; clean outcome.

### Termination During Active Quota Redistribution

When termination occurs while a quota redistribution plan is active:
1. Final settlement is calculated using STANDARD hours requirement (not redistributed) for the entire plan period up to termination date
2. If contractor benefited from reduced hours in a prior month but hasn't fulfilled increased hours in the subsequent month, the net shortfall is calculated across the entire plan period
3. Net shortfall is deducted from final settlement at the hourly rate
4. Company pays: final settlement minus (shortfall × hourly_rate). No further claims by either party
5. Example: Plan = April 140h + May 180h. Contractor works 140h April (full salary). Terminates May 10th with 40h worked. Standard for that period = 160h + ~53h (pro-rata) = 213h. Actual = 180h. Shortfall = 33h. Deduction = 33h × hourly_rate from final May payment.

### Complete Scenario Walkthrough

**Scenario: Alex negotiates flexible March/April**

1. Alex tells manager: "March will be heavy (200h), April will be light (120h)"
2. Manager runs: `/adjust-quota @Alex monthly` → sets March=160h (normal), April=120h (reduced)
3. March ends: Alex worked 200h. Surplus = 40h → banked
4. April ends: Alex worked 120h, required = 120h (overridden) → no deficit. No flag!
5. Result: No penalty. Alex met both adjusted targets.

**Scenario: Alex doesn't negotiate in advance**

1. March: Alex works 200h. Required: 160h. Surplus = 40h → banked
2. April: Alex works 120h. Required: 160h (no override). Deficit = 40h → flag fires
3. Manager reviews flag, sees 40h banked from March
4. Manager clicks "Use Bank" → 40h offset → effective deficit = 0 → no deduction
5. Result: Same outcome but resolved after the fact via banking

**Scenario: Daily adjustment within a week**

1. Monday: Alex works 3h (min: 8h). Daily flag: -5h
2. Alex messages manager: "I had a morning appointment"
3. Manager: `/approve-absence @Alex 2026-04-07 reason: appointment` → Make-Up Day
4. Monday flag is resolved as PRE_APPROVED
5. Tuesday: Alex works 13h → 5h surplus banked at daily level
6. Week total: still on track → no weekly flag

This ensures employees have flexibility to manage their own schedules while maintaining accountability through manager oversight.
