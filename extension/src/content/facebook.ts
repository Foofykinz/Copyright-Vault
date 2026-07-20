import type { ScanResult, ScrapedVideo } from "../lib/scraped";
import { isDevBuild, SCAN_MESSAGE } from "../lib/scraped";
import { truncateWords } from "../../../shared/format";

/**
 * Reads Facebook's own rendered DOM instead of intercepting fetch/XMLHttpRequest — deliberately
 * traded off against the network-interception approach this replaced (see git history:
 * facebook-network.ts) after that technique was suspected (not confirmed) of contributing to a
 * Facebook account restriction. This never patches window.fetch/XHR and never runs in the page's
 * MAIN world, so there's no window.postMessage bridge and nothing to spoof — same posture X
 * already has.
 *
 * The tradeoff: Facebook's markup doesn't have a stable, documented convention the way X's
 * data-testid attributes do. The selectors below (role="article" story containers, href-pattern
 * matching for permalinks, [dir="auto"] for caption text) are a best-effort first pass based on
 * long-standing Facebook DOM conventions, NOT verified against a live capture the way every other
 * scraper in this codebase was before shipping. Treat this as a draft that needs a real test pass
 * against an actual profile page — exclusionCounts below exists specifically so that pass can see
 * what's being missed and why, the same way it did for X and TikTok during their own bring-up.
 *
 * Only a `<video>` element or a link into a known video-post URL shape counts as "this post has a
 * video" — text/photo posts are never included. A story with no resolvable permalink or
 * publication date is retried on a later poll rather than skipped forever or given a fabricated
 * fallback (same policy as every other platform here) — Facebook lazy-mounts video players and
 * sometimes the timestamp tooltip isn't populated yet on first render.
 */

const capturedVideos = new Map<string, ScrapedVideo>();
const capturedKeys = new Set<string>();
const excludedOnceKeys = new Set<string>();
const exclusionTotals = { share: 0, noVideo: 0, noPermalink: 0, noDate: 0 };
let lastProfileHandle: string | null = null;

function resetForNewProfile(): void {
  capturedVideos.clear();
  capturedKeys.clear();
  excludedOnceKeys.clear();
  exclusionTotals.share = 0;
  exclusionTotals.noVideo = 0;
  exclusionTotals.noPermalink = 0;
  exclusionTotals.noDate = 0;
}

// Reserved top-level paths that share the same single-segment URL shape as a profile/Page
// (facebook.com/<name>/) but aren't one.
const RESERVED_PATHS = new Set([
  "watch", "groups", "marketplace", "gaming", "events", "pages", "help", "settings", "messages",
  "notifications", "stories", "reel", "story.php", "photo.php", "permalink.php", "share", "login",
  "home.php", "friends",
]);

function currentProfileHandle(): string | null {
  const { pathname, search } = location;
  if (pathname === "/profile.php") {
    const id = new URLSearchParams(search).get("id");
    return id ? id.toLowerCase() : null;
  }
  const peopleMatch = /^\/people\/[^/]+\/(\d+)/.exec(pathname);
  if (peopleMatch) return peopleMatch[1];

  const match = /^\/([A-Za-z0-9_.\-]{1,80})\/?/.exec(pathname);
  if (!match) return null;
  const handle = match[1].toLowerCase();
  return RESERVED_PATHS.has(handle) ? null : handle;
}

// Known Facebook permalink shapes for a video-carrying post. Deliberately broad (posts/reels/watch
// links too, not just /videos/) since a video can be attached to any of these post types.
const PERMALINK_HREF_RE = /\/(videos|reel|posts|watch)\/|permalink\.php\?|story_fbid=/;

