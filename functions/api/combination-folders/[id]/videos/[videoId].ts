import type { Env } from "../../../../lib/env";
import { errorResponse, json } from "../../../../lib/http";
import { getCombinationFolderOrThrow } from "../../../../lib/db";
import { withComputedFolderFields } from "../../../../lib/folders";

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  try {
    const folderId = context.params.id as string;
    const videoId = context.params.videoId as string;
    const folder = await getCombinationFolderOrThrow(context.env.DB, folderId);
    const db = context.env.DB;

    await db
      .prepare("DELETE FROM combination_folder_videos WHERE combination_folder_id = ? AND video_id = ?")
      .bind(folderId, videoId)
      .run();

    const [computed] = await withComputedFolderFields(db, [folder]);
    return json({ combinationFolder: computed });
  } catch (err) {
    return errorResponse(err);
  }
};
