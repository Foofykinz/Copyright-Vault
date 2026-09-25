import type {
  HunterCandidate,
  HunterCandidatePriority,
  HunterChannel,
  HunterChannelClassification,
  HunterChronology,
  HunterMediaComparisonStatus,
  HunterReviewStatus,
  HunterSearchPriority,
  HunterSearchStatus,
  HunterSourceSettings,
  HunterYouTubeVideo,
} from "../../shared/types";
import { NotFoundError } from "./http";

interface HunterSourceSettingsRow {
  video_id: string;
  hunter_enabled: number;
  first_searched_at: string | null;
  last_searched_at: string | null;
  next_search_at: string | null;
  search_priority: string;
  search_status: string;
  last_search_result_count: number;
  productive_search_count: number;
  consecutive_empty_runs: number;
  last_error: string | null;
  enabled_at: string | null;
  enabled_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

interface HunterChannelRow {
  id: string;
  youtube_channel_id: string;
  channel_name: string | null;
  classification: string;
  associated_client_id: string | null;
  reason: string | null;
  notes: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  confirmed_incident_count: number;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

/** The default-shaped settings object for a video that has never been configured for Hunter — no
 * row in hunter_source_settings yet. Callers combine this with `isConfigured: false` (see
 * functions/api/hunter/sources/byId/settings.ts) rather than treating "no row" as an error. */
export function defaultHunterSourceSettings(videoId: string, now: string): HunterSourceSettings {
  return {
    videoId,
    hunterEnabled: false,
    firstSearchedAt: null,
    lastSearchedAt: null,
    nextSearchAt: null,
    searchPriority: "medium",
    searchStatus: "not_started",
    lastSearchResultCount: 0,
    productiveSearchCount: 0,
    consecutiveEmptyRuns: 0,
    lastError: null,
    enabledAt: null,
    enabledByUserId: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function mapHunterSourceSettings(row: HunterSourceSettingsRow): HunterSourceSettings {
  return {
    videoId: row.video_id,
    hunterEnabled: row.hunter_enabled === 1,
    firstSearchedAt: row.first_searched_at,
    lastSearchedAt: row.last_searched_at,
    nextSearchAt: row.next_search_at,
    searchPriority: row.search_priority as HunterSearchPriority,
    searchStatus: row.search_status as HunterSearchStatus,
    lastSearchResultCount: row.last_search_result_count,
    productiveSearchCount: row.productive_search_count,
    consecutiveEmptyRuns: row.consecutive_empty_runs,
    lastError: row.last_error,
    enabledAt: row.enabled_at,
    enabledByUserId: row.enabled_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getHunterSourceSettings(db: D1Database, videoId: string): Promise<HunterSourceSettings | null> {
  const row = await db.prepare("SELECT * FROM hunter_source_settings WHERE video_id = ?").bind(videoId).first<HunterSourceSettingsRow>();
  return row ? mapHunterSourceSettings(row) : null;
}

export function mapHunterChannel(row: HunterChannelRow): HunterChannel {
  return {
    id: row.id,
    youtubeChannelId: row.youtube_channel_id,
    channelName: row.channel_name,
    classification: row.classification as HunterChannelClassification,
    associatedClientId: row.associated_client_id,
    reason: row.reason,
    notes: row.notes,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    confirmedIncidentCount: row.confirmed_incident_count,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getHunterChannelOrThrow(db: D1Database, id: string): Promise<HunterChannel> {
  const row = await db.prepare("SELECT * FROM hunter_channels WHERE id = ?").bind(id).first<HunterChannelRow>();
  if (!row) throw new NotFoundError("Hunter channel not found.");
  return mapHunterChannel(row);
}

/** Null when the channel has no allowlist/watchlist/repeat-offender entry — the common case. */
export async function getHunterChannelByYoutubeId(db: D1Database, youtubeChannelId: string): Promise<HunterChannel | null> {
  const row = await db.prepare("SELECT * FROM hunter_channels WHERE youtube_channel_id = ?").bind(youtubeChannelId).first<HunterChannelRow>();
  return row ? mapHunterChannel(row) : null;
}

/** Every YouTube channel ID already known (via the existing YouTube channel-scan feature, see
 * functions/lib/youtube.ts) to belong to this client's own social accounts. Used to suppress a
 * client's other self-posted videos from showing up as Hunter candidates — real Phase 2.5 beta data
 * showed a client's own re-cuts of their own footage otherwise surfacing (and scoring HIGH) as
 * apparent "reuse." Usually 0 or 1 entries; a set in case a client ever has more than one YouTube
 * account on file. */
export async function getClientYoutubeChannelIds(db: D1Database, clientId: string): Promise<Set<string>> {
  const rows = await db
    .prepare("SELECT youtube_channel_id FROM social_accounts WHERE client_id = ? AND platform = 'youtube' AND youtube_channel_id IS NOT NULL")
    .bind(clientId)
    .all<{ youtube_channel_id: string }>();
  return new Set(rows.results.map((r) => r.youtube_channel_id));
}

interface HunterYouTubeVideoRow {
  youtube_video_id: string;
  title: string | null;
  description: string | null;
  channel_id: string | null;
  channel_title: string | null;
  published_at: string | null;
  view_count: number | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  video_url: string | null;
  metadata_fetched_at: string;
}

export function mapHunterYouTubeVideo(row: HunterYouTubeVideoRow): HunterYouTubeVideo {
  return {
    youtubeVideoId: row.youtube_video_id,
    title: row.title,
    description: row.description,
    channelId: row.channel_id,
    channelTitle: row.channel_title,
    publishedAt: row.published_at,
    viewCount: row.view_count,
    thumbnailUrl: row.thumbnail_url,
    durationSeconds: row.duration_seconds,
    videoUrl: row.video_url,
    metadataFetchedAt: row.metadata_fetched_at,
  };
}

export async function getHunterYoutubeVideo(db: D1Database, youtubeVideoId: string): Promise<HunterYouTubeVideo | null> {
  const row = await db
    .prepare("SELECT * FROM hunter_youtube_videos WHERE youtube_video_id = ?")
    .bind(youtubeVideoId)
    .first<HunterYouTubeVideoRow>();
  return row ? mapHunterYouTubeVideo(row) : null;
}

export interface UpsertHunterYoutubeVideoInput {
  youtubeVideoId: string;
  title: string | null;
  description: string | null;
  channelId: string | null;
  channelTitle: string | null;
  publishedAt: string | null;
  viewCount: number | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  videoUrl: string | null;
}

/** One global cache row per YouTube video ID, regardless of how many source assets it's a candidate
 * for — an existing row's metadata is refreshed in place rather than duplicated (see migration 0014). */
export async function upsertHunterYoutubeVideo(db: D1Database, input: UpsertHunterYoutubeVideoInput, now: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO hunter_youtube_videos
        (youtube_video_id, title, description, channel_id, channel_title, published_at, view_count,
         thumbnail_url, duration_seconds, video_url, metadata_fetched_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (youtube_video_id) DO UPDATE SET
         title = excluded.title,
         description = excluded.description,
         channel_id = excluded.channel_id,
         channel_title = excluded.channel_title,
         published_at = excluded.published_at,
         view_count = excluded.view_count,
         thumbnail_url = excluded.thumbnail_url,
         duration_seconds = excluded.duration_seconds,
         video_url = excluded.video_url,
         metadata_fetched_at = excluded.metadata_fetched_at`
    )
    .bind(
      input.youtubeVideoId,
      input.title,
      input.description,
      input.channelId,
      input.channelTitle,
      input.publishedAt,
      input.viewCount,
      input.thumbnailUrl,
      input.durationSeconds,
      input.videoUrl,
      now,
      now
    )
    .run();
}

interface HunterCandidateRow {
  id: string;
  source_video_id: string;
  client_id: string;
  youtube_video_id: string;
  first_discovered_at: string;
  last_seen_at: string;
  discovery_queries: string;
  chronology: string;
  priority: string;
  priority_score: number;
  priority_reasons: string;
  review_status: string;
  reviewer_notes: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  media_comparison_status: string;
  suppressed_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** Parses a JSON array column, tolerating malformed/legacy values by falling back to an empty array
 * rather than throwing — same defensive pattern as db.ts's parseReferenceFiles. */
function parseJsonStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function mapHunterCandidate(row: HunterCandidateRow): HunterCandidate {
  return {
    id: row.id,
    sourceVideoId: row.source_video_id,
    clientId: row.client_id,
    youtubeVideoId: row.youtube_video_id,
    firstDiscoveredAt: row.first_discovered_at,
    lastSeenAt: row.last_seen_at,
    discoveryQueries: parseJsonStringArray(row.discovery_queries),
    chronology: row.chronology as HunterChronology,
    priority: row.priority as HunterCandidatePriority,
    priorityScore: row.priority_score,
    priorityReasons: parseJsonStringArray(row.priority_reasons),
    reviewStatus: row.review_status as HunterReviewStatus,
    reviewerNotes: row.reviewer_notes,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at,
    mediaComparisonStatus: row.media_comparison_status as HunterMediaComparisonStatus,
    suppressedReason: row.suppressed_reason as HunterCandidate["suppressedReason"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getHunterCandidate(db: D1Database, sourceVideoId: string, youtubeVideoId: string): Promise<HunterCandidate | null> {
  const row = await db
    .prepare("SELECT * FROM hunter_candidates WHERE source_video_id = ? AND youtube_video_id = ?")
    .bind(sourceVideoId, youtubeVideoId)
    .first<HunterCandidateRow>();
  return row ? mapHunterCandidate(row) : null;
}
