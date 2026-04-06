/**
 * Salary history handler — /salary-history (view and set).
 */

import { TABS, SAL, EMP, CHANNELS, SALARY_CHANGE_TYPES, ID_PREFIX } from '../config';
import { nextId as generateNextId } from '../utils/ids';
import { ephemeralText, errorResponse, successResponse } from '../utils/format';
import { validateSalary } from '../utils/validate';
import type { CallerInfo, ISheetsService, ISlackService, SlackMessage, SalaryChangeType } from '../types';

export interface SalaryDeps {
  sheetsService: ISheetsService;
  slackService: ISlackService;
}

const VALID_CHANGE_TYPES: SalaryChangeType[] = [
  SALARY_CHANGE_TYPES.INITIAL,
  SALARY_CHANGE_TYPES.PROBATION_END,
  SALARY_CHANGE_TYPES.REVIEW,
  SALARY_CHANGE_TYPES.PROMOTION,
  SALARY_CHANGE_TYPES.ADJUSTMENT,
];

// ─── /salary-history @employee (view) ───────────────────────────────────────

export function handleSalaryHistoryView(
  targetUserId: string,
  targetName: string,
  deps: SalaryDeps,
): SlackMessage {
  const salaryHistory = deps.sheetsService.getAll(TABS.SALARY_HISTORY);
  const entries: Array<{ date: string; oldSalary: number; newSalary: number; type: string; reason: string }> = [];

  for (let i = 1; i < salaryHistory.length; i++) {
    if (String(salaryHistory[i][SAL.USER_ID]) === targetUserId) {
      entries.push({
        date: String(salaryHistory[i][SAL.EFFECTIVE_DATE]),
        oldSalary: Number(salaryHistory[i][SAL.OLD_SALARY]),
        newSalary: Number(salaryHistory[i][SAL.NEW_SALARY]),
        type: String(salaryHistory[i][SAL.CHANGE_TYPE]),
        reason: String(salaryHistory[i][SAL.REASON] !== undefined && salaryHistory[i][SAL.REASON] !== null && salaryHistory[i][SAL.REASON] !== '' ? salaryHistory[i][SAL.REASON] : ''),
      });
    }
  }

  if (entries.length === 0) {
    return ephemeralText(`Salary History \u2014 ${targetName}\n\nNo salary history found.`);
  }

  // Sort by date ascending
  entries.sort((a, b) => a.date.localeCompare(b.date));

  const lines = [`Salary History \u2014 ${targetName}`, ''];
  for (const e of entries) {
    const arrow = e.oldSalary > 0 ? `NPR ${e.oldSalary.toLocaleString()} \u2192 ` : '';
    lines.push(`${e.date}: ${arrow}NPR ${e.newSalary.toLocaleString()} (${e.type})${e.reason ? ' \u2014 ' + e.reason : ''}`);
  }

  const current = entries[entries.length - 1];
  lines.push('', `Current: NPR ${current.newSalary.toLocaleString()} (since ${current.date})`);

  return ephemeralText(lines.join('\n'));
}

// ─── /salary-history @employee set <amount> ─────────────────────────────────

export function handleSalaryHistorySet(
  caller: CallerInfo,
  targetUserId: string,
  targetName: string,
  newSalaryRaw: string,
  changeType: string,
  reason: string,
  deps: SalaryDeps,
): SlackMessage {
  const salaryResult = validateSalary(newSalaryRaw);
  if (!salaryResult.valid) return errorResponse(salaryResult.error!);
  const newSalary = salaryResult.salary!;

  if (!VALID_CHANGE_TYPES.includes(changeType as SalaryChangeType)) {
    return errorResponse(`Invalid change type. Use: ${VALID_CHANGE_TYPES.join(', ')}`);
  }

  // Get current salary
  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  let currentSalary = 0;
  let empIndex = -1;
  for (let i = 1; i < employees.length; i++) {
    if (employees[i][EMP.USER_ID] === targetUserId) {
      currentSalary = Number(employees[i][EMP.SALARY]);
      empIndex = i;
      break;
    }
  }

  if (empIndex === -1) return errorResponse('Employee not found.');

  // Create SalaryHistory entry (append-only)
  const salaryHistory = deps.sheetsService.getAll(TABS.SALARY_HISTORY);
  const salId = generateNextId(ID_PREFIX.SALARY_HISTORY, salaryHistory, SAL.ID);
  // Effective from 1st of next month
  const now = new Date();
  const effectiveDate = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 2).padStart(2, '0')}-01`;

  deps.sheetsService.appendRow(TABS.SALARY_HISTORY, [
    salId,
    targetUserId,
    effectiveDate,
    currentSalary,
    newSalary,
    changeType,
    reason,
    caller.user_id,
    new Date().toISOString(),
  ]);

  // Update Employees.salary to new amount
  deps.sheetsService.updateCell(TABS.EMPLOYEES, empIndex + 1, EMP.SALARY + 1, newSalary);

  // Notify via #hr-alerts
  deps.slackService.postToChannel(
    CHANNELS.HR_ALERTS,
    `Salary updated: ${targetName} NPR ${currentSalary.toLocaleString()} \u2192 NPR ${newSalary.toLocaleString()} (${changeType}, effective ${effectiveDate}) by ${caller.name}`,
  );

  return successResponse(
    `Salary updated for ${targetName}: NPR ${currentSalary.toLocaleString()} \u2192 NPR ${newSalary.toLocaleString()} (${changeType}, effective ${effectiveDate})`,
  );
}
