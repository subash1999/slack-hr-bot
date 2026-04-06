# Implementation Plan

> **TDD Approach**: Every task writes tests FIRST, then implementation. All source files use `.ts` (TypeScript). Tests run locally with Jest + ts-jest. Typed GAS mocks in `tests/mocks/`.

- [x] 1. Project setup, test infrastructure, and foundation
- [x] 1.1 Set up project structure with TypeScript, Jest, clasp, ESLint, Prettier, and typed GAS mocks
  - Initialize npm project with Jest 29.x and @google/clasp as dev dependencies
  - Configure jest.config.json: testEnvironment=node, roots=tests, moduleFileExtensions=[js,json]
  - Create .clasp.json with rootDir=src and .claspignore (exclude tests/, node_modules/, package.json, jest.config.json, *.test.js)
  - Create package.json scripts: test, test:unit, test:integration, test:coverage, push, pull, deploy, e2e
  - Build GAS mock library (tests/mocks/gas-services.js): SpreadsheetApp (sheets, ranges, getValues, appendRow), UrlFetchApp (fetch with response), CacheService (in-memory store), LockService (tryLock/releaseLock), PropertiesService (in-memory), ContentService (createTextOutput)
  - All mocks use Jest spy functions for assertion tracking
  - _Requirements: 26.1, 26.2, 26.3_

- [x] 1.2 Create the Apps Script project with configuration management
  - Set up the Apps Script project, configure Script Properties for SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, and SHEET_ID
  - Create the configuration module (src/config.js) with all 13 tab names, column index constants, and Slack channel IDs
  - All files use dual-mode pattern: `if (typeof module !== 'undefined') { module.exports = { ... }; }`
  - Implement the keep-alive trigger function (no-op, runs every 5 minutes to prevent cold starts)
  - _Requirements: 1.3, 26.4_

- [x] 1.3 (P) Build the data access layer with locking and caching
  - Write integration tests first: verify getAll returns 2D array, appendRow adds row, updateCell modifies cell, lock contention returns "System is busy", cache returns stale data within TTL, invalidateCache forces fresh read
  - Implement SheetService with dependency injection: `SheetService(spreadsheetApp)` — tests inject mock, production uses GAS global
  - Implement batch getAll(), appendRow(), updateCell() with script-level lock (tryLock 10000ms)
  - Add CacheService layer for config tables (Employees, Positions, Policies) with 10-minute TTL
  - Implement cache invalidation function, always flush() before releaseLock()
  - _Requirements: 26.1, 26.2, 26.3_

- [x] 1.4 (P) Build the Slack API client utility
  - Write integration tests first: verify postToResponseUrl calls UrlFetchApp.fetch with correct URL/headers/body, verify retry on failure logs to FailedResponses, verify sendDM constructs correct payload, verify openModal calls with trigger_id
  - Implement SlackUtil with dependency injection for UrlFetchApp
  - Implement postToResponseUrl with retry (1 retry, log failures), postToChannel, sendDM, openModal, updateMessage
  - _Requirements: 3.2, 25.1, 25.2, 25.3, 25.4, 25.5, 25.6, 25.7_

- [x] 1.5 (P) Build shared utility modules with unit tests
  - Write unit tests first for every function:
    - DateUtil: JST conversion, today in JST, week start/end (Mon-Sun), month day count (including leap year), date parsing, date validation
    - ValidateUtil: valid/invalid date formats, date range (start <= end), employee ref resolution (@mention, email, EMP-id)
    - FormatUtil: ephemeral message builder, public attendance message builder, error message builder
  - Implement all utility functions as pure functions (no GAS dependencies)
  - _Requirements: 26.4, 27.1, 27.2, 27.3_

- [x] 2. Authentication, routing, and entry point
- [x] 2.1 Build the auth module with full test coverage
  - Write integration tests first (using mocked Employees sheet data):
    - Unregistered user → "You're not registered"
    - Inactive user → "Your account is inactive"
    - Employee (no reports, not admin) → role="employee"
    - Manager (has direct reports) → role="manager"
    - Admin (is_admin=TRUE) → role="admin"
    - CEO (EMP000) → role="admin"
    - requireRole: employee can't access manager commands, manager can't access admin commands
    - canAccessEmployee: manager scoped to direct reports, admin to all
    - Verification token match → pass; mismatch → reject
  - Implement verifyToken, getRole, requireRole, canAccessEmployee with dependency injection for sheet reads
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

