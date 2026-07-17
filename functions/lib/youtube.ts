import { truncateWords } from "../../shared/format";
import type { YouTubeCategory, YouTubeLiveStatus } from "../../shared/types";
import { UpstreamError, ValidationError } from "./http";

const YOUTUBE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

interface GoogleApiErrorBody {
  error?: { message?: string; errors?: { reason?: string }[] };
}

/** Wraps every googleapis.com call so quota/key/config failures come back as a clear UpstreamError
 * instead of a generic 500 — distinguishing "temporary YouTube failure" from "we're broken". */
async function youtubeApiFetch(url: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new UpstreamError("Couldn't reach the YouTube API. Try again shortly.");
  }
  if (res.ok) return res.json();

  const body = (await res.json().catch(() => null)) as GoogleApiErrorBody | null;
  const reason = body?.error?.errors?.[0]?.reason;
  if (reason === "quotaExceeded") throw new UpstreamError("YouTube API quota exceeded for today.");
  if (reason === "accessNotConfigured") {
    throw new UpstreamError("YouTube Data API v3 is not enabled for this Google Cloud project.");
  }
  if (reason === "keyInvalid" || res.status === 400) throw new UpstreamError("YouTube API key is invalid or malformed.");
  if (res.status === 403) throw new UpstreamError("YouTube API request was forbidden — check the API key's restrictions.");
  throw new UpstreamError(body?.error?.message || `YouTube API request failed (${res.status}).`);
}

function channelsUrl(params: Record<string, string>, apiKey: string): string {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "snippet,contentDetails");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", apiKey);
  return url.toString();
}

type ParsedChannelUrl =
  | { kind: "id"; value: string }
  | { kind: "handle"; value: string }
  | { kind: "user"; value: string }
  | { kind: "custom"; value: string }
  | { kind: "raw"; value: string };

function parseChannelUrlForm(input: string): ParsedChannelUrl {
  const trimmed = input.trim();
  if (/^@[\w.-]+$/.test(trimmed)) return { kind: "handle", value: trimmed };
  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] === "channel" && segments[1]) return { kind: "id", value: segments[1] };
    if (segments[0]?.startsWith("@")) return { kind: "handle", value: segments[0] };
    if (segments[0] === "user" && segments[1]) return { kind: "user", value: segments[1] };
    if (segments[0] === "c" && segments[1]) return { kind: "custom", value: segments[1] };
    if (segments[0]) return { kind: "custom", value: segments[0] };
  } catch {
    // not a URL — fall through
  }
  return { kind: "raw", value: trimmed };
}

/** Fallback for /c/<customName> URLs, which no official API parameter resolves — every YouTube
 * page (regardless of which URL form was requested) carries a canonical link back to the stable
 * /channel/<id> form, confirmed via a live fetch during Phase 1 investigation. */
async function resolveChannelIdViaPageFetch(input: string): Promise<string> {
  const target = input.startsWith("http") ? input : `https://www.youtube.com/${input.replace(/^\/+/, "")}`;
  let res: Response;
  try {
    res = await fetch(target, { headers: { "user-agent": YOUTUBE_USER_AGENT } });
  } catch {
    throw new ValidationError("Couldn't reach that channel URL.", { channelUrl: "unresolvable" });
  }
  if (!res.ok) throw new ValidationError("Couldn't resolve that channel URL.", { channelUrl: "unresolvable" });
  const html = await res.text();
  const match = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/([A-Za-z0-9_-]{10,})"/.exec(html);
  if (!match) throw new ValidationError("Couldn't resolve that channel URL to a channel ID.", { channelUrl: "unresolvable" });
  return match[1];
}

/**
 * The single normalization path for a YouTube handle. `snippet.customUrl` isn't guaranteed to
 * carry a leading "@" (older API responses/edge cases return it bare), so every handle — whether
 * freshly resolved or read back from a cached DB value — passes through here before being stored,
 * returned, displayed, or used to build a URL. Never assume the source already has the "@".
 */
