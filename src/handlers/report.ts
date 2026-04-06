/**
 * Daily standup report handler — /report (modal + inline + view).
 */

import { TABS, DR, EMP, ROLES } from '../config';
import { todayLocal, getWeekDates, getWeekStart } from '../utils/dates';
import { ephemeralText, errorResponse, successResponse } from '../utils/format';
import { resolveEmployeeRef } from '../utils/validate';
import type { CallerInfo, ISheetsService, ISlackService, SlackMessage } from '../types';

export interface ReportDeps {
  sheetsService: ISheetsService;
  slackService: ISlackService;
}

// ─── /report (submit or view) ───────────────────────────────────────────────

export function handleReport(
  caller: CallerInfo,
  text: string,
  deps: ReportDeps,
  triggerId?: string,
): SlackMessage {
  const args = text.trim();

  // No args → open modal or show today's report
  if (!args) {
    if (triggerId !== undefined && triggerId !== '') {
      openReportModal(deps, triggerId);
      return ephemeralText('Opening report form...');
    }
    return viewOwnReport(caller, todayLocal(), deps);
  }

  // Inline submission: yesterday: ... | today: ... | blockers: ...
  if (args.includes('|') && args.includes(':')) {
    return submitInlineReport(caller, args, deps);
  }

  // /report week → own week summary
  if (args === 'week') {
    return viewOwnWeekReports(caller, deps);
  }

  // /report YYYY-MM-DD → own report for that date
  if (/^\d{4}-\d{2}-\d{2}$/.test(args)) {
    return viewOwnReport(caller, args, deps);
  }

  // /report @employee or /report @employee YYYY-MM-DD → manager view
  const parts = args.split(/\s+/);
  const empRef = parts[0];
  const date = parts[1] || todayLocal();

  return viewEmployeeReport(caller, empRef, date, deps);
}

// ─── Modal ──────────────────────────────────────────────────────────────────

function openReportModal(deps: ReportDeps, triggerId: string): void {
  deps.slackService.openModal(triggerId, {
    type: 'modal',
    callback_id: 'report_submit',
    title: { type: 'plain_text', text: 'Daily Report' },
    submit: { type: 'plain_text', text: 'Submit' },
    blocks: [
      {
        type: 'input', block_id: 'yesterday_block',
        label: { type: 'plain_text', text: 'What did you do yesterday?' },
        element: { type: 'plain_text_input', action_id: 'yesterday', multiline: true },
      },
      {
        type: 'input', block_id: 'today_block',
        label: { type: 'plain_text', text: 'What will you do today?' },
        element: { type: 'plain_text_input', action_id: 'today', multiline: true },
      },
      {
        type: 'input', block_id: 'blockers_block',
        label: { type: 'plain_text', text: 'Any blockers?' },
        element: { type: 'plain_text_input', action_id: 'blockers', multiline: true },
        optional: true,
      },
    ],
  });
}

// ─── Modal Submission ───────────────────────────────────────────────────────

export function handleReportSubmission(
  caller: CallerInfo,
  yesterday: string,
  today: string,
  blockers: string,
  deps: ReportDeps,
): SlackMessage {
  const date = todayLocal();
  const row = [
    date,
    caller.user_id,
    caller.name,
    yesterday,
    today,
    blockers || '',
    new Date().toISOString(),
  ];
  deps.sheetsService.appendRow(TABS.DAILY_REPORTS, row);
  return successResponse(`Report submitted for ${date}.`);
}

// ─── Inline Submission ──────────────────────────────────────────────────────

function submitInlineReport(
  caller: CallerInfo,
  text: string,
  deps: ReportDeps,
): SlackMessage {
  const sections = text.split('|').map((s) => s.trim());
  let yesterday = '';
  let today = '';
  let blockers = '';

  for (const section of sections) {
    const colonIdx = section.indexOf(':');
    if (colonIdx === -1) continue;
    const key = section.slice(0, colonIdx).trim().toLowerCase();
    const value = section.slice(colonIdx + 1).trim();
    if (key === 'yesterday') yesterday = value;
    else if (key === 'today') today = value;
    else if (key === 'blockers') blockers = value;
  }

  if (!yesterday && !today) {
    return errorResponse('Provide at least yesterday or today section. Format: yesterday: ... | today: ... | blockers: ...');
  }

  return handleReportSubmission(caller, yesterday, today, blockers, deps);
}

