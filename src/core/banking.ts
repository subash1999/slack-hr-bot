/**
 * Banking service — surplus approval, expiry, notifications.
 */

import { TABS, BANK, EMP, PERIOD_TYPES } from '../config';
import { addDays, todayLocal } from '../utils/dates';
import { errorResponse, successResponse } from '../utils/format';
import type { ISheetsService, ISlackService, SlackMessage, SheetData } from '../types';

export interface BankingDeps {
  sheetsService: ISheetsService;
  slackService: ISlackService;
}

// ─── /approve-surplus ───────────────────────────────────────────────────────

export function handleApproveSurplus(
  managerId: string,
  targetUserId: string,
  yearMonth: string,
  surplusHours: number,
  maxLeaveDays: number,
  deps: BankingDeps,
): SlackMessage {
  if (surplusHours <= 0) {
    return errorResponse('Surplus hours must be positive.');
  }
  if (maxLeaveDays < 0) {
    return errorResponse('Max leave days cannot be negative.');
  }

  // Calculate expiry: 12 months from period start (1st of yearMonth)
  const expiresAt = calculateExpiry(yearMonth);

  const row = [
    targetUserId,
    PERIOD_TYPES.MONTHLY,
    yearMonth,
    0,              // required_hours (filled by caller if needed)
    0,              // actual_hours
    surplusHours,
    0,              // used_hours
    surplusHours,   // remaining_hours
    managerId,
    maxLeaveDays,
    expiresAt,
  ];
  deps.sheetsService.appendRow(TABS.HOURS_BANK, row);

  return successResponse(
    `Banked ${surplusHours}h surplus for ${yearMonth} (max ${maxLeaveDays} leave days, expires ${expiresAt}).`,
  );
}

function calculateExpiry(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  // 12 months from period start → last day of same month next year
  const lastDay = new Date(Date.UTC(year + 1, month, 0)).getUTCDate();
  return `${year + 1}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

// ─── Bank Expiry Processing ─────────────────────────────────────────────────

export function processExpiry(
  deps: BankingDeps,
): { expired: number; warned: number } {
  const bankData = deps.sheetsService.getAll(TABS.HOURS_BANK);
  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  const today = todayLocal();
  const warningDate = addDays(today, 30);
  let expired = 0;
  let warned = 0;

  for (let i = 1; i < bankData.length; i++) {
    const remaining = Number(bankData[i][BANK.REMAINING_HOURS]);
    if (remaining <= 0) continue;

    const expiresAt = String(bankData[i][BANK.EXPIRES_AT]);
    const userId = String(bankData[i][BANK.USER_ID]);

    // Expired — forfeit
    if (expiresAt <= today) {
      deps.sheetsService.updateCell(TABS.HOURS_BANK, i + 1, BANK.REMAINING_HOURS + 1, 0);
      expired++;
      notifyUser(userId, `Your banked surplus of ${remaining}h from ${String(bankData[i][BANK.PERIOD_VALUE])} has expired and been forfeited.`, employees, deps);
      continue;
    }

    // Within 30-day warning window
    if (expiresAt <= warningDate) {
      warned++;
      notifyUser(userId, `Your banked surplus of ${remaining}h from ${String(bankData[i][BANK.PERIOD_VALUE])} expires on ${expiresAt}. Use it or lose it!`, employees, deps);
      // Also notify manager
      const approvedBy = String(bankData[i][BANK.APPROVED_BY]);
      notifyUser(approvedBy, `${getEmployeeName(userId, employees)}'s banked ${remaining}h (${String(bankData[i][BANK.PERIOD_VALUE])}) expires ${expiresAt}.`, employees, deps);
    }
  }

  return { expired, warned };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function notifyUser(
  userId: string,
  message: string,
  employees: SheetData,
  deps: BankingDeps,
): void {
  for (let i = 1; i < employees.length; i++) {
    if (employees[i][EMP.USER_ID] === userId) {
      deps.slackService.sendDM(String(employees[i][EMP.SLACK_ID]), message);
      return;
    }
  }
}

function getEmployeeName(userId: string, employees: SheetData): string {
  for (let i = 1; i < employees.length; i++) {
    if (employees[i][EMP.USER_ID] === userId) return String(employees[i][EMP.NAME]);
  }
  return userId;
}
