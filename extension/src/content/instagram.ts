import type { EnrichViewCountsResult, ScanResult, ScrapedVideo } from "../lib/scraped";
import { ENRICH_VIEW_COUNTS_MESSAGE, SCAN_MESSAGE } from "../lib/scraped";
import { truncateWords } from "../../../shared/format";

interface IgUser {
  pk?: string;
  username?: string;
}

interface IgCarouselItem {
  pk?: string;
  taken_at?: number;
  media_type?: number;
  video_versions?: unknown[];
}

interface IgNode {
  code?: string;
  pk?: string;
  taken_at?: number;
  media_type?: number; // 1 = photo, 2 = video, 8 = carousel
  product_type?: string; // "clips" for standalone Reels/video, "carousel_container" for carousels
  video_versions?: unknown[];
  caption?: { text?: string } | null;
  user?: IgUser;
  coauthor_producers?: IgUser[];
  carousel_media?: IgCarouselItem[];
}

const NETWORK_MESSAGE_SOURCE = "viral-drm-instagram";
const capturedNodes = new Map<string, IgNode>();
let lastProfileHandle: string | null = null;

// Authenticates messages from content/instagram-network.ts (MAIN world) — see the comment at the
// top of that file for what this does and doesn't protect against. Generated fresh per page load
// and never exposed on window, so a same-page script can't read it directly; it can only learn it
// by observing our own postMessage traffic (see the caveat in instagram-network.ts).
const sessionNonce = crypto.randomUUID();
window.postMessage({ source: NETWORK_MESSAGE_SOURCE, type: "handshake", nonce: sessionNonce }, "*");

// Relayed from content/instagram-network.ts (MAIN world), which observes it on a real request
// Instagram's own code makes. Needed to call /api/v1/media/<pk>/info/ ourselves for view-count
// enrichment — Instagram rejects that endpoint without it.
let capturedAppId: string | null = null;

// Confirmed via live capture: the profile-timeline query never carries a populated view count, but
// /api/v1/media/<pk>/info/ does (items[0].play_count / ig_play_count). Cached by pk so repeat scans
// of the same profile don't re-request videos we already have a confirmed answer for. Only
// successful lookups are cached — a failed request (network error, 429, etc.) is left uncached so
// a later scan can naturally try again, without this script retrying it itself.
const viewCountCache = new Map<string, number | null>();
const MAX_CONCURRENT_ENRICH_REQUESTS = 3;

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

interface CountLookup {
  ok: boolean;
  count: number | null;
}

async function fetchPlayCount(pk: string): Promise<CountLookup> {
  try {
    const headers: Record<string, string> = {};
    if (capturedAppId) headers["x-ig-app-id"] = capturedAppId;
    const csrftoken = readCookie("csrftoken");
    if (csrftoken) headers["x-csrftoken"] = csrftoken;

    const response = await fetch(`https://www.instagram.com/api/v1/media/${pk}/info/`, {
      method: "GET",
      headers,
      credentials: "include",
    });
    if (!response.ok) return { ok: false, count: null }; // includes 429 — no retry here, no throw
    const json = (await response.json()) as { items?: { play_count?: unknown; ig_play_count?: unknown }[] };
    const raw = json.items?.[0]?.play_count ?? json.items?.[0]?.ig_play_count;
    return { ok: true, count: typeof raw === "number" ? raw : null };
  } catch {
    return { ok: false, count: null };
  }
}

/** Looks up view counts for a set of media pks, respecting the cache and a small concurrency cap
 * so a large batch doesn't fire dozens of simultaneous requests at Instagram at once. */
async function enrichViewCounts(pks: string[]): Promise<Map<string, number | null>> {
  const results = new Map<string, number | null>();
  const toFetch: string[] = [];
  for (const pk of new Set(pks)) {
    if (viewCountCache.has(pk)) results.set(pk, viewCountCache.get(pk)!);
    else toFetch.push(pk);
  }

  let next = 0;
  async function worker(): Promise<void> {
    while (next < toFetch.length) {
      const pk = toFetch[next++];
      const lookup = await fetchPlayCount(pk);
      results.set(pk, lookup.count);
      if (lookup.ok) viewCountCache.set(pk, lookup.count);
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_ENRICH_REQUESTS, toFetch.length) }, worker));

  return results;
}

// Reserved top-level paths that share the same single-segment URL shape as a profile
// (instagram.com/<username>/) but aren't profiles — without this, currentProfileHandle() would
// misidentify them.
const RESERVED_PATHS = new Set(["explore", "direct", "accounts", "stories", "reels", "reel", "p", "tv", "about"]);

function currentProfileHandle(): string | null {
  const match = /^\/([A-Za-z0-9_.]{1,30})(?:\/(?:reels|tagged|saved|following|followers))?\/?$/.exec(location.pathname);
  if (!match) return null;
  const handle = match[1].toLowerCase();
  return RESERVED_PATHS.has(handle) ? null : handle;
}

