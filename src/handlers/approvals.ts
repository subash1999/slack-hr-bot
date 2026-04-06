/**
 * Manager approval commands — /approve-absence, /adjust-quota.
 */

import { TABS, EMP, ABSENCE_TYPES, STATUS, ID_PREFIX } from '../config';
import { getHourRequirements } from '../core/calculator';
import { validateDateInput } from '../utils/validate';
import { errorResponse, successResponse } from '../utils/format';
import type { CallerInfo, ISheetsService, ISlackService, SlackMessage, SheetData } from '../types';

export interface ApprovalDeps {
  sheetsService: ISheetsService;
  slackService: ISlackService;
}

// ─── /approve-absence ───────────────────────────────────────────────────────

type AbsenceType = typeof ABSENCE_TYPES[keyof typeof ABSENCE_TYPES];

const ABSENCE_CREDIT: Record<AbsenceType, number> = {
  [ABSENCE_TYPES.PAID_LEAVE]: 8,
  [ABSENCE_TYPES.UNPAID_LEAVE]: 0,
  [ABSENCE_TYPES.MAKE_UP]: 0,
  [ABSENCE_TYPES.CREDITED_ABSENCE]: 8,
};

export function handleApproveAbsence(
  caller: CallerInfo,
  targetUserId: string,
  date: string,
  absenceType: AbsenceType,
  reason: string,
  deps: ApprovalDeps,
): SlackMessage {
  const dateResult = validateDateInput(date);
  if (!dateResult.valid) return errorResponse(dateResult.error!);

  const creditHours = ABSENCE_CREDIT[absenceType];

  // Deduct leave balance for PAID_LEAVE
  if (absenceType === ABSENCE_TYPES.PAID_LEAVE) {
    const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
    const emp = findEmployee(targetUserId, employees);
    if (!emp) return errorResponse('Employee not found.');
    const balance = Number(emp.row[EMP.LEAVE_BALANCE]);
    if (balance <= 0) {
      return errorResponse('Cannot approve paid leave: employee has no leave balance.');
    }
    deps.sheetsService.updateCell(TABS.EMPLOYEES, emp.index + 1, EMP.LEAVE_BALANCE + 1, balance - 1);
  }

  // Create PreApproval entry
  const preApprovals = deps.sheetsService.getAll(TABS.PRE_APPROVALS);
  const nextId = `${ID_PREFIX.PRE_APPROVAL}${String(preApprovals.length).padStart(4, '0')}`;
  const row = [
    nextId,
    targetUserId,
    dateResult.date!,
    absenceType,
    creditHours,
    caller.user_id,
    new Date().toISOString(),
    reason,
  ];
  deps.sheetsService.appendRow(TABS.PRE_APPROVALS, row);

  const typeLabels: Record<AbsenceType, string> = {
    [ABSENCE_TYPES.PAID_LEAVE]: 'Paid Leave (8h, balance deducted)',
    [ABSENCE_TYPES.UNPAID_LEAVE]: 'Unpaid Leave (0h, no flag)',
    [ABSENCE_TYPES.MAKE_UP]: 'Make-Up (0h, compensate later)',
    [ABSENCE_TYPES.CREDITED_ABSENCE]: 'Credited Absence (8h, no balance deduction)',
  };

  return successResponse(
    `Pre-approved absence for ${targetUserId} on ${dateResult.date}: ${typeLabels[absenceType]}`,
  );
}

// ─── /adjust-quota ──────────────────────────────────────────────────────────

export function handleAdjustQuota(
  caller: CallerInfo,
  targetUserId: string,
  periodType: 'DAILY' | 'WEEKLY' | 'MONTHLY',
  adjustments: Array<{ periodValue: string; hours: number }>,
  deps: ApprovalDeps,
): SlackMessage {
  if (adjustments.length === 0) {
    return errorResponse('No adjustments provided.');
  }

  // Calculate totals for warning
  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  const positions = deps.sheetsService.getAll(TABS.POSITIONS);
  const policies = deps.sheetsService.getAll(TABS.POLICIES);

  const emp = findEmployee(targetUserId, employees);
  if (!emp) return errorResponse('Employee not found.');

  // Get default requirement for warning check
  const defaultReqs = getHourRequirements(
    targetUserId, employees, positions, policies,
    [['user_id', 'period_type', 'period_value', 'required_hours']], // empty overrides
    periodType, adjustments[0].periodValue,
  ) as { daily: number; weekly: number; monthly: number };

  const adjustedTotal = adjustments.reduce((sum, a) => sum + a.hours, 0);
  const defaultTotal = defaultReqs[periodType.toLowerCase() as 'daily' | 'weekly' | 'monthly'] * adjustments.length;

  // Create QuotaPlan
  const quotaPlans = deps.sheetsService.getAll(TABS.QUOTA_PLANS);
  const planId = `${ID_PREFIX.QUOTA_PLAN}${String(quotaPlans.length).padStart(4, '0')}`;
  deps.sheetsService.appendRow(TABS.QUOTA_PLANS, [
    planId, targetUserId, periodType, caller.user_id,
    new Date().toISOString(), STATUS.ACTIVE, '',
  ]);

  // Create Override entries
  for (const adj of adjustments) {
    deps.sheetsService.appendRow(TABS.OVERRIDES, [
      targetUserId, periodType, adj.periodValue, adj.hours,
      'Quota redistribution', caller.user_id, planId,
    ]);
  }

  let warning = '';
  if (adjustedTotal < defaultTotal) {
    warning = `\nWarning: adjusted total (${adjustedTotal}h) is less than default (${defaultTotal}h).`;
  }

  return successResponse(
    `Quota redistribution created (${planId}): ${adjustments.length} ${periodType.toLowerCase()} overrides for ${targetUserId}.${warning}`,
  );
}

// ─── Helper ─────────────────────────────────────────────────────────────────

function findEmployee(userId: string, employees: SheetData): { row: SheetData[number]; index: number } | null {
  for (let i = 1; i < employees.length; i++) {
    if (employees[i][EMP.USER_ID] === userId) return { row: employees[i], index: i };
  }
  return null;
}
