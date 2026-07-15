import type { ApiHandler } from "../../lib/env";
import { errorResponse, json, readJson } from "../../lib/http";
import { nowIso } from "../../lib/ids";
import { getClientOrThrow } from "../../lib/db";
import { requireString } from "../../lib/validation";
import type { UpdateClientInput } from "../../../shared/types";

export const onRequestGet: ApiHandler = async (context) => {
  try {
    const client = await getClientOrThrow(context.env.DB, context.params.id as string);
    return json({ client });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestPatch: ApiHandler = async (context) => {
  try {
    const id = context.params.id as string;
    await getClientOrThrow(context.env.DB, id);
    const body = await readJson<UpdateClientInput>(context.request);

    const updates: string[] = [];
    const values: unknown[] = [];

    if (body.name !== undefined) {
      updates.push("name = ?");
      values.push(requireString(body.name, "name", { maxLength: 200 }));
    }
    if (body.archived !== undefined) {
      updates.push("archived = ?");
      values.push(body.archived ? 1 : 0);
    }
    if (updates.length === 0) {
      const client = await getClientOrThrow(context.env.DB, id);
      return json({ client });
    }

    updates.push("updated_at = ?");
    const now = nowIso();
    values.push(now);
    values.push(id);

    await context.env.DB.prepare(`UPDATE clients SET ${updates.join(", ")} WHERE id = ?`)
      .bind(...values)
      .run();

    const client = await getClientOrThrow(context.env.DB, id);
    return json({ client });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestDelete: ApiHandler = async (context) => {
  try {
    const id = context.params.id as string;
    await getClientOrThrow(context.env.DB, id);
    await context.env.DB.prepare("DELETE FROM clients WHERE id = ?").bind(id).run();
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
};
