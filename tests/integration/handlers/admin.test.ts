import { handleOnboard, handleOffboard, handleEditEmployee } from '../../../src/handlers/admin';
import { createMockSheetsService, createMockSlackService } from '../../mocks/gas-mocks';
import { TABS, EMP, SAL } from '../../../src/config';
import { DEFAULT_EMPLOYEES } from '../../fixtures/employees';
import { EMPTY_EVENTS } from '../../fixtures/events';
import type { CallerInfo, SheetData } from '../../../src/types';

const ADMIN: CallerInfo = {
  user_id: 'EMP000', slack_id: 'UCEO001', name: 'John', email: 'john@example.com',
  role: 'admin', position: 'CEO', manager_id: 'none',
  is_admin: true, status: 'ACTIVE', salary: 0, join_date: '2026-01-01', leave_balance: 0, rowIndex: 1,
};

const SAL_HEADER = ['id', 'user_id', 'effective_date', 'old_salary', 'new_salary', 'change_type', 'reason', 'approved_by', 'created_at'];
const QP_HEADER = ['plan_id', 'user_id', 'plan_type', 'created_by', 'created_at', 'status', 'notes'];
const MS_HEADER = ['user_id', 'month', 'worked', 'leave', 'total', 'required', 'deficit', 'bank', 'eff_deficit', 'status'];
const POS_DATA = [['position', 'policy_group', 'desc'], ['Full Time Developer', 'Full-Time', ''], ['CEO', 'Full-Time', ''], ['CTO', 'Full-Time', '']];
const POL_DATA = [['policy_group', 'min_daily', 'min_weekly', 'min_monthly', 'desc'], ['Full-Time', 3, 30, 160, '']];
const LR_HEADER = ['id', 'user_id', 'date', 'type', 'status', 'requested_at', 'approved_by', 'approved_at', 'notes'];
const PA_HEADER = ['id', 'user_id', 'date', 'type', 'credit_hours'];
const OVR_HEADER = ['user_id', 'period_type', 'period_value', 'required_hours'];

function makeAdminDeps(extras: Record<string, unknown[][]> = {}) {
  const base: Record<string, unknown[][]> = {
    [TABS.EMPLOYEES]: DEFAULT_EMPLOYEES.map(r => [...r]),
    [TABS.SALARY_HISTORY]: [SAL_HEADER, ['SH1', 'EMP002', '2026-02-01', 0, 350000, 'INITIAL', '', 'EMP000', '']],
    [TABS.QUOTA_PLANS]: [QP_HEADER],
    [TABS.MONTHLY_SUMMARY]: [MS_HEADER],
    [TABS.EVENTS]: EMPTY_EVENTS,
    [TABS.POSITIONS]: POS_DATA,
    [TABS.POLICIES]: POL_DATA,
    [TABS.LEAVE_REQUESTS]: [LR_HEADER],
    [TABS.PRE_APPROVALS]: [PA_HEADER],
    [TABS.OVERRIDES]: [OVR_HEADER],
    ...extras,
  };
  const sheets = createMockSheetsService(base as Record<string, SheetData>);
  const slack = createMockSlackService();
  return { sheetsService: sheets, slackService: slack, sheets, slack };
}

