import type { ApiHandler } from "../../lib/env";
import { errorResponse, json, readJson, ValidationError } from "../../lib/http";
import { requireBearerToken } from "../../lib/auth";
import { nowIso } from "../../lib/ids";
import { getClientOrThrow, getSocialAccountOrThrow } from "../../lib/db";
import { optionalIsoDate, requireString } from "../../lib/validation";
import {
  classifyVideo,
  fetchConfirmedShortsIds,
  fetchUploadsPlaylistItems,
  fetchVideoDetails,
  mapYouTubeVideo,
  normalizeYoutubeHandle,
  resolveChannel,
} from "../../lib/youtube";
import type { YouTubeChannelVideosRequest, YouTubeChannelVideosResponse, YouTubeClassificationStatus } from "../../../shared/types";

/**
 * Retrieves a YouTube channel's public uploads (via the official Data API), classifies each as a
 * Short, Live, or regular upload, and returns them normalized for the extension's existing
 * scan-review workflow. See extension/README.md and the project's YouTube integration notes for
 * the classification rules and the Shorts-coverage limitation.
 *
 * Sample request:
 *
 * POST /api/youtube/channel-videos
 * Authorization: Bearer <EXTENSION_API_TOKEN>
 * Content-Type: application/json
 *
 * { "clientId": "...", "accountId": "...", "channelUrl": "https://www.youtube.com/@example",
 *   "startDate": "2026-06-01", "endDate": "2026-07-16" }
 */
export const onRequestPost: ApiHandler = async (context) => {
  try {
    requireBearerToken(context.request, context.env);

    const body = await readJson<YouTubeChannelVideosRequest>(context.request);
    const clientId = requireString(body.clientId, "clientId");
    const accountId = requireString(body.accountId, "accountId");
    const startDate = optionalIsoDate(body.startDate, "startDate");
    const endDate = optionalIsoDate(body.endDate, "endDate");

    // Identity gate: getClientOrThrow/getSocialAccountOrThrow 404 if either doesn't exist, and the
    // two checks below confirm the account actually belongs to clientId and is a YouTube account —
    // all three must pass before anything is persisted to social_accounts further down. accountId
    // alone is never enough to authorize a write; a caller can't use a valid token plus a stray
    // accountId to update an account outside the clientId they claimed.
    const client = await getClientOrThrow(context.env.DB, clientId);
    const account = await getSocialAccountOrThrow(context.env.DB, accountId);
    if (account.clientId !== client.id) {
      throw new ValidationError("accountId does not belong to clientId.", { accountId: "mismatch" });
    }
    if (account.platform !== "youtube") {
      throw new ValidationError("Social account is not a YouTube channel.", { accountId: "wrong_platform" });
    }

    const apiKey = context.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      throw new ValidationError("YOUTUBE_API_KEY is not configured on the server.", { apiKey: "missing" });
    }

    // Resolve + cache once; later scans reuse the cached channelId/uploadsPlaylistId rather than
    // re-resolving on every scan.
    let channelId = account.youtubeChannelId ?? null;
    let uploadsPlaylistId = account.youtubeUploadsPlaylistId ?? null;
    // Re-normalized even when reading back a cached value, in case it was persisted by an older
    // version of this endpoint before normalizeYoutubeHandle existed.
    let handle = normalizeYoutubeHandle(account.youtubeHandle);

    if (!channelId || !uploadsPlaylistId) {
      const source = body.channelUrl || account.profileUrl;
      if (!source) {
        throw new ValidationError(
          "This YouTube account has no channel URL yet — add one on the client's Social Account first.",
          { channelUrl: "required" }
        );
      }
      const resolved = await resolveChannel(source, apiKey);
      channelId = resolved.channelId;
      uploadsPlaylistId = resolved.uploadsPlaylistId;
      handle = resolved.handle;

      await context.env.DB.prepare(
        "UPDATE social_accounts SET youtube_channel_id = ?, youtube_uploads_playlist_id = ?, youtube_handle = ?, updated_at = ? WHERE id = ?"
      )
        .bind(channelId, uploadsPlaylistId, handle, nowIso(), accountId)
        .run();
    }

    const channelTitle = account.accountName;

    const playlistRefs = await fetchUploadsPlaylistItems(uploadsPlaylistId, apiKey, startDate);
    if (playlistRefs.length === 0) {
      const response: YouTubeChannelVideosResponse = {
        channel: { channelId, title: channelTitle, handle, uploadsPlaylistId },
        videos: [],
        counts: { shorts: 0, lives: 0, uploads: 0 },
        classificationStatus: "complete",
      };
      return json(response);
    }

    const rawVideos = await fetchVideoDetails(
      playlistRefs.map((r) => r.videoId),
      apiKey
    );

    let confirmedShortIds = new Set<string>();
    let shortsHasMore = false;
    let shortsLookupFailed = false;
    try {
      const confirmed = await fetchConfirmedShortsIds(channelId);
      confirmedShortIds = confirmed.ids;
      shortsHasMore = confirmed.hasMore;
    } catch {
      // Don't lose the retrieved videos over a Shorts-page hiccup — fall through with an empty
      // confirmed set (everything not a live signal lands as "upload") and report the limitation
      // via classificationStatus instead of silently claiming a complete split.
      shortsLookupFailed = true;
    }

    const seen = new Set<string>();
    const videos: YouTubeChannelVideosResponse["videos"] = [];
    for (const raw of rawVideos) {
      if (!raw?.id || seen.has(raw.id)) continue;
      // Ownership check — never trust a video into this channel's results without verifying it.
      if (raw.snippet?.channelId !== channelId) continue;
      if (raw.status?.privacyStatus && raw.status.privacyStatus !== "public") continue;
      const publishedAt = raw.snippet?.publishedAt;
      if (!publishedAt) continue;
      if (startDate && publishedAt.slice(0, 10) < startDate) continue;
      if (endDate && publishedAt.slice(0, 10) > endDate) continue;

      seen.add(raw.id);
      const classified = classifyVideo(raw, confirmedShortIds);
      videos.push(mapYouTubeVideo(raw, classified, channelTitle, handle));
    }

    const counts = { shorts: 0, lives: 0, uploads: 0 };
    for (const v of videos) {
      if (v.category === "short") counts.shorts += 1;
      else if (v.category === "live") counts.lives += 1;
      else counts.uploads += 1;
    }

    // Coverage check: the Shorts lookup only covers a channel's most recent batch (see
    // fetchConfirmedShortsIds). If the channel has more Shorts beyond that batch (hasMore) and
    // either this scan has no floor (startDate unset) or reaches earlier than the oldest Short we
    // could confirm, older content in range may include an unconfirmed Short mislabeled "upload".
    const oldestConfirmedShortDate = videos
      .filter((v) => v.category === "short")
      .map((v) => v.publicationDate)
      .sort()[0];
    const shortsCoverageLimited =
      !shortsLookupFailed && shortsHasMore && (!startDate || !oldestConfirmedShortDate || startDate < oldestConfirmedShortDate.slice(0, 10));

    const classificationStatus: YouTubeClassificationStatus = shortsLookupFailed
      ? "shorts_lookup_failed"
      : shortsCoverageLimited
        ? "incomplete_older_shorts"
        : "complete";

    const response: YouTubeChannelVideosResponse = {
      channel: { channelId, title: channelTitle, handle, uploadsPlaylistId },
      videos,
      counts,
      classificationStatus,
    };
    return json(response);
  } catch (err) {
    return errorResponse(err);
  }
};
