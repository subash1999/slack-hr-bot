/**
 * Hours self-service handler — /hours, /balance, /my-bank, /payroll, /hr-help.
 */

import { TABS, EMP, BANK, LR, PERIOD_TYPES, ROLES } from '../config';
import { getDailyHours } from '../core/attendance';
import { getWeeklyHours, getMonthlyHours, getHourRequirements, getEffectiveSalary, calculatePayroll } from '../core/calculator';
import { todayLocal, getWeekStart, formatDate, parseDate, isValidYearMonth, addDays } from '../utils/dates';
import { formatHoursMinutes, ephemeralText, errorResponse, warningText } from '../utils/format';
import { validateDateInput } from '../utils/validate';
import type { CallerInfo, ISheetsService, SlackMessage } from '../types';

export interface HoursDeps {
  sheetsService: ISheetsService;
}

// ─── /hours ─────────────────────────────────────────────────────────────────

export function handleViewHours(
  caller: CallerInfo,
  text: string,
  deps: HoursDeps,
): SlackMessage {
  const args = text.trim().split(/\s+/).filter(Boolean);
  const events = deps.sheetsService.getAll(TABS.EVENTS);
  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  const positions = deps.sheetsService.getAll(TABS.POSITIONS);
  const policies = deps.sheetsService.getAll(TABS.POLICIES);
  const overrides = deps.sheetsService.getAll(TABS.OVERRIDES);

  const today = todayLocal();
  const yearMonth = today.slice(0, 7);

  // /hours (default — snapshot)
  if (args.length === 0) {
    const reqs = getHourRequirements(caller.user_id, employees, positions, policies, overrides, PERIOD_TYPES.MONTHLY, yearMonth);
    const daily = getDailyHours(events, caller.user_id, today);
    const weekStart = getWeekStart(today)!;
    const weekly = getWeeklyHours(events, caller.user_id, weekStart);
    const leaveReqs = deps.sheetsService.getAll(TABS.LEAVE_REQUESTS);
    const preApprovals = deps.sheetsService.getAll(TABS.PRE_APPROVALS);
    const monthly = getMonthlyHours(events, leaveReqs, preApprovals, caller.user_id, yearMonth);

    const lines: string[] = [
      `Hours — ${today}`,
      `Today:      ${formatHoursMinutes(daily.netHours)} / ${reqs.daily}h min${daily.netHours < reqs.daily ? '  ' + warningText(`-${formatHoursMinutes(reqs.daily - daily.netHours)}`) : ''}`,
      `This Week:  ${formatHoursMinutes(weekly.totalHours)} / ${reqs.weekly}h min${weekly.totalHours < reqs.weekly ? '  ' + warningText(`-${formatHoursMinutes(reqs.weekly - weekly.totalHours)}`) : ''}`,
      `This Month: ${formatHoursMinutes(monthly.totalHours)} / ${reqs.monthly}h min${monthly.totalHours < reqs.monthly ? '  ' + warningText(`-${formatHoursMinutes(reqs.monthly - monthly.totalHours)}`) : ''}`,
    ];
    return ephemeralText(lines.join('\n'));
  }

  // /hours YYYY-MM-DD (specific date)
  const dateResult = validateDateInput(args[0]);
  if (dateResult.valid && args.length === 1 && !['week', 'month'].includes(args[0])) {
    const daily = getDailyHours(events, caller.user_id, dateResult.date!);
    const lines = [
      `Hours — ${dateResult.date}`,
      `Sessions: ${daily.sessions.length}`,
      `Worked: ${formatHoursMinutes(daily.totalWorked)}`,
      `Breaks: ${formatHoursMinutes(daily.totalBreak)}`,
      `Net: ${formatHoursMinutes(daily.netHours)}`,
    ];
    return ephemeralText(lines.join('\n'));
  }

  // /hours week
  if (args[0] === 'week') {
    const weekStart = getWeekStart(today)!;
    const weekly = getWeeklyHours(events, caller.user_id, weekStart);
    const reqs = getHourRequirements(caller.user_id, employees, positions, policies, overrides, PERIOD_TYPES.WEEKLY, weekStart);
    const lines = [`Hours — Week of ${weekly.weekStart}`];
    for (const [date, hours] of Object.entries(weekly.dailyBreakdown)) {
      const indicator = hours < reqs.daily ? warningText('') : '';
      lines.push(`  ${date}: ${formatHoursMinutes(hours)}${indicator}`);
    }
    lines.push(`Total: ${formatHoursMinutes(weekly.totalHours)} / ${reqs.weekly}h min`);
    return ephemeralText(lines.join('\n'));
  }

  // /hours month [YYYY-MM]
  if (args[0] === 'month') {
    const ym = args[1] && isValidYearMonth(args[1]) ? args[1] : yearMonth;
    const leaveReqs = deps.sheetsService.getAll(TABS.LEAVE_REQUESTS);
    const preApprovals = deps.sheetsService.getAll(TABS.PRE_APPROVALS);
    const monthly = getMonthlyHours(events, leaveReqs, preApprovals, caller.user_id, ym);
    const reqs = getHourRequirements(caller.user_id, employees, positions, policies, overrides, PERIOD_TYPES.MONTHLY, ym);

    const lines = [
      `Hours — ${ym}`,
      `Worked: ${formatHoursMinutes(monthly.workedHours)}`,
      `Paid Leave: ${formatHoursMinutes(monthly.paidLeaveHours)}`,
      `Credited: ${formatHoursMinutes(monthly.creditedAbsenceHours)}`,
      `Total: ${formatHoursMinutes(monthly.totalHours)} / ${reqs.monthly}h required`,
    ];
    if (monthly.totalHours < reqs.monthly) {
      lines.push(warningText(`Deficit: ${formatHoursMinutes(reqs.monthly - monthly.totalHours)}`));
    }
    return ephemeralText(lines.join('\n'));
  }

  return errorResponse('Usage: /hours, /hours YYYY-MM-DD, /hours week, /hours month [YYYY-MM]');
}