- [x] 2.2 Build the doPost entry point and command router
  - Write integration tests: verify slash command routing (command field → correct handler called), verify block_actions routing (action_id → correct handler), verify view_submission routing (callback_id → correct handler), verify modal commands call views.open before sheet work
  - Implement doPost(e): parse payload type, call auth, route to handler
  - Return ContentService ack after all processing (best-effort pattern)
  - _Requirements: 3.1, 3.3_

- [x] 3. Attendance tracking with state machine
- [x] 3.1 Implement and test clock state resolution
  - Write unit tests for state derivation from events:
    - No events → IDLE
    - Last event OUT → IDLE
    - Last event IN → CLOCKED_IN
    - Last event BREAK_END → CLOCKED_IN
    - Last event BREAK_START → ON_BREAK
  - Write integration tests for all 12 state transition scenarios:
    - IDLE + /in → CLOCKED_IN (verify IN event appended)
    - IDLE + /out → error "You haven't clocked in"
    - IDLE + /break → error "Clock in first"
    - IDLE + /back → error "You're not on a break"
    - CLOCKED_IN + /in → error "Already clocked in since HH:MM"
    - CLOCKED_IN + /out → IDLE (verify OUT appended, hours calculated)
    - CLOCKED_IN + /break → ON_BREAK (verify BREAK_START appended)
    - CLOCKED_IN + /back → error "You're not on a break"
    - ON_BREAK + /in → error "Already clocked in since HH:MM"
    - ON_BREAK + /out → error "Use /back first"
    - ON_BREAK + /break → error "Already on break since HH:MM"
    - ON_BREAK + /back → CLOCKED_IN (verify BREAK_END appended)
  - Write idempotency test: same /in within 60 seconds → rejected
  - Implement getClockState() and validateTransition()
  - _Requirements: 4.5, 4.6, 4.7, 4.8, 4.9_

- [x] 3.2 Implement /in, /out, /break, /back with full scenario tests
  - Write integration tests for multi-command flows:
    - Full cycle: /in → /break → /back → /out → verify 4 events, correct hours
    - Double break: /in → /break → /back → /break → /back → /out → verify hours minus both breaks
    - Multiple sessions: /in → /out → /in → /out → verify cumulative daily hours = sum of both sessions
    - Cross-midnight: IN at 22:00 Mar 28, OUT at 02:00 Mar 29 → verify all 4h on Mar 28
    - Verify #attendance channel receives public message for each command (name + action + time, no personal data)
    - Verify Events tab is append-only (no edits/deletes in mock)
  - Implement all four handlers
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 3.3 Implement /clock-status command with tests
  - Write tests: IDLE shows "Not clocked in", CLOCKED_IN shows session duration, ON_BREAK shows break duration
  - Verify response is ephemeral
  - _Requirements: 4.10_

- [x] 4. Hours calculation engine
- [x] 4.1 Implement daily/weekly/monthly hours calculation with comprehensive tests
  - Write unit tests first (pure functions, no mocks needed):
    - getDailyHours: single session (3h), multiple sessions (2h + 1.5h = 3.5h), with one break (15min deducted), with multiple breaks, zero hours (no events), cross-midnight session
    - getWeeklyHours: full week Mon-Sun, partial week (join mid-week), verify daily breakdown
    - getMonthlyHours: worked hours + paid leave (8h/day) + credited absence + unpaid (0h), verify each component contributes correctly
  - Implement as pure functions with no side effects
  - _Requirements: 5.1, 13.3_

- [x] 4.2 Implement hour requirement resolution with tests
  - Write unit tests:
    - No override → resolve via Employees.position → Positions.policy_group → Policies.min_*_hours
    - Override exists → use override hours instead
    - CEO position → Full-Time policy → 3h/30h/160h
    - Intern position → Intern policy → 3h/15h/80h
    - Mid-month position change → old requirements for current month
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.6_

