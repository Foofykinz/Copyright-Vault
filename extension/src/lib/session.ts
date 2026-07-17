import type { ScrapedVideo } from "./scraped";
import type { YouTubeClassificationStatus } from "../../../shared/types";

export type DateMode = "sincePull" | "range";

/**
 * Belt-and-suspenders persistence for in-progress selections/scan results, using
 * chrome.storage.session (cleared when the browser closes, kept otherwise). The side panel
 * shouldn't normally be torn down mid-workflow the way a popup would, but this keeps things
 * recoverable if it is (browser restart, manually closing the panel, etc).
 */
export interface SessionState {
  selectedClientId: string;
  selectedSocialAccountId: string;
  scannedVideos: ScrapedVideo[];
  selectedKeys: string[];
  dateMode: DateMode;
  rangeStart: string;
  rangeEnd: string;
  /** Set only after a YouTube scan; null for every other platform / before a first YouTube scan. */
  youtubeChannelTitle: string | null;
  youtubeClassificationStatus: YouTubeClassificationStatus | null;
}

const STORAGE_KEY = "viralDrmSession";
const EMPTY_SESSION: SessionState = {
  selectedClientId: "",
  selectedSocialAccountId: "",
  scannedVideos: [],
  selectedKeys: [],
  dateMode: "sincePull",
  rangeStart: "",
  rangeEnd: "",
  youtubeChannelTitle: null,
  youtubeClassificationStatus: null,
};

export async function getSession(): Promise<SessionState> {
  const result = await chrome.storage.session.get(STORAGE_KEY);
  return { ...EMPTY_SESSION, ...(result[STORAGE_KEY] as Partial<SessionState> | undefined) };
}

export async function updateSession(patch: Partial<SessionState>): Promise<void> {
  const current = await getSession();
  await chrome.storage.session.set({ [STORAGE_KEY]: { ...current, ...patch } });
}
