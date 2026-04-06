/**
 * Daily trigger — runs on schedule.
 * Flags unclosed sessions/breaks (does NOT auto-close).
 * Alerts HR for sessions open >24h.
 * Checks daily shortfalls per employee's timezone.
 */

import { TABS, EMP, CHANNELS, STATUS, DEFAULT_TZ_OFFSET_MS, OPEN_SESSION_ALERT_MS, CLOCK_STATES } from '../config';
import { todayLocal } from '../utils/dates';
import { getClockState } from '../core/attendance';
import { checkDailyShortfall, loadFlagContext } from '../core/flags';
import { refreshTimezones } from '../handlers/cache';
import type { ISheetsService, ISlackService, SheetData } from '../types';

export interface TriggerDeps {
  sheetsService: ISheetsService;
  slackService: ISlackService;
}

export function runDailyCheck(deps: TriggerDeps): {
  flaggedBreaks: number;
  flaggedSessions: number;
  hrAlerts: number;
  shortfalls: number;
  tzUpdated: number;
  tzFailed: number;
} {
  const events = deps.sheetsService.getAll(TABS.EVENTS);
  let employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  const now = new Date();

  let flaggedBreaks = 0;
  let flaggedSessions = 0;
  let hrAlerts = 0;

  for (let i = 1; i < employees.length; i++) {
    if (String(employees[i][EMP.STATUS]).toUpperCase() !== STATUS.ACTIVE) continue;
    const userId = String(employees[i][EMP.USER_ID]);
    const slackId = String(employees[i][EMP.SLACK_ID]);
    const name = String(employees[i][EMP.NAME]);
    const { state, since } = getClockState(events, userId);

    if (state === CLOCK_STATES.ON_BREAK) {
      // Flag only — do NOT auto-close
      flaggedBreaks++;
      deps.slackService.sendDM(
        slackId,
        `You have an unclosed break. Please use /back to end your break, then /out when done.`,
      );
    } else if (state === CLOCK_STATES.CLOCKED_IN) {
      // Flag only — do NOT auto-close
      flaggedSessions++;
      deps.slackService.sendDM(
        slackId,
        `You have an unclosed session. Please use /out to clock out.`,
      );
    }

    // Alert HR if session/break open for >24 hours
    if ((state === CLOCK_STATES.CLOCKED_IN || state === CLOCK_STATES.ON_BREAK) && since) {
      const openDuration = now.getTime() - since.getTime();
      if (openDuration > OPEN_SESSION_ALERT_MS) {
        hrAlerts++;
        deps.slackService.postToChannel(
          CHANNELS.HR_ALERTS,
          `${name} (${userId}) has an unclosed ${state === CLOCK_STATES.ON_BREAK ? 'break' : 'session'} for over 24 hours (since ${since.toISOString()}).`,
        );
      }
    }
  }

  // Refresh timezone offsets from Slack
  const { updated: tzUpdated, failed: tzFailed } = refreshTimezones(employees, {
    sheetsService: deps.sheetsService,
    slackService: deps.slackService,
  });
  // Re-read only if TZ values were actually updated
  if (tzUpdated > 0) {
    employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  }

  // Check daily shortfalls using each employee's timezone
  const ctx = loadFlagContext(deps);
  let shortfalls = 0;
  for (let i = 1; i < employees.length; i++) {
    if (String(employees[i][EMP.STATUS]).toUpperCase() !== STATUS.ACTIVE) continue;
    const userId = String(employees[i][EMP.USER_ID]);
    const tzOffset = getEmployeeTzOffset(employees[i]);
    const today = todayLocal(tzOffset);
    if (checkDailyShortfall(userId, today, ctx, deps)) shortfalls++;
  }

  return { flaggedBreaks, flaggedSessions, hrAlerts, shortfalls, tzUpdated, tzFailed };
}

function getEmployeeTzOffset(empRow: SheetData[number]): number {
  const stored = empRow[EMP.TZ_OFFSET];
  if (stored !== null && stored !== undefined && stored !== '') {
    return Number(stored);
  }
  return DEFAULT_TZ_OFFSET_MS;
}
