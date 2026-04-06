/**
 * Seed script — initializes the Google Sheets database with all tabs, headers, and default data.
 * Idempotent: safe to run multiple times.
 *
 * Run via: clasp run seedDatabase
 */

import {
  TABS, EMP, POS, POL, SAL,
  STATUS, CEO_USER_ID, CEO_MANAGER_ID, ID_PREFIX, SALARY_CHANGE_TYPES,
  DEFAULT_TZ_OFFSET_MS,
} from '../config';
import { todayLocal } from '../utils/dates';
import { nextId } from '../utils/ids';
import type { SheetData, SheetRow } from '../types';

interface SeedReport {
  tabsCreated: string[];
  tabsExisted: string[];
  policiesCreated: string[];
  policiesSkipped: string[];
  positionsCreated: string[];
  positionsSkipped: string[];
  ceoCreated: boolean;
  ceoSkipped: boolean;
  salaryHistoryCreated: boolean;
  salaryHistorySkipped: boolean;
}

/** Header definitions for each tab, ordered by column index constants. */
const TAB_HEADERS: Record<string, string[]> = {
  [TABS.EMPLOYEES]: [
    'user_id', 'slack_id', 'name', 'email', 'position', 'salary',
    'join_date', 'leave_accrual_start_month', 'leave_accrual_rate',
    'max_leave_cap', 'manager_id', 'is_admin', 'leave_balance', 'tz_offset', 'status',
  ],
  [TABS.EVENTS]: ['timestamp', 'user_id', 'user_name', 'action', 'source'],
  [TABS.LEAVE_REQUESTS]: [
    'id', 'user_id', 'date', 'type', 'status', 'requested_at', 'approved_by', 'approved_at', 'notes',
  ],
  [TABS.DAILY_REPORTS]: ['date', 'user_id', 'user_name', 'yesterday', 'today', 'blockers', 'submitted_at'],
  [TABS.POLICIES]: ['policy_group', 'min_daily_hours', 'min_weekly_hours', 'min_monthly_hours', 'description'],
  [TABS.OVERRIDES]: ['user_id', 'period_type', 'period_value', 'required_hours', 'reason', 'approved_by', 'plan_id'],
  [TABS.FLAGS]: [
    'id', 'user_id', 'period_type', 'period_value', 'expected_hours', 'actual_hours',
    'shortfall_hours', 'status', 'bank_offset_hours', 'effective_deficit', 'manager_id', 'resolved_at', 'notes',
  ],
  [TABS.HOURS_BANK]: [
    'user_id', 'period_type', 'period_value', 'required_hours', 'actual_hours',
    'surplus_hours', 'used_hours', 'remaining_hours', 'approved_by', 'max_leave_days', 'expires_at',
  ],
  [TABS.QUOTA_PLANS]: ['plan_id', 'user_id', 'plan_type', 'created_by', 'created_at', 'status', 'notes'],
  [TABS.PRE_APPROVALS]: ['id', 'user_id', 'date', 'type', 'credit_hours', 'approved_by', 'approved_at', 'reason'],
  [TABS.SALARY_HISTORY]: [
    'id', 'user_id', 'effective_date', 'old_salary', 'new_salary', 'change_type', 'reason', 'approved_by', 'created_at',
  ],
  [TABS.MONTHLY_SUMMARY]: [
    'user_id', 'month', 'worked_hours', 'paid_leave_hours', 'total_hours',
    'required_hours', 'deficit', 'bank_offset', 'effective_deficit', 'flag_status',
  ],
  [TABS.POSITIONS]: ['position', 'policy_group', 'description'],
  [TABS.FIX_REQUESTS]: [
    'id', 'user_id', 'target_date', 'target_time', 'proposed_action',
    'reason', 'status', 'requested_at', 'reviewed_by', 'reviewed_at', 'response_url',
  ],
};

const DEFAULT_POLICIES: SheetRow[] = [
  ['Full-Time', 3, 30, 160, 'Full-time contract staff (3h/30h/160h)'],
  ['Intern', 3, 15, 80, 'Interns (3h/15h/80h)'],
];

const DEFAULT_POSITIONS: SheetRow[] = [
  ['CEO', 'Full-Time', 'Chief Executive Officer'],
  ['CTO', 'Full-Time', 'Chief Technology Officer'],
  ['Team Lead', 'Full-Time', 'Team Lead'],
  ['Full Time Contract Developer', 'Full-Time', 'Full-time contract developer'],
  ['Full Time Developer', 'Full-Time', 'Full-time developer'],
  ['Contract Intern', 'Intern', 'Contract intern'],
  ['Intern', 'Intern', 'Intern'],
];

export interface SeedDeps {
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet;
}