// ─── /balance ───────────────────────────────────────────────────────────────

export function handleBalance(
  caller: CallerInfo,
  deps: HoursDeps,
): SlackMessage {
  const leaveReqs = deps.sheetsService.getAll(TABS.LEAVE_REQUESTS);

  // Recent leave history (last 5)
  const recentLeave: string[] = [];
  for (let i = leaveReqs.length - 1; i >= 1 && recentLeave.length < 5; i--) {
    if (leaveReqs[i][LR.USER_ID] === caller.user_id) {
      recentLeave.push(`${String(leaveReqs[i][LR.DATE])} — ${String(leaveReqs[i][LR.TYPE])} (${String(leaveReqs[i][LR.STATUS])})`);
    }
  }

  // Fetch employee row once for accrual config
  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  const empRow = employees.find((_r, i) => i > 0 && _r[EMP.USER_ID] === caller.user_id);
  const accrualStartMonth = Number(empRow?.[EMP.LEAVE_ACCRUAL_START_MONTH] ?? 3);
  const maxCap = empRow?.[EMP.MAX_LEAVE_CAP] ?? 20;

  // Calculate next accrual date
  const joinDate = parseDate(caller.join_date);
  let nextAccrual = 'N/A';
  if (joinDate) {
    const accrualStart = new Date(joinDate);
    accrualStart.setUTCMonth(accrualStart.getUTCMonth() + accrualStartMonth);
    const now = new Date();
    if (now >= accrualStart) {
      const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      nextAccrual = formatDate(next);
    } else {
      nextAccrual = formatDate(accrualStart);
    }
  }

  const lines = [
    `Leave Balance`,
    `Remaining: ${caller.leave_balance} days`,
    `Max Cap: ${String(maxCap)} days`,
    `Next Accrual: ${nextAccrual}`,
    '',
    'Recent Leave:',
    ...recentLeave.map((l) => `  ${l}`),
    recentLeave.length === 0 ? '  (none)' : '',
  ];
  return ephemeralText(lines.join('\n'));
}

// ─── /my-bank ───────────────────────────────────────────────────────────────

