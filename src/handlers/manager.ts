/**
 * Manager team view commands — /team-hours, /team-flags, /team-bank, /team-reports, /team-payroll.
 */

import { TABS, EMP, FLAG, DR, STATUS, PERIOD_TYPES, ROLES } from '../config';
import { getMonthlyHours, getHourRequirements, getEffectiveSalary, calculatePayroll } from '../core/calculator';
import { getAvailableBank } from '../core/flags';
import { todayLocal, getWeekDates, getWeekStart, getDaysInMonth } from '../utils/dates';
import { formatHoursMinutes, ephemeralText } from '../utils/format';
import type { CallerInfo, ISheetsService, SlackMessage, SheetData } from '../types';

export interface ManagerDeps {
  sheetsService: ISheetsService;
}

function getDirectReports(caller: CallerInfo, employees: SheetData): SheetData {
  const reports: SheetData = [];
  for (let i = 1; i < employees.length; i++) {
    if (String(employees[i][EMP.STATUS]).toUpperCase() !== STATUS.ACTIVE) continue;
    if (caller.role === ROLES.ADMIN || employees[i][EMP.MANAGER_ID] === caller.user_id) {
      reports.push(employees[i]);
    }
  }
  return reports;
}

// ─── /team-hours ────────────────────────────────────────────────────────────

export function handleTeamHours(caller: CallerInfo, deps: ManagerDeps): SlackMessage {
  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  const events = deps.sheetsService.getAll(TABS.EVENTS);
  const positions = deps.sheetsService.getAll(TABS.POSITIONS);
  const policies = deps.sheetsService.getAll(TABS.POLICIES);
  const overrides = deps.sheetsService.getAll(TABS.OVERRIDES);
  const leaveReqs = deps.sheetsService.getAll(TABS.LEAVE_REQUESTS);
  const preApprovals = deps.sheetsService.getAll(TABS.PRE_APPROVALS);
  const yearMonth = todayLocal().slice(0, 7);

  const reports = getDirectReports(caller, employees);
  const lines = [`Team Hours \u2014 ${yearMonth}`, ''];

  for (const emp of reports) {
    const userId = String(emp[EMP.USER_ID]);
    const name = String(emp[EMP.NAME]);
    const monthly = getMonthlyHours(events, leaveReqs, preApprovals, userId, yearMonth);
    const reqs = getHourRequirements(userId, employees, positions, policies, overrides, PERIOD_TYPES.MONTHLY, yearMonth);
    const diff = monthly.totalHours - reqs.monthly;
    const indicator = diff >= 0 ? '\u2705' : '\u26A0\uFE0F';
    const diffStr = diff >= 0 ? `+${formatHoursMinutes(diff)}` : `-${formatHoursMinutes(Math.abs(diff))}`;
    lines.push(`${name}: ${formatHoursMinutes(monthly.totalHours)} / ${reqs.monthly}h ${indicator} ${diffStr}`);
  }

  return ephemeralText(lines.join('\n'));
}

// ─── /team-flags ────────────────────────────────────────────────────────────

