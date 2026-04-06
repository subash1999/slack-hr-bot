import { checkDailyShortfall, checkMonthlyShortfall, resolveFlag, getAvailableBank } from '../../../src/core/flags';
import type { FlagContext } from '../../../src/core/flags';
import { createMockSheetsService, createMockSlackService } from '../../mocks/gas-mocks';
import { TABS, FLAG, BANK } from '../../../src/config';
import { DEFAULT_EMPLOYEES } from '../../fixtures/employees';
import { buildEventsData, makeEvent, EMPTY_EVENTS } from '../../fixtures/events';
import type { SheetData } from '../../../src/types';

const FLAGS_HEADER = ['id', 'user_id', 'period_type', 'period_value', 'expected', 'actual', 'shortfall', 'status', 'bank_offset', 'effective_deficit', 'manager_id', 'resolved_at', 'notes'];
const BANK_HEADER = ['user_id', 'period_type', 'period_value', 'required', 'actual', 'surplus', 'used', 'remaining', 'approved_by', 'max_leave_days', 'expires_at'];
const LR_HEADER = ['id', 'user_id', 'date', 'type', 'status', 'requested_at', 'approved_by', 'approved_at', 'notes'];
const PA_HEADER = ['id', 'user_id', 'date', 'type', 'credit_hours', 'approved_by', 'approved_at', 'reason'];
const OVR_HEADER = ['user_id', 'period_type', 'period_value', 'required_hours', 'reason', 'approved_by', 'plan_id'];
const POS_DATA: SheetData = [
  ['position', 'policy_group', 'desc'],
  ['Full Time Developer', 'Full-Time', ''],
];
const POL_DATA: SheetData = [
  ['policy_group', 'min_daily', 'min_weekly', 'min_monthly', 'desc'],
  ['Full-Time', 3, 30, 160, ''],
];

function makeFlagDeps(overrides: Record<string, unknown[][]> = {}) {
  const base: Record<string, unknown[][]> = {
    [TABS.EVENTS]: EMPTY_EVENTS,
    [TABS.EMPLOYEES]: DEFAULT_EMPLOYEES,
    [TABS.POSITIONS]: POS_DATA,
    [TABS.POLICIES]: POL_DATA,
    [TABS.OVERRIDES]: [OVR_HEADER],
    [TABS.FLAGS]: [FLAGS_HEADER],
    [TABS.LEAVE_REQUESTS]: [LR_HEADER],
    [TABS.PRE_APPROVALS]: [PA_HEADER],
    [TABS.HOURS_BANK]: [BANK_HEADER],
  };
  const merged = { ...base, ...overrides };
  const sheets = createMockSheetsService(merged as Record<string, SheetData>);
  const slack = createMockSlackService();
  return { sheetsService: sheets, slackService: slack, sheets, slack };
}

function makeCtx(overrides: Record<string, unknown[][]> = {}): FlagContext {
  const base = {
    events: EMPTY_EVENTS as SheetData,
    employees: DEFAULT_EMPLOYEES as SheetData,
    positions: POS_DATA,
    policies: POL_DATA,
    overrides: [OVR_HEADER] as SheetData,
    leaveReqs: [LR_HEADER] as SheetData,
    preApprovals: [PA_HEADER] as SheetData,
    flags: [FLAGS_HEADER] as SheetData,
  };
  return {
    ...base,
    ...(overrides[TABS.EVENTS] ? { events: overrides[TABS.EVENTS] as SheetData } : {}),
    ...(overrides[TABS.LEAVE_REQUESTS] ? { leaveReqs: overrides[TABS.LEAVE_REQUESTS] as SheetData } : {}),
    ...(overrides[TABS.PRE_APPROVALS] ? { preApprovals: overrides[TABS.PRE_APPROVALS] as SheetData } : {}),
    ...(overrides[TABS.OVERRIDES] ? { overrides: overrides[TABS.OVERRIDES] as SheetData } : {}),
    ...(overrides[TABS.FLAGS] ? { flags: overrides[TABS.FLAGS] as SheetData } : {}),
  };
}

