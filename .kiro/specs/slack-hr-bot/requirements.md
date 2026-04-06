# Requirements Document

## Introduction
Slack HR Bot is a free, Slack-based employee management system for a 10-15 member Nepal-based contractor team. It provides attendance tracking, leave management, daily standup reports, 3-level hours enforcement, surplus hours banking, quota redistribution, payroll calculation with salary history, and employee lifecycle management. Built on Slack (slash commands + Block Kit UI) → Google Apps Script (serverless backend) → Google Sheets (13-tab database). All interactions happen through Slack slash commands; employees never access Google Sheets directly.

## Requirements

### Requirement 1: Authentication & Request Verification
**Objective:** As a system administrator, I want all incoming Slack requests verified for authenticity, so that the system is protected from spoofed or replay attacks.

#### Acceptance Criteria
1. When a Slack request is received, the HR Bot shall verify the HMAC-SHA256 signature using the stored Slack Signing Secret before any routing or processing.
2. If the request timestamp is older than 5 minutes, the HR Bot shall reject the request to prevent replay attacks.
3. The HR Bot shall store SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET in Google Apps Script Properties, never hardcoded in source.

---

### Requirement 2: Role-Based Access Control (Inclusive Hierarchy)
**Objective:** As a system administrator, I want an inclusive role hierarchy (admin > manager > employee) derived from sheet data, so that access is controlled automatically without manual role assignment commands.

