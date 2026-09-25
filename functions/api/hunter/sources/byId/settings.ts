import type { ApiHandler } from "../../../../lib/env";
import { errorResponse, json, readJson } from "../../../../lib/http";
import { requireHunterAccess } from "../../../../lib/hunterAuth";
import { getVideoOrThrow } from "../../../../lib/db";
import { defaultHunterSourceSettings, getHunterSourceSettings } from "../../../../lib/hunterDb";
import { optionalHunterSearchPriority } from "../../../../lib/validation";
import { nowIso } from "../../../../lib/ids";
import type {
  HunterSourceSettingsResult,
  UpdateHunterSourceSettingsInput,
} from "../../../../../shared/types";

/**
 * GET/PATCH the Hunter settings for one existing Copyright Vault source (any platform's `videos`
 * row — see migration 0014). A video with no settings row yet is a valid, common state ("never
 * configured for Hunter"), not a 404 — GET reports that via `isConfigured: false` alongside a
 * default-shaped settings object rather than erroring.
 */
export const onRequestGet: ApiHandler = async (context) => {
  try {
    await requireHunterAccess(context.request, context.env);
    const videoId = context.params.videoId as string;
    await getVideoOrThrow(context.env.DB, videoId);

    const existing = await getHunterSourceSettings(context.env.DB, videoId);
    const result: HunterSourceSettingsResult = existing
      ? { settings: existing, isConfigured: true }
      : { settings: defaultHunterSourceSettings(videoId, nowIso()), isConfigured: false };
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestPatch: ApiHandler = async (context) => {
  try {
    const userId = await requireHunterAccess(context.request, context.env);
    const videoId = context.params.videoId as string;
    await getVideoOrThrow(context.env.DB, videoId);

    const body = await readJson<UpdateHunterSourceSettingsInput>(context.request);
    const searchPriority = optionalHunterSearchPriority(body.searchPriority);

    const db = context.env.DB;
    const now = nowIso();
    const existing = await getHunterSourceSettings(db, videoId);
    const base = existing ?? defaultHunterSourceSettings(videoId, now);

    const hunterEnabled = body.hunterEnabled !== undefined ? body.hunterEnabled : base.hunterEnabled;
    // enabled_at/enabled_by_user_id record the FIRST time this source was ever enabled — toggling
    // off and back on later keeps that original attribution rather than overwriting it.
    const firstEverEnabling = hunterEnabled && !base.enabledAt;
    const enabledAt = firstEverEnabling ? now : base.enabledAt;
    const enabledByUserId = firstEverEnabling ? userId : base.enabledByUserId;

    await db
      .prepare(
        `INSERT INTO hunter_source_settings
          (video_id, hunter_enabled, search_priority, enabled_at, enabled_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (video_id) DO UPDATE SET
           hunter_enabled = excluded.hunter_enabled,
           search_priority = excluded.search_priority,
           enabled_at = excluded.enabled_at,
           enabled_by_user_id = excluded.enabled_by_user_id,
           updated_at = excluded.updated_at`
      )
      .bind(videoId, hunterEnabled ? 1 : 0, searchPriority ?? base.searchPriority, enabledAt, enabledByUserId, now, now)
      .run();

    const settings = await getHunterSourceSettings(db, videoId);
    return json({ settings: settings! });
  } catch (err) {
    return errorResponse(err);
  }
};
