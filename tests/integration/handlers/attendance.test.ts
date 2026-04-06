import { handleClockIn, handleClockOut, handleBreakStart, handleBreakEnd, handleStatus } from '../../../src/handlers/attendance';
import { createMockSheetsService, createMockSlackService } from '../../mocks/gas-mocks';
import { TABS, EVT } from '../../../src/config';
import { buildEventsData, makeEvent, EMPTY_EVENTS } from '../../fixtures/events';
import type { CallerInfo } from '../../../src/types';

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

function makeDeps(eventsData = EMPTY_EVENTS) {
  const sheets = createMockSheetsService({ [TABS.EVENTS]: [...eventsData.map(r => [...r])] });
  const slack = createMockSlackService();
  return { sheetsService: sheets, slackService: slack, sheets, slack };
}

describe('Attendance Handler', () => {
  describe('handleClockIn', () => {
    it('appends IN event when IDLE', () => {
      const deps = makeDeps();
      const result = handleClockIn(CALLER, deps);
      expect(result.text).toContain('Clocked in');
      expect(result.response_type).toBe('in_channel');
      expect(result.text).toContain('Alex Dev');
      expect(deps.sheets._appendedRows[TABS.EVENTS]).toHaveLength(1);
      expect(deps.sheets._appendedRows[TABS.EVENTS][0][3]).toBe('IN');
    });

    it('rejects when already clocked in', () => {
      const events = buildEventsData(
        makeEvent('2026-03-28T00:00:00Z', 'EMP002', 'Alex Dev', 'IN'),
      );
      const deps = makeDeps(events);
      const result = handleClockIn(CALLER, deps);
      expect(result.text).toContain('Already clocked in');
    });

    it('rejects when on break', () => {
      const events = buildEventsData(
        makeEvent('2026-03-28T00:00:00Z', 'EMP002', 'Alex Dev', 'IN'),
        makeEvent('2026-03-28T01:00:00Z', 'EMP002', 'Alex Dev', 'BREAK_START'),
      );
      const deps = makeDeps(events);
      const result = handleClockIn(CALLER, deps);
      expect(result.text).toContain('Already clocked in');
    });
  });

  describe('handleClockOut', () => {
    it('appends OUT event and shows hours when CLOCKED_IN', () => {
      const events = buildEventsData(
        makeEvent('2026-03-28T00:00:00Z', 'EMP002', 'Alex Dev', 'IN'),
      );
      const deps = makeDeps(events);
      const result = handleClockOut(CALLER, deps);
      expect(result.text).toContain('Clocked out');
      expect(deps.sheets._appendedRows[TABS.EVENTS]).toHaveLength(1);
      expect(deps.sheets._appendedRows[TABS.EVENTS][0][3]).toBe('OUT');
    });

    it('rejects when IDLE', () => {
      const deps = makeDeps();
      const result = handleClockOut(CALLER, deps);
      expect(result.text).toContain("haven't clocked in");
    });

    it('rejects when ON_BREAK', () => {
      const events = buildEventsData(
        makeEvent('2026-03-28T00:00:00Z', 'EMP002', 'Alex Dev', 'IN'),
        makeEvent('2026-03-28T01:00:00Z', 'EMP002', 'Alex Dev', 'BREAK_START'),
      );
      const deps = makeDeps(events);
      const result = handleClockOut(CALLER, deps);
      expect(result.text).toContain('/back first');
    });

    it('clock out response is public with name', () => {
      const events = buildEventsData(
        makeEvent('2026-03-28T00:00:00Z', 'EMP002', 'Alex Dev', 'IN'),
      );
      const deps = makeDeps(events);
      const result = handleClockOut(CALLER, deps);
      expect(result.response_type).toBe('in_channel');
      expect(result.text).toContain('Alex Dev');
      expect(result.text).toContain('Clocked out');
    });
  });

  describe('handleBreakStart', () => {
    it('appends BREAK_START when CLOCKED_IN', () => {
      const events = buildEventsData(
        makeEvent('2026-03-28T00:00:00Z', 'EMP002', 'Alex Dev', 'IN'),
      );
      const deps = makeDeps(events);
      const result = handleBreakStart(CALLER, deps);
      expect(result.text).toContain('Break started');
      expect(deps.sheets._appendedRows[TABS.EVENTS][0][3]).toBe('BREAK_START');
    });

    it('rejects when IDLE', () => {
      const deps = makeDeps();
      const result = handleBreakStart(CALLER, deps);
      expect(result.text).toContain('Clock in first');
    });

    it('rejects when already ON_BREAK', () => {
      const events = buildEventsData(
        makeEvent('2026-03-28T00:00:00Z', 'EMP002', 'Alex Dev', 'IN'),
        makeEvent('2026-03-28T01:00:00Z', 'EMP002', 'Alex Dev', 'BREAK_START'),
      );
      const deps = makeDeps(events);
      const result = handleBreakStart(CALLER, deps);
      expect(result.text).toContain('Already on break');
    });
  });

  describe('handleBreakEnd', () => {
    it('appends BREAK_END when ON_BREAK', () => {
      const events = buildEventsData(
        makeEvent('2026-03-28T00:00:00Z', 'EMP002', 'Alex Dev', 'IN'),
        makeEvent('2026-03-28T01:00:00Z', 'EMP002', 'Alex Dev', 'BREAK_START'),
      );
      const deps = makeDeps(events);
      const result = handleBreakEnd(CALLER, deps);
      expect(result.text).toContain('Welcome back');
      expect(deps.sheets._appendedRows[TABS.EVENTS][0][3]).toBe('BREAK_END');
    });

    it('rejects when IDLE', () => {
      const deps = makeDeps();
      const result = handleBreakEnd(CALLER, deps);
      expect(result.text).toContain('not on a break');
    });

    it('rejects when CLOCKED_IN (not on break)', () => {
      const events = buildEventsData(
        makeEvent('2026-03-28T00:00:00Z', 'EMP002', 'Alex Dev', 'IN'),
      );
      const deps = makeDeps(events);
      const result = handleBreakEnd(CALLER, deps);
      expect(result.text).toContain('not on a break');
    });
  });

  describe('handleStatus', () => {
    it('shows "Not clocked in" when IDLE', () => {
      const deps = makeDeps();
      const result = handleStatus(CALLER, deps);
      expect(result.text).toContain('Not clocked in');
      expect(result.response_type).toBe('ephemeral');
    });

    it('shows working status when CLOCKED_IN', () => {
      const events = buildEventsData(
        makeEvent(new Date(Date.now() - 60000).toISOString(), 'EMP002', 'Alex Dev', 'IN'),
      );
      const deps = makeDeps(events);
      const result = handleStatus(CALLER, deps);
      expect(result.text).toContain('Working');
    });

    it('shows break status when ON_BREAK', () => {
      const events = buildEventsData(
        makeEvent(new Date(Date.now() - 120000).toISOString(), 'EMP002', 'Alex Dev', 'IN'),
        makeEvent(new Date(Date.now() - 60000).toISOString(), 'EMP002', 'Alex Dev', 'BREAK_START'),
      );
      const deps = makeDeps(events);
      const result = handleStatus(CALLER, deps);
      expect(result.text).toContain('break');
    });
  });

  describe('Full attendance flow', () => {
    it('/in → /break → /back → /out full cycle', () => {
      const deps = makeDeps();

      // Clock in
      const r1 = handleClockIn(CALLER, deps);
      expect(r1.text).toContain('Clocked in');

      // Start break
      const r2 = handleBreakStart(CALLER, deps);
      expect(r2.text).toContain('Break started');

      // End break
      const r3 = handleBreakEnd(CALLER, deps);
      expect(r3.text).toContain('Welcome back');

      // Clock out
      const r4 = handleClockOut(CALLER, deps);
      expect(r4.text).toContain('Clocked out');

      // Verify 4 events appended
      expect(deps.sheets._appendedRows[TABS.EVENTS]).toHaveLength(4);
      const actions = deps.sheets._appendedRows[TABS.EVENTS].map(r => r[EVT.ACTION]);
      expect(actions).toEqual(['IN', 'BREAK_START', 'BREAK_END', 'OUT']);
    });

    it('/in → /out → /in → /out multiple sessions', () => {
      const deps = makeDeps();

      handleClockIn(CALLER, deps);
      handleClockOut(CALLER, deps);
      handleClockIn(CALLER, deps);
      handleClockOut(CALLER, deps);

      expect(deps.sheets._appendedRows[TABS.EVENTS]).toHaveLength(4);
      const actions = deps.sheets._appendedRows[TABS.EVENTS].map(r => r[EVT.ACTION]);
      expect(actions).toEqual(['IN', 'OUT', 'IN', 'OUT']);
    });

    it('all 4 attendance responses are public (in_channel) with employee name', () => {
      const deps = makeDeps();
      const r1 = handleClockIn(CALLER, deps);
      const r2 = handleBreakStart(CALLER, deps);
      const r3 = handleBreakEnd(CALLER, deps);
      const r4 = handleClockOut(CALLER, deps);

      for (const r of [r1, r2, r3, r4]) {
        expect(r.response_type).toBe('in_channel');
        expect(r.text).toContain('Alex Dev');
      }
    });

    it('events tab is append-only (no deletes/edits)', () => {
      const deps = makeDeps();
      handleClockIn(CALLER, deps);
      handleClockOut(CALLER, deps);

      // Verify only appendRow was called, not updateCell
      expect(deps.sheetsService.appendRow).toHaveBeenCalledTimes(2);
      expect(deps.sheetsService.updateCell).not.toHaveBeenCalled();
    });
  });
});
