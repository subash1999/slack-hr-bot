# Employee Onboarding & Offboarding Flow

## Onboarding New Employee

### Step 1: Admin Uses `/onboard` Command

**In Slack, type `/onboard` to open an interactive modal form:**

The `/onboard` command opens a modal with the following fields:

| Field | What to Fill | Example |
|-------|-------------|---------|
| user_id | Auto-generated or manual | `EMP015` |
| slack_id | Get from Slack admin | `U04XYZ789` |
| name | Full name | `Taro Tanaka` |
| email | Work email | `taro@example.com` |
| group | Assign to group | `Full-Time Contract Developer` |
| salary | Monthly salary (NPR) | `350000` |
| join_date | First day of work | `2026-04-01` |
| leave_accrual_start_month | Months before leave starts | `3` |
| leave_accrual_rate | Days per month after start | `1` |
| max_leave_cap | Max accumulated days | `20` |
| manager_id | Manager's user_id | `EMP001` |
| status | Always ACTIVE for new | `ACTIVE` |

The form submission automatically creates the employee row in the Employees sheet and triggers Step 2.

### Step 2: Slack Setup

1. Invite employee to workspace (if not already)
2. Add to channels:
   - `#attendance` (if used for public log)
   - `#daily-reports`
   - `#general` / team channel
3. Bot auto-sends welcome DM when employee first uses any command

### Step 3: Welcome Message (Auto)

When new employee first types any command, bot detects first-time user and sends:

```
👋 Welcome to Slack HR Bot, Taro!

Here are your available commands:

📋 Attendance:
  /in    - Clock in
  /out   - Clock out
  /break - Start break
  /back  - End break

📝 Reports:
  /report - Submit daily standup

🏖️ Leave:
  /request-leave YYYY-MM-DD - Request leave

💰 Payroll:
  /payroll - View your payroll calculation

📊 Info:
  /hours   - View your hours
  /balance - View leave balance
  /clock-status  - Current clock state
  /my-bank - View surplus hours bank
  /hr-help    - All commands

Your group: Full-Time Contract Developer
Required hours: 4h/day, 30h/week, 160h/month
Leave accrual starts: July 2026 (after 3 months)

Questions? Ask your manager or admin.
```

### Step 4: Verify Setup

Admin checklist:
- [ ] `/onboard` modal completed and submitted successfully
- [ ] Slack ID correctly mapped
- [ ] Manager ID correctly set
- [ ] Group assignment correct
- [ ] Salary entered
- [ ] Leave policy configured
- [ ] Employee invited to Slack channels
- [ ] Employee received welcome message
- [ ] Test `/in` and `/out` commands work

---

## Offboarding (Deactivating Employee)

### Step 1: Admin Uses `/offboard` Command

**In Slack, type `/offboard @employee` to initiate offboarding:**

The `/offboard` command opens an interactive modal that:
- Shows a settlement preview (pro-rata salary, deductions, final amount)
- Calculates unused leave (forfeited for contractors)
- Confirms the employee's termination date
- Updates the employee status to INACTIVE upon submission

Example:
```
/offboard @Taro Tanaka
```

The command displays the settlement calculation before final confirmation.

### Step 2: Settlement Preview & Confirmation

The `/offboard` modal displays the settlement calculation with:
- Pro-rata hours calculation (for termination month)
- Pro-rata salary calculation
- Any hour deficit and corresponding deduction
- Final net settlement amount
- Unused leave balance (forfeited)

Settlement formula (as shown in preview):
```
Pro-rata required hours: required_monthly_hours × (days_worked / total_calendar_days)
Pro-rata salary: effective_salary × (days_worked / total_calendar_days)
Deficit: MAX(0, pro_rata_required - actual_hours)
Deduction: deficit × (effective_salary / required_monthly_hours)  [rounded up to nearest NPR]
Final settlement: pro_rata_salary - deduction
Unused paid leave: forfeited (0 encashment)
```

If quota redistribution plan is active at termination, the system uses STANDARD hours (not redistributed) for the entire plan period up to termination date. See REQUIREMENTS.md section 3.6b for details.

### Step 3: Automatic Status Update

After the `/offboard` modal is submitted:
- Employee status is automatically set to INACTIVE
- All data is preserved (attendance, leave history, daily reports)
- Employee row stays in Employees sheet but marked INACTIVE

### Step 4: Slack Cleanup

- Remove from HR-specific channels
- Bot ignores commands from INACTIVE employees
- Respond: "Your account is inactive. Contact admin if this is an error."

---

## Changing Employee Details

### Using `/edit-employee` Command

**In Slack, type `/edit-employee @name` to modify employee details:**

The `/edit-employee` command opens a modal to update:
- Group assignment
- Manager
- Leave configuration (accrual rate, cap, start month)
- Salary (via SalaryHistory)

Example:
```
/edit-employee @Taro Tanaka
```

### Salary Change
- Manager uses `/salary-history @employee set <amount>` in Slack, OR use `/edit-employee @employee` to update via modal
- System creates SalaryHistory row (old_salary, new_salary, change_type, effective_date) AND updates Employees.salary
- Effective from 1st of the specified month (no mid-month effective dates unless pro-rata blend is needed)
- Payroll resolves salary from SalaryHistory via `getEffectiveSalary()` — previous months always use the salary that was active at that time

### Group Change
- Use `/edit-employee @name` to update group, OR
- Admin updates group in Employees sheet manually
- New policy minimums apply from the change date
- Use Overrides sheet for transitional months if needed

### Manager Change
- Use `/edit-employee @name` to update manager, OR
- Admin updates manager_id in Employees sheet manually
- New manager receives future leave requests and flags
- Pending items stay with old manager (or reassign manually)

---

## Bulk Operations (Admin)

### Adding Multiple Employees
1. For bulk operations, use `/onboard` command for each employee (most reliable)
2. Alternatively: prepare data in a separate sheet/CSV and copy-paste into Employees tab manually
3. Verify Slack IDs are correct
4. Test one employee's commands

### Monthly Leave Accrual (Automated)
Apps Script time trigger runs on 1st of each month:
```
For each ACTIVE employee:
  IF months_since_join >= leave_accrual_start_month:
    new_balance = current_balance + accrual_rate
    IF max_leave_cap > 0 AND new_balance > max_leave_cap:
      new_balance = max_leave_cap
    UPDATE balance
```