- [x] 4.3 (P) Implement payroll calculation with exhaustive tests
  - Write unit tests:
    - Normal: salary=400K, required=160h, actual=150h → deficit=10h, hourly_rate=2500, deduction=25000, final=375000
    - No deficit: actual >= required → deduction=0, final=salary
    - Rounding: deduction 187.3 → 188 (Math.ceil)
    - Bank offset: deficit=40h, bank=40h → effective_deficit=0, deduction=0
    - Partial bank: deficit=40h, bank=20h → effective_deficit=20h
    - Pro-rata join: joins Mar 15 (17 remaining of 31 days), salary=100K → 54,839
    - Pro-rata termination: terminates Apr 20 (20 of 30 days), salary=100K → 66,667
    - Salary blending: 300K for 14 days + 350K for 16 days → 326,667
    - getEffectiveSalary: 3 history entries, verify correct month resolution
    - Backdated salary correction: new entry added, verify affected month uses corrected value
  - _Requirements: 13.1, 13.2, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9_

- [x] 5. Employee self-service views
- [x] 5.1 Implement /hours command with tests for all view modes
  - Write integration tests with mocked sheet data:
    - Default: verify today/week/month shown against minimums with correct warning indicators
    - Date view: verify all sessions and breaks listed for that date
    - Week view: verify day-by-day breakdown with daily min checks
    - Month view: verify summary, weekly breakdown, bank availability, leave balance
    - Warning triggers: daily shortfall, weekly shortfall, monthly pace, bank expiry
  - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5_

- [x] 5.2 (P) Implement /balance and /my-bank with tests
  - Write tests: balance from cached leave_balance, next accrual date, max cap, recent history
  - Write tests: bank entries with surplus/used/remaining, expiry dates, 30-day warning indicator
  - _Requirements: 11.4, 9.6_

- [x] 5.3 (P) Implement /payroll command with tests
  - Write integration tests: verify before/after 15th default behavior, specific month view, all display fields match calculation
  - Verify uses getEffectiveSalary from SalaryHistory, NOT Employees.salary
  - _Requirements: 13.10_

- [x] 5.4 (P) Implement role-aware /hr-help with tests
  - Write tests: employee sees 13 commands, manager sees 22 commands, admin sees 25 commands
  - Verify commands grouped by category
  - _Requirements: 21.1, 21.2, 21.3, 21.4_

- [x] 6. Leave management
- [x] 6.1 Implement /request-leave command with tests
  - Write integration tests:
    - Single date: verify LeaveRequest row with PENDING
    - Date range: verify one row per day in range
    - Invalid date → error, start > end → error
    - Verify manager notification DM with correct button options based on balance
  - _Requirements: 10.1, 10.2_

- [x] 6.2 Implement leave approval workflow with interactive button tests
  - Write integration tests for every approval path:
    - Balance > 0 + Approve Paid → verify 8h credit, balance -1, leave_balance updated, message updated, employee DM
    - Balance > 0 + Approve Unpaid → verify 0h, no balance change
    - Balance > 0 + Reject → verify status=REJECTED, no changes
    - Balance = 0 + Shift Permission → verify 0h, no balance change
    - Balance = 0 + Approve Unpaid → verify 0h
    - Balance = 0 + Approve Paid → verify REJECTION (negative balance prevented)
    - Verify original Slack message updated after each action
  - _Requirements: 10.3, 10.4, 10.5, 10.6, 10.7, 10.9, 10.10_

- [x] 6.3 Implement /team-leave with role-aware privacy tests
  - Write integration tests:
    - Employee calling: verify names shown as "On Leave" (no type)
    - Manager calling: verify type shown for direct reports, "On Leave" for others
    - Admin calling: verify type shown for all
    - Today/week/month views: verify correct date filtering
    - Only APPROVED leave shown (not PENDING)
    - PreApprovals included in calendar
  - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6_

- [x] 7. Daily standup reports
- [x] 7.1 Implement /report modal submission with tests
  - Write integration tests: modal opens with trigger_id, submission stores row in DailyReports, inline parsing works for pipe-separated text
  - _Requirements: 12.1, 12.2_

- [x] 7.2 (P) Implement report viewing with permission tests
  - Write tests: own report by date, own reports by week, manager views direct report's report, non-manager accessing other's report → permission denied
  - _Requirements: 12.3, 12.4, 12.5, 12.6_

