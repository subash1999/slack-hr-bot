# Initial Data Setup Guide

This guide documents the initial data to load into the Google Sheets template when setting up the Slack HR Bot system. Follow the exact values below for each sheet tab.

---

## Prerequisites

1. Create the Google Sheet: **Slack HR Bot - Master**
2. Create all 13 tabs as specified in `google_sheets_template.md`
3. Add column headers as specified in `google_sheets_template.md`
4. Then load the initial data rows below

---

## Tab 1: Employees

**Required Rows:**

Add these employee records to the Employees sheet. Each row follows this format:

```
user_id | slack_id | name | email | position | salary | join_date | leave_accrual_start_month | leave_accrual_rate | max_leave_cap | manager_id | is_admin | leave_balance | status
```

### Row 2: CEO (John Doe)

```
EMP000 | U04ABCDEF | John Doe | john@example.com | CEO | 0 | 2026-01-01 | 1 | 0 | 0 | none | TRUE | 0 | ACTIVE
```

**Field Explanation:**
- `user_id`: EMP000 (unique identifier)
- `slack_id`: U04ABCDEF (placeholder—update after Slack user is created or invite sent)
- `name`: John Doe
- `email`: john@example.com
- `position`: CEO (resolves to Full-Time policy group via Positions tab)
- `salary`: 0 (CEO profile; adjust if needed)
- `join_date`: 2026-01-01
- `leave_accrual_start_month`: 1 (January; tracking only)
- `leave_accrual_rate`: 0 (no automatic leave accrual for CEO)
- `max_leave_cap`: 0 (no leave cap)
- `manager_id`: none (self—top of hierarchy)
- `is_admin`: TRUE (admin role)
- `status`: ACTIVE

**Note:** Update `slack_id` once the user is invited to Slack and you can retrieve their actual Slack user ID (format: `UXXXXXXXXX`).

---

## Tab 2: Events

**No initial data required.**

This sheet is append-only and records in/out/break events automatically via Slack commands.

---

## Tab 3: LeaveRequests

**No initial data required.**

Leave requests are created via `/request-leave` slash command and tracked here.

---

## Tab 4: DailyReports

**No initial data required.**

Daily reports are submitted via `/report` slash command and tracked here.

---

## Tab 5: Policies (Hour Requirement Groups)

**Required Rows:**

Add these policy group definitions. Each row defines work hour requirements for a policy group. Multiple positions can share the same policy group.

```
policy_group | min_daily_hours | min_weekly_hours | min_monthly_hours | description
```

### Row 2: Full-Time
```
Full-Time | 3 | 30 | 160 | Full-time contract staff (3h/30h/160h)
```

### Row 3: Intern
```
Intern | 3 | 15 | 80 | Interns (3h/15h/80h)
```

**Field Explanation:**
- `policy_group`: Policy group name (referenced by Positions tab, NOT directly by Employees)
- `min_daily_hours`: Minimum hours required per day (core working hours: 3h mutually agreed)
- `min_weekly_hours`: Minimum hours required per week
- `min_monthly_hours`: Minimum hours required per month
- `description`: Human-readable description and notes

**Important Notes on Contractor Groups:**
- **Core Working Hours**: 3 hours per day (mutually agreed between contractor and company)
- **Full-Time policy group**: 3h daily / 30h weekly / 160h monthly minimum
- **Intern policy group**: 3h daily / 15h weekly / 80h monthly minimum
- **Currency**: All payments in NPR (Nepalese Rupees)
- **Payment Terms**: Within 15 days of following month in NPR
- **TDS**: No TDS withholding by company
- **Surplus Hours**: NOT cashable; require manager pre-approval to be eligible for banking; can only be taken as leave within 12 months with manager permission
- **Termination Notice**: 1 month notice period for both parties (or 1 month salary in lieu)
- **Termination for Cause**: 7 days written notice for material breach or work failures
- **Immediate Termination**: For extreme cases (IP breach, fraud, theft)
- **Final Settlement**: By 15th of month following termination
- **Severability**: If any provision conflicts with Nepal law, it is void only to the degree of conflict. All other provisions remain in full force.

---

## Tab 13: Positions (Lookup Table)

**Required Rows:**

Add all position titles. Each maps to a policy group for hour requirements.

```
position | policy_group | description
```

### Pre-fill all positions:
```
CEO                          | Full-Time | Chief Executive Officer
CTO                          | Full-Time | Chief Technology Officer
Team Lead                    | Full-Time | Team Lead
Full Time Contract Developer | Full-Time | Full-time contract developer
Full Time Developer          | Full-Time | Full-time developer
Contract Intern              | Intern    | Contract intern
Intern                       | Intern    | Intern
```

