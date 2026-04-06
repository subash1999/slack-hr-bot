import { handleViewHours, handleBalance, handleMyBank, handlePayroll, handleHelp } from '../../../src/handlers/hours';
import { createMockSheetsService } from '../../mocks/gas-mocks';
import { TABS } from '../../../src/config';
import { DEFAULT_EMPLOYEES } from '../../fixtures/employees';
import { buildEventsData, makeEvent, EMPTY_EVENTS } from '../../fixtures/events';
import type { CallerInfo, SheetData } from '../../../src/types';

const EMPLOYEE: CallerInfo = {
  user_id: 'EMP002', slack_id: 'UEMP001', name: 'Alex Dev', email: 'alex@example.com',
  role: 'employee', position: 'Full Time Developer', manager_id: 'EMP001',
  is_admin: false, status: 'ACTIVE', salary: 350000, join_date: '2026-02-01', leave_balance: 3, rowIndex: 3,
};

const MANAGER: CallerInfo = {
  ...EMPLOYEE, user_id: 'EMP001', slack_id: 'UMGR001', name: 'Subash', role: 'manager', rowIndex: 2,
};

const ADMIN: CallerInfo = {
  ...EMPLOYEE, user_id: 'EMP000', slack_id: 'UCEO001', name: 'John', role: 'admin', is_admin: true, rowIndex: 1,
};

function makeHoursDeps(overrides: Record<string, unknown[][]> = {}) {
  const baseTabs: Record<string, unknown[][]> = {
    [TABS.EVENTS]: EMPTY_EVENTS,
    [TABS.EMPLOYEES]: DEFAULT_EMPLOYEES,
    [TABS.POSITIONS]: [
      ['position', 'policy_group', 'description'],
      ['Full Time Developer', 'Full-Time', ''],
      ['CEO', 'Full-Time', ''],
      ['CTO', 'Full-Time', ''],
    ],
    [TABS.POLICIES]: [
      ['policy_group', 'min_daily', 'min_weekly', 'min_monthly', 'desc'],
      ['Full-Time', 3, 30, 160, ''],
    ],
    [TABS.OVERRIDES]: [['user_id', 'period_type', 'period_value', 'required_hours']],
    [TABS.LEAVE_REQUESTS]: [['id', 'user_id', 'date', 'type', 'status', 'requested_at', 'approved_by', 'approved_at', 'notes']],
    [TABS.PRE_APPROVALS]: [['id', 'user_id', 'date', 'type', 'credit_hours']],
    [TABS.HOURS_BANK]: [['user_id', 'period_type', 'period_value', 'required', 'actual', 'surplus', 'used', 'remaining', 'approved_by', 'max_leave_days', 'expires_at']],
    [TABS.SALARY_HISTORY]: [
      ['id', 'user_id', 'effective_date', 'old_salary', 'new_salary', 'change_type'],
      ['SH1', 'EMP002', '2026-02-01', 0, 350000, 'INITIAL'],
    ],
  };
  const merged = { ...baseTabs, ...overrides };
  return {
    sheetsService: createMockSheetsService(merged as Record<string, SheetData>),
  };
}

describe('/hours', () => {
  it('shows snapshot for default (no args)', () => {
    const deps = makeHoursDeps();
    const result = handleViewHours(EMPLOYEE, '', deps);
    expect(result.text).toContain('Hours');
    expect(result.text).toContain('Today');
    expect(result.text).toContain('This Week');
    expect(result.text).toContain('This Month');
    expect(result.response_type).toBe('ephemeral');
  });

  it('shows date detail for specific date', () => {
    const events = buildEventsData(
      makeEvent('2026-03-15T00:00:00Z', 'EMP002', 'Alex', 'IN'),
      makeEvent('2026-03-15T03:00:00Z', 'EMP002', 'Alex', 'OUT'),
    );
    const deps = makeHoursDeps({ [TABS.EVENTS]: events });
    const result = handleViewHours(EMPLOYEE, '2026-03-15', deps);
    expect(result.text).toContain('2026-03-15');
    expect(result.text).toContain('3h');
  });

  it('shows week breakdown', () => {
    const deps = makeHoursDeps();
    const result = handleViewHours(EMPLOYEE, 'week', deps);
    expect(result.text).toContain('Week');
  });

  it('shows month report', () => {
    const deps = makeHoursDeps();
    const result = handleViewHours(EMPLOYEE, 'month 2026-03', deps);
    expect(result.text).toContain('2026-03');
    expect(result.text).toContain('required');
  });

  it('returns error for invalid usage', () => {
    const deps = makeHoursDeps();
    const result = handleViewHours(EMPLOYEE, 'invalid-command', deps);
    expect(result.text).toContain('Usage');
  });
});

describe('/balance', () => {
  it('shows leave balance info', () => {
    const deps = makeHoursDeps();
    const result = handleBalance(EMPLOYEE, deps);
    expect(result.text).toContain('Leave Balance');
    expect(result.text).toContain('Remaining');
    expect(result.response_type).toBe('ephemeral');
  });
});

describe('/my-bank', () => {
  it('shows empty message when no banked hours', () => {
    const deps = makeHoursDeps();
    const result = handleMyBank(EMPLOYEE, deps);
    expect(result.text).toContain('no banked hours');
  });

  it('shows bank entries when they exist', () => {
    const deps = makeHoursDeps({
      [TABS.HOURS_BANK]: [
        ['user_id', 'period_type', 'period_value', 'required', 'actual', 'surplus', 'used', 'remaining', 'approved_by', 'max_leave_days', 'expires_at'],
        ['EMP002', 'MONTHLY', '2026-02', 160, 200, 40, 0, 40, 'EMP001', 5, '2027-02-28'],
      ],
    });
    const result = handleMyBank(EMPLOYEE, deps);
    expect(result.text).toContain('2026-02');
    expect(result.text).toContain('remaining');
  });
});

describe('/payroll', () => {
  it('shows payroll for current/previous month', () => {
    const deps = makeHoursDeps();
    const result = handlePayroll(EMPLOYEE, '', deps);
    expect(result.text).toContain('Payroll');
    expect(result.text).toContain('NPR');
    expect(result.text).toContain('Salary');
    expect(result.response_type).toBe('ephemeral');
  });

  it('shows specific month when provided', () => {
    const deps = makeHoursDeps();
    const result = handlePayroll(EMPLOYEE, '2026-02', deps);
    expect(result.text).toContain('2026-02');
  });
});

describe('/hr-help (role-aware)', () => {
  it('employee sees basic commands only', () => {
    const result = handleHelp(EMPLOYEE);
    expect(result.text).toContain('/in');
    expect(result.text).toContain('/hours');
    expect(result.text).toContain('/team-leave');
    expect(result.text).not.toContain('Manager Commands');
    expect(result.text).not.toContain('Admin Commands');
  });

  it('manager sees employee + manager commands', () => {
    const result = handleHelp(MANAGER);
    expect(result.text).toContain('/in');
    expect(result.text).toContain('Manager Commands');
    expect(result.text).toContain('/team-hours');
    expect(result.text).not.toContain('Admin Commands');
  });

  it('admin sees all commands', () => {
    const result = handleHelp(ADMIN);
    expect(result.text).toContain('/in');
    expect(result.text).toContain('Manager Commands');
    expect(result.text).toContain('Admin Commands');
    expect(result.text).toContain('/onboard');
  });
});
