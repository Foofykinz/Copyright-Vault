/** A video found by a content script's page scan, before the user reviews and sends it. */
export interface ScrapedVideo {
  /** Stable key for de-duping across repeated scans, e.g. the platform + post ID. */
  key: string;
  videoUrl: string;
  publicationDate: string;
  caption: string;
  viewCount: number | null;
  // YouTube only — undefined for every other platform's scanned videos.
  title?: string;
  thumbnailUrl?: string | null;
  youtubeCategory?: "short" | "live" | "upload";
  channelTitle?: string;
  channelId?: string;
  channelUrl?: string;
  durationSeconds?: number | null;
  liveStatus?: "upcoming" | "live" | "completed";
  scheduledStartTime?: string;
  actualStartTime?: string;
  actualEndTime?: string;
  concurrentViewers?: number;
}

export interface ScanResult {
  supported: boolean;
  profileHandle: string | null;
  videos: ScrapedVideo[];
  /** Total posts/items seen so far (before filtering to originals-with-video), for diagnosing
   * whether a low video count means "scroll more" or "something's being filtered out wrongly". */
  totalCandidates?: number;
  /** Counts of *why* candidates were excluded, keyed by reason (e.g. "share", "noPermalink"). */
  exclusionCounts?: Record<string, number>;
}

export const SCAN_MESSAGE = "viral-drm-scan";

/** Sent from the popup to a content script with `{ keys: string[] }` (ScrapedVideo keys already
 * filtered to whatever passed author/video/date filters), answered with a map of the same keys to
 * a view count, or null where none could be found. Currently only implemented by Instagram, whose
 * profile-timeline scan doesn't carry view counts and needs a separate per-video lookup. */
export const ENRICH_VIEW_COUNTS_MESSAGE = "viral-drm-enrich-view-counts";
export type EnrichViewCountsResult = Record<string, number | null>;

/** True for an unpacked ("Load unpacked") install, false for one from the Chrome Web Store — the
 * standard signal for a dev/local build, since there's no separate build-mode flag wired through
 * esbuild. Used to gate diagnostic logging (e.g. author/page-mismatch exclusions) that would just
 * be noise for a normal user. */
export function isDevBuild(): boolean {
  return !("update_url" in chrome.runtime.getManifest());
}
