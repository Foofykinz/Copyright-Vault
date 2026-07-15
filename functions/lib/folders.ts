import { computeDeadline, earliestDate } from "../../shared/dates";
import type { CombinationFolder, CombinationFolderWithComputed } from "../../shared/types";

/** Attaches earliest-publication-date / deadline / video-count fields, computed fresh from source videos. */
export async function withComputedFolderFields(
  db: D1Database,
  folders: CombinationFolder[]
): Promise<CombinationFolderWithComputed[]> {
  if (folders.length === 0) return [];

  const rows = await db
    .prepare(
      `SELECT cfv.combination_folder_id as folder_id, v.publication_date as publication_date
       FROM combination_folder_videos cfv
       JOIN videos v ON v.id = cfv.video_id
       WHERE cfv.combination_folder_id IN (${folders.map(() => "?").join(",")})`
    )
    .bind(...folders.map((f) => f.id))
    .all<{ folder_id: string; publication_date: string }>();

  const datesByFolder = new Map<string, string[]>();
  const countByFolder = new Map<string, number>();
  for (const row of rows.results) {
    const dates = datesByFolder.get(row.folder_id) ?? [];
    dates.push(row.publication_date);
    datesByFolder.set(row.folder_id, dates);
    countByFolder.set(row.folder_id, (countByFolder.get(row.folder_id) ?? 0) + 1);
  }

  const now = new Date();
  return folders.map((folder) => {
    const dates = datesByFolder.get(folder.id) ?? [];
    const earliest = earliestDate(dates);
    const deadline = earliest ? computeDeadline(earliest, now) : null;
    return {
      ...folder,
      earliestPublicationDate: earliest,
      registrationDeadline: deadline?.registrationDeadline ?? null,
      daysRemaining: deadline?.daysRemaining ?? null,
      deadlineStatus: deadline?.status ?? null,
      videoCount: countByFolder.get(folder.id) ?? 0,
    };
  });
}
