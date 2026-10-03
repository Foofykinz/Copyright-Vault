/** Is the current page a Meta Content Protection match? Independent of content/rights-manager.ts's
 * own isContentProtectionMatchPage() (which gates the existing capture button) so the inspector
 * can still report *why* a page isn't recognized -- the case it's most useful for. */
import { isRightsManagerHost } from "../lib/rights-manager-scraped";
import { matchIdFromUrl } from "../lib/rights-manager-parse";
import type { DetectionResult } from "./types";
import { cleanText } from "./dom";
import { isExcludedRegion } from "./page-model";
import { CONTENT_PROTECTION_PATH, looksLikeMatchedContentUrl, sanitizeUrl } from "./selectors";

export function detectContentProtectionPage(): DetectionResult {
  const isMetaHost = isRightsManagerHost(location.hostname);
  const isContentProtectionPath = location.pathname.includes(CONTENT_PROTECTION_PATH);
  const matchIdInUrl = matchIdFromUrl(location.href);

  let hasSeePostText = false;
  let hasMatchedContentLink = false;
  if (isMetaHost) {
    for (const a of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      if (isExcludedRegion(a)) continue; // Facebook's own nav (its Reels tab looks like a post link)
      if (!hasSeePostText && cleanText(a.textContent) === "See post") hasSeePostText = true;
      if (!hasMatchedContentLink && looksLikeMatchedContentUrl(sanitizeUrl(a.href))) hasMatchedContentLink = true;
      if (hasSeePostText && hasMatchedContentLink) break;
    }
  }

  let pageKind: DetectionResult["pageKind"] = "unrelated";
  if (isMetaHost && location.pathname.includes("/rights_manager/")) pageKind = "legacy_rights_manager";
  else if (isMetaHost && isContentProtectionPath) {
    if (matchIdInUrl || location.pathname.includes("/match_details")) pageKind = "match_details";
    else if (/\/content_protection\/?$/.test(location.pathname)) pageKind = "overview";
    else pageKind = "other_content_protection";
  }

  return {
    recognized: isMetaHost && isContentProtectionPath && (matchIdInUrl !== null || hasSeePostText || hasMatchedContentLink),
    pageKind,
    isMetaHost,
    isContentProtectionPath,
    matchIdInUrl,
    hasMatchedContentLink,
    hasSeePostText,
  };
}
