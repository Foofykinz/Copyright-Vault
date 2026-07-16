import type { ApiHandler } from "../../lib/env";
import { errorResponse, json, readJson } from "../../lib/http";
import { nowIso } from "../../lib/ids";
import { getCombinationFolderOrThrow, mapVideo } from "../../lib/db";
import { withComputedFolderFields } from "../../lib/folders";
import { optionalString, requireString } from "../../lib/validation";
import { computeDeadline } from "../../../shared/dates";
import type { CombinationFolderSummary, UpdateCombinationFolderInput, VideoWithDeadline } from "../../../shared/types";

export const onRequestGet: ApiHandler = async (context) => {
  try {
    const id = context.params.id as string;
    const folder = await getCombinationFolderOrThrow(context.env.DB, id);
    const db = context.env.DB;
    const [computed] = await withComputedFolderFields(db, [folder]);

    const videoRows = await db
      .prepare(
        `SELECT v.* FROM videos v
         JOIN combination_folder_videos cfv ON cfv.video_id = v.id
         WHERE cfv.combination_folder_id = ?
         ORDER BY v.publication_date DESC`
      )
      .bind(id)
      .all();
    const videos = videoRows.results.map((r) => mapVideo(r as never));

    // Self-joins combination_folder_videos (scoped by this folder's id, a single bound parameter)
    // to find every folder each of those videos belongs to, rather than an IN (...) list sized by
    // video count — D1 caps bound parameters per statement, and a large folder was exceeding it.
    const folderRows =
      videos.length === 0
        ? { results: [] as { video_id: string; id: string; name: string; color: string }[] }
        : await db
            .prepare(
              `SELECT cfv2.video_id as video_id, cf.id as id, cf.name as name, cf.color as color
               FROM combination_folder_videos cfv1
               JOIN combination_folder_videos cfv2 ON cfv2.video_id = cfv1.video_id
               JOIN combination_folders cf ON cf.id = cfv2.combination_folder_id
               WHERE cfv1.combination_folder_id = ?`
            )
            .bind(id)
            .all<{ video_id: string; id: string; name: string; color: string }>();

    const foldersByVideo = new Map<string, CombinationFolderSummary[]>();
    for (const row of folderRows.results) {
      const list = foldersByVideo.get(row.video_id) ?? [];
      list.push({ id: row.id, name: row.name, color: row.color });
      foldersByVideo.set(row.video_id, list);
    }

    const now = new Date();
    const videosWithDeadline: VideoWithDeadline[] = videos.map((video) => {
      const deadline = computeDeadline(video.publicationDate, now);
      return {
        ...video,
        registrationDeadline: deadline.registrationDeadline,
        daysRemaining: deadline.daysRemaining,
        deadlineStatus: deadline.status,
        folders: foldersByVideo.get(video.id) ?? [],
      };
    });

    return json({ combinationFolder: computed, videos: videosWithDeadline });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestPatch: ApiHandler = async (context) => {
  try {
    const id = context.params.id as string;
    await getCombinationFolderOrThrow(context.env.DB, id);
    const body = await readJson<UpdateCombinationFolderInput>(context.request);

    const updates: string[] = [];
    const values: unknown[] = [];

    if (body.name !== undefined) {
      updates.push("name = ?");
      values.push(requireString(body.name, "name", { maxLength: 200 }));
    }
    if (body.notes !== undefined) {
      updates.push("notes = ?");
      values.push(optionalString(body.notes));
    }

    if (updates.length > 0) {
      updates.push("updated_at = ?");
      values.push(nowIso());
      values.push(id);
      await context.env.DB.prepare(`UPDATE combination_folders SET ${updates.join(", ")} WHERE id = ?`)
        .bind(...values)
        .run();
    }

    const updated = await getCombinationFolderOrThrow(context.env.DB, id);
    const [computed] = await withComputedFolderFields(context.env.DB, [updated]);
    return json({ combinationFolder: computed });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestDelete: ApiHandler = async (context) => {
  try {
    const id = context.params.id as string;
    await getCombinationFolderOrThrow(context.env.DB, id);
    await context.env.DB.prepare("DELETE FROM combination_folders WHERE id = ?").bind(id).run();
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
};