function findPermalink(container: HTMLElement): string | null {
  for (const a of Array.from(container.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = a.getAttribute("href") ?? "";
    if (!PERMALINK_HREF_RE.test(href)) continue;
    try {
      return new URL(href, location.origin).toString();
    } catch {
      continue;
    }
  }
  return null;
}

// Facebook commonly puts the full timestamp in a title attribute on the (abbreviated, relative-
// time) permalink/date link, for the hover tooltip — same idea as an HTML `title` on X's <time>,
// just without a dedicated element. Falls back to any element with an aria-label that parses as a
// date, since which one carries it varies by surface (profile timeline vs. Page vs. Reels).
function findPublicationDate(container: HTMLElement): string | null {
  for (const el of Array.from(container.querySelectorAll<HTMLElement>("a[title], abbr[title], span[title]"))) {
    const title = el.getAttribute("title");
    if (!title) continue;
    const parsed = Date.parse(title);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  for (const el of Array.from(container.querySelectorAll<HTMLElement>("[aria-label]"))) {
    const label = el.getAttribute("aria-label") ?? "";
    const parsed = Date.parse(label);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

// Best-effort caption: Facebook wraps user-generated text (post bodies, not chrome/labels) in
// dir="auto" for bidi text handling — a long-standing convention, though not guaranteed stable.
// Picks the longest such block in the container, on the theory that UI labels are short and post
// text is comparatively long.
function findCaption(container: HTMLElement): string {
  let best = "";
  for (const el of Array.from(container.querySelectorAll<HTMLElement>('[dir="auto"]'))) {
    const text = el.textContent?.trim() ?? "";
    if (text.length > best.length) best = text;
  }
  return best;
}

function looksLikeShare(container: HTMLElement): boolean {
  const headerText = container.textContent?.slice(0, 400) ?? "";
  return /\bshared\b/i.test(headerText);
}

function hasVideo(container: HTMLElement): boolean {
  if (container.querySelector("video")) return true;
  return Array.from(container.querySelectorAll<HTMLAnchorElement>("a[href]")).some((a) =>
    /\/(videos|reel|watch)\//.test(a.getAttribute("href") ?? "")
  );
}

function captureVisibleStories(): void {
  const profileHandle = currentProfileHandle();
  // Facebook is a heavy SPA — browsing from one client's profile to another's doesn't reload this
  // content script, so without this a session could mix videos from several profiles together.
  if (profileHandle !== lastProfileHandle) {
    resetForNewProfile();
    lastProfileHandle = profileHandle;
  }
  if (!profileHandle) return;

  const articles = Array.from(document.querySelectorAll<HTMLElement>('[role="article"]'));

  for (const article of articles) {
    // Skip a story nested inside another (a shared post's embedded original, a comment, etc.) —
    // only top-level timeline entries.
    if (article.parentElement?.closest('[role="article"]')) continue;

    if (looksLikeShare(article)) {
      exclusionTotals.share += 1;
      continue;
    }

    if (!hasVideo(article)) {
      // Not locked out — Facebook lazy-mounts video players, retried on a later poll.
      exclusionTotals.noVideo += 1;
      continue;
    }

    const permalink = findPermalink(article);
    if (!permalink) {
      exclusionTotals.noPermalink += 1;
      if (isDevBuild()) console.warn("[ViralDRM] Facebook story has a video but no resolvable permalink yet.");
      continue;
    }

    const key = `facebook:${permalink}`;
    if (capturedKeys.has(key)) continue; // already successfully captured

    const publicationDate = findPublicationDate(article);
    if (!publicationDate) {
      exclusionTotals.noDate += 1;
      continue;
    }

    capturedKeys.add(key);
    capturedVideos.set(key, {
      key,
      videoUrl: permalink,
      publicationDate,
      caption: truncateWords(findCaption(article)),
      // Facebook doesn't expose view counts publicly in either the feed DOM or its network
      // responses — stays manual, same as X.
      viewCount: null,
    });
  }
}

// Passive background capture, matching x.ts: an interval poll plus a scroll listener, since a fast
// scroll can render and virtualize a story back out between two poll ticks.
setInterval(captureVisibleStories, 500);

let scrollCaptureScheduled = false;
document.addEventListener(
  "scroll",
  () => {
    if (scrollCaptureScheduled) return;
    scrollCaptureScheduled = true;
    setTimeout(() => {
      captureVisibleStories();
      scrollCaptureScheduled = false;
    }, 150);
  },
  { passive: true, capture: true }
);

captureVisibleStories();

function scan(): ScanResult {
  captureVisibleStories(); // catch anything since the last poll tick

  const profileHandle = lastProfileHandle;
  if (!profileHandle) {
    return { supported: true, profileHandle: null, videos: [], totalCandidates: 0, exclusionCounts: { ...exclusionTotals } };
  }

  const videos = [...capturedVideos.values()];
  const totalCandidates = videos.length + exclusionTotals.share + exclusionTotals.noVideo + exclusionTotals.noPermalink + exclusionTotals.noDate;

  return {
    supported: true,
    profileHandle,
    videos,
    totalCandidates,
    exclusionCounts: { ...exclusionTotals },
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === SCAN_MESSAGE) {
    sendResponse(scan());
  }
});
