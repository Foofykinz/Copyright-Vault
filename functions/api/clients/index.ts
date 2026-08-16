import type { ApiHandler } from "../../lib/env";
import { errorResponse, json, readJson } from "../../lib/http";
import { generateId, nowIso } from "../../lib/ids";
import { optionalString, requireString } from "../../lib/validation";
import { getAffiliationTagOrThrow, getClientOrThrow, mapClient } from "../../lib/db";
import type { CreateClientInput } from "../../../shared/types";

export const onRequestGet: ApiHandler = async (context) => {
  try {
    const includeArchived = new URL(context.request.url).searchParams.get("archived") === "true";
    const rows = await context.env.DB.prepare(
      `SELECT c.*, t.name as affiliation_tag_name
       FROM clients c
       LEFT JOIN affiliation_tags t ON t.id = c.affiliation_tag_id
       ${includeArchived ? "" : "WHERE c.archived = 0"}
       ORDER BY c.name ASC`
    ).all();
    return json({ clients: rows.results.map((r) => mapClient(r as never)) });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestPost: ApiHandler = async (context) => {
  try {
    const db = context.env.DB;
    const body = await readJson<CreateClientInput>(context.request);
    const name = requireString(body.name, "name", { maxLength: 200 });
    const affiliationTagId = body.affiliationTagId ? requireString(body.affiliationTagId, "affiliationTagId") : null;
    if (affiliationTagId) await getAffiliationTagOrThrow(db, affiliationTagId);
    const notes = optionalString(body.notes);

    const id = generateId();
    const now = nowIso();
    await db
      .prepare("INSERT INTO clients (id, name, archived, affiliation_tag_id, notes, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?, ?)")
      .bind(id, name, affiliationTagId, notes, now, now)
      .run();
    return json({ client: await getClientOrThrow(db, id) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
};
