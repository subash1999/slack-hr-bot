import { handleFixSubmit, handleFixApproval } from '../../../src/handlers/fix';
import { validateHistoricalFix } from '../../../src/core/fix';
import { createMockSheetsService, createMockSlackService } from '../../mocks/gas-mocks';
import { TABS, FIX_REQ, EVT, STATUS, ACTIONS, EVENT_SOURCES } from '../../../src/config';
import { buildEventsData, makeEvent, EMPTY_EVENTS } from '../../fixtures/events';
import { buildEmployeesData, MANAGER_ROW, EMPLOYEE_ROW } from '../../fixtures/employees';
import type { CallerInfo, SheetData } from '../../../src/types';

// Use a fixed "today" so date comparisons are deterministic
const MOCK_TODAY = '2026-03-28';
jest.mock('../../../src/utils/dates', () => {
  const actual = jest.requireActual<typeof import('../../../src/utils/dates')>('../../../src/utils/dates');
  return {
    ...actual,
    todayLocal: (): string => MOCK_TODAY,
  };
});

const FIX_REQUESTS_HEADER: SheetData[0] = [
  'id', 'user_id', 'target_date', 'target_time', 'proposed_action',
  'reason', 'status', 'requested_at', 'reviewed_by', 'reviewed_at', 'response_url',
];

const EMPTY_FIX_REQUESTS: SheetData = [FIX_REQUESTS_HEADER];

const MONTHLY_SUMMARY_HEADER: SheetData[0] = [
  'user_id', 'year_month', 'worked_hours', 'paid_leave_hours',
  'total_hours', 'required_hours', 'deficit', 'bank_offset',
  'effective_deficit', 'flag_status',
];

const CALLER: CallerInfo = {
  user_id: 'EMP002',
  slack_id: 'UEMP001',
  name: 'Alex Dev',
  email: 'alex@example.com',
  role: 'employee',
  position: 'Full Time Developer',
  manager_id: 'EMP001',
  is_admin: false,
  status: 'ACTIVE',
  salary: 350000,
  join_date: '2026-02-01',
  leave_balance: 3,
  rowIndex: 3,
};

function makeDeps(
  eventsData: SheetData = EMPTY_EVENTS,
  fixRequestsData: SheetData = [...EMPTY_FIX_REQUESTS.map(r => [...r])],
  employeesData: SheetData = buildEmployeesData(MANAGER_ROW, EMPLOYEE_ROW),
) {
  const sheets = createMockSheetsService({
    [TABS.EVENTS]: [...eventsData.map(r => [...r])],
    [TABS.FIX_REQUESTS]: fixRequestsData,
    [TABS.EMPLOYEES]: [...employeesData.map(r => [...r])],
    [TABS.MONTHLY_SUMMARY]: [[...MONTHLY_SUMMARY_HEADER]],
    [TABS.LEAVE_REQUESTS]: [['id', 'user_id', 'date', 'type', 'status', 'requested_at', 'approved_by', 'approved_at', 'notes']],
    [TABS.PRE_APPROVALS]: [['id', 'user_id', 'date', 'type', 'credit_hours', 'approved_by', 'approved_at', 'reason']],
    [TABS.POSITIONS]: [['position', 'policy_group', 'description'], ['Full Time Developer', 'FULL_TIME', 'Dev']],
    [TABS.POLICIES]: [['policy_group', 'min_daily', 'min_weekly', 'min_monthly', 'description'], ['FULL_TIME', 3, 30, 160, 'Full time']],
    [TABS.OVERRIDES]: [['user_id', 'period_type', 'period_value', 'required_hours', 'reason', 'approved_by', 'plan_id']],
  });
  const slack = createMockSlackService();
  return { sheetsService: sheets, slackService: slack, sheets, slack };
}

