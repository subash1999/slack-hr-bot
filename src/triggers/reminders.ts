/**
 * Reminder trigger — runs every 4 hours.
 * Checks pending leave requests >24h and bank expiry warnings.
 */

import { TABS, LR, EMP, BANK, STATUS } from '../config';
import { todayLocal, addDays } from '../utils/dates';
import type { ISheetsService, ISlackService } from '../types';

export function runReminders(deps: { sheetsService: ISheetsService; slackService: ISlackService }): { leaveReminders: number; bankWarnings: number } {
  const leaveReminders = checkPendingLeave(deps);
  const bankWarnings = checkExpiringBank(deps);
  return { leaveReminders, bankWarnings };
}

function checkPendingLeave(deps: { sheetsService: ISheetsService; slackService: ISlackService }): number {
  const leaveReqs = deps.sheetsService.getAll(TABS.LEAVE_REQUESTS);
  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  let reminders = 0;

  for (let i = 1; i < leaveReqs.length; i++) {
    if (String(leaveReqs[i][LR.STATUS]) !== STATUS.PENDING) continue;

    const requestedAt = new Date(String(leaveReqs[i][LR.REQUESTED_AT]));
    if (now - requestedAt.getTime() < ONE_DAY_MS) continue;

    // Find employee's manager
    const userId = String(leaveReqs[i][LR.USER_ID]);
    for (let j = 1; j < employees.length; j++) {
      if (employees[j][EMP.USER_ID] === userId) {
        const managerId = String(employees[j][EMP.MANAGER_ID]);
        // Find manager's slack_id
        for (let k = 1; k < employees.length; k++) {
          if (employees[k][EMP.USER_ID] === managerId) {
            deps.slackService.sendDM(
              String(employees[k][EMP.SLACK_ID]),
              `Reminder: Leave request from ${String(employees[j][EMP.NAME])} for ${String(leaveReqs[i][LR.DATE])} is pending for more than 24 hours.`,
            );
            reminders++;
            break;
          }
        }
        break;
      }
    }
  }

  return reminders;
}

function checkExpiringBank(deps: { sheetsService: ISheetsService; slackService: ISlackService }): number {
  const bankData = deps.sheetsService.getAll(TABS.HOURS_BANK);
  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  const today = todayLocal();
  const warningDate = addDays(today, 30);
  let warnings = 0;

  for (let i = 1; i < bankData.length; i++) {
    const remaining = Number(bankData[i][BANK.REMAINING_HOURS]);
    if (remaining <= 0) continue;

    const expiresAt = String(bankData[i][BANK.EXPIRES_AT]);
    if (expiresAt > warningDate || expiresAt <= today) continue;

    const userId = String(bankData[i][BANK.USER_ID]);
    for (let j = 1; j < employees.length; j++) {
      if (employees[j][EMP.USER_ID] === userId) {
        deps.slackService.sendDM(
          String(employees[j][EMP.SLACK_ID]),
          `Reminder: ${remaining}h banked surplus from ${String(bankData[i][BANK.PERIOD_VALUE])} expires ${expiresAt}.`,
        );
        warnings++;
        break;
      }
    }
  }

  return warnings;
}
