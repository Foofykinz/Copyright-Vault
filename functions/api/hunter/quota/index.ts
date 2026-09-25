import type { ApiHandler } from "../../../lib/env";
import { errorResponse, json } from "../../../lib/http";
import { requireHunterAccess } from "../../../lib/hunterAuth";
import { getOrCreateTodayQuota } from "../../../lib/hunterQuota";

/**
 * Today's (Central time) YouTube API usage against Vault Hunter's configured search.list budget.
 * No search execution exists yet in this phase — this just establishes the read/create path so the
 * status is real and visible from day one, ahead of Phase 2 actually spending calls against it.
 */
export const onRequestGet: ApiHandler = async (context) => {
  try {
    await requireHunterAccess(context.request, context.env);
    const quota = await getOrCreateTodayQuota(context.env.DB, context.env);
    return json({ quota });
  } catch (err) {
    return errorResponse(err);
  }
};
