import {
  COLLECT_CURRENT_MATCH_MESSAGE,
  DETECT_RIGHTS_MANAGER_PAGE_MESSAGE,
  isRightsManagerHost,
  RIGHTS_MANAGER_MATCHES_SOURCE,
  type CapturedMatch,
  type CapturedReferenceFile,
  type CollectMatchOptions,
  type CollectMatchResult,
  type DetectRightsManagerPageResult,
  type RawCopyrightMatch,
  type RightsManagerPageKind,
} from "../lib/rights-manager-scraped";
import { matchIdFromUrl, parseDetectedDate, segmentRangeSeconds, stripReferenceStats } from "../lib/rights-manager-parse";
import { registerContentProtectionInspector } from "../content-protection";

// Broadened from a "/rights_manager/" path check on business.facebook.com alone to any
// isRightsManagerHost() (manifest.json's content_scripts match patterns cover the same hosts, so
// this doesn't reach any further than injection already does) -- Meta's newer Content Protection
// interface doesn't have a confirmed URL pattern to gate on, so page-kind detection below is
// content-based instead. This is cheap and passive (a message listener + some DOM read helpers)
// until something actually asks it to act, so it's safe to have present on every page on these
// hosts, not just match-review ones.
if (isRightsManagerHost(location.hostname)) {
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

  function isLegacyRightsManagerPage(): boolean {
    return location.pathname.includes("/rights_manager/");
  }

  /** Confirmed live URL prefix for Meta's newer Content Protection interface (on web.facebook.com,
   * reached from a Page's Professional Dashboard) -- covers both the overview/list page and an
   * individual match's detail page, which share this same path. */
  const CONTENT_PROTECTION_PATH = "/professional_dashboard/content/content_protection";

  /** Meta's newer Content Protection interface — confirmed live on the "Severe Studios" account,
   * replacing classic Rights Manager for it (WX Chasing is still on the classic interface; this is
   * per-account, not a platform-wide cutover as of this writing).
   *
   * An earlier version detected this by guessed heading text ("Content protection" + "Match
   * details" as exact heading-role element text) — that never actually matched live, which is why
   * this silently failed to activate at all once someone opened a real match (only the
   * overview/list page and a screenshot were ever seen; the header markup itself was never
   * confirmed from real DOM). Replaced with something grounded only in what's actually confirmed:
   * the live URL prefix, plus the "See post" link that IS confirmed present on an individual
   * match's page (from Karam's real DOM sample) and should NOT be present on the overview/list
   * page, which just lists matches rather than showing one's full detail card. */
  function isContentProtectionMatchPage(): boolean {
    // A non-public reel match has no "See post" link at all -- it was only ever "recognized" before
    // because findSeePostLink() wrongly matched Facebook's top-nav Reels tab. Its "Non-public reel"
    // label is the equivalent signal. Same for a takedown notice -- once a takedown goes through the
    // post link may be gone, but the page is still a match.
    if (!location.pathname.includes(CONTENT_PROTECTION_PATH)) return false;
    return findSeePostLink() !== null || isNonPublicMatch() || readTakedownStatus() !== null;
  }

  /** The two takedown notices Meta shows on a match (wording from the team, not yet seen in a DOM
   * sample). Matched as case-insensitive phrases inside the page text rather than exact element
   * text, since the notice may sit in a sentence with more after it. Only the match itself is read
   * -- role="main" plus the match panel -- never Facebook's notifications or top bar, where a
   * "takedown approved" notification about a *different* match could otherwise show up. */
  function readTakedownStatus(): "requested" | "approved" | null {
    const text = [...document.querySelectorAll<HTMLElement>('[role="main"], [role="navigation"]')]
      .filter((el) => !el.closest(FACEBOOK_CHROME_SELECTOR) && !el.closest('[aria-label="Notifications" i]'))
      .map((el) => el.innerText)
      .join("\n")
      .toLowerCase();
    if (text.includes("your takedown request was approved")) return "approved";
    if (text.includes("you requested a takedown")) return "requested";
    return null;
  }

  /** "Monetized" -- seen live (a screenshot of a News5 match) as its own label beside "See post" in
   * the match panel. Exact element text, outside Facebook's own chrome. True or null: a match
   * without the label isn't recorded as a confirmed "not monetized". */
  function readMonetized(): boolean | null {
    for (const el of document.querySelectorAll<HTMLElement>("span, div")) {
      if (el.children.length === 0 && cleanText(el.textContent) === "Monetized" && !el.closest(FACEBOOK_CHROME_SELECTOR)) return true;
    }
    return null;
  }

  function detectPageKind(): RightsManagerPageKind | null {
    if (isContentProtectionMatchPage()) return "content_protection";
    if (isLegacyRightsManagerPage()) return "legacy";
    return null;
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

  // ---- Content Protection ("Content protection" -> "Match details") ----
  // Unlike legacy Rights Manager, this interface exposes the infringing post and the account
  // profile as plain <a> elements with stable aria-labels/visible text (confirmed from real DOM,
  // not guessed) -- no network interception needed here, at least not yet.

  function stripFbclid(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.searchParams.delete("fbclid");
      return parsed.toString();
    } catch {
      return url;
    }
  }

  /** "See post" is the literal, exact visible text of the infringing-post link in every confirmed
   * sample so far. Deliberately not scoped to any container -- Content Protection's page shell
   * hasn't been captured, only this card, so a broad document-wide search is the safest bet. */
  /** Matches the confirmed real shapes of an infringing-post URL: instagram.com/reel/ or /p/,
   * facebook.com's own /reel/ and /<page>/videos/ patterns, and fb.watch's short links. Used as a
   * fallback below when "See post" isn't found by its exact English text -- Facebook's UI is
   * per-account localizable, so anyone whose interface isn't in English would never match that
   * text at all, even though the underlying page is otherwise identical. Matching by destination
   * shape instead of visible text is language-independent. */
  function looksLikeInfringingPostUrl(href: string): boolean {
    try {
      const { hostname, pathname } = new URL(href);
      const host = hostname.replace(/^www\.|^web\./, "");
      // An id segment is required after reel/p/videos -- confirmed live, Facebook's own top-nav Reels
      // tab is a bare "facebook.com/reel/?s=tab", which this used to accept as the infringing post
      // whenever a match had no "See post" link (every non-public reel).
      if (host === "instagram.com") return /^\/(reel|p)\/[^/]+/.test(pathname);
      if (host === "facebook.com") return /\/(reel|videos)\/[^/]+/.test(pathname);
      if (host === "fb.watch") return true;
      return false;
    } catch {
      return false;
    }
  }

  /** Facebook's own top bar / top nav (confirmed live labels) -- never part of a match. */
  const FACEBOOK_CHROME_SELECTOR = '[role="banner"], [role="navigation"][aria-label="Facebook" i]';

  /** "Non-public reel" -- confirmed live, shown where the account name would be on a match against
   * a non-public reel, which has no "See post" link at all. */
  function isNonPublicMatch(): boolean {
    for (const span of document.querySelectorAll<HTMLElement>("span")) {
      if (/^non-public (reel|video|post)s?$/i.test(cleanText(span.textContent)) && !span.closest(FACEBOOK_CHROME_SELECTOR)) return true;
    }
    return false;
  }

  function findSeePostLink(): HTMLAnchorElement | null {
    const links = [...document.querySelectorAll<HTMLAnchorElement>("a")];
    const byText = links.find((a) => cleanText(a.textContent) === "See post");
    if (byText) return byText;
    // Fallback for a non-English Facebook UI, where "See post" renders as different text entirely
    // -- same underlying page, just not matchable by English text. Excludes profile links (aria-
    // labeled "View X's profile") and reference-asset links (protection_details) since those can
    // also point at instagram.com/facebook.com URLs that would otherwise false-positive here.
    return (
      links.find((a) => {
        if (a.closest(FACEBOOK_CHROME_SELECTOR)) return false;
        const label = a.getAttribute("aria-label") ?? "";
        if (label.startsWith("View ") && label.endsWith("'s profile")) return false;
        if (a.href.includes("/content_protection/protection_details/")) return false;
        return looksLikeInfringingPostUrl(a.href);
      }) ?? null
    );
  }

  /** Confirmed DOM has two copies of this link: one wrapping just the avatar (no visible text,
   * href wrapped through l.facebook.com/l.php), one wrapping the visible account name (direct
   * instagram.com/facebook.com href). Prefers the one with text, and among candidates prefers a
   * direct (non-wrapped) href -- falls back to whatever's available either way. */
  function findProfileLink(): HTMLAnchorElement | null {
    const candidates = [...document.querySelectorAll<HTMLAnchorElement>('a[role="link"]')].filter((a) => {
      const label = a.getAttribute("aria-label") ?? "";
      return label.startsWith("View ") && label.endsWith("'s profile");
    });
    const withText = candidates.filter((a) => cleanText(a.textContent).length > 0);
    const pool = withText.length > 0 ? withText : candidates;
    return pool.find((a) => !a.href.includes("l.facebook.com/l.php")) ?? pool[0] ?? null;
  }

  /** Matches a plain "18,496 followers" / "9,986,455 views" text node — confirmed DOM shape for
   * both. `unit` is "followers" or "views"; both singular and plural are accepted for robustness
   * even though only the plural form has been seen live. */
  function findLabeledCount(unit: "followers" | "views"): number | null {
    const re = new RegExp(`^([\\d,.]+)\\s+${unit}?s?$`, "i");
    for (const el of document.querySelectorAll<HTMLElement>("span")) {
      const match = re.exec(cleanText(el.textContent));
      if (match) return parseCount(match[1]);
    }
    return null;
  }

  /** Confirmed live DOM for the "More details" panel's simple label/value rows (Match ID
   * specifically -- Video ID and Date detected are a reasonable bet, being the same kind of
   * simple text value, not confirmed independently): a label <span> inside one <div>, immediately
   * followed by a sibling <div> whose own <span> holds the value --
   * `<div><span>Match ID</span></div><div><span>2268962413853082</span></div>`. Nothing like
   * legacy Rights Manager's div[role="heading"] pattern, which is exactly why readLabeledValue()
   * never found anything here. Matched by exact span text + immediate sibling structure, not by
   * either div's generated class name (those are unstable, per the DOM samples seen so far --
   * "Match ID"'s wrapper class doesn't even match "Attributes"'s wrapper class on the same page). */
  function readMoreDetailsValue(label: string): string | null {
    for (const span of document.querySelectorAll<HTMLElement>("span")) {
      if (cleanText(span.textContent) !== label) continue;
      const valueWrapper = span.parentElement?.nextElementSibling;
      const value = cleanText(valueWrapper?.querySelector("span")?.textContent ?? valueWrapper?.textContent);
      if (value) return value;
    }
    return null;
  }

  /** Confirmed live DOM for a reference-asset card's text: the same "two sibling divs, each
   * wrapping one span" row shape readMoreDetailsValue() already relies on for Match ID — the first
   * holds the title (one level deeper, in a nested inner span, presumably for Meta's own
   * ellipsis/truncation styling; textContent still returns the full underlying text regardless of
   * how it's visually truncated on screen), the second holds a "<duration>s, <percent>% of the
   * protected content" line that must NOT end up in the title. Not scoped to the "xu06os2" wrapper
   * class directly (unstable/generated) -- instead finds the first descendant div whose only child
   * is a single <span>, which is what that row's wrapper (and nothing else in the card — the
   * thumbnail's wrapper holds an <svg>, the percentage badge holds a span AND an svg) actually is.
   * Falls back to the anchor's full text with the known trailing pattern stripped off if that
   * structural search ever comes up empty. */
  function readReferenceFileTitle(link: HTMLAnchorElement): string {
    const singleSpanDivs = [...link.querySelectorAll<HTMLElement>("div")].filter((div) => {
      const children = [...div.children];
      return children.length === 1 && children[0].tagName === "SPAN";
    });
    const primary = singleSpanDivs.length > 0 ? cleanText(singleSpanDivs[0].textContent) : "";
    if (primary) return primary;

    const rawTitle = cleanText(link.textContent);
    return stripReferenceStats(rawTitle) || rawTitle;
  }

  /** "Your protected content" reference asset(s) — confirmed DOM: each is a link to
   * /content_protection/protection_details/?asset_id=<id>, which conveniently hands over the id
   * directly rather than needing to scrape it from somewhere else. A match can carry more than one
   * reference asset, so every matching link is collected, deduped by id in case the same asset is
   * linked more than once in the card. */
  function findReferenceFiles(): CapturedReferenceFile[] {
    const seen = new Set<string>();
    const files: CapturedReferenceFile[] = [];
    for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href*="/content_protection/protection_details/"]')) {
      let id: string | null;
      try {
        id = new URL(a.href, location.origin).searchParams.get("asset_id");
      } catch {
        id = null;
      }
      if (!id || seen.has(id)) continue;
      const title = readReferenceFileTitle(a);
      if (!title) continue;
      seen.add(id);
      files.push({ id, title });
    }
    return files;
  }

  /** Match ID. Meta's newer Content Protection layout dropped the "More details" panel that used to
   * display it (and Video ID, and Date detected), so the URL's `?match_id=` is the primary source
   * now -- it can't move around with a layout change or depend on the UI language. The old panel
   * is kept as a fallback for any account still shown the previous layout. */
  function readMatchId(): string | null {
    return matchIdFromUrl(location.href) ?? readMoreDetailsValue("Match ID");
  }

  /** ISO timestamp for when Meta detected this match. Two layouts to cover: the older "More
   * details" panel's "Date detected" row (full date), and the newer layout's "Detected Sep 25" line
   * under each reference asset (no year -- see parseDetectedDate). A match can list several
   * reference assets, each with its own "Detected ..." line; the earliest is the one closest to
   * when the match itself first appeared.
   *
   * Used as postedAt since there's no other date on this page -- but it's a materially different
   * thing (when Meta found the match, not when the infringing content was posted). Flagged here so
   * it isn't mistaken for a scraping bug later. */
  function readDetectedAtIso(): string | null {
    const legacyText = readMoreDetailsValue("Date detected");
    if (legacyText) {
      const legacy = new Date(legacyText);
      if (!Number.isNaN(legacy.getTime())) return legacy.toISOString();
    }

    const found: Date[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("span, div")) {
      const text = cleanText(el.textContent);
      // Cheap pre-filter before the regex -- this walks every span/div on a large page.
      if (text.length > 40 || !text.startsWith("Detected ")) continue;
      const parsed = parseDetectedDate(text);
      if (parsed) found.push(parsed);
    }
    if (found.length === 0) return null;
    return new Date(Math.min(...found.map((d) => d.getTime()))).toISOString();
  }

  /** Total matched length in seconds, from the "Matching segments" chips ("00:21 - 02:39", one per
   * segment; a match can have several). Found by an element's whole text being exactly a start-end
   * range rather than by any class/structure, then de-duplicated so a wrapper that just repeats its
   * child's text isn't counted twice. Null if none are found -- left blank rather than guessed. */
  function readMatchDurationSec(): number | null {
    const matching: HTMLElement[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("span, div")) {
      const text = cleanText(el.textContent);
      if (text.length <= 20 && segmentRangeSeconds(text) !== null) matching.push(el);
    }
    const innermost = matching.filter((el) => !matching.some((other) => other !== el && el.contains(other)));
    const total = innermost.reduce((sum, el) => sum + (segmentRangeSeconds(cleanText(el.textContent)) ?? 0), 0);
    return total > 0 ? total : null;
  }

  /** Fallback for the account name/profile link when no `aria-label="View X's profile"` link exists
   * (that's what findProfileLink() needs, and it's only ever been confirmed on the older layout).
   * Anchored on the one thing the newer layout definitely shows, a "114 followers" line, and takes
   * the text immediately before it in reading order -- the account name renders directly above it.
   * Text-order based rather than structure based, since no DOM sample of this layout's account row
   * exists. The review card's name field stays editable either way. */
  function findAccountNearFollowers(): { name: string; profileUrl: string | null } | null {
    const followersRe = /^[\d,.]+[kKmM]?\s+followers?$/i;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let followersNode: Node | null = null;
    while (walker.nextNode()) {
      if (followersRe.test(cleanText(walker.currentNode.textContent))) {
        followersNode = walker.currentNode;
        break;
      }
    }
    if (!followersNode) return null;

    walker.currentNode = followersNode;
    while (walker.previousNode()) {
      const text = cleanText(walker.currentNode.textContent);
      if (!text) continue;
      const parent = walker.currentNode.parentElement;
      if (parent && ["SCRIPT", "STYLE"].includes(parent.tagName)) continue;
      if (text.length > 100) return null; // not a name -- don't guess
      const href = parent?.closest("a[href]")?.getAttribute("href");
      let profileUrl: string | null = null;
      try {
        profileUrl = href ? stripFbclid(unwrapFacebookRedirect(new URL(href, location.origin).href)) : null;
      } catch {
        // unparseable href -- keep the name, drop the link
      }
      return { name: text, profileUrl };
    }
    return null;
  }

  function mapMatchFromContentProtection(options: CollectMatchOptions = {}): CollectMatchResult {
    const seePost = findSeePostLink();
    const takedownStatus = readTakedownStatus();
    // Non-public reels aren't logged at all (decided 2026-10-02) -- there's no post to link to.
    // Reported as a skip, not a failure. Only when Meta's own "Non-public reel" label is present, so
    // a layout change that hides "See post" still fails loudly instead of silently skipping.
    if (!seePost?.href && isNonPublicMatch()) {
      return {
        ok: false,
        skipped: "non_public",
        matchId: readMatchId(),
        error: "Non-public reel — skipped. These aren't logged since there's no public post.",
      };
    }
    // Data pulls only: a takedown notice explains a missing post link, so the match data is still
    // worth recording -- with an empty link, never a guessed one.
    const linkOptional = options.allowMissingPostLink === true && takedownStatus !== null;
    if (!seePost?.href && !linkOptional) return { ok: false, error: 'Couldn\'t find a "See post" link on this match.' };

    const matchId = readMatchId();
    if (!matchId) return { ok: false, error: "Couldn't find a Match ID — open a specific match's details page (its URL should contain match_id)." };

    const infringingUrl = seePost?.href ? stripFbclid(unwrapFacebookRedirect(seePost.href)) : "";

    const profileLink = findProfileLink();
    let infringerProfileUrl = profileLink?.href ? stripFbclid(unwrapFacebookRedirect(profileLink.href)) : null;
    let infringerName = profileLink ? cleanText(profileLink.textContent) : "";
    if (!infringerName) {
      const nearFollowers = findAccountNearFollowers();
      if (nearFollowers) {
        infringerName = nearFollowers.name;
        infringerProfileUrl = infringerProfileUrl ?? nearFollowers.profileUrl;
      }
    }

    // Confirmed live (a News5 match): a match with no reference-file card under "Matching segments"
    // shows no "Detected" date anywhere. Rather than refusing to capture it, the evidence record is
    // dated by capture time with a note saying so (the Copyright Archive requires a date -- team's
    // call, 2026-10-07); the real detected date stays null for Data Pulls.
    const detectedAt = readDetectedAtIso();
    const postedAt = detectedAt ?? new Date().toISOString();

    const match: CapturedMatch = {
      metaMatchId: matchId,
      // Only the older layout's "More details" panel showed a Video ID; the newer layout doesn't
      // display one anywhere, so this is null there rather than guessed from the post URL.
      metaVideoId: readMoreDetailsValue("Video ID"),
      infringerName: infringerName || "Unknown",
      infringingUrl,
      platform: detectPlatformFromUrl(infringingUrl),
      postedAt,
      notes: detectedAt ? "" : "Meta didn't show a detected date on this match; dated by when it was captured.",
      matchDurationSec: readMatchDurationSec(),
      videoViewCount: findLabeledCount("views"),
      pageFollowerCount: findLabeledCount("followers"),
      isAccountPrivate: null,
      infringerProfileUrl,
      referenceFiles: findReferenceFiles(),
      videoAvailable: null,
      takedownStatus,
      detectedAt,
      monetized: readMonetized(),
    };
    if (match.referenceFiles.length === 0) {
      // The reference-asset card's link shape was only ever confirmed on the older layout
      // (/content_protection/protection_details/?asset_id=). If the newer card links somewhere else,
      // this shows where, without needing a DOM sample to find out.
      console.warn(
        "[viral-drm] Content Protection: no reference files found. content_protection links on this page:",
        [...document.querySelectorAll<HTMLAnchorElement>('a[href*="content_protection"]')].map((a) => a.href)
      );
    }
    // Logged unconditionally (not just on a suspected problem) -- reports so far ("link isn't
    // being captured") haven't come with a description of what the bad value actually looked like,
    // so this removes the ambiguity going forward: the real captured value, visible in DevTools'
    // console, every single time.
    console.info("[viral-drm] Content Protection match captured:", match);
    return { ok: true, match };
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
      takedownStatus: null,
      detectedAt: null,
      monetized: null,
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
      takedownStatus: null,
      detectedAt: null,
      monetized: null,
    };
    return { ok: true, match };
  }

  function collectCurrentMatch(options: CollectMatchOptions = {}): CollectMatchResult {
    // Logged unconditionally, every capture, not just the failure case below -- the fastest way to
    // tell "which path produced this?" apart is a routing trace, not reasoning about it after the
    // fact. Whoever's testing can open DevTools' console on business.facebook.com and see exactly
    // what fired.
    if (isContentProtectionMatchPage()) {
      console.info("[viral-drm] Rights Manager match capture: routed to Content Protection parser.");
      return mapMatchFromContentProtection(options);
    }

    const matchId = readLabeledValue("Match ID");
    if (!matchId) {
      return { ok: false, error: "Couldn't find a \"Match ID\" label on this page — make sure a match is open." };
    }

    const raw = capturedMatchesById.get(matchId) ?? capturedMatchesByVideoId.get(matchId) ?? capturedMatchesByCopyrightId.get(matchId);
    if (raw) {
      console.info("[viral-drm] Rights Manager match capture: routed to legacy network-matched parser.", { displayedMatchId: matchId });
    } else {
      // Falling back to the weaker DOM-only path (no infringer name/views/followers/reference
      // files, platform guessed from the link) -- infringerName ends up hardcoded "Unknown" here,
      // which is very plausibly what "the name isn't populating" reports about. Whether the
      // page-displayed "Match ID" actually corresponds to any of the three candidate id fields on
      // the network-captured records is still unconfirmed (see the map declarations above) -- this
      // is the evidence needed to settle it.
      console.warn(
        "[viral-drm] Rights Manager match capture: routed to legacy DOM-only fallback -- no network-captured record matched the page's Match ID.",
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

  // Read-only "Inspect Current Match" diagnostic (side panel's developer section). Handed the
  // existing Content Protection parser so its output can be compared against the inspector's own
  // heuristics, and so a future capture loop reuses it rather than a second implementation.
  registerContentProtectionInspector({ extractCurrentMatch: () => mapMatchFromContentProtection() });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === COLLECT_CURRENT_MATCH_MESSAGE) {
      sendResponse(collectCurrentMatch({ allowMissingPostLink: message.allowMissingPostLink === true }));
    } else if (message?.type === DETECT_RIGHTS_MANAGER_PAGE_MESSAGE) {
      const kind = detectPageKind();
      const result: DetectRightsManagerPageResult = { recognized: kind !== null, kind };
      sendResponse(result);
    }
  });
}
