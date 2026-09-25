import type { ApiHandler } from "../../../lib/env";
import { errorResponse, json, readJson } from "../../../lib/http";
import { requireHunterAccess } from "../../../lib/hunterAuth";
import { getHunterChannelOrThrow } from "../../../lib/hunterDb";
import { getClientOrThrow } from "../../../lib/db";
import { nowIso } from "../../../lib/ids";
import { optionalHunterChannelClassification, optionalNonNegativeInt, optionalString } from "../../../lib/validation";
import type { UpdateHunterChannelInput } from "../../../../shared/types";

export const onRequestGet: ApiHandler = async (context) => {
  try {
    await requireHunterAccess(context.request, context.env);
    const channel = await getHunterChannelOrThrow(context.env.DB, context.params.id as string);
    return json({ channel });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestPatch: ApiHandler = async (context) => {
  try {
    await requireHunterAccess(context.request, context.env);
    const id = context.params.id as string;
    const db = context.env.DB;
    await getHunterChannelOrThrow(db, id);
    const body = await readJson<UpdateHunterChannelInput>(context.request);

    const updates: string[] = [];
    const values: unknown[] = [];

    if (body.channelName !== undefined) {
      updates.push("channel_name = ?");
      values.push(optionalString(body.channelName));
    }
    if (body.classification !== undefined) {
      updates.push("classification = ?");
      values.push(optionalHunterChannelClassification(body.classification));
    }
    if (body.associatedClientId !== undefined) {
      const clientId = optionalString(body.associatedClientId);
      if (clientId) await getClientOrThrow(db, clientId);
      updates.push("associated_client_id = ?");
      values.push(clientId);
    }
    if (body.reason !== undefined) {
      updates.push("reason = ?");
      values.push(optionalString(body.reason));
    }
    if (body.notes !== undefined) {
      updates.push("notes = ?");
      values.push(optionalString(body.notes));
    }
    if (body.confirmedIncidentCount !== undefined) {
      updates.push("confirmed_incident_count = ?");
      values.push(optionalNonNegativeInt(body.confirmedIncidentCount, "confirmedIncidentCount"));
    }

    if (updates.length > 0) {
      updates.push("updated_at = ?", "last_seen_at = ?");
      const now = nowIso();
      values.push(now, now, id);
      await db.prepare(`UPDATE hunter_channels SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
    }

    const channel = await getHunterChannelOrThrow(db, id);
    return json({ channel });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestDelete: ApiHandler = async (context) => {
  try {
    await requireHunterAccess(context.request, context.env);
    const id = context.params.id as string;
    await getHunterChannelOrThrow(context.env.DB, id);
    await context.env.DB.prepare("DELETE FROM hunter_channels WHERE id = ?").bind(id).run();
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
};
