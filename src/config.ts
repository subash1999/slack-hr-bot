/**
 * Configuration — tab names, column indices, constants.
 */

export const TABS = {
  EMPLOYEES: 'Employees',
  EVENTS: 'Events',
  LEAVE_REQUESTS: 'LeaveRequests',
  DAILY_REPORTS: 'DailyReports',
  POLICIES: 'Policies',
  OVERRIDES: 'Overrides',
  FLAGS: 'Flags',
  HOURS_BANK: 'HoursBank',
  QUOTA_PLANS: 'QuotaPlans',
  PRE_APPROVALS: 'PreApprovals',
  SALARY_HISTORY: 'SalaryHistory',
  MONTHLY_SUMMARY: 'MonthlySummary',
  POSITIONS: 'Positions',
  FIX_REQUESTS: 'FixRequests',
} as const;

/** 0-based column indices for Employees tab */
export const EMP = {
  USER_ID: 0,
  SLACK_ID: 1,
  NAME: 2,
  EMAIL: 3,
  POSITION: 4,
  SALARY: 5,
  JOIN_DATE: 6,
  LEAVE_ACCRUAL_START_MONTH: 7,
  LEAVE_ACCRUAL_RATE: 8,
  MAX_LEAVE_CAP: 9,
  MANAGER_ID: 10,
  IS_ADMIN: 11,
  LEAVE_BALANCE: 12,
  TZ_OFFSET: 13,
  STATUS: 14,
} as const;

/** 0-based column indices for Events tab */
export const EVT = {
  TIMESTAMP: 0,
  USER_ID: 1,
  USER_NAME: 2,
  ACTION: 3,
  SOURCE: 4,
} as const;

/** 0-based column indices for Positions tab */
export const POS = {
  POSITION: 0,
  POLICY_GROUP: 1,
  DESCRIPTION: 2,
} as const;

/** 0-based column indices for Policies tab */
export const POL = {
  POLICY_GROUP: 0,
  MIN_DAILY_HOURS: 1,
  MIN_WEEKLY_HOURS: 2,
  MIN_MONTHLY_HOURS: 3,
  DESCRIPTION: 4,
} as const;

/** 0-based column indices for LeaveRequests tab */
export const LR = {
  ID: 0,
  USER_ID: 1,
  DATE: 2,
  TYPE: 3,
  STATUS: 4,
  REQUESTED_AT: 5,
  APPROVED_BY: 6,
  APPROVED_AT: 7,
  NOTES: 8,
} as const;

/** 0-based column indices for Flags tab */
export const FLAG = {
  ID: 0,
  USER_ID: 1,
  PERIOD_TYPE: 2,
  PERIOD_VALUE: 3,
  EXPECTED_HOURS: 4,
  ACTUAL_HOURS: 5,
  SHORTFALL_HOURS: 6,
  STATUS: 7,
  BANK_OFFSET_HOURS: 8,
  EFFECTIVE_DEFICIT: 9,
  MANAGER_ID: 10,
  RESOLVED_AT: 11,
  NOTES: 12,
} as const;

/** 0-based column indices for HoursBank tab */
export const BANK = {
  USER_ID: 0,
  PERIOD_TYPE: 1,
  PERIOD_VALUE: 2,
  REQUIRED_HOURS: 3,
  ACTUAL_HOURS: 4,
  SURPLUS_HOURS: 5,
  USED_HOURS: 6,
  REMAINING_HOURS: 7,
  APPROVED_BY: 8,
  MAX_LEAVE_DAYS: 9,
  EXPIRES_AT: 10,
} as const;

/** 0-based column indices for SalaryHistory tab */
export const SAL = {
  ID: 0,
  USER_ID: 1,
  EFFECTIVE_DATE: 2,
  OLD_SALARY: 3,
  NEW_SALARY: 4,
  CHANGE_TYPE: 5,
  REASON: 6,
  APPROVED_BY: 7,
  CREATED_AT: 8,
} as const;

/** 0-based column indices for DailyReports tab */
export const DR = {
  DATE: 0,
  USER_ID: 1,
  USER_NAME: 2,
  YESTERDAY: 3,
  TODAY: 4,
  BLOCKERS: 5,
  SUBMITTED_AT: 6,
} as const;

/** 0-based column indices for Overrides tab */
export const OVR = {
  USER_ID: 0,
  PERIOD_TYPE: 1,
  PERIOD_VALUE: 2,
  REQUIRED_HOURS: 3,
  REASON: 4,
  APPROVED_BY: 5,
  PLAN_ID: 6,
} as const;

