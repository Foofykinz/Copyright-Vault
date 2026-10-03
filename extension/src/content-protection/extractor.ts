/** Heuristic match-field discovery for the inspector. Unlike the production parser (which commits
 * to one value per field), this lists every plausible candidate with where it came from and how
 * confident the match is, so the real page structure can be confirmed before any of it is relied
 * on. Read-only; works entirely from the PageModel snapshot plus the URL. */
import { matchIdFromUrl, parseDetectedDate, segmentRangeSeconds, stripReferenceStats } from "../lib/rights-manager-parse";
import { FIELD_NAMES, type Confidence, type FieldCandidate, type FieldDiscovery, type FieldName } from "./types";
import type { PageModel, ShortText } from "./page-model";
import { cleanText, redactText, truncate } from "./dom";
import { looksLikeMatchedContentUrl, looksLikeProfileLabel, PROTECTION_DETAILS_PATH, sanitizeUrl } from "./selectors";

const MAX_CANDIDATES_PER_FIELD = 8;

class Candidates {
  readonly fields: FieldDiscovery;
  constructor() {
    this.fields = Object.fromEntries(FIELD_NAMES.map((f) => [f, []])) as unknown as FieldDiscovery;
  }
  add(field: FieldName, candidate: FieldCandidate): void {
    const list = this.fields[field];
    const value = truncate(redactText(candidate.value), 300);
    if (!value || list.length >= MAX_CANDIDATES_PER_FIELD) return;
    if (list.some((c) => c.value === value && c.source === candidate.source)) return;
    list.push({ ...candidate, value, evidence: candidate.evidence ? truncate(redactText(candidate.evidence), 200) : undefined });
  }
  sort(): FieldDiscovery {
    const rank: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
    for (const field of FIELD_NAMES) this.fields[field].sort((a, b) => rank[a.confidence] - rank[b.confidence]);
    return this.fields;
  }
}

/** "16" / "16,723" / "1.2K" / "3.4M" -> integer. */
export function parseCount(text: string): number | null {
  const m = /^([\d.,]+)\s*([KMB])?$/i.exec(text.replace(/\s+/g, " ").trim());
  if (!m) return null;
  const multiplier = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase() as "K" | "M" | "B"] ?? 1;
  const base = multiplier === 1 ? Number(m[1].replace(/[.,]/g, "")) : Number(m[1].replace(/,/g, "."));
  return Number.isFinite(base) ? Math.round(base * multiplier) : null;
}

/** "2m 18s" / "1h 2m 3s" / "45s" / "2:18" / "1:02:03" -> seconds. */
export function parseDurationText(text: string): number | null {
  const t = text.trim();
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (clock) return clock[3] !== undefined ? Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) : Number(clock[1]) * 60 + Number(clock[2]);
  const units = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+(?:\.\d+)?)\s*s(?:ec)?)?$/i.exec(t);
  if (units && (units[1] || units[2] || units[3])) return Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0);
  return null;
}

function toIsoOrNull(text: string): string | null {
  const detected = parseDetectedDate(text);
  if (detected) return detected.toISOString();
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** For each element whose whole text is exactly one of `labels` (case-insensitive), the value
 * rendered next to it: next sibling, parent's next sibling (the confirmed "More details" row shape),
 * or the remainder of the parent's text. */
function findLabeledValues(shortTexts: ShortText[], labels: string[]): { label: string; value: string; via: string }[] {
  const wanted = new Set(labels.map((l) => l.toLowerCase()));
  const results: { label: string; value: string; via: string }[] = [];
  for (const { el, text } of shortTexts) {
    if (!wanted.has(text.toLowerCase())) continue;
    const tries: [string, Element | null | undefined][] = [
      ["sibling", el.nextElementSibling],
      ["parent-sibling", el.parentElement?.nextElementSibling],
      ["grandparent-sibling", el.parentElement?.parentElement?.nextElementSibling],
    ];
    for (const [via, node] of tries) {
      const value = cleanText(node?.textContent);
      if (value && value.length <= 200 && value.toLowerCase() !== text.toLowerCase()) {
        results.push({ label: text, value, via });
        break;
      }
    }
    const parentText = cleanText(el.parentElement?.textContent);
    if (parentText.toLowerCase().startsWith(text.toLowerCase()) && parentText.length > text.length && parentText.length <= 200) {
      results.push({ label: text, value: parentText.slice(text.length).replace(/^[:\s]+/, ""), via: "parent-remainder" });
    }
  }
  return results;
}

function platformOfUrl(url: string): "facebook" | "instagram" | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === "instagram.com") return "instagram";
    if (host.endsWith("facebook.com") || host === "fb.watch") return "facebook";
  } catch {
    // fall through
  }
  return null;
}

function videoIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const m = /\/(?:videos|reel)\/(\d{5,})/.exec(parsed.pathname);
    if (m) return m[1];
    return parsed.searchParams.get("v") ?? parsed.searchParams.get("story_fbid");
  } catch {
    return null;
  }
}

const STATUS_WORDS = [
  "needs review",
  "in review",
  "pending",
  "active",
  "blocked",
  "tracked",
  "tracking",
  "released",
  "monetized",
  "monetizing",
  "claimed",
  "reported",
  "removed",
  "taken down",
  "dismissed",
  "ignored",
  "expired",
  "no action",
  "action taken",
];

export function discoverFields(model: PageModel): FieldDiscovery {
  const c = new Candidates();
  const { controls, shortTexts, textBlocks } = model;
  const links = controls.filter((r) => r.info.href);

  // -- Match ID
  const urlMatchId = matchIdFromUrl(location.href);
  if (urlMatchId) c.add("metaMatchId", { value: urlMatchId, source: "url:match_id", confidence: "high" });
  for (const lv of findLabeledValues(shortTexts, ["Match ID", "Match id"])) {
    c.add("metaMatchId", { value: lv.value, source: `label:${lv.label}->${lv.via}`, confidence: "medium" });
  }

  // -- Infringing / matched content URL
  for (const { info } of links) {
    if (info.outsideScope) continue;
    const href = info.href!;
    if (info.text === "See post" || info.accessibleName === "See post") {
      c.add("infringingUrl", { value: href, source: 'link-text:"See post"', confidence: "high", evidence: info.ancestry });
    } else if (/\b(see|view|open|watch)\s+(post|video|reel|content)\b/i.test(info.accessibleName)) {
      c.add("infringingUrl", { value: href, source: `link-name:"${truncate(info.accessibleName, 40)}"`, confidence: "medium", evidence: info.ancestry });
    } else if (looksLikeMatchedContentUrl(href) && !looksLikeProfileLabel(info.accessibleName) && !href.includes(PROTECTION_DETAILS_PATH)) {
      c.add("infringingUrl", { value: href, source: "href-shape:content-url", confidence: "medium", evidence: info.accessibleName || info.ancestry });
    }
  }

  // -- Video ID (only ever displayed on the older layout; else derived, flagged low)
  for (const lv of findLabeledValues(shortTexts, ["Video ID", "Content ID", "Video id"])) {
    c.add("metaVideoId", { value: lv.value, source: `label:${lv.label}->${lv.via}`, confidence: "medium" });
  }
  for (const candidate of c.fields.infringingUrl) {
    const id = videoIdFromUrl(candidate.value);
    if (id) c.add("metaVideoId", { value: id, source: "derived:matched-content-url", confidence: "low", evidence: "Not displayed on the page -- parsed out of the post URL" });
  }

  // -- Platform
  for (const candidate of c.fields.infringingUrl) {
    const platform = platformOfUrl(candidate.value);
    if (platform) c.add("platform", { value: platform, source: "derived:matched-content-url-host", confidence: candidate.confidence });
  }
  for (const { text } of shortTexts) {
    if (/^(facebook|instagram)$/i.test(text)) c.add("platform", { value: text.toLowerCase(), source: "text:platform-name", confidence: "low" });
  }
  for (const root of model.roots) {
    for (const el of root.querySelectorAll('[aria-label="Instagram"], [aria-label="Facebook"], img[alt="Instagram"], img[alt="Facebook"]')) {
      if (el.closest('[role="banner"]')) continue;
      const label = el.getAttribute("aria-label") ?? el.getAttribute("alt") ?? "";
      c.add("platform", { value: label.toLowerCase(), source: "aria-label/alt:platform-icon", confidence: "low" });
    }
  }

  // -- Infringer name & profile URL
  for (const { info } of links) {
    const label = info.ariaLabel ?? "";
    const m = /^View (.+)'s profile$/i.exec(label);
    if (!m) continue;
    c.add("infringerName", { value: info.text || m[1], source: info.text ? "profile-link:text" : "profile-link:aria-label", confidence: "high" });
    c.add("infringerProfileUrl", { value: info.href!, source: 'profile-link:aria-label="View …\'s profile"', confidence: "high" });
  }
  const followersIndex = shortTexts.findIndex((s) => /^[\d.,]+\s*[KMB]?\s+followers?$/i.test(s.text));
  if (followersIndex > 0) {
    for (let i = followersIndex - 1; i >= Math.max(0, followersIndex - 3); i--) {
      const prev = shortTexts[i];
      if (prev.text.length > 100 || /^[\d.,]+\s*[KMB]?\s+(views?|followers?)$/i.test(prev.text)) continue;
      c.add("infringerName", { value: prev.text, source: "text-order:line-before-followers", confidence: "medium" });
      const href = sanitizeUrl(prev.el.closest("a[href]")?.getAttribute("href"));
      if (href) c.add("infringerProfileUrl", { value: href, source: "text-order:link-around-name-before-followers", confidence: "medium" });
      break;
    }
  }

  // -- Counts
  for (const { text } of shortTexts) {
    let m = /^([\d.,]+\s*[KMB]?)\s+(views?|plays?)$/i.exec(text);
    if (m) c.add("viewCount", { value: text, normalized: parseCount(m[1]), source: `pattern:"<n> ${m[2].toLowerCase()}"`, confidence: "high" });
    m = /^([\d.,]+\s*[KMB]?)\s+followers?$/i.exec(text);
    if (m) c.add("followerCount", { value: text, normalized: parseCount(m[1]), source: 'pattern:"<n> followers"', confidence: "high" });
  }
  for (const lv of findLabeledValues(shortTexts, ["Video views", "Views", "Plays"])) {
    c.add("viewCount", { value: lv.value, normalized: parseCount(lv.value), source: `label:${lv.label}->${lv.via}`, confidence: "medium" });
  }
  for (const lv of findLabeledValues(shortTexts, ["Page followers", "Followers"])) {
    c.add("followerCount", { value: lv.value, normalized: parseCount(lv.value), source: `label:${lv.label}->${lv.via}`, confidence: "medium" });
  }

  // -- Match percentage & matched duration
  for (const { text } of shortTexts) {
    const pct = /(\d{1,3}(?:\.\d+)?)\s*%/.exec(text);
    if (pct && Number(pct[1]) <= 100) {
      const contextual = /protected content|match/i.test(text);
      c.add("matchPercentage", {
        value: `${pct[1]}%`,
        normalized: Number(pct[1]),
        source: contextual ? "pattern:percent-with-context" : "pattern:bare-percent",
        confidence: contextual ? "high" : "low",
        evidence: text,
      });
    }
    const durPrefix = /^((?:\d+h\s*)?(?:\d+m\s*)?\d+(?:\.\d+)?s),\s*\d+%\s*of the protected content/i.exec(text);
    if (durPrefix) {
      c.add("matchedDuration", { value: durPrefix[1], normalized: parseDurationText(durPrefix[1]), source: "pattern:reference-card-stats", confidence: "medium", evidence: text });
    }
  }
  const segmentEls = shortTexts.filter((s) => s.text.length <= 20 && segmentRangeSeconds(s.text) !== null);
  const innermostSegments = segmentEls.filter((s) => !segmentEls.some((o) => o !== s && s.el.contains(o.el)));
  const uniqueSegments = [...new Set(innermostSegments.map((s) => s.text))];
  if (uniqueSegments.length > 0) {
    const total = uniqueSegments.reduce((sum, t) => sum + (segmentRangeSeconds(t) ?? 0), 0);
    c.add("matchedDuration", {
      value: `${total}s`,
      normalized: total,
      source: `segments:sum-of-${uniqueSegments.length}`,
      confidence: "high",
      evidence: uniqueSegments.join(", "),
    });
  }
  for (const lv of findLabeledValues(shortTexts, ["Match duration", "Matched duration", "Matching duration"])) {
    c.add("matchedDuration", { value: lv.value, normalized: parseDurationText(lv.value), source: `label:${lv.label}->${lv.via}`, confidence: "medium" });
  }

  // -- Video duration
  for (const root of model.roots) {
    for (const video of root.querySelectorAll("video")) {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        c.add("videoDuration", { value: `${Math.round(video.duration)}s`, normalized: Math.round(video.duration), source: "video-element:duration", confidence: "medium", evidence: "Duration of a <video> on the page -- may be the protected or the matched video" });
      }
    }
  }
  for (const { text } of shortTexts) {
    const m = /^\d{1,2}:\d{2}(?::\d{2})?\s*\/\s*(\d{1,2}:\d{2}(?::\d{2})?)$/.exec(text);
    if (m) c.add("videoDuration", { value: m[1], normalized: parseDurationText(m[1]), source: "pattern:player-time", confidence: "medium", evidence: text });
  }
  for (const lv of findLabeledValues(shortTexts, ["Video duration", "Duration", "Length"])) {
    c.add("videoDuration", { value: lv.value, normalized: parseDurationText(lv.value), source: `label:${lv.label}->${lv.via}`, confidence: "medium" });
  }

  // -- Dates
  for (const { text } of shortTexts) {
    const posted = /^(Posted|Published(?: on)?|Uploaded(?: on)?|Created(?: on)?)\s+(.{3,40})$/i.exec(text);
    if (posted) c.add("postingDate", { value: posted[2], normalized: toIsoOrNull(posted[2]), source: `pattern:"${posted[1]} <date>"`, confidence: "high" });
    if (text.length <= 40 && /^Detected\s/i.test(text)) {
      c.add("detectedDate", { value: text, normalized: parseDetectedDate(text)?.toISOString() ?? null, source: 'pattern:"Detected <date>"', confidence: "medium" });
    }
  }
  for (const lv of findLabeledValues(shortTexts, ["Date posted", "Posted", "Publish date", "Published", "Upload date"])) {
    c.add("postingDate", { value: lv.value, normalized: toIsoOrNull(lv.value), source: `label:${lv.label}->${lv.via}`, confidence: "medium" });
  }
  for (const lv of findLabeledValues(shortTexts, ["Date detected", "Detected", "Match date"])) {
    c.add("detectedDate", { value: lv.value, normalized: toIsoOrNull(lv.value), source: `label:${lv.label}->${lv.via}`, confidence: "medium" });
  }

  // -- Reference file(s)
  for (const { el, info } of links) {
    if (!info.href?.includes(PROTECTION_DETAILS_PATH)) continue;
    let assetId: string | null = null;
    try {
      assetId = new URL(info.href).searchParams.get("asset_id");
    } catch {
      assetId = null;
    }
    if (assetId) c.add("referenceId", { value: assetId, source: "protection_details-link:asset_id", confidence: "high" });
    const singleSpanDiv = [...el.querySelectorAll("div")].find((d) => d.children.length === 1 && d.children[0].tagName === "SPAN");
    const title = cleanText(singleSpanDiv?.textContent) || stripReferenceStats(info.text);
    if (title) {
      c.add("referenceName", { value: title, source: "protection_details-link:title-row", confidence: "high" });
      c.add("protectedVideoName", { value: title, source: "same-as:reference-title", confidence: "medium" });
    }
  }
  for (const lv of findLabeledValues(shortTexts, ["Reference ID", "Reference file ID", "Asset ID"])) {
    c.add("referenceId", { value: lv.value, source: `label:${lv.label}->${lv.via}`, confidence: "medium" });
  }
  const sectionHeading = /^(your )?(protected content|reference( file| video| content)?s?|original( video| content)?)$/i;
  textBlocks.forEach(({ block }, i) => {
    if (!sectionHeading.test(block.text)) return;
    const next = textBlocks[i + 1]?.block.text;
    if (next && next.length <= 160) c.add("protectedVideoName", { value: next, source: `text-order:block-after-"${block.text}"`, confidence: "low" });
  });

  // -- Monetization, status, privacy
  for (const { text } of shortTexts) {
    if (/moneti[sz]|ad earnings|revenue/i.test(text) && text.length <= 120) {
      c.add("monetizationStatus", { value: text, source: "text:mentions-monetization", confidence: "low" });
    }
    if (STATUS_WORDS.includes(text.toLowerCase())) c.add("status", { value: text, source: "text:known-status-word", confidence: "low" });
    // "Non-public reel" confirmed live, shown where the account name would be.
    if (/\bprivate (account|profile)\b|\baccount is private\b|\b(non-)?public (account|profile|reel|video|post)\b/i.test(text) && text.length <= 120) {
      c.add("accountPrivacy", { value: text, normalized: /private|non-public/i.test(text), source: "text:privacy-phrase", confidence: "medium" });
    }
  }
  for (const lv of findLabeledValues(shortTexts, ["Monetization", "Monetisation", "Monetization status", "Ad earnings"])) {
    c.add("monetizationStatus", { value: lv.value, source: `label:${lv.label}->${lv.via}`, confidence: "medium" });
  }
  for (const lv of findLabeledValues(shortTexts, ["Status", "Match status", "Action", "Current action"])) {
    c.add("status", { value: lv.value, source: `label:${lv.label}->${lv.via}`, confidence: "medium" });
  }
  for (const lv of findLabeledValues(shortTexts, ["Account privacy", "Privacy", "Account type"])) {
    c.add("accountPrivacy", { value: lv.value, source: `label:${lv.label}->${lv.via}`, confidence: "medium" });
  }

  return c.sort();
}
