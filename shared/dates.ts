import type { DeadlineStatus } from "./types";

export const REGISTRATION_WINDOW_DAYS = 90;
const MS_PER_DAY = 86_400_000;

/** Pulls the YYYY-MM-DD calendar date out of a date or datetime ISO string. */
function calendarPart(iso: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) throw new Error(`Invalid ISO date: ${iso}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** UTC midnight epoch ms for the calendar date embedded in an ISO string. */
function utcMidnight(iso: string): number {
  const { y, m, d } = calendarPart(iso);
  return Date.UTC(y, m - 1, d);
}

/** Today's calendar date (UTC) as YYYY-MM-DD. Server clock is authoritative and timezone-independent. */
export function todayDateString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Adds calendar days (not 24h periods) to an ISO date/datetime string, returning YYYY-MM-DD. */
export function addCalendarDays(iso: string, days: number): string {
  const ms = utcMidnight(iso) + days * MS_PER_DAY;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Whole calendar days between two ISO date/datetime strings (to - from). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((utcMidnight(toIso) - utcMidnight(fromIso)) / MS_PER_DAY);
}

export function deadlineStatusFromDays(daysRemaining: number): DeadlineStatus {
  if (daysRemaining < 0) return "expired";
  if (daysRemaining <= 7) return "urgent";
  if (daysRemaining <= 30) return "amber";
  return "neutral";
}

export interface DeadlineInfo {
  registrationDeadline: string;
  daysRemaining: number;
  status: DeadlineStatus;
}

/** Computes the 90-day registration deadline from a publication date. */
export function computeDeadline(publicationDateIso: string, now: Date = new Date()): DeadlineInfo {
  const registrationDeadline = addCalendarDays(publicationDateIso, REGISTRATION_WINDOW_DAYS);
  const daysRemaining = daysBetween(todayDateString(now), registrationDeadline);
  return { registrationDeadline, daysRemaining, status: deadlineStatusFromDays(daysRemaining) };
}

/** Earliest of a set of publication dates, or null if the list is empty. */
export function earliestDate(dates: string[]): string | null {
  if (dates.length === 0) return null;
  return dates.reduce((earliest, current) => (utcMidnight(current) < utcMidnight(earliest) ? current : earliest));
}