describe('Shortfall Detection', () => {
  it('creates daily flag when hours < minimum', () => {
    const events = buildEventsData(
      makeEvent('2026-03-28T00:00:00Z', 'EMP002', 'Alex', 'IN'),
      makeEvent('2026-03-28T02:00:00Z', 'EMP002', 'Alex', 'OUT'),
    );
    const deps = makeFlagDeps({ [TABS.EVENTS]: events });
    const ctx = makeCtx({ [TABS.EVENTS]: events });
    const flagged = checkDailyShortfall('EMP002', '2026-03-28', ctx, deps);
    expect(flagged).toBe(true);
    expect(deps.sheets._appendedRows[TABS.FLAGS]).toHaveLength(1);
    expect(deps.sheets._appendedRows[TABS.FLAGS][0][FLAG.PERIOD_TYPE]).toBe('DAILY');
    expect(deps.sheets._appendedRows[TABS.FLAGS][0][FLAG.STATUS]).toBe('PENDING');
  });

  it('skips flag when approved leave exists', () => {
    const leaveReqs = [LR_HEADER, ['LR1', 'EMP002', '2026-03-28', 'PAID', 'APPROVED', '', '', '', '']];
    const deps = makeFlagDeps();
    const ctx = makeCtx({ [TABS.LEAVE_REQUESTS]: leaveReqs });
    const flagged = checkDailyShortfall('EMP002', '2026-03-28', ctx, deps);
    expect(flagged).toBe(false);
  });

  it('skips flag when pre-approval exists', () => {
    const preApprovals = [PA_HEADER, ['PA1', 'EMP002', '2026-03-28', 'UNPAID_LEAVE', 0, 'EMP001', '', 'reason']];
    const deps = makeFlagDeps();
    const ctx = makeCtx({ [TABS.PRE_APPROVALS]: preApprovals });
    const flagged = checkDailyShortfall('EMP002', '2026-03-28', ctx, deps);
    expect(flagged).toBe(false);
  });

  it('creates monthly flag when hours < minimum', () => {
    const deps = makeFlagDeps();
    const ctx = makeCtx();
    const flagged = checkMonthlyShortfall('EMP002', '2026-03', ctx, deps);
    expect(flagged).toBe(true);
    expect(deps.sheets._appendedRows[TABS.FLAGS][0][FLAG.PERIOD_TYPE]).toBe('MONTHLY');
  });

  it('no monthly flag when override met', () => {
    const overrides = [OVR_HEADER, ['EMP002', 'MONTHLY', '2026-03', 0, 'test', 'EMP001', '']];
    const deps = makeFlagDeps();
    const ctx = makeCtx({ [TABS.OVERRIDES]: overrides });
    const flagged = checkMonthlyShortfall('EMP002', '2026-03', ctx, deps);
    expect(flagged).toBe(false);
  });

  it('no flag when hours meet minimum', () => {
    const events = buildEventsData(
      makeEvent('2026-03-28T00:00:00Z', 'EMP002', 'Alex', 'IN'),
      makeEvent('2026-03-28T04:00:00Z', 'EMP002', 'Alex', 'OUT'),
    );
    const deps = makeFlagDeps();
    const ctx = makeCtx({ [TABS.EVENTS]: events });
    const flagged = checkDailyShortfall('EMP002', '2026-03-28', ctx, deps);
    expect(flagged).toBe(false);
  });
});

