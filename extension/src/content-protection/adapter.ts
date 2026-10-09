/** The ContentProtectionAdapter -- the surface the side panel's automated capture run drives.
 * extractCurrentMatch() is injected from content/rights-manager.ts's existing Content Protection
 * parser rather than reimplemented, so automation and the manual "Capture this match" button
 * always produce the same record.
 *
 * Only two things in this module click anything, each gated by a whitelist on top of the
 * forbidden-action blacklist, never just one of them: advanceToNextMatch() clicks only a control
 * named exactly "Next" / "Next match", and showMatchingFootage() clicks only a "View matching
 * segment ..." chip, which just seeks the match's video player. */
import type { CapturedMatch, CollectMatchResult } from "../lib/rights-manager-scraped";
import { matchIdFromUrl } from "../lib/rights-manager-parse";
import type { AdvanceResult, ContentProtectionAdapter, MatchFingerprint, ShowFootageResult } from "./types";
import { detectContentProtectionPage } from "./detector";
import { inspectPage } from "./inspector";
import { buildPageModel, isExcludedRegion } from "./page-model";
import { discoverNavigation, pickNextControl } from "./navigation";
import { cleanText, isElementVisible, waitForCondition, waitForStableDOM, WaitTimeoutError } from "./dom";
import { accessibleName, isForbiddenControl, looksLikeMatchedContentUrl, PROTECTION_DETAILS_PATH, sanitizeUrl } from "./selectors";

export interface ContentProtectionAdapterDeps {
  extractCurrentMatch: () => CollectMatchResult;
}

/** The only names advanceToNextMatch() will click. Confirmed live: the match panel's button is
 * role="button" aria-label="Next". */
const NEXT_NAME_WHITELIST = /^(next|next match)$/i;

/** The only names showMatchingFootage() will click. Confirmed live: each "Matching segments" chip is
 * role="button" aria-label="View matching segment 00:11 - 00:31, 20s". Groups: start, end. */
const SEGMENT_NAME_WHITELIST = /^view matching segment (\d{1,2}(?::\d{2}){1,2})\s*[-–—]\s*(\d{1,2}(?::\d{2}){1,2})/i;

