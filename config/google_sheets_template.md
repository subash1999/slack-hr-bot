# Google Sheets Template Setup Guide

## Create the Spreadsheet

1. Go to Google Sheets → Create new spreadsheet
2. Name it: `Slack HR Bot - Master`
3. Create the following 12 tabs (sheets):

---

## Tab 1: Employees

**Headers (Row 1):**
```
A: user_id
B: slack_id
C: name
D: email
E: position
F: salary
G: join_date
H: leave_accrual_start_month
I: leave_accrual_rate
J: max_leave_cap
K: manager_id
L: is_admin
M: leave_balance
N: status
```

**Sample Row:**
```
EMP001 | U04ABCDEF | Jane Smith | jane@example.com | CTO | 400000 | 2026-01-15 | 3 | 1 | 20 | EMP000 | FALSE | ACTIVE
```

**Validation Rules:**
- Column E (position): Data validation → List from Positions!A:A
- Column F (salary): Number, no decimals
- Column L (status): Data validation → List: ACTIVE, INACTIVE

**Note:** `salary` column reflects the CURRENT salary. For historical salary data and payroll calculations, use the SalaryHistory tab. Payroll always resolves salary from SalaryHistory via `getEffectiveSalary()`, not from this column.

---

## Tab 2: Events

**Headers (Row 1):**
```
A: timestamp
B: user_id
C: user_name
D: action
E: source
```

**IMPORTANT:** This sheet is append-only. Never edit or delete rows.

**Validation Rules:**
- Column D (action): Data validation → List: IN, OUT, BREAK_START, BREAK_END

---

## Tab 3: LeaveRequests

**Headers (Row 1):**
```
A: id
B: user_id
C: date
D: type
E: status
F: requested_at
G: approved_by
H: approved_at
I: notes
```

**Validation Rules:**
- Column D (type): List: PAID, UNPAID, SHIFT
- Column E (status): List: PENDING, APPROVED, REJECTED

---

## Tab 4: DailyReports

**Headers (Row 1):**
```
A: date
B: user_id
C: user_name
D: yesterday
E: today
F: blockers
G: submitted_at
```

---

## Tab 5: Policies (Hour Requirement Groups)

**Headers (Row 1):**
```
A: policy_group
B: min_daily_hours
C: min_weekly_hours
D: min_monthly_hours
E: description
```

**Pre-fill these rows (only these two policy groups exist):**
```
Full-Time | 3 | 30 | 160 | Full-time contract staff (3h/30h/160h)
Intern    | 3 | 15 | 80  | Interns (3h/15h/80h)
```

---

## Tab 13: Positions (Lookup Table)

**Headers (Row 1):**
```
A: position
B: policy_group
C: description
```

**Validation Rules:**
- Column B (policy_group): Data validation → List from Policies!A:A

**Pre-fill these rows:**
```
CEO                          | Full-Time | Chief Executive Officer
CTO                          | Full-Time | Chief Technology Officer
Team Lead                    | Full-Time | Team Lead
Full Time Contract Developer | Full-Time | Full-time contract developer
Full Time Developer          | Full-Time | Full-time developer
Contract Intern              | Intern    | Contract intern
Intern                       | Intern    | Intern
```

**Hour requirement resolution:** `Employees.position` → `Positions.policy_group` → `Policies.min_*_hours`

---

## Tab 6: Overrides

**Headers (Row 1):**
```
A: user_id
B: period_type
C: period_value
D: required_hours
E: reason
F: approved_by
G: plan_id
```

**Validation Rules:**
- Column B: List: DAILY, WEEKLY, MONTHLY

---

## Tab 7: Flags

**Headers (Row 1):**
```
A: id
B: user_id
C: period_type
D: period_value
E: expected_hours
F: actual_hours
G: shortfall_hours
H: status
I: bank_offset_hours
J: effective_deficit
K: manager_id
L: resolved_at
M: notes
```

**Validation Rules:**
- Column C: List: DAILY, WEEKLY, MONTHLY
- Column H: List: PENDING, APPROVED_DEDUCT, APPROVED_NO_PENALTY, BANK_OFFSET, DISMISSED

---

## Tab 8: HoursBank

**Headers (Row 1):**
```
A: user_id
B: period_type
C: period_value
D: required_hours
E: actual_hours
F: surplus_hours
G: used_hours
H: remaining_hours
I: approved_by
J: max_leave_days
K: expires_at
```

