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

export interface Client {
  id: string;
  name: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
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
}

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

export interface ClientStats {
  totalVideos: number;
  unassignedVideos: number;
  dueSoonVideos: number;
  mostRecentPullAt: string | null;
}

// ---- API request payloads ----

export interface CreateClientInput {
  name: string;
}

export interface UpdateClientInput {
  name?: string;
  archived?: boolean;
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
