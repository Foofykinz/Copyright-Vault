import type { ScanResult, ScrapedVideo } from "../lib/scraped";
import { SCAN_MESSAGE } from "../lib/scraped";

/**
 * TikTok embeds the initial page state as JSON in a <script> tag rather than exposing it purely
 * as a page-global variable, which matters because content scripts run in an isolated JS world
 * (no access to the page's `window` globals) but can still read DOM node contents. Both the
 * current ("__UNIVERSAL_DATA_FOR_REHYDRATION__") and legacy ("SIGI_STATE") element IDs are
 * checked since TikTok has changed this more than once and may again.
 */

interface TikTokItem {
  id: string;
  desc?: string;
  createTime?: number | string;
  stats?: { playCount?: number | string };
  author?: { uniqueId?: string };
}

function readJsonScript(elementId: string): unknown {
  const el = document.getElementById(elementId);
  if (!el || !el.textContent) return null;
  try {
    return JSON.parse(el.textContent);
  } catch {
    return null;
  }
}

function findItemsFromUniversalData(): TikTokItem[] {
  const data = readJsonScript("__UNIVERSAL_DATA_FOR_REHYDRATION__") as
    | { __DEFAULT_SCOPE__?: Record<string, unknown> }
    | null;
  const scope = data?.__DEFAULT_SCOPE__;
  if (!scope) return [];
  const userDetail = scope["webapp.user-detail"] as { itemList?: unknown } | undefined;
  const itemList = userDetail?.itemList;
  return Array.isArray(itemList) ? (itemList as TikTokItem[]) : [];
}

function findItemsFromLegacySigiState(): TikTokItem[] {
  const data = readJsonScript("SIGI_STATE") as { ItemModule?: Record<string, TikTokItem> } | null;
  const itemModule = data?.ItemModule;
  return itemModule ? Object.values(itemModule) : [];
}

function currentHandle(): string | null {
  const match = /\/@([\w.-]+)/.exec(location.pathname);
  return match ? match[1] : null;
}

function scan(): ScanResult {
  const handle = currentHandle();
  const items = findItemsFromUniversalData();
  const rawItems = items.length > 0 ? items : findItemsFromLegacySigiState();

  const videos: ScrapedVideo[] = rawItems
    .filter((item): item is TikTokItem => Boolean(item && item.id))
    .map((item) => {
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
