# Requirements Document

## Introduction
/fix command for the Slack HR Bot — allows employees to submit corrections to past attendance records through Slack. Corrections go through a manager approval workflow, are tagged as manual fixes for audit trail, and trigger recalculation of affected hours when approved.

## Requirements

### Requirement 1: Fix Submission
**Objective:** As an employee, I want to submit corrections for past attendance mistakes, so that my hours are accurately recorded.

#### Acceptance Criteria
1. When an employee issues `/fix YYYY-MM-DD HH:MM action`, the Fix System shall create a pending fix request with the proposed correction.
2. The Fix System shall support these fix types: add a missed IN event, add a missed OUT event, add a missed BREAK_START, add a missed BREAK_END, cancel an erroneous event.
3. The Fix System shall validate that the proposed date is in the past (not today or future).
4. The Fix System shall validate that the proposed time creates a valid state transition (e.g., cannot add OUT before IN).
5. When a fix is submitted, the Fix System shall DM the employee's manager with the proposed fix details and approve/reject buttons.

---

### Requirement 2: Manager Approval Workflow
**Objective:** As a manager, I want to review and approve/reject fix requests, so that only legitimate corrections are applied.

#### Acceptance Criteria
1. When a manager clicks "Approve" on a fix request, the Fix System shall append the corrective event to the Events tab with source=EVENT_SOURCES.MANUAL_FIX.
2. When a manager clicks "Reject" on a fix request, the Fix System shall mark the fix as rejected and notify the employee.
3. While a fix request is pending, the Fix System shall not apply any changes to the Events tab.
4. When a fix is approved, the Fix System shall recalculate hours for the affected day and update any existing daily/monthly totals.
5. The Fix System shall update the original Slack message to show the resolution status.

---

### Requirement 3: Audit Trail
**Objective:** As an administrator, I want all manual fixes tracked and visible, so that the audit trail is complete.

#### Acceptance Criteria
1. The Fix System shall store all fix requests (pending, approved, rejected) in a FixRequests sheet tab.
2. When a fix is approved, the appended Events row shall have source=EVENT_SOURCES.MANUAL_FIX (distinct from 'slack_command' or 'scheduled').
3. The Fix System shall post to #hr-alerts for every approved fix: employee name, date, what was changed, approved by whom.
4. When a manager or admin views /team-hours or /payroll, manually-fixed events shall be visually distinguishable (no special formatting needed — the source field in Events provides the distinction).

---

### Requirement 4: Fix Request Data Model
**Objective:** As a system, I want fix requests stored in a structured sheet tab, so that the workflow state is persistent.

#### Acceptance Criteria
1. The Fix System shall use a FixRequests tab with columns: id, user_id, target_date, target_time, proposed_action, reason, status (PENDING/APPROVED/REJECTED), requested_at, reviewed_by, reviewed_at.
2. The Seed Script shall create the FixRequests tab with correct headers when run.
3. The Fix System shall use the nextId() utility with ID_PREFIX for generating fix request IDs.

---

### Requirement 5: Impact on Hours Calculation
**Objective:** As an employee, I want approved fixes to immediately update my hours, so that /hours and /payroll reflect the correction.

#### Acceptance Criteria
1. When a fix is approved that adds an event to a past date, the Fix System shall recalculate getDailyHours for that date.
2. If the affected date is in a month that has a MonthlySummary row, the Fix System shall regenerate that MonthlySummary.
3. If the affected date has a shortfall flag, the Fix System shall re-evaluate the flag based on updated hours.
