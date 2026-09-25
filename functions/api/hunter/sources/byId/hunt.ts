import type { ApiHandler } from "../../../../lib/env";
import { errorResponse, json } from "../../../../lib/http";
import { requireHunterAccess } from "../../../../lib/hunterAuth";
import { huntSource } from "../../../../lib/hunterRun";

/**
 * HUNT THIS SOURCE NOW — Phase 2's one functional milestone. Reads one real Vault source, generates
 * a small set of deterministic YouTube search queries from its own metadata, calls the official
 * YouTube Data API, deduplicates/scores the results, persists everything to D1, and returns full
 * beta diagnostics (see HuntSourceResult). Manual only — this does not require the source to be
 * hunter_enabled; triggering this route IS the explicit authorized manual Hunt action.
 */
export const onRequestPost: ApiHandler = async (context) => {
  try {
    const userId = await requireHunterAccess(context.request, context.env);
    const videoId = context.params.videoId as string;
    const result = await huntSource(context.env.DB, context.env, videoId, userId);
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
};
