import type { ApiHandler } from "../../../lib/env";
import { errorResponse, json, readJson } from "../../../lib/http";
import { nowIso } from "../../../lib/ids";
import { getCombinationFolderOrThrow } from "../../../lib/db";
import { withComputedFolderFields } from "../../../lib/folders";
import { requireStringArray } from "../../../lib/validation";

export const onRequestPost: ApiHandler = async (context) => {
  try {
    const folderId = context.params.id as string;
    const folder = await getCombinationFolderOrThrow(context.env.DB, folderId);
    const db = context.env.DB;

    const body = await readJson<{ videoIds: string[] }>(context.request);
    const videoIds = requireStringArray(body.videoIds, "videoIds");
    const now = nowIso();

    if (videoIds.length > 0) {
      const statements = videoIds.map((videoId) =>
        db
          .prepare(
            `INSERT INTO combination_folder_videos (combination_folder_id, video_id, added_at)
             VALUES (?, ?, ?)
             ON CONFLICT (combination_folder_id, video_id) DO NOTHING`
          )
          .bind(folderId, videoId, now)
      );
      await db.batch(statements);
    }

    const [computed] = await withComputedFolderFields(db, [folder]);
    return json({ combinationFolder: computed }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
};
