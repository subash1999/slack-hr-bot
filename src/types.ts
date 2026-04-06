/**
 * Core type definitions for the HR Bot.
 */

// ─── Employee & Role Types ──────────────────────────────────────────────────

export type Role = 'employee' | 'manager' | 'admin';
export type EmployeeStatus = 'ACTIVE' | 'INACTIVE';

export interface CallerInfo {
  user_id: string;
  slack_id: string;
  name: string;
  email: string;
  role: Role;
  position: string;
  manager_id: string;
  is_admin: boolean;
  status: EmployeeStatus;
  salary: number;
  join_date: string;
  leave_balance: number;
  rowIndex: number; // 1-based row in Employees sheet
}

// ─── Attendance Types ───────────────────────────────────────────────────────
// Derived from config constants to prevent drift
import { ACTIONS, CLOCK_STATES as CS } from './config';

export type EventAction = typeof ACTIONS[keyof typeof ACTIONS];
export type ClockState = typeof CS[keyof typeof CS];

export interface AttendanceEvent {
  timestamp: Date;
  user_id: string;
  user_name: string;
  action: EventAction;
  source: string;
}

export interface ClockStateResult {
  state: ClockState;
  since: Date | null;
  lastAction: EventAction | null;
}

export interface SessionHours {
  workedHours: number;
  breakHours: number;
  netHours: number;
}

export interface DailyHoursResult {
  date: string;
  sessions: Array<{ start: Date; end: Date | null; hours: number }>;
  breaks: Array<{ start: Date; end: Date | null; minutes: number }>;
  totalWorked: number;
  totalBreak: number;
  netHours: number;
}

export interface WeeklyHoursResult {
  weekStart: string;
  weekEnd: string;
  dailyBreakdown: Record<string, number>;
  totalHours: number;
}

export interface MonthlyHoursResult {
  yearMonth: string;
  workedHours: number;
  paidLeaveHours: number;
  creditedAbsenceHours: number;
  totalHours: number;
}

// ─── Leave Types ────────────────────────────────────────────────────────────

export type LeaveType = 'PAID' | 'UNPAID' | 'SHIFT';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface LeaveRequest {
  id: string;
  user_id: string;
  date: string;
  type: LeaveType;
  status: LeaveStatus;
  requested_at: string;
  approved_by: string | null;
  approved_at: string | null;
  notes: string;
}

export interface LeaveBalance {
  accrued: number;
  used: number;
  remaining: number;
  nextAccrualDate: string | null;
  maxCap: number;
}

// ─── Pre-Approval Types ────────────────────────────────────────────────────

export type PreApprovalType = 'PAID_LEAVE' | 'UNPAID_LEAVE' | 'MAKE_UP' | 'CREDITED_ABSENCE';

export interface PreApproval {
  id: string;
  user_id: string;
  date: string;
  type: PreApprovalType;
  credit_hours: number;
  approved_by: string;
  approved_at: string;
  reason: string;
}

// ─── Hours Policy Types ─────────────────────────────────────────────────────

export interface PolicyGroup {
  policy_group: string;
  min_daily_hours: number;
  min_weekly_hours: number;
  min_monthly_hours: number;
}

export interface Position {
  position: string;
  policy_group: string;
  description: string;
}

export interface HourRequirements {
  daily: number;
  weekly: number;
  monthly: number;
  source: 'policy' | 'override';
}

// ─── Flag Types ─────────────────────────────────────────────────────────────

export type FlagPeriodType = 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type FlagStatus =
  | 'PENDING'
  | 'APPROVED_DEDUCT'
  | 'APPROVED_NO_PENALTY'
  | 'BANK_OFFSET'
  | 'DISMISSED';

export interface ShortfallFlag {
  id: string;
  user_id: string;
  period_type: FlagPeriodType;
  period_value: string;
  expected_hours: number;
  actual_hours: number;
  shortfall_hours: number;
  status: FlagStatus;
  bank_offset_hours: number;
  effective_deficit: number;
  manager_id: string;
  resolved_at: string | null;
  notes: string;
}

