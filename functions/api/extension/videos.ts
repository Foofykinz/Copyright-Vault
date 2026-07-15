import type { Env } from "../../lib/env";
import { errorResponse, json, readJson, UnauthorizedError, ValidationError } from "../../lib/http";
import { generateId, nowIso } from "../../lib/ids";
import { getClientOrThrow, getSocialAccountOrThrow, mapVideo } from "../../lib/db";
import {
  optionalIsoDate,
  optionalNonNegativeInt,
  optionalString,
  requirePlatform,
  requireIsoDate,
  requireString,
  requireUrl,
} from "../../lib/validation";
import { computeDeadline } from "../../../shared/dates";
import type { ExtensionVideoImportInput, VideoWithDeadline } from "../../../shared/types";

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
 * Response 201:
 * { "video": { ...VideoWithDeadline } }
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
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

    const client = await getClientOrThrow(context.env.DB, clientId);
    const account = await getSocialAccountOrThrow(context.env.DB, socialAccountId);
    if (account.clientId !== client.id) {
      throw new ValidationError("socialAccountId does not belong to clientId.", { socialAccountId: "mismatch" });
    }

    const db = context.env.DB;
    const id = generateId();
    const now = nowIso();

    await db
      .prepare(
        `INSERT INTO videos
          (id, client_id, social_account_id, platform, video_url, publication_date, caption, view_count,
           view_count_checked_at, thumbnail_url, notes, collected_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`
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
        now,
        now,
        now
      )
      .run();

    await db.prepare("UPDATE social_accounts SET last_pull_at = ?, updated_at = ? WHERE id = ?").bind(now, now, socialAccountId).run();

    const deadline = computeDeadline(publicationDate);
    const video: VideoWithDeadline = {
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
        thumbnail_url: null,
        notes: null,
        collected_at: now,
        created_at: now,
        updated_at: now,
      }),
      registrationDeadline: deadline.registrationDeadline,
      daysRemaining: deadline.daysRemaining,
      deadlineStatus: deadline.status,
      folders: [],
    };

    return json({ video }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
};

function requireBearerToken(request: Request, env: Env): void {
  if (!env.EXTENSION_API_TOKEN) return; // no token configured yet — open in local dev
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token !== env.EXTENSION_API_TOKEN) {
    throw new UnauthorizedError("Invalid or missing extension API token.");
  }
}
