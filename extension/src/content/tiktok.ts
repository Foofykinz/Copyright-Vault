import type { ScanResult, ScrapedVideo } from "../lib/scraped";
import { SCAN_MESSAGE } from "../lib/scraped";

interface TikTokItem {
  id: string;
  desc?: string;
  createTime?: number | string;
  stats?: { playCount?: number | string };
  author?: { uniqueId?: string };
}

const NETWORK_MESSAGE_SOURCE = "viral-drm-tiktok";
const capturedItems = new Map<string, TikTokItem>();

// Relayed here by content/tiktok-network.ts, which runs in the page's MAIN world so it can
// intercept the actual API responses TikTok's own JavaScript uses to render the video grid.
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as { source?: string; items?: unknown } | undefined;
  if (data?.source !== NETWORK_MESSAGE_SOURCE || !Array.isArray(data.items)) return;
  for (const item of data.items as TikTokItem[]) {
    if (item && item.id) capturedItems.set(item.id, item);
  }
});

function currentHandle(): string | null {
  const match = /\/@([\w.-]+)/.exec(location.pathname);
  return match ? match[1] : null;
}

function scan(): ScanResult {
  const handle = currentHandle();

  const videos: ScrapedVideo[] = [...capturedItems.values()].map((item) => {
    const author = item.author?.uniqueId ?? handle ?? "unknown";
    const createTime = item.createTime !== undefined ? Number(item.createTime) : NaN;
    const viewCountRaw = item.stats?.playCount !== undefined ? Number(item.stats.playCount) : NaN;
    return {
      key: `tiktok:${item.id}`,
      videoUrl: `https://www.tiktok.com/@${author}/video/${item.id}`,
      publicationDate: Number.isFinite(createTime) ? new Date(createTime * 1000).toISOString() : new Date().toISOString(),
      caption: (item.desc ?? "").trim(),
      viewCount: Number.isFinite(viewCountRaw) ? viewCountRaw : null,
    };
  });

  return { supported: true, profileHandle: handle, videos };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === SCAN_MESSAGE) {
    sendResponse(scan());
  }
});