export function handleMyBank(
  caller: CallerInfo,
  deps: HoursDeps,
): SlackMessage {
  const bankData = deps.sheetsService.getAll(TABS.HOURS_BANK);
  const today = todayLocal();
  const entries: string[] = [];

  for (let i = 1; i < bankData.length; i++) {
    if (bankData[i][BANK.USER_ID] !== caller.user_id) continue;
    const remaining = Number(bankData[i][BANK.REMAINING_HOURS]);
    if (remaining <= 0) continue;

    const expiresAt = String(bankData[i][BANK.EXPIRES_AT]);
    const period = String(bankData[i][BANK.PERIOD_VALUE]);
    const maxLeave = bankData[i][BANK.MAX_LEAVE_DAYS];
    const isExpiring = expiresAt <= addDays(today, 30);

    entries.push(
      `${period}: ${formatHoursMinutes(remaining)} remaining` +
      ` (max ${String(maxLeave)} leave days, expires ${expiresAt})` +
      (isExpiring ? ' ' + warningText('Expiring soon!') : ''),
    );
  }

  if (entries.length === 0) {
    return ephemeralText('Surplus Hours Bank\n\n(no banked hours)');
  }

  return ephemeralText(['Surplus Hours Bank', '', ...entries].join('\n'));
}

// ─── /payroll ───────────────────────────────────────────────────────────────

export function handlePayroll(
  caller: CallerInfo,
  text: string,
  deps: HoursDeps,
): SlackMessage {
  const today = todayLocal();
  const currentDay = parseInt(today.split('-')[2]);
  const currentYM = today.slice(0, 7);

  // Default: before 15th = last month, after 15th = current month
  let yearMonth: string;
  const args = text.trim();
  if (args && isValidYearMonth(args)) {
    yearMonth = args;
  } else if (currentDay < 15) {
    const d = parseDate(today)!;
    d.setUTCMonth(d.getUTCMonth() - 1);
    yearMonth = formatDate(d).slice(0, 7);
  } else {
    yearMonth = currentYM;
  }

  const events = deps.sheetsService.getAll(TABS.EVENTS);
  const leaveReqs = deps.sheetsService.getAll(TABS.LEAVE_REQUESTS);
  const preApprovals = deps.sheetsService.getAll(TABS.PRE_APPROVALS);
  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  const positions = deps.sheetsService.getAll(TABS.POSITIONS);
  const policies = deps.sheetsService.getAll(TABS.POLICIES);
  const overrides = deps.sheetsService.getAll(TABS.OVERRIDES);
  const salaryHistory = deps.sheetsService.getAll(TABS.SALARY_HISTORY);

  const monthly = getMonthlyHours(events, leaveReqs, preApprovals, caller.user_id, yearMonth);
  const reqs = getHourRequirements(caller.user_id, employees, positions, policies, overrides, PERIOD_TYPES.MONTHLY, yearMonth);
  const salary = getEffectiveSalary(caller.user_id, yearMonth, salaryHistory);
  const payroll = calculatePayroll(salary, reqs.monthly, monthly.totalHours, 0);

  const lines = [
    `Payroll — ${yearMonth}`,
    `Salary: NPR ${salary.toLocaleString()}`,
    `Required: ${reqs.monthly}h`,
    `Worked: ${formatHoursMinutes(monthly.workedHours)}`,
    `Leave Credit: ${formatHoursMinutes(monthly.paidLeaveHours + monthly.creditedAbsenceHours)}`,
    `Total Hours: ${formatHoursMinutes(monthly.totalHours)}`,
    `Deficit: ${formatHoursMinutes(payroll.deficit)}`,
    `Hourly Rate: NPR ${Math.round(payroll.hourlyRate).toLocaleString()}`,
    `Deduction: NPR ${payroll.deduction.toLocaleString()}`,
    `Final Salary: NPR ${payroll.finalSalary.toLocaleString()}`,
    '',
    'Payment: Within 15 days of following month via Wise/bank transfer',
  ];
  return ephemeralText(lines.join('\n'));
}

// ─── /hr-help (role-aware) ──────────────────────────────────────────────────

const EMPLOYEE_COMMANDS = [
  'Attendance & Leave:',
  '  /in, /out, /break, /back — Clock in/out, breaks',
  '  /request-leave YYYY-MM-DD — Request leave',
  '',
  'Your Data:',
  '  /hours — View hours (today/week/month)',
  '  /balance — Leave balance',
  '  /my-bank — Surplus hours bank',
  '  /payroll — View payroll',
  '  /clock-status — Clock state',
  '  /report — Daily standup report',
  '',
  'Team:',
  '  /team-leave — Who is on leave',
  '  /hr-help — This help',
];

