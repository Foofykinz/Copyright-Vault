-- Vault Hunter V1, Phase 1: data foundation only. No search/scheduling logic runs yet -- this just
-- creates the tables/columns Phase 2+ will read and write. All additive; nothing here touches
-- existing rows or behavior for the current Copyright Vault app.
--
-- Deliberately NOT included here (per Phase 0 review):
--   * any grant of hunter_access to specific user rows -- that's a private, separately-run data
--     change against production, not something to permanently encode into a migration.
--   * visual/audio fingerprint columns beyond media_comparison_status -- see the column comment
--     below; that whole design is deferred to Phase 6, against real match/non-match cases.
--   * three separate allowlist/watchlist/repeat-offender tables -- consolidated into hunter_channels
--     (classification column) so a channel can't accidentally exist in two contradictory lists at
--     once (see the CHECK constraint and UNIQUE(youtube_channel_id) below).

-- Server-side gate for every /api/hunter/* route (see functions/lib/hunterAuth.ts). No existing
-- role/permission system exists to reuse (see Phase 0 report), so this is the smallest addition:
-- one boolean, defaulted off for every current user. Granted to specific accounts separately,
-- outside of migrations.
ALTER TABLE users ADD COLUMN hunter_access INTEGER NOT NULL DEFAULT 0 CHECK (hunter_access IN (0, 1));

-- One row per eligible Hunter source, keyed off the existing `videos` table rather than adding
-- Hunter-only columns onto it -- `videos` is read by every existing page/query in the app, and this
-- keeps that hot path untouched. Any platform's video row is eligible (a client's own TikTok/IG/FB/X/
-- Vimeo/YouTube upload can all be searched for on YouTube), not just YouTube-platform source rows.
-- Absence of a row here means "never configured for Hunter" (equivalent to hunter_enabled = 0).
CREATE TABLE hunter_source_settings (
  video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  hunter_enabled INTEGER NOT NULL DEFAULT 0,
  first_searched_at TEXT,
  last_searched_at TEXT,
  -- Populated once the Phase 4 scheduler exists; NULL for V1's manual-only "Hunt This Source Now".
  next_search_at TEXT,
  search_priority TEXT NOT NULL DEFAULT 'medium' CHECK (search_priority IN ('high', 'medium', 'low')),
  search_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (search_status IN ('not_started', 'queued', 'running', 'ok', 'error', 'quota_blocked')),
  last_search_result_count INTEGER NOT NULL DEFAULT 0,
  productive_search_count INTEGER NOT NULL DEFAULT 0,
  consecutive_empty_runs INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  enabled_at TEXT,
  enabled_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Global YouTube metadata cache, keyed by YouTube's own video ID -- one row no matter how many
-- Vault source assets a given YouTube video is a candidate for (see hunter_candidates below).
-- Avoids re-fetching/duplicating title/description/stats per relationship.
CREATE TABLE hunter_youtube_videos (
  youtube_video_id TEXT PRIMARY KEY,
  title TEXT,
  description TEXT,
  channel_id TEXT,
  channel_title TEXT,
  published_at TEXT,
  view_count INTEGER,
  thumbnail_url TEXT,
  duration_seconds INTEGER,
  video_url TEXT,
  metadata_fetched_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_hunter_youtube_videos_channel_id ON hunter_youtube_videos(channel_id);

-- The source-asset <-> YouTube-candidate relationship. Deduplicated by (source_video_id,
-- youtube_video_id) -- same source found again by a later/different query updates last_seen_at on
-- this same row rather than creating a duplicate review item (see functions/lib/hunterDb.ts, added
-- in Phase 2). client_id is denormalized from videos.client_id, same spirit as videos.platform being
-- denormalized off social_accounts -- lets the review queue filter by client without a join.
--
-- media_comparison_status is the ONLY fingerprinting-related column for V1, intentionally. Future
-- states beyond NOT_RUN (QUEUED, PROCESSING, MATCH, NO_MATCH, ERROR) are enforced by the CHECK below
-- so the column is ready to be driven by Phase 6 without a schema change, but the actual comparison
-- details (algorithm version, matched segments, per-modality scores) are deferred to a future
-- hunter_media_comparisons table designed against real match/non-match cases, not guessed at now.
CREATE TABLE hunter_candidates (
  id TEXT PRIMARY KEY,
  source_video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  youtube_video_id TEXT NOT NULL REFERENCES hunter_youtube_videos(youtube_video_id) ON DELETE CASCADE,
  first_discovered_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  -- JSON array of the discovery queries that have surfaced this candidate -- "found by multiple
  -- distinct queries" is one of the documented ranking signals.
  discovery_queries TEXT NOT NULL DEFAULT '[]',
  chronology TEXT NOT NULL DEFAULT 'unknown'
    CHECK (chronology IN ('after_source', 'same_day', 'before_source', 'unknown')),
  priority TEXT NOT NULL DEFAULT 'low' CHECK (priority IN ('low', 'review', 'high')),
  -- Raw explainable ranking score used for sort order only -- never surfaced as a fake confidence %.
  priority_score REAL NOT NULL DEFAULT 0,
  -- JSON array of human-readable strings, e.g. ["exact distinctive phrase match", "uploaded 1 day
  -- after source"] -- every candidate must explain its own priority.
  priority_reasons TEXT NOT NULL DEFAULT '[]',
  review_status TEXT NOT NULL DEFAULT 'new'
    CHECK (review_status IN ('new', 'reviewing', 'likely_match', 'confirmed_actionable', 'authorized', 'not_a_match', 'watch', 'archived')),
  reviewer_notes TEXT,
  reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  media_comparison_status TEXT NOT NULL DEFAULT 'NOT_RUN'
    CHECK (media_comparison_status IN ('NOT_RUN', 'QUEUED', 'PROCESSING', 'MATCH', 'NO_MATCH', 'ERROR')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_video_id, youtube_video_id)
);

CREATE INDEX idx_hunter_candidates_source_video_id ON hunter_candidates(source_video_id);
CREATE INDEX idx_hunter_candidates_youtube_video_id ON hunter_candidates(youtube_video_id);
CREATE INDEX idx_hunter_candidates_review_status ON hunter_candidates(review_status);
CREATE INDEX idx_hunter_candidates_priority ON hunter_candidates(priority);
CREATE INDEX idx_hunter_candidates_client_id ON hunter_candidates(client_id);

-- Durable run history, one row per query actually executed against the YouTube API. source_video_id
-- uses ON DELETE SET NULL (rather than CASCADE, matching infringement_reports.client_id's reasoning)
-- so run history/audit trail survives a source video later being deleted.
CREATE TABLE hunter_search_runs (
  id TEXT PRIMARY KEY,
  source_video_id TEXT REFERENCES videos(id) ON DELETE SET NULL,
  query TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'scheduled')),
  triggered_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  api_result_count INTEGER,
  unique_candidates_count INTEGER,
  duplicate_count INTEGER,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_hunter_search_runs_source_video_id ON hunter_search_runs(source_video_id);
CREATE INDEX idx_hunter_search_runs_started_at ON hunter_search_runs(started_at);

-- Consolidated channel intelligence: one row per YouTube channel, classified as exactly one of
-- ALLOWLIST / WATCHLIST / REPEAT_OFFENDER (the CHECK + UNIQUE(youtube_channel_id) together make a
-- channel existing in two contradictory lists at once structurally impossible, per Phase 0 review --
-- reclassifying a channel is an explicit PATCH, never an implicit second row). Detailed confirmed-
-- incident history (beyond the running count here) is deferred to a future incident/history table if
-- that level of detail actually becomes necessary -- not built preemptively.
CREATE TABLE hunter_channels (
  id TEXT PRIMARY KEY,
  youtube_channel_id TEXT NOT NULL UNIQUE,
  channel_name TEXT,
  classification TEXT NOT NULL CHECK (classification IN ('ALLOWLIST', 'WATCHLIST', 'REPEAT_OFFENDER')),
  associated_client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  reason TEXT,
  notes TEXT,
  first_seen_at TEXT,
  last_seen_at TEXT,
  confirmed_incident_count INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_hunter_channels_classification ON hunter_channels(classification);

-- Daily YouTube API usage/budget, one row per Central-time calendar date. Reflects the current
-- (June 2026+) quota model: search.list has its own separate per-day call bucket, distinct from the
-- general Data API quota pool that videos.list/channels.list/playlistItems.list draw from -- tracked
-- as two independent counters rather than one combined "quota units" number. search_calls_budget is
-- a snapshot (at first write each day) of the currently configured daily search-call budget
-- (see functions/lib/hunterQuota.ts / Env.HUNTER_YOUTUBE_SEARCH_DAILY_BUDGET) -- not a hardcoded
-- assumption about the Google Cloud project's actual configured limit, which may be raised later.
CREATE TABLE hunter_quota_budget (
  search_date TEXT PRIMARY KEY,
  search_calls_made INTEGER NOT NULL DEFAULT 0,
  other_api_calls_made INTEGER NOT NULL DEFAULT 0,
  search_calls_budget INTEGER NOT NULL,
  api_errors INTEGER NOT NULL DEFAULT 0,
  search_quota_exhausted_at TEXT,
  sources_searched INTEGER NOT NULL DEFAULT 0,
  candidates_discovered INTEGER NOT NULL DEFAULT 0,
  unique_candidates_discovered INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