export function handleTeamFlags(caller: CallerInfo, deps: ManagerDeps): SlackMessage {
  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  const flags = deps.sheetsService.getAll(TABS.FLAGS);
  const bankData = deps.sheetsService.getAll(TABS.HOURS_BANK);
  const today = todayLocal();

  const reports = getDirectReports(caller, employees);
  const reportIds = new Set(reports.map((r) => String(r[EMP.USER_ID])));

  const pendingFlags: Array<{ id: string; userId: string; name: string; type: string; period: string; shortfall: number; bank: number }> = [];

  for (let i = 1; i < flags.length; i++) {
    if (String(flags[i][FLAG.STATUS]) !== STATUS.PENDING) continue;
    const userId = String(flags[i][FLAG.USER_ID]);
    if (!reportIds.has(userId)) continue;

    const name = reports.find((r) => String(r[EMP.USER_ID]) === userId)?.[EMP.NAME] ?? userId;
    const available = getAvailableBank(userId, bankData, today);
    const totalBank = available.reduce((sum, e) => sum + e.remaining, 0);

    pendingFlags.push({
      id: String(flags[i][FLAG.ID]),
      userId,
      name: String(name),
      type: String(flags[i][FLAG.PERIOD_TYPE]),
      period: String(flags[i][FLAG.PERIOD_VALUE]),
      shortfall: Number(flags[i][FLAG.SHORTFALL_HOURS]),
      bank: totalBank,
    });
  }

  if (pendingFlags.length === 0) {
    return ephemeralText('Team Flags\n\nNo pending flags.');
  }

  const lines = ['Team Flags \u2014 Pending', ''];
  for (const f of pendingFlags) {
    lines.push(`${f.id}: ${f.name} \u2014 ${f.type} ${f.period} (-${formatHoursMinutes(f.shortfall)})`);
    if (f.bank > 0) {
      lines.push(`  Bank available: ${formatHoursMinutes(f.bank)}`);
    }
  }
  return ephemeralText(lines.join('\n'));
}

// ─── /team-bank ─────────────────────────────────────────────────────────────

export function handleTeamBank(caller: CallerInfo, deps: ManagerDeps): SlackMessage {
  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  const bankData = deps.sheetsService.getAll(TABS.HOURS_BANK);
  const today = todayLocal();

  const reports = getDirectReports(caller, employees);
  const lines = ['Team Hours Bank', ''];
  let hasEntries = false;

  for (const emp of reports) {
    const userId = String(emp[EMP.USER_ID]);
    const name = String(emp[EMP.NAME]);
    const available = getAvailableBank(userId, bankData, today);

    if (available.length > 0) {
      hasEntries = true;
      lines.push(`${name}:`);
      for (const e of available) {
        lines.push(`  ${e.periodValue}: ${formatHoursMinutes(e.remaining)} remaining (expires ${e.expiresAt})`);
      }
    }
  }

  if (!hasEntries) {
    lines.push('(no banked hours)');
  }

  return ephemeralText(lines.join('\n'));
}

// ─── /team-reports ──────────────────────────────────────────────────────────

export function handleTeamReports(
  caller: CallerInfo,
  text: string,
  deps: ManagerDeps,
): SlackMessage {
  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  const dailyReports = deps.sheetsService.getAll(TABS.DAILY_REPORTS);
  const reports = getDirectReports(caller, employees);
  const today = todayLocal();
  const args = text.trim();

  // Default: today's status
  if (!args) {
    const submitted = new Set<string>();
    for (let i = 1; i < dailyReports.length; i++) {
      if (String(dailyReports[i][DR.DATE]) === today) {
        submitted.add(String(dailyReports[i][DR.USER_ID]));
      }
    }
    const missing = reports.filter((r) => !submitted.has(String(r[EMP.USER_ID])));
    const lines = [
      `Team Reports \u2014 ${today}`,
      '',
      `Submitted: ${submitted.size}/${reports.length}`,
    ];
    if (missing.length > 0) {
      lines.push(`Missing: ${missing.map((m) => String(m[EMP.NAME])).join(', ')}`);
    }
    return ephemeralText(lines.join('\n'));
  }

  // /team-reports week
  if (args === 'week') {
    const weekStart = getWeekStart(today)!;
    const dates = getWeekDates(today);
    const lines = [`Team Reports \u2014 Week of ${weekStart}`, ''];

    for (const date of dates) {
      const submitted = new Set<string>();
      for (let i = 1; i < dailyReports.length; i++) {
        if (String(dailyReports[i][DR.DATE]) === date) {
          submitted.add(String(dailyReports[i][DR.USER_ID]));
        }
      }
      lines.push(`${date}: ${submitted.size}/${reports.length} submitted`);
    }
    return ephemeralText(lines.join('\n'));
  }

  // /team-reports YYYY-MM
  if (/^\d{4}-\d{2}$/.test(args)) {
    const [year, month] = args.split('-').map(Number);
    const days = getDaysInMonth(year, month);
    let totalSubmissions = 0;
    const totalExpected = reports.length * days;

    for (let d = 1; d <= days; d++) {
      const date = `${args}-${String(d).padStart(2, '0')}`;
      for (let i = 1; i < dailyReports.length; i++) {
        if (String(dailyReports[i][DR.DATE]) === date) totalSubmissions++;
      }
    }

    const rate = totalExpected > 0 ? Math.round((totalSubmissions / totalExpected) * 100) : 0;
    return ephemeralText(
      `Team Reports \u2014 ${args}\n\nSubmissions: ${totalSubmissions}/${totalExpected} (${rate}%)`,
    );
  }

  return ephemeralText('Usage: /team-reports, /team-reports week, /team-reports YYYY-MM');
}

