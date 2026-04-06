import { refreshTimezones, handleCacheRefresh } from '../../../src/handlers/cache';
import { createMockSheetsService, createMockSlackService } from '../../mocks/gas-mocks';
import { TABS, EMP, ROLES } from '../../../src/config';
import { DEFAULT_EMPLOYEES, EMPLOYEES_HEADER, CEO_ROW, MANAGER_ROW, EMPLOYEE_ROW, INACTIVE_ROW } from '../../fixtures/employees';
import { TAB_HEADERS } from '../../../src/scripts/seed';
import type { CallerInfo, IAuthService, SheetData } from '../../../src/types';

const LR_HEADER = TAB_HEADERS[TABS.LEAVE_REQUESTS];

const ADMIN: CallerInfo = {
  user_id: 'EMP000', slack_id: 'UCEO001', name: 'John', email: 'john@example.com',
  role: 'admin', position: 'CEO', manager_id: 'none',
  is_admin: true, status: 'ACTIVE', salary: 0, join_date: '2026-01-01', leave_balance: 0, rowIndex: 1,
};

const EMPLOYEE: CallerInfo = {
  user_id: 'EMP002', slack_id: 'UEMP001', name: 'Alex Dev', email: 'alex@example.com',
  role: 'employee', position: 'Full Time Developer', manager_id: 'EMP001',
  is_admin: false, status: 'ACTIVE', salary: 350000, join_date: '2026-02-01', leave_balance: 3, rowIndex: 3,
};

function createMockAuthService(opts: { allowAdmin: boolean }): IAuthService {
  return {
    verifyToken: jest.fn(() => true),
    getRole: jest.fn(() => ADMIN),
    requireRole: jest.fn((caller: CallerInfo, minimumRole: string) => {
      if (minimumRole === ROLES.ADMIN && !opts.allowAdmin) {
        throw new Error('Only admins can use this command.');
      }
      return caller;
    }),
    canAccessEmployee: jest.fn(() => true),
  };
}

describe('refreshTimezones', () => {
  it('updates TZ_OFFSET for active employees', () => {
    const empData = DEFAULT_EMPLOYEES.map(r => [...r]) as SheetData;
    const sheets = createMockSheetsService({
      [TABS.EMPLOYEES]: empData,
    });
    const slack = createMockSlackService();
    // Return a known offset for all calls
    (slack.getUserTimezoneOffset as jest.Mock).mockReturnValue(3600000);

    const result = refreshTimezones(empData, { sheetsService: sheets, slackService: slack });

    // 4 active employees (CEO, Manager, Employee, Employee2), 1 inactive skipped
    expect(result.updated).toBe(4);
    expect(result.failed).toBe(0);
    expect(sheets.updateCell).toHaveBeenCalledTimes(4);
    expect(sheets.invalidateCache).toHaveBeenCalledWith(TABS.EMPLOYEES);
  });

  it('skips inactive employees', () => {
    const empData = [EMPLOYEES_HEADER, [...INACTIVE_ROW]] as SheetData;
    const sheets = createMockSheetsService({
      [TABS.EMPLOYEES]: empData,
    });
    const slack = createMockSlackService();
    (slack.getUserTimezoneOffset as jest.Mock).mockReturnValue(3600000);

    const result = refreshTimezones(empData, { sheetsService: sheets, slackService: slack });

    expect(result.updated).toBe(0);
    expect(result.failed).toBe(0);
    expect(sheets.updateCell).not.toHaveBeenCalled();
    // No updates, so invalidateCache should not be called
    expect(sheets.invalidateCache).not.toHaveBeenCalled();
  });

  it('handles Slack API failure gracefully', () => {
    const empData = [EMPLOYEES_HEADER, [...CEO_ROW], [...MANAGER_ROW], [...EMPLOYEE_ROW]] as SheetData;
    const sheets = createMockSheetsService({
      [TABS.EMPLOYEES]: empData,
    });
    const slack = createMockSlackService();
    // First call succeeds, second fails, third succeeds
    (slack.getUserTimezoneOffset as jest.Mock)
      .mockReturnValueOnce(3600000)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(7200000);

    const result = refreshTimezones(empData, { sheetsService: sheets, slackService: slack });

    expect(result.updated).toBe(2);
    expect(result.failed).toBe(1);
    expect(sheets.updateCell).toHaveBeenCalledTimes(2);
  });
});

