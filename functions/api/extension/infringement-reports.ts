import type { ApiHandler } from "../../lib/env";
import { errorResponse, json, readJson, ValidationError } from "../../lib/http";
import { requireBearerToken } from "../../lib/auth";
import { generateId, nowIso } from "../../lib/ids";
import { getClientOrThrow, getRightsManagerAccountOrThrow, mapInfringementReport } from "../../lib/db";
import {
  optionalBoolean,
  optionalNonNegativeInt,
  optionalNonNegativeNumber,
  optionalString,
  requireIsoDate,
  requirePlatform,
  requireString,
  requireUrl,
} from "../../lib/validation";
import type {
  ExtensionInfringementReportImportInput,
  ExtensionInfringementReportImportResult,
  InfringementReferenceFile,
} from "../../../shared/types";

interface JoinedRow {
  id: string;
  client_id: string | null;
  infringer_name: string;
  infringing_url: string;
  platform: string;
  posted_at: string;
  notes: string | null;
  status: string;
  found_by_user_id: string;
  created_at: string;
  updated_at: string;
  source: string;
  rights_manager_account_id: string | null;
  meta_match_id: string | null;
  meta_video_id: string | null;
  match_duration_sec: number | null;
  video_view_count: number | null;
  page_follower_count: number | null;
  is_account_private: number | null;
  infringer_profile_url: string | null;
  reference_files: string | null;
  screenshot_key: string | null;
  video_available: number | null;
  client_name: string | null;
  found_by_name: string;
  rights_manager_account_name: string | null;
}

const JOINED_SELECT = `
  SELECT ir.*, c.name as client_name, u.name as found_by_name, rma.name as rights_manager_account_name
  FROM infringement_reports ir
  LEFT JOIN clients c ON c.id = ir.client_id
  JOIN users u ON u.id = ir.found_by_user_id
  LEFT JOIN rights_manager_accounts rma ON rma.id = ir.rights_manager_account_id
`;

function withNames(row: JoinedRow) {
  return {
    ...mapInfringementReport(row),
    clientName: row.client_name,
    foundByName: row.found_by_name,
    rightsManagerAccountName: row.rights_manager_account_name,
  };
}

function optionalReferenceFiles(value: unknown): InfringementReferenceFile[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new ValidationError("referenceFiles must be an array.", { referenceFiles: "invalid" });
  return value.map((entry, i) => {
    if (!entry || typeof entry !== "object" || typeof (entry as { id?: unknown }).id !== "string" || typeof (entry as { title?: unknown }).title !== "string") {
      throw new ValidationError(`referenceFiles[${i}] must be {id, title}.`, { referenceFiles: "invalid" });
    }
    return { id: (entry as { id: string }).id, title: (entry as { title: string }).title };
  });
}

/** Decodes a "data:<mime>;base64,<data>" URL. Returns null for anything else (including an empty
 * string), so a missing/malformed screenshot never blocks the rest of the import. */
function decodeDataUrl(dataUrl: string | null | undefined): { bytes: Uint8Array; contentType: string } | null {
  if (!dataUrl) return null;
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const [, contentType, b64] = match;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, contentType };
}

// No staff session exists for extension-sourced rows — see migrations/0011_rights_manager_matches.sql
// for the fixed, unusable system user this attributes them to instead of relaxing found_by_user_id's
// NOT NULL constraint.
const SYSTEM_USER_ID = "system-rights-manager-extension";

export const onRequestPost: ApiHandler = async (context) => {
  try {
    requireBearerToken(context.request, context.env);
    const db = context.env.DB;

    const body = await readJson<ExtensionInfringementReportImportInput>(context.request);

    const clientId = body.clientId ? requireString(body.clientId, "clientId") : null;
    if (clientId) await getClientOrThrow(db, clientId);
    const rightsManagerAccountId = requireString(body.rightsManagerAccountId, "rightsManagerAccountId");
    await getRightsManagerAccountOrThrow(db, rightsManagerAccountId);

    const infringerName = requireString(body.infringerName, "infringerName", { maxLength: 200 });
    const infringingUrl = requireUrl(body.infringingUrl, "infringingUrl");
    const platform = requirePlatform(body.platform);
    const postedAt = requireIsoDate(body.postedAt, "postedAt");
    const notes = optionalString(body.notes);
    const metaMatchId = requireString(body.metaMatchId, "metaMatchId");
    const metaVideoId = optionalString(body.metaVideoId);
    const matchDurationSec = optionalNonNegativeNumber(body.matchDurationSec, "matchDurationSec");
    const videoViewCount = body.videoViewCount === undefined || body.videoViewCount === null ? null : optionalNonNegativeInt(body.videoViewCount, "videoViewCount");
    const pageFollowerCount = body.pageFollowerCount === undefined || body.pageFollowerCount === null ? null : optionalNonNegativeInt(body.pageFollowerCount, "pageFollowerCount");
    const isAccountPrivate = optionalBoolean(body.isAccountPrivate);
    const infringerProfileUrl = body.infringerProfileUrl ? requireUrl(body.infringerProfileUrl, "infringerProfileUrl") : null;
    const referenceFiles = optionalReferenceFiles(body.referenceFiles);
    const videoAvailable = optionalBoolean(body.videoAvailable);

    // Dedup by Meta's own reference number — re-sending an already-logged match returns the
    // existing row instead of inserting a second one, same pattern as videoUrl dedup in
    // functions/api/extension/videos.ts.
    const existingRow = await db
      .prepare(`${JOINED_SELECT} WHERE ir.meta_match_id = ?`)
      .bind(metaMatchId)
      .first<JoinedRow>();
    if (existingRow) {
      const result: ExtensionInfringementReportImportResult = { infringementReport: withNames(existingRow), duplicate: true };
      return json(result, { status: 200 });
    }

    let screenshotKey: string | null = null;
    const decoded = decodeDataUrl(body.screenshotDataUrl);
    const id = generateId();
    if (decoded) {
      screenshotKey = `infringement-reports/${id}.png`;
      await context.env.SCREENSHOTS.put(screenshotKey, decoded.bytes, { httpMetadata: { contentType: decoded.contentType } });
    }

    const now = nowIso();
    await db
      .prepare(
        `INSERT INTO infringement_reports
          (id, client_id, infringer_name, infringing_url, platform, posted_at, notes, status, found_by_user_id, created_at, updated_at,
           source, rights_manager_account_id, meta_match_id, meta_video_id, match_duration_sec, video_view_count, page_follower_count,
           is_account_private, infringer_profile_url, reference_files, screenshot_key, video_available)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'needs_review', ?, ?, ?,
                 'rights_manager', ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        clientId,
        infringerName,
        infringingUrl,
        platform,
        postedAt,
        notes,
        SYSTEM_USER_ID,
        now,
        now,
        rightsManagerAccountId,
        metaMatchId,
        metaVideoId,
        matchDurationSec,
        videoViewCount,
        pageFollowerCount,
        isAccountPrivate === null ? null : isAccountPrivate ? 1 : 0,
        infringerProfileUrl,
        referenceFiles ? JSON.stringify(referenceFiles) : null,
        screenshotKey,
        videoAvailable === null ? null : videoAvailable ? 1 : 0
      )
      .run();

    const row = await db.prepare(`${JOINED_SELECT} WHERE ir.id = ?`).bind(id).first<JoinedRow>();
    const result: ExtensionInfringementReportImportResult = { infringementReport: withNames(row!), duplicate: false };
    return json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
};
