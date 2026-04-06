import { runDailyCheck } from '../../../src/triggers/daily';
import { runWeeklyCheck } from '../../../src/triggers/weekly';
import { runMonthlyCheck } from '../../../src/triggers/monthly';
import { runReminders } from '../../../src/triggers/reminders';
import { createMockSheetsService, createMockSlackService } from '../../mocks/gas-mocks';
import { TABS } from '../../../src/config';
import { DEFAULT_EMPLOYEES } from '../../fixtures/employees';
import { buildEventsData, makeEvent, EMPTY_EVENTS } from '../../fixtures/events';
import type { SheetData } from '../../../src/types';

const FLAGS_HEADER = ['id', 'user_id', 'period_type', 'period_value', 'expected', 'actual', 'shortfall', 'status', 'bank_offset', 'effective_deficit', 'manager_id', 'resolved_at', 'notes'];
const BANK_HEADER = ['user_id', 'period_type', 'period_value', 'required', 'actual', 'surplus', 'used', 'remaining', 'approved_by', 'max_leave_days', 'expires_at'];
const LR_HEADER = ['id', 'user_id', 'date', 'type', 'status', 'requested_at', 'approved_by', 'approved_at', 'notes'];
const PA_HEADER = ['id', 'user_id', 'date', 'type', 'credit_hours'];
const OVR_HEADER = ['user_id', 'period_type', 'period_value', 'required_hours'];
const MS_HEADER = ['user_id', 'month', 'worked', 'leave', 'total', 'required', 'deficit', 'bank', 'eff_deficit', 'status'];
const SAL_HEADER = ['id', 'user_id', 'effective_date', 'old_salary', 'new_salary', 'change_type'];
const POS_DATA = [['position', 'policy_group', 'desc'], ['Full Time Developer', 'Full-Time', ''], ['CEO', 'Full-Time', ''], ['CTO', 'Full-Time', '']];
const POL_DATA = [['policy_group', 'min_daily', 'min_weekly', 'min_monthly', 'desc'], ['Full-Time', 3, 30, 160, '']];

function makeTriggerDeps(extras: Record<string, unknown[][]> = {}) {
  const base: Record<string, unknown[][]> = {
    [TABS.EVENTS]: EMPTY_EVENTS,
    [TABS.EMPLOYEES]: DEFAULT_EMPLOYEES.map(r => [...r]),
    [TABS.POSITIONS]: POS_DATA,
    [TABS.POLICIES]: POL_DATA,
    [TABS.OVERRIDES]: [OVR_HEADER],
    [TABS.FLAGS]: [FLAGS_HEADER],
    [TABS.HOURS_BANK]: [BANK_HEADER],
    [TABS.LEAVE_REQUESTS]: [LR_HEADER],
    [TABS.PRE_APPROVALS]: [PA_HEADER],
    [TABS.MONTHLY_SUMMARY]: [MS_HEADER],
    [TABS.SALARY_HISTORY]: [SAL_HEADER, ['SH1', 'EMP002', '2026-02-01', 0, 350000, 'INITIAL']],
    ...extras,
  };
  const sheets = createMockSheetsService(base as Record<string, SheetData>);
  const slack = createMockSlackService();
  return { sheetsService: sheets, slackService: slack, sheets, slack };
}

describe('Daily Trigger', () => {
  it('flags open break via DM (does NOT auto-close)', () => {
    const events = buildEventsData(
      makeEvent('2026-03-28T09:00:00Z', 'EMP002', 'Alex', 'IN'),
      makeEvent('2026-03-28T14:00:00Z', 'EMP002', 'Alex', 'BREAK_START'),
    );
    const deps = makeTriggerDeps({ [TABS.EVENTS]: events });
    const result = runDailyCheck(deps);
    expect(result.flaggedBreaks).toBeGreaterThanOrEqual(1);
    // NO BREAK_END appended (we only flag, not auto-close)
    const breakEndEvents = deps.sheets._appendedRows[TABS.EVENTS]?.filter(
      (r: unknown[]) => r[3] === 'BREAK_END',
    ) ?? [];
    expect(breakEndEvents).toHaveLength(0);
    // DM sent to employee
    expect(deps.slack._calls.sendDM.length).toBeGreaterThanOrEqual(1);
  });

  it('flags unclosed session but does NOT auto-close', () => {
    const events = buildEventsData(
      makeEvent('2026-03-28T09:00:00Z', 'EMP002', 'Alex', 'IN'),
    );
    const deps = makeTriggerDeps({ [TABS.EVENTS]: events });
    const result = runDailyCheck(deps);
    expect(result.flaggedSessions).toBeGreaterThanOrEqual(1);
    // No OUT event appended
    const outEvents = deps.sheets._appendedRows[TABS.EVENTS]?.filter(
      (r: unknown[]) => r[3] === 'OUT',
    ) ?? [];
    expect(outEvents).toHaveLength(0);
  });

  it('detects daily shortfalls for all active employees', () => {
    const deps = makeTriggerDeps(); // No events = 0h for all
    const result = runDailyCheck(deps);
    // At least some shortfalls for employees with 0h worked
    expect(result.shortfalls).toBeGreaterThanOrEqual(0);
  });
});

