/**
 * Attendance state machine and hours calculation.
 * Pure functions — no GAS dependencies.
 */

import { EVT, IDEMPOTENCY_WINDOW_MS, ACTIONS, CLOCK_STATES } from '../config';
import { diffHours, diffMinutes, getDateOfTimestamp } from '../utils/dates';
import { slackDate } from '../utils/format';
import type {
  ClockState,
  ClockStateResult,
  EventAction,
  DailyHoursResult,
  SheetData,
} from '../types';

/**
 * Derive clock state from user's most recent event.
 */
export function getClockState(
  eventsData: SheetData,
  userId: string,
): ClockStateResult {
  let lastAction: EventAction | null = null;
  let lastTimestamp: Date | null = null;
  let sessionStartTimestamp: Date | null = null;

  // Scan backwards to find the last meaningful action and the session start (IN)
  for (let i = eventsData.length - 1; i >= 1; i--) {
    if (eventsData[i][EVT.USER_ID] !== userId) continue;
    const action = eventsData[i][EVT.ACTION] as EventAction;
    if (action === ACTIONS.VOID) continue;

    if (lastAction === null) {
      lastAction = action;
      lastTimestamp = new Date(eventsData[i][EVT.TIMESTAMP] as string);
    }

    // Found the session start — this is the original /in time
    if (action === ACTIONS.IN) {
      sessionStartTimestamp = new Date(eventsData[i][EVT.TIMESTAMP] as string);
      break;
    }
    // If we hit an OUT, the session ended before — no active session
    if (action === ACTIONS.OUT) {
      break;
    }
  }

  if (lastAction === null || lastAction === ACTIONS.OUT) {
    return { state: CLOCK_STATES.IDLE, since: null, lastAction };
  }
  if (lastAction === ACTIONS.IN || lastAction === ACTIONS.BREAK_END) {
    // "since" = original /in time of the current session, not the last event
    return { state: CLOCK_STATES.CLOCKED_IN, since: sessionStartTimestamp, lastAction };
  }
  if (lastAction === ACTIONS.BREAK_START) {
    return { state: CLOCK_STATES.ON_BREAK, since: lastTimestamp, lastAction };
  }
  return { state: CLOCK_STATES.IDLE, since: null, lastAction };
}

// Static error messages — no interpolation needed. Entries with `null` are valid transitions.
// Entries starting with `$TIME` are templates that need sinceTime interpolation.
const TRANSITION_ERRORS: Record<ClockState, Record<EventAction, string | null>> = {
  [CLOCK_STATES.IDLE]: {
    [ACTIONS.IN]: null,
    [ACTIONS.OUT]: "You haven't clocked in today.",
    [ACTIONS.BREAK_START]: 'Clock in first with /in.',
    [ACTIONS.BREAK_END]: "You're not on a break.",
    [ACTIONS.VOID]: 'Nothing to void.',
  },
  [CLOCK_STATES.CLOCKED_IN]: {
    [ACTIONS.IN]: '$TIME:Already clocked in since',
    [ACTIONS.OUT]: null,
    [ACTIONS.BREAK_START]: null,
    [ACTIONS.BREAK_END]: "You're not on a break.",
    [ACTIONS.VOID]: null,
  },
  [CLOCK_STATES.ON_BREAK]: {
    [ACTIONS.IN]: '$TIME:Already clocked in since',
    [ACTIONS.OUT]: "You're on break. Use /back first, then /out.",
    [ACTIONS.BREAK_START]: '$TIME:Already on break since',
    [ACTIONS.BREAK_END]: null,
    [ACTIONS.VOID]: null,
  },
};

/**
 * Validate a state transition. Returns error message or null if valid.
 */
export function validateTransition(
  currentState: ClockState,
  command: EventAction,
  since: Date | null,
): string | null {
  const error = TRANSITION_ERRORS[currentState][command];
  if (error === null) return null;
  if (error.startsWith('$TIME:')) {
    const sinceTime = since ? slackDate(since) : '';
    return `${error.slice(6)} ${sinceTime}.`;
  }
  return error;
}

/**
 * Check for duplicate event within idempotency window.
 */
export function isDuplicateEvent(
  eventsData: SheetData,
  userId: string,
  action: EventAction,
  now: Date,
): boolean {
  for (let i = eventsData.length - 1; i >= 1; i--) {
    if (eventsData[i][EVT.USER_ID] !== userId) continue;
    if (eventsData[i][EVT.ACTION] !== action) break;

    const eventTime = new Date(eventsData[i][EVT.TIMESTAMP] as string);
    if (now.getTime() - eventTime.getTime() < IDEMPOTENCY_WINDOW_MS) {
      return true;
    }
    break;
  }
  return false;
}

/**
 * Calculate daily hours from events for a specific date.
 * Cross-midnight: all hours count toward the IN event's date.
 */
export function getDailyHours(
  eventsData: SheetData,
  userId: string,
  targetDate: string,
): DailyHoursResult {
  const result: DailyHoursResult = {
    date: targetDate,
    sessions: [],
    breaks: [],
    totalWorked: 0,
    totalBreak: 0,
    netHours: 0,
  };

  // Collect events for this user, assigned to the target date
  const userEvents: Array<{ timestamp: Date; action: EventAction }> = [];

  for (let i = 1; i < eventsData.length; i++) {
    if (eventsData[i][EVT.USER_ID] !== userId) continue;

    const timestamp = new Date(eventsData[i][EVT.TIMESTAMP] as string);
    const action = eventsData[i][EVT.ACTION] as EventAction;

    // For IN events, check if the date matches
    if (action === ACTIONS.IN) {
      const eventDate = getDateOfTimestamp(timestamp);
      if (eventDate === targetDate) {
        userEvents.push({ timestamp, action });
      }
    } else {
      // For OUT/BREAK_START/BREAK_END, find the matching IN
      // If the most recent IN in userEvents exists, this event belongs to the same session
      if (userEvents.length > 0) {
        userEvents.push({ timestamp, action });
      } else {
        // Check if there's a preceding IN for this user on the target date
        const eventDate = getDateOfTimestamp(timestamp);
        if (eventDate === targetDate) {
          userEvents.push({ timestamp, action });
        }
      }
    }
  }

  // Sort by timestamp so appended fix events are in chronological order
  userEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  // Pair IN/OUT events into sessions
  let currentIn: Date | null = null;

  for (const evt of userEvents) {
    if (evt.action === ACTIONS.IN) {
      currentIn = evt.timestamp;
    } else if (evt.action === ACTIONS.OUT && currentIn) {
      const hours = diffHours(currentIn, evt.timestamp);
      result.sessions.push({ start: currentIn, end: evt.timestamp, hours });
      result.totalWorked += hours;
      currentIn = null;
    } else if (evt.action === ACTIONS.BREAK_START) {
      result.breaks.push({ start: evt.timestamp, end: null, minutes: 0 });
    } else if (evt.action === ACTIONS.BREAK_END) {
      const lastBreak = result.breaks[result.breaks.length - 1];
      if (lastBreak !== undefined && lastBreak !== null && lastBreak.end === null) {
        lastBreak.end = evt.timestamp;
        lastBreak.minutes = diffMinutes(lastBreak.start, evt.timestamp);
        result.totalBreak += lastBreak.minutes / 60;
      }
    }
  }

  // Handle open session (clocked in but not out yet)
  if (currentIn) {
    result.sessions.push({ start: currentIn, end: null, hours: 0 });
  }

  result.netHours = Math.max(0, result.totalWorked - result.totalBreak);
  return result;
}