- [x] 8. Hours enforcement and flag system
- [x] 8.1 Implement shortfall detection with comprehensive tests
  - Write integration tests:
    - Daily shortfall: worked 2h, min 3h, no leave → flag created
    - Daily shortfall with approved leave → NO flag (skipped)
    - Daily shortfall with pre-approval → NO flag (skipped)
    - Weekly shortfall: 25h worked, min 30h → flag created
    - Monthly shortfall: 140h, min 160h, no override → flag created
    - Monthly with override: override=140h, worked 140h → NO flag
    - Anti-double-penalty: daily flag + monthly no-deficit → verify only daily flag, no deduction
    - Monthly flag PENDING → verify no deduction applied in payroll
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 8.2 Implement flag resolution workflow with button interaction tests
  - Write integration tests for each resolution path:
    - Use Bank: deficit=40h, bank=40h → verify HoursBank.used_hours += 40, flag=BANK_OFFSET, effective_deficit=0
    - Partial Bank: deficit=40h, use 20h → verify used_hours += 20, remaining deficit=20h
    - Deduct Full: verify flag=APPROVED_DEDUCT, full deficit recorded
    - No Penalty: verify flag=APPROVED_NO_PENALTY, deduction=0
    - Discuss: verify flag stays PENDING
    - Verify Slack message updated after each button click
    - Verify bank info displayed alongside flag when bank entries exist
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

- [x] 9. Surplus hours banking
- [x] 9.1 Implement /approve-surplus with tests
  - Write integration tests:
    - Valid approval → verify HoursBank entry with correct surplus_hours, max_leave_days, expires_at (12 months)
    - Manager for non-report → denied
    - Surplus = 0 or negative → rejected
    - Verify surplus never cashable (no extra salary)
  - _Requirements: 9.1, 9.2, 9.3_

- [x] 9.2 (P) Implement bank expiry and notification tests
  - Write tests: entry within 30 days of expiry → DM warning sent, expired entry → marked expired with remaining forfeited, expired entry cannot be used for offset
  - _Requirements: 9.4, 9.5_

- [x] 10. Manager approval commands
- [x] 10.1 Implement /approve-absence with tests
  - Write integration tests for each type:
    - Paid Leave → 8h credit, balance deducted
    - Unpaid Leave → 0h, no flag, no balance
    - Make-Up → 0h, compensate later
    - Credited Absence → 8h, NO balance deduction
    - Verify PreApproval entry created
    - Verify flag generation skips pre-approved dates (cross-test with 8.1)
  - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6_

- [x] 10.2 (P) Implement /adjust-quota with tests
  - Write integration tests:
    - Monthly redistribution: Apr=140h + May=180h, total=320h → verify Override entries + QuotaPlans
    - Adjusted total < original → verify warning shown
    - Daily redistribution: 5 days totaling 30h → verify daily Override entries
    - Weekly redistribution: 4 weeks totaling 160h → verify weekly Override entries
    - Verify Override used instead of policy default during hour checks
  - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_

- [x] 11. Manager team views
- [x] 11.1 Implement /team-hours with scope tests
  - Write tests: manager sees only direct reports, admin sees all, correct hours/deficit per employee
  - _Requirements: 23.1_

- [x] 11.2 (P) Implement /team-flags with interactive resolution
  - Write tests: only PENDING flags shown, resolution buttons work inline, bank info displayed
  - _Requirements: 23.2_

- [x] 11.3 (P) Implement /team-bank
  - Write tests: only manager-approved entries shown, remaining hours and expiry dates correct
  - _Requirements: 23.3_

- [x] 11.4 (P) Implement /team-reports with submission tracking
  - Write tests: today/week/month views, missing reporters identified, submission rates correct
  - _Requirements: 23.4, 23.5_

- [x] 11.5 (P) Implement /team-payroll
  - Write tests: summary table with correct columns, pending flags highlighted, team totals
  - _Requirements: 13.11_

- [x] 12. Salary history management
- [x] 12.1 Implement /salary-history view and update with tests
  - Write tests: view shows full history (manager: direct reports; admin: any), set creates SalaryHistory entry + updates Employees.salary, change types validated, append-only (never edit)
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

- [x] 13. Employee lifecycle management
- [x] 13.1 Implement /onboard with comprehensive validation tests
  - Write integration tests:
    - Valid onboard → Employees row + SalaryHistory INITIAL + welcome DM + cache invalidated
    - Duplicate slack_id → rejection
    - Duplicate email → rejection
    - salary <= 0 → rejection
    - Invalid manager_id → rejection
    - Auto-generated user_id = EMP + next number
  - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

