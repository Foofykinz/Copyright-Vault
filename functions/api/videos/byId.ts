import type { ApiHandler } from "../../lib/env";
import { errorResponse, json, readJson } from "../../lib/http";
import { nowIso } from "../../lib/ids";
import { getVideoOrThrow } from "../../lib/db";
import { optionalNonNegativeInt, optionalString, requireIsoDate, requireUrl } from "../../lib/validation";
import { computeDeadline } from "../../../shared/dates";
import type { CombinationFolderSummary, UpdateVideoInput, VideoWithDeadline } from "../../../shared/types";

async function foldersForVideo(db: D1Database, videoId: string): Promise<CombinationFolderSummary[]> {
  const rows = await db
    .prepare(
      `SELECT cf.id as id, cf.name as name, cf.color as color
       FROM combination_folder_videos cfv
       JOIN combination_folders cf ON cf.id = cfv.combination_folder_id
       WHERE cfv.video_id = ?`
    )
    .bind(videoId)
    .all<CombinationFolderSummary>();
  return rows.results;
}

export const onRequestGet: ApiHandler = async (context) => {
  try {
    const video = await getVideoOrThrow(context.env.DB, context.params.id as string);
    const deadline = computeDeadline(video.publicationDate);
    const withDeadline: VideoWithDeadline = {
      ...video,
      registrationDeadline: deadline.registrationDeadline,
      daysRemaining: deadline.daysRemaining,
      deadlineStatus: deadline.status,
      folders: await foldersForVideo(context.env.DB, video.id),
    };
    return json({ video: withDeadline });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestPatch: ApiHandler = async (context) => {
  try {
    const id = context.params.id as string;
    await getVideoOrThrow(context.env.DB, id);
    const body = await readJson<UpdateVideoInput>(context.request);

    const updates: string[] = [];
    const values: unknown[] = [];

    if (body.videoUrl !== undefined) {
      updates.push("video_url = ?");
      values.push(requireUrl(body.videoUrl, "videoUrl"));
    }
    if (body.publicationDate !== undefined) {
      updates.push("publication_date = ?");
      values.push(requireIsoDate(body.publicationDate, "publicationDate"));
    }
    if (body.caption !== undefined) {
      updates.push("caption = ?");
      values.push(optionalString(body.caption));
    }
    if (body.viewCount !== undefined) {
      updates.push("view_count = ?", "view_count_checked_at = ?");
      values.push(optionalNonNegativeInt(body.viewCount, "viewCount"), nowIso());
    }
    if (body.notes !== undefined) {
      updates.push("notes = ?");
      values.push(optionalString(body.notes));
    }

    if (updates.length > 0) {
      updates.push("updated_at = ?");
      values.push(nowIso());
      values.push(id);
      await context.env.DB.prepare(`UPDATE videos SET ${updates.join(", ")} WHERE id = ?`)
        .bind(...values)
        .run();
    }

    const video = await getVideoOrThrow(context.env.DB, id);
    const deadline = computeDeadline(video.publicationDate);
    const withDeadline: VideoWithDeadline = {
      ...video,
      registrationDeadline: deadline.registrationDeadline,
      daysRemaining: deadline.daysRemaining,
      deadlineStatus: deadline.status,
      folders: await foldersForVideo(context.env.DB, video.id),
    };
    return json({ video: withDeadline });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestDelete: ApiHandler = async (context) => {
  try {
    const id = context.params.id as string;
    await getVideoOrThrow(context.env.DB, id);
    await context.env.DB.prepare("DELETE FROM videos WHERE id = ?").bind(id).run();
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
};
