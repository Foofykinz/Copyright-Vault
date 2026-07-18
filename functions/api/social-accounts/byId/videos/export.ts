import type { ApiHandler } from "../../../../lib/env";
import { errorResponse } from "../../../../lib/http";
import { getSocialAccountOrThrow } from "../../../../lib/db";
import { PLATFORM_LABELS, type Platform } from "../../../../../shared/types";
import { sanitizeForFilename } from "../../../../../shared/format";

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const CSV_HEADER = ["Client Name", "Platform", "Post URL", "Post Title", "Description", "Date Posted"];

interface ExportRow {
  client_name: string;
  platform: string;
  video_url: string;
  caption: string | null;
  publication_date: string;
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
              v.caption as caption, v.publication_date as publication_date
       FROM videos v
       JOIN clients c ON c.id = v.client_id
       WHERE v.social_account_id = ?
       ORDER BY v.publication_date ASC`
    )
      .bind(socialAccountId)
      .all<ExportRow>();

    const lines = [CSV_HEADER.map(csvField).join(",")];
    for (const row of rows.results) {
      lines.push(
        [
          csvField(row.client_name),
          csvField(PLATFORM_LABELS[row.platform as Platform] ?? row.platform),
          csvField(row.video_url),
          csvField(row.caption ?? ""),
          csvField(""),
          csvField(row.publication_date.slice(0, 10)),
        ].join(",")
      );
    }
    // Leading BOM so spreadsheet tools reliably detect UTF-8 rather than guessing a local codepage;
    // CRLF line endings per RFC 4180 for maximum importer compatibility.
    const csv = String.fromCharCode(0xfeff) + lines.join("\r\n") + "\r\n";

    const filename = `rights-manager-${sanitizeForFilename(account.accountName) || "export"}-${new Date().toISOString().slice(0, 10)}.csv`;

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