export function seedDatabase(deps: SeedDeps): SeedReport {
  const ss = deps.spreadsheet;
  const report: SeedReport = {
    tabsCreated: [], tabsExisted: [],
    policiesCreated: [], policiesSkipped: [],
    positionsCreated: [], positionsSkipped: [],
    ceoCreated: false, ceoSkipped: false,
    salaryHistoryCreated: false, salaryHistorySkipped: false,
  };

  // 1. Create/verify all tabs
  for (const [tabName, headers] of Object.entries(TAB_HEADERS)) {
    let sheet = ss.getSheetByName(tabName);
    if (sheet) {
      report.tabsExisted.push(tabName);
    } else {
      sheet = ss.insertSheet(tabName);
      sheet.appendRow(headers);
      report.tabsCreated.push(tabName);
    }
  }

  // 2. Seed Policies
  const policiesSheet = ss.getSheetByName(TABS.POLICIES)!;
  const policiesData = policiesSheet.getDataRange().getValues() as SheetData;
  for (const policy of DEFAULT_POLICIES) {
    const name = String(policy[POL.POLICY_GROUP]);
    const exists = policiesData.some((row, i) => i > 0 && row[POL.POLICY_GROUP] === name);
    if (exists) {
      report.policiesSkipped.push(name);
    } else {
      policiesSheet.appendRow(policy);
      report.policiesCreated.push(name);
    }
  }

  // 3. Seed Positions
  const positionsSheet = ss.getSheetByName(TABS.POSITIONS)!;
  const positionsData = positionsSheet.getDataRange().getValues() as SheetData;
  for (const position of DEFAULT_POSITIONS) {
    const name = String(position[POS.POSITION]);
    const exists = positionsData.some((row, i) => i > 0 && row[POS.POSITION] === name);
    if (exists) {
      report.positionsSkipped.push(name);
    } else {
      positionsSheet.appendRow(position);
      report.positionsCreated.push(name);
    }
  }

  // 4. Seed CEO
  const empSheet = ss.getSheetByName(TABS.EMPLOYEES)!;
  const empData = empSheet.getDataRange().getValues() as SheetData;
  const ceoExists = empData.some((row, i) => i > 0 && row[EMP.USER_ID] === CEO_USER_ID);

  if (ceoExists) {
    report.ceoSkipped = true;
  } else {
    empSheet.appendRow([
      CEO_USER_ID, '', 'CEO', '', 'CEO', 0,
      todayLocal(), 1, 0, 0,
      CEO_MANAGER_ID, 'TRUE', 0, DEFAULT_TZ_OFFSET_MS, STATUS.ACTIVE,
    ]);
    report.ceoCreated = true;
  }

  // 5. Seed CEO SalaryHistory
  const salSheet = ss.getSheetByName(TABS.SALARY_HISTORY)!;
  const salData = salSheet.getDataRange().getValues() as SheetData;
  const salExists = salData.some((row, i) => i > 0 && row[SAL.USER_ID] === CEO_USER_ID);

  if (salExists) {
    report.salaryHistorySkipped = true;
  } else {
    const salId = nextId(ID_PREFIX.SALARY_HISTORY, salData, SAL.ID);
    salSheet.appendRow([
      salId, CEO_USER_ID, todayLocal(),
      0, 0, SALARY_CHANGE_TYPES.INITIAL, 'Seed script', CEO_USER_ID, new Date().toISOString(),
    ]);
    report.salaryHistoryCreated = true;
  }

  return report;
}

/** GAS entry point — reads Sheet ID from Script Properties. */
function runSeed(): string {
  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty('SHEET_ID');
  if (sheetId === null || sheetId === '') {
    throw new Error('SHEET_ID not configured in Script Properties.');
  }
  const ss = SpreadsheetApp.openById(sheetId);
  const report = seedDatabase({ spreadsheet: ss });

  const lines = [
    '=== Seed Report ===',
    `Tabs created: ${report.tabsCreated.length > 0 ? report.tabsCreated.join(', ') : '(none)'}`,
    `Tabs existed: ${report.tabsExisted.length > 0 ? report.tabsExisted.join(', ') : '(none)'}`,
    `Policies created: ${report.policiesCreated.length > 0 ? report.policiesCreated.join(', ') : '(none)'}`,
    `Policies skipped: ${report.policiesSkipped.length > 0 ? report.policiesSkipped.join(', ') : '(none)'}`,
    `Positions created: ${report.positionsCreated.length > 0 ? report.positionsCreated.join(', ') : '(none)'}`,
    `Positions skipped: ${report.positionsSkipped.length > 0 ? report.positionsSkipped.join(', ') : '(none)'}`,
    `CEO: ${report.ceoCreated ? 'created' : 'already exists'}`,
    `CEO Salary History: ${report.salaryHistoryCreated ? 'created' : 'already exists'}`,
  ];

  const summary = lines.join('\n');
  Logger.log(summary);
  return summary;
}

// Export for GAS global scope
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
(globalThis as Record<string, unknown>).seedDatabase = runSeed;
/* eslint-enable @typescript-eslint/no-unsafe-member-access */

// Export for testing
export { TAB_HEADERS, DEFAULT_POLICIES, DEFAULT_POSITIONS };
