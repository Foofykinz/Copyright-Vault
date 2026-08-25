import type { ScanResult, ScrapedVideo } from "../lib/scraped";
import { SCAN_MESSAGE } from "../lib/scraped";
import { truncateWords } from "../../../shared/format";

interface ThreadsUser {
  pk?: string;
  username?: string;
}

interface ThreadsImageCandidate {
  url?: string;
  width?: number;
}

interface ThreadsTextFragment {
  fragment_type?: string;
  plaintext?: string;
}

interface ThreadsPost {
  pk?: string;
  code?: string;
  taken_at?: number;
  media_type?: number; // 1 = photo, 2 = video, 8 = carousel — same convention as Instagram's schema
  video_versions?: unknown[];
  caption?: { text?: string } | null;
  user?: ThreadsUser;
  image_versions2?: { candidates?: ThreadsImageCandidate[] };
  text_post_app_info?: { text_fragments?: { fragments?: ThreadsTextFragment[] } };
}

const NETWORK_MESSAGE_SOURCE = "viral-drm-threads";
const capturedPosts = new Map<string, ThreadsPost>();
let lastProfileHandle: string | null = null;

function currentProfileHandle(): string | null {
  // Threads profile URLs are threads.com/@handle -- confirmed via live capture. Tab suffixes below
  // (replies/reposts/media) are a best guess pending live confirmation, matching the pattern
  // X/Instagram use for their own profile sub-tabs; if Threads' actual tab URLs differ, only
  // narrows which sub-tabs are recognized as "still the profile", not the base case.
  const match = /^\/@([A-Za-z0-9_.]{1,30})(?:\/(?:replies|reposts|media))?\/?$/.exec(location.pathname);
  return match ? match[1].toLowerCase() : null;
}

function resetForNewProfile(): void {
  capturedPosts.clear();
}

// Relayed here by content/threads-network.ts, which runs in the page's MAIN world so it can
// intercept the actual GraphQL responses Threads' own JavaScript uses to render the profile.
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as { source?: string; posts?: unknown } | undefined;
  if (data?.source !== NETWORK_MESSAGE_SOURCE) return;
  if (!Array.isArray(data.posts)) return;

  const profileHandle = currentProfileHandle();
  if (profileHandle !== lastProfileHandle) {
    resetForNewProfile();
    lastProfileHandle = profileHandle;
  }
  // Don't accumulate anything unless we're confirmed to be on a specific profile's page — same
  // guard Instagram's content script uses, and doubly necessary here since a profile's own query
  // response is confirmed (live capture) to mix in OTHER users' replies alongside the profile
  // owner's posts.
  if (!profileHandle) return;

  for (const post of data.posts as ThreadsPost[]) {
    if (!post?.pk) continue;
    capturedPosts.set(post.pk, post);
  }
});

function isAuthoredByProfile(post: ThreadsPost, profileHandle: string): boolean {
  return post.user?.username?.toLowerCase() === profileHandle;
}

function permalinkForPost(post: ThreadsPost): string | null {
  return post.user?.username && post.code ? `https://www.threads.com/@${post.user.username}/post/${post.code}` : null;
}

function hasVideo(post: ThreadsPost): boolean {
  return post.media_type === 2 && Array.isArray(post.video_versions) && post.video_versions.length > 0;
}

function captionText(post: ThreadsPost): string {
  if (post.caption?.text) return truncateWords(post.caption.text);
  const fragments = post.text_post_app_info?.text_fragments?.fragments ?? [];
  const plaintext = fragments
    .filter((f) => f.fragment_type === "plaintext" && f.plaintext)
    .map((f) => f.plaintext)
    .join("");
  return truncateWords(plaintext);
}

function thumbnailForPost(post: ThreadsPost): string | null {
  const candidates = post.image_versions2?.candidates ?? [];
  if (candidates.length === 0) return null;
  // Candidates aren't guaranteed to be ordered by size — pick the largest explicitly rather than
  // assuming index 0 is the biggest.
  const widest = candidates.reduce((best, c) => ((c.width ?? 0) > (best.width ?? 0) ? c : best), candidates[0]);
  return widest.url ?? null;
}

function scan(): ScanResult {
  const profileHandle = currentProfileHandle();
  if (profileHandle !== lastProfileHandle) {
    resetForNewProfile();
    lastProfileHandle = profileHandle;
  }

  const videos: ScrapedVideo[] = [];
  const exclusionCounts = { missingIds: 0, notAuthor: 0, noVideo: 0 };

  for (const post of capturedPosts.values()) {
    if (!post.pk || post.taken_at === undefined || !post.code) {
      exclusionCounts.missingIds += 1;
      continue;
    }
    if (profileHandle && !isAuthoredByProfile(post, profileHandle)) {
      exclusionCounts.notAuthor += 1;
      continue;
    }
    if (!hasVideo(post)) {
      exclusionCounts.noVideo += 1;
      continue;
    }
    const permalink = permalinkForPost(post);
    if (!permalink) {
      exclusionCounts.missingIds += 1;
      continue;
    }

    videos.push({
      key: `threads:${post.pk}`,
      videoUrl: permalink,
      publicationDate: new Date(post.taken_at * 1000).toISOString(),
      caption: captionText(post),
      // Threads doesn't expose a public view count on posts, confirmed via live capture (no
      // view/play count field anywhere on the post, and none shown in the UI) — always null here,
      // unlike Instagram's viewCount: null which gets filled in later via a follow-up request.
      viewCount: null,
      thumbnailUrl: thumbnailForPost(post),
    });
  }

  return {
    supported: true,
    profileHandle,
    videos,
    totalCandidates: capturedPosts.size,
    exclusionCounts,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === SCAN_MESSAGE) {
    sendResponse(scan());
  }
});
