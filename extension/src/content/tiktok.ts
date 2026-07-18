import type { ScanResult, ScrapedVideo } from "../lib/scraped";
import { isDevBuild, SCAN_MESSAGE } from "../lib/scraped";
import { truncateWords } from "../../../shared/format";

interface TikTokItem {
  id: string;
  desc?: string;
  createTime?: number | string;
  stats?: { playCount?: number | string };
  author?: { uniqueId?: string };
}

const NETWORK_MESSAGE_SOURCE = "viral-drm-tiktok";
const capturedItems = new Map<string, TikTokItem>();
let lastProfileHandle: string | null = null;

// Authenticates messages from content/tiktok-network.ts (MAIN world) — see the comment at the top
// of that file for what this does and doesn't protect against.
const sessionNonce = crypto.randomUUID();
window.postMessage({ source: NETWORK_MESSAGE_SOURCE, type: "handshake", nonce: sessionNonce }, "*");

function resetForNewProfile(): void {
  capturedItems.clear();
}

function currentHandle(): string | null {
  const match = /\/@([\w.-]+)/.exec(location.pathname);
  return normalizeHandle(match?.[1]);
}

/** Strips a leading @ and lowercases, so a page handle and an item's author.uniqueId (which never
 * carry the @ themselves, but are compared against values that sometimes do) compare equal. */
function normalizeHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^@/, "").toLowerCase();
  return trimmed || null;
}

// Relayed here by content/tiktok-network.ts, which runs in the page's MAIN world so it can
// intercept the actual API responses TikTok's own JavaScript uses to render the video grid.
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as { source?: string; items?: unknown; nonce?: string } | undefined;
  if (data?.source !== NETWORK_MESSAGE_SOURCE || !Array.isArray(data.items)) return;
  if (data.nonce !== sessionNonce) return; // not tagged with our own session nonce — reject

  const profileHandle = currentHandle();
  // TikTok is a SPA — navigating between profiles doesn't reload this content script, so without
  // this a scan after browsing from one client's TikTok to another's could mix both together.
  if (profileHandle !== lastProfileHandle) {
    resetForNewProfile();
    lastProfileHandle = profileHandle;
  }
  // Not on a recognized profile page — refuse to accumulate anything at all rather than guess.
  if (!profileHandle) return;

  for (const item of data.items as TikTokItem[]) {
    if (!item?.id) continue;
    const author = normalizeHandle(item.author?.uniqueId);
    // item.author.uniqueId is the only authoritative author field — never fall back to the
    // page's own handle for an item that doesn't carry its own matching author.
    if (!author || author !== profileHandle) continue;
    capturedItems.set(item.id, item);
  }
});

function scan(): ScanResult {
  const handle = currentHandle();
  if (handle !== lastProfileHandle) {
    resetForNewProfile();
    lastProfileHandle = handle;
  }
  if (!handle) {
    return { supported: true, profileHandle: null, videos: [], totalCandidates: 0, exclusionCounts: { notAuthor: 0 } };
  }

  const videos: ScrapedVideo[] = [];
  let excludedNotAuthor = 0;

  for (const item of capturedItems.values()) {
    // Re-verified here, not just trusted from capture time, in case anything slipped into the map
    // just before a profile switch was detected.
    const author = normalizeHandle(item.author?.uniqueId);
    if (!author || author !== handle) {
      excludedNotAuthor += 1;
      if (isDevBuild()) console.warn("[ViralDRM] TikTok item excluded — author mismatch:", item.id, item.author);
      continue;
    }
    const createTime = item.createTime !== undefined ? Number(item.createTime) : NaN;
    const viewCountRaw = item.stats?.playCount !== undefined ? Number(item.stats.playCount) : NaN;
    videos.push({
      key: `tiktok:${item.id}`,
      videoUrl: `https://www.tiktok.com/@${author}/video/${item.id}`,
      publicationDate: Number.isFinite(createTime) ? new Date(createTime * 1000).toISOString() : new Date().toISOString(),
      caption: truncateWords(item.desc ?? ""),
      viewCount: Number.isFinite(viewCountRaw) ? viewCountRaw : null,
    });
  }

  return {
    supported: true,
    profileHandle: handle,
    videos,
    totalCandidates: capturedItems.size,
    exclusionCounts: { notAuthor: excludedNotAuthor },
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === SCAN_MESSAGE) {
    sendResponse(scan());
  }
});