**Validation Rules:**
- Column B: List: DAILY, MONTHLY

**Rules:**
- Only created when manager approves surplus banking (not automatic)
- remaining_hours = surplus_hours - used_hours
- When manager approves bank offset in Flags, used_hours increases
- Expired entries (expires_at < today) are ignored in calculations
- Default expiry: 12 months from period start for monthly, 1 month for daily
- max_leave_days specifies maximum leave days convertible from this surplus (locked at approval time)

---

## Tab 9: QuotaPlans

**Headers (Row 1):**
```
A: plan_id
B: user_id
C: plan_type
D: created_by
E: created_at
F: status
G: notes
```

**Validation Rules:**
- Column C: List: DAILY, WEEKLY, MONTHLY
- Column F: List: ACTIVE, COMPLETED, CANCELLED

**Note:** Linked to Overrides via plan_id. Each plan creates multiple override entries.

---

## Tab 10: PreApprovals

**Headers (Row 1):**
```
A: id
B: user_id
C: date
D: type
E: credit_hours
F: approved_by
G: approved_at
H: reason
```

**Validation Rules:**
- Column D: List: PAID_LEAVE, UNPAID_LEAVE, MAKE_UP, CREDITED_ABSENCE

**Types explained:**
- PAID_LEAVE: Deducts from leave balance, credits 8h
- UNPAID_LEAVE: 0h credited, no flag, no leave deduction
- MAKE_UP: 0h credited now, employee expected to compensate via hours bank
- CREDITED_ABSENCE: 8h credited WITHOUT using leave balance (special manager approval)

---

## Tab 11: SalaryHistory

**Headers (Row 1):**
```
A: id
B: user_id
C: effective_date
D: old_salary
E: new_salary
F: change_type
G: reason
H: approved_by
I: created_at
```

**Validation Rules:**
- Column F (change_type): List: INITIAL, PROBATION_END, REVIEW, PROMOTION, ADJUSTMENT

**Rules:**
- Append-only — never edit rows
- First entry per employee: change_type = INITIAL, old_salary = 0 (created during onboarding)
- When salary changes: add new row here AND update Employees.salary to new_salary
- Payroll uses `getEffectiveSalary(userId, yearMonth)` to resolve salary for any month from this tab
- Salary changes are effective from 1st of a month (no mid-month effective dates)
- If mid-month salary change is needed, use pro-rata blend (see SCHEMA.md)

**Sample Rows:**
```
SAL-2025-001 | EMP001 | 2025-07-01 | 0      | 300000 | INITIAL       | Onboarding salary       | EMP000 | 2025-07-01 09:00
SAL-2025-002 | EMP001 | 2025-10-01 | 300000 | 350000 | PROBATION_END | 3-month probation done  | EMP000 | 2025-09-28 14:00
SAL-2026-001 | EMP001 | 2026-04-01 | 350000 | 400000 | REVIEW        | 6-month performance     | EMP000 | 2026-03-25 10:00
```

---

## Tab 12: MonthlySummary

**Headers (Row 1):**
```
A: user_id
B: month
C: worked_hours
D: paid_leave_hours
E: total_hours
F: required_hours
G: deficit
H: bank_offset
I: effective_deficit
J: flag_status
```

**Validation Rules:**
- Column J (flag_status): List: PENDING, DEDUCTED, NO_PENALTY, BANK_OFFSET

**Note:** This tab stores hours and deficit data ONLY. Salary-dependent fields (hourly_rate, deduction, final_salary) are calculated on the fly from SalaryHistory via `getEffectiveSalary()`. See SCHEMA.md for calculation logic.

---

## Sheet Permissions

| Sheet | Admin | Manager | Employee |
|-------|-------|---------|----------|
| Employees | Edit | View | No access |
| Events | View (auto-filled) | View | No access |
| LeaveRequests | Edit | View | No access |
| DailyReports | View (auto-filled) | View | No access |
| Policies | Edit | View | No access |
| Overrides | Edit | View | No access |
| Flags | Edit | View | No access |
| HoursBank | View | View | No access |
| QuotaPlans | Edit | View | No access |
| PreApprovals | Edit | View | No access |
| SalaryHistory | Edit | View | No access |
| MonthlySummary | View | View | No access |

**Remember:** Employees NEVER access Google Sheets. All interaction is through Slack.
