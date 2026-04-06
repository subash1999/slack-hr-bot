# Requirements Document

## Introduction
Cache management for the Slack HR Bot — combines automatic daily timezone refresh, manual cache invalidation via admin command, and leave balance reconciliation. Ensures cached data stays fresh and provides admin control over the cache lifecycle.

## Requirements

### Requirement 1: Daily Timezone Refresh
**Objective:** As a system, I want employee timezones refreshed daily from Slack, so that date calculations use each employee's actual location.

#### Acceptance Criteria
1. The daily trigger shall call Slack's users.info API for each active employee to fetch their current tz_offset.
2. When a tz_offset is successfully retrieved, the Cache System shall update the Employees.tz_offset column for that employee.
3. If the Slack API call fails for an employee, the Cache System shall retain the existing tz_offset value and log the failure.
4. The Cache System shall invalidate the Employees CacheService entry after updating any tz_offset values.

---

### Requirement 2: Manual Cache Refresh Command
**Objective:** As an admin, I want a /cache-refresh command to force-clear all caches, so that I can fix stale data issues immediately.

#### Acceptance Criteria
1. When an admin issues /cache-refresh, the Cache System shall invalidate all CacheService entries (Employees, Positions, Policies).
2. When an admin issues /cache-refresh, the Cache System shall re-fetch tz_offset from Slack for all active employees.
3. When an admin issues /cache-refresh, the Cache System shall run leave balance reconciliation (compare cached vs computed, auto-fix discrepancies).
4. The Cache System shall return a summary: caches cleared, TZ offsets updated, leave balance fixes applied.
5. If a non-admin issues /cache-refresh, the Cache System shall respond with "Only admins can use this command."

---

### Requirement 3: Leave Balance Reconciliation
**Objective:** As a system, I want leave balances verified and auto-corrected monthly, so that cached values never drift from the source of truth.

#### Acceptance Criteria
1. The monthly trigger shall compute leave balance from scratch (accrual history + approved paid leave count) for each active employee.
2. If the computed balance differs from Employees.leave_balance by more than 0.01, the Cache System shall update the cached value and log the discrepancy.
3. When /cache-refresh is run, the Cache System shall perform the same reconciliation immediately.

---

### Requirement 4: Salary Correction — No Cache Invalidation
**Objective:** As an administrator, I want salary corrections to work without cache invalidation, so that retroactive fixes are automatic.

#### Acceptance Criteria
1. The Seed Script shall document that salary is resolved on-the-fly from SalaryHistory via getEffectiveSalary() — no cache exists for salary.
2. When a backdated SalaryHistory entry is added, the /payroll command for the affected month shall automatically show the corrected salary without any manual cache action.
