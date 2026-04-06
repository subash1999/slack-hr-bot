# Requirements Document

## Introduction
Seed script for the Slack HR Bot — an idempotent GAS function that initializes the Google Sheets database with all 13 tabs, correct headers, and default data. Runnable via `clasp run` or as a GAS menu function. Safe to execute multiple times without creating duplicates.

## Requirements

### Requirement 1: Tab Creation & Verification
**Objective:** As an administrator, I want all 13 required sheet tabs created with correct headers, so that the bot has a properly structured database.

#### Acceptance Criteria
1. When the seed script runs and a tab does not exist, the Seed Script shall create the tab with the correct name matching config.ts TABS constants.
2. When the seed script runs and a tab already exists, the Seed Script shall verify the header row matches expected columns and report any mismatches.
3. The Seed Script shall create all 13 tabs: Employees, Events, LeaveRequests, DailyReports, Policies, Overrides, Flags, HoursBank, QuotaPlans, PreApprovals, SalaryHistory, MonthlySummary, Positions.
4. The Seed Script shall set Row 1 of each tab as the header row with column names matching the column index constants in config.ts (EMP, EVT, POS, POL, LR, FLAG, BANK, SAL, PA, OVR, DR).

---

### Requirement 2: Policy Groups Seed Data
**Objective:** As an administrator, I want default policy groups pre-populated, so that employees can be assigned hour requirements immediately.

#### Acceptance Criteria
1. The Seed Script shall create a "Full-Time" policy group with min_daily_hours=3, min_weekly_hours=30, min_monthly_hours=160.
2. The Seed Script shall create an "Intern" policy group with min_daily_hours=3, min_weekly_hours=15, min_monthly_hours=80.
3. If a policy group with the same name already exists, the Seed Script shall skip insertion and report it as "already exists."

---

### Requirement 3: Positions Seed Data
**Objective:** As an administrator, I want all default positions pre-populated and mapped to policy groups, so that employees can be assigned positions immediately.

#### Acceptance Criteria
1. The Seed Script shall create 7 positions: CEO, CTO, Team Lead, Full Time Contract Developer, Full Time Developer, Contract Intern, Intern.
2. The Seed Script shall map CEO, CTO, Team Lead, Full Time Contract Developer, and Full Time Developer to the "Full-Time" policy group.
3. The Seed Script shall map Contract Intern and Intern to the "Intern" policy group.
4. If a position with the same name already exists, the Seed Script shall skip insertion and report it as "already exists."

---

### Requirement 4: CEO Employee Seed Data
**Objective:** As an administrator, I want the CEO account pre-created, so that the admin hierarchy has a root user from day one.

#### Acceptance Criteria
1. The Seed Script shall create an Employees row for the CEO with user_id=EMP000, is_admin=TRUE, status=ACTIVE, manager_id matching CEO_MANAGER_ID constant, position=CEO.
2. The Seed Script shall create a SalaryHistory INITIAL entry for EMP000.
3. If an employee with user_id=EMP000 already exists, the Seed Script shall skip insertion and report it as "already exists."
4. The Seed Script shall use the nextId() utility for generating the SalaryHistory ID.

---

### Requirement 5: Idempotency & Reporting
**Objective:** As an administrator, I want the seed script to be safe to run multiple times, so that I can re-run it without fear of data corruption.

#### Acceptance Criteria
1. The Seed Script shall check for existing data before every insert operation.
2. The Seed Script shall never create duplicate rows for tabs, policies, positions, or the CEO employee.
3. When the seed script completes, it shall return a summary report listing: tabs created vs already existed, policies created vs skipped, positions created vs skipped, CEO created vs skipped.
4. The Seed Script shall log each action (created/skipped) for auditability.

---

### Requirement 6: Execution Entry Point
**Objective:** As an administrator, I want to run the seed script via clasp or the GAS editor, so that initial setup is straightforward.

#### Acceptance Criteria
1. The Seed Script shall expose a `seedDatabase()` function callable via `clasp run seedDatabase` or the Apps Script editor.
2. The Seed Script shall work with the Sheet ID from Script Properties (same as the bot uses).
3. If the Sheet ID is not configured, the Seed Script shall throw a clear error: "SHEET_ID not configured in Script Properties."
