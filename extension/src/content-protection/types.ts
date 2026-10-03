/** Shared types for the Content Protection module (detector / inspector / extractor / navigation /
 * adapter). Isolated from the rest of the extension on purpose: the only things it borrows are the
 * existing CapturedMatch / CollectMatchResult shapes, so a future automated capture loop produces
 * exactly the same record the manual "Capture this match" button already sends to
 * POST /api/extension/infringement-reports.
 *
 * Everything here is evidence/data capture only. Nothing in this module ever clicks an
 * enforcement control (Block, Release, Track, Submit, Report, Takedown, Claim, monetization,
 * ownership, or anything else that changes a match's status) -- see FORBIDDEN_ACTION_PATTERNS in
 * selectors.ts, which every navigation candidate is checked against. */
import type { CapturedMatch, CollectMatchResult } from "../lib/rights-manager-scraped";

/** Side panel -> content script. Answered with an InspectResult. */
export const INSPECT_CONTENT_PROTECTION_MESSAGE = "viral-drm-inspect-content-protection";

/** Side panel -> content script, during an automated capture run. Clicks the match panel's Next
 * button (and nothing else, ever) and answers with an AdvanceResult once the next match has
 * rendered. */
export const ADVANCE_TO_NEXT_MATCH_MESSAGE = "viral-drm-advance-to-next-match";

export type AdvanceResult =
  | { ok: true; fingerprint: MatchFingerprint }
  | {
      ok: false;
      /** last_match: Next exists but is disabled -- the normal end of a run. Anything else means
       * the run should stop with an error. */
      reason: "last_match" | "no_next_control" | "unsafe_control" | "timeout" | "error";
      error: string;
    };
/** Bumped whenever PageDiagnostic's shape changes, so a pasted JSON can be read against the right
 * version of this file. */
export const DIAGNOSTIC_SCHEMA_VERSION = 1;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** In the preference order from the module spec -- buildSelectorHints() emits them in this order,
 * so hints[0] is always the most stable option available for that element. Generated CSS class
 * names (x1abc123 etc.) are deliberately never a strategy. */
export type SelectorStrategy =
  | "role+name"
  | "aria-label"
  | "aria-labelledby"
  | "data-attribute"
  | "href-pattern"
  | "text"
  | "label-relationship"
  | "structural";

export interface SelectorHint {
  strategy: SelectorStrategy;
  value: string;
}

/** "forbidden" = matches an enforcement/status-changing action and must never be clicked by
 * automation. "navigation" = matched a navigation pattern. "neutral" = neither. */
export type ActionRisk = "forbidden" | "navigation" | "neutral";

export interface ControlInfo {
  index: number;
  tag: string;
  /** Explicit role attribute, or the element's implicit ARIA role (a[href] -> link, etc). */
  role: string | null;
  explicitRole: boolean;
  text: string;
  ariaLabel: string | null;
  /** aria-labelledby resolved to the referenced elements' text. */
  ariaLabelledBy: string | null;
  accessibleName: string;
  title: string | null;
  /** Sanitized (tracking params stripped, l.facebook.com redirects unwrapped). */
  href: string | null;
  dataTestId: string | null;
  disabled: boolean;
  ariaHidden: boolean;
  state: {
    expanded?: string;
    pressed?: string;
    selected?: string;
    current?: string;
    hasPopup?: string;
  };
  inViewport: boolean;
  rect: Rect;
  ancestry: string;
  nearbyText: string | null;
  selectorHints: SelectorHint[];
  risk: ActionRisk;
  riskReason: string | null;
  /** True for the handful of navigation-looking controls collected from landmarks outside the
   * inspected scope (e.g. a left nav rail) -- see inspector.ts's resolveScope(). */
  outsideScope: boolean;
}

export interface SemanticElementInfo {
  role: string;
  tag: string;
  accessibleName: string;
  textExcerpt: string;
  childCount: number;
  ancestry: string;
  selectorHints: SelectorHint[];
}

export interface HeadingInfo {
  text: string;
  level: number | null;
  ancestry: string;
}

export interface TextBlock {
  index: number;
  text: string;
  heading: boolean;
  headingLevel: number | null;
  inViewport: boolean;
  ancestry: string;
}

export type FieldName =
  | "metaMatchId"
  | "metaVideoId"
  | "infringingUrl"
  | "infringerName"
  | "infringerProfileUrl"
  | "platform"
  | "matchPercentage"
  | "matchedDuration"
  | "videoDuration"
  | "viewCount"
  | "followerCount"
  | "monetizationStatus"
  | "postingDate"
  | "detectedDate"
  | "referenceName"
  | "referenceId"
  | "protectedVideoName"
  | "status"
  | "accountPrivacy";

export const FIELD_NAMES: FieldName[] = [
  "metaMatchId",
  "metaVideoId",
  "infringingUrl",
  "infringerName",
  "infringerProfileUrl",
  "platform",
  "matchPercentage",
  "matchedDuration",
  "videoDuration",
  "viewCount",
  "followerCount",
  "monetizationStatus",
  "postingDate",
  "detectedDate",
  "referenceName",
  "referenceId",
  "protectedVideoName",
  "status",
  "accountPrivacy",
];

