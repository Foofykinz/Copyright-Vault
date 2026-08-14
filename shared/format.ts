import { centralDateString } from "./dates";

/** Formats large view counts compactly: 1250 -> "1.3K", 1250000 -> "1.3M". Full integer stays in the database. */
export function formatViewCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  if (count < 1_000_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${(count / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
}

/** Formats an ISO date/datetime string as a compact display date, e.g. "Jul 15, 2026" — the day
 * shown is the Central-time day (see shared/dates.ts), not whatever day the raw UTC instant embeds. */
export function formatDisplayDate(iso: string | null): string {
  if (!iso) return "—";
  let dateStr: string;
  try {
    dateStr = centralDateString(iso);
  } catch {
    return "—";
  }
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/** Truncates freeform text (e.g. a long caption standing in for a title) to at most `maxWords` words. */
export function truncateWords(text: string, maxWords = 12): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return trimmed;
  const words = trimmed.split(" ");
  if (words.length <= maxWords) return trimmed;
  return `${words.slice(0, maxWords).join(" ")}…`;
}

const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g;

export function sanitizeForFilename(text: string): string {
  return text.replace(ILLEGAL_FILENAME_CHARS, "").replace(/\s+/g, " ").trim();
}

/** Suggests a "Client - Date - Title" filename (no extension), e.g.
 * "Reed Timmer - 2026-07-15 - Storm chase footage". */
export function suggestFilename(clientName: string, publicationDateIso: string, title: string): string {
  const date = centralDateString(publicationDateIso);
  return [sanitizeForFilename(clientName), date, sanitizeForFilename(title)].filter(Boolean).join(" - ");
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
