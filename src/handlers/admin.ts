/**
 * Admin commands — /onboard, /offboard, /edit-employee.
 */

import { TABS, EMP, CHANNELS, STATUS, SALARY_CHANGE_TYPES, ID_PREFIX, PERIOD_TYPES, CEO_MANAGER_ID } from '../config';
import { proRate, calculatePayroll, getEffectiveSalary, getHourRequirements, getMonthlyHours } from '../core/calculator';
import { todayLocal, getDaysInMonth } from '../utils/dates';
import { errorResponse, successResponse, ephemeralText } from '../utils/format';
import { validateSalary, validateUniqueField } from '../utils/validate';
import type { CallerInfo, ISheetsService, ISlackService, SlackMessage } from '../types';

export interface AdminDeps {
  sheetsService: ISheetsService;
  slackService: ISlackService;
}

// ─── /onboard ───────────────────────────────────────────────────────────────

export interface OnboardData {
  name: string;
  email: string;
  slack_id: string;
  position: string;
  salary: number;
  join_date: string;
  manager_id: string;
  leave_accrual_start_month: number;
  leave_accrual_rate: number;
  max_leave_cap: number;
}

export function handleOnboard(
  caller: CallerInfo,
  data: OnboardData,
  deps: AdminDeps,
): SlackMessage {
  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);

  // Validate unique slack_id
  if (!validateUniqueField(data.slack_id, EMP.SLACK_ID, employees)) {
    return errorResponse(`Slack ID ${data.slack_id} already exists.`);
  }

  // Validate unique email
  if (!validateUniqueField(data.email, EMP.EMAIL, employees)) {
    return errorResponse(`Email ${data.email} already exists.`);
  }

  // Validate salary
  const salResult = validateSalary(data.salary);
  if (!salResult.valid) return errorResponse(salResult.error!);

  // Validate manager exists and is active
  let managerValid = false;
  for (let i = 1; i < employees.length; i++) {
    if (
      employees[i][EMP.USER_ID] === data.manager_id &&
      String(employees[i][EMP.STATUS]).toUpperCase() === STATUS.ACTIVE
    ) {
      managerValid = true;
      break;
    }
  }
  if (!managerValid && data.manager_id !== CEO_MANAGER_ID) {
    return errorResponse(`Manager ${data.manager_id} not found or inactive.`);
  }

  // Auto-generate user_id
  let maxNum = 0;
  const empPattern = new RegExp(`^${ID_PREFIX.EMPLOYEE}(\\d+)$`);
  for (let i = 1; i < employees.length; i++) {
    const id = String(employees[i][EMP.USER_ID]);
    const match = id.match(empPattern);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
  }
  const userId = `${ID_PREFIX.EMPLOYEE}${String(maxNum + 1).padStart(3, '0')}`;

  // Create Employees row
  const empRow = [
    userId, data.slack_id, data.name, data.email, data.position, data.salary,
    data.join_date, data.leave_accrual_start_month, data.leave_accrual_rate,
    data.max_leave_cap, data.manager_id, false, 0, null, STATUS.ACTIVE,
  ];
  deps.sheetsService.appendRow(TABS.EMPLOYEES, empRow);

  // Create SalaryHistory INITIAL
  const salHistory = deps.sheetsService.getAll(TABS.SALARY_HISTORY);
  const salId = `${ID_PREFIX.SALARY_HISTORY}${String(salHistory.length).padStart(4, '0')}`;
  deps.sheetsService.appendRow(TABS.SALARY_HISTORY, [
    salId, userId, data.join_date, 0, data.salary, SALARY_CHANGE_TYPES.INITIAL, 'Onboarding',
    caller.user_id, new Date().toISOString(),
  ]);

  // Invalidate cache
  deps.sheetsService.invalidateCache(TABS.EMPLOYEES);

  // Send welcome DM
  deps.slackService.sendDM(
    data.slack_id,
    `Welcome to Slack HR Bot, ${data.name}!\n` +
    `Position: ${data.position}\n` +
    `Commands: /in, /out, /break, /back, /hours, /request-leave, /report, /hr-help\n` +
    `Leave accrual starts after ${data.leave_accrual_start_month} months.`,
  );

  // Post to #hr-alerts
  deps.slackService.postToChannel(
    CHANNELS.HR_ALERTS,
    `New employee onboarded: ${data.name} (${userId}) as ${data.position} by ${caller.name}`,
  );

  return successResponse(`Onboarded ${data.name} (${userId}) as ${data.position}.`);
}

