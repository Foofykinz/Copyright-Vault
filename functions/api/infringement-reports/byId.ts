import type { ApiHandler } from "../../lib/env";
import { errorResponse, json, readJson, ValidationError } from "../../lib/http";
import { nowIso } from "../../lib/ids";
import { getClientOrThrow, getInfringementReportOrThrow, mapInfringementReport } from "../../lib/db";
import { optionalString, requireIsoDate, requirePlatform, requireString, requireUrl } from "../../lib/validation";
import { INFRINGEMENT_STATUSES } from "../../../shared/types";
import type { InfringementReportWithNames, UpdateInfringementReportInput } from "../../../shared/types";

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

async function getJoinedOrThrow(db: D1Database, id: string): Promise<JoinedRow> {
  await getInfringementReportOrThrow(db, id); // 404s with the right message if missing
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
  return row!;
}

export const onRequestPatch: ApiHandler = async (context) => {
  try {
    const db = context.env.DB;
    const id = context.params.id as string;
    await getInfringementReportOrThrow(db, id);
    const body = await readJson<UpdateInfringementReportInput>(context.request);

    const updates: string[] = [];
    const values: unknown[] = [];

    if (body.clientId !== undefined) {
      const clientId = body.clientId ? requireString(body.clientId, "clientId") : null;
      if (clientId) await getClientOrThrow(db, clientId);
      updates.push("client_id = ?");
      values.push(clientId);
    }
    if (body.infringerName !== undefined) {
      updates.push("infringer_name = ?");
      values.push(requireString(body.infringerName, "infringerName", { maxLength: 200 }));
    }
    if (body.infringingUrl !== undefined) {
      updates.push("infringing_url = ?");
      values.push(requireUrl(body.infringingUrl, "infringingUrl"));
    }
    if (body.platform !== undefined) {
      updates.push("platform = ?");
      values.push(requirePlatform(body.platform));
    }
    if (body.postedAt !== undefined) {
      updates.push("posted_at = ?");
      values.push(requireIsoDate(body.postedAt, "postedAt"));
    }
    if (body.notes !== undefined) {
      updates.push("notes = ?");
      values.push(optionalString(body.notes));
    }
    if (body.status !== undefined) {
      if (!INFRINGEMENT_STATUSES.includes(body.status)) {
        throw new ValidationError(`status must be one of: ${INFRINGEMENT_STATUSES.join(", ")}.`, { status: "invalid" });
      }
      updates.push("status = ?");
      values.push(body.status);
    }

    if (updates.length > 0) {
      updates.push("updated_at = ?");
      values.push(nowIso());
      values.push(id);
      await db.prepare(`UPDATE infringement_reports SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
    }

    const row = await getJoinedOrThrow(db, id);
    return json({ infringementReport: withNames(row) });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestDelete: ApiHandler = async (context) => {
  try {
    const db = context.env.DB;
    const id = context.params.id as string;
    await getInfringementReportOrThrow(db, id);
    await db.prepare("DELETE FROM infringement_reports WHERE id = ?").bind(id).run();
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
};