export type Confidence = "high" | "medium" | "low";

export interface FieldCandidate {
  /** The raw text/URL as found on the page. */
  value: string;
  /** Parsed form where one is obvious (count -> number, date -> ISO, duration -> seconds). */
  normalized?: string | number | boolean | null;
  /** Short machine-readable description of how it was found, e.g. "url:match_id",
   * "label:Match ID->sibling", "pattern:followers". */
  source: string;
  confidence: Confidence;
  /** The surrounding text the value was read from, when that helps judge it. */
  evidence?: string;
}

export type FieldDiscovery = Record<FieldName, FieldCandidate[]>;

export type NavigationKind = "next" | "previous" | "backToMatches" | "close" | "openMatchedContent";

export const NAVIGATION_KINDS: NavigationKind[] = ["next", "previous", "backToMatches", "close", "openMatchedContent"];

export interface NavigationCandidate {
  kind: NavigationKind;
  controlIndex: number;
  label: string;
  score: number;
  reason: string;
  /** False when disabled, hidden, or matching a forbidden action -- never a click target. */
  usable: boolean;
  blockedReason: string | null;
  selectorHints: SelectorHint[];
}

export type NavigationDiscovery = Record<NavigationKind, NavigationCandidate[]>;

export type ContentProtectionPageKind = "match_details" | "overview" | "other_content_protection" | "legacy_rights_manager" | "unrelated";

export interface DetectionResult {
  recognized: boolean;
  pageKind: ContentProtectionPageKind;
  isMetaHost: boolean;
  isContentProtectionPath: boolean;
  matchIdInUrl: string | null;
  hasMatchedContentLink: boolean;
  hasSeePostText: boolean;
}

export interface ScopeInfo {
  /** "main+dialogs" when the page exposes role="main" (the normal case), else "body". */
  strategy: "main+dialogs" | "body";
  roots: string[];
  /** Landmarks deliberately left out of the inspection (Facebook's top bar, etc.) -- names only,
   * never their contents. */
  excludedLandmarks: { role: string; label: string | null }[];
  iframes: { src: string | null; title: string | null; ancestry: string }[];
}

export interface PageDiagnostic {
  schemaVersion: number;
  tool: "content-protection-inspector";
  extensionVersion: string;
  page: {
    url: string;
    title: string;
    timestamp: string;
    readyState: DocumentReadyState;
    viewport: { width: number; height: number; devicePixelRatio: number; scrollX: number; scrollY: number };
  };
  detection: DetectionResult;
  domStability: { stable: boolean; waitedMs: number; mutations: number };
  scope: ScopeInfo;
  controls: ControlInfo[];
  controlsTruncated: boolean;
  semantic: {
    dialogs: SemanticElementInfo[];
    rows: SemanticElementInfo[];
    listItems: SemanticElementInfo[];
    headings: HeadingInfo[];
    counts: { dialogs: number; rows: number; listItems: number; headings: number };
  };
  attributes: {
    ariaLabels: string[];
    ariaLabelledBy: { ids: string; resolvedText: string }[];
    dataTestIds: string[];
    dataPagelets: string[];
    titles: string[];
  };
  textBlocks: TextBlock[];
  textBlocksTruncated: boolean;
  fields: FieldDiscovery;
  navigation: NavigationDiscovery;
  forbiddenControls: { controlIndex: number; label: string; reason: string }[];
  /** What the existing production parser (content/rights-manager.ts's Content Protection path)
   * returns for this same page -- so the heuristics above can be compared against what a real
   * capture would actually send. Null when not on a Content Protection path. */
  productionExtraction: CollectMatchResult | null;
  warnings: string[];
  durationMs: number;
}

export type InspectResult = { ok: true; diagnostic: PageDiagnostic } | { ok: false; error: string };

/** Enough to tell "the page now shows a different match" apart from "the same match re-rendered".
 * matchId (from the URL) is the primary signal; infringingUrl is the fallback when a layout stops
 * putting match_id in the URL. */
export interface MatchFingerprint {
  url: string;
  matchId: string | null;
  infringingUrl: string | null;
}

/** The surface a future automated capture loop will drive. Phase 1 implements every operation but
 * nothing calls findNextControl()/waitForMatchChange() in a loop yet. */
export interface ContentProtectionAdapter {
  detect(): boolean;
  inspect(): Promise<PageDiagnostic>;
  /** Delegates to the existing production parser, so automation and the manual button can never
   * disagree about what a match's record looks like. */
  extractCurrentMatch(): CollectMatchResult;
  /** The best usable "next match" control, or null. Never returns anything matching a forbidden
   * action. Does not click it. */
  findNextControl(): Element | null;
  fingerprint(): MatchFingerprint;
  waitForMatchChange(previous: MatchFingerprint | CapturedMatch, options?: { timeoutMs?: number }): Promise<MatchFingerprint>;
  /** Clicks Next (strict name whitelist + forbidden-action check) and waits for the next match to
   * fully render. The only thing in this module that clicks anything. */
  advanceToNextMatch(): Promise<AdvanceResult>;
}
