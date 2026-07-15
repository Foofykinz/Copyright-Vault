import type { Platform, VideoMetadataResult } from "../../shared/types";

const YOUTUBE_ID_RE = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/))([\w-]{11})/;

export function detectPlatform(url: string): Platform {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "other";
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") return "youtube";
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
  if (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch") return "facebook";
  if (host === "twitter.com" || host === "x.com") return "x";
  return "other";
}

/** Truncates long freeform text to a single leading sentence, for use as a caption/title. */
function toTitleFromText(text: string, maxLength = 200): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxLength) return trimmed;
  const sentenceMatch = /^.*?[.!?](?=\s|$)/.exec(trimmed);
  if (sentenceMatch && sentenceMatch[0].length <= maxLength) return sentenceMatch[0].trim();
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

async function fetchYouTube(url: string, apiKey: string | undefined): Promise<VideoMetadataResult> {
  const match = YOUTUBE_ID_RE.exec(url);
  if (!match) return { platform: "youtube", warning: "Couldn't parse a video ID from this YouTube URL." };
  if (!apiKey) {
    return { platform: "youtube", warning: "Add a YOUTUBE_API_KEY secret to enable automatic YouTube lookups." };
  }

  const videoId = match[1];
  const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${apiKey}`;
  const res = await fetch(apiUrl);
  if (!res.ok) return { platform: "youtube", warning: "YouTube lookup failed. Enter details manually." };

  const data = (await res.json()) as {
    items?: Array<{
      snippet: { title: string; publishedAt: string; thumbnails?: Record<string, { url: string }> };
      statistics?: { viewCount?: string };
    }>;
  };
  const item = data.items?.[0];
  if (!item) return { platform: "youtube", warning: "Video not found on YouTube." };

  return {
    platform: "youtube",
    caption: item.snippet.title,
    publicationDate: item.snippet.publishedAt,
    viewCount: item.statistics?.viewCount ? Number(item.statistics.viewCount) : undefined,
    thumbnailUrl: item.snippet.thumbnails?.high?.url ?? item.snippet.thumbnails?.default?.url,
  };
}

async function fetchOEmbedTitleOnly(
  platform: Platform,
  oembedUrl: string,
  extractCaption: (data: Record<string, unknown>) => string | undefined
): Promise<VideoMetadataResult> {
  try {
    const res = await fetch(oembedUrl);
    if (!res.ok) {
      return {
        platform,
        warning: `Couldn't fetch details from ${platform}. Enter caption, view count, and date manually.`,
      };
    }
    const data = (await res.json()) as Record<string, unknown>;
    const caption = extractCaption(data);
    const thumbnailUrl = typeof data.thumbnail_url === "string" ? data.thumbnail_url : undefined;
    return {
      platform,
      caption: caption ? toTitleFromText(caption) : undefined,
      thumbnailUrl,
      warning: "View count and publish date aren't available publicly for this platform — enter them manually.",
    };
  } catch {
    return {
      platform,
      warning: `Couldn't fetch details from ${platform}. Enter caption, view count, and date manually.`,
    };
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export async function lookupVideoMetadata(url: string, env: { YOUTUBE_API_KEY?: string }): Promise<VideoMetadataResult> {
  const platform = detectPlatform(url);

  if (platform === "youtube") return fetchYouTube(url, env.YOUTUBE_API_KEY);

  if (platform === "tiktok") {
    return fetchOEmbedTitleOnly("tiktok", `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, (data) =>
      typeof data.title === "string" ? data.title : undefined
    );
  }

  if (platform === "x") {
    return fetchOEmbedTitleOnly("x", `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}`, (data) => {
      if (typeof data.html !== "string") return undefined;
      const paragraph = /<p[^>]*>([\s\S]*?)<\/p>/.exec(data.html);
      return paragraph ? stripHtml(paragraph[1]) : undefined;
    });
  }

  if (platform === "instagram") {
    // Meta's oEmbed now requires an authenticated app token for most callers; this will usually
    // fail gracefully and fall back to the warning below rather than pretend to succeed.
    return fetchOEmbedTitleOnly(
      "instagram",
      `https://api.instagram.com/oembed?url=${encodeURIComponent(url)}`,
      (data) => (typeof data.title === "string" ? data.title : undefined)
    );
  }

  return {
    platform,
    warning: "Automatic lookup isn't available for this platform yet — enter details manually.",
  };
}
