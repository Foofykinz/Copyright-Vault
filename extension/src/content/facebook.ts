import type { ScanResult, ScrapedVideo } from "../lib/scraped";
import { SCAN_MESSAGE } from "../lib/scraped";
import { truncateWords } from "../../../shared/format";

interface FacebookStory {
  post_id?: string;
  creation_time?: number;
  attached_story?: unknown;
  attachments?: unknown[];
  comet_sections?: {
    content?: {
      story?: {
        comet_sections?: {
          message?: {
            story?: {
              message?: { text?: string };
            };
          };
        };
      };
    };
  };
}

const NETWORK_MESSAGE_SOURCE = "viral-drm-facebook";
const capturedStories = new Map<string, FacebookStory>();

/**
 * Facebook wraps a video's real data differently depending on presentation (Reel vs. regular
 * /videos/ post vs. Live), and sometimes duplicates the same Video node at multiple paths within
 * one story (confirmed by live capture: it showed up at both styles.attachment.media and
 * styles.style_infos[].containing_story...). Rather than assume one fixed path — which is exactly
 * what silently dropped non-Reel videos before — this walks the whole subtree looking for any
 * node that's actually a Video, and returns the node itself so callers can pull whichever fields
 * they need off it (permalink_url, id, ...).
 */
function findVideoNode(node: unknown, depth = 0): Record<string, unknown> | null {
  if (!node || typeof node !== "object" || depth > 8) return null;
  const obj = node as Record<string, unknown>;
  if (obj.__typename === "Video") return obj;
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const found = findVideoNode(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function findStoryVideoNode(story: FacebookStory): Record<string, unknown> | null {
  for (const attachment of story.attachments ?? []) {
    const found = findVideoNode(attachment);
    if (found) return found;
  }
  return null;
}

/** Prefers the real permalink; falls back to Facebook's universal watch URL from the video ID,
 * since permalink_url isn't always present but id consistently is. */
function videoUrlFromNode(video: Record<string, unknown>): string | null {
  if (typeof video.permalink_url === "string" && video.permalink_url) return video.permalink_url;
  if (typeof video.id === "string" && video.id) return `https://www.facebook.com/watch/?v=${video.id}`;
  if (typeof video.id === "number") return `https://www.facebook.com/watch/?v=${video.id}`;
  return null;
}

function storyRichness(story: FacebookStory): number {
  try {
    return JSON.stringify(story).length;
  } catch {
    return 0;
  }
}

/** Facebook can capture the same post_id more than once (different queries, different detail
 * levels) — keep whichever version actually has a usable video, and among ties keep the richer one,
 * rather than letting a later thinner capture silently overwrite a usable earlier one. */
function mergeStory(existing: FacebookStory | undefined, incoming: FacebookStory): FacebookStory {
  if (!existing) return incoming;
  const existingVideo = findStoryVideoNode(existing);
  const incomingVideo = findStoryVideoNode(incoming);
  if (incomingVideo && !existingVideo) return incoming;
  if (existingVideo && !incomingVideo) return existing;
  return storyRichness(incoming) > storyRichness(existing) ? incoming : existing;
}

// Relayed here by content/facebook-network.ts, which runs in the page's MAIN world so it can
// intercept the actual GraphQL responses Facebook's own JavaScript uses to render the feed.
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as { source?: string; stories?: unknown } | undefined;
  if (data?.source !== NETWORK_MESSAGE_SOURCE || !Array.isArray(data.stories)) return;
  for (const story of data.stories as FacebookStory[]) {
    if (!story?.post_id) continue;
    capturedStories.set(story.post_id, mergeStory(capturedStories.get(story.post_id), story));
  }
});

function extractCaption(story: FacebookStory): string {
  const text = story.comet_sections?.content?.story?.comet_sections?.message?.story?.message?.text;
  return typeof text === "string" ? text : "";
}

function scan(): ScanResult {
  const videos: ScrapedVideo[] = [];
  const exclusionCounts = { share: 0, missingIds: 0, noVideoFound: 0, noUrlOrId: 0 };

  for (const story of capturedStories.values()) {
    // attached_story is populated when this Story is a share/repost of someone else's post —
    // skip those so only original videos posted directly by the profile are included.
    if (story.attached_story) {
      exclusionCounts.share += 1;
      continue;
    }
    if (!story.post_id || story.creation_time === undefined) {
      exclusionCounts.missingIds += 1;
      continue;
    }

    const videoNode = findStoryVideoNode(story);
    if (!videoNode) {
      exclusionCounts.noVideoFound += 1;
      continue;
    }

    const videoUrl = videoUrlFromNode(videoNode);
    if (!videoUrl) {
      exclusionCounts.noUrlOrId += 1;
      console.warn("[ViralDRM] Facebook video found but no permalink or ID available:", story.post_id, story);
      continue;
    }

    videos.push({
      key: `facebook:${story.post_id}`,
      videoUrl,
      publicationDate: new Date(story.creation_time * 1000).toISOString(),
      caption: truncateWords(extractCaption(story)),
      // Facebook's feed query doesn't carry view counts publicly — stays manual, same as X.
      viewCount: null,
    });
  }

  return { supported: true, profileHandle: null, videos, totalCandidates: capturedStories.size, exclusionCounts };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === SCAN_MESSAGE) {
    sendResponse(scan());
  }
});
