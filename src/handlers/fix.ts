/**
 * Fix command handler — /fix, fix approval/rejection.
 */

import {
  TABS, EMP, FIX_REQ, CHANNELS,
  STATUS, ID_PREFIX, ACTION_IDS,
} from '../config';
import { nextId } from '../utils/ids';
import { todayLocal, isValidDateFormat } from '../utils/dates';
import { errorResponse, successResponse } from '../utils/format';
import { validateHistoricalFix, applyApprovedFix } from '../core/fix';
import type {
  CallerInfo,
  FixProposedAction,
  FixRequest,
  ISheetsService,
  ISlackService,
  SlackBlock,
  SlackMessage,
  SheetData,
} from '../types';

export interface FixDeps {
  sheetsService: ISheetsService;
  slackService: ISlackService;
}

const VALID_ACTIONS: ReadonlySet<string> = new Set([
  'ADD_IN', 'ADD_OUT', 'ADD_BREAK_START', 'ADD_BREAK_END', 'CANCEL',
]);

const TIME_PATTERN = /^\d{2}:\d{2}$/;

// ─── /fix command ──────────────────────────────────────────────────────────

export function handleFixSubmit(
  caller: CallerInfo,
  text: string,
  deps: FixDeps,
): SlackMessage {
  const args = text.trim().split(/\s+/).filter(Boolean);

  if (args.length < 3) {
    return errorResponse('Usage: /fix YYYY-MM-DD HH:MM ACTION [reason]');
  }

  const [dateStr, timeStr, actionStr, ...reasonParts] = args;
  const reason = reasonParts.join(' ') || '';

  // Validate date format
  if (!isValidDateFormat(dateStr)) {
    return errorResponse('Invalid date format. Use YYYY-MM-DD.');
  }

  // Validate time format
  if (!TIME_PATTERN.test(timeStr)) {
    return errorResponse('Invalid time format. Use HH:MM.');
  }

  // Validate action
  const upperAction = actionStr.toUpperCase();
  if (!VALID_ACTIONS.has(upperAction)) {
    return errorResponse(
      `Invalid action: ${actionStr}. Valid actions: ADD_IN, ADD_OUT, ADD_BREAK_START, ADD_BREAK_END, CANCEL`,
    );
  }
  const proposedAction = upperAction as FixProposedAction;

  // Validate date is in the past (not today or future)
  const today = todayLocal();
  if (dateStr >= today) {
    return errorResponse('Fix requests are only allowed for past dates (not today or future).');
  }

  // Validate the proposed action creates a valid state transition
  const events = deps.sheetsService.getAll(TABS.EVENTS);
  const validation = validateHistoricalFix(events, caller.user_id, dateStr, timeStr, proposedAction);
  if (!validation.valid) {
    return errorResponse(validation.error!);
  }

  // Create PENDING row in FixRequests tab
  const fixRequests = deps.sheetsService.getAll(TABS.FIX_REQUESTS);
  const fixId = nextId(ID_PREFIX.FIX_REQUEST, fixRequests, FIX_REQ.ID);

  const now = new Date().toISOString();
  deps.sheetsService.appendRow(TABS.FIX_REQUESTS, [
    fixId,
    caller.user_id,
    dateStr,
    timeStr,
    proposedAction,
    reason,
    STATUS.PENDING,
    now,
    '', // reviewed_by
    '', // reviewed_at
    '', // response_url — will be updated after manager DM
  ]);

  // Find manager Slack ID to send DM
  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  const managerSlackId = findManagerSlackId(caller.manager_id, employees);

  if (managerSlackId !== null) {
    const blocks = buildFixApprovalBlocks(fixId, caller.name, dateStr, timeStr, proposedAction, reason);
    deps.slackService.sendDM(
      managerSlackId,
      `Fix request from ${caller.name}: ${proposedAction} at ${timeStr} on ${dateStr}`,
      blocks,
    );
  }

  // Post to #hr-alerts
  deps.slackService.postToChannel(
    CHANNELS.HR_ALERTS,
    `Fix request ${fixId}: ${caller.name} requests ${proposedAction} at ${timeStr} on ${dateStr}. Status: ${STATUS.PENDING}`,
  );

  return successResponse(
    `Fix request ${fixId} submitted: ${proposedAction} at ${timeStr} on ${dateStr}. Your manager has been notified.`,
  );
}

