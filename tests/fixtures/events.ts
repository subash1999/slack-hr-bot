/**
 * Test fixtures — sample Events data and helpers.
 */
import type { SheetData, EventAction } from '../../src/types';

export const EVENTS_HEADER = ['timestamp', 'user_id', 'user_name', 'action', 'source'];

export function makeEvent(
  isoTime: string,
  userId: string,
  name: string,
  action: EventAction,
): Array<string> {
  return [isoTime, userId, name, action, 'slack_command'];
}

export function buildEventsData(...rows: Array<string>[]): SheetData {
  return [EVENTS_HEADER, ...rows];
}

export const EMPTY_EVENTS: SheetData = [EVENTS_HEADER];
