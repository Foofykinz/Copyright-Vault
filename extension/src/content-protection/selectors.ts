/** Selector building, URL sanitizing, and the never-click guard for Content Protection.
 *
 * Selector preference order (most to least stable), per the module spec:
 *   1. semantic role + accessible name
 *   2. aria-label / aria-labelledby
 *   3. stable data attributes (data-testid, data-pagelet)
 *   4. href/URL patterns
 *   5. visible text
 *   6. relationship to a nearby semantic label
 *   7. stable structural selectors (role/tag ancestry -- never class names)
 * Meta's generated class names (x1abc123 and friends) change between deploys and are never used. */
import type { SelectorHint } from "./types";
import { cleanText, truncate } from "./dom";

/** Confirmed live path for both the overview/list page and an individual match's page -- same
 * value as CONTENT_PROTECTION_PATH in content/rights-manager.ts (kept separate rather than
 * reaching into that file's closure). */
export const CONTENT_PROTECTION_PATH = "/professional_dashboard/content/content_protection";

/** Reference-asset ("Your protected content") links, confirmed live. */
export const PROTECTION_DETAILS_PATH = "/content_protection/protection_details/";

// ---- Never-click guard ----

/** Any control whose accessible name, text, or title matches one of these is classified
 * "forbidden" and can never be returned as a navigation target -- Phase 1 never clicks anything at
 * all, and this is what keeps a future capture loop from ever clicking an enforcement or
 * status-changing action, even one that happens to sit next to (or be labelled like) "Next".
 * Deliberately broad: a false positive just means a control is never auto-clicked, while a false
 * negative could release or block someone's match. */
export const FORBIDDEN_ACTION_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(un)?block(ed|ing)?\b/i, reason: "block" },
  { pattern: /\brelease[sd]?\b/i, reason: "release" },
  { pattern: /\btrack(ed|ing)?\b/i, reason: "track" },
  { pattern: /\bsubmit/i, reason: "submit" },
  { pattern: /\breport/i, reason: "report" },
  { pattern: /\btake\s*-?\s*down/i, reason: "takedown" },
  { pattern: /\bclaim/i, reason: "claim" },
  { pattern: /\bmoneti[sz]/i, reason: "monetization" },
  { pattern: /\b(ad\s+)?(earnings|revenue)\b/i, reason: "monetization" },
  { pattern: /\bowner(ship)?\b/i, reason: "ownership" },
  { pattern: /\b(dispute|appeal|reinstate|restore)/i, reason: "dispute/appeal" },
  { pattern: /\b(un)?hide\b|\bcredit link/i, reason: "protection action" },
  { pattern: /\b(remove|delete|archive)/i, reason: "remove/delete" },
  { pattern: /\b(approve|reject|accept|decline|dismiss|ignore)/i, reason: "status decision" },
  { pattern: /\b(allow\s*-?\s*list|whitelist|allow)\b/i, reason: "allowlist" },
  { pattern: /\b(take|choose|select|apply)\s+action/i, reason: "take action" },
  { pattern: /\b(apply|save|publish|send|share|confirm|proceed|continue|done|ok|yes)\b/i, reason: "commit/confirm" },
  { pattern: /\b(mark|set)\s+as\b/i, reason: "change status" },
  { pattern: /\b(change|update|edit)\s+(status|policy|rule|settings?)/i, reason: "change status" },
  { pattern: /\b(add\s+to|manage|policy|rules?)\b/i, reason: "policy/management" },
  { pattern: /\b(log\s*out|sign\s*out|switch\s+(account|profile))/i, reason: "account session" },
];

/** Toggles are never navigation. Confirmed live: the match page's protection actions ("Hide from
 * everyone", "Claim earnings", "Add credit link") are role="switch" inputs, and only one of them has
 * a label a word pattern catches -- so anything toggle-shaped is ruled out by role instead. */
const TOGGLE_ROLES = new Set(["switch", "checkbox", "radio", "menuitemcheckbox", "menuitemradio", "option", "slider"]);

export function classifyActionRisk(label: string, el: Element): { risk: "forbidden" | null; reason: string | null } {
  const { role } = roleOf(el);
  if (role && TOGGLE_ROLES.has(role)) return { risk: "forbidden", reason: `${role} (changes a setting)` };
  if (el instanceof HTMLButtonElement && el.type === "submit" && el.form) return { risk: "forbidden", reason: "form submit button" };
  if (el instanceof HTMLInputElement && (el.type === "submit" || el.type === "reset")) return { risk: "forbidden", reason: "form submit input" };
  for (const { pattern, reason } of FORBIDDEN_ACTION_PATTERNS) {
    if (pattern.test(label)) return { risk: "forbidden", reason };
  }
  return { risk: null, reason: null };
}