function resetForNewProfile(): void {
  capturedNodes.clear();
}

// Relayed here by content/instagram-network.ts, which runs in the page's MAIN world so it can
// intercept the actual GraphQL responses Instagram's own JavaScript uses to render the profile.
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as { source?: string; nodes?: unknown; appId?: string; nonce?: string } | undefined;
  if (data?.source !== NETWORK_MESSAGE_SOURCE) return;
  if (data.nonce !== sessionNonce) return; // not tagged with our own session nonce — reject

  if (typeof data.appId === "string") {
    capturedAppId = data.appId;
    return;
  }
  if (!Array.isArray(data.nodes)) return;

  const profileHandle = currentProfileHandle();
  if (profileHandle !== lastProfileHandle) {
    resetForNewProfile();
    lastProfileHandle = profileHandle;
  }
  // Don't accumulate anything unless we're confirmed to be on a specific profile's page — avoids
  // pulling in unrelated posts from the general feed/explore if those happen to load in the
  // background while the extension is capturing.
  if (!profileHandle) return;

  for (const node of data.nodes as IgNode[]) {
    if (!node?.pk) continue;
    capturedNodes.set(node.pk, node);
  }
});

function isAuthoredByProfile(node: IgNode, profileHandle: string): boolean {
  const candidates = [node.user, ...(node.coauthor_producers ?? [])];
  return candidates.some((u) => u?.username?.toLowerCase() === profileHandle);
}

function permalinkForNode(node: IgNode): string | null {
  return node.code ? `https://www.instagram.com/p/${node.code}/` : null;
}

function hasVideo(mediaType: number | undefined, videoVersions: unknown[] | undefined): boolean {
  return mediaType === 2 && Array.isArray(videoVersions) && videoVersions.length > 0;
}

/** Extracts every video represented by a post: itself if it's a standalone video, or any video
 * items nested inside a carousel. Carousel items share the parent's permalink and caption —
 * Instagram doesn't expose a distinct URL or caption per carousel item. */
function extractVideosFromNode(node: IgNode): ScrapedVideo[] {
  const permalink = permalinkForNode(node);
  if (!permalink) return [];
  const caption = truncateWords(node.caption?.text ?? "");
  const results: ScrapedVideo[] = [];

  if (hasVideo(node.media_type, node.video_versions) && node.pk && node.taken_at !== undefined) {
    results.push({
      key: `instagram:${node.pk}`,
      videoUrl: permalink,
      publicationDate: new Date(node.taken_at * 1000).toISOString(),
      caption,
      viewCount: null, // not populated by the timeline query — filled in later via enrichViewCounts
    });
  }

  if (node.product_type === "carousel_container" && Array.isArray(node.carousel_media)) {
    for (const item of node.carousel_media) {
      if (!hasVideo(item.media_type, item.video_versions) || !item.pk) continue;
      const takenAt = item.taken_at ?? node.taken_at;
      if (takenAt === undefined) continue;
      results.push({
        key: `instagram:${item.pk}`,
        videoUrl: permalink,
        publicationDate: new Date(takenAt * 1000).toISOString(),
        caption,
        viewCount: null, // filled in later via enrichViewCounts
      });
    }
  }

  return results;
}

function scan(): ScanResult {
  const profileHandle = currentProfileHandle();
  if (profileHandle !== lastProfileHandle) {
    resetForNewProfile();
    lastProfileHandle = profileHandle;
  }

  const videos: ScrapedVideo[] = [];
  const exclusionCounts = { missingIds: 0, notAuthor: 0, noVideo: 0 };

  for (const node of capturedNodes.values()) {
    if (!node.pk || node.taken_at === undefined || !node.code) {
      exclusionCounts.missingIds += 1;
      continue;
    }
    if (profileHandle && !isAuthoredByProfile(node, profileHandle)) {
      exclusionCounts.notAuthor += 1;
      continue;
    }
    const extracted = extractVideosFromNode(node);
    if (extracted.length === 0) {
      exclusionCounts.noVideo += 1;
      continue;
    }
    videos.push(...extracted);
  }

  return {
    supported: true,
    profileHandle,
    videos,
    totalCandidates: capturedNodes.size,
    exclusionCounts,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === SCAN_MESSAGE) {
    sendResponse(scan());
    return;
  }
  if (message?.type === ENRICH_VIEW_COUNTS_MESSAGE && Array.isArray(message.keys)) {
    const pkByKey = new Map<string, string>();
    for (const key of message.keys as string[]) {
      const pk = key.startsWith("instagram:") ? key.slice("instagram:".length) : null;
      if (pk) pkByKey.set(key, pk);
    }
    enrichViewCounts([...pkByKey.values()]).then((countsByPk) => {
      const result: EnrichViewCountsResult = {};
      for (const [key, pk] of pkByKey) result[key] = countsByPk.get(pk) ?? null;
      sendResponse(result);
    });
    return true; // keep the message channel open for the async sendResponse above
  }
});