describe('/onboard', () => {
  const validData = {
    name: 'New Employee', email: 'new@example.com', slack_id: 'UNEW001',
    position: 'Full Time Developer', salary: 300000, join_date: '2026-04-01',
    manager_id: 'EMP001', leave_accrual_start_month: 3, leave_accrual_rate: 1, max_leave_cap: 20,
  };

  it('creates Employees row + SalaryHistory INITIAL + welcome DM', () => {
    const deps = makeAdminDeps();
    const result = handleOnboard(ADMIN, validData, deps);
    expect(result.text).toContain('Onboarded');
    expect(result.text).toContain('New Employee');
    // Employees row
    expect(deps.sheets._appendedRows[TABS.EMPLOYEES]).toHaveLength(1);
    expect(deps.sheets._appendedRows[TABS.EMPLOYEES][0][EMP.NAME]).toBe('New Employee');
    expect(deps.sheets._appendedRows[TABS.EMPLOYEES][0][EMP.STATUS]).toBe('ACTIVE');
    // SalaryHistory
    expect(deps.sheets._appendedRows[TABS.SALARY_HISTORY]).toHaveLength(1);
    expect(deps.sheets._appendedRows[TABS.SALARY_HISTORY][0][SAL.CHANGE_TYPE]).toBe('INITIAL');
    // Welcome DM
    expect(deps.slack._calls.sendDM.length).toBeGreaterThanOrEqual(1);
    // Cache invalidated
    expect(deps.sheetsService.invalidateCache).toHaveBeenCalledWith(TABS.EMPLOYEES);
  });

  it('auto-generates user_id as EMP + next number', () => {
    const deps = makeAdminDeps();
    handleOnboard(ADMIN, validData, deps);
    const userId = deps.sheets._appendedRows[TABS.EMPLOYEES][0][EMP.USER_ID] as string;
    expect(userId).toMatch(/^EMP\d{3}$/);
    expect(parseInt(userId.slice(3))).toBeGreaterThan(4); // > EMP004
  });

  it('rejects duplicate slack_id', () => {
    const deps = makeAdminDeps();
    const result = handleOnboard(ADMIN, { ...validData, slack_id: 'UEMP001' }, deps);
    expect(result.text).toContain('already exists');
  });

  it('rejects duplicate email', () => {
    const deps = makeAdminDeps();
    const result = handleOnboard(ADMIN, { ...validData, email: 'alex@example.com' }, deps);
    expect(result.text).toContain('already exists');
  });

  it('rejects salary <= 0', () => {
    const deps = makeAdminDeps();
    const result = handleOnboard(ADMIN, { ...validData, salary: 0 }, deps);
    expect(result.text).toContain('positive');
  });

  it('rejects invalid manager_id', () => {
    const deps = makeAdminDeps();
    const result = handleOnboard(ADMIN, { ...validData, manager_id: 'EMP999' }, deps);
    expect(result.text).toContain('not found');
  });
});

describe('/offboard', () => {
  it('sets INACTIVE + shows settlement', () => {
    const deps = makeAdminDeps();
    const { message, settlement } = handleOffboard(ADMIN, 'EMP002', deps);
    expect(message.text).toContain('Offboarded');
    expect(message.text).toContain('Alex Dev');
    expect(message.text).toContain('forfeited');
    expect(settlement).toBeDefined();
    expect(settlement!.unusedLeave).toBe(3);
    // Status set to INACTIVE
    expect(deps.sheetsService.updateCell).toHaveBeenCalledWith(
      TABS.EMPLOYEES, expect.any(Number), EMP.STATUS + 1, 'INACTIVE',
    );
    // Cache invalidated
    expect(deps.sheetsService.invalidateCache).toHaveBeenCalledWith(TABS.EMPLOYEES);
    // Posted to #hr-alerts
    expect(deps.slack._calls.postToChannel.length).toBeGreaterThanOrEqual(1);
  });

  it('returns error for unknown employee', () => {
    const deps = makeAdminDeps();
    const { message } = handleOffboard(ADMIN, 'EMP999', deps);
    expect(message.text).toContain('not found');
  });
});

describe('/edit-employee', () => {
  it('position change → #hr-alerts + cache invalidated', () => {
    const deps = makeAdminDeps();
    const result = handleEditEmployee(ADMIN, 'EMP002', { position: 'CTO' }, deps);
    expect(result.text).toContain('Position');
    expect(result.text).toContain('CTO');
    expect(deps.slack._calls.postToChannel.length).toBeGreaterThanOrEqual(1);
    expect(deps.sheetsService.invalidateCache).toHaveBeenCalledWith(TABS.EMPLOYEES);
  });

  it('status → INACTIVE triggers offboard', () => {
    const deps = makeAdminDeps();
    const result = handleEditEmployee(ADMIN, 'EMP002', { status: 'INACTIVE' }, deps);
    expect(result.text).toContain('Offboarded');
  });

  it('INACTIVE → ACTIVE rejected (needs /onboard)', () => {
    const deps = makeAdminDeps();
    const result = handleEditEmployee(ADMIN, 'EMP004', { status: 'ACTIVE' }, deps);
    expect(result.text).toContain('Reactivation');
  });

  it('salary edit rejected', () => {
    const deps = makeAdminDeps();
    const result = handleEditEmployee(ADMIN, 'EMP002', { salary: 500000 } as never, deps);
    expect(result.text).toContain('Salary cannot be changed here');
  });

  it('no changes → no changes message', () => {
    const deps = makeAdminDeps();
    const result = handleEditEmployee(ADMIN, 'EMP002', {}, deps);
    expect(result.text).toContain('No changes');
  });
});
