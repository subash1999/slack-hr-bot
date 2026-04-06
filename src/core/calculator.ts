/**
 * Hours calculation engine — pure functions for daily/weekly/monthly hours,
 * hour requirements resolution, payroll calculation, and pro-rata.
 */

import { EVT, EMP, POS, POL, SAL, LR, PA, STATUS, LEAVE_TYPES, ABSENCE_TYPES, PERIOD_TYPES } from '../config';
import { getDaysInMonth, getWeekDates } from '../utils/dates';
import type {
  SheetData,
  WeeklyHoursResult,
  MonthlyHoursResult,
  HourRequirements,
  PayrollResult,
} from '../types';

// ─── Daily Hours (reuses core/attendance.getDailyHours for single-day) ──────

import { getDailyHours } from './attendance';
export { getDailyHours };

// ─── Weekly Hours ───────────────────────────────────────────────────────────

export function getWeeklyHours(
  eventsData: SheetData,
  userId: string,
  weekStartDate: string,
): WeeklyHoursResult {
  const dates = getWeekDates(weekStartDate);
  const dailyBreakdown: Record<string, number> = {};
  let totalHours = 0;

  // Pre-filter events for this user to avoid scanning full sheet per day
  const userEvents: SheetData = [eventsData[0]];
  for (let i = 1; i < eventsData.length; i++) {
    if (eventsData[i][EVT.USER_ID] === userId) {
      userEvents.push(eventsData[i]);
    }
  }

  for (const date of dates) {
    const result = getDailyHours(userEvents, userId, date);
    dailyBreakdown[date] = result.netHours;
    totalHours += result.netHours;
  }

  return {
    weekStart: dates[0],
    weekEnd: dates[6],
    dailyBreakdown,
    totalHours,
  };
}

// ─── Monthly Hours ──────────────────────────────────────────────────────────