// ─── Banking Types ──────────────────────────────────────────────────────────

export interface BankEntry {
  user_id: string;
  period_type: 'DAILY' | 'MONTHLY';
  period_value: string;
  required_hours: number;
  actual_hours: number;
  surplus_hours: number;
  used_hours: number;
  remaining_hours: number;
  approved_by: string;
  max_leave_days: number;
  expires_at: string;
}

// ─── Payroll Types ──────────────────────────────────────────────────────────

export type SalaryChangeType =
  | 'INITIAL'
  | 'PROBATION_END'
  | 'REVIEW'
  | 'PROMOTION'
  | 'ADJUSTMENT';

export interface SalaryHistoryEntry {
  id: string;
  user_id: string;
  effective_date: string;
  old_salary: number;
  new_salary: number;
  change_type: SalaryChangeType;
  reason: string;
  approved_by: string;
  created_at: string;
}

export interface PayrollResult {
  effectiveSalary: number;
  requiredHours: number;
  actualHours: number;
  deficit: number;
  bankOffsetHours: number;
  effectiveDeficit: number;
  hourlyRate: number;
  deduction: number;
  finalSalary: number;
}

// ─── Fix Request Types ─────────────────────────────────────────────────────

export type FixProposedAction = 'ADD_IN' | 'ADD_OUT' | 'ADD_BREAK_START' | 'ADD_BREAK_END' | 'CANCEL';

export interface FixRequest {
  id: string;
  user_id: string;
  target_date: string;
  target_time: string;
  proposed_action: FixProposedAction;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requested_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  response_url: string;
}

// ─── Slack Payload Types ────────────────────────────────────────────────────

export interface SlashCommandPayload {
  token: string;
  team_id: string;
  channel_id: string;
  user_id: string;
  user_name: string;
  command: string;
  text: string;
  response_url: string;
  trigger_id: string;
}

export interface BlockActionPayload {
  type: 'block_actions';
  trigger_id: string;
  user: { id: string; username: string };
  channel: { id: string };
  actions: Array<{
    type: string;
    action_id: string;
    block_id: string;
    value: string;
  }>;
  response_url: string;
}

export interface ViewSubmissionPayload {
  type: 'view_submission';
  user: { id: string; username: string };
  view: {
    callback_id: string;
    state: {
      values: Record<string, Record<string, { value: string | null }>>;
    };
  };
}

// ─── Slack Response Types ───────────────────────────────────────────────────

export interface SlackMessage {
  response_type?: 'ephemeral' | 'in_channel';
  text: string;
  blocks?: SlackBlock[];
  replace_original?: boolean;
}

export interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  elements?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

// ─── Service Interfaces ─────────────────────────────────────────────────────

export type SheetRow = Array<string | number | boolean | Date | null>;
export type SheetData = SheetRow[];

export interface ISheetsService {
  getAll(tabName: string): SheetData;
  appendRow(tabName: string, row: SheetRow): void;
  updateCell(tabName: string, rowIndex: number, colIndex: number, value: unknown): void;
  invalidateCache(tabName: string): void;
  invalidateAllCaches(): void;
}

export interface ISlackService {
  postToResponseUrl(responseUrl: string, message: SlackMessage): boolean;
  postToChannel(channelId: string, text: string, blocks?: SlackBlock[]): unknown;
  sendDM(slackUserId: string, text: string, blocks?: SlackBlock[]): unknown;
  openModal(triggerId: string, view: Record<string, unknown>): unknown;
  updateMessage(responseUrl: string, message: SlackMessage): void;
  getUserTimezoneOffset(slackUserId: string): number | null;
}

export interface IAuthService {
  verifyToken(payload: { token: string }): boolean;
  getRole(slackUserId: string): CallerInfo;
  requireRole(caller: CallerInfo, minimumRole: Role): CallerInfo;
  canAccessEmployee(caller: CallerInfo, targetUserId: string): boolean;
}