const MANAGER_COMMANDS = [
  '',
  'Manager Commands:',
  '  /team-hours — Team hours summary',
  '  /team-flags — Pending shortfall flags',
  '  /team-bank — Team bank balances',
  '  /team-reports — Team daily reports',
  '  /team-payroll — Team payroll',
  '  /salary-history @emp — View/update salary',
  '  /report @emp — View employee report',
  '  /approve-surplus — Approve surplus banking',
  '  /approve-absence — Pre-approve absence',
  '  /adjust-quota — Redistribute hours',
];

const ADMIN_COMMANDS = [
  '',
  'Admin Commands:',
  '  /onboard — Add new employee',
  '  /offboard @emp — Deactivate employee',
  '  /edit-employee @emp — Edit employee details',
];

interface CommandDetail {
  usage: string;
  description: string;
  params?: string;
  examples?: string[];
  minRole: 'employee' | 'manager' | 'admin';
}

const COMMAND_DETAILS: Record<string, CommandDetail> = {
  '/in':              { usage: '/in', description: 'Clock in for work. Starts a new session.', minRole: 'employee' },
  '/out':             { usage: '/out', description: 'Clock out. Ends current session and shows hours worked.', minRole: 'employee' },
  '/break':           { usage: '/break', description: 'Start a break. Must be clocked in.', minRole: 'employee' },
  '/back':            { usage: '/back', description: 'End break. Resume working.', minRole: 'employee' },
  '/clock-status':    { usage: '/clock-status', description: 'Check if you are clocked in, on break, or idle.', minRole: 'employee' },
  '/hours':           { usage: '/hours [date|week|month YYYY-MM]', description: 'View hours summary.', params: 'No args = today snapshot. YYYY-MM-DD = specific date. week = this week. month YYYY-MM = monthly report.', examples: ['/hours', '/hours 2026-03-15', '/hours week', '/hours month 2026-03'], minRole: 'employee' },
  '/request-leave':   { usage: '/request-leave YYYY-MM-DD [YYYY-MM-DD]', description: 'Request leave for a single date or date range.', params: 'First date = start. Optional second date = end of range.', examples: ['/request-leave 2026-04-02', '/request-leave 2026-04-02 2026-04-05'], minRole: 'employee' },
  '/balance':         { usage: '/balance', description: 'View leave balance, accrual info, and recent leave history.', minRole: 'employee' },
  '/my-bank':         { usage: '/my-bank', description: 'View your banked surplus hours with expiry dates.', minRole: 'employee' },
  '/payroll':         { usage: '/payroll [YYYY-MM]', description: 'View payroll calculation.', params: 'No args = current/last month (before/after 15th). YYYY-MM = specific month.', examples: ['/payroll', '/payroll 2026-02'], minRole: 'employee' },
  '/report':          { usage: '/report [YYYY-MM-DD|week|@employee]', description: 'Submit or view daily standup report.', params: 'No args = open submission modal. YYYY-MM-DD = view past report. week = week summary. @employee = manager views report.', examples: ['/report', '/report 2026-03-15', '/report week', '/report @alex'], minRole: 'employee' },
  '/team-leave':      { usage: '/team-leave [week|YYYY-MM]', description: 'View who is on leave.', params: 'No args = today. week = this week. YYYY-MM = monthly calendar.', examples: ['/team-leave', '/team-leave week', '/team-leave 2026-04'], minRole: 'employee' },
  '/fix':             { usage: '/fix YYYY-MM-DD HH:MM ACTION [reason]', description: 'Submit a correction for past attendance.', params: 'ACTION: ADD_IN, ADD_OUT, ADD_BREAK_START, ADD_BREAK_END, CANCEL. Requires manager approval.', examples: ['/fix 2026-03-27 18:00 ADD_OUT Forgot to clock out'], minRole: 'employee' },
  '/hr-help':         { usage: '/hr-help [command]', description: 'Show available commands or detailed help for a specific command.', examples: ['/hr-help', '/hr-help /hours', '/hr-help /payroll'], minRole: 'employee' },
  '/team-hours':      { usage: '/team-hours', description: 'View hours summary for all direct reports this month.', minRole: 'manager' },
  '/team-flags':      { usage: '/team-flags', description: 'View pending shortfall flags for direct reports with resolution buttons.', minRole: 'manager' },
  '/team-bank':       { usage: '/team-bank', description: 'View banked surplus hours for all direct reports.', minRole: 'manager' },
  '/team-reports':    { usage: '/team-reports [week|YYYY-MM]', description: 'View daily report submission status for team.', examples: ['/team-reports', '/team-reports week', '/team-reports 2026-03'], minRole: 'manager' },
  '/team-payroll':    { usage: '/team-payroll [YYYY-MM]', description: 'View payroll summary for all direct reports.', examples: ['/team-payroll', '/team-payroll 2026-02'], minRole: 'manager' },
  '/salary-history':  { usage: '/salary-history @employee [set amount]', description: 'View salary history or update salary.', params: 'View: @employee. Update (admin): @employee set 400000 REVIEW Annual review.', examples: ['/salary-history @alex', '/salary-history @alex set 400000 REVIEW Good performance'], minRole: 'manager' },
  '/approve-surplus': { usage: '/approve-surplus @employee YYYY-MM hours max_leave_days', description: 'Approve surplus hours for banking.', examples: ['/approve-surplus @alex 2026-03 40 5'], minRole: 'manager' },
  '/approve-absence': { usage: '/approve-absence @employee YYYY-MM-DD reason', description: 'Pre-approve an absence so no shortfall flag fires.', examples: ['/approve-absence @alex 2026-04-10 Doctor appointment'], minRole: 'manager' },
  '/adjust-quota':    { usage: '/adjust-quota @employee monthly|daily|weekly', description: 'Redistribute hour requirements across periods.', examples: ['/adjust-quota @alex monthly'], minRole: 'manager' },
  '/onboard':         { usage: '/onboard', description: 'Add a new employee. Opens a form modal.', minRole: 'admin' },
  '/offboard':        { usage: '/offboard @employee', description: 'Deactivate an employee with settlement preview.', examples: ['/offboard @alex'], minRole: 'admin' },
  '/edit-employee':   { usage: '/edit-employee @employee', description: 'Edit employee details. Opens a pre-filled form.', examples: ['/edit-employee @alex'], minRole: 'admin' },
  '/cache-refresh':   { usage: '/cache-refresh', description: 'Force-clear all caches, refresh timezones, reconcile leave balances.', minRole: 'admin' },
};

