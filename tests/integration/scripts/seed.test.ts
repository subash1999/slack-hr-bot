import { seedDatabase, TAB_HEADERS } from '../../../src/scripts/seed';
import { TABS, CEO_USER_ID, STATUS } from '../../../src/config';

// Simple mock spreadsheet
function createMockSpreadsheet(existingSheets: Record<string, unknown[][]> = {}) {
  const sheets: Record<string, { data: unknown[][]; name: string }> = {};

  // Initialize existing sheets
  for (const [name, data] of Object.entries(existingSheets)) {
    sheets[name] = { data: [...data.map(r => [...r])], name };
  }

  const ss = {
    getSheetByName: jest.fn((name: string) => {
      const sheet = sheets[name];
      if (!sheet) return null;
      return mockSheet(sheet);
    }),
    insertSheet: jest.fn((name: string) => {
      sheets[name] = { data: [], name };
      return mockSheet(sheets[name]);
    }),
  };

  function mockSheet(sheetObj: { data: unknown[][]; name: string }) {
    return {
      getName: () => sheetObj.name,
      getDataRange: () => ({
        getValues: () => sheetObj.data,
      }),
      appendRow: jest.fn((row: unknown[]) => {
        sheetObj.data.push([...row]);
      }),
      getLastRow: () => sheetObj.data.length,
    };
  }

  return { ss: ss as unknown as GoogleAppsScript.Spreadsheet.Spreadsheet, sheets };
}

describe('Seed Script', () => {
  describe('Tab creation', () => {
    it('creates all 14 tabs when none exist', () => {
      const { ss } = createMockSpreadsheet();
      const report = seedDatabase({ spreadsheet: ss });

      expect(report.tabsCreated).toHaveLength(14);
      expect(report.tabsExisted).toHaveLength(0);
      expect(report.tabsCreated).toContain(TABS.EMPLOYEES);
      expect(report.tabsCreated).toContain(TABS.EVENTS);
      expect(report.tabsCreated).toContain(TABS.POSITIONS);
      expect(report.tabsCreated).toContain(TABS.POLICIES);
    });

    it('skips existing tabs', () => {
      const { ss } = createMockSpreadsheet({
        [TABS.EMPLOYEES]: [TAB_HEADERS[TABS.EMPLOYEES]],
        [TABS.EVENTS]: [TAB_HEADERS[TABS.EVENTS]],
      });
      const report = seedDatabase({ spreadsheet: ss });

      expect(report.tabsExisted).toContain(TABS.EMPLOYEES);
      expect(report.tabsExisted).toContain(TABS.EVENTS);
      expect(report.tabsCreated).not.toContain(TABS.EMPLOYEES);
      expect(report.tabsCreated.length + report.tabsExisted.length).toBe(14);
    });
  });

  describe('Policy seed data', () => {
    it('creates both policy groups', () => {
      const { ss } = createMockSpreadsheet({
        [TABS.POLICIES]: [TAB_HEADERS[TABS.POLICIES]],
      });
      const report = seedDatabase({ spreadsheet: ss });

      expect(report.policiesCreated).toContain('Full-Time');
      expect(report.policiesCreated).toContain('Intern');
      expect(report.policiesSkipped).toHaveLength(0);
    });

    it('skips existing policies', () => {
      const { ss } = createMockSpreadsheet({
        [TABS.POLICIES]: [
          TAB_HEADERS[TABS.POLICIES],
          ['Full-Time', 3, 30, 160, 'Existing'],
        ],
      });
      const report = seedDatabase({ spreadsheet: ss });

      expect(report.policiesSkipped).toContain('Full-Time');
      expect(report.policiesCreated).toContain('Intern');
    });
  });

  describe('Position seed data', () => {
    it('creates all 7 positions', () => {
      const { ss } = createMockSpreadsheet({
        [TABS.POSITIONS]: [TAB_HEADERS[TABS.POSITIONS]],
      });
      const report = seedDatabase({ spreadsheet: ss });

      expect(report.positionsCreated).toHaveLength(7);
      expect(report.positionsCreated).toContain('CEO');
      expect(report.positionsCreated).toContain('Intern');
    });

    it('skips existing positions', () => {
      const { ss } = createMockSpreadsheet({
        [TABS.POSITIONS]: [
          TAB_HEADERS[TABS.POSITIONS],
          ['CEO', 'Full-Time', 'Chief Executive Officer'],
        ],
      });
      const report = seedDatabase({ spreadsheet: ss });

      expect(report.positionsSkipped).toContain('CEO');
      expect(report.positionsCreated).not.toContain('CEO');
      expect(report.positionsCreated).toHaveLength(6);
    });
  });

  describe('CEO seed data', () => {
    it('creates CEO employee and salary history', () => {
      const { ss } = createMockSpreadsheet({
        [TABS.EMPLOYEES]: [TAB_HEADERS[TABS.EMPLOYEES]],
        [TABS.SALARY_HISTORY]: [TAB_HEADERS[TABS.SALARY_HISTORY]],
      });
      const report = seedDatabase({ spreadsheet: ss });

      expect(report.ceoCreated).toBe(true);
      expect(report.salaryHistoryCreated).toBe(true);
    });

    it('skips CEO if already exists', () => {
      const { ss } = createMockSpreadsheet({
        [TABS.EMPLOYEES]: [
          TAB_HEADERS[TABS.EMPLOYEES],
          [CEO_USER_ID, 'UCEO', 'Boss', 'boss@test.com', 'CEO', 0, '2026-01-01', 1, 0, 0, 'none', 'TRUE', 0, 0, STATUS.ACTIVE],
        ],
        [TABS.SALARY_HISTORY]: [
          TAB_HEADERS[TABS.SALARY_HISTORY],
          ['SH0001', CEO_USER_ID, '2026-01-01', 0, 0, 'INITIAL', '', CEO_USER_ID, ''],
        ],
      });
      const report = seedDatabase({ spreadsheet: ss });

      expect(report.ceoSkipped).toBe(true);
      expect(report.salaryHistorySkipped).toBe(true);
    });
  });

  describe('Idempotency', () => {
    it('running twice produces same result — no duplicates', () => {
      const { ss } = createMockSpreadsheet();

      const report1 = seedDatabase({ spreadsheet: ss });
      expect(report1.tabsCreated).toHaveLength(14);
      expect(report1.policiesCreated).toHaveLength(2);
      expect(report1.positionsCreated).toHaveLength(7);
      expect(report1.ceoCreated).toBe(true);

      // Run again — everything should be skipped
      const report2 = seedDatabase({ spreadsheet: ss });
      expect(report2.tabsCreated).toHaveLength(0);
      expect(report2.tabsExisted).toHaveLength(14);
      expect(report2.policiesCreated).toHaveLength(0);
      expect(report2.policiesSkipped).toHaveLength(2);
      expect(report2.positionsCreated).toHaveLength(0);
      expect(report2.positionsSkipped).toHaveLength(7);
      expect(report2.ceoSkipped).toBe(true);
      expect(report2.salaryHistorySkipped).toBe(true);
    });
  });
});
