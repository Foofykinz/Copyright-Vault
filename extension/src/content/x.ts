import type { ScanResult, ScrapedVideo } from "../lib/scraped";
import { SCAN_MESSAGE } from "../lib/scraped";

/**
 * X only renders tweets currently scrolled into view (virtualized timeline), so a scan only
 * captures what's loaded right now — the popup instructs the user to scroll and re-scan to
 * pick up more. Selectors key off data-testid attributes, which X uses for its own internal
 * tooling/accessibility and are meaningfully more stable than class names, but this will still
 * need maintenance if X changes its markup.
 */

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

function scan(): ScanResult {
  const profileHandle = currentProfileHandle();
  const articles = Array.from(document.querySelectorAll<HTMLElement>('article[data-testid="tweet"]'));
  const videos: ScrapedVideo[] = [];

  for (const article of articles) {
    // Skip quote-tweet embeds nested inside another tweet — only top-level timeline entries.
    if (article.parentElement?.closest('article[data-testid="tweet"]')) continue;

    const socialContext = article.querySelector('[data-testid="socialContext"]');
    if (socialContext && /repost/i.test(socialContext.textContent ?? "")) continue;

    const hasVideo = article.querySelector('[data-testid="videoPlayer"], [data-testid="videoComponent"], video');
    if (!hasVideo) continue;

    const timeEl = article.querySelector<HTMLTimeElement>('a[href*="/status/"] time');
    const statusLink = timeEl?.closest("a") as HTMLAnchorElement | null;
    if (!statusLink) continue;

    const href = statusLink.getAttribute("href") ?? "";
    const statusMatch = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/.exec(href);
    if (!statusMatch) continue;
    const [, author, statusId] = statusMatch;

    if (profileHandle && author.toLowerCase() !== profileHandle) continue;

    const publicationDate = timeEl?.getAttribute("datetime") ?? new Date().toISOString();

    const captionEl = article.querySelector('[data-testid="tweetText"]');
    const caption = (captionEl?.textContent ?? "").trim();

    const analyticsLink = article.querySelector('a[href$="/analytics"]');
    const viewCount = analyticsLink ? parseCompactNumber(analyticsLink.textContent ?? "") : null;

    videos.push({
      key: `x:${statusId}`,
      videoUrl: `https://x.com/${author}/status/${statusId}`,
      publicationDate,
      caption,
      viewCount,
    });
  }

  return { supported: true, profileHandle, videos };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === SCAN_MESSAGE) {
    sendResponse(scan());
  }
});