// ─── View Own Report ────────────────────────────────────────────────────────

function viewOwnReport(
  caller: CallerInfo,
  date: string,
  deps: ReportDeps,
): SlackMessage {
  const reports = deps.sheetsService.getAll(TABS.DAILY_REPORTS);
  for (let i = reports.length - 1; i >= 1; i--) {
    if (reports[i][DR.USER_ID] === caller.user_id && String(reports[i][DR.DATE]) === date) {
      return ephemeralText(formatReportDisplay(date, reports[i]));
    }
  }
  return ephemeralText(`No report found for ${date}.`);
}

function viewOwnWeekReports(
  caller: CallerInfo,
  deps: ReportDeps,
): SlackMessage {
  const today = todayLocal();
  const weekStart = getWeekStart(today)!;
  const dates = getWeekDates(today);
  const reports = deps.sheetsService.getAll(TABS.DAILY_REPORTS);

  const lines = [`Reports — Week of ${weekStart}`, ''];
  for (const date of dates) {
    const report = findReport(reports, caller.user_id, date);
    if (report) {
      lines.push(`${date}: Submitted`);
    } else {
      lines.push(`${date}: (missing)`);
    }
  }
  return ephemeralText(lines.join('\n'));
}

// ─── View Employee Report (Manager) ─────────────────────────────────────────

function viewEmployeeReport(
  caller: CallerInfo,
  empRef: string,
  date: string,
  deps: ReportDeps,
): SlackMessage {
  if (caller.role === ROLES.EMPLOYEE) {
    return errorResponse("You don't have permission to view this employee's reports.");
  }

  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  const resolved = resolveEmployeeRef(empRef, employees);
  if (!resolved.found) return errorResponse(resolved.error!);

  const targetUserId = String(resolved.row![EMP.USER_ID]);

  // Manager can only view direct reports (unless admin)
  if (caller.role === ROLES.MANAGER) {
    if (resolved.row![EMP.MANAGER_ID] !== caller.user_id) {
      return errorResponse("You don't have permission to view this employee's reports.");
    }
  }

  const reports = deps.sheetsService.getAll(TABS.DAILY_REPORTS);
  const report = findReport(reports, targetUserId, date);

  if (!report) {
    const empName = String(resolved.row![EMP.NAME]);
    return ephemeralText(`No report from ${empName} for ${date}.`);
  }

  return ephemeralText(formatReportDisplay(date, report));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function findReport(
  reports: import('../types').SheetData,
  userId: string,
  date: string,
): import('../types').SheetRow | null {
  for (let i = reports.length - 1; i >= 1; i--) {
    if (reports[i][DR.USER_ID] === userId && String(reports[i][DR.DATE]) === date) {
      return reports[i];
    }
  }
  return null;
}

function formatReportDisplay(date: string, row: import('../types').SheetRow): string {
  return [
    `Report — ${date} (${String(row[DR.USER_NAME])})`,
    '',
    `Yesterday: ${String(row[DR.YESTERDAY] !== undefined && row[DR.YESTERDAY] !== null && row[DR.YESTERDAY] !== '' ? row[DR.YESTERDAY] : '(empty)')}`,
    `Today: ${String(row[DR.TODAY] !== undefined && row[DR.TODAY] !== null && row[DR.TODAY] !== '' ? row[DR.TODAY] : '(empty)')}`,
    `Blockers: ${String(row[DR.BLOCKERS] !== undefined && row[DR.BLOCKERS] !== null && row[DR.BLOCKERS] !== '' ? row[DR.BLOCKERS] : '(none)')}`,
  ].join('\n');
}
