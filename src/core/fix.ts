/**
 * Fix request business logic — validate historical state transitions,
 * apply approved fixes, recalculate hours.
 */

import { TABS, EVT, EMP, CHANNELS, ACTIONS, CLOCK_STATES, EVENT_SOURCES } from '../config';
import { getDateOfTimestamp } from '../utils/dates';
import { updateMonthlySummaryRow } from '../triggers/monthly';
import type {
  EventAction,
  ClockState,
  FixRequest,
  FixProposedAction,
  SheetData,
  ISheetsService,
  ISlackService,
} from '../types';

/** Map FixProposedAction → EventAction for ADD_* actions. */
const FIX_ACTION_MAP: Record<Exclude<FixProposedAction, 'CANCEL'>, EventAction> = {
  ADD_IN: ACTIONS.IN,
  ADD_OUT: ACTIONS.OUT,
  ADD_BREAK_START: ACTIONS.BREAK_START,
  ADD_BREAK_END: ACTIONS.BREAK_END,
};

/** Allowed transitions: currentState → set of valid next actions. */
const VALID_TRANSITIONS: Record<ClockState, ReadonlySet<EventAction>> = {
  [CLOCK_STATES.IDLE]: new Set([ACTIONS.IN]),
  [CLOCK_STATES.CLOCKED_IN]: new Set([ACTIONS.OUT, ACTIONS.BREAK_START]),
  [CLOCK_STATES.ON_BREAK]: new Set([ACTIONS.BREAK_END]),
};

/**
 * Derive the clock state by replaying a sorted list of actions.
 * Returns the state after all actions have been applied.
 */
function replayState(actions: EventAction[]): ClockState {
  let state: ClockState = CLOCK_STATES.IDLE;
  for (const action of actions) {
    if (action === ACTIONS.IN) state = CLOCK_STATES.CLOCKED_IN;
    else if (action === ACTIONS.OUT) state = CLOCK_STATES.IDLE;
    else if (action === ACTIONS.BREAK_START) state = CLOCK_STATES.ON_BREAK;
    else if (action === ACTIONS.BREAK_END) state = CLOCK_STATES.CLOCKED_IN;
    // VOID events are skipped during replay — they're filtered out before calling this
  }
  return state;
}

export interface HistoricalFixResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate that inserting a fix event at the target time creates a valid state sequence.
 */
export function validateHistoricalFix(
  eventsData: SheetData,
  userId: string,
  targetDate: string,
  targetTime: string,
  proposedAction: FixProposedAction,
): HistoricalFixResult {
  // Collect all non-VOID events for this user on the target date, sorted by timestamp
  const targetIso = `${targetDate}T${targetTime}:00.000Z`;
  const targetMs = new Date(targetIso).getTime();

  const dayEvents: Array<{ timestamp: Date; action: EventAction }> = [];
  for (let i = 1; i < eventsData.length; i++) {
    if (eventsData[i][EVT.USER_ID] !== userId) continue;
    const action = eventsData[i][EVT.ACTION] as EventAction;
    if (action === ACTIONS.VOID) continue;
    const ts = new Date(eventsData[i][EVT.TIMESTAMP] as string);
    const eventDate = getDateOfTimestamp(ts);
    if (eventDate === targetDate) {
      dayEvents.push({ timestamp: ts, action });
    }
  }

  dayEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  if (proposedAction === 'CANCEL') {
    // For CANCEL: check that an event exists at that exact timestamp for the user
    const found = dayEvents.some(e => e.timestamp.getTime() === targetMs);
    if (!found) {
      return { valid: false, error: `No event found at ${targetTime} on ${targetDate} for this user.` };
    }
    return { valid: true };
  }

  const eventAction = FIX_ACTION_MAP[proposedAction];

  // Find where the proposed event would slot in chronologically
  let insertIndex = dayEvents.length;
  for (let i = 0; i < dayEvents.length; i++) {
    if (dayEvents[i].timestamp.getTime() > targetMs) {
      insertIndex = i;
      break;
    }
  }

  // Build the full sequence with the proposed action inserted
  const before = dayEvents.slice(0, insertIndex).map(e => e.action);
  const after = dayEvents.slice(insertIndex).map(e => e.action);

  // Validate: state before insertion must allow the proposed action
  const stateBefore = replayState(before);
  const allowedActions = VALID_TRANSITIONS[stateBefore];
  if (!allowedActions.has(eventAction)) {
    return {
      valid: false,
      error: `Invalid state transition: cannot ${proposedAction} when state is ${stateBefore} at ${targetTime}.`,
    };
  }

  // Validate: the sequence after insertion must also be valid
  const stateAfterInsert = replayState([...before, eventAction]);
  let currentState = stateAfterInsert;
  for (const action of after) {
    const allowed = VALID_TRANSITIONS[currentState];
    if (!allowed.has(action)) {
      return {
        valid: false,
        error: `Inserting ${proposedAction} at ${targetTime} would break the subsequent event sequence.`,
      };
    }
    if (action === ACTIONS.IN) currentState = CLOCK_STATES.CLOCKED_IN;
    else if (action === ACTIONS.OUT) currentState = CLOCK_STATES.IDLE;
    else if (action === ACTIONS.BREAK_START) currentState = CLOCK_STATES.ON_BREAK;
    else if (action === ACTIONS.BREAK_END) currentState = CLOCK_STATES.CLOCKED_IN;
  }

  return { valid: true };
}

export interface ApplyFixDeps {
  sheetsService: ISheetsService;
  slackService: ISlackService;
}

/**
 * Apply an approved fix: append event (or VOID), recalculate hours, update summary.
 */
export function applyApprovedFix(
  fixRequest: FixRequest,
  deps: ApplyFixDeps,
): void {
  const targetIso = `${fixRequest.target_date}T${fixRequest.target_time}:00.000Z`;

  // Find employee name for the event row
  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  let userName = fixRequest.user_id;
  for (let i = 1; i < employees.length; i++) {
    if (employees[i][EMP.USER_ID] === fixRequest.user_id) {
      userName = String(employees[i][EMP.NAME]);
      break;
    }
  }

  if (fixRequest.proposed_action === 'CANCEL') {
    // Append a VOID event at the target timestamp
    deps.sheetsService.appendRow(TABS.EVENTS, [
      targetIso,
      fixRequest.user_id,
      userName,
      ACTIONS.VOID,
      EVENT_SOURCES.MANUAL_FIX,
    ]);
  } else {
    const eventAction = FIX_ACTION_MAP[fixRequest.proposed_action];
    deps.sheetsService.appendRow(TABS.EVENTS, [
      targetIso,
      fixRequest.user_id,
      userName,
      eventAction,
      EVENT_SOURCES.MANUAL_FIX,
    ]);
  }

  // Update MonthlySummary if it exists for the affected month (recalculates hours internally)
  const yearMonth = fixRequest.target_date.slice(0, 7);
  updateMonthlySummaryRow(fixRequest.user_id, yearMonth, deps);

  // Post to #hr-alerts
  const actionLabel = fixRequest.proposed_action === 'CANCEL'
    ? 'VOID (cancelled event)'
    : fixRequest.proposed_action;
  deps.slackService.postToChannel(
    CHANNELS.HR_ALERTS,
    `Fix applied: ${userName} (${fixRequest.user_id}) — ${actionLabel} at ${fixRequest.target_time} on ${fixRequest.target_date}. Reason: ${fixRequest.reason}`,
  );
}
