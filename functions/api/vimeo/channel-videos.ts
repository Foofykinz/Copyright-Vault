import type { ApiHandler } from "../../lib/env";
import { errorResponse, json, readJson, ValidationError } from "../../lib/http";
import { requireBearerToken } from "../../lib/auth";
import { nowIso } from "../../lib/ids";
import { getClientOrThrow, getSocialAccountOrThrow } from "../../lib/db";
import { optionalIsoDate, requireString } from "../../lib/validation";
import { fetchUserVideos, resolveVimeoUser } from "../../lib/vimeo";
import type { VimeoChannelVideosRequest, VimeoChannelVideosResponse } from "../../../shared/types";
import { centralDateString } from "../../../shared/dates";

/**
 * Retrieves a Vimeo user's public videos (via the official Vimeo API) and returns them normalized
 * for the extension's existing scan-review workflow — same shape/spirit as
 * functions/api/youtube/channel-videos.ts, account-driven rather than tab-driven.
 *
 * Sample request:
 *
 * POST /api/vimeo/channel-videos
 * Authorization: Bearer <EXTENSION_API_TOKEN>
 * Content-Type: application/json
 *
 * { "clientId": "...", "accountId": "...", "channelUrl": "https://vimeo.com/example",
 *   "startDate": "2026-06-01", "endDate": "2026-07-16" }
 */
export const onRequestPost: ApiHandler = async (context) => {
  try {
    requireBearerToken(context.request, context.env);

    const body = await readJson<VimeoChannelVideosRequest>(context.request);
    const clientId = requireString(body.clientId, "clientId");
    const accountId = requireString(body.accountId, "accountId");
    const startDate = optionalIsoDate(body.startDate, "startDate");
    const endDate = optionalIsoDate(body.endDate, "endDate");

    // Identity gate — see functions/api/youtube/channel-videos.ts for why all three checks must
    // pass before anything is persisted: accountId alone can't be used to touch an account outside
    // the clientId the caller claimed.
    const client = await getClientOrThrow(context.env.DB, clientId);
    const account = await getSocialAccountOrThrow(context.env.DB, accountId);
    if (account.clientId !== client.id) {
      throw new ValidationError("accountId does not belong to clientId.", { accountId: "mismatch" });
    }
    if (account.platform !== "vimeo") {
      throw new ValidationError("Social account is not a Vimeo account.", { accountId: "wrong_platform" });
    }

    const token = context.env.VIMEO_ACCESS_TOKEN;
    if (!token) {
      throw new ValidationError("VIMEO_ACCESS_TOKEN is not configured on the server.", { apiKey: "missing" });
    }

    // Resolve + cache once; later scans reuse the cached userId rather than re-resolving on every scan.
    let userId = account.vimeoUserId ?? null;
    let title = account.accountName;

    if (!userId) {
      const source = body.channelUrl || account.profileUrl;
      if (!source) {
        throw new ValidationError(
          "This Vimeo account has no profile URL yet — add one on the client's Social Account first.",
          { channelUrl: "required" }
        );
      }
      const resolved = await resolveVimeoUser(source, token);
      userId = resolved.userId;
      title = resolved.title;

      await context.env.DB.prepare("UPDATE social_accounts SET vimeo_user_id = ?, updated_at = ? WHERE id = ?")
        .bind(userId, nowIso(), accountId)
        .run();
    }

    const rawVideos = await fetchUserVideos(userId, token, startDate);

    const videos: VimeoChannelVideosResponse["videos"] = [];
    for (const v of rawVideos) {
      if (endDate && centralDateString(v.publicationDate) > endDate) continue;
      videos.push({
        videoId: v.videoId,
        videoUrl: v.videoUrl,
        title: v.title,
        caption: v.caption,
        publicationDate: v.publicationDate,
        viewCount: v.viewCount,
        thumbnailUrl: v.thumbnailUrl,
        channelTitle: title,
        durationSeconds: v.durationSeconds,
      });
    }

    const response: VimeoChannelVideosResponse = {
      channel: { userId, title },
      videos,
    };
    return json(response);
  } catch (err) {
    return errorResponse(err);
  }
};
