import type { ScanResult, ScrapedVideo } from "../lib/scraped";
import { SCAN_MESSAGE } from "../lib/scraped";
import { truncateWords } from "../../../shared/format";

interface FacebookStory {
  post_id?: string;
  creation_time?: number;
  attached_story?: unknown;
  attachments?: Array<{
    media?: { __typename?: string };
    styles?: {
      attachment?: {
        media?: {
          __typename?: string;
          permalink_url?: string;
          first_frame_thumbnail?: string;
        };
      };
    };
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

function findVideoPermalink(story: FacebookStory): string | null {
  for (const attachment of story.attachments ?? []) {
    if (attachment.media?.__typename !== "Video") continue;
    const permalink = attachment.styles?.attachment?.media?.permalink_url;
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

  return { supported: true, profileHandle: null, videos };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === SCAN_MESSAGE) {
    sendResponse(scan());
  }
});