/** 0-based column indices for PreApprovals tab */
export const PA = {
  ID: 0,
  USER_ID: 1,
  DATE: 2,
  TYPE: 3,
  CREDIT_HOURS: 4,
  APPROVED_BY: 5,
  APPROVED_AT: 6,
  REASON: 7,
} as const;

export const EVENT_SOURCES = {
  SLACK_COMMAND: 'slack_command',
  SCHEDULED: 'scheduled',
  ADMIN_OVERRIDE: 'admin_override',
  MANUAL_FIX: 'manual_fix',
} as const;

/** Status values used across sheets */
export const STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  APPROVED_DEDUCT: 'APPROVED_DEDUCT',
  APPROVED_NO_PENALTY: 'APPROVED_NO_PENALTY',
  BANK_OFFSET: 'BANK_OFFSET',
  DISMISSED: 'DISMISSED',
  CANCELLED: 'CANCELLED',
} as const;

export const LEAVE_TYPES = {
  PAID: 'PAID',
  UNPAID: 'UNPAID',
  SHIFT: 'SHIFT',
} as const;

export const ABSENCE_TYPES = {
  PAID_LEAVE: 'PAID_LEAVE',
  UNPAID_LEAVE: 'UNPAID_LEAVE',
  MAKE_UP: 'MAKE_UP',
  CREDITED_ABSENCE: 'CREDITED_ABSENCE',
} as const;

export const SALARY_CHANGE_TYPES = {
  INITIAL: 'INITIAL',
  PROBATION_END: 'PROBATION_END',
  REVIEW: 'REVIEW',
  PROMOTION: 'PROMOTION',
  ADJUSTMENT: 'ADJUSTMENT',
} as const;

export const ROLES = {
  EMPLOYEE: 'employee',
  MANAGER: 'manager',
  ADMIN: 'admin',
} as const;

export const CLOCK_STATES = {
  IDLE: 'IDLE',
  CLOCKED_IN: 'CLOCKED_IN',
  ON_BREAK: 'ON_BREAK',
} as const;

export const ACTIONS = {
  IN: 'IN',
  OUT: 'OUT',
  BREAK_START: 'BREAK_START',
  BREAK_END: 'BREAK_END',
  VOID: 'VOID',
} as const;

export const PERIOD_TYPES = {
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
} as const;

/** ID prefixes for auto-generated IDs */
export const ID_PREFIX = {
  EMPLOYEE: 'EMP',
  LEAVE_REQUEST: 'LR',
  FLAG: 'FLG',
  SALARY_HISTORY: 'SH',
  PRE_APPROVAL: 'PA',
  QUOTA_PLAN: 'QRP',
  FIX_REQUEST: 'FRQ',
} as const;

/** 0-based column indices for FixRequests tab */
export const FIX_REQ = {
  ID: 0,
  USER_ID: 1,
  TARGET_DATE: 2,
  TARGET_TIME: 3,
  PROPOSED_ACTION: 4,
  REASON: 5,
  STATUS: 6,
  REQUESTED_AT: 7,
  REVIEWED_BY: 8,
  REVIEWED_AT: 9,
  RESPONSE_URL: 10,
} as const;

/** Slack interactive action_id prefixes for block_actions routing */
export const ACTION_IDS = {
  FIX_APPROVE: 'fix_approve:',
  FIX_REJECT: 'fix_reject:',
  LEAVE_APPROVE: 'leave_approve:',
  LEAVE_REJECT: 'leave_reject:',
} as const;

export const CEO_USER_ID = 'EMP000';
/** Manager ID value for CEO / top-level employees who have no manager. */
export const CEO_MANAGER_ID = 'none';
/** Default timezone. Per-employee timezone resolved from Slack users.info API when available. */
export const DEFAULT_TIMEZONE = 'Asia/Kathmandu';
export const DEFAULT_TZ_OFFSET_MS = 5 * 60 * 60 * 1000 + 45 * 60 * 1000; // UTC+5:45 (NST)
export const OPEN_SESSION_ALERT_MS = 24 * 60 * 60 * 1000; // 24h threshold for HR alert
export const IDEMPOTENCY_WINDOW_MS = 60_000;
export const CACHE_TTL_SECONDS = 600;
export const LOCK_TIMEOUT_MS = 10_000;

export const CHANNELS = {
  ATTENDANCE: '#attendance',
  DAILY_REPORTS: '#daily-reports',
  LEAVE_REQUESTS: '#leave-requests',
  HR_FLAGS: '#hr-flags',
  HR_ALERTS: '#hr-alerts',
} as const;

export const CACHED_TABS: readonly string[] = [
  TABS.EMPLOYEES,
  TABS.POSITIONS,
  TABS.POLICIES,
];
