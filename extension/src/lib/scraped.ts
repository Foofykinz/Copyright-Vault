/** A video found by a content script's page scan, before the user reviews and sends it. */
export interface ScrapedVideo {
  /** Stable key for de-duping across repeated scans, e.g. the platform + post ID. */
  key: string;
  videoUrl: string;
  publicationDate: string;
  caption: string;
  viewCount: number | null;
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
