/**
 * Monthly trigger — runs 1st of month at 00:30 JST.
 * Processes previous month: flags, surplus expiry, leave accrual, MonthlySummary.
 */

import { TABS, EMP, LR, STATUS, LEAVE_TYPES, PERIOD_TYPES } from '../config';
import { todayLocal, parseDate, formatDate, monthsBetween } from '../utils/dates';
import { checkMonthlyShortfall, loadFlagContext } from '../core/flags';
import { processExpiry } from '../core/banking';
import { getMonthlyHours, getHourRequirements } from '../core/calculator';
import type { ISheetsService, ISlackService, SheetData } from '../types';

export interface MonthlyResult {
  shortfalls: number;
  expired: number;
  warned: number;
  accrued: number;
  summaries: number;
  reconciliationIssues: number;
}

export function runMonthlyCheck(deps: { sheetsService: ISheetsService; slackService: ISlackService }): MonthlyResult {
  const today = todayLocal();
  const d = parseDate(today)!;
  d.setUTCMonth(d.getUTCMonth() - 1);
  const prevMonth = formatDate(d).slice(0, 7);

  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);

  // 1. Monthly shortfall flags
  const ctx = loadFlagContext(deps);
  let shortfalls = 0;
  for (let i = 1; i < employees.length; i++) {
    if (String(employees[i][EMP.STATUS]).toUpperCase() !== STATUS.ACTIVE) continue;
    if (checkMonthlyShortfall(String(employees[i][EMP.USER_ID]), prevMonth, ctx, deps)) shortfalls++;
  }

  // 2. Surplus expiry
  const { expired, warned } = processExpiry(deps);

  // 3. Leave accrual
  const accrued = runLeaveAccrual(employees, deps);

  // 4. MonthlySummary
  const summaries = generateMonthlySummaries(prevMonth, employees, deps);

  // 5. Reconciliation
  const reconciliationIssues = reconcileLeaveBalances(employees, deps);

  return { shortfalls, expired, warned, accrued, summaries, reconciliationIssues };
}

function runLeaveAccrual(employees: SheetData, deps: { sheetsService: ISheetsService }): number {
  const today = parseDate(todayLocal())!;
  let accrued = 0;

  for (let i = 1; i < employees.length; i++) {
    if (String(employees[i][EMP.STATUS]).toUpperCase() !== STATUS.ACTIVE) continue;

    const joinDate = parseDate(String(employees[i][EMP.JOIN_DATE]));
    if (!joinDate) continue;

    const startMonth = Number(employees[i][EMP.LEAVE_ACCRUAL_START_MONTH]) || 3;
    const rate = Number(employees[i][EMP.LEAVE_ACCRUAL_RATE]) || 0;
    const cap = Number(employees[i][EMP.MAX_LEAVE_CAP]) || 0;

    if (rate <= 0) continue;

    const months = monthsBetween(joinDate, today);
    if (months < startMonth) continue;

    let balance = Number(employees[i][EMP.LEAVE_BALANCE]) || 0;
    balance += rate;
    if (cap > 0 && balance > cap) balance = cap;

    deps.sheetsService.updateCell(TABS.EMPLOYEES, i + 1, EMP.LEAVE_BALANCE + 1, balance);
    accrued++;
  }

  return accrued;
}

function generateMonthlySummaries(
  yearMonth: string,
  employees: SheetData,
  deps: { sheetsService: ISheetsService },
): number {
  const events = deps.sheetsService.getAll(TABS.EVENTS);
  const leaveReqs = deps.sheetsService.getAll(TABS.LEAVE_REQUESTS);
  const preApprovals = deps.sheetsService.getAll(TABS.PRE_APPROVALS);
  const positions = deps.sheetsService.getAll(TABS.POSITIONS);
  const policies = deps.sheetsService.getAll(TABS.POLICIES);
  const overrides = deps.sheetsService.getAll(TABS.OVERRIDES);
  const existing = deps.sheetsService.getAll(TABS.MONTHLY_SUMMARY);

  let count = 0;
  for (let i = 1; i < employees.length; i++) {
    if (String(employees[i][EMP.STATUS]).toUpperCase() !== STATUS.ACTIVE) continue;
    const userId = String(employees[i][EMP.USER_ID]);

    // Idempotency: skip if summary already exists
    const alreadyExists = existing.some(
      (r, idx) => idx > 0 && r[0] === userId && r[1] === yearMonth,
    );
    if (alreadyExists) continue;

    const monthly = getMonthlyHours(events, leaveReqs, preApprovals, userId, yearMonth);
    const reqs = getHourRequirements(userId, employees, positions, policies, overrides, PERIOD_TYPES.MONTHLY, yearMonth);

    deps.sheetsService.appendRow(TABS.MONTHLY_SUMMARY, [
      userId, yearMonth, monthly.workedHours, monthly.paidLeaveHours,
      monthly.totalHours, reqs.monthly,
      Math.max(0, reqs.monthly - monthly.totalHours),
      0, // bank_offset
      Math.max(0, reqs.monthly - monthly.totalHours), // effective_deficit
      STATUS.PENDING, // flag_status
    ]);
    count++;
  }
  return count;
}

