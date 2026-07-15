import type { ApiHandler } from "../../lib/env";
import { errorResponse, json, readJson } from "../../lib/http";
import { generateId, nowIso } from "../../lib/ids";
import { getClientOrThrow, mapCombinationFolder } from "../../lib/db";
import { withComputedFolderFields } from "../../lib/folders";
import { requireString, requireStringArray } from "../../lib/validation";
import { nextFolderColor } from "../../../shared/colors";
import type { CreateCombinationFolderInput } from "../../../shared/types";

export const onRequestGet: ApiHandler = async (context) => {
  try {
    const clientId = new URL(context.request.url).searchParams.get("clientId");
    const db = context.env.DB;

    const rows = clientId
      ? await db
          .prepare("SELECT * FROM combination_folders WHERE client_id = ? ORDER BY created_at ASC")
          .bind(clientId)
          .all()
      : await db.prepare("SELECT * FROM combination_folders ORDER BY created_at ASC").all();

    const folders = rows.results.map((r) => mapCombinationFolder(r as never));
    const computed = await withComputedFolderFields(db, folders);
    return json({ combinationFolders: computed });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestPost: ApiHandler = async (context) => {
  try {
    const db = context.env.DB;
    const body = await readJson<CreateCombinationFolderInput>(context.request);

    const clientId = requireString(body.clientId, "clientId");
    await getClientOrThrow(db, clientId);
    const name = requireString(body.name, "name", { maxLength: 200 });
    const videoIds = body.videoIds ? requireStringArray(body.videoIds, "videoIds") : [];

    const countRow = await db
      .prepare("SELECT COUNT(*) as count FROM combination_folders WHERE client_id = ?")
      .bind(clientId)
      .first<{ count: number }>();
    const color = nextFolderColor(countRow?.count ?? 0);

    const id = generateId();
    const now = nowIso();

    await db
      .prepare(
        `INSERT INTO combination_folders (id, client_id, name, color, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`
      )
      .bind(id, clientId, name, color, now, now)
      .run();

    if (videoIds.length > 0) {
      const statements = videoIds.map((videoId) =>
        db
          .prepare(
            "INSERT INTO combination_folder_videos (combination_folder_id, video_id, added_at) VALUES (?, ?, ?)"
          )
          .bind(id, videoId, now)
      );
      await db.batch(statements);
    }

    const folder = mapCombinationFolder({
      id,
      client_id: clientId,
      name,
      color,
      notes: null,
      created_at: now,
      updated_at: now,
    });
    const [computed] = await withComputedFolderFields(db, [folder]);
    return json({ combinationFolder: computed }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
};
