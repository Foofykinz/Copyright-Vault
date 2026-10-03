import type { ApiHandler } from "../../lib/env";
import { errorResponse, json, readJson, ValidationError } from "../../lib/http";
import { requireBearerToken } from "../../lib/auth";
import { generateId, nowIso } from "../../lib/ids";
import { getClientOrThrow, getRightsManagerAccountOrThrow } from "../../lib/db";
import { DATA_PULL_SELECT, mapDataPull, type DataPullRow } from "../../lib/dataPulls";
import {
  optionalIsoDate,
  optionalNonNegativeInt,
  optionalNonNegativeNumber,
  optionalUrl,
  requirePlatform,
  requireString,
} from "../../lib/validation";
import type { ExtensionDataPullInput, ExtensionDataPullResult, InfringementReferenceFile, TakedownStatus } from "../../../shared/types";

function optionalReferenceFiles(value: unknown): InfringementReferenceFile[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError("referenceFiles must be an array.", { referenceFiles: "invalid" });
  return value.map((entry, i) => {
    if (!entry || typeof entry !== "object" || typeof (entry as { id?: unknown }).id !== "string" || typeof (entry as { title?: unknown }).title !== "string") {
      throw new ValidationError(`referenceFiles[${i}] must be {id, title}.`, { referenceFiles: "invalid" });
    }
    return { id: (entry as { id: string }).id, title: (entry as { title: string }).title };
  });
}

function optionalTakedownStatus(value: unknown): TakedownStatus | null {
  if (value === undefined || value === null) return null;
  if (value === "requested" || value === "approved") return value;
  throw new ValidationError("takedownStatus must be requested, approved, or null.", { takedownStatus: "invalid" });
}

function optionalCount(value: unknown, field: string): number | null {
  return value === undefined || value === null ? null : optionalNonNegativeInt(value, field);
}

/** One match from the extension's automated data pull. Upserts by meta_match_id: a match pulled
 * again has its row refreshed with the latest values (takedown status can change between pulls)
 * instead of getting a second row. See migrations/0017_data_pulls.sql. */
export const onRequestPost: ApiHandler = async (context) => {
  try {
    requireBearerToken(context.request, context.env);
    const db = context.env.DB;
    const body = await readJson<ExtensionDataPullInput>(context.request);

    const rightsManagerAccountId = requireString(body.rightsManagerAccountId, "rightsManagerAccountId");
    await getRightsManagerAccountOrThrow(db, rightsManagerAccountId);
    const clientId = body.clientId ? requireString(body.clientId, "clientId") : null;
    if (clientId) await getClientOrThrow(db, clientId);

    const metaMatchId = requireString(body.metaMatchId, "metaMatchId");
    const infringerName = requireString(body.infringerName, "infringerName", { maxLength: 200 });
    const infringingUrl = body.infringingUrl ? optionalUrl(body.infringingUrl, "infringingUrl") : null;
    const infringerProfileUrl = body.infringerProfileUrl ? optionalUrl(body.infringerProfileUrl, "infringerProfileUrl") : null;
    const platform = requirePlatform(body.platform);
    const detectedAt = optionalIsoDate(body.detectedAt, "detectedAt");
    const matchDurationSec = optionalNonNegativeNumber(body.matchDurationSec, "matchDurationSec");
    const videoViewCount = optionalCount(body.videoViewCount, "videoViewCount");
    const pageFollowerCount = optionalCount(body.pageFollowerCount, "pageFollowerCount");
    const referenceFiles = optionalReferenceFiles(body.referenceFiles);
    const takedownStatus = optionalTakedownStatus(body.takedownStatus);

    const existing = await db.prepare("SELECT id FROM data_pulls WHERE meta_match_id = ?").bind(metaMatchId).first<{ id: string }>();
    const now = nowIso();
    const fields = [
      rightsManagerAccountId,
      clientId,
      infringerName,
      infringingUrl,
      infringerProfileUrl,
      platform,
      detectedAt,
      matchDurationSec,
      videoViewCount,
      pageFollowerCount,
      referenceFiles.length > 0 ? JSON.stringify(referenceFiles) : null,
      takedownStatus,
    ];

    let id: string;
    if (existing) {
      id = existing.id;
      // A re-pull refreshes every value it actually has, but never blanks one out: if Meta's page
      // didn't show a value this time (or the post link is gone after a takedown went through), the
      // value from an earlier pull is kept. Takedown status is the exception -- always the latest.
      await db
        .prepare(
          `UPDATE data_pulls SET
             rights_manager_account_id = ?, client_id = COALESCE(?, client_id), infringer_name = ?,
             infringing_url = COALESCE(?, infringing_url), infringer_profile_url = COALESCE(?, infringer_profile_url),
             platform = ?, detected_at = COALESCE(?, detected_at), match_duration_sec = COALESCE(?, match_duration_sec),
             video_view_count = COALESCE(?, video_view_count), page_follower_count = COALESCE(?, page_follower_count),
             reference_files = COALESCE(?, reference_files), takedown_status = ?, last_pulled_at = ?
           WHERE id = ?`
        )
        .bind(...fields, now, id)
        .run();
    } else {
      id = generateId();
      await db
        .prepare(
          `INSERT INTO data_pulls
             (rights_manager_account_id, client_id, infringer_name, infringing_url, infringer_profile_url,
              platform, detected_at, match_duration_sec, video_view_count, page_follower_count,
              reference_files, takedown_status, id, meta_match_id, first_pulled_at, last_pulled_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(...fields, id, metaMatchId, now, now)
        .run();
    }

    const row = await db.prepare(`${DATA_PULL_SELECT} WHERE dp.id = ?`).bind(id).first<DataPullRow>();
    const result: ExtensionDataPullResult = { dataPull: mapDataPull(row!), updated: existing !== null };
    return json(result, { status: existing ? 200 : 201 });
  } catch (err) {
    return errorResponse(err);
  }
};