// ─── /team-payroll ──────────────────────────────────────────────────────────

export function handleTeamPayroll(
  caller: CallerInfo,
  text: string,
  deps: ManagerDeps,
): SlackMessage {
  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  const events = deps.sheetsService.getAll(TABS.EVENTS);
  const positions = deps.sheetsService.getAll(TABS.POSITIONS);
  const policies = deps.sheetsService.getAll(TABS.POLICIES);
  const overrides = deps.sheetsService.getAll(TABS.OVERRIDES);
  const leaveReqs = deps.sheetsService.getAll(TABS.LEAVE_REQUESTS);
  const preApprovals = deps.sheetsService.getAll(TABS.PRE_APPROVALS);
  const salaryHistory = deps.sheetsService.getAll(TABS.SALARY_HISTORY);
  const flags = deps.sheetsService.getAll(TABS.FLAGS);

  const yearMonth = text.trim() || todayLocal().slice(0, 7);
  const reports = getDirectReports(caller, employees);

  const lines = [`Team Payroll \u2014 ${yearMonth}`, '', 'Name | Salary | Required | Actual | Deficit | Deduction | Final', '\u2500'.repeat(70)];
  let totalSalary = 0;
  let totalDeduction = 0;
  let pendingCount = 0;

  for (const emp of reports) {
    const userId = String(emp[EMP.USER_ID]);
    const name = String(emp[EMP.NAME]);
    const monthly = getMonthlyHours(events, leaveReqs, preApprovals, userId, yearMonth);
    const reqs = getHourRequirements(userId, employees, positions, policies, overrides, PERIOD_TYPES.MONTHLY, yearMonth);
    const salary = getEffectiveSalary(userId, yearMonth, salaryHistory);
    const payroll = calculatePayroll(salary, reqs.monthly, monthly.totalHours, 0);

    // Check for pending flags
    const hasPendingFlag = flags.some((f, i) =>
      i > 0 &&
      String(f[FLAG.USER_ID]) === userId &&
      String(f[FLAG.PERIOD_VALUE]) === yearMonth &&
      String(f[FLAG.STATUS]) === STATUS.PENDING,
    );
    if (hasPendingFlag) pendingCount++;

    totalSalary += salary;
    totalDeduction += payroll.deduction;

    const flagIndicator = hasPendingFlag ? ' \u26A0\uFE0F' : '';
    lines.push(
      `${name} | NPR ${(salary / 1000).toFixed(0)}K | ${reqs.monthly}h | ${formatHoursMinutes(monthly.totalHours)} | ${formatHoursMinutes(payroll.deficit)} | NPR ${payroll.deduction.toLocaleString()} | NPR ${payroll.finalSalary.toLocaleString()}${flagIndicator}`,
    );
  }

  lines.push('\u2500'.repeat(70));
  lines.push(`Total | NPR ${(totalSalary / 1000).toFixed(0)}K | | | | NPR ${totalDeduction.toLocaleString()} | NPR ${(totalSalary - totalDeduction).toLocaleString()}`);
  if (pendingCount > 0) {
    lines.push(`\nPending Flags: ${pendingCount}`);
  }

  return ephemeralText(lines.join('\n'));
}
