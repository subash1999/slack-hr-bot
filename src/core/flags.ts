/**
 * Flag service — shortfall detection, creation, and resolution.
 */

import { TABS, FLAG, LR, PA, BANK, EMP, STATUS, ID_PREFIX, PERIOD_TYPES } from '../config';
import { getDailyHours } from './attendance';
import { getWeeklyHours, getMonthlyHours, getHourRequirements } from './calculator';
import { getWeekDates } from '../utils/dates';
import type { ISheetsService, ISlackService, SheetData, FlagStatus } from '../types';

export interface FlagDeps {
  sheetsService: ISheetsService;
  slackService: ISlackService;
}

/** Pre-fetched sheet data to avoid duplicate reads across check functions. */
export interface FlagContext {
  events: SheetData;
  employees: SheetData;
  positions: SheetData;
  policies: SheetData;
  overrides: SheetData;
  leaveReqs: SheetData;
  preApprovals: SheetData;
  flags: SheetData;
}

/** Load all sheets needed for flag checks once. */
export function loadFlagContext(deps: FlagDeps): FlagContext {
  return {
    events: deps.sheetsService.getAll(TABS.EVENTS),
    employees: deps.sheetsService.getAll(TABS.EMPLOYEES),
    positions: deps.sheetsService.getAll(TABS.POSITIONS),
    policies: deps.sheetsService.getAll(TABS.POLICIES),
    overrides: deps.sheetsService.getAll(TABS.OVERRIDES),
    leaveReqs: deps.sheetsService.getAll(TABS.LEAVE_REQUESTS),
    preApprovals: deps.sheetsService.getAll(TABS.PRE_APPROVALS),
    flags: deps.sheetsService.getAll(TABS.FLAGS),
  };
}

// ─── Shortfall Detection ────────────────────────────────────────────────────

export function checkDailyShortfall(
  userId: string,
  date: string,
  ctx: FlagContext,
  deps: FlagDeps,
): boolean {
  if (hasPreApproval(userId, date, ctx.preApprovals)) return false;
  if (hasApprovedLeave(userId, date, ctx.leaveReqs)) return false;

  const daily = getDailyHours(ctx.events, userId, date);
  const reqs = getHourRequirements(userId, ctx.employees, ctx.positions, ctx.policies, ctx.overrides, PERIOD_TYPES.DAILY, date);

  if (daily.netHours < reqs.daily) {
    createFlag(userId, PERIOD_TYPES.DAILY, date, reqs.daily, daily.netHours, ctx, deps);
    return true;
  }
  return false;
}

export function checkWeeklyShortfall(
  userId: string,
  weekStartDate: string,
  ctx: FlagContext,
  deps: FlagDeps,
): boolean {
  // Skip if every day in the week has approved leave or pre-approval
  const dates = getWeekDates(weekStartDate);
  const allCovered = dates.every(
    (d) => hasPreApproval(userId, d, ctx.preApprovals) || hasApprovedLeave(userId, d, ctx.leaveReqs),
  );
  if (allCovered) return false;

  const weekly = getWeeklyHours(ctx.events, userId, weekStartDate);
  const reqs = getHourRequirements(userId, ctx.employees, ctx.positions, ctx.policies, ctx.overrides, PERIOD_TYPES.WEEKLY, weekStartDate);

  if (weekly.totalHours < reqs.weekly) {
    createFlag(userId, PERIOD_TYPES.WEEKLY, weekStartDate, reqs.weekly, weekly.totalHours, ctx, deps);
    return true;
  }
  return false;
}

export function checkMonthlyShortfall(
  userId: string,
  yearMonth: string,
  ctx: FlagContext,
  deps: FlagDeps,
): boolean {
  const monthly = getMonthlyHours(ctx.events, ctx.leaveReqs, ctx.preApprovals, userId, yearMonth);
  const reqs = getHourRequirements(userId, ctx.employees, ctx.positions, ctx.policies, ctx.overrides, PERIOD_TYPES.MONTHLY, yearMonth);

  if (monthly.totalHours < reqs.monthly) {
    createFlag(userId, PERIOD_TYPES.MONTHLY, yearMonth, reqs.monthly, monthly.totalHours, ctx, deps);
    return true;
  }
  return false;
}

// ─── Flag Creation ──────────────────────────────────────────────────────────

function nextFlagId(flags: SheetData): string {
  let maxNum = 0;
  const pattern = new RegExp(`^${ID_PREFIX.FLAG}(\\d+)$`);
  for (let i = 1; i < flags.length; i++) {
    const idStr = String(flags[i][FLAG.ID]);
    const match = idStr.match(pattern);
    if (match) {
      maxNum = Math.max(maxNum, parseInt(match[1], 10));
    }
  }
  return `${ID_PREFIX.FLAG}${String(maxNum + 1).padStart(4, '0')}`;
}