// ─── /offboard ──────────────────────────────────────────────────────────────

export interface OffboardResult {
  proRataSalary: number;
  proRataHours: number;
  actualHours: number;
  deficit: number;
  deduction: number;
  finalSettlement: number;
  unusedLeave: number;
}

export function handleOffboard(
  caller: CallerInfo,
  targetUserId: string,
  deps: AdminDeps,
): { message: SlackMessage; settlement?: OffboardResult } {
  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  let empIndex = -1;
  for (let i = 1; i < employees.length; i++) {
    if (employees[i][EMP.USER_ID] === targetUserId) { empIndex = i; break; }
  }
  if (empIndex === -1) return { message: errorResponse('Employee not found.') };

  const emp = employees[empIndex];
  const name = String(emp[EMP.NAME]);
  const today = todayLocal();
  const [year, month, day] = today.split('-').map(Number);
  const totalDays = getDaysInMonth(year, month);
  const daysWorked = day;

  const salaryHistory = deps.sheetsService.getAll(TABS.SALARY_HISTORY);
  const yearMonth = today.slice(0, 7);
  const salary = getEffectiveSalary(targetUserId, yearMonth, salaryHistory);

  const positions = deps.sheetsService.getAll(TABS.POSITIONS);
  const policies = deps.sheetsService.getAll(TABS.POLICIES);
  const overrides = deps.sheetsService.getAll(TABS.OVERRIDES);
  const reqs = getHourRequirements(targetUserId, employees, positions, policies, overrides, PERIOD_TYPES.MONTHLY, yearMonth);

  const proRataSalary = proRate(salary, daysWorked, totalDays);
  const proRataHours = proRate(reqs.monthly, daysWorked, totalDays);

  // Get actual hours for the current month
  const events = deps.sheetsService.getAll(TABS.EVENTS);
  const leaveReqs = deps.sheetsService.getAll(TABS.LEAVE_REQUESTS);
  const preApprovals = deps.sheetsService.getAll(TABS.PRE_APPROVALS);
  const monthly = getMonthlyHours(events, leaveReqs, preApprovals, targetUserId, yearMonth);

  const payroll = calculatePayroll(proRataSalary, proRataHours, monthly.totalHours, 0);
  const unusedLeave = Number(emp[EMP.LEAVE_BALANCE]);

  const settlement: OffboardResult = {
    proRataSalary,
    proRataHours,
    actualHours: monthly.totalHours,
    deficit: payroll.deficit,
    deduction: payroll.deduction,
    finalSettlement: payroll.finalSalary,
    unusedLeave,
  };

  // Set INACTIVE
  deps.sheetsService.updateCell(TABS.EMPLOYEES, empIndex + 1, EMP.STATUS + 1, STATUS.INACTIVE);

  // Cancel active QuotaPlans
  const quotaPlans = deps.sheetsService.getAll(TABS.QUOTA_PLANS);
  for (let i = 1; i < quotaPlans.length; i++) {
    if (quotaPlans[i][1] === targetUserId && quotaPlans[i][5] === STATUS.ACTIVE) {
      deps.sheetsService.updateCell(TABS.QUOTA_PLANS, i + 1, 6, STATUS.CANCELLED);
    }
  }

  // Invalidate cache
  deps.sheetsService.invalidateCache(TABS.EMPLOYEES);

  // Post to #hr-alerts
  deps.slackService.postToChannel(
    CHANNELS.HR_ALERTS,
    `Employee offboarded: ${name} (${targetUserId})\n` +
    `Settlement: NPR ${settlement.finalSettlement.toLocaleString()}\n` +
    `Unused leave: ${unusedLeave} days (forfeited)\n` +
    `Processed by ${caller.name}`,
  );

  return {
    message: successResponse(
      `Offboarded ${name} (${targetUserId}).\n` +
      `Pro-rata salary: NPR ${proRataSalary.toLocaleString()}\n` +
      `Deficit: ${payroll.deficit}h → Deduction: NPR ${payroll.deduction.toLocaleString()}\n` +
      `Final settlement: NPR ${settlement.finalSettlement.toLocaleString()}\n` +
      `Unused leave: ${unusedLeave} days (forfeited)`,
    ),
    settlement,
  };
}

// ─── /edit-employee ─────────────────────────────────────────────────────────

