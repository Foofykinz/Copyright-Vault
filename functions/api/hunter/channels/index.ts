import type { ApiHandler } from "../../../lib/env";
import { errorResponse, json, readJson, ValidationError } from "../../../lib/http";
import { requireHunterAccess } from "../../../lib/hunterAuth";
import { mapHunterChannel } from "../../../lib/hunterDb";
import { getClientOrThrow } from "../../../lib/db";
import { generateId, nowIso } from "../../../lib/ids";
import {
  optionalHunterChannelClassification,
  optionalString,
  requireHunterChannelClassification,
  requireString,
} from "../../../lib/validation";
import type { CreateHunterChannelInput, HunterChannel } from "../../../../shared/types";

/**
 * Consolidated channel intelligence list (ALLOWLIST / WATCHLIST / REPEAT_OFFENDER — see migration
 * 0014's hunter_channels). GET supports an optional ?classification= filter for the three list
 * views; POST adds a new channel. Reclassifying an existing channel is a PATCH (see byId.ts) —
 * POST refuses a channel ID that's already tracked rather than silently changing its classification,
 * per "never silently perform secondary actions."
 */
export const onRequestGet: ApiHandler = async (context) => {
  try {
    await requireHunterAccess(context.request, context.env);
    const url = new URL(context.request.url);
    const classification = optionalHunterChannelClassification(url.searchParams.get("classification"));

    const rows = classification
      ? await context.env.DB.prepare("SELECT * FROM hunter_channels WHERE classification = ? ORDER BY updated_at DESC")
          .bind(classification)
          .all()
      : await context.env.DB.prepare("SELECT * FROM hunter_channels ORDER BY updated_at DESC").all();

    const channels: HunterChannel[] = rows.results.map((r) => mapHunterChannel(r as never));
    return json({ channels });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestPost: ApiHandler = async (context) => {
  try {
    const userId = await requireHunterAccess(context.request, context.env);
    const db = context.env.DB;
    const body = await readJson<CreateHunterChannelInput>(context.request);

    const youtubeChannelId = requireString(body.youtubeChannelId, "youtubeChannelId");
    const classification = requireHunterChannelClassification(body.classification);
    const channelName = optionalString(body.channelName);
    const reason = optionalString(body.reason);
    const notes = optionalString(body.notes);
    const associatedClientId = optionalString(body.associatedClientId);
    if (associatedClientId) await getClientOrThrow(db, associatedClientId);

    const existing = await db.prepare("SELECT id FROM hunter_channels WHERE youtube_channel_id = ?").bind(youtubeChannelId).first();
    if (existing) {
      throw new ValidationError("This channel is already tracked. Update its existing entry instead of adding a new one.", {
        youtubeChannelId: "already_tracked",
      });
    }

    const id = generateId();
    const now = nowIso();
    // A repeat offender is, by definition, being added off at least one confirmed incident.
    const confirmedIncidentCount = classification === "REPEAT_OFFENDER" ? 1 : 0;

    await db
      .prepare(
        `INSERT INTO hunter_channels
          (id, youtube_channel_id, channel_name, classification, associated_client_id, reason, notes,
           first_seen_at, last_seen_at, confirmed_incident_count, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, youtubeChannelId, channelName, classification, associatedClientId, reason, notes, now, now, confirmedIncidentCount, userId, now, now)
      .run();

    const row = await db.prepare("SELECT * FROM hunter_channels WHERE id = ?").bind(id).first();
    return json({ channel: mapHunterChannel(row as never) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
};