export function isForbiddenControl(label: string, el: Element): boolean {
  return classifyActionRisk(label, el).risk === "forbidden";
}


// ---- Roles & names ----

export function implicitRole(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "a":
    case "area":
      return el.hasAttribute("href") ? "link" : null;
    case "button":
    case "summary":
      return "button";
    case "input": {
      const type = (el as HTMLInputElement).type;
      if (["button", "submit", "reset", "image"].includes(type)) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      return "textbox";
    }
    case "select":
      return "combobox";
    case "textarea":
      return "textbox";
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return "heading";
    case "li":
      return "listitem";
    case "tr":
      return "row";
    case "dialog":
      return "dialog";
    case "nav":
      return "navigation";
    case "main":
      return "main";
    case "header":
      return "banner";
    case "aside":
      return "complementary";
    case "img":
      return "img";
    default:
      return null;
  }
}

export function roleOf(el: Element): { role: string | null; explicit: boolean } {
  const explicit = el.getAttribute("role")?.trim().split(/\s+/)[0];
  if (explicit) return { role: explicit, explicit: true };
  return { role: implicitRole(el), explicit: false };
}

export function resolveLabelledBy(el: Element): string | null {
  const ids = el.getAttribute("aria-labelledby");
  if (!ids) return null;
  const text = ids
    .split(/\s+/)
    .map((id) => cleanText(document.getElementById(id)?.textContent))
    .filter(Boolean)
    .join(" ");
  return text || null;
}

/** A practical approximation of the accessible-name algorithm: aria-labelledby, aria-label, then
 * alt/visible text/title. Good enough to pick out "Next", "Close", "See post", etc. */
export function accessibleName(el: Element): string {
  const labelledBy = resolveLabelledBy(el);
  if (labelledBy) return labelledBy;
  const ariaLabel = cleanText(el.getAttribute("aria-label"));
  if (ariaLabel) return ariaLabel;
  if (el instanceof HTMLImageElement) return cleanText(el.alt);
  const text = cleanText((el as HTMLElement).innerText ?? el.textContent);
  if (text) return text;
  const img = el.querySelector("img[alt]");
  const alt = img ? cleanText(img.getAttribute("alt")) : "";
  if (alt) return alt;
  const svgTitle = cleanText(el.querySelector("svg title")?.textContent);
  if (svgTitle) return svgTitle;
  return cleanText(el.getAttribute("title"));
}

// ---- URLs ----

const TRACKING_PARAM_RE = /^(fbclid|__cft__.*|__tn__|__xts__.*|eid|refid|ref|paipv|mibextid|igsh|igshid|__eep__|_rdr|rdid)$/i;

/** Absolute URL with l.facebook.com/l.php redirects unwrapped and tracking/session-ish query
 * params (fbclid, __cft__[0], __tn__, ...) dropped. Never returns anything that looks like a
 * token: an `access_token`/`token`/`nonce` param is dropped too, just in case. */
export function sanitizeUrl(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    let url = new URL(href, location.origin);
    if (url.hostname.endsWith("facebook.com") && url.pathname === "/l.php") {
      const inner = url.searchParams.get("u");
      if (inner) url = new URL(inner);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return url.protocol; // javascript:, mailto:, etc -- protocol only
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM_RE.test(key) || /token|nonce|session|auth/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** Confirmed real shapes of a matched-content URL (instagram.com/reel|p, facebook.com .../reel/ or
 * .../videos/, fb.watch) plus watch?v= -- language-independent, unlike the "See post" text. */
export function looksLikeMatchedContentUrl(href: string | null): boolean {
  if (!href) return false;
  try {
    const { hostname, pathname, searchParams } = new URL(href);
    const host = hostname.replace(/^(www|web|m|business)\./, "");
    // An id segment is required after reel/videos: confirmed live, Facebook's own top-nav Reels tab
    // links to a bare "facebook.com/reel/?s=tab", which is not a post.
    if (host === "instagram.com") return /^\/(reel|reels|p|tv)\/[^/]+/.test(pathname);
    if (host === "facebook.com") return /\/(reel|videos)\/[^/]+/.test(pathname) || (pathname.startsWith("/watch") && searchParams.has("v"));
    if (host === "fb.watch") return true;
    return false;
  } catch {
    return false;
  }
}

export function looksLikeProfileLabel(label: string): boolean {
  return /^View .+'s profile$/i.test(label);
}

/** "facebook.com/<page>/videos/123456" -> "facebook.com/*\/videos/*" style pattern, plus the
 * query param names (not values), for an href-based selector hint. */
export function hrefPattern(href: string): string | null {
  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^www\./, "");
    const path = url.pathname
      .split("/")
      .map((seg) => (/^\d{4,}$/.test(seg) || /^[A-Za-z0-9_-]{20,}$/.test(seg) ? "*" : seg))
      .join("/");
    const params = [...new Set(url.searchParams.keys())];
    return `${host}${path}${params.length ? `?${params.map((p) => `${p}=*`).join("&")}` : ""}`;
  } catch {
    return null;
  }
}

