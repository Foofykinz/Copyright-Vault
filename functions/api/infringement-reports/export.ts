import type { ApiHandler } from "../../lib/env";
import { errorResponse } from "../../lib/http";
import { mapInfringementReport } from "../../lib/db";
import { parseInfringementReportFilters } from "../../lib/infringementReportsQuery";
import { INFRINGEMENT_STATUS_LABELS, PLATFORM_LABELS } from "../../../shared/types";
import type { InfringementReportWithNames, InfringementStatus, Platform } from "../../../shared/types";

interface JoinedRow {
  id: string;
  client_id: string | null;
  infringer_name: string;
  infringing_url: string;
  platform: string;
  posted_at: string;
  notes: string | null;
  status: string;
  found_by_user_id: string;
  created_at: string;
  updated_at: string;
  source: string;
  rights_manager_account_id: string | null;
  meta_match_id: string | null;
  meta_video_id: string | null;
  match_duration_sec: number | null;
  video_view_count: number | null;
  page_follower_count: number | null;
  is_account_private: number | null;
  infringer_profile_url: string | null;
  reference_files: string | null;
  screenshot_key: string | null;
  video_available: number | null;
  client_name: string | null;
  found_by_name: string;
  rights_manager_account_name: string | null;
}

function withNames(row: JoinedRow): InfringementReportWithNames {
  return {
    ...mapInfringementReport(row),
    clientName: row.client_name,
    foundByName: row.found_by_name,
    rightsManagerAccountName: row.rights_manager_account_name,
  };
}

const COLUMNS = [
  "ID",
  "Right Manager",
  "User",
  "Page",
  "Posted at",
  "Attributes",
  "Match ID",
  "Video ID",
  "Video Available",
  "Views",
  "Followers",
  "Reference files",
  "Status",
  // Appended after the existing columns rather than placed beside "Reference files" -- anything
  // reading this export by position keeps working unchanged.
  "Reference file IDs",
] as const;

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function toRow(report: InfringementReportWithNames): string {
  const cells = [
    report.id,
    report.rightsManagerAccountName ?? "",
    report.clientName ?? "",
    report.infringerName,
    report.postedAt,
    PLATFORM_LABELS[report.platform as Platform] ?? report.platform,
    report.metaMatchId ?? "",
    report.metaVideoId ?? "",
    report.videoAvailable === null ? "" : report.videoAvailable ? "Yes" : "No",
    report.videoViewCount === null ? "" : String(report.videoViewCount),
    report.pageFollowerCount === null ? "" : String(report.pageFollowerCount),
    (report.referenceFiles ?? []).map((f) => f.title).join("; "),
    INFRINGEMENT_STATUS_LABELS[report.status as InfringementStatus] ?? report.status,
    (report.referenceFiles ?? []).map((f) => f.id).join("; "),
  ];
  return cells.map((c) => csvEscape(String(c))).join(",");
}

/** Streams every row matching the current archive filters (no pagination — export is meant to
 * cover the whole filtered set, not just the visible page) as CSV. Reuses the same filter parsing
 * as GET /api/infringement-reports so "Export" always matches what's on screen. */
export const onRequestGet: ApiHandler = async (context) => {
  try {
    const db = context.env.DB;
    const url = new URL(context.request.url);
    const { where, values, orderBy } = parseInfringementReportFilters(url);

    const rows = await db
      .prepare(
        `SELECT ir.*, c.name as client_name, u.name as found_by_name, rma.name as rights_manager_account_name
         FROM infringement_reports ir
         LEFT JOIN clients c ON c.id = ir.client_id
         JOIN users u ON u.id = ir.found_by_user_id
         LEFT JOIN rights_manager_accounts rma ON rma.id = ir.rights_manager_account_id
         ${where}
         ${orderBy}`
      )
      .bind(...values)
      .all<JoinedRow>();

    const lines = [COLUMNS.join(","), ...rows.results.map(withNames).map(toRow)];
    const csv = lines.join("\r\n");

    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="copyright-archive.csv"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
};
