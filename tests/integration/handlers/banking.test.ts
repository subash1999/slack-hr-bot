import { handleApproveSurplus, processExpiry } from '../../../src/core/banking';
import { createMockSheetsService, createMockSlackService } from '../../mocks/gas-mocks';
import { TABS, BANK } from '../../../src/config';
import { DEFAULT_EMPLOYEES } from '../../fixtures/employees';
import type { SheetData } from '../../../src/types';

const BANK_HEADER = ['user_id', 'period_type', 'period_value', 'required', 'actual', 'surplus', 'used', 'remaining', 'approved_by', 'max_leave_days', 'expires_at'];

function makeBankDeps(extraBank: unknown[][] = []) {
  const sheets = createMockSheetsService({
    [TABS.HOURS_BANK]: [BANK_HEADER, ...extraBank] as SheetData,
    [TABS.EMPLOYEES]: DEFAULT_EMPLOYEES as SheetData,
  });
  const slack = createMockSlackService();
  return { sheetsService: sheets, slackService: slack, sheets, slack };
}

describe('/approve-surplus', () => {
  it('creates bank entry with correct expiry (12 months)', () => {
    const deps = makeBankDeps();
    const result = handleApproveSurplus('EMP001', 'EMP002', '2026-03', 40, 5, deps);
    expect(result.text).toContain('Banked 40h');
    expect(result.text).toContain('2026-03');
    const row = deps.sheets._appendedRows[TABS.HOURS_BANK][0];
    expect(row[BANK.USER_ID]).toBe('EMP002');
    expect(row[BANK.SURPLUS_HOURS]).toBe(40);
    expect(row[BANK.REMAINING_HOURS]).toBe(40);
    expect(row[BANK.MAX_LEAVE_DAYS]).toBe(5);
    expect(row[BANK.EXPIRES_AT]).toBe('2027-03-31');
  });

  it('rejects zero surplus', () => {
    const deps = makeBankDeps();
    const result = handleApproveSurplus('EMP001', 'EMP002', '2026-03', 0, 5, deps);
    expect(result.text).toContain('positive');
  });

  it('rejects negative surplus', () => {
    const deps = makeBankDeps();
    const result = handleApproveSurplus('EMP001', 'EMP002', '2026-03', -10, 5, deps);
    expect(result.text).toContain('positive');
  });

  it('rejects negative max leave days', () => {
    const deps = makeBankDeps();
    const result = handleApproveSurplus('EMP001', 'EMP002', '2026-03', 40, -1, deps);
    expect(result.text).toContain('negative');
  });
});

describe('Bank Expiry', () => {
  it('forfeits expired entries', () => {
    // Entry expired on 2026-02-28, today is 2026-03-28
    const expired = ['EMP002', 'MONTHLY', '2025-02', 160, 200, 40, 0, 40, 'EMP001', 5, '2026-02-28'];
    const deps = makeBankDeps([expired]);
    const result = processExpiry(deps);
    expect(result.expired).toBe(1);
    // Remaining set to 0
    expect(deps.sheetsService.updateCell).toHaveBeenCalledWith(
      TABS.HOURS_BANK, 2, BANK.REMAINING_HOURS + 1, 0,
    );
    // Employee notified
    expect(deps.slack._calls.sendDM.length).toBeGreaterThanOrEqual(1);
  });

  it('sends warning for entries within 30 days of expiry', () => {
    // Entry expires in ~20 days from now
    const now = new Date();
    const expiryDate = new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000);
    const expiryStr = expiryDate.toISOString().split('T')[0];
    const expiring = ['EMP002', 'MONTHLY', '2025-04', 160, 200, 40, 0, 40, 'EMP001', 5, expiryStr];
    const deps = makeBankDeps([expiring]);
    const result = processExpiry(deps);
    expect(result.warned).toBe(1);
    // Both employee and manager notified
    expect(deps.slack._calls.sendDM.length).toBeGreaterThanOrEqual(2);
  });

  it('skips entries with zero remaining', () => {
    const exhausted = ['EMP002', 'MONTHLY', '2025-02', 160, 200, 40, 40, 0, 'EMP001', 5, '2026-02-28'];
    const deps = makeBankDeps([exhausted]);
    const result = processExpiry(deps);
    expect(result.expired).toBe(0);
    expect(result.warned).toBe(0);
  });

  it('does not double-count active entries far from expiry', () => {
    const active = ['EMP002', 'MONTHLY', '2026-02', 160, 200, 40, 0, 40, 'EMP001', 5, '2027-02-28'];
    const deps = makeBankDeps([active]);
    const result = processExpiry(deps);
    expect(result.expired).toBe(0);
    expect(result.warned).toBe(0);
  });
});
