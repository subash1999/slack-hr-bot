/**
 * Date utilities — timezone-aware conversion, week/month helpers, date math.
 * All pure functions, no GAS dependencies.
 * Default timezone: NST (Nepal Standard Time, UTC+5:45).
 * Per-employee timezone offset can be passed to override the default.
 */

import { DEFAULT_TZ_OFFSET_MS } from '../config';

export function todayLocal(tzOffsetMs: number = DEFAULT_TZ_OFFSET_MS): string {
  return formatDate(toLocalTZ(new Date(), tzOffsetMs));
}

export function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatTime(date: Date): string {
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function parseDate(dateStr: string): Date | null {
  if (!isValidDateFormat(dateStr)) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function isValidDateFormat(str: string): boolean {
  if (typeof str !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [year, month, day] = str.split('-').map(Number);
  if (month < 1 || month > 12) return false;
  const maxDay = getDaysInMonth(year, month);
  return day >= 1 && day <= maxDay;
}

export function isValidYearMonth(str: string): boolean {
  if (typeof str !== 'string') return false;
  return /^\d{4}-\d{2}$/.test(str);
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function getWeekStart(dateStr: string): string | null {
  const d = parseDate(dateStr);
  if (!d) return null;
  const dayOfWeek = d.getUTCDay();
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return formatDate(d);
}

export function getWeekEnd(dateStr: string): string | null {
  const start = getWeekStart(dateStr);
  if (start === null || start === '') return null;
  const d = parseDate(start)!;
  d.setUTCDate(d.getUTCDate() + 6);
  return formatDate(d);
}

export function getWeekDates(dateStr: string): string[] {
  const start = getWeekStart(dateStr);
  if (start === null || start === '') return [];
  const d = parseDate(start)!;
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    dates.push(formatDate(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

export function diffHours(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
}

export function diffMinutes(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / (1000 * 60);
}

/**
 * Convert a UTC Date to a local timezone Date (for display/date-resolution).
 * The returned Date's UTC fields represent the local time.
 */
export function toLocalTZ(date: Date, tzOffsetMs: number = DEFAULT_TZ_OFFSET_MS): Date {
  return new Date(date.getTime() + tzOffsetMs);
}

/**
 * Get the date string (YYYY-MM-DD) for a timestamp in the given timezone.
 * Used for attributing clock events to the correct day.
 */
export function getDateOfTimestamp(timestamp: Date, tzOffsetMs: number = DEFAULT_TZ_OFFSET_MS): string {
  const local = toLocalTZ(timestamp, tzOffsetMs);
  return formatDate(local);
}

export function monthsBetween(startDate: Date, endDate: Date): number {
  return (
    (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
    (endDate.getUTCMonth() - startDate.getUTCMonth())
  );
}

export function addDays(dateStr: string, days: number): string {
  const d = parseDate(dateStr);
  if (!d) return dateStr;
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}