export interface EditData {
  name?: string;
  email?: string;
  position?: string;
  manager_id?: string;
  leave_accrual_start_month?: number;
  leave_accrual_rate?: number;
  max_leave_cap?: number;
  status?: 'ACTIVE' | 'INACTIVE';
}

export function handleEditEmployee(
  caller: CallerInfo,
  targetUserId: string,
  changes: EditData,
  deps: AdminDeps,
): SlackMessage {
  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  let empIndex = -1;
  for (let i = 1; i < employees.length; i++) {
    if (employees[i][EMP.USER_ID] === targetUserId) { empIndex = i; break; }
  }
  if (empIndex === -1) return errorResponse('Employee not found.');

  const emp = employees[empIndex];
  const name = String(emp[EMP.NAME]);
  const sheetRow = empIndex + 1;
  const applied: string[] = [];

  // Salary NOT editable via this command
  if ('salary' in changes) {
    return errorResponse('Salary cannot be changed here. Use /salary-history @employee set <amount>.');
  }

  // Status → INACTIVE triggers offboard
  if (changes.status === STATUS.INACTIVE && String(emp[EMP.STATUS]).toUpperCase() === STATUS.ACTIVE) {
    const offResult = handleOffboard(caller, targetUserId, deps);
    return offResult.message;
  }

  // INACTIVE → ACTIVE requires special handling
  if (changes.status === STATUS.ACTIVE && String(emp[EMP.STATUS]).toUpperCase() === STATUS.INACTIVE) {
    return errorResponse('Reactivation requires new join date and salary. Use /onboard instead.');
  }

  if (changes.name !== undefined) {
    deps.sheetsService.updateCell(TABS.EMPLOYEES, sheetRow, EMP.NAME + 1, changes.name);
    applied.push(`Name: ${String(emp[EMP.NAME])} → ${changes.name}`);
  }
  if (changes.email !== undefined) {
    if (!validateUniqueField(changes.email, EMP.EMAIL, employees, empIndex)) {
      return errorResponse(`Email ${changes.email} already exists.`);
    }
    deps.sheetsService.updateCell(TABS.EMPLOYEES, sheetRow, EMP.EMAIL + 1, changes.email);
    applied.push(`Email: ${String(emp[EMP.EMAIL])} → ${changes.email}`);
  }
  if (changes.position !== undefined) {
    deps.sheetsService.updateCell(TABS.EMPLOYEES, sheetRow, EMP.POSITION + 1, changes.position);
    applied.push(`Position: ${String(emp[EMP.POSITION])} → ${changes.position}`);
    deps.slackService.postToChannel(
      CHANNELS.HR_ALERTS,
      `Position changed: ${name} ${String(emp[EMP.POSITION])} → ${changes.position} (effective next month)`,
    );
  }
  if (changes.manager_id !== undefined) {
    deps.sheetsService.updateCell(TABS.EMPLOYEES, sheetRow, EMP.MANAGER_ID + 1, changes.manager_id);
    applied.push(`Manager: ${String(emp[EMP.MANAGER_ID])} → ${changes.manager_id}`);
  }
  if (changes.leave_accrual_start_month !== undefined) {
    deps.sheetsService.updateCell(TABS.EMPLOYEES, sheetRow, EMP.LEAVE_ACCRUAL_START_MONTH + 1, changes.leave_accrual_start_month);
    applied.push(`Leave accrual start: ${changes.leave_accrual_start_month} months`);
  }
  if (changes.leave_accrual_rate !== undefined) {
    deps.sheetsService.updateCell(TABS.EMPLOYEES, sheetRow, EMP.LEAVE_ACCRUAL_RATE + 1, changes.leave_accrual_rate);
    applied.push(`Leave accrual rate: ${changes.leave_accrual_rate} days/month`);
  }
  if (changes.max_leave_cap !== undefined) {
    deps.sheetsService.updateCell(TABS.EMPLOYEES, sheetRow, EMP.MAX_LEAVE_CAP + 1, changes.max_leave_cap);
    applied.push(`Max leave cap: ${changes.max_leave_cap} days`);
  }

  // Invalidate cache
  deps.sheetsService.invalidateCache(TABS.EMPLOYEES);

  if (applied.length === 0) return ephemeralText('No changes applied.');

  return successResponse(`Updated ${name} (${targetUserId}):\n${applied.map(a => `  • ${a}`).join('\n')}`);
}