export function getMonthlyHours(
  eventsData: SheetData,
  leaveRequestsData: SheetData,
  preApprovalsData: SheetData,
  userId: string,
  yearMonth: string,
): MonthlyHoursResult {
  const [year, month] = yearMonth.split('-').map(Number);
  const daysInMonth = getDaysInMonth(year, month);

  // Pre-filter events for this user
  const userEvents: SheetData = [eventsData[0]];
  for (let i = 1; i < eventsData.length; i++) {
    if (eventsData[i][EVT.USER_ID] === userId) {
      userEvents.push(eventsData[i]);
    }
  }

  // Calculate worked hours day by day
  let workedHours = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${yearMonth}-${String(day).padStart(2, '0')}`;
    const result = getDailyHours(userEvents, userId, dateStr);
    workedHours += result.netHours;
  }

  // Count paid leave hours (8h per approved paid leave day)
  let paidLeaveHours = 0;
  for (let i = 1; i < leaveRequestsData.length; i++) {
    const row = leaveRequestsData[i];
    if (
      row[LR.USER_ID] === userId &&
      String(row[LR.STATUS]) === STATUS.APPROVED &&
      String(row[LR.TYPE]) === LEAVE_TYPES.PAID &&
      String(row[LR.DATE]).startsWith(yearMonth)
    ) {
      paidLeaveHours += 8;
    }
  }

  // Count credited absence hours from pre-approvals
  let creditedAbsenceHours = 0;
  for (let i = 1; i < preApprovalsData.length; i++) {
    const row = preApprovalsData[i];
    if (row[PA.USER_ID] !== userId) continue;
    if (!String(row[PA.DATE]).startsWith(yearMonth)) continue;

    const type = String(row[PA.TYPE]);
    if (type === ABSENCE_TYPES.CREDITED_ABSENCE || type === ABSENCE_TYPES.PAID_LEAVE) {
      creditedAbsenceHours += Number(row[PA.CREDIT_HOURS]) || 0;
    }
  }

  const totalHours = workedHours + paidLeaveHours + creditedAbsenceHours;

  return { yearMonth, workedHours, paidLeaveHours, creditedAbsenceHours, totalHours };
}

// ─── Hour Requirements Resolution ──────────────────────────────────────────

export function getHourRequirements(
  userId: string,
  employeesData: SheetData,
  positionsData: SheetData,
  policiesData: SheetData,
  overridesData: SheetData,
  periodType: 'DAILY' | 'WEEKLY' | 'MONTHLY',
  periodValue: string,
): HourRequirements {
  // Check overrides first
  for (let i = 1; i < overridesData.length; i++) {
    const row = overridesData[i];
    if (
      row[0] === userId && // user_id
      row[1] === periodType && // period_type
      row[2] === periodValue // period_value
    ) {
      return {
        daily: periodType === PERIOD_TYPES.DAILY ? Number(row[3]) : 0,
        weekly: periodType === PERIOD_TYPES.WEEKLY ? Number(row[3]) : 0,
        monthly: periodType === PERIOD_TYPES.MONTHLY ? Number(row[3]) : 0,
        source: 'override',
      };
    }
  }

  // Resolve via Employees.position → Positions.policy_group → Policies
  let position = '';
  for (let i = 1; i < employeesData.length; i++) {
    if (employeesData[i][EMP.USER_ID] === userId) {
      position = String(employeesData[i][EMP.POSITION]);
      break;
    }
  }

  let policyGroup = '';
  for (let i = 1; i < positionsData.length; i++) {
    if (positionsData[i][POS.POSITION] === position) {
      policyGroup = String(positionsData[i][POS.POLICY_GROUP]);
      break;
    }
  }

  for (let i = 1; i < policiesData.length; i++) {
    if (policiesData[i][POL.POLICY_GROUP] === policyGroup) {
      return {
        daily: Number(policiesData[i][POL.MIN_DAILY_HOURS]),
        weekly: Number(policiesData[i][POL.MIN_WEEKLY_HOURS]),
        monthly: Number(policiesData[i][POL.MIN_MONTHLY_HOURS]),
        source: 'policy',
      };
    }
  }

  // Fallback
  return { daily: 3, weekly: 30, monthly: 160, source: 'policy' };
}

// ─── Salary Resolution ─────────────────────────────────────────────────────

export function getEffectiveSalary(
  userId: string,
  yearMonth: string,
  salaryHistoryData: SheetData,
): number {
  const entries: Array<{ effectiveDate: string; newSalary: number }> = [];

  for (let i = 1; i < salaryHistoryData.length; i++) {
    if (salaryHistoryData[i][SAL.USER_ID] === userId) {
      entries.push({
        effectiveDate: String(salaryHistoryData[i][SAL.EFFECTIVE_DATE]),
        newSalary: Number(salaryHistoryData[i][SAL.NEW_SALARY]),
      });
    }
  }

  if (entries.length === 0) return 0;

  // Sort by effective_date descending
  entries.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));

  // Find the most recent entry effective on or before the end of yearMonth
  const monthEnd = `${yearMonth}-31`; // Safe: string comparison works
  for (const entry of entries) {
    if (entry.effectiveDate <= monthEnd) {
      return entry.newSalary;
    }
  }

  // If all entries are in the future, use the earliest
  return entries[entries.length - 1].newSalary;
}

// ─── Salary Blending ────────────────────────────────────────────────────────

export function blendSalary(
  segments: Array<{ salary: number; days: number }>,
  totalDays: number,
): number {
  let blended = 0;
  for (const seg of segments) {
    blended += seg.salary * (seg.days / totalDays);
  }
  return Math.round(blended);
}

// ─── Pro-Rata ───────────────────────────────────────────────────────────────

export function proRate(value: number, activeDays: number, totalDays: number): number {
  return Math.round(value * (activeDays / totalDays));
}

// ─── Payroll Calculation ────────────────────────────────────────────────────

export function calculatePayroll(
  effectiveSalary: number,
  requiredHours: number,
  actualHours: number,
  bankOffsetHours: number,
): PayrollResult {
  const hourlyRate = requiredHours > 0 ? effectiveSalary / requiredHours : 0;
  const deficit = Math.max(0, requiredHours - actualHours);
  const effectiveDeficit = Math.max(0, deficit - bankOffsetHours);
  const deduction = effectiveDeficit > 0 ? Math.ceil(effectiveDeficit * hourlyRate) : 0;
  const finalSalary = effectiveSalary - deduction;

  return {
    effectiveSalary,
    requiredHours,
    actualHours,
    deficit,
    bankOffsetHours,
    effectiveDeficit,
    hourlyRate,
    deduction,
    finalSalary,
  };
}