#### Acceptance Criteria
1. When a registered user issues any command, the HR Bot shall determine their role from the Employees sheet: `is_admin=TRUE` or `user_id=EMP000` → admin; has direct reports (other employees' `manager_id` = this user) → manager; otherwise → employee.
2. The HR Bot shall enforce inclusive role inheritance: admin can execute all commands (admin + manager + employee); manager can execute manager + employee commands; employee can execute employee commands only.
3. If an unregistered Slack user (not found in Employees sheet) issues any command, the HR Bot shall respond with "You're not registered in the HR system. Contact admin."
4. If an INACTIVE employee issues any command, the HR Bot shall respond with "Your account is inactive. Contact admin."
5. While a user has the manager role, the HR Bot shall scope manager commands to only direct reports (employees whose `manager_id` matches the caller's `user_id`).
6. While a user has the admin role, the HR Bot shall allow access to all employees without direct-report scoping.
7. The HR Bot shall not provide any slash command to grant admin role; `is_admin` shall only be set via direct Google Sheet editing.

---

### Requirement 3: Deferred Response Pattern
**Objective:** As an employee, I want instant acknowledgment when I run a command, so that I know the system received my request even during slow processing.

#### Acceptance Criteria
1. When any slash command is received, the HR Bot shall immediately return an ephemeral "Processing..." acknowledgment within the Slack 3-second timeout.
2. When processing completes, the HR Bot shall POST the actual response to the Slack `response_url`.
3. The HR Bot shall use `response_type: "in_channel"` only for attendance commands (`/in`, `/out`, `/break`, `/back`); all other commands shall use `response_type: "ephemeral"`.

---

### Requirement 4: Attendance Tracking (Event-Based)
**Objective:** As an employee, I want to clock in/out and manage breaks via Slack commands, so that my working hours are tracked automatically.

#### Acceptance Criteria
1. When an employee issues `/in`, the HR Bot shall append an IN event to the Events tab with timestamp (JST), user_id, user_name, action="IN", and source="slack_command".
2. When an employee issues `/out`, the HR Bot shall append an OUT event and display the total hours worked for the current session (work time minus break time).
3. When an employee issues `/break`, the HR Bot shall append a BREAK_START event.
4. When an employee issues `/back`, the HR Bot shall append a BREAK_END event.
5. If an employee issues `/in` while already clocked in (no matching OUT), the HR Bot shall reject with "Already clocked in since HH:MM."
6. If an employee issues `/out` while on an active break, the HR Bot shall reject with "End your break first with /back."
7. If an employee issues `/break` without being clocked in, the HR Bot shall reject with an error message.
8. If an employee issues `/back` without an active break, the HR Bot shall reject with an error message.
9. The HR Bot shall never edit or delete rows in the Events tab; it shall only append new events (append-only log).
10. When an employee issues `/clock-status`, the HR Bot shall display the current clock state (clocked in/out, break status, session duration) as an ephemeral response.

---

### Requirement 5: Cross-Midnight & Day Boundary Handling
**Objective:** As an employee who works late, I want my hours counted toward the day I started working, so that cross-midnight sessions are handled correctly.

#### Acceptance Criteria
1. When a work session spans midnight (e.g., IN at 22:00 Mar 28, OUT at 02:00 Mar 29), the HR Bot shall count all hours toward the clock-in date (Mar 28).
2. When the daily trigger runs at 23:55 JST and a break is still open (BREAK_START without BREAK_END), the HR Bot shall auto-close it by appending a BREAK_END event at 23:55 and flag it for admin review.
3. When the daily trigger runs at 23:55 JST and a session is still open (IN without OUT), the HR Bot shall flag it as incomplete but shall NOT auto-close it.

---

### Requirement 6: Positions & Policy Groups
**Objective:** As an administrator, I want positions separated from hour policies via a lookup table, so that multiple job titles can share the same hour requirements.

#### Acceptance Criteria
1. The HR Bot shall resolve hour requirements via the chain: `Employees.position` → `Positions.policy_group` → `Policies.min_daily_hours / min_weekly_hours / min_monthly_hours`.
2. The HR Bot shall support at minimum these positions: CEO, CTO, Team Lead, Full Time Contract Developer, Full Time Developer, Contract Intern, Intern.
3. The HR Bot shall support at minimum two policy groups: Full-Time (3h/30h/160h) and Intern (3h/15h/80h).
4. When an employee's position is changed mid-month via `/edit-employee`, the HR Bot shall apply the new hour requirements starting from the first of the NEXT month.

---

### Requirement 7: 3-Level Hours Enforcement
**Objective:** As a manager, I want daily, weekly, and monthly hour shortfalls tracked and flagged, so that I can address issues before they become salary deductions.

#### Acceptance Criteria
1. When an employee's daily hours fall below their policy group's `min_daily_hours` and the day has no approved leave or pre-approval, the HR Bot shall create a DAILY shortfall flag.
2. When an employee's weekly hours (Mon–Sun) fall below `min_weekly_hours`, the HR Bot shall create a WEEKLY shortfall flag.
3. When an employee's monthly hours fall below `min_monthly_hours` (or their override if one exists), the HR Bot shall create a MONTHLY shortfall flag.
4. The HR Bot shall enforce the anti-double-penalty rule: only MONTHLY flags shall result in salary deduction; DAILY and WEEKLY flags shall serve as informational warnings only.
5. Before generating any flag, the HR Bot shall check the PreApprovals tab; if a pre-approval exists for the user and date, the HR Bot shall skip flag generation.
6. When an employee has an Override entry for a period, the HR Bot shall use the override's `required_hours` instead of the policy group default.

---

### Requirement 8: Flag Resolution Workflow
**Objective:** As a manager, I want to resolve hour shortfall flags with multiple options (bank offset, deduct, forgive), so that I can make fair decisions per case.

#### Acceptance Criteria
1. When a MONTHLY shortfall flag is created, the HR Bot shall post it to the manager with interactive buttons: [Use Bank], [Partial Bank], [Deduct Full], [No Penalty], [Discuss].
2. When the manager chooses "Use Bank", the HR Bot shall apply banked surplus hours to offset the deficit entirely, update the HoursBank (used_hours += offset), and set flag status to BANK_OFFSET.
3. When the manager chooses "Partial Bank", the HR Bot shall prompt for the amount to offset, apply it, and calculate the remaining deficit for deduction.
4. When the manager chooses "Deduct Full", the HR Bot shall set flag status to APPROVED_DEDUCT and record the full deficit for payroll deduction.
5. When the manager chooses "No Penalty", the HR Bot shall set flag status to APPROVED_NO_PENALTY with no salary deduction.
6. While a flag remains in PENDING status, the HR Bot shall not apply any salary deduction for that period.
7. The HR Bot shall display available banked surplus alongside the flag when bank entries exist for that employee.

---

### Requirement 9: Surplus Hours Banking
**Objective:** As a manager, I want to proactively approve surplus hours for banking, so that employees can offset future deficits or take earned leave.

#### Acceptance Criteria
1. The HR Bot shall NOT automatically bank surplus hours; banking shall require explicit manager approval via `/approve-surplus @employee YYYY-MM hours max_leave_days`.
2. When a manager approves surplus banking, the HR Bot shall create a HoursBank entry with surplus_hours, approved_by, max_leave_days, and expires_at (12 months from period start).
3. The HR Bot shall never allow surplus hours to be cashed out (converted to additional salary payment).
4. When banked hours reach within 30 days of expiry, the HR Bot shall send a DM warning to both the employee and their manager.
5. When banked hours expire (12 months from accrual), the HR Bot shall mark them as expired and auto-forfeit the remaining balance.
6. When an employee issues `/my-bank`, the HR Bot shall display all banked surplus entries with period, surplus/used/remaining hours, max leave days, expiry date, and status.

---

### Requirement 10: Leave Management
**Objective:** As an employee, I want to request leave through Slack with manager approval, so that leave is tracked and my hours are adjusted correctly.

#### Acceptance Criteria
1. When an employee issues `/request-leave YYYY-MM-DD`, the HR Bot shall create a leave request with status=PENDING and notify the employee's manager.
2. When an employee issues `/request-leave YYYY-MM-DD YYYY-MM-DD`, the HR Bot shall create one leave request per day in the range.
3. While an employee has leave balance > 0, the HR Bot shall present manager options: [Approve Paid], [Approve Unpaid], [Reject].
4. While an employee has leave balance = 0, the HR Bot shall present manager options: [Shift Permission], [Approve Unpaid], [Reject].
5. When the manager approves as Paid Leave, the HR Bot shall credit 8h per day toward hours and deduct 1 day from leave balance.
6. When the manager approves as Unpaid Leave, the HR Bot shall credit 0h and make no balance deduction.
7. When the manager approves as Shift Permission, the HR Bot shall credit 0h (employee compensates later) with no balance deduction.
8. If a leave request remains PENDING for more than 24 hours, the HR Bot shall send a reminder to the manager.
9. The HR Bot shall never auto-approve or auto-reject leave requests; they shall remain PENDING until the manager acts.
10. The HR Bot shall prevent negative leave balance (cannot approve paid leave when balance = 0).

---

### Requirement 11: Leave Accrual
**Objective:** As an employee, I want my leave balance to accrue monthly after my probation period, so that I earn time off over tenure.

#### Acceptance Criteria
1. The HR Bot shall accrue leave on the 1st of each month using each employee's `leave_accrual_rate` (days/month).
2. While an employee has been at the company fewer months than `leave_accrual_start_month`, the HR Bot shall not accrue any leave.
3. If accrual would exceed `max_leave_cap`, the HR Bot shall cap the balance at `max_leave_cap`.
4. When an employee issues `/balance`, the HR Bot shall display: total accrued, used (paid), remaining, next accrual date, max cap, and recent leave history.

---

### Requirement 12: Daily Standup Reports
**Objective:** As an employee, I want to submit daily reports via Slack, so that my team has visibility into progress and blockers.

#### Acceptance Criteria
1. When an employee issues `/report` with no arguments, the HR Bot shall open a Slack modal with three text fields: Yesterday (completed), Today (planned), Blockers.
2. When the modal is submitted, the HR Bot shall store the report in the DailyReports tab with date, user_id, user_name, yesterday, today, blockers, and submitted_at.
3. When an employee issues `/report YYYY-MM-DD`, the HR Bot shall display their report for that date.
4. When an employee issues `/report week`, the HR Bot shall display their reports for the current week.
5. When a manager issues `/report @employee`, the HR Bot shall display that employee's report for today (only if the employee is a direct report).
6. If a non-manager attempts `/report @employee`, the HR Bot shall respond with "You don't have permission to view this employee's reports."

---

### Requirement 13: Payroll Calculation
**Objective:** As an employee, I want accurate salary calculations based on my worked hours and approved flags, so that I know exactly what I'll be paid.

#### Acceptance Criteria
1. The HR Bot shall resolve salary for any month using `getEffectiveSalary(userId, yearMonth)` from the SalaryHistory tab, never directly from `Employees.salary`.
2. The HR Bot shall calculate: `hourly_rate = effective_salary / required_monthly_hours`.
3. The HR Bot shall calculate: `actual_hours = worked_hours + (paid_leave_days × 8) + credited_absence_hours`.
4. The HR Bot shall calculate: `deficit = MAX(0, required_hours - actual_hours)`.
5. When a deficit exists and the manager has approved deduction (flag status = APPROVED_DEDUCT), the HR Bot shall calculate `deduction = effective_deficit × hourly_rate`, rounded UP to the nearest whole NPR.
6. The HR Bot shall calculate: `final_salary = effective_salary - deduction`.
7. When an employee joins mid-month, the HR Bot shall pro-rate both salary and required hours: `pro_rata = value × (remaining_calendar_days / total_calendar_days)`.
8. When an employee terminates mid-month, the HR Bot shall pro-rate both salary and required hours: `pro_rata = value × (days_worked / total_calendar_days)`.
9. If two salary changes fall in the same month, the HR Bot shall blend them: `(old_salary × days_at_old / total_days) + (new_salary × days_at_new / total_days)`.
10. When an employee issues `/payroll`, the HR Bot shall display: effective salary, required hours, worked hours, leave credits, total hours, deficit, bank offset, deduction, final salary, and payment info.
11. When a manager issues `/team-payroll`, the HR Bot shall display a summary table for all direct reports with salary, required, actual, deficit, deduction, and final amounts.

---

### Requirement 14: Salary History & Audit Trail
**Objective:** As an administrator, I want all salary changes tracked in an append-only audit trail, so that payroll can be accurately calculated for any historical month.

#### Acceptance Criteria
1. The HR Bot shall store every salary change in the SalaryHistory tab (append-only) with: id, user_id, effective_date, old_salary, new_salary, change_type, reason, approved_by, created_at.
2. The HR Bot shall support change types: INITIAL, PROBATION_END, REVIEW, PROMOTION, ADJUSTMENT.
3. When a manager/admin issues `/salary-history @employee set <amount>`, the HR Bot shall create a new SalaryHistory entry AND update `Employees.salary` to the new amount.
4. When any user issues `/salary-history @employee` (view), the HR Bot shall display the full salary change history for that employee (manager: direct reports only; admin: any employee).
5. The HR Bot shall never edit or delete existing SalaryHistory rows.

---

### Requirement 15: Quota Redistribution
**Objective:** As a manager, I want to pre-adjust an employee's hour requirements across periods, so that planned workload variations don't trigger false shortfall flags.

#### Acceptance Criteria
1. When a manager issues `/adjust-quota @employee monthly`, the HR Bot shall display a form showing each month in the plan period with default hours, allowing the manager to redistribute.
2. The HR Bot shall create Override entries for each adjusted period, linked via a shared `plan_id` in the QuotaPlans tab.
3. If the manager's adjusted total is less than the original total, the HR Bot shall warn and require confirmation.
4. When a manager issues `/adjust-quota @employee daily <date>`, the HR Bot shall show a form for daily hour redistribution within that week.
5. When a manager issues `/adjust-quota @employee weekly <month>`, the HR Bot shall show a form for weekly hour redistribution within that month.
6. The HR Bot shall use Override entries (when they exist) instead of policy group defaults when checking hour requirements.

---

### Requirement 16: Pre-Approved Absences
**Objective:** As a manager, I want to pre-approve employee absences so that shortfall flags are automatically skipped for planned time off.

#### Acceptance Criteria
1. When a manager issues `/approve-absence @employee YYYY-MM-DD reason: <text>`, the HR Bot shall prompt for absence type: Paid Leave, Unpaid Leave, Make-Up, or Credited Absence.
2. When type is Paid Leave, the HR Bot shall credit 8h and deduct from leave balance.
3. When type is Unpaid Leave, the HR Bot shall credit 0h with no flag and no balance deduction.
4. When type is Make-Up, the HR Bot shall credit 0h with the expectation employee compensates via banked hours.
5. When type is Credited Absence, the HR Bot shall credit 8h WITHOUT deducting from leave balance (special cases only).
6. When generating flags, the HR Bot shall check PreApprovals before creating any flag; pre-approved dates shall be skipped.

---

### Requirement 17: Employee Onboarding
**Objective:** As an administrator, I want to onboard new employees through a Slack modal, so that all required data is captured and the system is configured correctly.

#### Acceptance Criteria
1. When an admin issues `/onboard`, the HR Bot shall open a Slack modal with fields: name, email, slack_id, position, salary, join_date, manager_id, leave_accrual_start_month, leave_accrual_rate, max_leave_cap.
2. When the modal is submitted, the HR Bot shall auto-generate a user_id (EMP + next sequential number), create an Employees row, and create a SalaryHistory INITIAL entry (old_salary=0).
3. If the submitted slack_id or email already exists in the Employees sheet, the HR Bot shall reject with a duplicate error.
4. The HR Bot shall validate: salary > 0, manager_id references an active employee, all required fields present.
5. When onboarding completes, the HR Bot shall send a welcome DM to the new employee with available commands, their position, hour requirements, and leave accrual start date.

---

### Requirement 18: Employee Offboarding
**Objective:** As an administrator, I want to offboard employees with a clear settlement preview, so that final payments are calculated accurately.

#### Acceptance Criteria
1. When an admin issues `/offboard @employee`, the HR Bot shall display a settlement preview: pro-rata hours, pro-rata salary, deficit (if any), deduction, final settlement, and unused leave (forfeited).
2. When the admin confirms, the HR Bot shall set employee status to INACTIVE, cancel active QuotaPlans, generate a final MonthlySummary, and post to #hr-alerts.
3. The HR Bot shall calculate settlement using: `pro_rata_salary = effective_salary × (days_worked / total_calendar_days)` and `pro_rata_hours = required_hours × (days_worked / total_calendar_days)`.
4. If offboarding occurs during an active quota redistribution plan, the HR Bot shall use STANDARD hours (not redistributed) for the entire plan period to calculate net shortfall.
5. The HR Bot shall forfeit all unused paid leave on termination (no encashment per Nepal contractor standard).

---

### Requirement 19: Employee Editing
**Objective:** As an administrator, I want to edit employee details through a modal, so that records stay current without direct sheet access.

#### Acceptance Criteria
1. When an admin issues `/edit-employee @employee`, the HR Bot shall open a pre-populated modal with editable fields: name, email, position, manager_id, leave config, status.
2. If position is changed, the HR Bot shall log to #hr-alerts and apply new hour requirements from the first of the next month.
3. If status is changed to INACTIVE, the HR Bot shall trigger the same offboard settlement logic.
4. If status is changed from INACTIVE to ACTIVE (reactivation), the HR Bot shall require a new join date and salary entry.
5. The HR Bot shall not allow editing salary via this modal; salary changes shall require `/salary-history @employee set`.

---

### Requirement 20: Team Leave Calendar
**Objective:** As an employee, I want to see who's on leave across the team, so that I can plan my work and collaboration.

#### Acceptance Criteria
1. When any employee issues `/team-leave`, the HR Bot shall display who is on approved leave today.
2. When any employee issues `/team-leave week`, the HR Bot shall display a day-by-day leave calendar for the current week.
3. When any employee issues `/team-leave YYYY-MM`, the HR Bot shall display all approved leave for that month.
4. While the caller is a regular employee, the HR Bot shall show "On Leave" without disclosing leave type (paid/unpaid/shift).
5. While the caller is a manager or admin, the HR Bot shall show the leave type alongside each name.
6. The HR Bot shall only display approved leave (from LeaveRequests with status=APPROVED and PreApprovals), not pending requests.

---

### Requirement 21: Role-Aware Help
**Objective:** As an employee, I want `/hr-help` to show only the commands I can use, so that I'm not confused by commands I lack permission for.

#### Acceptance Criteria
1. When an employee issues `/hr-help`, the HR Bot shall display only employee-level commands (attendance, personal data, leave, team-leave).
2. When a manager issues `/hr-help`, the HR Bot shall display employee commands plus manager commands (team views, approvals, salary history).
3. When an admin issues `/hr-help`, the HR Bot shall display employee, manager, and admin commands (onboard, offboard, edit-employee).
4. The HR Bot shall group commands by category with brief descriptions.

---

### Requirement 22: Hours Self-Service Views
**Objective:** As an employee, I want detailed views of my hours at daily, weekly, and monthly levels, so that I can self-correct before shortfalls become deductions.

#### Acceptance Criteria
1. When an employee issues `/hours` with no arguments, the HR Bot shall display a current snapshot: today's hours, this week's hours, this month's hours, each against their minimum with warnings.
2. When an employee issues `/hours YYYY-MM-DD`, the HR Bot shall display all sessions and breaks for that date with net hours.
3. When an employee issues `/hours week`, the HR Bot shall display a day-by-day breakdown for the current week with daily min checks and weekly total.
4. When an employee issues `/hours month YYYY-MM`, the HR Bot shall display a full monthly report: summary, weekly breakdown, daily detail, bank availability, and leave balance.
5. The HR Bot shall include automatic warnings in every `/hours` response: daily shortfall, weekly shortfall, monthly pace warning ("You need Xh in Y remaining days"), and bank expiry warnings.

---

### Requirement 23: Manager Team Views
**Objective:** As a manager, I want consolidated views of my team's hours, flags, banking, reports, and payroll, so that I can manage my direct reports effectively.

#### Acceptance Criteria
1. When a manager issues `/team-hours`, the HR Bot shall display a summary of all direct reports' hours for the current month against their requirements.
2. When a manager issues `/team-flags`, the HR Bot shall display all PENDING shortfall flags for direct reports with resolution buttons.
3. When a manager issues `/team-bank`, the HR Bot shall display all manager-approved banked surplus for direct reports with remaining hours and expiry dates.
4. When a manager issues `/team-reports`, the HR Bot shall display daily report submission status for direct reports.
5. When a manager issues `/team-reports week` or `/team-reports YYYY-MM`, the HR Bot shall display weekly or monthly report submission summaries.

---

### Requirement 24: Time-Driven Triggers
**Objective:** As a system, I want automated checks to run on schedule, so that shortfalls, reminders, and payroll summaries are generated without manual intervention.

#### Acceptance Criteria
1. The HR Bot shall run a daily trigger at 23:55 JST to check for unclosed sessions and generate daily shortfall flags.
2. The HR Bot shall run a weekly trigger on Monday at 00:15 JST to generate weekly shortfall summaries.
3. The HR Bot shall run a monthly trigger on the 1st at 00:30 JST to generate monthly payroll summaries, monthly shortfall flags, process surplus expiry, and trigger leave accrual.
4. The HR Bot shall run a reminder trigger every 4 hours to check for pending leave requests older than 24 hours and surplus entries within 30 days of expiry.

---

### Requirement 25: Channel & Privacy Model
**Objective:** As an employee, I want my personal data (hours, salary, leave balance) kept private, so that only I and authorized managers see it.

#### Acceptance Criteria
1. The HR Bot shall post attendance events (`/in`, `/out`, `/break`, `/back`) to `#attendance` as public messages showing only name, action, and time — never personal data.
2. The HR Bot shall post daily report summaries to `#daily-reports` as public messages.
3. The HR Bot shall post leave request notifications to `#leave-requests` for manager visibility.
4. The HR Bot shall post shortfall flags to `#hr-flags` (private channel, managers/admin only).
5. The HR Bot shall post system alerts (onboard, offboard, salary changes) to `#hr-alerts` (private channel, admin only).
6. All slash commands returning personal data (hours, salary, deficit, leave balance, payroll, flags) shall use `response_type: "ephemeral"` — visible only to the caller.
7. The HR Bot shall use DMs for sensitive notifications: deficit warnings, surplus expiry alerts, welcome messages, flag alerts.

---

### Requirement 26: Concurrency & Performance
**Objective:** As a system administrator, I want the system to handle concurrent requests safely, so that simultaneous commands don't corrupt data.

#### Acceptance Criteria
1. The HR Bot shall acquire a script-level lock (LockService.getScriptLock()) before any write operation to Google Sheets.
2. If the lock cannot be acquired within 10 seconds, the HR Bot shall respond with "System is busy, please try again in a few seconds."
3. The HR Bot shall use the batch-read pattern: read each needed sheet once at the start of a handler, then compute in memory — never read sheets inside loops.
4. The HR Bot shall store and calculate all timestamps in JST (UTC+9).

---

### Requirement 27: Data Validation & Error Handling
**Objective:** As an employee, I want clear error messages when I make mistakes, so that I can correct my input without confusion.

#### Acceptance Criteria
1. When an invalid date format is provided, the HR Bot shall respond with "Invalid date format. Use YYYY-MM-DD."
2. When a date range has start_date > end_date, the HR Bot shall reject with an appropriate error.
3. When a referenced employee (@mention, email, or EMP-id) doesn't exist, the HR Bot shall respond with a not-found error.
4. The HR Bot shall validate unique constraints on slack_id, email, and user_id during onboarding.
5. The HR Bot shall validate salary > 0 and that manager_id references an active employee during onboarding and editing.
