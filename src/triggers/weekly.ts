/**
 * Weekly trigger — runs Monday 00:15 JST.
 */

import { TABS, EMP, STATUS } from '../config';
import { todayLocal, getWeekStart, addDays } from '../utils/dates';
import { checkWeeklyShortfall, loadFlagContext } from '../core/flags';
import type { ISheetsService, ISlackService } from '../types';

export function runWeeklyCheck(deps: { sheetsService: ISheetsService; slackService: ISlackService }): { shortfalls: number } {
  const today = todayLocal();
  // Previous week: go back 7 days, get that week's Monday
  const prevWeekDate = addDays(today, -7);
  const weekStart = getWeekStart(prevWeekDate)!;

  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  const ctx = loadFlagContext(deps);
  let shortfalls = 0;

  for (let i = 1; i < employees.length; i++) {
    if (String(employees[i][EMP.STATUS]).toUpperCase() !== STATUS.ACTIVE) continue;
    const userId = String(employees[i][EMP.USER_ID]);
    if (checkWeeklyShortfall(userId, weekStart, ctx, deps)) shortfalls++;
  }

  return { shortfalls };
}
