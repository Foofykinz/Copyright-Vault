import type { ApiHandler } from "../../lib/env";
import { errorResponse, json, readJson } from "../../lib/http";
import { generateId, nowIso } from "../../lib/ids";
import { getClientOrThrow } from "../../lib/db";
import { requireString, requireStringArray } from "../../lib/validation";
import type { MarkRightsManagerSentInput, MarkRightsManagerSentResult } from "../../../shared/types";

/**
 * One-step bulk action: select videos, mark them as sent to Rights Manager. A
 * rights_manager_batches row is auto-created per call purely as an audit trail (who/when a set of
 * videos was marked) — never named or managed by the user the way Combination Folders are.
 * exported_at is stamped immediately on the junction rows (added + exported happen together in this
 * flow) and videos.rights_manager_sent_at is updated as a denormalized fast-path read cache.
 *
 * No validation that each videoId actually exists before inserting — the FK on
 * rights_manager_batch_videos.video_id enforces that, same posture as combination-folders'
 * addVideos, which trusts the FK rather than pre-checking every ID.
 */
export const onRequestPost: ApiHandler = async (context) => {
  try {
    const db = context.env.DB;
    const body = await readJson<MarkRightsManagerSentInput>(context.request);
    const clientId = requireString(body.clientId, "clientId");
    await getClientOrThrow(db, clientId);
    const videoIds = requireStringArray(body.videoIds, "videoIds");
    if (videoIds.length === 0) {
      return json({ error: "videoIds must contain at least one video." }, { status: 400 });
    }

    const batchId = generateId();
    const now = nowIso();
    const label = `Rights Manager – ${now.slice(0, 16).replace("T", " ")}`;

    const statements = [
      db
        .prepare(
          `INSERT INTO rights_manager_batches (id, client_id, name, notes, created_at, updated_at)
           VALUES (?, ?, ?, NULL, ?, ?)`
        )
        .bind(batchId, clientId, label, now, now),
      ...videoIds.map((videoId) =>
        db
          .prepare(
            `INSERT INTO rights_manager_batch_videos (rights_manager_batch_id, video_id, added_at, exported_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (rights_manager_batch_id, video_id) DO NOTHING`
          )
          .bind(batchId, videoId, now, now)
      ),
      ...videoIds.map((videoId) =>
        db.prepare("UPDATE videos SET rights_manager_sent_at = ?, updated_at = ? WHERE id = ?").bind(now, now, videoId)
      ),
    ];
    await db.batch(statements);

    const result: MarkRightsManagerSentResult = { batchId, markedAt: now, videoIds };
    return json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
};