// ---- Ancestry & hints ----

function describeStep(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  const { role, explicit } = roleOf(el);
  const parts: string[] = [];
  if (explicit && role) parts.push(`[role=${role}]`);
  const label = cleanText(el.getAttribute("aria-label"));
  if (label) parts.push(`[aria-label="${truncate(label, 40)}"]`);
  const testId = el.getAttribute("data-testid");
  if (testId) parts.push(`[data-testid="${testId}"]`);
  const pagelet = el.getAttribute("data-pagelet");
  if (pagelet) parts.push(`[data-pagelet="${pagelet}"]`);
  if (parts.length === 0 && !["a", "button", "main", "nav", "header", "aside", "dialog", "form", "ul", "ol", "li", "table", "tr", "h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) {
    return null; // anonymous wrapper div/span -- collapsed
  }
  return `${tag}${parts.join("")}`;
}

/** Short role/label ancestry, e.g. `div[role=main] > … > div[aria-label="Match details"] > a`.
 * Anonymous wrapper divs collapse to "…" so this stays readable and never includes class names. */
export function describeAncestry(el: Element, maxSteps = 5): string {
  const steps: string[] = [];
  let anonymous = 0;
  let node: Element | null = el.parentElement;
  while (node && node !== document.body && steps.length < maxSteps) {
    const step = describeStep(node);
    if (step) {
      if (anonymous > 0) steps.push("…");
      steps.push(step);
      anonymous = 0;
    } else {
      anonymous++;
    }
    node = node.parentElement;
  }
  const self = describeStep(el) ?? el.tagName.toLowerCase();
  return [...steps.reverse(), self].join(" > ");
}

const STABLE_DATA_ATTRS = ["data-testid", "data-pagelet", "data-visualcompletion"];

function quote(value: string): string {
  return JSON.stringify(truncate(value, 80));
}

/** Every applicable selector for `el`, in preference order. */
export function buildSelectorHints(el: Element, opts: { name?: string; text?: string; nearbyLabel?: string | null } = {}): SelectorHint[] {
  const hints: SelectorHint[] = [];
  const tag = el.tagName.toLowerCase();
  const { role } = roleOf(el);
  const name = opts.name ?? accessibleName(el);
  const text = opts.text ?? cleanText((el as HTMLElement).innerText ?? el.textContent);

  if (role && name) hints.push({ strategy: "role+name", value: `role=${role}[name=${quote(name)}]` });

  const ariaLabel = cleanText(el.getAttribute("aria-label"));
  if (ariaLabel) hints.push({ strategy: "aria-label", value: `${tag}[aria-label=${quote(ariaLabel)}]` });
  const labelledBy = resolveLabelledBy(el);
  if (labelledBy) hints.push({ strategy: "aria-labelledby", value: `${tag}[aria-labelledby] -> ${quote(labelledBy)}` });

  for (const attr of STABLE_DATA_ATTRS) {
    const value = el.getAttribute(attr);
    if (value) hints.push({ strategy: "data-attribute", value: `[${attr}=${quote(value)}]` });
  }

  const href = el.getAttribute("href");
  const pattern = href ? hrefPattern(sanitizeUrl(href) ?? href) : null;
  if (pattern) hints.push({ strategy: "href-pattern", value: `a[href~=${quote(pattern)}]` });

  if (text && text.length <= 60) hints.push({ strategy: "text", value: `${role ?? tag}:text(${quote(text)})` });

  if (opts.nearbyLabel) hints.push({ strategy: "label-relationship", value: `${role ?? tag} near ${quote(truncate(opts.nearbyLabel, 60))}` });

  hints.push({ strategy: "structural", value: describeAncestry(el) });
  return hints;
}
