/**
 * Test fixtures — sample Employees sheet data.
 */
import { DEFAULT_TZ_OFFSET_MS } from '../../src/config';
import type { SheetData } from '../../src/types';

export const EMPLOYEES_HEADER = [
  'user_id', 'slack_id', 'name', 'email', 'position', 'salary',
  'join_date', 'leave_accrual_start_month', 'leave_accrual_rate',
  'max_leave_cap', 'manager_id', 'is_admin', 'leave_balance', 'tz_offset', 'status',
];

export const CEO_ROW = [
  'EMP000', 'UCEO001', 'John Doe', 'john@example.com', 'CEO',
  0, '2026-01-01', 1, 0, 0, 'none', 'TRUE', 0, DEFAULT_TZ_OFFSET_MS, 'ACTIVE',
];

export const MANAGER_ROW = [
  'EMP001', 'UMGR001', 'Jane Smith', 'jane@example.com', 'CTO',
  400000, '2026-01-15', 3, 1, 20, 'EMP000', false, 5, DEFAULT_TZ_OFFSET_MS, 'ACTIVE',
];

export const EMPLOYEE_ROW = [
  'EMP002', 'UEMP001', 'Alex Dev', 'alex@example.com', 'Full Time Developer',
  350000, '2026-02-01', 3, 1, 20, 'EMP001', false, 3, DEFAULT_TZ_OFFSET_MS, 'ACTIVE',
];

export const EMPLOYEE2_ROW = [
  'EMP003', 'UEMP002', 'Yuki Tanaka', 'yuki@example.com', 'Full Time Developer',
  300000, '2026-03-01', 3, 1, 20, 'EMP001', false, 0, DEFAULT_TZ_OFFSET_MS, 'ACTIVE',
];

export const INACTIVE_ROW = [
  'EMP004', 'UINAC01', 'Former Employee', 'former@example.com', 'Full Time Developer',
  200000, '2025-01-01', 3, 1, 20, 'EMP001', false, 0, DEFAULT_TZ_OFFSET_MS, 'INACTIVE',
];

export function buildEmployeesData(...rows: SheetData[number][]): SheetData {
  return [EMPLOYEES_HEADER, ...rows];
}

export const DEFAULT_EMPLOYEES: SheetData = buildEmployeesData(
  CEO_ROW,
  MANAGER_ROW,
  EMPLOYEE_ROW,
  EMPLOYEE2_ROW,
  INACTIVE_ROW,
);
