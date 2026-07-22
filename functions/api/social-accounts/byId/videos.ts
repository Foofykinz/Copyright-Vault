import type { ApiHandler } from "../../../lib/env";
import { errorResponse, json, readJson } from "../../../lib/http";
import { generateId, nowIso } from "../../../lib/ids";
import { getSocialAccountOrThrow, mapVideo } from "../../../lib/db";
import { optionalNonNegativeInt, optionalString, requireIsoDate, requireUrl } from "../../../lib/validation";
import { computeDeadline } from "../../../../shared/dates";
import type { CombinationFolderSummary, CreateVideoInput, VideoWithDeadline } from "../../../../shared/types";

export const onRequestGet: ApiHandler = async (context) => {
  try {
    const socialAccountId = context.params.id as string;
    const account = await getSocialAccountOrThrow(context.env.DB, socialAccountId);
    const db = context.env.DB;

    const videoRows = await db
      .prepare("SELECT * FROM videos WHERE social_account_id = ? ORDER BY publication_date DESC")
      .bind(socialAccountId)
      .all();

    const videos = videoRows.results.map((r) => mapVideo(r as never));

    // Joins through videos (filtered by social_account_id, a single bound parameter) rather than
    // an IN (...) list sized by video count — D1 caps bound parameters per statement, and a large
    // account's video list was exceeding it, breaking the whole page.
    const folderRows =
      videos.length === 0
        ? { results: [] as { video_id: string; id: string; name: string; color: string }[] }
        : await db
            .prepare(
              `SELECT cfv.video_id as video_id, cf.id as id, cf.name as name, cf.color as color
               FROM combination_folder_videos cfv
               JOIN combination_folders cf ON cf.id = cfv.combination_folder_id
               JOIN videos v ON v.id = cfv.video_id
               WHERE v.social_account_id = ?`
            )
            .bind(socialAccountId)
            .all<{ video_id: string; id: string; name: string; color: string }>();

    const foldersByVideo = new Map<string, CombinationFolderSummary[]>();
    for (const row of folderRows.results) {
      const list = foldersByVideo.get(row.video_id) ?? [];
      list.push({ id: row.id, name: row.name, color: row.color });
      foldersByVideo.set(row.video_id, list);
    }

    const now = new Date();
    const withDeadline: VideoWithDeadline[] = videos.map((video) => {
      const deadline = computeDeadline(video.publicationDate, now);
      return {
        ...video,
        registrationDeadline: deadline.registrationDeadline,
        daysRemaining: deadline.daysRemaining,
        deadlineStatus: deadline.status,
        folders: foldersByVideo.get(video.id) ?? [],
      };
    });

    return json({ socialAccount: account, videos: withDeadline });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestPost: ApiHandler = async (context) => {
  try {
    const socialAccountId = context.params.id as string;
    const account = await getSocialAccountOrThrow(context.env.DB, socialAccountId);
    const body = await readJson<CreateVideoInput>(context.request);

    const videoUrl = requireUrl(body.videoUrl, "videoUrl");
    const publicationDate = requireIsoDate(body.publicationDate, "publicationDate");
    const caption = optionalString(body.caption);
    const viewCount = optionalNonNegativeInt(body.viewCount, "viewCount", 0);
    const notes = optionalString(body.notes);
    const thumbnailUrl = body.thumbnailUrl ? requireUrl(body.thumbnailUrl, "thumbnailUrl") : null;
    const viewCountCheckedAt = viewCount > 0 ? nowIso() : null;

    const id = generateId();
    const now = nowIso();

    await context.env.DB.prepare(
      `INSERT INTO videos
        (id, client_id, social_account_id, platform, video_url, publication_date, caption, view_count,
         view_count_checked_at, thumbnail_url, notes, collected_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        account.clientId,
        socialAccountId,
        account.platform,
        videoUrl,
        publicationDate,
        caption,
        viewCount,
        viewCountCheckedAt,
        thumbnailUrl,
        notes,
        now,
        now,
        now
      )
      .run();

    const deadline = computeDeadline(publicationDate);
    const video: VideoWithDeadline = {
      id,
      clientId: account.clientId,
      socialAccountId,
      platform: account.platform,
      videoUrl,
      publicationDate,
      caption,
      viewCount,
      viewCountCheckedAt,
      thumbnailUrl,
      notes,
      youtubeCategory: null,
      rightsManagerSentAt: null,
      collectedAt: now,
      createdAt: now,
      updatedAt: now,
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
