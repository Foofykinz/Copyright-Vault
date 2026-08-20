import type { ApiHandler } from "../../lib/env";
import { errorResponse, json, readJson, UnauthorizedError } from "../../lib/http";
import { generateId, nowIso } from "../../lib/ids";
import { getClientOrThrow, mapInfringementReport } from "../../lib/db";
import { verifySession } from "../../lib/session";
import { optionalString, requireIsoDate, requirePlatform, requireString, requireUrl } from "../../lib/validation";
import { parseInfringementReportFilters } from "../../lib/infringementReportsQuery";
import type { CreateInfringementReportInput, InfringementReportListResult, InfringementReportWithNames } from "../../../shared/types";

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

export const onRequestGet: ApiHandler = async (context) => {
  try {
    const db = context.env.DB;
    const url = new URL(context.request.url);
    const { where, values, orderBy } = parseInfringementReportFilters(url);

    // `page` presence toggles pagination on. Omitting it preserves the endpoint's original
    // behavior (return every matching row) for the Infringements tab, which has no pagination UI
    // and predates this filter set; the Rights Manager archive tab always sends `page`.
    const pageParam = url.searchParams.get("page");
    const paginate = pageParam !== null;
    const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "50", 10) || 50));

    const countRow = paginate
      ? await db.prepare(`SELECT COUNT(*) as count FROM infringement_reports ir ${where}`).bind(...values).first<{ count: number }>()
      : null;
    const total = countRow ? countRow.count : undefined;

    const limitClause = paginate ? "LIMIT ? OFFSET ?" : "";
    const limitValues = paginate ? [pageSize, (page - 1) * pageSize] : [];

    const rows = await db
      .prepare(
        `SELECT ir.*, c.name as client_name, u.name as found_by_name, rma.name as rights_manager_account_name
         FROM infringement_reports ir
         LEFT JOIN clients c ON c.id = ir.client_id
         JOIN users u ON u.id = ir.found_by_user_id
         LEFT JOIN rights_manager_accounts rma ON rma.id = ir.rights_manager_account_id
         ${where}
         ${orderBy}
         ${limitClause}`
      )
      .bind(...values, ...limitValues)
      .all<JoinedRow>();

    const infringementReports = rows.results.map(withNames);
    const resolvedTotal = total ?? infringementReports.length;
    const resolvedPageSize = paginate ? pageSize : resolvedTotal || 1;
    const result: InfringementReportListResult = {
      infringementReports,
      total: resolvedTotal,
      page,
      pageSize: resolvedPageSize,
      totalPages: Math.max(1, Math.ceil(resolvedTotal / resolvedPageSize)),
    };
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestPost: ApiHandler = async (context) => {
  try {
    const db = context.env.DB;
    const userId = await verifySession(context.request, context.env);
    if (!userId) throw new UnauthorizedError("Not logged in.");

    const body = await readJson<CreateInfringementReportInput>(context.request);

    const clientId = body.clientId ? requireString(body.clientId, "clientId") : null;
    if (clientId) await getClientOrThrow(db, clientId);
    const infringerName = requireString(body.infringerName, "infringerName", { maxLength: 200 });
    const infringingUrl = requireUrl(body.infringingUrl, "infringingUrl");
    const platform = requirePlatform(body.platform);
    const postedAt = requireIsoDate(body.postedAt, "postedAt");
    const notes = optionalString(body.notes);

    const id = generateId();
    const now = nowIso();

    await db
      .prepare(
        `INSERT INTO infringement_reports
          (id, client_id, infringer_name, infringing_url, platform, posted_at, notes, status, found_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'needs_review', ?, ?, ?)`
      )
      .bind(id, clientId, infringerName, infringingUrl, platform, postedAt, notes, userId, now, now)
      .run();

    const row = await db
      .prepare(
        `SELECT ir.*, c.name as client_name, u.name as found_by_name, rma.name as rights_manager_account_name
         FROM infringement_reports ir
         LEFT JOIN clients c ON c.id = ir.client_id
         JOIN users u ON u.id = ir.found_by_user_id
         LEFT JOIN rights_manager_accounts rma ON rma.id = ir.rights_manager_account_id
         WHERE ir.id = ?`
      )
      .bind(id)
      .first<JoinedRow>();

    return json({ infringementReport: withNames(row!) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
};
