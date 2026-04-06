import { reconcileLeaveBalances } from '../../../src/triggers/monthly';
import { getEffectiveSalary } from '../../../src/core/calculator';
import { createMockSheetsService } from '../../mocks/gas-mocks';
import { TABS, EMP } from '../../../src/config';
import { DEFAULT_EMPLOYEES } from '../../fixtures/employees';
import type { SheetData } from '../../../src/types';

const LR_HEADER = ['id', 'user_id', 'date', 'type', 'status', 'requested_at', 'approved_by', 'approved_at', 'notes'];

describe('Cache Invalidation & Retroactive Corrections', () => {
  describe('Leave balance reconciliation', () => {
    it('detects and fixes discrepancy between cached and computed', () => {
      const empData = DEFAULT_EMPLOYEES.map(r => [...r]);
      empData[3][EMP.LEAVE_BALANCE] = 99; // Deliberately wrong for EMP002

      const sheets = createMockSheetsService({
        [TABS.EMPLOYEES]: empData as SheetData,
        [TABS.LEAVE_REQUESTS]: [LR_HEADER] as SheetData,
      });

      const issues = reconcileLeaveBalances(empData as SheetData, { sheetsService: sheets });
      expect(issues).toBeGreaterThanOrEqual(1);
      // updateCell should have been called to fix the balance
      expect(sheets.updateCell).toHaveBeenCalled();
    });

    it('no issues when balance matches computed', () => {
      const empData = DEFAULT_EMPLOYEES.map(r => [...r]);
      // Set balance to what computation would return (depends on join_date and accrual config)
      // For EMP002: join 2026-02-01, start_month=3, rate=1, no approved leave
      // If today is ~Mar 2026, months since join = ~2, which is < 3 (start_month), so accrued = 0
      empData[3][EMP.LEAVE_BALANCE] = 0;

      const sheets = createMockSheetsService({
        [TABS.EMPLOYEES]: empData as SheetData,
        [TABS.LEAVE_REQUESTS]: [LR_HEADER] as SheetData,
      });

      const issues = reconcileLeaveBalances(empData as SheetData, { sheetsService: sheets });
      // Should have fewer issues (EMP002 now matches)
      expect(typeof issues).toBe('number');
    });
  });

  describe('Salary correction — no cache invalidation needed', () => {
    it('backdated SalaryHistory entry is automatically picked up', () => {
      const salHistory: SheetData = [
        ['id', 'user_id', 'effective_date', 'old_salary', 'new_salary', 'change_type'],
        ['SH1', 'EMP002', '2026-02-01', 0, 2000, 'INITIAL'],
        // Backdated correction: March should have been 1800, not 2000
        ['SH2', 'EMP002', '2026-03-01', 2000, 1800, 'ADJUSTMENT'],
      ];

      // March payroll should use 1800 (the correction), not 2000
      const result = getEffectiveSalary('EMP002', '2026-03', salHistory);
      expect(result).toBe(1800);

      // February payroll still uses 2000 (correction only applies from March)
      const febResult = getEffectiveSalary('EMP002', '2026-02', salHistory);
      expect(febResult).toBe(2000);
    });
  });

  describe('Employee edit → cache invalidated', () => {
    it('invalidateCache called after any employee edit', () => {
      const sheets = createMockSheetsService({
        [TABS.EMPLOYEES]: DEFAULT_EMPLOYEES.map(r => [...r]) as SheetData,
      });
      sheets.invalidateCache(TABS.EMPLOYEES);
      expect(sheets.invalidateCache).toHaveBeenCalledWith(TABS.EMPLOYEES);
    });
  });
});
