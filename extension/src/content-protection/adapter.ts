/** The ContentProtectionAdapter -- the surface the side panel's automated capture run drives.
 * extractCurrentMatch() is injected from content/rights-manager.ts's existing Content Protection
 * parser rather than reimplemented, so automation and the manual "Capture this match" button
 * always produce the same record.
 *
 * advanceToNextMatch() is the ONLY thing in this module that clicks anything, and it only ever
 * clicks a control whose accessible name is exactly "Next" / "Next match" that also passes the
 * forbidden-action check -- a whitelist on top of the blacklist, never just one of them. */
import type { CapturedMatch, CollectMatchResult } from "../lib/rights-manager-scraped";
import { matchIdFromUrl } from "../lib/rights-manager-parse";
import type { AdvanceResult, ContentProtectionAdapter, MatchFingerprint } from "./types";
import { detectContentProtectionPage } from "./detector";
import { inspectPage } from "./inspector";
import { buildPageModel, isExcludedRegion } from "./page-model";
import { discoverNavigation, pickNextControl } from "./navigation";
import { cleanText, waitForCondition, waitForStableDOM, WaitTimeoutError } from "./dom";
import { accessibleName, isForbiddenControl, looksLikeMatchedContentUrl, PROTECTION_DETAILS_PATH, sanitizeUrl } from "./selectors";

export interface ContentProtectionAdapterDeps {
  extractCurrentMatch: () => CollectMatchResult;
}

/** The only names advanceToNextMatch() will click. Confirmed live: the match panel's button is
 * role="button" aria-label="Next". */
const NEXT_NAME_WHITELIST = /^(next|next match)$/i;

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