// ─── Fix Approval/Rejection ────────────────────────────────────────────────

export function handleFixApproval(
  reviewerUserId: string,
  fixId: string,
  approved: boolean,
  deps: FixDeps,
): SlackMessage {
  const fixRequests = deps.sheetsService.getAll(TABS.FIX_REQUESTS);

  // Find the fix request
  let reqRowIndex = -1;
  for (let i = 1; i < fixRequests.length; i++) {
    if (String(fixRequests[i][FIX_REQ.ID]) === fixId) {
      reqRowIndex = i;
      break;
    }
  }

  if (reqRowIndex === -1) {
    return errorResponse(`Fix request ${fixId} not found.`);
  }

  const reqRow = fixRequests[reqRowIndex];
  const currentStatus = String(reqRow[FIX_REQ.STATUS]);

  if (currentStatus !== STATUS.PENDING) {
    return errorResponse(`Fix request ${fixId} is already ${currentStatus}.`);
  }

  const now = new Date().toISOString();
  const newStatus = approved ? STATUS.APPROVED : STATUS.REJECTED;

  // Update FixRequests row
  deps.sheetsService.updateCell(TABS.FIX_REQUESTS, reqRowIndex + 1, FIX_REQ.STATUS + 1, newStatus);
  deps.sheetsService.updateCell(TABS.FIX_REQUESTS, reqRowIndex + 1, FIX_REQ.REVIEWED_BY + 1, reviewerUserId);
  deps.sheetsService.updateCell(TABS.FIX_REQUESTS, reqRowIndex + 1, FIX_REQ.REVIEWED_AT + 1, now);

  const fixRequest: FixRequest = {
    id: String(reqRow[FIX_REQ.ID]),
    user_id: String(reqRow[FIX_REQ.USER_ID]),
    target_date: String(reqRow[FIX_REQ.TARGET_DATE]),
    target_time: String(reqRow[FIX_REQ.TARGET_TIME]),
    proposed_action: String(reqRow[FIX_REQ.PROPOSED_ACTION]) as FixProposedAction,
    reason: String(reqRow[FIX_REQ.REASON]),
    status: newStatus as FixRequest['status'],
    requested_at: String(reqRow[FIX_REQ.REQUESTED_AT]),
    reviewed_by: reviewerUserId,
    reviewed_at: now,
    response_url: String(reqRow[FIX_REQ.RESPONSE_URL]),
  };

  if (approved) {
    // Apply the fix
    applyApprovedFix(fixRequest, deps);
  }

  // Notify employee
  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  const empSlackId = findEmployeeSlackId(fixRequest.user_id, employees);
  if (empSlackId !== null) {
    const statusLabel = approved ? 'approved' : 'rejected';
    deps.slackService.sendDM(
      empSlackId,
      `Your fix request ${fixId} (${fixRequest.proposed_action} at ${fixRequest.target_time} on ${fixRequest.target_date}) has been ${statusLabel}.`,
    );
  }

  const actionLabel = approved ? 'approved' : 'rejected';
  return successResponse(`Fix request ${fixId} ${actionLabel}.`);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function findManagerSlackId(managerId: string, employees: SheetData): string | null {
  for (let i = 1; i < employees.length; i++) {
    if (employees[i][EMP.USER_ID] === managerId) {
      return String(employees[i][EMP.SLACK_ID]);
    }
  }
  return null;
}

function findEmployeeSlackId(userId: string, employees: SheetData): string | null {
  for (let i = 1; i < employees.length; i++) {
    if (employees[i][EMP.USER_ID] === userId) {
      return String(employees[i][EMP.SLACK_ID]);
    }
  }
  return null;
}

function buildFixApprovalBlocks(
  fixId: string,
  employeeName: string,
  date: string,
  time: string,
  action: FixProposedAction,
  reason: string,
): SlackBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Fix Request ${fixId}*\nEmployee: ${employeeName}\nDate: ${date}\nTime: ${time}\nAction: ${action}\nReason: ${reason || '(none)'}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Approve' },
          style: 'primary',
          action_id: `${ACTION_IDS.FIX_APPROVE}${fixId}`,
          value: fixId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Reject' },
          style: 'danger',
          action_id: `${ACTION_IDS.FIX_REJECT}${fixId}`,
          value: fixId,
        },
      ],
    },
  ];
}
