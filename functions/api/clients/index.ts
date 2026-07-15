import type { ApiHandler } from "../../lib/env";
import { errorResponse, json, readJson } from "../../lib/http";
import { generateId, nowIso } from "../../lib/ids";
import { requireString } from "../../lib/validation";
import { mapClient } from "../../lib/db";
import type { CreateClientInput } from "../../../shared/types";

export const onRequestGet: ApiHandler = async (context) => {
  try {
    const includeArchived = new URL(context.request.url).searchParams.get("archived") === "true";
    const rows = await context.env.DB.prepare(
      `SELECT * FROM clients ${includeArchived ? "" : "WHERE archived = 0"} ORDER BY name ASC`
    ).all();
    return json({ clients: rows.results.map((r) => mapClient(r as never)) });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestPost: ApiHandler = async (context) => {
  try {
    const body = await readJson<CreateClientInput>(context.request);
    const name = requireString(body.name, "name", { maxLength: 200 });
    const id = generateId();
    const now = nowIso();
    await context.env.DB.prepare(
      "INSERT INTO clients (id, name, archived, created_at, updated_at) VALUES (?, ?, 0, ?, ?)"
    )
      .bind(id, name, now, now)
      .run();
    return json({ client: mapClient({ id, name, archived: 0, created_at: now, updated_at: now }) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
};
