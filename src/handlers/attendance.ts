/**
 * Attendance command handler — /in, /out, /break, /back, /clock-status.
 *
 * Attendance commands (/in, /out, /break, /back) respond publicly (in_channel)
 * so everyone in the channel sees who clocked in/out.
 * Personal commands (/clock-status) respond privately (ephemeral).
 */

import { TABS, EVENT_SOURCES, ACTIONS, CLOCK_STATES } from '../config';
import {
  getClockState,
  validateTransition,
  isDuplicateEvent,
  getDailyHours,
} from '../core/attendance';
import { todayLocal, diffHours, diffMinutes } from '../utils/dates';
import {
  formatHoursMinutes,
  errorResponse,
  ephemeralText,
  publicSuccessResponse,
  slackDate,
} from '../utils/format';
import type {
  CallerInfo,
  EventAction,
  ISheetsService,
  ISlackService,
  SlackMessage,
  SheetData,
  SheetRow,
} from '../types';

export interface AttendanceDeps {
  sheetsService: ISheetsService;
  slackService: ISlackService;
}

function createEventRow(
  caller: CallerInfo,
  action: EventAction,
  timestamp: Date,
): SheetRow {
  return [timestamp.toISOString(), caller.user_id, caller.name, action, EVENT_SOURCES.SLACK_COMMAND];
}

/**
 * Shared logic for /in, /break, /back — validate state, append event, respond publicly.
 */
function executeClockAction(
  caller: CallerInfo,
  action: EventAction,
  deps: AttendanceDeps,
  successMsg: (time: string) => string,
  checkIdempotency = false,
): SlackMessage {
  const events = deps.sheetsService.getAll(TABS.EVENTS);
  const { state, since } = getClockState(events, caller.user_id);

  const error = validateTransition(state, action, since);
  if (error !== null) return errorResponse(error);

  const now = new Date();

  if (checkIdempotency && isDuplicateEvent(events, caller.user_id, action, now)) {
    return errorResponse('Duplicate command detected. Please wait a moment.');
  }

  deps.sheetsService.appendRow(TABS.EVENTS, createEventRow(caller, action, now));

  const time = slackDate(now);
  return publicSuccessResponse(`${caller.name} — ${successMsg(time)}`);
}

export function handleClockIn(
  caller: CallerInfo,
  deps: AttendanceDeps,
): SlackMessage {
  return executeClockAction(
    caller, ACTIONS.IN, deps,
    (time) => `Clocked in at ${time}. Have a productive day!`,
    true,
  );
}

export function handleClockOut(
  caller: CallerInfo,
  deps: AttendanceDeps,
): SlackMessage {
  const events = deps.sheetsService.getAll(TABS.EVENTS);
  const { state, since } = getClockState(events, caller.user_id);

  const error = validateTransition(state, ACTIONS.OUT, since);
  if (error !== null) return errorResponse(error);

  const now = new Date();
  const outRow = createEventRow(caller, ACTIONS.OUT, now);
  deps.sheetsService.appendRow(TABS.EVENTS, outRow);

  const time = slackDate(now);
  const today = todayLocal();

  const updatedEvents: SheetData = [...events, outRow];
  const dailyResult = getDailyHours(updatedEvents, caller.user_id, today);

  return publicSuccessResponse(
    `${caller.name} — Clocked out at ${time}\n` +
      `Today's hours: ${formatHoursMinutes(dailyResult.totalWorked)}\n` +
      `Breaks: ${formatHoursMinutes(dailyResult.totalBreak)}\n` +
      `Net work: ${formatHoursMinutes(dailyResult.netHours)}`,
  );
}

export function handleBreakStart(
  caller: CallerInfo,
  deps: AttendanceDeps,
): SlackMessage {
  return executeClockAction(
    caller, ACTIONS.BREAK_START, deps,
    (time) => `Break started at ${time}. Use /back when you're back.`,
  );
}

export function handleBreakEnd(
  caller: CallerInfo,
  deps: AttendanceDeps,
): SlackMessage {
  const events = deps.sheetsService.getAll(TABS.EVENTS);
  const { state, since } = getClockState(events, caller.user_id);

  const error = validateTransition(state, ACTIONS.BREAK_END, since);
  if (error !== null) return errorResponse(error);

  const now = new Date();
  deps.sheetsService.appendRow(TABS.EVENTS, createEventRow(caller, ACTIONS.BREAK_END, now));

  const time = slackDate(now);
  const breakMins = since !== null ? Math.round(diffMinutes(since, now)) : 0;

  return publicSuccessResponse(`${caller.name} — Welcome back at ${time}! Break was ${breakMins} minutes.`);
}

export function handleStatus(
  caller: CallerInfo,
  deps: AttendanceDeps,
): SlackMessage {
  const events = deps.sheetsService.getAll(TABS.EVENTS);
  const { state, since } = getClockState(events, caller.user_id);

  if (state === CLOCK_STATES.IDLE) {
    return ephemeralText(`${caller.name} — Not clocked in.`);
  }

  const sinceTime = since !== null ? slackDate(since) : 'unknown';
  const elapsed = since !== null
    ? formatHoursMinutes(diffHours(since, new Date()))
    : '0m';

  if (state === CLOCK_STATES.CLOCKED_IN) {
    return ephemeralText(`${caller.name} — Working since ${sinceTime} (${elapsed})`);
  }

  return ephemeralText(`${caller.name} — On break since ${sinceTime} (${elapsed})`);
}
