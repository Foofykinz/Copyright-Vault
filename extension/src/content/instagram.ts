import type { ScanResult, ScrapedVideo } from "../lib/scraped";
import { SCAN_MESSAGE } from "../lib/scraped";
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
  const data = event.data as { source?: string; nodes?: unknown } | undefined;
  if (data?.source !== NETWORK_MESSAGE_SOURCE || !Array.isArray(data.nodes)) return;

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
      viewCount: null, // present in the schema but not populated by this query — stays manual
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
        viewCount: null,
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
  }
});
