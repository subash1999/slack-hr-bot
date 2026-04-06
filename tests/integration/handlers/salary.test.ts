import { handleSalaryHistoryView, handleSalaryHistorySet } from '../../../src/handlers/salary';
import { createMockSheetsService, createMockSlackService } from '../../mocks/gas-mocks';
import { TABS, SAL, EMP } from '../../../src/config';
import { DEFAULT_EMPLOYEES } from '../../fixtures/employees';
import type { CallerInfo, SheetData } from '../../../src/types';

const ADMIN: CallerInfo = {
  user_id: 'EMP000', slack_id: 'UCEO001', name: 'John', email: 'john@example.com',
  role: 'admin', position: 'CEO', manager_id: 'none',
  is_admin: true, status: 'ACTIVE', salary: 0, join_date: '2026-01-01', leave_balance: 0, rowIndex: 1,
};

const SAL_HEADER = ['id', 'user_id', 'effective_date', 'old_salary', 'new_salary', 'change_type', 'reason', 'approved_by', 'created_at'];

function makeSalaryDeps(extraSalary: unknown[][] = []) {
  const sheets = createMockSheetsService({
    [TABS.SALARY_HISTORY]: [SAL_HEADER, ...extraSalary] as SheetData,
    [TABS.EMPLOYEES]: DEFAULT_EMPLOYEES.map(r => [...r]) as SheetData,
  });
  const slack = createMockSlackService();
  return { sheetsService: sheets, slackService: slack, sheets, slack };
}

describe('/salary-history view', () => {
  it('shows full salary history', () => {
    const deps = makeSalaryDeps([
      ['SH1', 'EMP002', '2026-02-01', 0, 350000, 'INITIAL', '', 'EMP000', ''],
      ['SH2', 'EMP002', '2026-05-01', 350000, 400000, 'PROBATION_END', 'Good performance', 'EMP000', ''],
    ]);
    const result = handleSalaryHistoryView('EMP002', 'Alex Dev', deps);
    expect(result.text).toContain('Salary History');
    expect(result.text).toContain('Alex Dev');
    expect(result.text).toContain('350,000');
    expect(result.text).toContain('400,000');
    expect(result.text).toContain('INITIAL');
    expect(result.text).toContain('PROBATION_END');
    expect(result.text).toContain('Current');
    expect(result.response_type).toBe('ephemeral');
  });

  it('shows "no history" when empty', () => {
    const deps = makeSalaryDeps();
    const result = handleSalaryHistoryView('EMP002', 'Alex Dev', deps);
    expect(result.text).toContain('No salary history');
  });
});

describe('/salary-history set', () => {
  it('creates SalaryHistory entry + updates Employees.salary', () => {
    const deps = makeSalaryDeps([
      ['SH1', 'EMP002', '2026-02-01', 0, 350000, 'INITIAL', '', 'EMP000', ''],
    ]);
    const result = handleSalaryHistorySet(
      ADMIN, 'EMP002', 'Alex Dev', '400000', 'REVIEW', 'Annual review', deps,
    );
    expect(result.text).toContain('Salary updated');
    expect(result.text).toContain('350,000');
    expect(result.text).toContain('400,000');
    expect(result.text).toContain('REVIEW');

    // SalaryHistory row appended (append-only)
    expect(deps.sheets._appendedRows[TABS.SALARY_HISTORY]).toHaveLength(1);
    const salRow = deps.sheets._appendedRows[TABS.SALARY_HISTORY][0];
    expect(salRow[SAL.OLD_SALARY]).toBe(350000);
    expect(salRow[SAL.NEW_SALARY]).toBe(400000);
    expect(salRow[SAL.CHANGE_TYPE]).toBe('REVIEW');

    // Employees.salary updated
    expect(deps.sheetsService.updateCell).toHaveBeenCalledWith(
      TABS.EMPLOYEES, expect.any(Number), EMP.SALARY + 1, 400000,
    );

    // Posted to #hr-alerts
    expect(deps.slack._calls.postToChannel).toHaveLength(1);
    expect(deps.slack._calls.postToChannel[0].text).toContain('Salary updated');
  });

  it('rejects invalid salary', () => {
    const deps = makeSalaryDeps();
    const result = handleSalaryHistorySet(ADMIN, 'EMP002', 'Alex', 'abc', 'REVIEW', '', deps);
    expect(result.text).toContain('positive number');
  });

  it('rejects invalid change type', () => {
    const deps = makeSalaryDeps();
    const result = handleSalaryHistorySet(ADMIN, 'EMP002', 'Alex', '400000', 'INVALID', '', deps);
    expect(result.text).toContain('Invalid change type');
  });

  it('rejects unknown employee', () => {
    const deps = makeSalaryDeps();
    const result = handleSalaryHistorySet(ADMIN, 'EMP999', 'Nobody', '400000', 'REVIEW', '', deps);
    expect(result.text).toContain('not found');
  });
});
