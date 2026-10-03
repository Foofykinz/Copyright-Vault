/** Finds controls that look like match-to-match navigation (next / previous / back to matches /
 * close / open matched content), ranks them, and rules out anything forbidden. Never clicks.
 * findNextControl() is the only thing a future capture loop will need from here, and it can only
 * ever return a candidate marked usable -- visible, enabled, and not matching any
 * FORBIDDEN_ACTION_PATTERNS entry. */
import { NAVIGATION_KINDS, type NavigationDiscovery, type NavigationKind } from "./types";
import type { ControlRecord } from "./page-model";
import { isElementVisible, truncate } from "./dom";
import { looksLikeMatchedContentUrl, looksLikeProfileLabel, PROTECTION_DETAILS_PATH } from "./selectors";

interface Rule {
  /** Exact (whole-name) match -- strongest signal. */
  exact: RegExp;
  /** Name merely contains it. */
  partial: RegExp;
}

// Bare arrows (← →) are left out of next/previous on purpose: Meta uses ← as a "back" icon too.
const RULES: Record<Exclude<NavigationKind, "openMatchedContent">, Rule> = {
  next: {
    exact: /^(next|next match|go to next( match)?|show next( match)?|›|»|chevron right)$/i,
    partial: /\bnext\b/i,
  },
  previous: {
    exact: /^(previous|prev|previous match|go to previous( match)?|show previous( match)?|‹|«|chevron left)$/i,
    partial: /\b(previous|prev)\b/i,
  },
  backToMatches: {
    exact: /^(back|go back|back to matches|all matches|matches|back to content protection|content protection)$/i,
    partial: /\b(back to|all matches|return to)\b|\bmatches\b/i,
  },
  close: {
    exact: /^(close|close dialog|close match|×|✕|x)$/i,
    partial: /\bclose\b/i,
  },
};

const OPEN_CONTENT_RE = /^(see post|view post|view content|view video|open post|open video|watch video|view on (facebook|instagram)|open in new tab)$/i;
const OPEN_CONTENT_PARTIAL_RE = /\b(see|view|open|watch)\s+(post|video|reel|content)\b/i;

function scoreFor(kind: NavigationKind, record: ControlRecord): { score: number; reason: string } | null {
  const { info } = record;
  const names = [info.accessibleName, info.ariaLabel ?? "", info.text, info.title ?? ""].filter(Boolean);

  if (kind === "openMatchedContent") {
    if (names.some((n) => OPEN_CONTENT_RE.test(n))) return { score: 4, reason: `name "${truncate(info.accessibleName, 40)}"` };
    if (names.some((n) => OPEN_CONTENT_PARTIAL_RE.test(n))) return { score: 3, reason: `name contains "${truncate(info.accessibleName, 40)}"` };
    if (info.href && looksLikeMatchedContentUrl(info.href) && !looksLikeProfileLabel(info.accessibleName) && !info.href.includes(PROTECTION_DETAILS_PATH)) {
      return { score: 2, reason: "href looks like a post/video URL" };
    }
    return null;
  }

  const rule = RULES[kind];
  let score = 0;
  let reason = "";
  if (names.some((n) => rule.exact.test(n))) {
    score = 4;
    reason = `exact name "${truncate(info.accessibleName || info.text, 40)}"`;
  } else if (names.some((n) => rule.partial.test(n))) {
    score = 2;
    reason = `name contains "${truncate(info.accessibleName || info.text, 40)}"`;
  } else {
    return null;
  }
  // A real navigation control is almost always a button/link; a match in a big text container is
  // much weaker evidence.
  if (info.role === "button" || info.role === "link") score += 1;
  if (info.ariaLabel && (rule.exact.test(info.ariaLabel) || rule.partial.test(info.ariaLabel))) score += 0.5;
  if (info.inViewport) score += 0.25;
  if (info.outsideScope) score -= 0.5;
  return { score, reason };
}

/** Ranks every control for every navigation kind. Also tags matched, non-forbidden controls'
 * risk as "navigation" so the inspector can show it. */
export function discoverNavigation(controls: ControlRecord[]): NavigationDiscovery {
  const result = Object.fromEntries(NAVIGATION_KINDS.map((k) => [k, []])) as unknown as NavigationDiscovery;
  for (const record of controls) {
    for (const kind of NAVIGATION_KINDS) {
      const scored = scoreFor(kind, record);
      if (!scored) continue;
      const { info } = record;
      let blockedReason: string | null = null;
      if (info.risk === "forbidden") blockedReason = `forbidden action (${info.riskReason})`;
      else if (info.disabled) blockedReason = "disabled";
      else if (info.ariaHidden) blockedReason = "aria-hidden";
      if (info.risk === "neutral") info.risk = "navigation";
      result[kind].push({
        kind,
        controlIndex: info.index,
        label: truncate(info.accessibleName || info.text || info.href || info.tag, 80),
        score: scored.score,
        reason: scored.reason,
        usable: blockedReason === null,
        blockedReason,
        selectorHints: info.selectorHints.slice(0, 3),
      });
    }
  }
  for (const kind of NAVIGATION_KINDS) result[kind].sort((a, b) => Number(b.usable) - Number(a.usable) || b.score - a.score);
  return result;
}

/** Best usable "next match" control, re-verified live (still connected and visible) since the
 * snapshot may be a moment old. Requires at least a "contains next" match on a button/link. */
export function pickNextControl(controls: ControlRecord[], navigation: NavigationDiscovery = discoverNavigation(controls)): Element | null {
  for (const candidate of navigation.next) {
    if (!candidate.usable || candidate.score < 3) continue;
    const record = controls.find((r) => r.info.index === candidate.controlIndex);
    if (record && isElementVisible(record.el)) return record.el;
  }
  return null;
}
