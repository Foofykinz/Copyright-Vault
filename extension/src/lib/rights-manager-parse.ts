/** Pure text parsers for Meta's Content Protection match page. No DOM access on purpose -- the
 * DOM-walking half lives in content/rights-manager.ts; these only turn a string that half already
 * found into a value, so they can be checked in isolation without a browser. */

/** The match's own id, from the page URL's `?match_id=` query param. Content Protection's newer
 * layout dropped the "More details" panel that used to display it, so the URL is the only place
 * it's still exposed -- and, unlike scraped page text, it can't shift with a layout change or a
 * localized UI. Null when there's no such param (e.g. the overview/list page). */
export function matchIdFromUrl(href: string): string | null {
  try {
    const id = new URL(href).searchParams.get("match_id")?.trim();
    return id || null;
  } catch {
    return null;
  }
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "Detected Sep 25" / "Sep 25" / "Sep 25, 2025" / "September 25, 2025" -> a Date at local noon
 * (noon rather than midnight so a timezone/DST shift can't tip it onto a neighboring calendar day),
 * or null if the text isn't shaped like that. The newer Content Protection layout shows no year on
 * recent dates, so a missing year is inferred: the current year, unless that would land more than
 * a couple of days in the future, in which case it must be last year's. */
export function parseDetectedDate(text: string, now: Date = new Date()): Date | null {
  const m = /^(?:Detected\s+(?:on\s+)?)?([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(text.trim());
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  const day = Number(m[2]);
  if (month === -1 || day < 1 || day > 31) return null;

  const explicitYear = m[3] ? Number(m[3]) : null;
  let date = new Date(explicitYear ?? now.getFullYear(), month, day, 12, 0, 0);
  if (explicitYear === null && date.getTime() > now.getTime() + 2 * 86_400_000) {
    date = new Date(now.getFullYear() - 1, month, day, 12, 0, 0);
  }
  // "Feb 31" silently rolls into March in Date -- treat that as unparseable instead.
  return date.getMonth() === month ? date : null;
}

function clockToSeconds(clock: string): number | null {
  const parts = clock.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

/** "00:21 - 02:39" (one "Matching segments" chip) -> its length in seconds (138), or null if the
 * text isn't exactly a start-end range. Computed from the range itself rather than the chip's
 * separate "2m 18s" label, which is just the same number reformatted. */
export function segmentRangeSeconds(text: string): number | null {
  const m = /^(\d{1,2}(?::\d{2}){1,2})\s*[-–—]\s*(\d{1,2}(?::\d{2}){1,2})$/.exec(text.trim());
  if (!m) return null;
  const start = clockToSeconds(m[1]);
  const end = clockToSeconds(m[2]);
  if (start === null || end === null || end <= start) return null;
  return end - start;
}

/** Strips the trailing "<duration>, <percent> of the protected content ..." stats off a reference
 * asset card's flattened text, leaving just the title. Only a fallback for when the structural
 * title lookup comes up empty. Handles "32s" as well as "2m 19s" / "1h 2m 3s". */
export function stripReferenceStats(text: string): string {
  return text.replace(/(?:\d+h\s*)?(?:\d+m\s*)?\d+(?:\.\d+)?s,\s*\d+%\s*of the protected content.*$/i, "").trim();
}
