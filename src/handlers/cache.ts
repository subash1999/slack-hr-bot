/**
 * Cache management — timezone refresh, full cache refresh command.
 */

import { TABS, EMP, STATUS, ROLES } from '../config';
import { reconcileLeaveBalances } from '../triggers/monthly';
import { successResponse, errorResponse } from '../utils/format';
import type { ISheetsService, ISlackService, IAuthService, CallerInfo, SlackMessage, SheetData } from '../types';

export interface CacheDeps {
  sheetsService: ISheetsService;
  slackService: ISlackService;
  authService: IAuthService;
}

export interface TzRefreshDeps {
  sheetsService: ISheetsService;
  slackService: ISlackService;
}

export interface TzRefreshResult {
  updated: number;
  failed: number;
}

/**
 * Refresh timezone offsets for all active employees by querying the Slack API.
 * Updates EMP.TZ_OFFSET column and invalidates the Employees cache.
 */
export function refreshTimezones(
  employees: SheetData,
  deps: TzRefreshDeps,
): TzRefreshResult {
  let updated = 0;
  let failed = 0;

  for (let i = 1; i < employees.length; i++) {
    if (String(employees[i][EMP.STATUS]).toUpperCase() !== STATUS.ACTIVE) continue;

    const slackId = String(employees[i][EMP.SLACK_ID]);
    const offset = deps.slackService.getUserTimezoneOffset(slackId);

    if (offset !== null) {
      deps.sheetsService.updateCell(TABS.EMPLOYEES, i + 1, EMP.TZ_OFFSET + 1, offset);
      updated++;
    } else {
      failed++;
    }
  }

  if (updated > 0) {
    deps.sheetsService.invalidateCache(TABS.EMPLOYEES);
  }

  return { updated, failed };
}

/**
 * Admin-only /cache-refresh command.
 * Invalidates all caches, refreshes timezones, and reconciles leave balances.
 */
export function handleCacheRefresh(
  caller: CallerInfo,
  deps: CacheDeps,
): SlackMessage {
  try {
    deps.authService.requireRole(caller, ROLES.ADMIN);
  } catch {
    return errorResponse('Only admins can use this command.');
  }

  // 1. Invalidate all caches
  deps.sheetsService.invalidateAllCaches();

  // 2. Refresh timezones
  const employees = deps.sheetsService.getAll(TABS.EMPLOYEES);
  const tzResult = refreshTimezones(employees, {
    sheetsService: deps.sheetsService,
    slackService: deps.slackService,
  });

  // 3. Reconcile leave balances (uses same employees snapshot — reconciliation doesn't need TZ)
  const reconciliationIssues = reconcileLeaveBalances(employees, {
    sheetsService: deps.sheetsService,
  });

  return successResponse(
    `Cache refresh complete. TZ updated: ${tzResult.updated}, TZ failed: ${tzResult.failed}, leave reconciliation issues fixed: ${reconciliationIssues}.`,
  );
}
