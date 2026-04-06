import {
  formatDate, formatTime, parseDate, isValidDateFormat, isValidYearMonth,
  getDaysInMonth, getWeekStart, getWeekEnd, getWeekDates,
  diffHours, diffMinutes, monthsBetween,
} from '../../../src/utils/dates';

describe('Date Utilities', () => {
  describe('formatDate', () => {
    it('formats UTC date as YYYY-MM-DD', () => {
      expect(formatDate(new Date(Date.UTC(2026, 2, 15)))).toBe('2026-03-15');
    });
    it('pads single-digit month and day', () => {
      expect(formatDate(new Date(Date.UTC(2026, 0, 5)))).toBe('2026-01-05');
    });
  });

  describe('formatTime', () => {
    it('formats UTC time as HH:MM', () => {
      expect(formatTime(new Date(Date.UTC(2026, 2, 15, 9, 5)))).toBe('09:05');
    });
  });

  describe('parseDate', () => {
    it('parses valid date string', () => {
      const d = parseDate('2026-03-15');
      expect(d).not.toBeNull();
      expect(d!.getUTCFullYear()).toBe(2026);
      expect(d!.getUTCMonth()).toBe(2);
      expect(d!.getUTCDate()).toBe(15);
    });
    it('returns null for invalid date', () => {
      expect(parseDate('not-a-date')).toBeNull();
      expect(parseDate('2026-13-01')).toBeNull();
      expect(parseDate('2026-02-30')).toBeNull();
    });
  });

  describe('isValidDateFormat', () => {
    it('accepts valid dates', () => {
      expect(isValidDateFormat('2026-01-01')).toBe(true);
      expect(isValidDateFormat('2026-12-31')).toBe(true);
      expect(isValidDateFormat('2024-02-29')).toBe(true); // leap year
    });
    it('rejects invalid dates', () => {
      expect(isValidDateFormat('2026-00-01')).toBe(false);
      expect(isValidDateFormat('2026-13-01')).toBe(false);
      expect(isValidDateFormat('2026-02-29')).toBe(false); // not leap year
      expect(isValidDateFormat('2026-04-31')).toBe(false); // April has 30 days
      expect(isValidDateFormat('abc')).toBe(false);
      expect(isValidDateFormat('')).toBe(false);
      expect(isValidDateFormat('2026-1-1')).toBe(false); // missing padding
    });
  });

  describe('isValidYearMonth', () => {
    it('accepts YYYY-MM', () => {
      expect(isValidYearMonth('2026-03')).toBe(true);
    });
    it('rejects other formats', () => {
      expect(isValidYearMonth('2026-3')).toBe(false);
      expect(isValidYearMonth('2026-03-01')).toBe(false);
    });
  });

  describe('getDaysInMonth', () => {
    it('returns correct days for each month', () => {
      expect(getDaysInMonth(2026, 1)).toBe(31);
      expect(getDaysInMonth(2026, 2)).toBe(28);
      expect(getDaysInMonth(2024, 2)).toBe(29); // leap year
      expect(getDaysInMonth(2026, 4)).toBe(30);
    });
  });

  describe('getWeekStart (Monday)', () => {
    it('returns Monday for a Wednesday', () => {
      expect(getWeekStart('2026-03-25')).toBe('2026-03-23'); // Wed → Mon
    });
    it('returns same day for a Monday', () => {
      expect(getWeekStart('2026-03-23')).toBe('2026-03-23');
    });
    it('returns previous Monday for a Sunday', () => {
      expect(getWeekStart('2026-03-29')).toBe('2026-03-23');
    });
  });

  describe('getWeekEnd (Sunday)', () => {
    it('returns Sunday', () => {
      expect(getWeekEnd('2026-03-25')).toBe('2026-03-29');
    });
  });

  describe('getWeekDates', () => {
    it('returns 7 dates Mon-Sun', () => {
      const dates = getWeekDates('2026-03-25');
      expect(dates).toHaveLength(7);
      expect(dates[0]).toBe('2026-03-23'); // Monday
      expect(dates[6]).toBe('2026-03-29'); // Sunday
    });
  });

  describe('diffHours', () => {
    it('calculates hours between two dates', () => {
      const start = new Date(Date.UTC(2026, 2, 15, 9, 0));
      const end = new Date(Date.UTC(2026, 2, 15, 12, 30));
      expect(diffHours(start, end)).toBe(3.5);
    });
  });

  describe('diffMinutes', () => {
    it('calculates minutes', () => {
      const start = new Date(Date.UTC(2026, 2, 15, 9, 0));
      const end = new Date(Date.UTC(2026, 2, 15, 9, 45));
      expect(diffMinutes(start, end)).toBe(45);
    });
  });

  describe('monthsBetween', () => {
    it('calculates months between dates', () => {
      const start = new Date(Date.UTC(2026, 0, 1));
      const end = new Date(Date.UTC(2026, 5, 1));
      expect(monthsBetween(start, end)).toBe(5);
    });
    it('handles year boundary', () => {
      const start = new Date(Date.UTC(2025, 10, 1));
      const end = new Date(Date.UTC(2026, 2, 1));
      expect(monthsBetween(start, end)).toBe(4);
    });
  });
});
