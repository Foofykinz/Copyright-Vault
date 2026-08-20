import {
  COLLECT_CURRENT_MATCH_MESSAGE,
  RIGHTS_MANAGER_MATCHES_SOURCE,
  type CapturedMatch,
  type CapturedReferenceFile,
  type CollectMatchResult,
  type RawCopyrightMatch,
} from "../lib/rights-manager-scraped";

if (location.pathname.includes("/rights_manager/")) {
  // Accumulates every match the page has loaded (the copyright_matches response can arrive more
  // than once — e.g. the list paginating as you scroll it — so this merges rather than replaces,
  // same posture as facebook.ts's capturedStories). Indexed under three different candidate id
  // fields, since it's not yet confirmed which one (if any) the page-displayed "Match ID" actually
  // corresponds to — enrichment tries all three rather than assuming one.
  const capturedMatchesById = new Map<string, RawCopyrightMatch>();
  const capturedMatchesByVideoId = new Map<string, RawCopyrightMatch>();
  const capturedMatchesByCopyrightId = new Map<string, RawCopyrightMatch>();

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data as { source?: string; matches?: unknown } | undefined;
    if (!data || data.source !== RIGHTS_MANAGER_MATCHES_SOURCE || !Array.isArray(data.matches)) return;

    for (const match of data.matches as RawCopyrightMatch[]) {
      if (match?.active_match_data_id) capturedMatchesById.set(match.active_match_data_id, match);
      const videoId = match?.matched_video_asset?.video_id;
      if (videoId) capturedMatchesByVideoId.set(videoId, match);
      const copyrightId = match?.match_data?.[0]?.video_copyright_id;
      if (copyrightId) capturedMatchesByCopyrightId.set(copyrightId, match);
    }
  });

  // Zero-width space / ZWNJ / ZWJ / BOM — by char code rather than embedding the literal
  // characters in source, where they're invisible and easy to corrupt on a later edit. Facebook's
  // markup uses these as spacing hacks in various places, which would otherwise break an
  // exact-match comparison against a plain label string.
  const INVISIBLE_CHAR_CODES = [0x200b, 0x200c, 0x200d, 0xfeff];

  function cleanText(text: string | null | undefined): string {
    let result = text ?? "";
    for (const code of INVISIBLE_CHAR_CODES) {
      result = result.split(String.fromCharCode(code)).join("");
    }
    return result.trim();
  }

  /** Reads a labeled value the same way the original standalone tool did: find a
   * `div[role="heading"]` whose text is exactly the label, then read the nearby span holding its
   * value. This is what Rights Manager's own UI renders for match detail rows (Match ID, Video ID,
   * Match duration, Video views, Page followers) — plain accessible text, not a hashed CSS class,
   * so unlike the rest of the original tool's DOM scraping this part held up. */
  function readLabeledValue(label: string): string | null {
    for (const heading of document.querySelectorAll<HTMLElement>('div[role="heading"]')) {
      if (cleanText(heading.textContent) !== label) continue;
      const valueEl =
        heading.parentElement?.nextElementSibling?.querySelector("span") ??
        heading.parentElement?.parentElement?.querySelector("span");
      const value = cleanText(valueEl?.textContent);
      if (value) return value;
    }
    return null;
  }

  /** "Posted <date>" or "Published on <date>" — whichever label this particular match view uses. */
  function readPostedAtText(): string | null {
    for (const span of document.querySelectorAll<HTMLElement>("span")) {
      const text = cleanText(span.textContent);
      if (text.startsWith("Posted ")) return text.slice("Posted ".length).trim();
      if (text.startsWith("Published on ")) return text.slice("Published on ".length).trim();
    }
    return null;
  }

  function readInfringingLink(): string | null {
    return document.querySelector<HTMLAnchorElement>('a[target="_blank"][href]')?.href ?? null;
  }

  /** Facebook wraps outbound links (confirmed live: an Instagram permalink surfaced on a
   * cross-posted match came back this way) in its own l.facebook.com/l.php?u=<encoded-url>&h=...
   * redirector rather than the real destination. Unwraps to the real URL when the link is shaped
   * like that; returns the input unchanged for anything else, so a normal facebook.com/watch or
   * instagram.com permalink passes straight through. Applied to every infringingUrl this file
   * produces, not just the DOM-scraped one — no confirmation yet that the network-captured
   * permalink_url is never wrapped the same way. */
  function unwrapFacebookRedirect(url: string): string {
    try {
      const parsed = new URL(url);
      if (!parsed.hostname.endsWith("facebook.com") || parsed.pathname !== "/l.php") return url;
      return parsed.searchParams.get("u") || url;
    } catch {
      return url;
    }
  }

  /** "16" / "16,723" / "1.2K" → a plain integer, or null if it can't be parsed. Best-effort only —
   * this is the fallback path for when network-captured data isn't available. */
  function parseCount(text: string | null): number | null {
    if (!text) return null;
    const cleaned = text.replace(/,/g, "").trim();
    const kMatch = /^([\d.]+)\s*[kK]$/.exec(cleaned);
    if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
    const num = Number(cleaned);
    return Number.isFinite(num) ? Math.round(num) : null;
  }

  /** "16s" / "0:16" / "1:30" → seconds, or null if it can't be parsed. */
  function parseDurationSeconds(text: string | null): number | null {
    if (!text) return null;
    const secondsMatch = /^([\d.]+)\s*s$/i.exec(text.trim());
    if (secondsMatch) return parseFloat(secondsMatch[1]);
    const clockMatch = /^(\d+):(\d{2})$/.exec(text.trim());
    if (clockMatch) return Number(clockMatch[1]) * 60 + Number(clockMatch[2]);
    return null;
  }

  function mapPlatform(raw: string | undefined): "facebook" | "instagram" {
    return raw === "IG" ? "instagram" : "facebook";
  }

  /** DOM-only fallback has no platform field to read (that only exists on the network-captured
   * asset) — previously hardcoded to "facebook" unconditionally, which was wrong for a
   * cross-posted Instagram video (confirmed live: the unwrapped link pointed at instagram.com).
   * Now that unwrapFacebookRedirect gives us the real destination, detect from its host instead. */
  function detectPlatformFromUrl(url: string): "facebook" | "instagram" {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, "");
      return hostname === "instagram.com" ? "instagram" : "facebook";
    } catch {
      return "facebook";
    }
  }

  function mapReferenceFiles(raw: RawCopyrightMatch): CapturedReferenceFile[] {
    const files: CapturedReferenceFile[] = [];
    for (const entry of raw.match_data ?? []) {
      const asset = entry.reference_asset;
      if (asset?.id && asset.title) files.push({ id: asset.id, title: asset.title });
    }
    return files;
  }

  /** Rich path: a network-captured record was found for this match id. */
  function mapMatchFromNetwork(displayMatchId: string, raw: RawCopyrightMatch): CollectMatchResult {
    const asset = raw.matched_video_asset;
    if (!asset) return { ok: false, error: "Match data is missing video details — try again after the page finishes loading." };

    const rawInfringingUrl = asset.permalink_url || (asset.video_id ? `https://www.facebook.com/watch/?v=${asset.video_id}` : null) || readInfringingLink();
    if (!rawInfringingUrl) return { ok: false, error: "Couldn't determine a link for the infringing video." };
    const infringingUrl = unwrapFacebookRedirect(rawInfringingUrl);

    const postedAt = asset.published_time !== undefined ? new Date(asset.published_time * 1000).toISOString() : parseDomDate();
    if (!postedAt) return { ok: false, error: "Couldn't determine a posted date for this match." };

    const match: CapturedMatch = {
      metaMatchId: displayMatchId,
      metaVideoId: asset.video_id ?? null,
      // Private accounts: Meta withholds owner identity by design (confirmed via live capture) —
      // these are the ones your team typically releases rather than logs, so this is expected, not
      // a scraping failure. Left editable in the review card either way.
      infringerName: asset.owner_name || (asset.is_private ? "Private account" : "Unknown"),
      infringingUrl,
      platform: mapPlatform(asset.platform),
      postedAt,
      notes: asset.description ?? "",
      matchDurationSec: raw.match_data?.[0]?.total_match_duration ?? parseDurationSeconds(readLabeledValue("Match duration")),
      videoViewCount: asset.view_count ?? parseCount(readLabeledValue("Video views")),
      pageFollowerCount: asset.followers_count ?? parseCount(readLabeledValue("Page followers")),
      isAccountPrivate: asset.is_private ?? null,
      infringerProfileUrl: asset.owner_url ?? null,
      referenceFiles: mapReferenceFiles(raw),
      videoAvailable: null,
    };
    return { ok: true, match };
  }

  function parseDomDate(): string | null {
    const text = readPostedAtText();
    if (!text) return null;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  /** Fallback path: no network-captured record matched this match id (e.g. the copyright_matches
   * response hasn't loaded for it yet). Builds a leaner record straight from the same labeled DOM
   * fields the original standalone tool read — everything it could get is still better than
   * failing outright, and infringerName is left editable in the review card either way. */
  function mapMatchFromDomOnly(matchId: string): CollectMatchResult {
    const rawInfringingUrl = readInfringingLink();
    if (!rawInfringingUrl) return { ok: false, error: "Couldn't find a link for the infringing video on this page." };
    const infringingUrl = unwrapFacebookRedirect(rawInfringingUrl);

    const postedAt = parseDomDate();
    if (!postedAt) return { ok: false, error: "Couldn't find/parse a posted date on this page." };

    const match: CapturedMatch = {
      metaMatchId: matchId,
      metaVideoId: readLabeledValue("Video ID"),
      infringerName: "Unknown",
      infringingUrl,
      platform: detectPlatformFromUrl(infringingUrl),
      postedAt,
      notes: "",
      matchDurationSec: parseDurationSeconds(readLabeledValue("Match duration")),
      videoViewCount: parseCount(readLabeledValue("Video views")),
      pageFollowerCount: parseCount(readLabeledValue("Page followers")),
      isAccountPrivate: null,
      infringerProfileUrl: null,
      referenceFiles: [],
      videoAvailable: null,
    };
    return { ok: true, match };
  }

  function collectCurrentMatch(): CollectMatchResult {
    const matchId = readLabeledValue("Match ID");
    if (!matchId) {
      return { ok: false, error: "Couldn't find a \"Match ID\" label on this page — make sure a match is open." };
    }

    const raw = capturedMatchesById.get(matchId) ?? capturedMatchesByVideoId.get(matchId) ?? capturedMatchesByCopyrightId.get(matchId);
    if (!raw) {
      // Falling back to the weaker DOM-only path (no infringer name/views/followers/reference
      // files, platform guessed from the link). Whether the page-displayed "Match ID" actually
      // corresponds to any of the three candidate id fields on the network-captured records is
      // still unconfirmed (see the map declarations above) -- this is the evidence needed to
      // settle it next time it happens. Open DevTools' console on business.facebook.com to see it.
      console.warn(
        "[viral-drm] Rights Manager match capture: no network-captured record matched the page's Match ID.",
        {
          displayedMatchId: matchId,
          knownActiveMatchDataIds: [...capturedMatchesById.keys()],
          knownVideoIds: [...capturedMatchesByVideoId.keys()],
          knownVideoCopyrightIds: [...capturedMatchesByCopyrightId.keys()],
        }
      );
    }
    return raw ? mapMatchFromNetwork(matchId, raw) : mapMatchFromDomOnly(matchId);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === COLLECT_CURRENT_MATCH_MESSAGE) {
      sendResponse(collectCurrentMatch());
    }
  });
}