function createFlag(
  userId: string,
  periodType: string,
  periodValue: string,
  expected: number,
  actual: number,
  ctx: FlagContext,
  deps: FlagDeps,
): void {
  const flagId = nextFlagId(ctx.flags);
  const shortfall = Math.round((expected - actual) * 100) / 100;

  let managerId = '';
  for (let i = 1; i < ctx.employees.length; i++) {
    if (ctx.employees[i][EMP.USER_ID] === userId) {
      managerId = String(ctx.employees[i][EMP.MANAGER_ID]);
      break;
    }
  }

  const row = [
    flagId, userId, periodType, periodValue, expected, actual, shortfall,
    STATUS.PENDING, 0, shortfall, managerId, '', '',
  ];
  deps.sheetsService.appendRow(TABS.FLAGS, row);
  // Also add to context so subsequent calls see the new flag
  ctx.flags.push(row);
}

// ─── Flag Resolution ────────────────────────────────────────────────────────

export function resolveFlag(
  flagId: string,
  resolution: FlagStatus,
  bankOffsetHours: number,
  managerId: string,
  notes: string,
  deps: FlagDeps,
): { success: boolean; error?: string } {
  const flags = deps.sheetsService.getAll(TABS.FLAGS);
  let flagRowIndex = -1;

  for (let i = 1; i < flags.length; i++) {
    if (String(flags[i][FLAG.ID]) === flagId) {
      flagRowIndex = i;
      break;
    }
  }

  if (flagRowIndex === -1) return { success: false, error: 'Flag not found.' };

  const shortfall = Number(flags[flagRowIndex][FLAG.SHORTFALL_HOURS]);
  const userId = String(flags[flagRowIndex][FLAG.USER_ID]);
  const sheetRow = flagRowIndex + 1;

  // Apply bank offset if requested
  if (bankOffsetHours > 0 && (resolution === STATUS.BANK_OFFSET || resolution === STATUS.APPROVED_DEDUCT)) {
    const bankData = deps.sheetsService.getAll(TABS.HOURS_BANK);
    let remainingOffset = bankOffsetHours;

    for (let i = 1; i < bankData.length && remainingOffset > 0; i++) {
      if (bankData[i][BANK.USER_ID] !== userId) continue;
      const remaining = Number(bankData[i][BANK.REMAINING_HOURS]);
      if (remaining <= 0) continue;

      const use = Math.min(remaining, remainingOffset);
      deps.sheetsService.updateCell(TABS.HOURS_BANK, i + 1, BANK.USED_HOURS + 1,
        Number(bankData[i][BANK.USED_HOURS]) + use);
      deps.sheetsService.updateCell(TABS.HOURS_BANK, i + 1, BANK.REMAINING_HOURS + 1,
        remaining - use);
      remainingOffset -= use;
    }
  }

  const effectiveDeficit = Math.max(0, shortfall - bankOffsetHours);

  deps.sheetsService.updateCell(TABS.FLAGS, sheetRow, FLAG.STATUS + 1, resolution);
  deps.sheetsService.updateCell(TABS.FLAGS, sheetRow, FLAG.BANK_OFFSET_HOURS + 1, bankOffsetHours);
  deps.sheetsService.updateCell(TABS.FLAGS, sheetRow, FLAG.EFFECTIVE_DEFICIT + 1, effectiveDeficit);
  deps.sheetsService.updateCell(TABS.FLAGS, sheetRow, FLAG.MANAGER_ID + 1, managerId);
  deps.sheetsService.updateCell(TABS.FLAGS, sheetRow, FLAG.RESOLVED_AT + 1, new Date().toISOString());
  deps.sheetsService.updateCell(TABS.FLAGS, sheetRow, FLAG.NOTES + 1, notes);

  return { success: true };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function hasPreApproval(userId: string, date: string, preApprovals: SheetData): boolean {
  for (let i = 1; i < preApprovals.length; i++) {
    if (preApprovals[i][PA.USER_ID] === userId && String(preApprovals[i][PA.DATE]) === date) {
      return true;
    }
  }
  return false;
}

function hasApprovedLeave(userId: string, date: string, leaveReqs: SheetData): boolean {
  for (let i = 1; i < leaveReqs.length; i++) {
    if (
      leaveReqs[i][LR.USER_ID] === userId &&
      String(leaveReqs[i][LR.DATE]) === date &&
      String(leaveReqs[i][LR.STATUS]) === STATUS.APPROVED
    ) {
      return true;
    }
  }
  return false;
}

// ─── Get Available Bank ─────────────────────────────────────────────────────

export function getAvailableBank(
  userId: string,
  bankData: SheetData,
  today: string,
): Array<{ periodValue: string; remaining: number; expiresAt: string }> {
  const entries: Array<{ periodValue: string; remaining: number; expiresAt: string }> = [];
  for (let i = 1; i < bankData.length; i++) {
    if (bankData[i][BANK.USER_ID] !== userId) continue;
    const remaining = Number(bankData[i][BANK.REMAINING_HOURS]);
    const expiresAt = String(bankData[i][BANK.EXPIRES_AT]);
    if (remaining <= 0 || expiresAt < today) continue;
    entries.push({
      periodValue: String(bankData[i][BANK.PERIOD_VALUE]),
      remaining,
      expiresAt,
    });
  }
  return entries;
}
