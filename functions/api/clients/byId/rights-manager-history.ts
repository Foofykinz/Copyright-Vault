import type { ApiHandler } from "../../../lib/env";
import { errorResponse, json } from "../../../lib/http";
import { getClientOrThrow, mapVideo } from "../../../lib/db";
import type { RightsManagerBatchWithVideos, Video } from "../../../../shared/types";

interface BatchRow {
  id: string;
  name: string;
  created_at: string;
}

export const onRequestGet: ApiHandler = async (context) => {
  try {
    const clientId = context.params.id as string;
    await getClientOrThrow(context.env.DB, clientId);
    const db = context.env.DB;

    const batchRows = await db
      .prepare("SELECT id, name, created_at FROM rights_manager_batches WHERE client_id = ? ORDER BY created_at DESC")
      .bind(clientId)
      .all<BatchRow>();

    const videoRows =
      batchRows.results.length === 0
        ? { results: [] as { batch_id: string; [key: string]: unknown }[] }
        : await db
            .prepare(
              `SELECT rmbv.rights_manager_batch_id as batch_id, v.*
               FROM rights_manager_batch_videos rmbv
               JOIN videos v ON v.id = rmbv.video_id
               JOIN rights_manager_batches b ON b.id = rmbv.rights_manager_batch_id
               WHERE b.client_id = ?
               ORDER BY v.publication_date DESC`
            )
            .bind(clientId)
            .all<{ batch_id: string }>();

    const videosByBatch = new Map<string, Video[]>();
    for (const row of videoRows.results) {
      const list = videosByBatch.get(row.batch_id) ?? [];
      list.push(mapVideo(row as never));
      videosByBatch.set(row.batch_id, list);
    }

    const batches: RightsManagerBatchWithVideos[] = batchRows.results.map((b) => {
      const videos = videosByBatch.get(b.id) ?? [];
      return { id: b.id, name: b.name, createdAt: b.created_at, videoCount: videos.length, videos };
    });

    return json({ batches });
  } catch (err) {
    return errorResponse(err);
  }
};
