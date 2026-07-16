import type { ScanResult, ScrapedVideo } from "../lib/scraped";
import { SCAN_MESSAGE } from "../lib/scraped";
import { truncateWords } from "../../../shared/format";

interface FacebookStory {
  post_id?: string;
  creation_time?: number;
  attached_story?: unknown;
  attachments?: Array<{
    media?: { __typename?: string };
    styles?: unknown;
  }>;
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

// Relayed here by content/facebook-network.ts, which runs in the page's MAIN world so it can
// intercept the actual GraphQL responses Facebook's own JavaScript uses to render the feed.
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as { source?: string; stories?: unknown } | undefined;
  if (data?.source !== NETWORK_MESSAGE_SOURCE || !Array.isArray(data.stories)) return;
  for (const story of data.stories as FacebookStory[]) {
    if (story?.post_id) capturedStories.set(story.post_id, story);
  }
});

function extractCaption(story: FacebookStory): string {
  const text = story.comet_sections?.content?.story?.comet_sections?.message?.story?.message?.text;
  return typeof text === "string" ? text : "";
}

/**
 * Facebook wraps a video attachment's real data differently depending on presentation — the
 * captured example (a /reel/ post) nested it under styles.attachment.media, but regular /videos/
 * posts and Live videos very likely use a different renderer/wrapper shape. Rather than assume
 * one fixed path (which is what silently dropped non-Reel videos), this walks the whole styles
 * subtree looking for any node that's actually a Video with a permalink_url — the field name
 * Facebook uses consistently wherever a full Video node appears, regardless of the wrapper style.
 */
function findPermalinkInTree(node: unknown, depth = 0): string | null {
  if (!node || typeof node !== "object" || depth > 8) return null;
  const obj = node as Record<string, unknown>;
  if (obj.__typename === "Video" && typeof obj.permalink_url === "string") {
    return obj.permalink_url;
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const found = findPermalinkInTree(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function findVideoPermalink(story: FacebookStory): string | null {
  for (const attachment of story.attachments ?? []) {
    // Skip attachments explicitly typed as something else (e.g. Photo); don't require an exact
    // "Video" match up front since the outer media stub isn't always populated the same way.
    if (attachment.media?.__typename && attachment.media.__typename !== "Video") continue;
    const permalink = findPermalinkInTree(attachment.styles) ?? findPermalinkInTree(attachment.media);
    if (permalink) return permalink;
  }
  return null;
}

function scan(): ScanResult {
  const videos: ScrapedVideo[] = [];

  for (const story of capturedStories.values()) {
    // attached_story is populated when this Story is a share/repost of someone else's post —
    // skip those so only original videos posted directly by the profile are included.
    if (story.attached_story) continue;
    if (!story.post_id || story.creation_time === undefined) continue;

    const permalink = findVideoPermalink(story);
    if (!permalink) continue;

    videos.push({
      key: `facebook:${story.post_id}`,
      videoUrl: permalink,
      publicationDate: new Date(story.creation_time * 1000).toISOString(),
      caption: truncateWords(extractCaption(story)),
      // Facebook's feed query doesn't carry view counts publicly — stays manual, same as X.
      viewCount: null,
    });
  }

  return { supported: true, profileHandle: null, videos, totalCandidates: capturedStories.size };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === SCAN_MESSAGE) {
    sendResponse(scan());
  }
});