describe('Flag Resolution', () => {
  const pendingFlag = ['FLG0001', 'EMP002', 'MONTHLY', '2026-03', 160, 120, 40, 'PENDING', 0, 40, 'EMP001', '', ''];
  const bankEntry = ['EMP002', 'MONTHLY', '2026-02', 160, 200, 40, 0, 40, 'EMP001', 5, '2027-02-28'];

  it('Use Bank — offsets full deficit', () => {
    const deps = makeFlagDeps({
      [TABS.FLAGS]: [FLAGS_HEADER, pendingFlag],
      [TABS.HOURS_BANK]: [BANK_HEADER, [...bankEntry]],
    });
    const result = resolveFlag('FLG0001', 'BANK_OFFSET', 40, 'EMP001', 'Using bank', deps);
    expect(result.success).toBe(true);
    // Check bank was updated
    expect(deps.sheetsService.updateCell).toHaveBeenCalledWith(
      TABS.HOURS_BANK, 2, BANK.USED_HOURS + 1, 40,
    );
    expect(deps.sheetsService.updateCell).toHaveBeenCalledWith(
      TABS.HOURS_BANK, 2, BANK.REMAINING_HOURS + 1, 0,
    );
    // Check flag status
    expect(deps.sheetsService.updateCell).toHaveBeenCalledWith(
      TABS.FLAGS, 2, FLAG.STATUS + 1, 'BANK_OFFSET',
    );
    expect(deps.sheetsService.updateCell).toHaveBeenCalledWith(
      TABS.FLAGS, 2, FLAG.EFFECTIVE_DEFICIT + 1, 0,
    );
  });

  it('Partial Bank — offset 20h of 40h deficit', () => {
    const deps = makeFlagDeps({
      [TABS.FLAGS]: [FLAGS_HEADER, pendingFlag],
      [TABS.HOURS_BANK]: [BANK_HEADER, [...bankEntry]],
    });
    resolveFlag('FLG0001', 'BANK_OFFSET', 20, 'EMP001', 'Partial', deps);
    expect(deps.sheetsService.updateCell).toHaveBeenCalledWith(
      TABS.HOURS_BANK, 2, BANK.USED_HOURS + 1, 20,
    );
    expect(deps.sheetsService.updateCell).toHaveBeenCalledWith(
      TABS.FLAGS, 2, FLAG.EFFECTIVE_DEFICIT + 1, 20,
    );
  });

  it('Deduct Full — no bank offset', () => {
    const deps = makeFlagDeps({
      [TABS.FLAGS]: [FLAGS_HEADER, pendingFlag],
      [TABS.HOURS_BANK]: [BANK_HEADER],
    });
    resolveFlag('FLG0001', 'APPROVED_DEDUCT', 0, 'EMP001', 'Full deduct', deps);
    expect(deps.sheetsService.updateCell).toHaveBeenCalledWith(
      TABS.FLAGS, 2, FLAG.STATUS + 1, 'APPROVED_DEDUCT',
    );
    expect(deps.sheetsService.updateCell).toHaveBeenCalledWith(
      TABS.FLAGS, 2, FLAG.EFFECTIVE_DEFICIT + 1, 40,
    );
  });

  it('No Penalty — forgive entirely', () => {
    const deps = makeFlagDeps({
      [TABS.FLAGS]: [FLAGS_HEADER, pendingFlag],
      [TABS.HOURS_BANK]: [BANK_HEADER],
    });
    resolveFlag('FLG0001', 'APPROVED_NO_PENALTY', 0, 'EMP001', 'Forgiven', deps);
    expect(deps.sheetsService.updateCell).toHaveBeenCalledWith(
      TABS.FLAGS, 2, FLAG.STATUS + 1, 'APPROVED_NO_PENALTY',
    );
  });

  it('returns error for unknown flag', () => {
    const deps = makeFlagDeps();
    const result = resolveFlag('NONEXISTENT', 'APPROVED_DEDUCT', 0, 'EMP001', '', deps);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});

describe('getAvailableBank', () => {
  it('returns active bank entries', () => {
    const bankData: SheetData = [
      BANK_HEADER,
      ['EMP002', 'MONTHLY', '2026-02', 160, 200, 40, 0, 40, 'EMP001', 5, '2027-02-28'],
      ['EMP002', 'MONTHLY', '2026-01', 160, 180, 20, 20, 0, 'EMP001', 2, '2027-01-31'], // exhausted
    ];
    const entries = getAvailableBank('EMP002', bankData, '2026-03-28');
    expect(entries).toHaveLength(1);
    expect(entries[0].remaining).toBe(40);
  });

  it('excludes expired entries', () => {
    const bankData: SheetData = [
      BANK_HEADER,
      ['EMP002', 'MONTHLY', '2025-01', 160, 200, 40, 0, 40, 'EMP001', 5, '2026-01-31'], // expired
    ];
    const entries = getAvailableBank('EMP002', bankData, '2026-03-28');
    expect(entries).toHaveLength(0);
  });
});