const ROLE_LEVEL: Record<string, number> = { employee: 1, manager: 2, admin: 3 };

export function handleHelp(caller: CallerInfo, text = ''): SlackMessage {
  const arg = text.trim();

  // /hr-help <command> — detailed help for one command
  if (arg) {
    const cmd = arg.startsWith('/') ? arg : `/${arg}`;
    const detail = COMMAND_DETAILS[cmd];
    if (detail === undefined) return errorResponse(`Unknown command: ${cmd}. Use /hr-help to see all commands.`);

    const callerLevel = ROLE_LEVEL[caller.role] ?? 1;
    const cmdLevel = ROLE_LEVEL[detail.minRole] ?? 1;
    if (callerLevel < cmdLevel) return errorResponse(`You don't have permission to use ${cmd}.`);

    const lines = [
      `${cmd}`,
      '─'.repeat(30),
      detail.description,
      '',
      `Usage: ${detail.usage}`,
    ];
    if (detail.params !== undefined && detail.params !== '') lines.push('', `Parameters: ${detail.params}`);
    if (detail.examples && detail.examples.length > 0) {
      lines.push('', 'Examples:');
      for (const ex of detail.examples) lines.push(`  ${ex}`);
    }
    return ephemeralText(lines.join('\n'));
  }

  // /hr-help — list all commands the caller can use
  const callerLevel = ROLE_LEVEL[caller.role] ?? 1;
  const sections = [...EMPLOYEE_COMMANDS];

  if (callerLevel >= ROLE_LEVEL[ROLES.MANAGER]) {
    sections.push(...MANAGER_COMMANDS);
  }
  if (callerLevel >= ROLE_LEVEL[ROLES.ADMIN]) {
    sections.push(...ADMIN_COMMANDS);
  }

  sections.push('', 'Tip: /hr-help <command> for detailed help (e.g. /hr-help /hours)');

  return ephemeralText(['Slack HR Bot \u2014 Commands', '\u2500'.repeat(35), ...sections].join('\n'));
}
