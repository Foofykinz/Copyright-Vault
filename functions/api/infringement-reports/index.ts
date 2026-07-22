import type { ApiHandler } from "../../lib/env";
import { errorResponse, json, readJson, UnauthorizedError } from "../../lib/http";
import { generateId, nowIso } from "../../lib/ids";
import { getClientOrThrow, mapInfringementReport } from "../../lib/db";
import { verifySession } from "../../lib/session";
import { optionalString, requireIsoDate, requirePlatform, requireString, requireUrl } from "../../lib/validation";
import type { CreateInfringementReportInput, InfringementReportWithNames, InfringementStatus } from "../../../shared/types";

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
  client_name: string | null;
  found_by_name: string;
}

function withNames(row: JoinedRow): InfringementReportWithNames {
  return {
    ...mapInfringementReport(row),
    clientName: row.client_name,
    foundByName: row.found_by_name,
  };
}

export const onRequestGet: ApiHandler = async (context) => {
  try {
    const db = context.env.DB;
    const url = new URL(context.request.url);
    const status = url.searchParams.get("status") as InfringementStatus | null;
    const clientId = url.searchParams.get("clientId");

    const conditions: string[] = [];
    const values: unknown[] = [];
    if (status) {
      conditions.push("ir.status = ?");
      values.push(status);
    }
    if (clientId) {
      conditions.push("ir.client_id = ?");
      values.push(clientId);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await db
      .prepare(
        `SELECT ir.*, c.name as client_name, u.name as found_by_name
         FROM infringement_reports ir
         LEFT JOIN clients c ON c.id = ir.client_id
         JOIN users u ON u.id = ir.found_by_user_id
         ${where}
         ORDER BY ir.created_at DESC`
      )
      .bind(...values)
      .all<JoinedRow>();

    return json({ infringementReports: rows.results.map(withNames) });
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
        `SELECT ir.*, c.name as client_name, u.name as found_by_name
         FROM infringement_reports ir
         LEFT JOIN clients c ON c.id = ir.client_id
         JOIN users u ON u.id = ir.found_by_user_id
         WHERE ir.id = ?`
      )
      .bind(id)
      .first<JoinedRow>();

    return json({ infringementReport: withNames(row!) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
};
