import type { ApiHandler } from "../../lib/env";
import { errorResponse } from "../../lib/http";
import { DATA_PULL_SELECT, mapDataPull, parseDataPullFilters, type DataPullRow } from "../../lib/dataPulls";
import { PLATFORM_LABELS, TAKEDOWN_STATUS_LABELS } from "../../../shared/types";
import type { DataPullWithNames } from "../../../shared/types";

const COLUMNS = [
  "Match ID",
  "Right Manager",
  "User",
  "Page",
  "Infringing link",
  "Profile link",
  "Platform",
  "Detected",
  "Matched (sec)",
  "Views",
  "Followers",
  "Reference files",
  "Reference file IDs",
  "Takedown",
  "First pulled",
  "Last pulled",
] as const;

/** Quotes when needed, and neutralizes a leading = + - @ -- page names come straight off Meta's
 * pages, and a spreadsheet would otherwise run one shaped like a formula. */
function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toRow(p: DataPullWithNames): string {
  return [
    p.metaMatchId,
    p.rightsManagerAccountName ?? "",
    p.clientName ?? "",
    p.infringerName,
    p.infringingUrl ?? "",
    p.infringerProfileUrl ?? "",
    PLATFORM_LABELS[p.platform] ?? p.platform,
    p.detectedAt ?? "",
    p.matchDurationSec === null ? "" : String(p.matchDurationSec),
    p.videoViewCount === null ? "" : String(p.videoViewCount),
    p.pageFollowerCount === null ? "" : String(p.pageFollowerCount),
    p.referenceFiles.map((f) => f.title).join("; "),
    p.referenceFiles.map((f) => f.id).join("; "),
    p.takedownStatus ? TAKEDOWN_STATUS_LABELS[p.takedownStatus] : "",
    p.firstPulledAt,
    p.lastPulledAt,
  ]
    .map(csvCell)
    .join(",");
}

/** Every row matching the Data Pulls page's current filters (no pagination), as CSV. */
export const onRequestGet: ApiHandler = async (context) => {
  try {
    const db = context.env.DB;
    const { where, values } = parseDataPullFilters(new URL(context.request.url));
    const rows = await db.prepare(`${DATA_PULL_SELECT} ${where} ORDER BY dp.last_pulled_at DESC`).bind(...values).all<DataPullRow>();

    const csv = [COLUMNS.join(","), ...rows.results.map(mapDataPull).map(toRow)].join("\r\n");
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="data-pulls.csv"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
};
