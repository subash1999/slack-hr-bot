import { getClockState, validateTransition, isDuplicateEvent, getDailyHours } from '../../../src/core/attendance';
import { buildEventsData, makeEvent, EMPTY_EVENTS } from '../../fixtures/events';

const USER = 'EMP002';
const NAME = 'Alex Dev';

describe('Attendance State Machine', () => {
  describe('getClockState', () => {
    it('returns IDLE when no events', () => {
      const result = getClockState(EMPTY_EVENTS, USER);
      expect(result.state).toBe('IDLE');
      expect(result.since).toBeNull();
    });

    it('returns IDLE after OUT', () => {
      const events = buildEventsData(
        makeEvent('2026-03-28T00:00:00Z', USER, NAME, 'IN'),
        makeEvent('2026-03-28T03:00:00Z', USER, NAME, 'OUT'),
      );
      expect(getClockState(events, USER).state).toBe('IDLE');
    });

    it('returns CLOCKED_IN after IN', () => {
      const events = buildEventsData(
        makeEvent('2026-03-28T00:00:00Z', USER, NAME, 'IN'),
      );
      const result = getClockState(events, USER);
      expect(result.state).toBe('CLOCKED_IN');
      expect(result.since).toEqual(new Date('2026-03-28T00:00:00Z'));
    });

    it('returns CLOCKED_IN after BREAK_END', () => {
      const events = buildEventsData(
        makeEvent('2026-03-28T00:00:00Z', USER, NAME, 'IN'),
        makeEvent('2026-03-28T01:00:00Z', USER, NAME, 'BREAK_START'),
        makeEvent('2026-03-28T01:15:00Z', USER, NAME, 'BREAK_END'),
      );
      expect(getClockState(events, USER).state).toBe('CLOCKED_IN');
    });

    it('returns ON_BREAK after BREAK_START', () => {
      const events = buildEventsData(
        makeEvent('2026-03-28T00:00:00Z', USER, NAME, 'IN'),
        makeEvent('2026-03-28T01:00:00Z', USER, NAME, 'BREAK_START'),
      );
      const result = getClockState(events, USER);
      expect(result.state).toBe('ON_BREAK');
    });

    it('only considers the specified user', () => {
      const events = buildEventsData(
        makeEvent('2026-03-28T00:00:00Z', 'EMP999', 'Other', 'IN'),
      );
      expect(getClockState(events, USER).state).toBe('IDLE');
    });
  });

  describe('validateTransition — all 12 scenarios', () => {
    const since = new Date('2026-03-28T09:00:00Z');

    // IDLE transitions
    it('IDLE + IN → valid', () => {
      expect(validateTransition('IDLE', 'IN', null)).toBeNull();
    });
    it('IDLE + OUT → error', () => {
      expect(validateTransition('IDLE', 'OUT', null)).toContain("haven't clocked in");
    });
    it('IDLE + BREAK_START → error', () => {
      expect(validateTransition('IDLE', 'BREAK_START', null)).toContain('Clock in first');
    });
    it('IDLE + BREAK_END → error', () => {
      expect(validateTransition('IDLE', 'BREAK_END', null)).toContain('not on a break');
    });

    // CLOCKED_IN transitions
    it('CLOCKED_IN + IN → error with time', () => {
      const err = validateTransition('CLOCKED_IN', 'IN', since);
      expect(err).toContain('Already clocked in');
      expect(err).toContain('09:00');
    });
    it('CLOCKED_IN + OUT → valid', () => {
      expect(validateTransition('CLOCKED_IN', 'OUT', since)).toBeNull();
    });
    it('CLOCKED_IN + BREAK_START → valid', () => {
      expect(validateTransition('CLOCKED_IN', 'BREAK_START', since)).toBeNull();
    });
    it('CLOCKED_IN + BREAK_END → error', () => {
      expect(validateTransition('CLOCKED_IN', 'BREAK_END', since)).toContain('not on a break');
    });

    // ON_BREAK transitions
    it('ON_BREAK + IN → error', () => {
      expect(validateTransition('ON_BREAK', 'IN', since)).toContain('Already clocked in');
    });
    it('ON_BREAK + OUT → error', () => {
      expect(validateTransition('ON_BREAK', 'OUT', since)).toContain('/back first');
    });
    it('ON_BREAK + BREAK_START → error with time', () => {
      const err = validateTransition('ON_BREAK', 'BREAK_START', since);
      expect(err).toContain('Already on break');
      expect(err).toContain('09:00');
    });
    it('ON_BREAK + BREAK_END → valid', () => {
      expect(validateTransition('ON_BREAK', 'BREAK_END', since)).toBeNull();
    });
  });

  describe('isDuplicateEvent', () => {
    it('detects duplicate within 60 seconds', () => {
      const events = buildEventsData(
        makeEvent('2026-03-28T09:00:00.000Z', USER, NAME, 'IN'),
      );
      const now = new Date('2026-03-28T09:00:30.000Z'); // 30 seconds later
      expect(isDuplicateEvent(events, USER, 'IN', now)).toBe(true);
    });

    it('allows same action after 60 seconds', () => {
      const events = buildEventsData(
        makeEvent('2026-03-28T09:00:00.000Z', USER, NAME, 'IN'),
      );
      const now = new Date('2026-03-28T09:01:01.000Z'); // 61 seconds later
      expect(isDuplicateEvent(events, USER, 'IN', now)).toBe(false);
    });

    it('does not flag different action type', () => {
      const events = buildEventsData(
        makeEvent('2026-03-28T09:00:00.000Z', USER, NAME, 'IN'),
      );
      const now = new Date('2026-03-28T09:00:10.000Z');
      expect(isDuplicateEvent(events, USER, 'OUT', now)).toBe(false);
    });
  });

  describe('getDailyHours', () => {
    it('calculates single session hours', () => {
      // IN at 00:00 UTC (09:00 JST), OUT at 03:00 UTC (12:00 JST)
      const events = buildEventsData(
        makeEvent('2026-03-28T00:00:00Z', USER, NAME, 'IN'),
        makeEvent('2026-03-28T03:00:00Z', USER, NAME, 'OUT'),
      );
      const result = getDailyHours(events, USER, '2026-03-28');
      expect(result.netHours).toBe(3);
      expect(result.sessions).toHaveLength(1);
      expect(result.totalBreak).toBe(0);
    });

    it('deducts break time', () => {
      // 3h session with 15min break = 2h45m net
      const events = buildEventsData(
        makeEvent('2026-03-28T00:00:00Z', USER, NAME, 'IN'),
        makeEvent('2026-03-28T01:00:00Z', USER, NAME, 'BREAK_START'),
        makeEvent('2026-03-28T01:15:00Z', USER, NAME, 'BREAK_END'),
        makeEvent('2026-03-28T03:00:00Z', USER, NAME, 'OUT'),
      );
      const result = getDailyHours(events, USER, '2026-03-28');
      expect(result.totalWorked).toBe(3);
      expect(result.totalBreak).toBe(0.25); // 15 min
      expect(result.netHours).toBe(2.75);
    });

    it('handles multiple breaks', () => {
      // 4h session, two 15min breaks = 3h30m net
      const events = buildEventsData(
        makeEvent('2026-03-28T00:00:00Z', USER, NAME, 'IN'),
        makeEvent('2026-03-28T01:00:00Z', USER, NAME, 'BREAK_START'),
        makeEvent('2026-03-28T01:15:00Z', USER, NAME, 'BREAK_END'),
        makeEvent('2026-03-28T02:00:00Z', USER, NAME, 'BREAK_START'),
        makeEvent('2026-03-28T02:15:00Z', USER, NAME, 'BREAK_END'),
        makeEvent('2026-03-28T04:00:00Z', USER, NAME, 'OUT'),
      );
      const result = getDailyHours(events, USER, '2026-03-28');
      expect(result.totalWorked).toBe(4);
      expect(result.totalBreak).toBe(0.5);
      expect(result.netHours).toBe(3.5);
    });

    it('handles multiple sessions in one day', () => {
      // Session 1: 2h, Session 2: 1.5h = 3.5h total
      const events = buildEventsData(
        makeEvent('2026-03-28T00:00:00Z', USER, NAME, 'IN'),
        makeEvent('2026-03-28T02:00:00Z', USER, NAME, 'OUT'),
        makeEvent('2026-03-28T05:00:00Z', USER, NAME, 'IN'),
        makeEvent('2026-03-28T06:30:00Z', USER, NAME, 'OUT'),
      );
      const result = getDailyHours(events, USER, '2026-03-28');
      expect(result.sessions).toHaveLength(2);
      expect(result.netHours).toBeCloseTo(3.5, 1);
    });

    it('returns zero for day with no events', () => {
      const result = getDailyHours(EMPTY_EVENTS, USER, '2026-03-28');
      expect(result.netHours).toBe(0);
      expect(result.sessions).toHaveLength(0);
    });

    it('handles open session (no OUT yet)', () => {
      const events = buildEventsData(
        makeEvent('2026-03-28T00:00:00Z', USER, NAME, 'IN'),
      );
      const result = getDailyHours(events, USER, '2026-03-28');
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].end).toBeNull();
    });
  });
});
