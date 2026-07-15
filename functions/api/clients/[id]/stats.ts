import type { Env } from "../../../lib/env";
import { errorResponse, json } from "../../../lib/http";
import { getClientOrThrow } from "../../../lib/db";
import { computeDeadline } from "../../../../shared/dates";
import type { ClientStats } from "../../../../shared/types";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const clientId = context.params.id as string;
    await getClientOrThrow(context.env.DB, clientId);
    const db = context.env.DB;

    const totalRow = await db
      .prepare("SELECT COUNT(*) as count FROM videos WHERE client_id = ?")
      .bind(clientId)
      .first<{ count: number }>();

    const unassignedRow = await db
      .prepare(
        `SELECT COUNT(*) as count FROM videos v
         WHERE v.client_id = ?
         AND NOT EXISTS (SELECT 1 FROM combination_folder_videos cfv WHERE cfv.video_id = v.id)`
      )
      .bind(clientId)
      .first<{ count: number }>();

    const pubDates = await db
      .prepare("SELECT publication_date FROM videos WHERE client_id = ?")
      .bind(clientId)
      .all<{ publication_date: string }>();

    const now = new Date();
    const dueSoonVideos = pubDates.results.filter(
      (row) => computeDeadline(row.publication_date, now).daysRemaining <= 30
    ).length;

    const pullRow = await db
      .prepare(
        "SELECT MAX(last_pull_at) as most_recent FROM social_accounts WHERE client_id = ? AND last_pull_at IS NOT NULL"
      )
      .bind(clientId)
      .first<{ most_recent: string | null }>();

    const stats: ClientStats = {
      totalVideos: totalRow?.count ?? 0,
      unassignedVideos: unassignedRow?.count ?? 0,
      dueSoonVideos,
      mostRecentPullAt: pullRow?.most_recent ?? null,
    };

    return json({ stats });
  } catch (err) {
    return errorResponse(err);
  }
};
