import type { ScanResult, ScrapedVideo } from "../lib/scraped";
import { isDevBuild, SCAN_MESSAGE } from "../lib/scraped";
import { truncateWords } from "../../../shared/format";

/** The entity (Page or user) that posted a Story. `actors` is a well-established top-level field on
 * Facebook's GraphQL Story type in the wild, but — unlike the Video-node/caption paths elsewhere in
 * this file — it hasn't been confirmed against a live capture the way those were, so it's also
 * checked at the same nested path the caption lives at (comet_sections.content.story.actors) in
 * case this query variant puts it there instead. If neither path has it, ownership can't be
 * established for that story. To re-verify the real path, temporarily log the raw story object
 * inside the window.addEventListener("message", ...) handler below, then adjust findActors(). */
interface FacebookActor {
  id?: string | number;
  url?: string;
  name?: string;
}

interface FacebookStory {
  post_id?: string;
  creation_time?: number;
  attached_story?: unknown;
  attachments?: unknown[];
  actors?: FacebookActor[];
  comet_sections?: {
    content?: {
      story?: {
        actors?: FacebookActor[];
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
let lastProfileHandle: string | null = null;

// Authenticates messages from content/facebook-network.ts (MAIN world) — see the comment at the
// top of that file for what this does and doesn't protect against.
const sessionNonce = crypto.randomUUID();
window.postMessage({ source: NETWORK_MESSAGE_SOURCE, type: "handshake", nonce: sessionNonce }, "*");

function resetForNewProfile(): void {
  capturedStories.clear();
}

// Reserved top-level paths that share the same single-segment URL shape as a profile/Page
// (facebook.com/<name>/) but aren't one — without this, currentProfileHandle() would misidentify
// them as a profile to scope captures to.
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

function findActors(story: FacebookStory): FacebookActor[] | null {
  if (Array.isArray(story.actors) && story.actors.length > 0) return story.actors;
  const nested = story.comet_sections?.content?.story?.actors;
  if (Array.isArray(nested) && nested.length > 0) return nested;
  return null;
}

/** Deliberately does NOT compare actor.name against the URL handle — a Page's display name has no
 * reliable relationship to its vanity URL (e.g. "Reed Timmer" vs. "reedtimmerwx"), so that would be
 * guessing, not verifying. Only a numeric ID match or the actor's own permalink resolving to the
 * same handle count as a real match. */
function actorMatchesProfile(actor: FacebookActor, profileHandle: string): boolean {
  if (actor.id !== undefined && String(actor.id).toLowerCase() === profileHandle) return true;
  if (typeof actor.url === "string") {
    try {
      const url = new URL(actor.url, location.origin);
      if (url.pathname === "/profile.php") {
        const id = url.searchParams.get("id");
        if (id && id.toLowerCase() === profileHandle) return true;
      } else {
        const seg = /^\/([A-Za-z0-9_.\-]{1,80})\/?/.exec(url.pathname)?.[1]?.toLowerCase();
        if (seg && seg === profileHandle) return true;
      }
    } catch {
      // malformed actor URL — no match
    }
  }
  return false;
}

/** If ownership can't be established (no actors found at either known path), the story is excluded
 * rather than assumed to belong to whatever profile is currently open. */
function isAuthoredByProfile(story: FacebookStory, profileHandle: string): boolean {
  const actors = findActors(story);
  if (!actors) return false;
  return actors.some((actor) => actorMatchesProfile(actor, profileHandle));
}

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
  const data = event.data as { source?: string; stories?: unknown; nonce?: string } | undefined;
  if (data?.source !== NETWORK_MESSAGE_SOURCE || !Array.isArray(data.stories)) return;
  if (data.nonce !== sessionNonce) return; // not tagged with our own session nonce — reject

  const profileHandle = currentProfileHandle();
  // Facebook is a heavy SPA — browsing from one client's Page to another's (or through the home
  // feed in between) doesn't reload this content script, so without this a session could mix
  // Stories from several different profiles/Pages together.
  if (profileHandle !== lastProfileHandle) {
    resetForNewProfile();
    lastProfileHandle = profileHandle;
  }
  // Not on a recognized profile/Page route — refuse to accumulate anything. The network script
  // still watches every /api/graphql/ response (query IDs rotate too often to target one path
  // reliably), so this per-story ownership check is the actual enforcement point.
  if (!profileHandle) return;

  for (const story of data.stories as FacebookStory[]) {
    if (!story?.post_id) continue;
    if (!isAuthoredByProfile(story, profileHandle)) continue; // can't verify ownership — exclude
    capturedStories.set(story.post_id, mergeStory(capturedStories.get(story.post_id), story));
  }
});

function extractCaption(story: FacebookStory): string {
  const text = story.comet_sections?.content?.story?.comet_sections?.message?.story?.message?.text;
  return typeof text === "string" ? text : "";
}

function scan(): ScanResult {
  const profileHandle = currentProfileHandle();
  if (profileHandle !== lastProfileHandle) {
    resetForNewProfile();
    lastProfileHandle = profileHandle;
  }

  const videos: ScrapedVideo[] = [];
  const exclusionCounts = { share: 0, missingIds: 0, noVideoFound: 0, noUrlOrId: 0, notAuthor: 0 };

  if (!profileHandle) {
    return { supported: true, profileHandle: null, videos, totalCandidates: capturedStories.size, exclusionCounts };
  }

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
    // Re-verified here, not just trusted from capture time (capture already checked this, but a
    // final pass guards against anything that slipped in some other way).
    if (!isAuthoredByProfile(story, profileHandle)) {
      exclusionCounts.notAuthor += 1;
      if (isDevBuild()) console.warn("[ViralDRM] Facebook story excluded — author/page mismatch:", story.post_id, findActors(story));
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

  return { supported: true, profileHandle, videos, totalCandidates: capturedStories.size, exclusionCounts };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === SCAN_MESSAGE) {
    sendResponse(scan());
  }
});
