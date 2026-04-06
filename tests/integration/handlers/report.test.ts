import { handleReport, handleReportSubmission } from '../../../src/handlers/report';
import { createMockSheetsService, createMockSlackService } from '../../mocks/gas-mocks';
import { TABS, DR } from '../../../src/config';
import { DEFAULT_EMPLOYEES } from '../../fixtures/employees';
import type { CallerInfo, SheetData } from '../../../src/types';

const EMPLOYEE: CallerInfo = {
  user_id: 'EMP002', slack_id: 'UEMP001', name: 'Alex Dev', email: 'alex@example.com',
  role: 'employee', position: 'Full Time Developer', manager_id: 'EMP001',
  is_admin: false, status: 'ACTIVE', salary: 350000, join_date: '2026-02-01', leave_balance: 3, rowIndex: 3,
};

const MANAGER: CallerInfo = {
  ...EMPLOYEE, user_id: 'EMP001', slack_id: 'UMGR001', name: 'Subash', role: 'manager', rowIndex: 2,
};

const REPORT_HEADER = ['date', 'user_id', 'user_name', 'yesterday', 'today', 'blockers', 'submitted_at'];

function makeReportDeps(extraReports: unknown[][] = []) {
  const sheets = createMockSheetsService({
    [TABS.DAILY_REPORTS]: [REPORT_HEADER, ...extraReports] as SheetData,
    [TABS.EMPLOYEES]: DEFAULT_EMPLOYEES as SheetData,
  });
  const slack = createMockSlackService();
  return { sheetsService: sheets, slackService: slack, sheets, slack };
}

describe('/report', () => {
  describe('Modal submission', () => {
    it('opens modal when trigger_id provided and no args', () => {
      const deps = makeReportDeps();
      const result = handleReport(EMPLOYEE, '', deps, 'trigger-123');
      expect(result.text).toContain('Opening');
      expect(deps.slack._calls.openModal).toHaveLength(1);
      expect(deps.slack._calls.openModal[0].triggerId).toBe('trigger-123');
    });

    it('stores report in DailyReports on submission', () => {
      const deps = makeReportDeps();
      const result = handleReportSubmission(
        EMPLOYEE, 'Did X yesterday', 'Will do Y today', 'No blockers', deps,
      );
      expect(result.text).toContain('submitted');
      expect(deps.sheets._appendedRows[TABS.DAILY_REPORTS]).toHaveLength(1);
      const row = deps.sheets._appendedRows[TABS.DAILY_REPORTS][0];
      expect(row[DR.USER_ID]).toBe('EMP002');
      expect(row[DR.YESTERDAY]).toBe('Did X yesterday');
      expect(row[DR.TODAY]).toBe('Will do Y today');
    });
  });

  describe('Inline submission', () => {
    it('parses pipe-separated text', () => {
      const deps = makeReportDeps();
      const result = handleReport(
        EMPLOYEE,
        'yesterday: Fixed bug JIRA-123 | today: Payment API JIRA-456 | blockers: Waiting on design',
        deps,
      );
      expect(result.text).toContain('submitted');
      const row = deps.sheets._appendedRows[TABS.DAILY_REPORTS][0];
      expect(row[DR.YESTERDAY]).toBe('Fixed bug JIRA-123');
      expect(row[DR.TODAY]).toBe('Payment API JIRA-456');
      expect(row[DR.BLOCKERS]).toBe('Waiting on design');
    });

    it('rejects empty inline submission', () => {
      const deps = makeReportDeps();
      const result = handleReport(EMPLOYEE, 'foo: bar | baz: qux', deps);
      expect(result.text).toContain('Provide at least');
    });
  });

  describe('View own reports', () => {
    it('shows report for specific date', () => {
      const deps = makeReportDeps([
        ['2026-03-28', 'EMP002', 'Alex Dev', 'Did X', 'Will do Y', 'None', '2026-03-28T10:00:00Z'],
      ]);
      const result = handleReport(EMPLOYEE, '2026-03-28', deps);
      expect(result.text).toContain('Did X');
      expect(result.text).toContain('Will do Y');
    });

    it('shows week summary', () => {
      const deps = makeReportDeps();
      const result = handleReport(EMPLOYEE, 'week', deps);
      expect(result.text).toContain('Week');
    });

    it('shows "no report" when none exists', () => {
      const deps = makeReportDeps();
      const result = handleReport(EMPLOYEE, '2026-03-28', deps);
      expect(result.text).toContain('No report');
    });
  });

  describe('Manager view with permissions', () => {
    it('manager can view direct report', () => {
      const deps = makeReportDeps([
        ['2026-03-28', 'EMP002', 'Alex Dev', 'Did X', 'Will do Y', 'None', '2026-03-28T10:00:00Z'],
      ]);
      const result = handleReport(MANAGER, '<@UEMP001> 2026-03-28', deps);
      expect(result.text).toContain('Did X');
    });

    it('employee cannot view others reports', () => {
      const deps = makeReportDeps();
      const result = handleReport(EMPLOYEE, '<@UMGR001>', deps);
      expect(result.text).toContain("don't have permission");
    });

    it('manager cannot view non-direct report', () => {
      const deps = makeReportDeps();
      const result = handleReport(MANAGER, '<@UCEO001>', deps);
      expect(result.text).toContain("don't have permission");
    });
  });
});
