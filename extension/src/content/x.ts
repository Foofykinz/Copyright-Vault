import type { ScanResult, ScrapedVideo } from "../lib/scraped";
import { SCAN_MESSAGE } from "../lib/scraped";
import { truncateWords } from "../../../shared/format";

/**
 * X virtualizes its timeline — tweets scrolled far out of view get unmounted from the DOM
 * entirely, not just hidden. A one-shot scan can only ever see whatever's rendered at that exact
 * instant, which forced scrolling in small increments with a scan after each one. Instead, this
 * polls the DOM continuously in the background (the DOM equivalent of how TikTok/Facebook's
 * network interception accumulates passively as the page loads more) and keeps a running map of
 * every video tweet ever seen, so a single "Scan this page" click after scrolling all the way
 * through picks up everything along the way. Selectors key off data-testid attributes, which X
 * uses for its own internal tooling/accessibility and are meaningfully more stable than class
 * names, but this will still need maintenance if X changes its markup.
 */

const capturedVideos = new Map<string, ScrapedVideo>();
const processedTweetIds = new Set<string>();
const exclusionTotals = { repost: 0, noVideo: 0, authorMismatch: 0 };
let lastProfileHandle: string | null = null;

function parseCompactNumber(raw: string): number | null {
  const text = raw.trim().toUpperCase().replace(/,/g, "").replace(/VIEWS?$/, "").trim();
  const match = /^([\d.]+)([KMB]?)$/.exec(text);
  if (!match) {
    const plain = Number(text);
    return Number.isFinite(plain) ? plain : null;
  }
  const [, numStr, suffix] = match;
  const num = Number(numStr);
  if (!Number.isFinite(num)) return null;
  if (suffix === "K") return Math.round(num * 1_000);
  if (suffix === "M") return Math.round(num * 1_000_000);
  if (suffix === "B") return Math.round(num * 1_000_000_000);
  return Math.round(num);
}

function currentProfileHandle(): string | null {
  const match = /^\/([A-Za-z0-9_]{1,15})(?:\/(?:with_replies|media|likes))?\/?$/.exec(location.pathname);
  return match ? match[1].toLowerCase() : null;
}

function resetForNewProfile(): void {
  capturedVideos.clear();
  processedTweetIds.clear();
  exclusionTotals.repost = 0;
  exclusionTotals.noVideo = 0;
  exclusionTotals.authorMismatch = 0;
}

function captureVisibleTweets(): void {
  const profileHandle = currentProfileHandle();
  // X is a single-page app — navigating to a different profile doesn't reload this content
  // script, so without this a scroll session on one client's profile could bleed into another's.
  if (profileHandle !== lastProfileHandle) {
    resetForNewProfile();
    lastProfileHandle = profileHandle;
  }

  const articles = Array.from(document.querySelectorAll<HTMLElement>('article[data-testid="tweet"]'));

  for (const article of articles) {
    // Skip quote-tweet embeds nested inside another tweet — only top-level timeline entries.
    if (article.parentElement?.closest('article[data-testid="tweet"]')) continue;

    const timeEl = article.querySelector<HTMLTimeElement>('a[href*="/status/"] time');
    const statusLink = timeEl?.closest("a") as HTMLAnchorElement | null;
    const href = statusLink?.getAttribute("href") ?? "";
    const statusMatch = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/.exec(href);
    // No status link/ID resolvable yet (e.g. still rendering) — don't count it as excluded,
    // just leave it for a later poll tick to pick up once it settles.
    if (!statusMatch) continue;

    const [, author, statusId] = statusMatch;
    if (processedTweetIds.has(statusId)) continue; // already handled on an earlier poll
    processedTweetIds.add(statusId);

    const socialContext = article.querySelector('[data-testid="socialContext"]');
    if (socialContext && /repost/i.test(socialContext.textContent ?? "")) {
      exclusionTotals.repost += 1;
      continue;
    }

    const hasVideo = article.querySelector('[data-testid="videoPlayer"], [data-testid="videoComponent"], video');
    if (!hasVideo) {
      exclusionTotals.noVideo += 1;
      continue;
    }

    if (profileHandle && author.toLowerCase() !== profileHandle) {
      exclusionTotals.authorMismatch += 1;
      continue;
    }

    const publicationDate = timeEl?.getAttribute("datetime") ?? new Date().toISOString();
    const captionEl = article.querySelector('[data-testid="tweetText"]');
    const caption = truncateWords(captionEl?.textContent ?? "");
    const analyticsLink = article.querySelector('a[href$="/analytics"]');
    const viewCount = analyticsLink ? parseCompactNumber(analyticsLink.textContent ?? "") : null;

    capturedVideos.set(`x:${statusId}`, {
      key: `x:${statusId}`,
      videoUrl: `https://x.com/${author}/status/${statusId}`,
      publicationDate,
      caption,
      viewCount,
    });
  }
}

// Passive background capture — polling is simpler and robust enough here than a MutationObserver
// for a modest number of visible tweets, and matches how TikTok/Facebook accumulate continuously
// rather than only reacting to an explicit scan request. A fast scroll can render and then
// virtualize a tweet back out between two poll ticks, so this also captures on scroll directly
// (throttled) rather than relying on the interval alone — capture:true on document catches scroll
// events regardless of whether X scrolls the window or an inner container.
setInterval(captureVisibleTweets, 500);

let scrollCaptureScheduled = false;
document.addEventListener(
  "scroll",
  () => {
    if (scrollCaptureScheduled) return;
    scrollCaptureScheduled = true;
    setTimeout(() => {
      captureVisibleTweets();
      scrollCaptureScheduled = false;
    }, 150);
  },
  { passive: true, capture: true }
);

captureVisibleTweets();

function scan(): ScanResult {
  captureVisibleTweets(); // catch anything since the last poll tick
  const totalCandidates =
    capturedVideos.size + exclusionTotals.repost + exclusionTotals.noVideo + exclusionTotals.authorMismatch;
  return {
    supported: true,
    profileHandle: lastProfileHandle,
    videos: [...capturedVideos.values()],
    totalCandidates,
    exclusionCounts: { ...exclusionTotals },
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === SCAN_MESSAGE) {
    sendResponse(scan());
  }
});