export function normalizeYoutubeHandle(customUrl: string | null | undefined): string | null {
  if (!customUrl) return null;
  const trimmed = customUrl.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

/** Only ever builds a channel URL from an already-normalized handle; falls back to the always-valid
 * /channel/<id> form when no usable handle is available. */
export function channelUrlForHandle(channelId: string, handle: string | null | undefined): string {
  const normalized = normalizeYoutubeHandle(handle);
  return normalized ? `https://www.youtube.com/${normalized}` : `https://www.youtube.com/channel/${channelId}`;
}

export interface ResolvedChannel {
  channelId: string;
  title: string;
  handle: string | null;
  uploadsPlaylistId: string;
}

function channelFromApiItem(item: any): ResolvedChannel {
  const uploadsPlaylistId = item?.contentDetails?.relatedPlaylists?.uploads;
  if (!item?.id || !uploadsPlaylistId) {
    throw new ValidationError("Channel has no accessible uploads playlist.", { channelUrl: "no_uploads" });
  }
  return {
    channelId: item.id,
    title: item.snippet?.title ?? "",
    handle: normalizeYoutubeHandle(typeof item.snippet?.customUrl === "string" ? item.snippet.customUrl : null),
    uploadsPlaylistId,
  };
}

/** Resolves any of youtube.com/@handle, /channel/<id>, /user/<legacyName>, /c/<customName>, or a
 * bare @handle to a stable channelId + uploads playlist, preferring the official channels.list API
 * and falling back to a page fetch only for /c/ URLs (or if the primary lookup comes back empty). */
export async function resolveChannel(input: string, apiKey: string): Promise<ResolvedChannel> {
  const form = parseChannelUrlForm(input);

  if (form.kind === "id") {
    const data = await youtubeApiFetch(channelsUrl({ id: form.value }, apiKey));
    const item = data?.items?.[0];
    if (item) return channelFromApiItem(item);
  } else if (form.kind === "handle") {
    const data = await youtubeApiFetch(channelsUrl({ forHandle: form.value }, apiKey));
    const item = data?.items?.[0];
    if (item) return channelFromApiItem(item);
  } else if (form.kind === "user") {
    const data = await youtubeApiFetch(channelsUrl({ forUsername: form.value }, apiKey));
    const item = data?.items?.[0];
    if (item) return channelFromApiItem(item);
  }

  // /c/<customName>, a bare handle/id lookup that came back empty, or an unrecognized form — the
  // official API has no "resolve a custom URL" parameter (search.list is the only one, and that's
  // explicitly avoided here), so fall back to reading the channel ID off the page itself.
  const channelId = await resolveChannelIdViaPageFetch(input);
  const data = await youtubeApiFetch(channelsUrl({ id: channelId }, apiKey));
  const item = data?.items?.[0];
  if (!item) throw new ValidationError("Could not resolve this URL to a YouTube channel.", { channelUrl: "not_found" });
  return channelFromApiItem(item);
}

interface PlaylistItemRef {
  videoId: string;
  publishedAt: string;
}

/** Paginates the uploads playlist (newest first) and stops as soon as an item is definitively
 * older than startDate — everything after it is guaranteed older too, so pagination can end there
 * rather than walking the channel's entire history. */
export async function fetchUploadsPlaylistItems(
  playlistId: string,
  apiKey: string,
  startDate: string | null
): Promise<PlaylistItemRef[]> {
  const results: PlaylistItemRef[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    url.searchParams.set("part", "contentDetails");
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    url.searchParams.set("key", apiKey);

    const data = await youtubeApiFetch(url.toString());
    const items = (data.items ?? []) as { contentDetails?: { videoId?: string; videoPublishedAt?: string } }[];

    let hitOlder = false;
    for (const item of items) {
      const videoId = item.contentDetails?.videoId;
      const publishedAt = item.contentDetails?.videoPublishedAt;
      if (!videoId || !publishedAt) continue;
      if (startDate && publishedAt.slice(0, 10) < startDate) {
        hitOlder = true;
        continue;
      }
      results.push({ videoId, publishedAt });
    }
    if (hitOlder) break;
    pageToken = data.nextPageToken;
  } while (pageToken);

  return results;
}

/** Batches videos.list over up to 50 IDs at a time, per the API's limit. */
export async function fetchVideoDetails(ids: string[], apiKey: string): Promise<any[]> {
  const results: any[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet,statistics,contentDetails,status,liveStreamingDetails");
    url.searchParams.set("id", batch.join(","));
    url.searchParams.set("key", apiKey);
    const data = await youtubeApiFetch(url.toString());
    results.push(...(data.items ?? []));
  }
  return results;
}

/** Finds the JSON value immediately following `marker` in `html` by balancing braces (respecting
 * string literals/escapes), rather than a regex that could terminate early or late if the embedded
 * JSON itself happens to contain a string matching a naive end-of-blob pattern. */
function extractJsonAfterMarker(html: string, marker: string): unknown | null {
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  const start = idx + marker.length;
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;

  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) return null;
  try {
    return JSON.parse(html.slice(start, end));
  } catch {
    return null;
  }
}

function extractVideoIdFromShortsLockup(lockup: Record<string, unknown>): string | null {
  try {
    const onTap = lockup.onTap as Record<string, any> | undefined;
    const videoId = onTap?.innertubeCommand?.reelWatchEndpoint?.videoId;
    if (typeof videoId === "string") return videoId;
  } catch {
    // fall through to the entityId-based fallback below
  }
  const entityId = lockup.entityId;
  if (typeof entityId === "string") {
    const match = /([A-Za-z0-9_-]{11})$/.exec(entityId);
    if (match) return match[1];
  }
  return null;
}

export interface ConfirmedShorts {
  ids: Set<string>;
  /** True if the page carried a continuation token, meaning the channel has more Shorts beyond
   * the ones actually fetched here (this only reads the first page — see Phase 1/2 notes on why
   * continuation pagination isn't implemented yet). */
  hasMore: boolean;
}

