/**
 * Block Kit message formatters.
 */

import { ACTIONS } from '../config';
import type { SlackMessage, EventAction } from '../types';

export function ephemeralText(text: string): SlackMessage {
  return { response_type: 'ephemeral', text };
}

export function inChannelText(text: string): SlackMessage {
  return { response_type: 'in_channel', text };
}

export function errorResponse(message: string): SlackMessage {
  return ephemeralText(`\u274C ${message}`);
}

export function successResponse(message: string): SlackMessage {
  return ephemeralText(`\u2705 ${message}`);
}

export function publicSuccessResponse(message: string): SlackMessage {
  return inChannelText(`\u2705 ${message}`);
}

const ACTION_TEXT: Record<EventAction, string> = {
  [ACTIONS.IN]: 'clocked in',
  [ACTIONS.OUT]: 'clocked out',
  [ACTIONS.BREAK_START]: 'started a break',
  [ACTIONS.BREAK_END]: 'ended break',
  [ACTIONS.VOID]: 'voided event',
};

export function attendancePublicMessage(
  name: string,
  action: EventAction,
  time: string,
): SlackMessage {
  return inChannelText(`${name} ${ACTION_TEXT[action]} at ${time}`);
}

export function formatHoursMinutes(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function warningText(message: string): string {
  return `\u26A0\uFE0F ${message}`;
}

/**
 * Slack date formatting — renders in each viewer's local timezone.
 * Format: <!date^UNIX_TIMESTAMP^{format}|fallback>
 * @see https://api.slack.com/reference/surfaces/formatting#date-formatting
 */
export function slackDate(date: Date, format = '{date_short} at {time}'): string {
  const unix = Math.floor(date.getTime() / 1000);
  const fallback = date.toISOString();
  return `<!date^${unix}^${format}|${fallback}>`;
}

/**
 * Slack date with time only.
 */
export function slackTime(date: Date): string {
  return slackDate(date, '{time}');
}