function clockToSeconds(clock: string): number {
  return clock.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

/** The match's own video -- the infringer's footage in the left match panel. Reference thumbnails
 * are images, so the first visible <video> outside Facebook's chrome is it. */
function matchVideo(): HTMLVideoElement | null {
  return [...document.querySelectorAll("video")].find((v) => !isExcludedRegion(v) && isElementVisible(v)) ?? null;
}

/** Clicks the first matching-segment chip, waits until the video is inside that segment, then makes
 * sure it's PLAYING there for the screenshot.
 *
 * Playing, not paused (changed after the first live screenshots, 2026-10-09): Facebook's player
 * keeps its own thumbnail and ▶ button drawn over the video until playback actually starts, and
 * draws the ▶ again over a paused video -- a saved screenshot came back showing exactly that. So the
 * video is started (muted only if it already is, never unmuted) and given a moment to actually move
 * before the screenshot. If Chrome refuses playback (a synthetic click isn't a user gesture), the
 * paused frame is still inside the segment and the result says playing: false.
 *
 * "Inside the segment" is the chip's own start-end range: a looser "near the start" check passed
 * in testing on a video that had merely played up toward the segment from 0:00 without seeking.
 * If the click hasn't put the player there within a few seconds, the video is seeked directly as
 * a fallback -- it only changes the playback position, which is all a viewer could do anyway. */
async function showMatchingFootage(): Promise<ShowFootageResult> {
  const chip = [...document.querySelectorAll<HTMLElement>('[role="button"][aria-label]')].find(
    (el) => SEGMENT_NAME_WHITELIST.test(cleanText(el.getAttribute("aria-label"))) && !isExcludedRegion(el) && isElementVisible(el)
  );
  if (!chip) return { ok: false, error: "No matching-segment button on this page." };
  const label = cleanText(chip.getAttribute("aria-label"));
  if (isForbiddenControl(`${label} ${cleanText(chip.textContent)}`, chip)) {
    return { ok: false, error: `Refused to click "${label}" — it isn't just a segment button.` };
  }
  const video = matchVideo();
  if (!video) return { ok: false, error: "Couldn't find the match's video." };

  const [, startClock, endClock] = SEGMENT_NAME_WHITELIST.exec(label)!;
  const segmentStart = clockToSeconds(startClock);
  const segmentEnd = clockToSeconds(endClock);
  const showingSegment = () =>
    video.readyState >= 2 && !video.seeking && video.currentTime >= segmentStart - 0.5 && video.currentTime <= segmentEnd + 1 ? true : null;

  activate(chip);
  try {
    await waitForCondition("the matching footage after clicking the segment", showingSegment, { timeoutMs: 5_000 });
  } catch (err) {
    if (!(err instanceof WaitTimeoutError)) return { ok: false, error: errorMessage(err) };
    // Fallback: seek the player straight to just inside the segment.
    video.currentTime = Math.min(segmentStart + 0.5, segmentEnd);
    try {
      await waitForCondition("the matching footage", showingSegment, { timeoutMs: 8_000 });
    } catch (err2) {
      return { ok: false, error: err2 instanceof WaitTimeoutError ? "The matching footage didn't load in time." : errorMessage(err2) };
    }
  }
  // Make sure it's playing, so Facebook drops its thumbnail/▶ overlay. Muted videos may always
  // play; an unmuted one may be refused without a real user gesture -- left paused, never unmuted
  // or muted on the user's behalf.
  if (video.paused) await video.play().catch(() => undefined);
  const startedAt = video.currentTime;
  let playing = false;
  try {
    await waitForCondition("the video to start playing", () => (!video.paused && video.currentTime > startedAt + 0.3 ? true : null), {
      timeoutMs: 4_000,
    });
    playing = true;
  } catch {
    playing = false; // refused or stalled -- the frame is still inside the segment
  }
  // A beat for Facebook's player to fade its overlay out once playback has visibly started.
  await new Promise((resolve) => setTimeout(resolve, playing ? 700 : 300));
  return { ok: true, segment: label.replace(/^view matching segment\s*/i, ""), at: Math.round(video.currentTime * 10) / 10, playing };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Cheap -- doesn't build a full PageModel, since waits call this on every mutation. */
function currentFingerprint(): MatchFingerprint {
  let infringingUrl: string | null = null;
  // Document-wide minus Facebook's chrome: confirmed live, "See post" sits in the left match panel
  // (a role="navigation" landmark), not in role="main".
  const anchors = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].filter((a) => !isExcludedRegion(a));
  const seePost = anchors.find((a) => cleanText(a.textContent) === "See post");
  const candidate =
    seePost ??
    anchors.find((a) => {
      const href = sanitizeUrl(a.href);
      return looksLikeMatchedContentUrl(href) && !href?.includes(PROTECTION_DETAILS_PATH) && !/^View .+'s profile$/.test(a.getAttribute("aria-label") ?? "");
    });
  if (candidate) infringingUrl = sanitizeUrl(candidate.href);
  return { url: location.href, matchId: matchIdFromUrl(location.href), infringingUrl };
}

/** What the open match's details currently say -- post link (or the "Non-public reel" label),
 * matching segments, reference assets, follower count. Meta's URL can change a beat before the
 * new match's content renders; waiting for this to change too is what keeps a capture from pairing
 * the new match's ID with the previous match's details. `complete` = enough has rendered to
 * capture from. */
function contentSignature(): { signature: string; complete: boolean } {
  const { infringingUrl } = currentFingerprint();
  const nonPublic = [...document.querySelectorAll("span")].some(
    (s) => /^non-public (reel|video|post)s?$/i.test(cleanText(s.textContent)) && !isExcludedRegion(s)
  );
  const segments = [...document.querySelectorAll('[aria-label^="View matching segment"]')].map((el) => el.getAttribute("aria-label"));
  const references = [...document.querySelectorAll<HTMLAnchorElement>(`a[href*="${PROTECTION_DETAILS_PATH}"]`)].map((a) => {
    try {
      return new URL(a.href).searchParams.get("asset_id");
    } catch {
      return null;
    }
  });
  const followers = [...document.querySelectorAll("span")].map((s) => cleanText(s.textContent)).find((t) => /^[\d.,]+\s*[KMB]?\s+followers?$/i.test(t)) ?? null;
  // Once a takedown goes through the post link can be gone -- the notice stands in for it.
  const takedownText = [...document.querySelectorAll<HTMLElement>('[role="main"], [role="navigation"]')]
    .filter((el) => !isExcludedRegion(el))
    .map((el) => el.innerText.toLowerCase())
    .join("\n");
  const takedown = takedownText.includes("your takedown request was approved") ? "approved" : takedownText.includes("you requested a takedown") ? "requested" : null;
  return {
    signature: JSON.stringify({ infringingUrl, nonPublic, takedown, segments, references, followers }),
    complete: (infringingUrl !== null || nonPublic || takedown !== null) && (segments.length > 0 || references.length > 0),
  };
}

function toFingerprint(previous: MatchFingerprint | CapturedMatch): MatchFingerprint {
  if ("metaMatchId" in previous) return { url: "", matchId: previous.metaMatchId, infringingUrl: sanitizeUrl(previous.infringingUrl) };
  return previous;
}

/** A different match is showing: the URL's match_id changed, or (when neither side has one) the
 * matched-content link did. A bare URL change with the same match_id doesn't count. */
function isDifferentMatch(previous: MatchFingerprint, current: MatchFingerprint): boolean {
  if (previous.matchId && current.matchId) return previous.matchId !== current.matchId;
  if (previous.infringingUrl && current.infringingUrl) return previous.infringingUrl !== current.infringingUrl;
  return false;
}

/** A real user-style click: some of Meta's buttons react to pointer/mouse down/up rather than just
 * `click`. Exactly one `click` is dispatched, so nothing fires twice. */
function activate(el: HTMLElement): void {
  const rect = el.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, composed: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, button: 0 };
  el.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerType: "mouse", isPrimary: true }));
  el.dispatchEvent(new MouseEvent("mousedown", init));
  el.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerType: "mouse", isPrimary: true }));
  el.dispatchEvent(new MouseEvent("mouseup", init));
  el.click();
}

