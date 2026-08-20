export type Platform = "facebook" | "instagram" | "tiktok" | "youtube" | "x" | "other";

export const PLATFORMS: Platform[] = ["facebook", "instagram", "tiktok", "youtube", "x", "other"];

export const PLATFORM_LABELS: Record<Platform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
  other: "Other",
};

export type DeadlineStatus = "neutral" | "amber" | "urgent" | "expired";

export interface SessionUser {
  id: string;
  name: string;
  username: string;
  mustChangePassword: boolean;
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
