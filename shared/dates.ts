import type { DeadlineStatus } from "./types";

export const REGISTRATION_WINDOW_DAYS = 90;
const MS_PER_DAY = 86_400_000;

// Nearly every tracked creator posts from Texas/Oklahoma, so "what day did this go up" means their
// Central-time day, not whatever calendar day UTC happens to be at that instant. Every scraper
// (Facebook/Instagram/TikTok/X/YouTube) stores a precise UTC instant, e.g. "2026-08-14T02:15:00Z"
// for an 8:15pm CDT post on the 13th -- reading the date off that string naively would call it the
// 14th. IANA's "America/Chicago" handles the CST/CDT switch automatically.
const CENTRAL_TIME_ZONE = "America/Chicago";
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const CENTRAL_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: CENTRAL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function partsToYmd(parts: Intl.DateTimeFormatPart[]): { y: number; m: number; d: number } {
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

function ymdToString({ y, m, d }: { y: number; m: number; d: number }): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Pulls the calendar date a timestamp falls on, in Central time. A bare date-only string (no time
 * component -- manual entry, or another call's own YYYY-MM-DD output) has no instant to convert and
 * is already a calendar date, so it passes through unchanged rather than being reinterpreted as UTC
 * midnight and shifted backward a day.
 */
function calendarPart(iso: string): { y: number; m: number; d: number } {
  if (DATE_ONLY_RE.test(iso)) {
    const [y, m, d] = iso.split("-").map(Number);
    return { y, m, d };
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ISO date: ${iso}`);
  return partsToYmd(CENTRAL_DATE_FORMATTER.formatToParts(date));
}

/** Epoch ms for midnight (UTC, purely as an internal, DST-safe representation for day arithmetic --
 * not a claim about what timezone the calendar date "is") of the calendar date embedded in an ISO
 * string, per calendarPart. */
function calendarMidnight(iso: string): number {
  const { y, m, d } = calendarPart(iso);
  return Date.UTC(y, m - 1, d);
}

/** The calendar date (YYYY-MM-DD) a timestamp falls on in Central time -- or, for an already
 * date-only string, that same string unchanged. The one shared place every "which day is this"
 * decision in the app should go through, so display, grouping, exports, and deadline math all agree
 * with each other and with the creator's own local day. */
export function centralDateString(iso: string): string {
  return ymdToString(calendarPart(iso));
}

/** Today's calendar date in Central time, as YYYY-MM-DD. */
export function todayDateString(now: Date = new Date()): string {
  return ymdToString(partsToYmd(CENTRAL_DATE_FORMATTER.formatToParts(now)));
}

/** Adds calendar days (not 24h periods) to an ISO date/datetime string, returning YYYY-MM-DD. */
export function addCalendarDays(iso: string, days: number): string {
  const ms = calendarMidnight(iso) + days * MS_PER_DAY;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Whole calendar days between two ISO date/datetime strings (to - from). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((calendarMidnight(toIso) - calendarMidnight(fromIso)) / MS_PER_DAY);
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
  return dates.reduce((earliest, current) => (calendarMidnight(current) < calendarMidnight(earliest) ? current : earliest));
}