/** Waits for a different match ID in the URL, then for that match's details to finish rendering
 * (and, when `signatureBefore` is given, to differ from what was showing before), then for the DOM
 * to settle. */
async function waitForNextMatch(before: MatchFingerprint, signatureBefore: string | null, timeoutMs: number): Promise<MatchFingerprint> {
  await waitForCondition(
    "the next match's URL",
    () => {
      const now = currentFingerprint();
      return isDifferentMatch(before, now) ? now : null;
    },
    { timeoutMs }
  );
  await waitForCondition(
    "the next match's details to load",
    () => {
      const sig = contentSignature();
      return sig.complete && sig.signature !== signatureBefore ? sig : null;
    },
    { timeoutMs }
  );
  await waitForStableDOM({ quietMs: 600, timeoutMs: 5000 });
  return currentFingerprint();
}

export function createContentProtectionAdapter(deps: ContentProtectionAdapterDeps): ContentProtectionAdapter {
  return {
    detect: () => detectContentProtectionPage().recognized,
    inspect: () => inspectPage(deps),
    extractCurrentMatch: () => deps.extractCurrentMatch(),
    findNextControl: () => pickNextControl(buildPageModel().controls),
    fingerprint: currentFingerprint,
    waitForMatchChange: (previous, options = {}) => waitForNextMatch(toFingerprint(previous), null, options.timeoutMs ?? 15_000),
    showMatchingFootage,

    async advanceToNextMatch(): Promise<AdvanceResult> {
      const model = buildPageModel();
      const navigation = discoverNavigation(model.controls);
      const next = pickNextControl(model.controls, navigation);
      if (!next) {
        if (navigation.next.some((c) => c.blockedReason === "disabled")) {
          return {
            ok: false,
            reason: "last_match",
            error: "Next is greyed out — this is the last match. (If you opened this match from a direct link rather than the Content Protection list, Meta disables Next.)",
          };
        }
        return { ok: false, reason: "no_next_control", error: "Couldn't find the Next button on this page." };
      }

      // Belt and braces, re-checked on the live element right before clicking.
      const name = accessibleName(next);
      if (!NEXT_NAME_WHITELIST.test(name) || isForbiddenControl(`${name} ${cleanText(next.textContent)} ${next.getAttribute("title") ?? ""}`, next)) {
        return { ok: false, reason: "unsafe_control", error: `Refused to click "${name}" — it isn't exactly a Next button.` };
      }

      const before = currentFingerprint();
      const signatureBefore = contentSignature().signature;
      activate(next as HTMLElement);
      try {
        return { ok: true, fingerprint: await waitForNextMatch(before, signatureBefore, 20_000) };
      } catch (err) {
        return {
          ok: false,
          reason: err instanceof WaitTimeoutError ? "timeout" : "error",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
