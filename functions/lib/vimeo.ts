import { truncateWords } from "../../shared/format";
import { centralDateString } from "../../shared/dates";
import { UpstreamError, ValidationError } from "./http";

interface VimeoApiErrorBody {
  error?: string;
}

/** Wraps every api.vimeo.com call so token/config failures come back as a clear UpstreamError
 * instead of a generic 500 — distinguishing "temporary Vimeo failure" from "we're broken". */
async function vimeoApiFetch(url: string, token: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        authorization: `bearer ${token}`,
        accept: "application/vnd.vimeo.*+json;version=3.4",
      },
    });
  } catch {
    throw new UpstreamError("Couldn't reach the Vimeo API. Try again shortly.");
  }
  if (res.ok) return res.json();

  const body = (await res.json().catch(() => null)) as VimeoApiErrorBody | null;
  if (res.status === 401) throw new UpstreamError("Vimeo access token is invalid or expired.");
  if (res.status === 403) throw new UpstreamError("Vimeo API request was forbidden — check the token's scope (Public is required).");
  if (res.status === 404) throw new ValidationError("Vimeo user not found.", { channelUrl: "not_found" });
  throw new UpstreamError(body?.error || `Vimeo API request failed (${res.status}).`);
}

export interface ResolvedVimeoUser {
  userId: string;
  title: string;
}

/** Resolves a vimeo.com/<username> (or a bare username) profile URL to a stable numeric user ID.
 * Vimeo's own user resource is keyed by that ID, not the vanity name, which can change. */
export async function resolveVimeoUser(input: string, token: string): Promise<ResolvedVimeoUser> {
  const trimmed = input.trim();
  let username: string;
  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 0) throw new ValidationError("Couldn't parse a username from that Vimeo URL.", { channelUrl: "unresolvable" });
    username = segments[0];
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    // Not a URL at all — treat the whole input as a bare username.
    username = trimmed.replace(/^\/+/, "");
  }
  if (!username) throw new ValidationError("Couldn't parse a username from that Vimeo URL.", { channelUrl: "unresolvable" });

  const data = await vimeoApiFetch(`https://api.vimeo.com/users/${encodeURIComponent(username)}`, token);
  if (!data?.uri) throw new ValidationError("Could not resolve this URL to a Vimeo user.", { channelUrl: "not_found" });
  const userId = String(data.uri).replace(/^\/users\//, "");
  return { userId, title: data.name ?? username };
}

export interface VimeoVideoRef {
  videoId: string;
  createdTime: string;
}

interface RawVimeoVideo {
  uri: string;
  name?: string;
  description?: string;
  release_time?: string;
  created_time?: string;
  duration?: number;
  stats?: { plays?: number | null };
  pictures?: { sizes?: { link?: string }[] };
  privacy?: { view?: string };
  user?: { uri?: string };
}

export interface MappedVimeoVideo {
  videoId: string;
  videoUrl: string;
  title: string;
  caption: string;
  publicationDate: string;
  viewCount: number | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
}

function mapVimeoVideo(raw: RawVimeoVideo): MappedVimeoVideo | null {
  const videoId = raw.uri?.replace(/^\/videos\//, "");
  if (!videoId) return null;
  // release_time reflects the creator-set "release" date shown on Vimeo; created_time is when the
  // file was uploaded. Prefer release_time (matches what's publicly displayed), falling back to
  // created_time for the rare video that lacks one.
  const publicationDate = raw.release_time || raw.created_time;
  if (!publicationDate) return null;
  const thumbnails = raw.pictures?.sizes ?? [];
  const thumbnailUrl = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].link ?? null : null;

  return {
    videoId,
    videoUrl: `https://vimeo.com/${videoId}`,
    title: raw.name ?? "",
    caption: truncateWords(raw.name ?? raw.description ?? ""),
    publicationDate,
    // Only populated if the video owner has "Show number of plays" enabled in their Vimeo privacy
    // settings — Vimeo omits the field entirely otherwise, not a lookup failure on our end.
    viewCount: typeof raw.stats?.plays === "number" ? raw.stats.plays : null,
    thumbnailUrl,
    durationSeconds: typeof raw.duration === "number" ? raw.duration : null,
  };
}

/** Paginates a user's videos (newest first) and stops as soon as a page is entirely older than
 * startDate — everything after it is guaranteed older too, matching fetchUploadsPlaylistItems's
 * early-exit approach for YouTube. */
export async function fetchUserVideos(userId: string, token: string, startDate: string | null): Promise<MappedVimeoVideo[]> {
  const results: MappedVimeoVideo[] = [];
  let page = 1;
  const perPage = 50;

  for (;;) {
    const url = new URL(`https://api.vimeo.com/users/${encodeURIComponent(userId)}/videos`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("sort", "date");
    url.searchParams.set("direction", "desc");
    url.searchParams.set(
      "fields",
      "uri,name,description,release_time,created_time,duration,stats.plays,pictures.sizes.link,privacy.view,user.uri"
    );

    const data = await vimeoApiFetch(url.toString(), token);
    const items = (data?.data ?? []) as RawVimeoVideo[];
    if (items.length === 0) break;

    let hitOlder = false;
    for (const raw of items) {
      const mapped = mapVimeoVideo(raw);
      if (!mapped) continue;
      if (startDate && centralDateString(mapped.publicationDate) < startDate) {
        hitOlder = true;
        continue;
      }
      results.push(mapped);
    }
    if (hitOlder) break;

    const hasNext = Boolean(data?.paging?.next);
    if (!hasNext) break;
    page += 1;
  }

  return results;
}