/**
 * Reconcile cached leave_balance vs computed. Log discrepancies.
 */
export function reconcileLeaveBalances(
  employees: SheetData,
  deps: { sheetsService: ISheetsService },
): number {
  const leaveReqs = deps.sheetsService.getAll(TABS.LEAVE_REQUESTS);
  let issues = 0;

  for (let i = 1; i < employees.length; i++) {
    if (String(employees[i][EMP.STATUS]).toUpperCase() !== STATUS.ACTIVE) continue;
    const userId = String(employees[i][EMP.USER_ID]);
    const cached = Number(employees[i][EMP.LEAVE_BALANCE]) || 0;
    const computed = computeLeaveBalance(userId, employees[i], leaveReqs);

    if (Math.abs(cached - computed) > 0.01) {
      issues++;
      // Auto-fix by updating to computed value
      deps.sheetsService.updateCell(TABS.EMPLOYEES, i + 1, EMP.LEAVE_BALANCE + 1, computed);
    }
  }

  return issues;
}

/**
 * Update or create a MonthlySummary row for a single user/month.
 * Called after fix requests modify historical events.
 */
export function updateMonthlySummaryRow(
  userId: string,
  yearMonth: string,
  deps: { sheetsService: ISheetsService; slackService?: ISlackService },
): void {
  const events = deps.sheetsService.getAll(TABS.EVENTS);
  const leaveReqs = deps.sheetsService.getAll(TABS.LEAVE_REQUESTS);
  const preApprovals = deps.sheetsService.getAll(TABS.PRE_APPROVALS);
  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  const positions = deps.sheetsService.getAll(TABS.POSITIONS);
  const policies = deps.sheetsService.getAll(TABS.POLICIES);
  const overrides = deps.sheetsService.getAll(TABS.OVERRIDES);
  const existing = deps.sheetsService.getAll(TABS.MONTHLY_SUMMARY);

  const monthly = getMonthlyHours(events, leaveReqs, preApprovals, userId, yearMonth);
  const reqs = getHourRequirements(userId, employees, positions, policies, overrides, PERIOD_TYPES.MONTHLY, yearMonth);

  // Check if a row already exists
  let existingIndex = -1;
  for (let i = 1; i < existing.length; i++) {
    if (existing[i][0] === userId && existing[i][1] === yearMonth) {
      existingIndex = i;
      break;
    }
  }

  if (existingIndex >= 0) {
    // Update existing row — 1-based row, 1-based column
    const sheetRow = existingIndex + 1;
    deps.sheetsService.updateCell(TABS.MONTHLY_SUMMARY, sheetRow, 3, monthly.workedHours);
    deps.sheetsService.updateCell(TABS.MONTHLY_SUMMARY, sheetRow, 4, monthly.paidLeaveHours);
    deps.sheetsService.updateCell(TABS.MONTHLY_SUMMARY, sheetRow, 5, monthly.totalHours);
    deps.sheetsService.updateCell(TABS.MONTHLY_SUMMARY, sheetRow, 6, reqs.monthly);
    deps.sheetsService.updateCell(TABS.MONTHLY_SUMMARY, sheetRow, 7, Math.max(0, reqs.monthly - monthly.totalHours));
    // Columns 8 (bank_offset) and 9 (effective_deficit) are left as-is for existing rows
  } else {
    // Create new row
    deps.sheetsService.appendRow(TABS.MONTHLY_SUMMARY, [
      userId, yearMonth, monthly.workedHours, monthly.paidLeaveHours,
      monthly.totalHours, reqs.monthly,
      Math.max(0, reqs.monthly - monthly.totalHours),
      0, // bank_offset
      Math.max(0, reqs.monthly - monthly.totalHours), // effective_deficit
      STATUS.PENDING, // flag_status
    ]);
  }
}

function computeLeaveBalance(
  userId: string,
  empRow: SheetData[number],
  leaveReqs: SheetData,
): number {
  const joinDate = parseDate(String(empRow[EMP.JOIN_DATE]));
  if (!joinDate) return 0;

  const rate = Number(empRow[EMP.LEAVE_ACCRUAL_RATE]) || 0;
  const startMonth = Number(empRow[EMP.LEAVE_ACCRUAL_START_MONTH]) || 3;
  const cap = Number(empRow[EMP.MAX_LEAVE_CAP]) || 0;

  const today = parseDate(todayLocal())!;
  const totalMonths = monthsBetween(joinDate, today);
  const accrualMonths = Math.max(0, totalMonths - startMonth);
  let accrued = accrualMonths * rate;
  if (cap > 0) accrued = Math.min(accrued, cap);

  // Count used paid leave
  let used = 0;
  for (let i = 1; i < leaveReqs.length; i++) {
    if (
      leaveReqs[i][LR.USER_ID] === userId &&
      String(leaveReqs[i][LR.TYPE]) === LEAVE_TYPES.PAID &&
      String(leaveReqs[i][LR.STATUS]) === STATUS.APPROVED
    ) {
      used++;
    }
  }

  return Math.max(0, accrued - used);
}