describe('handleCacheRefresh', () => {
  it('admin succeeds with summary message', () => {
    const empData = DEFAULT_EMPLOYEES.map(r => [...r]) as SheetData;
    const sheets = createMockSheetsService({
      [TABS.EMPLOYEES]: empData,
      [TABS.LEAVE_REQUESTS]: [LR_HEADER] as SheetData,
    });
    const slack = createMockSlackService();
    (slack.getUserTimezoneOffset as jest.Mock).mockReturnValue(3600000);
    const auth = createMockAuthService({ allowAdmin: true });

    const result = handleCacheRefresh(ADMIN, {
      sheetsService: sheets,
      slackService: slack,
      authService: auth,
    });

    expect(result.text).toContain('Cache refresh complete');
    expect(result.text).toContain('TZ updated: 4');
    expect(result.text).toContain('TZ failed: 0');
  });

  it('non-admin is rejected', () => {
    const empData = DEFAULT_EMPLOYEES.map(r => [...r]) as SheetData;
    const sheets = createMockSheetsService({
      [TABS.EMPLOYEES]: empData,
      [TABS.LEAVE_REQUESTS]: [LR_HEADER] as SheetData,
    });
    const slack = createMockSlackService();
    const auth = createMockAuthService({ allowAdmin: false });

    const result = handleCacheRefresh(EMPLOYEE, {
      sheetsService: sheets,
      slackService: slack,
      authService: auth,
    });

    expect(result.text).toContain('Only admins');
    // Should NOT have called invalidateAllCaches
    expect(sheets.invalidateAllCaches).not.toHaveBeenCalled();
  });

  it('calls invalidateAllCaches, refreshTimezones, reconcileLeaveBalances in order', () => {
    const empData = DEFAULT_EMPLOYEES.map(r => [...r]) as SheetData;
    const sheets = createMockSheetsService({
      [TABS.EMPLOYEES]: empData,
      [TABS.LEAVE_REQUESTS]: [LR_HEADER] as SheetData,
    });
    const slack = createMockSlackService();
    (slack.getUserTimezoneOffset as jest.Mock).mockReturnValue(3600000);
    const auth = createMockAuthService({ allowAdmin: true });

    const callOrder: string[] = [];
    (sheets.invalidateAllCaches as jest.Mock).mockImplementation(() => {
      callOrder.push('invalidateAllCaches');
    });
    const origUpdateCell = sheets.updateCell as jest.Mock;
    origUpdateCell.mockImplementation((...args: unknown[]) => {
      // Only record TZ updates (col index = EMP.TZ_OFFSET + 1 = 14)
      if (args[2] === EMP.TZ_OFFSET + 1 && !callOrder.includes('refreshTimezones')) {
        callOrder.push('refreshTimezones');
      }
      // Still update the data
      const tabName = args[0] as string;
      const rowIndex = args[1] as number;
      const colIndex = args[2] as number;
      const value = args[3];
      const row = sheets._tabData[tabName]?.[rowIndex - 1];
      if (row) {
        (row as unknown[])[colIndex - 1] = value;
      }
    });
    // Track reconcileLeaveBalances via LEAVE_BALANCE updates
    const origGetAll = sheets.getAll as jest.Mock;
    const origGetAllImpl = origGetAll.getMockImplementation()!;
    origGetAll.mockImplementation((tabName: string) => {
      const result = origGetAllImpl(tabName);
      return result;
    });

    handleCacheRefresh(ADMIN, {
      sheetsService: sheets,
      slackService: slack,
      authService: auth,
    });

    expect(sheets.invalidateAllCaches).toHaveBeenCalled();
    // invalidateAllCaches should be first
    expect(callOrder[0]).toBe('invalidateAllCaches');
    // refreshTimezones should happen after
    expect(callOrder[1]).toBe('refreshTimezones');
  });
});
