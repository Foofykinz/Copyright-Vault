/** postMessage source tag shared between content/rights-manager-network.ts (MAIN world, patches
 * fetch/XHR) and content/rights-manager.ts (isolated world, listens and answers scan requests from
 * the side panel) — the two worlds can't see each other's globals directly. */
export const RIGHTS_MANAGER_MATCHES_SOURCE = "viral-drm-rights-manager-matches";

export const COLLECT_CURRENT_MATCH_MESSAGE = "viral-drm-collect-current-match";

/** Whether a hostname is one Meta could plausibly serve a match-review interface from. Three
 * confirmed live so far, all genuinely different hostnames, not aliases of each other:
 * business.facebook.com (Business Manager, classic Rights Manager, WX Chasing), web.facebook.com,
 * and www.facebook.com (both reaching Content Protection's Professional Dashboard for different
 * accounts). Rather than keep growing a hardcoded allowlist one report at a time as more accounts
 * turn out to land on yet another facebook.com subdomain, this accepts any of them -- safe to do
 * broadly since what actually gates real behavior is the page's own path/content (see
 * isContentProtectionMatchPage/isLegacyRightsManagerPage in content/rights-manager.ts), not the
 * host; this just decides whether it's worth asking the question at all. Shared between the popup
 * (deciding whether to even message the content script) and the content script itself (deciding
 * whether to activate at all) so the two can't drift apart the way business.facebook.com being
 * hardcoded independently in both places once did. */
export function isRightsManagerHost(hostname: string): boolean {
  return hostname === "facebook.com" || hostname.endsWith(".facebook.com");
}

export const DETECT_RIGHTS_MANAGER_PAGE_MESSAGE = "viral-drm-detect-rights-manager-page";

/** Which Meta match-review interface (if any) the active tab's content script recognizes the
 * current page as. Content-based (page text/DOM shape), not URL-based -- Content Protection's URL
 * pattern isn't confirmed, and detecting by content is what lets the side panel decide whether to
 * show the Rights Manager capture UI without needing to know it. */
export type RightsManagerPageKind = "legacy" | "content_protection";

export interface DetectRightsManagerPageResult {
  recognized: boolean;
  kind: RightsManagerPageKind | null;
}

/** One matched reference asset — a match can carry more than one. */
export interface CapturedReferenceFile {
  id: string;
  title: string;
}

/** The subset of a copyright_matches API entry this extension actually uses — deliberately
 * excludes Meta's own policy/automation data (match_rule, applied_actions, audit_log, geo
 * targeting), which isn't evidence, just Meta's internal config. */
export interface RawCopyrightMatch {
  active_match_data_id: string;
  matched_video_asset?: {
    video_id?: string;
    platform?: string;
    is_private?: boolean;
    owner_name?: string;
    owner_url?: string;
    permalink_url?: string;
    published_time?: number;
    description?: string;
    view_count?: number;
    followers_count?: number;
  };
  match_data?: {
    id?: string;
    total_match_duration?: number;
    /** The client's own copyright/registration record this match was found against — one of
     * several candidate id fields content/rights-manager.ts checks the page-displayed "Match ID"
     * against, alongside active_match_data_id and video_id. */
    video_copyright_id?: string;
    reference_asset?: {
      id?: string;
      title?: string;
    };
  }[];
}

/** A match record after mapping into the shape the side panel's review card actually edits/sends —
 * see the field mapping table in the implementation plan for where each value comes from. */
export interface CapturedMatch {
  metaMatchId: string;
  metaVideoId: string | null;
  infringerName: string;
  infringingUrl: string;
  platform: "facebook" | "instagram";
  postedAt: string; // ISO
  notes: string;
  matchDurationSec: number | null;
  videoViewCount: number | null;
  pageFollowerCount: number | null;
  isAccountPrivate: boolean | null;
  infringerProfileUrl: string | null;
  referenceFiles: CapturedReferenceFile[];
  /** Whether the infringing video is still live — nothing on the page states this directly, so
   * it's never scraped; always starts null ("unknown") and is set by whoever reviews the match in
   * the review card before sending, same as the editable infringerName/notes fields. */
  videoAvailable: boolean | null;
}

export type CollectMatchResult = { ok: true; match: CapturedMatch } | { ok: false; error: string };
