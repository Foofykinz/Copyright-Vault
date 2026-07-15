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
}

export const SCAN_MESSAGE = "viral-drm-scan";
