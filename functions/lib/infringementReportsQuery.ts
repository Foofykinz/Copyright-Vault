// Shared filter/sort parsing for GET /api/infringement-reports and its CSV export sibling
// (functions/api/infringement-reports/export.ts) — kept in one place so the two never drift apart.
import type { InfringementReportSortField, InfringementStatus, Platform } from "../../shared/types";

const SORT_COLUMNS: Record<InfringementReportSortField, string> = {
  createdAt: "ir.created_at",
  postedAt: "ir.posted_at",
  videoViewCount: "ir.video_view_count",
  pageFollowerCount: "ir.page_follower_count",
};

export interface ParsedInfringementReportFilters {
  where: string;
  values: unknown[];
  orderBy: string;
}

function parseOptionalInt(raw: string | null): number | null {
  if (raw === null || raw === "") return null;
  const num = Number(raw);
  return Number.isFinite(num) ? Math.trunc(num) : null;
}

function parseOptionalBoolean(raw: string | null): boolean | null {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

/** Parses every recognized filter/sort query param off `url` into a WHERE clause (with positional
 * `?` placeholders), its bound values, and an ORDER BY clause — all injection-safe: filter values
 * are always bound, and sort field/direction are matched against fixed allowlists rather than
 * interpolated from the request. */
export function parseInfringementReportFilters(url: URL): ParsedInfringementReportFilters {
  const params = url.searchParams;
  const conditions: string[] = [];
  const values: unknown[] = [];

  const status = params.get("status") as InfringementStatus | null;
  if (status) {
    conditions.push("ir.status = ?");
    values.push(status);
  }
  const clientId = params.get("clientId");
  if (clientId) {
    conditions.push("ir.client_id = ?");
    values.push(clientId);
  }
  const source = params.get("source");
  if (source) {
    conditions.push("ir.source = ?");
    values.push(source);
  }
  const rightsManagerAccountId = params.get("rightsManagerAccountId");
  if (rightsManagerAccountId) {
    conditions.push("ir.rights_manager_account_id = ?");
    values.push(rightsManagerAccountId);
  }
  const infringerName = params.get("infringerName");
  if (infringerName) {
    conditions.push("ir.infringer_name LIKE ? ESCAPE '\\'");
    values.push(`%${infringerName.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  const matchId = params.get("matchId");
  if (matchId) {
    conditions.push("ir.meta_match_id = ?");
    values.push(matchId);
  }
  const videoId = params.get("videoId");
  if (videoId) {
    conditions.push("ir.meta_video_id = ?");
    values.push(videoId);
  }
  const videoAvailable = parseOptionalBoolean(params.get("videoAvailable"));
  if (videoAvailable !== null) {
    conditions.push("ir.video_available = ?");
    values.push(videoAvailable ? 1 : 0);
  }
  const platform = params.get("platform") as Platform | null;
  if (platform) {
    conditions.push("ir.platform = ?");
    values.push(platform);
  }
  const postedFrom = params.get("postedFrom");
  if (postedFrom) {
    conditions.push("ir.posted_at >= ?");
    values.push(postedFrom);
  }
  const postedTo = params.get("postedTo");
  if (postedTo) {
    conditions.push("ir.posted_at <= ?");
    values.push(postedTo);
  }
  const viewsMin = parseOptionalInt(params.get("viewsMin"));
  if (viewsMin !== null) {
    conditions.push("ir.video_view_count >= ?");
    values.push(viewsMin);
  }
  const viewsMax = parseOptionalInt(params.get("viewsMax"));
  if (viewsMax !== null) {
    conditions.push("ir.video_view_count <= ?");
    values.push(viewsMax);
  }
  const followersMin = parseOptionalInt(params.get("followersMin"));
  if (followersMin !== null) {
    conditions.push("ir.page_follower_count >= ?");
    values.push(followersMin);
  }
  const followersMax = parseOptionalInt(params.get("followersMax"));
  if (followersMax !== null) {
    conditions.push("ir.page_follower_count <= ?");
    values.push(followersMax);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const sortField = params.get("sortBy") as InfringementReportSortField | null;
  const sortColumn = (sortField && SORT_COLUMNS[sortField]) || SORT_COLUMNS.createdAt;
  const sortDir = params.get("sortDir") === "asc" ? "ASC" : "DESC";
  const orderBy = `ORDER BY ${sortColumn} ${sortDir}`;

  return { where, values, orderBy };
}