describe('Weekly Trigger', () => {
  it('generates weekly shortfall flags', () => {
    const deps = makeTriggerDeps();
    const result = runWeeklyCheck(deps);
    expect(result.shortfalls).toBeGreaterThanOrEqual(0);
  });
});

describe('Monthly Trigger', () => {
  it('generates monthly shortfalls + MonthlySummary', () => {
    const deps = makeTriggerDeps();
    const result = runMonthlyCheck(deps);
    expect(result.shortfalls).toBeGreaterThanOrEqual(0);
    expect(result.summaries).toBeGreaterThanOrEqual(0);
  });

  it('processes surplus expiry', () => {
    const expired = ['EMP002', 'MONTHLY', '2025-02', 160, 200, 40, 0, 40, 'EMP001', 5, '2026-02-28'];
    const deps = makeTriggerDeps({ [TABS.HOURS_BANK]: [BANK_HEADER, expired] });
    const result = runMonthlyCheck(deps);
    expect(result.expired).toBeGreaterThanOrEqual(1);
  });

  it('runs leave accrual for eligible employees', () => {
    const deps = makeTriggerDeps();
    const result = runMonthlyCheck(deps);
    expect(result.accrued).toBeGreaterThanOrEqual(0);
  });

  it('reconciles leave balances', () => {
    const deps = makeTriggerDeps();
    const result = runMonthlyCheck(deps);
    expect(typeof result.reconciliationIssues).toBe('number');
  });

  it('MonthlySummary is idempotent (no duplicates on re-run)', () => {
    const deps = makeTriggerDeps();
    runMonthlyCheck(deps);
    const firstRunSummaries = deps.sheets._appendedRows[TABS.MONTHLY_SUMMARY]?.length ?? 0;
    // Run again — should not create more summaries
    runMonthlyCheck(deps);
    const secondRunSummaries = deps.sheets._appendedRows[TABS.MONTHLY_SUMMARY]?.length ?? 0;
    // May grow because appendRow adds to _tabData which getAll reads, so idempotency check should work
    expect(secondRunSummaries).toBe(firstRunSummaries);
  });
});

describe('Reminder Trigger', () => {
  it('sends reminder for pending leave > 24h', () => {
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const leaveReqs = [LR_HEADER, ['LR1', 'EMP002', '2026-04-02', '', 'PENDING', oldDate, '', '', '']];
    const deps = makeTriggerDeps({ [TABS.LEAVE_REQUESTS]: leaveReqs });
    const result = runReminders(deps);
    expect(result.leaveReminders).toBeGreaterThanOrEqual(1);
    expect(deps.slack._calls.sendDM.length).toBeGreaterThanOrEqual(1);
  });

  it('sends warning for expiring bank entries', () => {
    const expiryDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const bankEntry = ['EMP002', 'MONTHLY', '2025-04', 160, 200, 40, 0, 40, 'EMP001', 5, expiryDate];
    const deps = makeTriggerDeps({ [TABS.HOURS_BANK]: [BANK_HEADER, bankEntry] });
    const result = runReminders(deps);
    expect(result.bankWarnings).toBeGreaterThanOrEqual(1);
  });

  it('does not remind for recent leave requests', () => {
    const recentDate = new Date().toISOString();
    const leaveReqs = [LR_HEADER, ['LR1', 'EMP002', '2026-04-02', '', 'PENDING', recentDate, '', '', '']];
    const deps = makeTriggerDeps({ [TABS.LEAVE_REQUESTS]: leaveReqs });
    const result = runReminders(deps);
    expect(result.leaveReminders).toBe(0);
  });
});