describe('Fix Handler', () => {
  describe('handleFixSubmit', () => {
    it('creates PENDING row, DMs manager, returns success for valid fix', () => {
      // Employee was clocked in on 2026-03-27 but forgot to clock out
      const events = buildEventsData(
        makeEvent('2026-03-27T03:00:00.000Z', 'EMP002', 'Alex Dev', 'IN'),
      );
      const deps = makeDeps(events);

      const result = handleFixSubmit(CALLER, '2026-03-27 09:00 ADD_OUT forgot to clock out', deps);

      expect(result.response_type).toBe('ephemeral');
      expect(result.text).toContain('Fix request');
      expect(result.text).toContain('submitted');

      // FixRequests row created
      expect(deps.sheets._appendedRows[TABS.FIX_REQUESTS]).toHaveLength(1);
      const row = deps.sheets._appendedRows[TABS.FIX_REQUESTS][0];
      expect(row[FIX_REQ.USER_ID]).toBe('EMP002');
      expect(row[FIX_REQ.TARGET_DATE]).toBe('2026-03-27');
      expect(row[FIX_REQ.TARGET_TIME]).toBe('09:00');
      expect(row[FIX_REQ.PROPOSED_ACTION]).toBe('ADD_OUT');
      expect(row[FIX_REQ.STATUS]).toBe(STATUS.PENDING);
      expect(row[FIX_REQ.REASON]).toBe('forgot to clock out');

      // Manager was DM'd
      expect(deps.slack._calls.sendDM).toHaveLength(1);
      expect(deps.slack._calls.sendDM[0].userId).toBe('UMGR001');
      expect(deps.slack._calls.sendDM[0].text).toContain('Fix request');
    });

    it('rejects future date', () => {
      const deps = makeDeps();
      const result = handleFixSubmit(CALLER, '2026-03-29 09:00 ADD_IN late', deps);

      expect(result.text).toContain('past dates');
    });

    it('rejects today', () => {
      const deps = makeDeps();
      const result = handleFixSubmit(CALLER, '2026-03-28 09:00 ADD_IN late', deps);

      expect(result.text).toContain('past dates');
    });

    it('rejects invalid action type', () => {
      const deps = makeDeps();
      const result = handleFixSubmit(CALLER, '2026-03-27 09:00 INVALID_ACTION reason', deps);

      expect(result.text).toContain('Invalid action');
    });

    it('rejects invalid date format', () => {
      const deps = makeDeps();
      const result = handleFixSubmit(CALLER, '27-03-2026 09:00 ADD_IN reason', deps);

      expect(result.text).toContain('Invalid date');
    });

    it('rejects invalid time format', () => {
      const deps = makeDeps();
      const result = handleFixSubmit(CALLER, '2026-03-27 9am ADD_IN reason', deps);

      expect(result.text).toContain('Invalid time');
    });

    it('rejects missing arguments', () => {
      const deps = makeDeps();
      const result = handleFixSubmit(CALLER, '2026-03-27', deps);

      expect(result.text).toContain('Usage');
    });

    it('validates historical state transition — rejects ADD_OUT when not clocked in', () => {
      // No events on 2026-03-27 — employee was IDLE
      const events = buildEventsData();
      const deps = makeDeps(events);

      const result = handleFixSubmit(CALLER, '2026-03-27 09:00 ADD_OUT reason', deps);

      expect(result.text).toContain('Invalid state transition');
    });

    it('validates historical state transition — rejects ADD_BREAK_START when IDLE', () => {
      const events = buildEventsData();
      const deps = makeDeps(events);

      const result = handleFixSubmit(CALLER, '2026-03-27 09:00 ADD_BREAK_START reason', deps);

      expect(result.text).toContain('Invalid state transition');
    });
  });

  describe('handleFixApproval', () => {
    it('approves fix: appends event with MANUAL_FIX source, updates status', () => {
      // Set up: employee clocked in but forgot to clock out
      const events = buildEventsData(
        makeEvent('2026-03-27T03:00:00.000Z', 'EMP002', 'Alex Dev', 'IN'),
      );

      const fixReqs: SheetData = [
        [...FIX_REQUESTS_HEADER],
        [
          'FRQ0001', 'EMP002', '2026-03-27', '09:00', 'ADD_OUT',
          'forgot', STATUS.PENDING, '2026-03-28T00:00:00Z', '', '', '',
        ],
      ];

      const deps = makeDeps(events, fixReqs);
      const result = handleFixApproval('EMP001', 'FRQ0001', true, deps);

      expect(result.text).toContain('approved');

      // Event appended with MANUAL_FIX source
      const appendedEvents = deps.sheets._appendedRows[TABS.EVENTS];
      expect(appendedEvents).toBeDefined();
      expect(appendedEvents.length).toBeGreaterThanOrEqual(1);

      const fixEvent = appendedEvents[0];
      expect(fixEvent[EVT.USER_ID]).toBe('EMP002');
      expect(fixEvent[EVT.ACTION]).toBe(ACTIONS.OUT);
      expect(fixEvent[EVT.SOURCE]).toBe(EVENT_SOURCES.MANUAL_FIX);
      expect(fixEvent[EVT.TIMESTAMP]).toBe('2026-03-27T09:00:00.000Z');

      // FixRequests status updated
      const updatedRow = deps.sheets._tabData[TABS.FIX_REQUESTS][1];
      expect(updatedRow[FIX_REQ.STATUS]).toBe(STATUS.APPROVED);
      expect(updatedRow[FIX_REQ.REVIEWED_BY]).toBe('EMP001');

      // Employee notified
      const empDMs = deps.slack._calls.sendDM.filter(dm => dm.userId === 'UEMP001');
      expect(empDMs.length).toBeGreaterThanOrEqual(1);
      expect(empDMs[0].text).toContain('approved');
    });

    it('rejects fix: updates FixRequests status, notifies employee', () => {
      const fixReqs: SheetData = [
        [...FIX_REQUESTS_HEADER],
        [
          'FRQ0001', 'EMP002', '2026-03-27', '09:00', 'ADD_OUT',
          'forgot', STATUS.PENDING, '2026-03-28T00:00:00Z', '', '', '',
        ],
      ];

      const deps = makeDeps(EMPTY_EVENTS, fixReqs);
      const result = handleFixApproval('EMP001', 'FRQ0001', false, deps);

      expect(result.text).toContain('rejected');

      // Status updated to REJECTED
      const updatedRow = deps.sheets._tabData[TABS.FIX_REQUESTS][1];
      expect(updatedRow[FIX_REQ.STATUS]).toBe(STATUS.REJECTED);

      // No events appended
      expect(deps.sheets._appendedRows[TABS.EVENTS]).toBeUndefined();

      // Employee notified
      const empDMs = deps.slack._calls.sendDM.filter(dm => dm.userId === 'UEMP001');
      expect(empDMs.length).toBeGreaterThanOrEqual(1);
      expect(empDMs[0].text).toContain('rejected');
    });

    it('CANCEL fix: appends VOID event', () => {
      // Employee clocked in at 09:00 on 2026-03-27 by mistake
      const events = buildEventsData(
        makeEvent('2026-03-27T03:00:00.000Z', 'EMP002', 'Alex Dev', 'IN'),
      );

      const fixReqs: SheetData = [
        [...FIX_REQUESTS_HEADER],
        [
          'FRQ0001', 'EMP002', '2026-03-27', '03:00', 'CANCEL',
          'accidental clock in', STATUS.PENDING, '2026-03-28T00:00:00Z', '', '', '',
        ],
      ];

      const deps = makeDeps(events, fixReqs);
      const result = handleFixApproval('EMP001', 'FRQ0001', true, deps);

      expect(result.text).toContain('approved');

      // VOID event appended
      const appendedEvents = deps.sheets._appendedRows[TABS.EVENTS];
      expect(appendedEvents).toBeDefined();
      const voidEvent = appendedEvents[0];
      expect(voidEvent[EVT.ACTION]).toBe(ACTIONS.VOID);
      expect(voidEvent[EVT.SOURCE]).toBe(EVENT_SOURCES.MANUAL_FIX);
    });

    it('rejects already-processed fix request', () => {
      const fixReqs: SheetData = [
        [...FIX_REQUESTS_HEADER],
        [
          'FRQ0001', 'EMP002', '2026-03-27', '09:00', 'ADD_OUT',
          'forgot', STATUS.APPROVED, '2026-03-28T00:00:00Z', 'EMP001', '2026-03-28T01:00:00Z', '',
        ],
      ];

      const deps = makeDeps(EMPTY_EVENTS, fixReqs);
      const result = handleFixApproval('EMP001', 'FRQ0001', true, deps);

      expect(result.text).toContain('already');
    });

    it('rejects non-existent fix request', () => {
      const deps = makeDeps();
      const result = handleFixApproval('EMP001', 'FRQ9999', true, deps);

      expect(result.text).toContain('not found');
    });
  });

  describe('validateHistoricalFix', () => {
    it('allows ADD_OUT when clocked in at that time', () => {
      const events = buildEventsData(
        makeEvent('2026-03-27T03:00:00.000Z', 'EMP002', 'Alex Dev', 'IN'),
      );

      const result = validateHistoricalFix(events, 'EMP002', '2026-03-27', '09:00', 'ADD_OUT');
      expect(result.valid).toBe(true);
    });

    it('rejects ADD_OUT when not clocked in', () => {
      const events = buildEventsData();

      const result = validateHistoricalFix(events, 'EMP002', '2026-03-27', '09:00', 'ADD_OUT');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid state transition');
    });

    it('allows ADD_IN when IDLE', () => {
      const events = buildEventsData();

      const result = validateHistoricalFix(events, 'EMP002', '2026-03-27', '09:00', 'ADD_IN');
      expect(result.valid).toBe(true);
    });

    it('rejects ADD_IN when already clocked in', () => {
      const events = buildEventsData(
        makeEvent('2026-03-27T03:00:00.000Z', 'EMP002', 'Alex Dev', 'IN'),
      );

      const result = validateHistoricalFix(events, 'EMP002', '2026-03-27', '04:00', 'ADD_IN');
      expect(result.valid).toBe(false);
    });

    it('allows ADD_BREAK_START when clocked in', () => {
      const events = buildEventsData(
        makeEvent('2026-03-27T03:00:00.000Z', 'EMP002', 'Alex Dev', 'IN'),
      );

      const result = validateHistoricalFix(events, 'EMP002', '2026-03-27', '05:00', 'ADD_BREAK_START');
      expect(result.valid).toBe(true);
    });

    it('allows CANCEL when event exists at timestamp', () => {
      const events = buildEventsData(
        makeEvent('2026-03-27T03:00:00.000Z', 'EMP002', 'Alex Dev', 'IN'),
      );

      const result = validateHistoricalFix(events, 'EMP002', '2026-03-27', '03:00', 'CANCEL');
      expect(result.valid).toBe(true);
    });

    it('rejects CANCEL when no event at timestamp', () => {
      const events = buildEventsData(
        makeEvent('2026-03-27T03:00:00.000Z', 'EMP002', 'Alex Dev', 'IN'),
      );

      const result = validateHistoricalFix(events, 'EMP002', '2026-03-27', '05:00', 'CANCEL');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('No event found');
    });

    it('rejects insertion that would break subsequent events', () => {
      // IN at 03:00, OUT at 09:00 — inserting OUT at 05:00 would break sequence
      const events = buildEventsData(
        makeEvent('2026-03-27T03:00:00.000Z', 'EMP002', 'Alex Dev', 'IN'),
        makeEvent('2026-03-27T09:00:00.000Z', 'EMP002', 'Alex Dev', 'OUT'),
      );

      const result = validateHistoricalFix(events, 'EMP002', '2026-03-27', '05:00', 'ADD_OUT');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('break the subsequent');
    });
  });
});
