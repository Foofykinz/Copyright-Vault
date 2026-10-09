export type Platform = "facebook" | "instagram" | "tiktok" | "youtube" | "vimeo" | "x" | "threads" | "other";

export const PLATFORMS: Platform[] = ["facebook", "instagram", "tiktok", "youtube", "vimeo", "x", "threads", "other"];

export const PLATFORM_LABELS: Record<Platform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  vimeo: "Vimeo",
  x: "X",
  threads: "Threads",
  other: "Other",
};

export type DeadlineStatus = "neutral" | "amber" | "urgent" | "expired";

export interface SessionUser {
  id: string;
  name: string;
  username: string;
  mustChangePassword: boolean;
  /** Server-enforced on every /api/hunter/* route (see functions/lib/hunterAuth.ts) — this flag is
   * only here so the frontend can hide Vault Hunter's nav/UI for everyone else. It is never itself
   * the security boundary. */
  hunterAccess: boolean;
  /** Server-enforced on every ticket read/update route (see functions/lib/ticketAuth.ts); here only
   * so the frontend can show the ticket inbox to its owner and just the submit form to everyone
   * else. */
  ticketInboxAccess: boolean;
}

export interface Client {
  id: string;
  name: string;
  archived: boolean;
  affiliationTagId: string | null;
  affiliationTagName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AffiliationTag {
  id: string;
  name: string;
  createdAt: string;
}

/** A Meta Business Rights Manager account matches can come from (e.g. "WX Chasing",
 * "Severe Studios") — a managed, reusable list, same spirit as AffiliationTag, but a distinct
 * concept: this is a Meta-side business entity, not a label on a client. */
export interface RightsManagerAccount {
  id: string;
  name: string;
  createdAt: string;
}

export interface SocialAccount {
  id: string;
  clientId: string;
  platform: Platform;
  accountName: string;
  profileUrl: string | null;
  lastPullAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** YouTube only — cached after the first successful channel resolution so later scans don't
   * need to re-resolve the channel URL. Null for every other platform, and null for a YouTube
   * account that hasn't been scanned yet. */
  youtubeChannelId?: string | null;
  youtubeUploadsPlaylistId?: string | null;
  youtubeHandle?: string | null;
  /** Vimeo only — cached numeric user ID after the first successful resolution, so later scans
   * don't need to re-resolve the profile URL. Null for every other platform, and null for a Vimeo
   * account that hasn't been scanned yet. */
  vimeoUserId?: string | null;
}

export type YouTubeCategory = "short" | "live" | "upload";
export type YouTubeLiveStatus = "upcoming" | "live" | "completed";

export interface Video {
  id: string;
  clientId: string;
  socialAccountId: string;
  platform: Platform;
  videoUrl: string;
  publicationDate: string;
  caption: string | null;
  viewCount: number;
  viewCountCheckedAt: string | null;
  thumbnailUrl: string | null;
  notes: string | null;
  collectedAt: string;
  createdAt: string;
  updatedAt: string;
  /** YouTube only — null for every other platform. */
  youtubeCategory: YouTubeCategory | null;
  /** Set the first time this video is included in a "mark as sent" Rights Manager action — see
   * rights_manager_batches/rights_manager_batch_videos. Denormalized here purely as a fast-path
   * read cache (source of truth is the junction table) so listing videos doesn't need a join. */
  rightsManagerSentAt: string | null;
  /** Set whenever this video is included in an "Export Rights Manager CSV" download — a separate,
   * earlier signal from rightsManagerSentAt (the manual "mark as sent" confirmation). */
  rightsManagerExportedAt: string | null;
}

/** Video with server-computed, non-persisted deadline fields. */
export interface VideoWithDeadline extends Video {
  registrationDeadline: string;
  daysRemaining: number;
  deadlineStatus: DeadlineStatus;
  folders: CombinationFolderSummary[];
}

export interface CombinationFolderSummary {
  id: string;
  name: string;
  color: string;
}

export interface CombinationFolder {
  id: string;
  clientId: string;
  name: string;
  color: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Combination folder with server-computed, non-persisted deadline fields. */
export interface CombinationFolderWithComputed extends CombinationFolder {
  earliestPublicationDate: string | null;
  registrationDeadline: string | null;
  daysRemaining: number | null;
  deadlineStatus: DeadlineStatus | null;
  videoCount: number;
}

// ---- Infringement reports ----
// Tracks someone ELSE posting a client's content without permission — the opposite direction from
// Video, which tracks a client's own posts on their own accounts.

export type InfringementStatus = "needs_review" | "logged" | "takedown" | "ignored";

export const INFRINGEMENT_STATUSES: InfringementStatus[] = ["needs_review", "logged", "takedown", "ignored"];

// "logged" reads as "Completed" everywhere in the UI (the Rights Manager archive's terminology for
// a fully-processed match) — the stored value/enum stays "logged" so it doesn't touch the DB CHECK
// constraint or every call site that compares against InfringementStatus.
export const INFRINGEMENT_STATUS_LABELS: Record<InfringementStatus, string> = {
  needs_review: "Needs Review",
  logged: "Completed",
  takedown: "Takedown Issued",
  ignored: "Ignored",
};

export type InfringementReportSource = "manual" | "rights_manager";

/** One matched reference asset for a Rights Manager–sourced report — a match can carry more than
 * one, so this always lives in an array (see InfringementReport.referenceFiles). */
export interface InfringementReferenceFile {
  id: string;
  title: string;
}

export interface InfringementReport {
  id: string;
  clientId: string | null;
  infringerName: string;
  infringingUrl: string;
  platform: Platform;
  /** When the infringing content was itself posted — distinct from createdAt (when it was logged here). */
  postedAt: string;
  notes: string | null;
  status: InfringementStatus;
  foundByUserId: string;
  createdAt: string;
  updatedAt: string;
  /** "rights_manager" for anything collected via the extension's Rights Manager match capture;
   * "manual" for everything logged through the Quick Add form (the default). */
  source: InfringementReportSource;
  rightsManagerAccountId: string | null;
  /** Meta's own reference number for the match (active_match_data_id in the Rights Manager API) —
   * the searchable field, and also the dedup key for extension-sourced reports. Null for manual
   * entries. */
  metaMatchId: string | null;
  metaVideoId: string | null;
  matchDurationSec: number | null;
  videoViewCount: number | null;
  pageFollowerCount: number | null;
  /** Drives a "private accounts are usually released, not logged" hint — Meta withholds
   * infringerName/infringerProfileUrl for private accounts, so this is often the only signal. */
  isAccountPrivate: boolean | null;
  infringerProfileUrl: string | null;
  referenceFiles: InfringementReferenceFile[] | null;
  /** R2 object key for a captured screenshot — see functions/api/infringement-reports/byId/screenshot.ts.
   * Never the image itself. */
  screenshotKey: string | null;
  /** Whether the infringing video was still live at last check. Null until someone (or the
   * extension) has checked — see migration 0012. */
  videoAvailable: boolean | null;
}

/** Read-only display conveniences joined in by the server — never sent back on an update. */
export interface InfringementReportWithNames extends InfringementReport {
  clientName: string | null;
  foundByName: string;
  rightsManagerAccountName: string | null;
}

export interface CreateInfringementReportInput {
  clientId?: string | null;
  infringerName: string;
  infringingUrl: string;
  platform: Platform;
  postedAt: string;
  notes?: string | null;
}

export interface UpdateInfringementReportInput {
  clientId?: string | null;
  infringerName?: string;
  infringingUrl?: string;
  platform?: Platform;
  postedAt?: string;
  notes?: string | null;
  status?: InfringementStatus;
  videoAvailable?: boolean | null;
}

// ---- Rights Manager archive (paginated, filterable GET /api/infringement-reports) ----

export type InfringementReportSortField = "createdAt" | "postedAt" | "videoViewCount" | "pageFollowerCount";

/** Query params for GET /api/infringement-reports. All optional — an unpaginated call (no `page`)
 * returns every matching row, same as before this filter set existed, for the existing
 * Infringements tab's benefit. The Rights Manager archive tab always sends `page`. */
export interface InfringementReportListParams {
  status?: InfringementStatus;
  clientId?: string;
  source?: InfringementReportSource;
  rightsManagerAccountId?: string;
  /** Substring match against infringerName — the "Page" column on the Rights Manager archive tab. */
  infringerName?: string;
  matchId?: string;
  videoId?: string;
  videoAvailable?: boolean;
  platform?: Platform;
  postedFrom?: string;
  postedTo?: string;
  viewsMin?: number;
  viewsMax?: number;
  followersMin?: number;
  followersMax?: number;
  sortBy?: InfringementReportSortField;
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface InfringementReportListResult {
  infringementReports: InfringementReportWithNames[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ClientStats {
  totalVideos: number;
  unassignedVideos: number;
  dueSoonVideos: number;
  mostRecentPullAt: string | null;
}

// ---- Org-wide dashboard ----
// Aggregate counts only, no per-user attribution.
export interface DashboardStats {
  totalClients: number;
  totalSocialAccounts: number;
  totalVideos: number;
  videosByDeadlineStatus: Record<DeadlineStatus, number>;
  totalSentToRightsManager: number;
  totalInfringementReports: number;
  infringementsByStatus: Record<InfringementStatus, number>;
}

/** A lean, read-only cross-client row for the Deadlines page — deliberately not VideoWithDeadline
 * (which carries folders/editing-oriented fields meant for a single account's table). */
export interface DeadlineVideo {
  id: string;
  clientId: string;
  clientName: string;
  socialAccountId: string;
  platform: Platform;
  videoUrl: string;
  caption: string | null;
  publicationDate: string;
  registrationDeadline: string;
  daysRemaining: number;
  deadlineStatus: DeadlineStatus;
}

// ---- API request payloads ----

export interface CreateClientInput {
  name: string;
  affiliationTagId?: string | null;
  notes?: string | null;
}

export interface UpdateClientInput {
  name?: string;
  archived?: boolean;
  affiliationTagId?: string | null;
  notes?: string | null;
}

export interface CreateAffiliationTagInput {
  name: string;
}

export interface CreateRightsManagerAccountInput {
  name: string;
}

export interface CreateSocialAccountInput {
  clientId: string;
  platform: Platform;
  accountName: string;
  profileUrl?: string | null;
}

export interface UpdateSocialAccountInput {
  platform?: Platform;
  accountName?: string;
  profileUrl?: string | null;
}

/**
 * Manual-entry payload for POST /api/social-accounts/:id/videos. clientId, socialAccountId, and
 * platform are inferred server-side from the social account in the URL, so they're omitted here.
 */
export interface CreateVideoInput {
  videoUrl: string;
  publicationDate: string;
  caption?: string | null;
  viewCount?: number;
  notes?: string | null;
  thumbnailUrl?: string | null;
}

export interface UpdateVideoInput {
  videoUrl?: string;
  publicationDate?: string;
  caption?: string | null;
  viewCount?: number;
  viewCountCheckedAt?: string | null;
  notes?: string | null;
  thumbnailUrl?: string | null;
}

// ---- Rights Manager tracking (POST /api/rights-manager/mark-sent) ----

export interface MarkRightsManagerSentInput {
  clientId: string;
  videoIds: string[];
}

/** One rights_manager_batches row is auto-created per call as an audit trail (who/when a set of
 * videos was marked) — never surfaced as something a user names or manages, unlike Combination
 * Folders. `videoIds` echoes back exactly which of the requested IDs were actually updated. */
export interface MarkRightsManagerSentResult {
  batchId: string;
  markedAt: string;
  videoIds: string[];
}

export interface RightsManagerBatchWithVideos {
  id: string;
  name: string;
  createdAt: string;
  videoCount: number;
  videos: Video[];
}

export interface CreateCombinationFolderInput {
  clientId: string;
  name: string;
  videoIds?: string[];
  notes?: string | null;
}

export interface UpdateCombinationFolderInput {
  name?: string;
  notes?: string | null;
}

/** Payload shape the future browser extension will POST for a collected video. */
export interface ExtensionVideoImportInput {
  clientId: string;
  socialAccountId: string;
  platform: Platform;
  profileUrl?: string;
  pullStartDate?: string;
  videoUrl: string;
  publicationDate: string;
  caption?: string | null;
  viewCount?: number;
  viewCountCheckedAt?: string;
  thumbnailUrl?: string;
  /** YouTube only — ignored for every other platform. */
  youtubeCategory?: YouTubeCategory;
}

/** Response for POST /api/extension/videos. `duplicate` is true when videoUrl already existed for
 * that social account — the existing row is returned as-is rather than creating a new one. */
export interface ExtensionVideoImportResult {
  video: VideoWithDeadline;
  duplicate: boolean;
}

/** Payload the extension POSTs for one captured Rights Manager match. Field-by-field mapping from
 * the real copyright_matches API response lives in the plan/implementation notes, not here. */
export interface ExtensionInfringementReportImportInput {
  clientId?: string | null;
  rightsManagerAccountId: string;
  infringerName: string;
  infringingUrl: string;
  platform: Platform;
  postedAt: string;
  notes?: string | null;
  metaMatchId: string;
  metaVideoId?: string | null;
  matchDurationSec?: number | null;
  videoViewCount?: number | null;
  pageFollowerCount?: number | null;
  isAccountPrivate?: boolean | null;
  infringerProfileUrl?: string | null;
  referenceFiles?: InfringementReferenceFile[] | null;
  /** A PNG screenshot as a data URL. Optional — a request without one just leaves the report's
   * screenshotKey null. */
  screenshotDataUrl?: string | null;
  videoAvailable?: boolean | null;
}

/** Response for POST /api/extension/infringement-reports. `duplicate` is true when metaMatchId
 * already existed — the existing row is returned as-is rather than creating a new one. */
export interface ExtensionInfringementReportImportResult {
  infringementReport: InfringementReportWithNames;
  duplicate: boolean;
}

/** GET /api/extension/infringement-reports?metaMatchId=... -- lets the automated run skip taking a
 * screenshot for a match that's already in the Copyright Archive. */
export interface ExtensionInfringementReportExistsResult {
  exists: boolean;
}

// ---- Data Pulls (extension's automated Content Protection clickthrough; see migration 0017) ----

/** Read off the match page: "You requested a takedown" / "Your takedown request was approved". */
export type TakedownStatus = "requested" | "approved";

export const TAKEDOWN_STATUS_LABELS: Record<TakedownStatus, string> = {
  requested: "Takedown Requested",
  approved: "Takedown Approved",
};

export interface DataPull {
  id: string;
  rightsManagerAccountId: string | null;
  clientId: string | null;
  metaMatchId: string;
  infringerName: string;
  infringingUrl: string | null;
  infringerProfileUrl: string | null;
  platform: Platform;
  /** When Meta detected the match -- the match page shows no posting date. */
  detectedAt: string | null;
  matchDurationSec: number | null;
  videoViewCount: number | null;
  pageFollowerCount: number | null;
  referenceFiles: InfringementReferenceFile[];
  takedownStatus: TakedownStatus | null;
  /** True when Meta showed "Monetized" on the match at the latest pull; null otherwise. */
  monetized: boolean | null;
  firstPulledAt: string;
  lastPulledAt: string;
}

export interface DataPullWithNames extends DataPull {
  rightsManagerAccountName: string | null;
  clientName: string | null;
}

/** Payload the extension POSTs for one match during a data pull. */
export interface ExtensionDataPullInput {
  rightsManagerAccountId: string;
  clientId?: string | null;
  metaMatchId: string;
  infringerName: string;
  infringingUrl?: string | null;
  infringerProfileUrl?: string | null;
  platform: Platform;
  detectedAt?: string | null;
  matchDurationSec?: number | null;
  videoViewCount?: number | null;
  pageFollowerCount?: number | null;
  referenceFiles?: InfringementReferenceFile[] | null;
  takedownStatus?: TakedownStatus | null;
  monetized?: boolean | null;
}

/** `updated` is true when this match had been pulled before and its row was refreshed in place. */
export interface ExtensionDataPullResult {
  dataPull: DataPullWithNames;
  updated: boolean;
}

/** Query params for GET /api/data-pulls and its CSV export. `takedownStatus: "none"` = neither. */
export interface DataPullListParams {
  rightsManagerAccountId?: string;
  clientId?: string;
  takedownStatus?: TakedownStatus | "none";
  /** Substring match against infringer name, or an exact match ID. */
  search?: string;
  pulledFrom?: string;
  pulledTo?: string;
  page?: number;
  pageSize?: number;
}

export interface DataPullListResult {
  dataPulls: DataPullWithNames[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiError {
  error: string;
  details?: Record<string, string>;
}

/** Result of a best-effort metadata lookup for a pasted video URL. Any field may be missing. */
export interface VideoMetadataResult {
  platform: Platform;
  caption?: string;
  publicationDate?: string;
  viewCount?: number;
  thumbnailUrl?: string;
  /** Set when a field could not be fetched (e.g. platform doesn't publicly expose it). */
  warning?: string;
}

// ---- YouTube channel scan (POST /api/youtube/channel-videos) ----

export interface YouTubeChannelVideosRequest {
  clientId: string;
  accountId: string;
  /** A channel URL/handle to resolve. Omitted once the account already has a cached channelId. */
  channelUrl?: string;
  startDate?: string;
  endDate?: string;
}

export interface YouTubeScannedVideo {
  videoId: string;
  videoUrl: string;
  title: string;
  /** Truncated from the video's title (not its description) — see functions/lib/youtube.ts. */
  caption: string;
  publicationDate: string;
  viewCount: number | null;
  thumbnailUrl: string | null;
  channelTitle: string;
  channelId: string;
  channelUrl: string;
  durationSeconds: number | null;
  category: YouTubeCategory;
  liveStatus?: YouTubeLiveStatus;
  scheduledStartTime?: string;
  actualStartTime?: string;
  actualEndTime?: string;
  concurrentViewers?: number;
}

/** How trustworthy the short/live/upload split is for this scan. "incomplete_older_shorts" means
 * live retrieval succeeded but the confirmed-Shorts lookup only covers a channel's most recent
 * batch (~48-50) — content older than that may be a Short mislabeled as a regular upload.
 * "shorts_lookup_failed" means the Shorts lookup itself errored — every video was still retrieved,
 * just conservatively bucketed as "upload" pending a re-scan. */
export type YouTubeClassificationStatus = "complete" | "incomplete_older_shorts" | "shorts_lookup_failed";

export interface YouTubeChannelVideosResponse {
  channel: {
    channelId: string;
    title: string;
    handle: string | null;
    uploadsPlaylistId: string;
  };
  videos: YouTubeScannedVideo[];
  counts: { shorts: number; lives: number; uploads: number };
  classificationStatus: YouTubeClassificationStatus;
}

// ---- Vimeo channel scan (POST /api/vimeo/channel-videos) ----

export interface VimeoChannelVideosRequest {
  clientId: string;
  accountId: string;
  /** A vimeo.com profile URL to resolve. Omitted once the account already has a cached vimeoUserId. */
  channelUrl?: string;
  startDate?: string;
  endDate?: string;
}

export interface VimeoScannedVideo {
  videoId: string;
  videoUrl: string;
  title: string;
  caption: string;
  publicationDate: string;
  /** Null when the video owner hasn't enabled public play counts in their Vimeo privacy settings —
   * not every Vimeo video exposes this. */
  viewCount: number | null;
  thumbnailUrl: string | null;
  channelTitle: string;
  durationSeconds: number | null;
}

export interface VimeoChannelVideosResponse {
  channel: { userId: string; title: string };
  videos: VimeoScannedVideo[];
}

// ---- Vault Hunter (private, /api/hunter/*) ----
// V1 Phase 1: data foundation only — these types back the schema in migration 0014, plus the
// settings/channels/quota API foundations. Search execution, ranking, and review-queue UI land in
// later phases.

export type HunterSearchPriority = "high" | "medium" | "low";

export type HunterSearchStatus = "not_started" | "queued" | "running" | "ok" | "error" | "quota_blocked";

/** One row per eligible Hunter source, keyed off an existing `videos.id` (any platform — not just
 * YouTube-platform source rows). Absence of a settings row for a video is equivalent to
 * hunterEnabled: false with every other field at its default; see HunterSourceSettingsResult. */
export interface HunterSourceSettings {
  videoId: string;
  hunterEnabled: boolean;
  firstSearchedAt: string | null;
  lastSearchedAt: string | null;
  /** Populated once the Phase 4 scheduler exists; null under V1's manual-only Hunt flow. */
  nextSearchAt: string | null;
  searchPriority: HunterSearchPriority;
  searchStatus: HunterSearchStatus;
  lastSearchResultCount: number;
  productiveSearchCount: number;
  consecutiveEmptyRuns: number;
  lastError: string | null;
  enabledAt: string | null;
  enabledByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** GET response for a video with no settings row yet — a default, unsaved-shaped settings object
 * (isConfigured: false) so the caller can render Hunter's off-state without a prior PATCH. */
export interface HunterSourceSettingsResult {
  settings: HunterSourceSettings;
  isConfigured: boolean;
}

export interface UpdateHunterSourceSettingsInput {
  hunterEnabled?: boolean;
  searchPriority?: HunterSearchPriority;
}

export type HunterChronology = "after_source" | "same_day" | "before_source" | "unknown";

export type HunterCandidatePriority = "low" | "review" | "high";

export type HunterReviewStatus =
  | "new"
  | "reviewing"
  | "likely_match"
  | "confirmed_actionable"
  | "authorized"
  | "not_a_match"
  | "watch"
  | "archived";

/** Deliberately the only fingerprinting-related field on a candidate in V1 — see migration 0014's
 * comment on hunter_candidates. Future states beyond NOT_RUN are enforced by the DB CHECK so the
 * column is ready for Phase 6 without another migration, but never populated before then. */
export type HunterMediaComparisonStatus = "NOT_RUN" | "QUEUED" | "PROCESSING" | "MATCH" | "NO_MATCH" | "ERROR";

/** A YouTube video's globally cached metadata, keyed by YouTube's own video ID — one row regardless
 * of how many source assets it's a candidate for. */
export interface HunterYouTubeVideo {
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
  metadataFetchedAt: string;
}

export interface HunterCandidate {
  id: string;
  sourceVideoId: string;
  clientId: string;
  youtubeVideoId: string;
  firstDiscoveredAt: string;
  lastSeenAt: string;
  /** Every discovery query that has surfaced this candidate — one signal is "found by multiple
   * distinct queries." */
  discoveryQueries: string[];
  chronology: HunterChronology;
  priority: HunterCandidatePriority;
  /** Explainable ranking score for sort order only — never a fake confidence percentage. */
  priorityScore: number;
  /** Human-readable reasons behind `priority`, e.g. "exact distinctive phrase match". */
  priorityReasons: string[];
  reviewStatus: HunterReviewStatus;
  reviewerNotes: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  mediaComparisonStatus: HunterMediaComparisonStatus;
  /** Set automatically for two cases: "self_source" covers both the source's own YouTube upload
   * appearing as a "candidate" of itself AND a different video on a YouTube channel already known to
   * belong to this source's client (e.g. their own second angle/cut of the same event — see
   * functions/lib/hunterDb.ts's getClientYoutubeChannelIds); "allowlisted_channel" is a candidate
   * whose channel is on the allowlist. Null means not suppressed. Discovery history is preserved
   * either way — see migration 0015. */
  suppressedReason: "self_source" | "allowlisted_channel" | null;
  createdAt: string;
  updatedAt: string;
}

/** A candidate joined with its cached YouTube metadata and freshly computed scoring — the shape
 * returned by HUNT THIS SOURCE NOW and (later) the review queue. */
export interface HunterCandidateWithVideo extends HunterCandidate {
  youtubeVideo: HunterYouTubeVideo;
  /** True only for candidates newly created by the Hunt that produced this response — false for a
   * relationship that already existed in D1 and was just updated (last_seen_at, discoveryQueries, …). */
  newlyDiscovered: boolean;
}

export interface HunterSearchRun {
  id: string;
  sourceVideoId: string | null;
  query: string;
  trigger: "manual" | "scheduled";
  triggeredByUserId: string | null;
  startedAt: string;
  finishedAt: string | null;
  apiResultCount: number | null;
  uniqueCandidatesCount: number | null;
  duplicateCount: number | null;
  error: string | null;
  createdAt: string;
}

/** A YouTube channel's Vault Hunter classification — exactly one of the three, never more than one
 * row per channel (see migration 0014's UNIQUE(youtube_channel_id) + CHECK), so a channel can't
 * accidentally exist in two contradictory lists at once. Reclassifying is always an explicit PATCH. */
export type HunterChannelClassification = "ALLOWLIST" | "WATCHLIST" | "REPEAT_OFFENDER";

export interface HunterChannel {
  id: string;
  youtubeChannelId: string;
  channelName: string | null;
  classification: HunterChannelClassification;
  associatedClientId: string | null;
  reason: string | null;
  notes: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  confirmedIncidentCount: number;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateHunterChannelInput {
  youtubeChannelId: string;
  channelName?: string | null;
  classification: HunterChannelClassification;
  associatedClientId?: string | null;
  reason?: string | null;
  notes?: string | null;
}

export interface UpdateHunterChannelInput {
  channelName?: string | null;
  classification?: HunterChannelClassification;
  associatedClientId?: string | null;
  reason?: string | null;
  notes?: string | null;
  confirmedIncidentCount?: number;
}

// ---- Manual Hunt (POST /api/hunter/sources/:videoId/hunt) ----

export type HunterQueryStrategy = "distinctive_phrase" | "condensed_descriptive" | "event_action_detail" | "client_assisted";

export interface HunterGeneratedQuery {
  query: string;
  strategy: HunterQueryStrategy;
  reason: string;
}

/** One row of "what did the algorithm actually do" per generated query — the Phase 2 beta
 * diagnostics requirement. `skippedReason` is set instead of running the query at all when the
 * Hunter search budget ran out before reaching it. */
export interface HunterSearchRunDiagnostic {
  query: string;
  strategy: HunterQueryStrategy;
  attempted: boolean;
  succeeded: boolean;
  resultCount: number | null;
  uniqueCandidatesFromThisQuery: number;
  error: string | null;
  skippedReason?: "search_budget_exhausted";
}

export type HuntStatus = "SUCCESS" | "PARTIAL_SUCCESS" | "FAILED";

/** Full response for HUNT THIS SOURCE NOW — deliberately verbose (beta diagnostics) so it's possible
 * to answer "what did Hunter actually do and why" without reading server logs. */
export interface HuntSourceResult {
  status: HuntStatus;
  /** Set when nothing could run at all, e.g. the search budget was already exhausted before this
   * Hunt started. Per-query failures are reported in searchRuns/searchSummary instead. */
  error?: string;
  source: Video;
  sourceText: { original: string; normalized: string };
  generatedQueries: HunterGeneratedQuery[];
  searchSummary: { attempted: number; completed: number; failed: number; skippedDueToBudget: number };
  searchRuns: HunterSearchRunDiagnostic[];
  candidates: HunterCandidateWithVideo[];
  quota: HunterQuotaStatus;
}

/** Today's (Central time) YouTube API usage against Vault Hunter's configured search.list budget.
 * search.list and every other Data API method are tracked as two independent counters — see
 * migration 0014's hunter_quota_budget comment for why they're no longer one combined pool. */
export interface HunterQuotaStatus {
  searchDate: string;
  searchCallsMade: number;
  otherApiCallsMade: number;
  searchCallsBudget: number;
  apiErrors: number;
  searchQuotaExhaustedAt: string | null;
  sourcesSearched: number;
  candidatesDiscovered: number;
  uniqueCandidatesDiscovered: number;
  updatedAt: string;
}

// ---- Tickets (migration 0019) ----
// Any staff member can submit one; only the inbox owner (users.ticket_inbox_access) can read them.

export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketCategory = "bug" | "extension" | "client_request" | "rights_manager" | "other";
export type TicketStatus = "open" | "in_progress" | "closed";

export const TICKET_PRIORITIES: TicketPriority[] = ["low", "normal", "high", "urgent"];
export const TICKET_CATEGORIES: TicketCategory[] = ["bug", "extension", "client_request", "rights_manager", "other"];
export const TICKET_STATUSES: TicketStatus[] = ["open", "in_progress", "closed"];

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
  bug: "Bug / something broken",
  extension: "Extension",
  client_request: "Client request",
  rights_manager: "Rights Manager / matches",
  other: "Other",
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  closed: "Closed",
};

export interface Ticket {
  id: string;
  title: string;
  description: string;
  priority: TicketPriority;
  category: TicketCategory;
  status: TicketStatus;
  createdByUserId: string;
  createdByName: string;
  hasAttachment: boolean;
  /** When the inbox owner first opened it; null = new. */
  seenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTicketInput {
  title: string;
  description: string;
  priority: TicketPriority;
  category: TicketCategory;
  /** Optional screenshot as a data URL (image/png, image/jpeg, image/webp, image/gif). */
  screenshotDataUrl?: string | null;
}

export interface UpdateTicketInput {
  status?: TicketStatus;
  /** true marks it seen (opened); sets seenAt if it isn't set yet. */
  seen?: boolean;
}

export interface TicketListResult {
  tickets: Ticket[];
  /** Tickets not yet opened by the inbox owner -- drives the sidebar badge. */
  unseenCount: number;
}