/**
 * Server-side (unofficial) lookup of which video IDs the channel's own Shorts tab currently lists.
 * Confirmed via a live fetch during Phase 1: YouTube's Shorts tab embeds a `shortsLockupViewModel`
 * node per Short inside the page's `ytInitialData` blob (the current shape — an older
 * `reelItemRenderer` shape some references describe returned zero matches when actually tested).
 * This only reads the first page (~48-50 most recent Shorts); older Shorts aren't confirmable this
 * way, which is why `hasMore` and the caller's coverage check exist.
 */
export async function fetchConfirmedShortsIds(channelId: string): Promise<ConfirmedShorts> {
  let res: Response;
  try {
    res = await fetch(`https://www.youtube.com/channel/${channelId}/shorts?hl=en`, {
      headers: { "user-agent": YOUTUBE_USER_AGENT },
    });
  } catch {
    throw new Error("Couldn't reach the Shorts page.");
  }
  if (!res.ok) throw new Error(`Shorts page fetch failed (${res.status}).`);

  const html = await res.text();
  const data = extractJsonAfterMarker(html, "var ytInitialData = ");
  if (!data) throw new Error("Couldn't find ytInitialData on the Shorts page.");

  const ids = new Set<string>();
  let hasMore = false;

  function walk(node: unknown, depth: number): void {
    if (!node || typeof node !== "object" || depth > 20) return;
    const obj = node as Record<string, unknown>;

    const lockup = obj.shortsLockupViewModel as Record<string, unknown> | undefined;
    if (lockup) {
      const videoId = extractVideoIdFromShortsLockup(lockup);
      if (videoId) ids.add(videoId);
    }
    if (obj.continuationItemRenderer) hasMore = true;

    for (const value of Object.values(obj)) {
      if (Array.isArray(value)) {
        for (const item of value) walk(item, depth + 1);
      } else if (value && typeof value === "object") {
        walk(value, depth + 1);
      }
    }
  }
  walk(data, 0);

  return { ids, hasMore };
}

function parseIsoDuration(iso: string | undefined): number | null {
  if (!iso) return null;
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!match) return null;
  const [, d, h, m, s] = match;
  return Number(d || 0) * 86400 + Number(h || 0) * 3600 + Number(m || 0) * 60 + Number(s || 0);
}

export interface ClassifiedVideo {
  category: YouTubeCategory;
  liveStatus?: YouTubeLiveStatus;
}

/** Live signal first (upcoming/live/completed-replay), then confirmed-Shorts-ID membership, else a
 * regular upload — matching the required precedence exactly. Never looks at the title. */
export function classifyVideo(raw: any, confirmedShortIds: Set<string>): ClassifiedVideo {
  const broadcastContent = raw.snippet?.liveBroadcastContent;
  if (broadcastContent === "live") return { category: "live", liveStatus: "live" };
  if (broadcastContent === "upcoming") return { category: "live", liveStatus: "upcoming" };
  if (raw.liveStreamingDetails) return { category: "live", liveStatus: "completed" };
  if (confirmedShortIds.has(raw.id)) return { category: "short" };
  return { category: "upload" };
}

export interface MappedYouTubeVideo {
  videoId: string;
  videoUrl: string;
  title: string;
  caption: string;
  publicationDate: string;
  viewCount: number | null;
  thumbnailUrl: string | null;
  channelTitle: string;
  channelId: string;
  channelUrl: string;
  durationSeconds: number | null;
  category: YouTubeCategory;
  liveStatus?: YouTubeLiveStatus;
  scheduledStartTime?: string;
  actualStartTime?: string;
  actualEndTime?: string;
  concurrentViewers?: number;
}

export function mapYouTubeVideo(
  raw: any,
  classified: ClassifiedVideo,
  channelTitle: string,
  channelHandle: string | null
): MappedYouTubeVideo {
  const videoId = raw.id as string;
  const videoUrl =
    classified.category === "short" ? `https://www.youtube.com/shorts/${videoId}` : `https://www.youtube.com/watch?v=${videoId}`;
  const thumbnails = raw.snippet?.thumbnails ?? {};
  const thumbnailUrl: string | null = thumbnails.high?.url ?? thumbnails.medium?.url ?? thumbnails.default?.url ?? null;
  const channelUrl = channelUrlForHandle(raw.snippet.channelId, channelHandle);

  return {
    videoId,
    videoUrl,
    title: raw.snippet?.title ?? "",
    caption: truncateWords(raw.snippet?.description ?? ""),
    publicationDate: raw.snippet.publishedAt,
    viewCount: raw.statistics?.viewCount !== undefined ? Number(raw.statistics.viewCount) : null,
    thumbnailUrl,
    channelTitle,
    channelId: raw.snippet.channelId,
    channelUrl,
    durationSeconds: parseIsoDuration(raw.contentDetails?.duration),
    category: classified.category,
    liveStatus: classified.liveStatus,
    scheduledStartTime: raw.liveStreamingDetails?.scheduledStartTime,
    actualStartTime: raw.liveStreamingDetails?.actualStartTime,
    actualEndTime: raw.liveStreamingDetails?.actualEndTime,
    concurrentViewers:
      raw.liveStreamingDetails?.concurrentViewers !== undefined ? Number(raw.liveStreamingDetails.concurrentViewers) : undefined,
  };
}
