import type { ApiHandler } from "../../../../lib/env";
import { errorResponse } from "../../../../lib/http";
import { getSocialAccountOrThrow } from "../../../../lib/db";
import { nowIso } from "../../../../lib/ids";
import { PLATFORM_LABELS, type Platform } from "../../../../../shared/types";
import { sanitizeForFilename } from "../../../../../shared/format";
import { addCalendarDays, centralDateString, REGISTRATION_WINDOW_DAYS, todayDateString } from "../../../../../shared/dates";

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// "Short" and "Registration Deadline" are appended at the end rather than inserted alongside "Live"
// -- Squeeze's importer already consumes this export (see the export's own doc comment below), and
// adding new columns after the existing ones is the lower-risk change for anything reading this
// positionally rather than by header name.
const CSV_HEADER = [
  "Client Name",
  "Platform",
  "Live",
  "Post URL",
  "Post Title",
  "Description",
  "Views",
  "Date Posted",
  "Short",
  "Registration Deadline",
];

interface ExportRow {
  client_name: string;
  platform: string;
  video_url: string;
  caption: string | null;
  publication_date: string;
  view_count: number;
  youtube_category: string | null;
}

/**
 * One row per video, for Squeeze's Rights Manager importer. Serializes exactly what's already
 * stored — no re-scraping or refreshing.
 *
 * "Description" is intentionally always blank: the schema only stores one freeform text field per
 * video (`caption`), which already doubles as the title (see functions/lib/youtube.ts — YouTube's
 * caption is sourced from the video title, not its description, since description is often
 * boilerplate). There's no second field to put here without adding new schema, which wasn't asked
 * for — left blank rather than duplicating the title or fabricating placeholder text.
 *
 * No separate "exclude photos" or "exclude reposts" filtering is needed here: neither is ever
 * persisted to `videos` in the first place — every scraper only captures actual videos, and
 * reposts/shares are excluded at scan time (see extension/README.md's per-platform notes).
 */
export const onRequestGet: ApiHandler = async (context) => {
  try {
    const socialAccountId = context.params.id as string;
    const account = await getSocialAccountOrThrow(context.env.DB, socialAccountId);

    const rows = await context.env.DB.prepare(
      `SELECT c.name as client_name, v.platform as platform, v.video_url as video_url,
              v.caption as caption, v.publication_date as publication_date,
              v.view_count as view_count, v.youtube_category as youtube_category
       FROM videos v
       JOIN clients c ON c.id = v.client_id
       WHERE v.social_account_id = ?
       ORDER BY v.publication_date ASC`
    )
      .bind(socialAccountId)
      .all<ExportRow>();

    if (rows.results.length > 0) {
      const now = nowIso();
      await context.env.DB.prepare(
        "UPDATE videos SET rights_manager_exported_at = ?, updated_at = ? WHERE social_account_id = ?"
      )
        .bind(now, now, socialAccountId)
        .run();
    }

    const lines = [CSV_HEADER.map(csvField).join(",")];
    for (const row of rows.results) {
      // "Live" and "Short" are only ever known for YouTube (the only platform this app classifies
      // as Short/Live/Upload) — left blank rather than a false "No" for every other platform, which
      // has no live/short detection at all.
      const live = row.youtube_category === null ? "" : row.youtube_category === "live" ? "Yes" : "No";
      const short = row.youtube_category === null ? "" : row.youtube_category === "short" ? "Yes" : "No";
      const registrationDeadline = addCalendarDays(row.publication_date, REGISTRATION_WINDOW_DAYS);
      lines.push(
        [
          csvField(row.client_name),
          csvField(PLATFORM_LABELS[row.platform as Platform] ?? row.platform),
          csvField(live),
          csvField(row.video_url),
          csvField(row.caption ?? ""),
          csvField(""),
          csvField(String(row.view_count)),
          csvField(centralDateString(row.publication_date)),
          csvField(short),
          csvField(registrationDeadline),
        ].join(",")
      );
    }
    // Leading BOM so spreadsheet tools reliably detect UTF-8 rather than guessing a local codepage;
    // CRLF line endings per RFC 4180 for maximum importer compatibility.
    const csv = String.fromCharCode(0xfeff) + lines.join("\r\n") + "\r\n";

    const filename = `rights-manager-${sanitizeForFilename(account.accountName) || "export"}-${todayDateString()}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
};
