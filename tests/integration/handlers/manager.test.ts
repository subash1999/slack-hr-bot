import { handleTeamHours, handleTeamFlags, handleTeamBank, handleTeamReports, handleTeamPayroll } from '../../../src/handlers/manager';
import { createMockSheetsService } from '../../mocks/gas-mocks';
import { TABS } from '../../../src/config';
import { DEFAULT_EMPLOYEES } from '../../fixtures/employees';
import { EMPTY_EVENTS } from '../../fixtures/events';
import type { CallerInfo, SheetData } from '../../../src/types';

const MANAGER: CallerInfo = {
  user_id: 'EMP001', slack_id: 'UMGR001', name: 'Subash', email: 'jane@example.com',
  role: 'manager', position: 'CTO', manager_id: 'EMP000',
  is_admin: false, status: 'ACTIVE', salary: 400000, join_date: '2026-01-15', leave_balance: 5, rowIndex: 2,
};

const ADMIN: CallerInfo = { ...MANAGER, user_id: 'EMP000', slack_id: 'UCEO001', name: 'John', role: 'admin', is_admin: true, rowIndex: 1 };

const FLAGS_HEADER = ['id', 'user_id', 'period_type', 'period_value', 'expected', 'actual', 'shortfall', 'status', 'bank_offset', 'effective_deficit', 'manager_id', 'resolved_at', 'notes'];
const BANK_HEADER = ['user_id', 'period_type', 'period_value', 'required', 'actual', 'surplus', 'used', 'remaining', 'approved_by', 'max_leave_days', 'expires_at'];
const DR_HEADER = ['date', 'user_id', 'user_name', 'yesterday', 'today', 'blockers', 'submitted_at'];
const LR_HEADER = ['id', 'user_id', 'date', 'type', 'status', 'requested_at', 'approved_by', 'approved_at', 'notes'];
const PA_HEADER = ['id', 'user_id', 'date', 'type', 'credit_hours'];
const OVR_HEADER = ['user_id', 'period_type', 'period_value', 'required_hours'];
const POS_DATA = [['position', 'policy_group', 'desc'], ['Full Time Developer', 'Full-Time', ''], ['CTO', 'Full-Time', ''], ['CEO', 'Full-Time', '']];
const POL_DATA = [['policy_group', 'min_daily', 'min_weekly', 'min_monthly', 'desc'], ['Full-Time', 3, 30, 160, '']];
const SAL_DATA = [
  ['id', 'user_id', 'effective_date', 'old_salary', 'new_salary', 'change_type'],
  ['SH1', 'EMP002', '2026-02-01', 0, 350000, 'INITIAL'],
  ['SH2', 'EMP003', '2026-03-01', 0, 300000, 'INITIAL'],
];

function makeManagerDeps(extras: Record<string, unknown[][]> = {}) {
  const base: Record<string, unknown[][]> = {
    [TABS.EMPLOYEES]: DEFAULT_EMPLOYEES,
    [TABS.EVENTS]: EMPTY_EVENTS,
    [TABS.POSITIONS]: POS_DATA,
    [TABS.POLICIES]: POL_DATA,
    [TABS.OVERRIDES]: [OVR_HEADER],
    [TABS.FLAGS]: [FLAGS_HEADER],
    [TABS.HOURS_BANK]: [BANK_HEADER],
    [TABS.DAILY_REPORTS]: [DR_HEADER],
    [TABS.LEAVE_REQUESTS]: [LR_HEADER],
    [TABS.PRE_APPROVALS]: [PA_HEADER],
    [TABS.SALARY_HISTORY]: SAL_DATA,
    ...extras,
  };
  return { sheetsService: createMockSheetsService(base as Record<string, SheetData>) };
}

describe('/team-hours', () => {
  it('manager sees only direct reports', () => {
    const deps = makeManagerDeps();
    const result = handleTeamHours(MANAGER, deps);
    expect(result.text).toContain('Alex Dev');
    expect(result.text).toContain('Yuki Tanaka');
    expect(result.text).not.toContain('John'); // CEO is not a direct report
    expect(result.response_type).toBe('ephemeral');
  });

  it('admin sees all active employees', () => {
    const deps = makeManagerDeps();
    const result = handleTeamHours(ADMIN, deps);
    expect(result.text).toContain('Alex Dev');
    expect(result.text).toContain('Subash'); // admin sees everyone
  });
});

