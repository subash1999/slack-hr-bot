/**
 * Leave management handler — /request-leave, leave approval, /team-leave.
 */

import { TABS, EMP, LR, PA, CHANNELS, STATUS, LEAVE_TYPES, ID_PREFIX, ROLES } from '../config';
import { nextId as generateNextId } from '../utils/ids';
import { validateDateInput, validateDateRange } from '../utils/validate';
import { todayLocal, parseDate, formatDate, getWeekDates, getWeekStart, getDaysInMonth } from '../utils/dates';
import { ephemeralText, errorResponse, successResponse } from '../utils/format';
import type {
  CallerInfo,
  ISheetsService,
  ISlackService,
  SlackMessage,
  SheetData,
} from '../types';

export interface LeaveDeps {
  sheetsService: ISheetsService;
  slackService: ISlackService;
}

// ─── /request-leave ─────────────────────────────────────────────────────────

export function handleLeaveRequest(
  caller: CallerInfo,
  text: string,
  deps: LeaveDeps,
): SlackMessage {
  const args = text.trim().split(/\s+/).filter(Boolean);

  if (args.length === 0) {
    return errorResponse('Usage: /request-leave YYYY-MM-DD [YYYY-MM-DD]');
  }

  // Single date or range
  let dates: string[];
  if (args.length === 1) {
    const result = validateDateInput(args[0]);
    if (!result.valid) return errorResponse(result.error!);
    dates = [result.date!];
  } else {
    const result = validateDateRange(args[0], args[1]);
    if (!result.valid) return errorResponse(result.error!);
    dates = generateDateRange(result.startDate!, result.endDate!);
  }

  const leaveReqs = deps.sheetsService.getAll(TABS.LEAVE_REQUESTS);
  const baseId = generateNextId(ID_PREFIX.LEAVE_REQUEST, leaveReqs, LR.ID);
  const baseNum = parseInt(baseId.replace(ID_PREFIX.LEAVE_REQUEST, ''), 10);

  // Create one PENDING row per date
  for (let i = 0; i < dates.length; i++) {
    const row = [
      `${ID_PREFIX.LEAVE_REQUEST}${String(baseNum + i).padStart(4, '0')}`,
      caller.user_id,
      dates[i],
      '', // type — set by manager during approval
      STATUS.PENDING,
      new Date().toISOString(),
      '', // approved_by
      '', // approved_at
      '', // notes
    ];
    deps.sheetsService.appendRow(TABS.LEAVE_REQUESTS, row);
  }

  // Notify manager
  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  const managerSlackId = findManagerSlackId(caller.manager_id, employees);

  if (managerSlackId !== null) {
    const balanceText = caller.leave_balance > 0
      ? `Balance: ${caller.leave_balance} days`
      : 'Balance: 0 days';
    const dateRange = dates.length === 1 ? dates[0] : `${dates[0]} to ${dates[dates.length - 1]}`;

    deps.slackService.sendDM(
      managerSlackId,
      `Leave request from ${caller.name}\nDates: ${dateRange} (${dates.length} day${dates.length > 1 ? 's' : ''})\n${balanceText}`,
    );
  }

  // Post to #leave-requests
  deps.slackService.postToChannel(
    CHANNELS.LEAVE_REQUESTS,
    `${caller.name} requested leave: ${dates.length === 1 ? dates[0] : `${dates[0]} to ${dates[dates.length - 1]}`} (${STATUS.PENDING})`,
  );

  return successResponse(
    `Leave request submitted for ${dates.length} day${dates.length > 1 ? 's' : ''}: ${dates[0]}${dates.length > 1 ? ' to ' + dates[dates.length - 1] : ''}`,
  );
}

function generateDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const d = parseDate(start)!;
  const endDate = parseDate(end)!;
  while (d <= endDate) {
    dates.push(formatDate(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

function findManagerSlackId(managerId: string, employees: SheetData): string | null {
  for (let i = 1; i < employees.length; i++) {
    if (employees[i][EMP.USER_ID] === managerId) {
      return String(employees[i][EMP.SLACK_ID]);
    }
  }
  return null;
}

// ─── Leave Approval ─────────────────────────────────────────────────────────

export function handleLeaveApproval(
  managerId: string,
  requestId: string,
  action: 'PAID' | 'UNPAID' | 'SHIFT' | 'REJECT',
  deps: LeaveDeps,
): SlackMessage {
  const leaveReqs = deps.sheetsService.getAll(TABS.LEAVE_REQUESTS);
  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);

  // Find the request
  let reqRowIndex = -1;
  for (let i = 1; i < leaveReqs.length; i++) {
    if (String(leaveReqs[i][LR.ID]) === requestId) {
      reqRowIndex = i;
      break;
    }
  }

  if (reqRowIndex === -1) {
    return errorResponse('Leave request not found.');
  }

  const reqRow = leaveReqs[reqRowIndex];
  const userId = String(reqRow[LR.USER_ID]);

  const emp = findEmployeeRow(userId, employees);

  if (action === 'REJECT') {
    deps.sheetsService.updateCell(TABS.LEAVE_REQUESTS, reqRowIndex + 1, LR.STATUS + 1, STATUS.REJECTED);
    deps.sheetsService.updateCell(TABS.LEAVE_REQUESTS, reqRowIndex + 1, LR.APPROVED_BY + 1, managerId);
    deps.sheetsService.updateCell(TABS.LEAVE_REQUESTS, reqRowIndex + 1, LR.APPROVED_AT + 1, new Date().toISOString());

    notifyEmployee(emp?.row ?? null, `Your leave request for ${String(reqRow[LR.DATE])} was rejected.`, deps);
    return successResponse(`Leave request ${requestId} rejected.`);
  }

  // Check balance for PAID leave
  if (action === LEAVE_TYPES.PAID && emp) {
    const balance = Number(emp.row[EMP.LEAVE_BALANCE]);
    if (balance <= 0) {
      return errorResponse('Cannot approve paid leave: employee has no leave balance.');
    }
    deps.sheetsService.updateCell(TABS.EMPLOYEES, emp.index + 1, EMP.LEAVE_BALANCE + 1, balance - 1);
  }

  // Update leave request
  deps.sheetsService.updateCell(TABS.LEAVE_REQUESTS, reqRowIndex + 1, LR.TYPE + 1, action);
  deps.sheetsService.updateCell(TABS.LEAVE_REQUESTS, reqRowIndex + 1, LR.STATUS + 1, STATUS.APPROVED);
  deps.sheetsService.updateCell(TABS.LEAVE_REQUESTS, reqRowIndex + 1, LR.APPROVED_BY + 1, managerId);
  deps.sheetsService.updateCell(TABS.LEAVE_REQUESTS, reqRowIndex + 1, LR.APPROVED_AT + 1, new Date().toISOString());

  const typeLabels = { [LEAVE_TYPES.PAID]: 'Paid Leave', [LEAVE_TYPES.UNPAID]: 'Unpaid Leave', [LEAVE_TYPES.SHIFT]: 'Shift Permission' };
  notifyEmployee(emp?.row ?? null, `Your leave for ${String(reqRow[LR.DATE])} was approved as ${typeLabels[action]}.`, deps);

  return successResponse(`Leave request ${requestId} approved as ${typeLabels[action]}.`);
}

function findEmployeeRow(userId: string, employees: SheetData): { row: SheetData[number]; index: number } | null {
  for (let i = 1; i < employees.length; i++) {
    if (employees[i][EMP.USER_ID] === userId) return { row: employees[i], index: i };
  }
  return null;
}

function notifyEmployee(
  empRow: SheetData[number] | null,
  message: string,
  deps: LeaveDeps,
): void {
  if (empRow) {
    deps.slackService.sendDM(String(empRow[EMP.SLACK_ID]), message);
  }
}

// ─── /team-leave ────────────────────────────────────────────────────────────

export function handleTeamLeave(
  caller: CallerInfo,
  text: string,
  deps: LeaveDeps,
): SlackMessage {
  const args = text.trim().split(/\s+/).filter(Boolean);
  const today = todayLocal();

  const leaveReqs = deps.sheetsService.getAll(TABS.LEAVE_REQUESTS);
  const preApprovals = deps.sheetsService.getAll(TABS.PRE_APPROVALS);
  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  const showType = caller.role === ROLES.MANAGER || caller.role === ROLES.ADMIN;

  // Collect approved leave entries by date
  function getLeaveForDate(date: string): Array<{ name: string; type: string }> {
    const entries: Array<{ name: string; type: string }> = [];
    const seen = new Set<string>();

    // From LeaveRequests
    for (let i = 1; i < leaveReqs.length; i++) {
      if (
        String(leaveReqs[i][LR.STATUS]) === STATUS.APPROVED &&
        String(leaveReqs[i][LR.DATE]) === date
      ) {
        const uid = String(leaveReqs[i][LR.USER_ID]);
        if (seen.has(uid)) continue;
        seen.add(uid);
        const name = getEmployeeName(uid, employees);
        const type = showType ? String(leaveReqs[i][LR.TYPE]) : 'On Leave';
        entries.push({ name, type });
      }
    }

    // From PreApprovals
    if (preApprovals.length > 1) {
      for (let i = 1; i < preApprovals.length; i++) {
        const uid = String(preApprovals[i][PA.USER_ID]);
        if (seen.has(uid)) continue;
        if (String(preApprovals[i][PA.DATE]) === date) {
          seen.add(uid);
          const name = getEmployeeName(uid, employees);
          const type = showType ? String(preApprovals[i][PA.TYPE]) : 'On Leave';
          entries.push({ name, type });
        }
      }
    }

    return entries;
  }

  // /team-leave (today)
  if (args.length === 0) {
    const entries = getLeaveForDate(today);
    if (entries.length === 0) {
      return ephemeralText(`Team Leave \u2014 ${today}\n\nNo one is on leave today.`);
    }
    const lines = [`Team Leave \u2014 ${today}`, ''];
    for (const e of entries) {
      lines.push(`  ${e.name} \u2014 ${e.type}`);
    }
    lines.push('', `${entries.length} member${entries.length > 1 ? 's' : ''} on leave today.`);
    return ephemeralText(lines.join('\n'));
  }

  // /team-leave week
  if (args[0] === 'week') {
    const weekStart = getWeekStart(today)!;
    const dates = getWeekDates(today);
    const lines = [`Team Leave \u2014 Week of ${weekStart}`, ''];
    for (const date of dates) {
      const entries = getLeaveForDate(date);
      if (entries.length === 0) {
        lines.push(`  ${date}  \u2014  (none)`);
      } else {
        lines.push(`  ${date}  \u2014  ${entries.map((e) => e.name).join(', ')}`);
      }
    }
    return ephemeralText(lines.join('\n'));
  }

  // /team-leave YYYY-MM
  if (args[0] && /^\d{4}-\d{2}$/.test(args[0])) {
    const ym = args[0];
    const [year, month] = ym.split('-').map(Number);
    const days = getDaysInMonth(year, month);
    const allEntries: Array<{ date: string; name: string; type: string }> = [];

    for (let d = 1; d <= days; d++) {
      const date = `${ym}-${String(d).padStart(2, '0')}`;
      const entries = getLeaveForDate(date);
      for (const e of entries) {
        allEntries.push({ date, ...e });
      }
    }

    if (allEntries.length === 0) {
      return ephemeralText(`Team Leave \u2014 ${ym}\n\nNo leave scheduled.`);
    }

    const lines = [`Team Leave \u2014 ${ym}`, ''];
    for (const e of allEntries) {
      lines.push(`  ${e.date}  \u2014  ${e.name}${showType ? ` (${e.type})` : ''}`);
    }
    const uniqueMembers = new Set(allEntries.map((e) => e.name)).size;
    lines.push('', `Total: ${allEntries.length} leave days across ${uniqueMembers} member${uniqueMembers > 1 ? 's' : ''}`);
    return ephemeralText(lines.join('\n'));
  }

  return errorResponse('Usage: /team-leave, /team-leave week, /team-leave YYYY-MM');
}

function getEmployeeName(userId: string, employees: SheetData): string {
  for (let i = 1; i < employees.length; i++) {
    if (employees[i][EMP.USER_ID] === userId) return String(employees[i][EMP.NAME]);
  }
  return userId;
}
