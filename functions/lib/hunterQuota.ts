import type { Env } from "./env";
import type { HunterQuotaStatus } from "../../shared/types";
import { todayDateString } from "../../shared/dates";
import { nowIso } from "./ids";

/**
 * Conservative fallback when HUNTER_YOUTUBE_SEARCH_DAILY_BUDGET isn't set. This is Hunter's own
 * self-imposed daily ceiling on search.list calls, NOT a claim about what the Google Cloud project's
 * actual configured search.list quota is (that's account-specific, may already be higher, and may be
 * raised later — see functions/lib/env.ts). Search.list has its own per-day quota bucket, separate
 * from the general Data API pool the rest of this app's YouTube calls (videos.list, channels.list,
 * playlistItems.list) draw from — see migration 0014's hunter_quota_budget comment.
 */
const DEFAULT_SEARCH_DAILY_BUDGET = 50;

export function getSearchDailyBudget(env: Env): number {
  const configured = env.HUNTER_YOUTUBE_SEARCH_DAILY_BUDGET;
  if (!configured) return DEFAULT_SEARCH_DAILY_BUDGET;
  const parsed = Number(configured);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_SEARCH_DAILY_BUDGET;
}

interface HunterQuotaBudgetRow {
  search_date: string;
  search_calls_made: number;
  other_api_calls_made: number;
  search_calls_budget: number;
  api_errors: number;
  search_quota_exhausted_at: string | null;
  sources_searched: number;
  candidates_discovered: number;
  unique_candidates_discovered: number;
  updated_at: string;
}

function mapHunterQuotaBudget(row: HunterQuotaBudgetRow): HunterQuotaStatus {
  return {
    searchDate: row.search_date,
    searchCallsMade: row.search_calls_made,
    otherApiCallsMade: row.other_api_calls_made,
    searchCallsBudget: row.search_calls_budget,
    apiErrors: row.api_errors,
    searchQuotaExhaustedAt: row.search_quota_exhausted_at,
    sourcesSearched: row.sources_searched,
    candidatesDiscovered: row.candidates_discovered,
    uniqueCandidatesDiscovered: row.unique_candidates_discovered,
    updatedAt: row.updated_at,
  };
}

/**
 * Reads (or creates) today's Central-time quota row. search_calls_budget is snapshotted from the
 * currently configured budget at the moment a day's row is first created — later config changes take
 * effect starting the next new day's row, so a day's displayed budget never silently drifts mid-day.
 * Search execution (Phase 2+) will call this before spending any search.list calls; this Phase 1
 * version only establishes the read/create path so the /api/hunter/quota status endpoint has
 * something real to report from day one.
 */
export async function getOrCreateTodayQuota(db: D1Database, env: Env): Promise<HunterQuotaStatus> {
  const today = todayDateString();
  const existing = await db.prepare("SELECT * FROM hunter_quota_budget WHERE search_date = ?").bind(today).first<HunterQuotaBudgetRow>();
  if (existing) return mapHunterQuotaBudget(existing);

  const now = nowIso();
  const budget = getSearchDailyBudget(env);
  await db
    .prepare(
      `INSERT INTO hunter_quota_budget (search_date, search_calls_made, other_api_calls_made, search_calls_budget, api_errors, updated_at)
       VALUES (?, 0, 0, ?, 0, ?)
       ON CONFLICT (search_date) DO NOTHING`
    )
    .bind(today, budget, now)
    .run();

  const row = await db.prepare("SELECT * FROM hunter_quota_budget WHERE search_date = ?").bind(today).first<HunterQuotaBudgetRow>();
  return mapHunterQuotaBudget(row!);
}

export interface HunterQuotaDelta {
  searchCallsMade: number;
  otherApiCallsMade: number;
  apiErrors: number;
  sourcesSearched: number;
  candidatesDiscovered: number;
  uniqueCandidatesDiscovered: number;
  searchQuotaExhausted: boolean;
}

/**
 * Applies one Hunt's usage as a single delta at the end of the run, rather than a write per API
 * call — a manual Hunt is a handful of calls, so this trades a small durability gap (a Worker killed
 * mid-run loses that run's counters) for far fewer D1 round trips. The budget CHECK against
 * remaining search calls still happens in-memory during the run itself (see functions/lib/hunterRun.ts),
 * seeded from the row this same module returns at the start of the run.
 */
export async function applyQuotaDelta(db: D1Database, searchDate: string, delta: HunterQuotaDelta): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `UPDATE hunter_quota_budget SET
         search_calls_made = search_calls_made + ?,
         other_api_calls_made = other_api_calls_made + ?,
         api_errors = api_errors + ?,
         sources_searched = sources_searched + ?,
         candidates_discovered = candidates_discovered + ?,
         unique_candidates_discovered = unique_candidates_discovered + ?,
         search_quota_exhausted_at = CASE WHEN ? = 1 AND search_quota_exhausted_at IS NULL THEN ? ELSE search_quota_exhausted_at END,
         updated_at = ?
       WHERE search_date = ?`
    )
    .bind(
      delta.searchCallsMade,
      delta.otherApiCallsMade,
      delta.apiErrors,
      delta.sourcesSearched,
      delta.candidatesDiscovered,
      delta.uniqueCandidatesDiscovered,
      delta.searchQuotaExhausted ? 1 : 0,
      now,
      now,
      searchDate
    )
    .run();
}