**Field Explanation:**
- `position`: Position title (PK — must be unique, referenced by Employees.position)
- `policy_group`: FK to Policies.policy_group — determines which hour requirements apply
- `description`: Human-readable description

**Hour requirement resolution chain:**
`Employees.position` → `Positions.policy_group` → `Policies.min_*_hours`

Example: Employee with position "CTO" → Positions maps CTO to "Full-Time" → Policies says Full-Time = 3h daily / 30h weekly / 160h monthly.

**Adding new positions:** Admin can add rows directly to this sheet. If a new policy group is needed (e.g., "Part-Time"), add it to Policies first, then reference it here.

---

## Tab 6: Overrides

**No initial data required.**

Overrides are created manually by admins when specific employees need custom hour requirements for a month.

---

## Tab 7: Flags

**No initial data required.**

Flags are generated automatically when employees fail to meet minimum hour requirements. They can be approved, dismissed, or resolved with bank offsets.

---

## Tab 8: HoursBank

**No initial data required.**

Hours bank entries are created when manager proactively approves surplus banking via `/approve-surplus` command.

---

## Tab 9: QuotaPlans

**No initial data required.**

Quota plans are created via `/adjust-quota` command.

---

## Tab 10: PreApprovals

**No initial data required.**

Pre-approvals are created via `/approve-absence` command.

---

## Tab 11: SalaryHistory

**Required: One INITIAL row per employee at onboarding.**

When adding a new employee, always create a corresponding SalaryHistory entry:

```
id | user_id | effective_date | old_salary | new_salary | change_type | reason | approved_by | created_at
```

### Row for CEO:
```
SAL-2026-001 | EMP000 | 2026-01-01 | 0 | 0 | INITIAL | CEO onboarding | EMP000 | 2026-01-01 00:00
```

**When onboarding any new employee**, add a row here with `change_type = INITIAL` and `old_salary = 0`.

---

## Tab 12: MonthlySummary

**No initial data required.**

Monthly summaries are calculated automatically from Events, LeaveRequests, and Policies data. Salary-dependent fields (hourly_rate, deduction, final_salary) are computed on the fly from SalaryHistory via `getEffectiveSalary()`.

---

## Setup Checklist

- [ ] Create Google Sheet and name it "Slack HR Bot - Master"
- [ ] Create all 12 tabs with correct names
- [ ] Add column headers to each tab
- [ ] Add Policies rows (Full-Time Contract Developer, Contract Intern)
- [ ] Add Employees row for John Doe (EMP000 - CEO)
- [ ] Set column validation rules (see google_sheets_template.md)
- [ ] Invite Sanjay to Slack and update `slack_id` in Employees sheet
- [ ] Configure Google Sheets → Share with Apps Script deployment account
- [ ] Deploy Apps Script and test `/in`, `/out`, `/hours`, `/clock-status` commands

---

## Notes

- The `slack_id` for John Doe (CEO) should be updated after the user account is created in Slack. It will be in the format `UXXXXXXXXX` (visible in Slack when you mention the user).
- The CEO's `manager_id` is set to "none" because Sanjay is at the top of the organizational hierarchy.
- Only TWO contractor groups exist: "Full-Time Contract Developer" and "Contract Intern"
- All other groups (Engineering, Intern, Part-Time, Part-Time Manager, Contract Developer, Part-Time Developer) have been removed
- Contract Intern monthly hours: 80h (3h daily / 15h weekly / 80h monthly)
- Surplus hours are NOT cashable and expire after 12 months; no weekly surplus tracking
- Surplus hours require manager pre-approval to be eligible for banking
- When approving surplus banking, manager specifies max_leave_days convertible from that surplus
- System sends expiry warnings at 30 days before expiry; auto-forfeiture on expiry date
- Termination notice: 1 month from date of notice (or 7 days during probation)
- Probation period: first 3 months; 7-day notice during probation
- Monthly rolling contract: auto-extends unless notice given by 24:00 JST end of month
- Force majeure: hours adjusted proportionally; either party can terminate with 7 days notice if >30 days
- Performance reviews: after probation (3 months) + every 6 months
- Salary review: after probation (3 months) + every 6 months
- Background check requirements: citizenship, photo, academic certs, experience certs, PAN
- Nepal holidays (Dashain, Tihar, Teej, Shiva Ratri): optional for contractors
- Subcontracting: prohibited
- Electronic attendance tracking via Slack is current but may change to other systems in future
- All payments in NPR (Nepalese Rupees), within 15 days of following month, with no TDS withholding

