import type { ApiHandler } from "../../lib/env";
import { errorResponse, json, readJson, ValidationError } from "../../lib/http";
import { requireBearerToken } from "../../lib/auth";
import { generateId, nowIso } from "../../lib/ids";
import { getClientOrThrow, getSocialAccountOrThrow, mapVideo } from "../../lib/db";
import {
  optionalIsoDate,
  optionalNonNegativeInt,
  optionalString,
  optionalUrl,
  optionalYoutubeCategory,
  requirePlatform,
  requireIsoDate,
  requireString,
  requireUrl,
} from "../../lib/validation";
import { computeDeadline } from "../../../shared/dates";
import type { ExtensionVideoImportInput, ExtensionVideoImportResult } from "../../../shared/types";

/**
 * Import endpoint for the future browser extension. Not yet called by anything —
 * the frontend's "Pull recent videos" button is intentionally disabled until an
 * extension is connected and authenticated against this route.
 *
 * Sample request:
 *
 * POST /api/extension/videos
 * Authorization: Bearer <EXTENSION_API_TOKEN>
 * Content-Type: application/json
 *
 * {
 *   "clientId": "7a3367d6-6186-4d05-98a7-b7f770ea2ea1",
 *   "socialAccountId": "b1f2...",
 *   "platform": "tiktok",
 *   "profileUrl": "https://www.tiktok.com/@example",
 *   "pullStartDate": "2026-06-01",
 *   "videoUrl": "https://www.tiktok.com/@example/video/123456789",
 *   "publicationDate": "2026-07-10T18:04:00Z",
 *   "caption": "Original storm chase footage",
 *   "viewCount": 48200,
 *   "viewCountCheckedAt": "2026-07-15T09:00:00Z"
 * }
 *
 * Response 201 (new video created):
 * { "video": { ...VideoWithDeadline }, "duplicate": false }
 *
 * Response 200 (videoUrl already existed for this social account — no new row created):
 * { "video": { ...VideoWithDeadline }, "duplicate": true }
 */
export const onRequestPost: ApiHandler = async (context) => {
  try {
    requireBearerToken(context.request, context.env);

    const body = await readJson<ExtensionVideoImportInput>(context.request);

    const clientId = requireString(body.clientId, "clientId");
    const socialAccountId = requireString(body.socialAccountId, "socialAccountId");
    const platform = requirePlatform(body.platform);
    const videoUrl = requireUrl(body.videoUrl, "videoUrl");
    const publicationDate = requireIsoDate(body.publicationDate, "publicationDate");
    const caption = optionalString(body.caption);
    const viewCount = optionalNonNegativeInt(body.viewCount, "viewCount", 0);
    const viewCountCheckedAt = optionalIsoDate(body.viewCountCheckedAt, "viewCountCheckedAt");
    const thumbnailUrl = optionalUrl(body.thumbnailUrl, "thumbnailUrl");
    const youtubeCategory = optionalYoutubeCategory(body.youtubeCategory);

    const client = await getClientOrThrow(context.env.DB, clientId);
    const account = await getSocialAccountOrThrow(context.env.DB, socialAccountId);
    if (account.clientId !== client.id) {
      throw new ValidationError("socialAccountId does not belong to clientId.", { socialAccountId: "mismatch" });
    }

    const db = context.env.DB;
    const now = nowIso();

    // Dedup by (social_account_id, video_url) so a video already imported for this account is
    // never inserted twice, however many times it's scanned/sent. The pull still counts as
    // successful, so last_pull_at is updated either way.
    const existingRow = await db
      .prepare("SELECT * FROM videos WHERE social_account_id = ? AND video_url = ?")
      .bind(socialAccountId, videoUrl)
      .first();

    await db.prepare("UPDATE social_accounts SET last_pull_at = ?, updated_at = ? WHERE id = ?").bind(now, now, socialAccountId).run();

    if (existingRow) {
      const existingVideo = mapVideo(existingRow as never);
      const deadline = computeDeadline(existingVideo.publicationDate);
      const result: ExtensionVideoImportResult = {
        video: { ...existingVideo, registrationDeadline: deadline.registrationDeadline, daysRemaining: deadline.daysRemaining, deadlineStatus: deadline.status, folders: [] },
        duplicate: true,
      };
      return json(result, { status: 200 });
    }

    const id = generateId();

    await db
      .prepare(
        `INSERT INTO videos
          (id, client_id, social_account_id, platform, video_url, publication_date, caption, view_count,
           view_count_checked_at, thumbnail_url, notes, youtube_category, collected_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`
      )
      .bind(
        id,
        clientId,
        socialAccountId,
        platform,
        videoUrl,
        publicationDate,
        caption,
        viewCount,
        viewCountCheckedAt,
        thumbnailUrl,
        youtubeCategory,
        now,
        now,
        now
      )
      .run();

    const deadline = computeDeadline(publicationDate);
    const result: ExtensionVideoImportResult = {
      video: {
        ...mapVideo({
          id,
          client_id: clientId,
          social_account_id: socialAccountId,
          platform,
          video_url: videoUrl,
          publication_date: publicationDate,
          caption,
          view_count: viewCount,
          view_count_checked_at: viewCountCheckedAt,
          thumbnail_url: thumbnailUrl,
          notes: null,
          youtube_category: youtubeCategory,
          collected_at: now,
          created_at: now,
          updated_at: now,
        }),
        registrationDeadline: deadline.registrationDeadline,
        daysRemaining: deadline.daysRemaining,
        deadlineStatus: deadline.status,
        folders: [],
      },
      duplicate: false,
    };

    return json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
};