- [x] 13.2 Implement /offboard with settlement tests
  - Write integration tests:
    - Normal offboard: verify pro-rata salary, pro-rata hours, deficit, deduction, final settlement
    - Unused leave forfeited (no encashment)
    - Active quota plan: verify STANDARD hours used for settlement, net shortfall calculated
    - Status set to INACTIVE, QuotaPlans cancelled, MonthlySummary created, #hr-alerts posted
  - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5_

- [x] 13.3 Implement /edit-employee with change-effect tests
  - Write integration tests:
    - Position change → #hr-alerts log, new hours from next month
    - Status → INACTIVE triggers offboard
    - INACTIVE → ACTIVE requires new join date + salary
    - Salary NOT editable (must use /salary-history set)
    - Cache invalidated after any change
  - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_

- [x] 14. Time-driven triggers
- [x] 14.1 Implement daily trigger (23:55 JST) with tests
  - Write integration tests:
    - Open break at 23:55 → auto-close (BREAK_END appended), flagged for admin review
    - Open session → flagged incomplete, NOT auto-closed
    - Daily shortfall detection runs for all active employees
    - Idempotency: running twice for same day doesn't create duplicate flags
  - _Requirements: 5.2, 5.3, 7.1, 24.1_

- [x] 14.2 (P) Implement weekly trigger (Monday 00:15 JST) with tests
  - Write tests: weekly shortfall flags generated for previous week, idempotent
  - _Requirements: 7.2, 24.2_

- [x] 14.3 Implement monthly trigger (1st 00:30 JST) with comprehensive tests
  - Write integration tests:
    - Monthly shortfall flags generated for all employees
    - Surplus expiry: entries past 12 months marked expired
    - Leave accrual: eligible employees get balance increment, probation employees skipped, cap enforced
    - Reconciliation: recalculateLeaveBalance vs cached leave_balance, log discrepancies
    - MonthlySummary rows created, idempotent (no duplicates)
  - _Requirements: 7.3, 9.5, 11.1, 11.2, 11.3, 24.3_

- [x] 14.4 (P) Implement reminder trigger (every 4 hours) with tests
  - Write tests: pending leave >24h → manager reminder DM, bank entries within 30 days of expiry → warning DMs
  - _Requirements: 10.8, 9.4, 24.4_

- [x] 15. Cache invalidation and retroactive corrections
- [x] 15.1 Implement leave balance cache management with tests
  - Write integration tests:
    - Leave approval (paid) → leave_balance decremented
    - Monthly accrual → leave_balance incremented
    - Retroactive leave correction (PAID→UNPAID) → recalculateLeaveBalance recomputes from scratch, cache updated
    - Balance at cap → no overshoot after accrual
    - recalculateLeaveBalance matches cached value after normal operations
  - _Requirements: 11.1, 11.2, 11.3_

- [x] 15.2 (P) Implement retroactive correction handling with tests
  - Write integration tests:
    - Salary correction: backdated SalaryHistory entry → /payroll for affected month shows corrected values (no cache invalidation needed)
    - Hours correction: corrective event appended → recalculate month, regenerate MonthlySummary if changed
    - Employee edit → CacheService invalidated
    - Monthly reconciliation: introduce deliberate discrepancy, verify it's logged
  - _Requirements: 14.1, 26.1_

- [x] 16. E2E tests against staging environment
- [x] 16.1 Set up staging environment and E2E test runner
  - Create a staging Google Sheet with all 13 tabs and seed data
  - Create E2E test runner (Node script) that sends HTTP POST to deployed GAS web app URL
  - Configure test Slack workspace or use a test channel
  - _Requirements: 26.1_

- [x] 16.2 Implement E2E attendance flow tests
  - Full cycle against real sheet: /in → /break → /back → /out → verify Events tab rows via Sheets API
  - Multiple sessions: /in → /out → /in → /out → verify cumulative hours
  - State rejections: /in twice → verify error response
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1_

- [x] 16.3 (P) Implement E2E leave and payroll flow tests
  - Leave cycle: /request-leave → verify pending row → simulate approval → verify balance change
  - Payroll: /payroll → verify response matches expected calculation
  - _Requirements: 10.1, 10.5, 13.10_

- [x] 16.4 (P) Implement E2E trigger tests
  - Invoke monthly trigger via clasp run → verify Flags, MonthlySummary, accrual rows in staging sheet
  - _Requirements: 24.3_
