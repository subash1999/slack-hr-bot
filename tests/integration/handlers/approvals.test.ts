import { handleApproveAbsence, handleAdjustQuota } from '../../../src/handlers/approvals';
import { createMockSheetsService, createMockSlackService } from '../../mocks/gas-mocks';
import { TABS, PA, EMP, OVR } from '../../../src/config';
import { DEFAULT_EMPLOYEES } from '../../fixtures/employees';
import type { SheetData } from '../../../src/types';

const CALLER = { user_id: 'EMP001', name: 'Subash', role: 'manager' as const } as Parameters<typeof handleApproveAbsence>[0];

const PA_HEADER = ['id', 'user_id', 'date', 'type', 'credit_hours', 'approved_by', 'approved_at', 'reason'];
const OVR_HEADER = ['user_id', 'period_type', 'period_value', 'required_hours', 'reason', 'approved_by', 'plan_id'];
const QP_HEADER = ['plan_id', 'user_id', 'plan_type', 'created_by', 'created_at', 'status', 'notes'];
const POS_DATA = [['position', 'policy_group', 'desc'], ['Full Time Developer', 'Full-Time', '']];
const POL_DATA = [['policy_group', 'min_daily', 'min_weekly', 'min_monthly', 'desc'], ['Full-Time', 3, 30, 160, '']];

function makeApprovalDeps(extras: Record<string, unknown[][]> = {}) {
  const base: Record<string, unknown[][]> = {
    [TABS.EMPLOYEES]: DEFAULT_EMPLOYEES.map(r => [...r]),
    [TABS.PRE_APPROVALS]: [PA_HEADER],
    [TABS.OVERRIDES]: [OVR_HEADER],
    [TABS.QUOTA_PLANS]: [QP_HEADER],
    [TABS.POSITIONS]: POS_DATA,
    [TABS.POLICIES]: POL_DATA,
    ...extras,
  };
  const sheets = createMockSheetsService(base as Record<string, SheetData>);
  const slack = createMockSlackService();
  return { sheetsService: sheets, slackService: slack, sheets, slack };
}

describe('/approve-absence', () => {
  it('PAID_LEAVE — 8h credit, balance deducted', () => {
    const deps = makeApprovalDeps();
    const result = handleApproveAbsence(CALLER, 'EMP002', '2026-04-10', 'PAID_LEAVE', 'doctor', deps);
    expect(result.text).toContain('Pre-approved');
    expect(result.text).toContain('Paid Leave');
    // PreApproval row created
    expect(deps.sheets._appendedRows[TABS.PRE_APPROVALS]).toHaveLength(1);
    expect(deps.sheets._appendedRows[TABS.PRE_APPROVALS][0][PA.CREDIT_HOURS]).toBe(8);
    // Balance deducted
    expect(deps.sheetsService.updateCell).toHaveBeenCalledWith(
      TABS.EMPLOYEES, expect.any(Number), EMP.LEAVE_BALANCE + 1, 2,
    );
  });

  it('UNPAID_LEAVE — 0h, no balance change', () => {
    const deps = makeApprovalDeps();
    const result = handleApproveAbsence(CALLER, 'EMP002', '2026-04-10', 'UNPAID_LEAVE', 'personal', deps);
    expect(result.text).toContain('Unpaid Leave');
    expect(deps.sheets._appendedRows[TABS.PRE_APPROVALS][0][PA.CREDIT_HOURS]).toBe(0);
    // No balance update
    const balanceCalls = (deps.sheetsService.updateCell as jest.Mock).mock.calls
      .filter((c: unknown[]) => c[0] === TABS.EMPLOYEES);
    expect(balanceCalls).toHaveLength(0);
  });

  it('MAKE_UP — 0h, compensate later', () => {
    const deps = makeApprovalDeps();
    const result = handleApproveAbsence(CALLER, 'EMP002', '2026-04-10', 'MAKE_UP', 'will compensate', deps);
    expect(result.text).toContain('Make-Up');
    expect(deps.sheets._appendedRows[TABS.PRE_APPROVALS][0][PA.CREDIT_HOURS]).toBe(0);
  });

  it('CREDITED_ABSENCE — 8h, NO balance deduction', () => {
    const deps = makeApprovalDeps();
    const result = handleApproveAbsence(CALLER, 'EMP002', '2026-04-10', 'CREDITED_ABSENCE', 'sick', deps);
    expect(result.text).toContain('Credited Absence');
    expect(deps.sheets._appendedRows[TABS.PRE_APPROVALS][0][PA.CREDIT_HOURS]).toBe(8);
    const balanceCalls = (deps.sheetsService.updateCell as jest.Mock).mock.calls
      .filter((c: unknown[]) => c[0] === TABS.EMPLOYEES);
    expect(balanceCalls).toHaveLength(0);
  });

  it('rejects PAID_LEAVE when balance = 0', () => {
    const empData = DEFAULT_EMPLOYEES.map(r => [...r]);
    empData[3][EMP.LEAVE_BALANCE] = 0; // EMP002
    const deps = makeApprovalDeps({ [TABS.EMPLOYEES]: empData });
    const result = handleApproveAbsence(CALLER, 'EMP002', '2026-04-10', 'PAID_LEAVE', 'test', deps);
    expect(result.text).toContain('no leave balance');
  });

  it('rejects invalid date', () => {
    const deps = makeApprovalDeps();
    const result = handleApproveAbsence(CALLER, 'EMP002', 'bad-date', 'UNPAID_LEAVE', 'test', deps);
    expect(result.text).toContain('Invalid date');
  });
});

describe('/adjust-quota', () => {
  it('creates monthly Override entries + QuotaPlans', () => {
    const deps = makeApprovalDeps();
    const result = handleAdjustQuota(CALLER, 'EMP002', 'MONTHLY', [
      { periodValue: '2026-04', hours: 140 },
      { periodValue: '2026-05', hours: 180 },
    ], deps);
    expect(result.text).toContain('Quota redistribution');
    expect(result.text).toContain('2 monthly');
    // 1 QuotaPlan + 2 Overrides
    expect(deps.sheets._appendedRows[TABS.QUOTA_PLANS]).toHaveLength(1);
    expect(deps.sheets._appendedRows[TABS.OVERRIDES]).toHaveLength(2);
    expect(deps.sheets._appendedRows[TABS.OVERRIDES][0][OVR.REQUIRED_HOURS]).toBe(140);
    expect(deps.sheets._appendedRows[TABS.OVERRIDES][1][OVR.REQUIRED_HOURS]).toBe(180);
  });

  it('warns when adjusted total < default', () => {
    const deps = makeApprovalDeps();
    const result = handleAdjustQuota(CALLER, 'EMP002', 'MONTHLY', [
      { periodValue: '2026-04', hours: 100 },
      { periodValue: '2026-05', hours: 100 },
    ], deps);
    expect(result.text).toContain('Warning');
    expect(result.text).toContain('less than default');
  });

  it('rejects empty adjustments', () => {
    const deps = makeApprovalDeps();
    const result = handleAdjustQuota(CALLER, 'EMP002', 'MONTHLY', [], deps);
    expect(result.text).toContain('No adjustments');
  });
});
