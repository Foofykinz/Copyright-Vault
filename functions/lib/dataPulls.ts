// Shared row mapping + filter parsing for the Data Pulls routes (list, CSV export, extension upsert)
// -- kept in one place so the list on screen and the export never drift apart, same reasoning as
// infringementReportsQuery.ts.
import type { DataPullWithNames, InfringementReferenceFile, Platform, TakedownStatus } from "../../shared/types";

export interface DataPullRow {
  id: string;
  rights_manager_account_id: string | null;
  client_id: string | null;
  meta_match_id: string;
  infringer_name: string;
  infringing_url: string | null;
  infringer_profile_url: string | null;
  platform: string;
  detected_at: string | null;
  match_duration_sec: number | null;
  video_view_count: number | null;
  page_follower_count: number | null;
  reference_files: string | null;
  takedown_status: string | null;
  first_pulled_at: string;
  last_pulled_at: string;
  rights_manager_account_name: string | null;
  client_name: string | null;
}

export const DATA_PULL_SELECT = `
  SELECT dp.*, rma.name as rights_manager_account_name, c.name as client_name
  FROM data_pulls dp
  LEFT JOIN rights_manager_accounts rma ON rma.id = dp.rights_manager_account_id
  LEFT JOIN clients c ON c.id = dp.client_id
`;

function parseReferenceFiles(raw: string | null): InfringementReferenceFile[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function mapDataPull(row: DataPullRow): DataPullWithNames {
  return {
    id: row.id,
    rightsManagerAccountId: row.rights_manager_account_id,
    clientId: row.client_id,
    metaMatchId: row.meta_match_id,
    infringerName: row.infringer_name,
    infringingUrl: row.infringing_url,
    infringerProfileUrl: row.infringer_profile_url,
    platform: row.platform as Platform,
    detectedAt: row.detected_at,
    matchDurationSec: row.match_duration_sec,
    videoViewCount: row.video_view_count,
    pageFollowerCount: row.page_follower_count,
    referenceFiles: parseReferenceFiles(row.reference_files),
    takedownStatus: (row.takedown_status as TakedownStatus | null) ?? null,
    firstPulledAt: row.first_pulled_at,
    lastPulledAt: row.last_pulled_at,
    rightsManagerAccountName: row.rights_manager_account_name,
    clientName: row.client_name,
  };
}

/** WHERE clause + bound values from the request's query params. Every value is bound, never
 * interpolated. */
export function parseDataPullFilters(url: URL): { where: string; values: unknown[] } {
  const params = url.searchParams;
  const conditions: string[] = [];
  const values: unknown[] = [];

  const rightsManagerAccountId = params.get("rightsManagerAccountId");
  if (rightsManagerAccountId) {
    conditions.push("dp.rights_manager_account_id = ?");
    values.push(rightsManagerAccountId);
  }
  const clientId = params.get("clientId");
  if (clientId) {
    conditions.push("dp.client_id = ?");
    values.push(clientId);
  }
  const takedownStatus = params.get("takedownStatus");
  if (takedownStatus === "none") {
    conditions.push("dp.takedown_status IS NULL");
  } else if (takedownStatus === "requested" || takedownStatus === "approved") {
    conditions.push("dp.takedown_status = ?");
    values.push(takedownStatus);
  }
  const search = params.get("search")?.trim();
  if (search) {
    conditions.push("(dp.infringer_name LIKE ? ESCAPE '\\' OR dp.meta_match_id = ?)");
    values.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, search);
  }
  const pulledFrom = params.get("pulledFrom");
  if (pulledFrom) {
    conditions.push("dp.last_pulled_at >= ?");
    values.push(pulledFrom);
  }
  const pulledTo = params.get("pulledTo");
  if (pulledTo) {
    // A bare date ("2026-10-02") should include that whole day.
    conditions.push("dp.last_pulled_at < ?");
    values.push(/^\d{4}-\d{2}-\d{2}$/.test(pulledTo) ? `${pulledTo}T23:59:59.999Z` : pulledTo);
  }

  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", values };
}
