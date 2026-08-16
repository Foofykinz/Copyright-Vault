import type { ApiHandler } from "../../lib/env";
import { errorResponse, json } from "../../lib/http";
import { computeDeadline } from "../../../shared/dates";
import type { DeadlineStatus, DeadlineVideo, Platform } from "../../../shared/types";

interface Row {
  id: string;
  client_id: string;
  client_name: string;
  social_account_id: string;
  platform: string;
  video_url: string;
  caption: string | null;
  publication_date: string;
}

const ATTENTION_STATUSES: DeadlineStatus[] = ["amber", "urgent", "expired"];

/**
 * Every video across every (non-archived) client, filtered to whichever deadline statuses need
 * attention — the point of this list is "what's coming due," not "every video ever," so with no
 * ?status= filter it defaults to amber+urgent+expired rather than including "on track" too.
 * Sorted soonest-due (or most overdue) first.
 */
export const onRequestGet: ApiHandler = async (context) => {
  try {
    const statusParam = new URL(context.request.url).searchParams.get("status") as DeadlineStatus | null;
    const wanted = statusParam ? [statusParam] : ATTENTION_STATUSES;

    const rows = await context.env.DB.prepare(
      `SELECT v.id as id, v.client_id as client_id, c.name as client_name, v.social_account_id as social_account_id,
              v.platform as platform, v.video_url as video_url, v.caption as caption, v.publication_date as publication_date
       FROM videos v
       JOIN clients c ON c.id = v.client_id
       WHERE c.archived = 0
       ORDER BY v.publication_date ASC`
    ).all<Row>();

    const now = new Date();
    const videos: DeadlineVideo[] = [];
    for (const row of rows.results) {
      const deadline = computeDeadline(row.publication_date, now);
      if (!wanted.includes(deadline.status)) continue;
      videos.push({
        id: row.id,
        clientId: row.client_id,
        clientName: row.client_name,
        socialAccountId: row.social_account_id,
        platform: row.platform as Platform,
        videoUrl: row.video_url,
        caption: row.caption,
        publicationDate: row.publication_date,
        registrationDeadline: deadline.registrationDeadline,
        daysRemaining: deadline.daysRemaining,
        deadlineStatus: deadline.status,
      });
    }
    videos.sort((a, b) => a.daysRemaining - b.daysRemaining);

    return json({ videos });
  } catch (err) {
    return errorResponse(err);
  }
};
