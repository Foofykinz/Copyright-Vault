import type { ApiHandler } from "../../lib/env";
import { errorResponse, json } from "../../lib/http";
import { computeDeadline } from "../../../shared/dates";
import type { DashboardStats, DeadlineStatus, InfringementStatus } from "../../../shared/types";

const DEADLINE_STATUSES: DeadlineStatus[] = ["neutral", "amber", "urgent", "expired"];
const INFRINGEMENT_STATUSES: InfringementStatus[] = ["needs_review", "logged", "takedown", "ignored"];

export const onRequestGet: ApiHandler = async (context) => {
  try {
    const db = context.env.DB;

    const [clientsRow, socialAccountsRow, videosRow, sentRow, infringementsRow, pubDates, infringementStatusRows] =
      await Promise.all([
        db.prepare("SELECT COUNT(*) as count FROM clients WHERE archived = 0").first<{ count: number }>(),
        db.prepare("SELECT COUNT(*) as count FROM social_accounts").first<{ count: number }>(),
        db.prepare("SELECT COUNT(*) as count FROM videos").first<{ count: number }>(),
        db
          .prepare("SELECT COUNT(*) as count FROM videos WHERE rights_manager_sent_at IS NOT NULL")
          .first<{ count: number }>(),
        db.prepare("SELECT COUNT(*) as count FROM infringement_reports").first<{ count: number }>(),
        db.prepare("SELECT publication_date FROM videos").all<{ publication_date: string }>(),
        db
          .prepare("SELECT status, COUNT(*) as count FROM infringement_reports GROUP BY status")
          .all<{ status: InfringementStatus; count: number }>(),
      ]);

    const now = new Date();
    const videosByDeadlineStatus = Object.fromEntries(DEADLINE_STATUSES.map((s) => [s, 0])) as Record<
      DeadlineStatus,
      number
    >;
    for (const row of pubDates.results) {
      videosByDeadlineStatus[computeDeadline(row.publication_date, now).status]++;
    }

    const infringementsByStatus = Object.fromEntries(INFRINGEMENT_STATUSES.map((s) => [s, 0])) as Record<
      InfringementStatus,
      number
    >;
    for (const row of infringementStatusRows.results) {
      infringementsByStatus[row.status] = row.count;
    }

    const stats: DashboardStats = {
      totalClients: clientsRow?.count ?? 0,
      totalSocialAccounts: socialAccountsRow?.count ?? 0,
      totalVideos: videosRow?.count ?? 0,
      videosByDeadlineStatus,
      totalSentToRightsManager: sentRow?.count ?? 0,
      totalInfringementReports: infringementsRow?.count ?? 0,
      infringementsByStatus,
    };

    return json({ stats });
  } catch (err) {
    return errorResponse(err);
  }
};