describe('/team-flags', () => {
  it('shows pending flags for direct reports', () => {
    const pendingFlag = ['FLG0001', 'EMP002', 'MONTHLY', '2026-03', 160, 120, 40, 'PENDING', 0, 40, 'EMP001', '', ''];
    const deps = makeManagerDeps({ [TABS.FLAGS]: [FLAGS_HEADER, pendingFlag] });
    const result = handleTeamFlags(MANAGER, deps);
    expect(result.text).toContain('FLG0001');
    expect(result.text).toContain('Alex Dev');
    expect(result.text).toContain('MONTHLY');
  });

  it('shows "no pending flags" when none exist', () => {
    const deps = makeManagerDeps();
    const result = handleTeamFlags(MANAGER, deps);
    expect(result.text).toContain('No pending');
  });

  it('shows bank info alongside flag', () => {
    const pendingFlag = ['FLG0001', 'EMP002', 'MONTHLY', '2026-03', 160, 120, 40, 'PENDING', 0, 40, 'EMP001', '', ''];
    const bankEntry = ['EMP002', 'MONTHLY', '2026-02', 160, 200, 40, 0, 40, 'EMP001', 5, '2027-02-28'];
    const deps = makeManagerDeps({
      [TABS.FLAGS]: [FLAGS_HEADER, pendingFlag],
      [TABS.HOURS_BANK]: [BANK_HEADER, bankEntry],
    });
    const result = handleTeamFlags(MANAGER, deps);
    expect(result.text).toContain('Bank available');
  });
});

describe('/team-bank', () => {
  it('shows manager-approved entries', () => {
    const bankEntry = ['EMP002', 'MONTHLY', '2026-02', 160, 200, 40, 0, 40, 'EMP001', 5, '2027-02-28'];
    const deps = makeManagerDeps({ [TABS.HOURS_BANK]: [BANK_HEADER, bankEntry] });
    const result = handleTeamBank(MANAGER, deps);
    expect(result.text).toContain('Alex Dev');
    expect(result.text).toContain('remaining');
    expect(result.text).toContain('expires');
  });

  it('shows "(no banked hours)" when empty', () => {
    const deps = makeManagerDeps();
    const result = handleTeamBank(MANAGER, deps);
    expect(result.text).toContain('no banked hours');
  });
});

describe('/team-reports', () => {
  it('shows today submission status', () => {
    const deps = makeManagerDeps();
    const result = handleTeamReports(MANAGER, '', deps);
    expect(result.text).toContain('Team Reports');
    expect(result.text).toContain('Submitted');
  });

  it('shows week view', () => {
    const deps = makeManagerDeps();
    const result = handleTeamReports(MANAGER, 'week', deps);
    expect(result.text).toContain('Week');
  });

  it('shows month submission rate', () => {
    const deps = makeManagerDeps();
    const result = handleTeamReports(MANAGER, '2026-03', deps);
    expect(result.text).toContain('2026-03');
    expect(result.text).toContain('%');
  });
});

describe('/team-payroll', () => {
  it('shows summary table with correct columns', () => {
    const deps = makeManagerDeps();
    const result = handleTeamPayroll(MANAGER, '', deps);
    expect(result.text).toContain('Team Payroll');
    expect(result.text).toContain('Alex Dev');
    expect(result.text).toContain('NPR');
    expect(result.text).toContain('Total');
  });

  it('highlights pending flags', () => {
    const pendingFlag = ['FLG0001', 'EMP002', 'MONTHLY', todayLocalSlice(), 160, 120, 40, 'PENDING', 0, 40, 'EMP001', '', ''];
    const deps = makeManagerDeps({ [TABS.FLAGS]: [FLAGS_HEADER, pendingFlag] });
    const result = handleTeamPayroll(MANAGER, '', deps);
    expect(result.text).toContain('Pending Flags');
  });
});

function todayLocalSlice(): string {
  const { DEFAULT_TZ_OFFSET_MS: offset } = require('../../../src/config');
  const d = new Date(Date.now() + (offset as number));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
