import { youtubeApiFetch } from "./youtube";

export interface YouTubeSearchOptions {
  query: string;
  /** RFC3339 instant — only sent when the source's publication date is known (see
   * functions/lib/hunterRun.ts). Omitted entirely otherwise, per the "if unknown, don't send
   * publishedAfter" instruction. */
  publishedAfter?: string;
  maxResults?: number;
}

export interface YouTubeSearchResultItem {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
}

/** V1 keeps each manual Hunt controlled — see the "10-25 results per query, no pagination" Phase 2
 * instruction. */
export const DEFAULT_SEARCH_MAX_RESULTS = 20;

/**
 * The only place Vault Hunter calls YouTube's discovery endpoint. Reuses youtubeApiFetch for API-key
 * handling and quota/error classification (functions/lib/youtube.ts) rather than duplicating it.
 * Public videos only (type=video) — no channels, no playlists.
 */
export async function searchYouTubeVideos(opts: YouTubeSearchOptions, apiKey: string): Promise<YouTubeSearchResultItem[]> {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("q", opts.query);
  url.searchParams.set("maxResults", String(opts.maxResults ?? DEFAULT_SEARCH_MAX_RESULTS));
  url.searchParams.set("order", "relevance");
  if (opts.publishedAfter) url.searchParams.set("publishedAfter", opts.publishedAfter);
  url.searchParams.set("key", apiKey);

  const data = await youtubeApiFetch(url.toString());
  const items = (data.items ?? []) as any[];
  const results: YouTubeSearchResultItem[] = [];
  for (const item of items) {
    const videoId = item?.id?.videoId;
    if (!videoId) continue;
    results.push({
      videoId,
      title: item.snippet?.title ?? "",
      channelId: item.snippet?.channelId ?? "",
      channelTitle: item.snippet?.channelTitle ?? "",
      publishedAt: item.snippet?.publishedAt ?? "",
    });
  }
  return results;
}
