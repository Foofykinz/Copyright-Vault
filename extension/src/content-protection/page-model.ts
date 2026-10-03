/** One read-only snapshot of the visible Content Protection page: which part of the DOM is in
 * scope, every interactive control in it, and its visible text in logical blocks. The extractor,
 * navigation finder, and inspector all read from the same snapshot so they can never disagree
 * about what was on screen. Holds live Element references -- inspector.ts strips those before
 * anything is serialized. Never clicks, focuses, or scrolls anything. */
import type { ControlInfo, ScopeInfo, TextBlock } from "./types";
import { cleanText, isElementVisible, isInViewport, redactText, truncate } from "./dom";
import {
  accessibleName,
  buildSelectorHints,
  classifyActionRisk,
  describeAncestry,
  resolveLabelledBy,
  looksLikeMatchedContentUrl,
  roleOf,
  sanitizeUrl,
} from "./selectors";

const MAX_CONTROLS = 400;
const MAX_TEXT_BLOCKS = 300;

/** Never read: form contents, editable text, scripts. */
const NEVER_READ_SELECTOR = 'script, style, noscript, template, textarea, input, select, [contenteditable=""], [contenteditable="true"]';

/** Facebook's own account chrome (top bar, notifications, Messenger, account menu) -- personal
 * account data unrelated to the match, so excluded even when it falls inside a scope root. */
const EXCLUDED_REGION_SELECTOR = [
  '[role="banner"]',
  '[aria-label="Notifications"]',
  '[aria-label="Messenger"]',
  '[aria-label="Chats"]',
  '[aria-label="Contacts"]',
  '[aria-label="Your profile"]',
  '[aria-label="Account"]',
  // Confirmed live labels for Facebook's top nav and account menu ("i" = case-insensitive; the live
  // label is "Account Controls and Settings").
  '[role="navigation"][aria-label="Facebook" i]',
  '[aria-label="Account controls and settings" i]',
  '[aria-label="Shortcuts"]',
].join(", ");

const CONTROL_SELECTOR = [
  "a[href]",
  "button",
  "summary",
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  "select",
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="tab"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="combobox"]',
  '[role="slider"]',
  '[aria-haspopup]:not([aria-haspopup="false"])',
  '[tabindex="0"]',
].join(", ");

export interface ControlRecord {
  el: Element;
  info: ControlInfo;
}

export interface TextBlockRecord {
  el: Element;
  block: TextBlock;
}

/** A short visible string and the innermost element holding it -- what label/value and regex
 * field discovery runs over. */
export interface ShortText {
  el: Element;
  text: string;
}

export interface PageModel {
  roots: Element[];
  scope: ScopeInfo;
  controls: ControlRecord[];
  controlsTruncated: boolean;
  textBlocks: TextBlockRecord[];
  textBlocksTruncated: boolean;
  shortTexts: ShortText[];
}

const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"], dialog';

/** A Messenger chat window, notification flyout, or anything else with a text composer -- never
 * part of a match view, and possibly private conversation text. */
function isPrivateDialog(dialog: Element): boolean {
  const label = `${dialog.getAttribute("aria-label") ?? ""} ${resolveLabelledBy(dialog) ?? ""}`;
  if (/chat|messeng|message|conversation|notification|account|profile/i.test(label)) return true;
  return dialog.querySelector('[role="textbox"], [contenteditable="true"], [contenteditable=""], textarea') !== null;
}

export function isExcludedRegion(el: Element): boolean {
  if (el.closest(EXCLUDED_REGION_SELECTOR) !== null) return true;
  const dialog = el.closest(DIALOG_SELECTOR);
  return dialog !== null && isPrivateDialog(dialog);
}

/** querySelectorAll, but also considering `root` itself (a dialog used as a scope root). */
export function queryIncludingSelf(root: Element, selector: string): Element[] {
  const found = [...root.querySelectorAll(selector)];
  return root.matches(selector) ? [root, ...found] : found;
}

function outermost(elements: Element[]): Element[] {
  return elements.filter((el) => !elements.some((other) => other !== el && other.contains(el)));
}

/** Confirmed live signals for the left match panel: its Previous/Next buttons, a "See post" /
 * post-URL link, or a follower count. A "Non-public reel" match has no post link at all, so the
 * buttons and follower count carry it. innerText rather than textContent, which runs adjacent spans
 * together ("Non-public reel15,270 followers") and defeats the pattern. */
function looksLikeMatchPanel(nav: Element): boolean {
  for (const b of nav.querySelectorAll('[role="button"][aria-label], button[aria-label]')) {
    if (/^(next|previous)$/i.test(cleanText(b.getAttribute("aria-label")))) return true;
  }
  for (const a of nav.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (cleanText(a.textContent) === "See post" || looksLikeMatchedContentUrl(sanitizeUrl(a.href))) return true;
  }
  return /(^|[^\d.,])[\d.,]+\s*[KMB]?\s+followers?\b/im.test((nav as HTMLElement).innerText ?? "");
}

/** role="main" plus any open dialog outside it (a match may well open as an overlay), else the
 * whole body. Facebook's banner/account chrome is excluded either way (see isExcludedRegion). */
export function resolveScope(): { roots: Element[]; scope: ScopeInfo; outOfScopeNavigation: Element[] } {
  const mains = outermost([...document.querySelectorAll('[role="main"], main')].filter(isElementVisible));
  const dialogs = outermost(
    [...document.querySelectorAll(DIALOG_SELECTOR)].filter(
      (d) => isElementVisible(d) && !isExcludedRegion(d) && !mains.some((m) => m.contains(d))
    )
  );
  // Confirmed live: on the match details page the left column -- matched video, account name and
  // counts, "See post", and the Previous/Next buttons -- is an unlabelled role="navigation"
  // landmark, not part of role="main". Pulled into scope when it holds match content; Facebook's
  // own nav/account menus are excluded by label above and never qualify.
  const matchPanels = outermost(
    [...document.querySelectorAll('[role="navigation"], nav')].filter(
      (nav) => isElementVisible(nav) && !isExcludedRegion(nav) && !mains.some((m) => m.contains(nav)) && looksLikeMatchPanel(nav)
    )
  );
  const roots = mains.length > 0 ? [...mains, ...matchPanels, ...dialogs] : [document.body];

  const excludedLandmarks: ScopeInfo["excludedLandmarks"] = [];
  // Counted (never labelled -- a chat window's label is a person's name) so a match view that
  // unexpectedly trips isPrivateDialog() is at least visible in the diagnostic.
  for (const d of document.querySelectorAll(DIALOG_SELECTOR)) {
    if (isElementVisible(d) && isExcludedRegion(d)) excludedLandmarks.push({ role: "dialog (excluded: chat/composer/account)", label: null });
  }
  const outOfScopeNavigation: Element[] = [];
  for (const landmark of document.querySelectorAll('[role="banner"], [role="navigation"], [role="complementary"], [role="contentinfo"], header, nav, aside')) {
    if (roots.some((r) => r.contains(landmark)) || !isElementVisible(landmark)) continue;
    const { role } = roleOf(landmark);
    excludedLandmarks.push({ role: role ?? landmark.tagName.toLowerCase(), label: cleanText(landmark.getAttribute("aria-label")) || null });
    if (role === "navigation" && !isExcludedRegion(landmark)) outOfScopeNavigation.push(landmark);
  }

  const iframes: ScopeInfo["iframes"] = [];
  for (const root of roots) {
    for (const frame of root.querySelectorAll("iframe")) {
      if (!isElementVisible(frame)) continue;
      const src = sanitizeUrl(frame.getAttribute("src"));
      let shortSrc: string | null = null;
      try {
        shortSrc = src ? `${new URL(src).host}${new URL(src).pathname}` : null;
      } catch {
        shortSrc = null;
      }
      iframes.push({ src: shortSrc, title: frame.getAttribute("title"), ancestry: describeAncestry(frame) });
    }
  }

  return {
    roots,
    scope: {
      strategy: mains.length > 0 ? "main+dialogs" : "body",
      roots: roots.map((r) => describeAncestry(r, 2)),
      excludedLandmarks,
      iframes,
    },
    outOfScopeNavigation,
  };
}

/** Text of the nearest ancestor (up to 4 levels) that says more than the element itself, without
 * being a whole section's worth. */
function nearbyTextOf(el: Element, ownText: string): string | null {
  let node = el.parentElement;
  for (let i = 0; i < 4 && node; i++, node = node.parentElement) {
    const text = cleanText((node as HTMLElement).innerText ?? node.textContent);
    if (text.length > ownText.length + 2) return text.length <= 240 ? redactText(text) : null;
  }
  return null;
}

export function describeControl(el: Element, index: number, outsideScope = false): ControlInfo {
  const { role, explicit } = roleOf(el);
  const text = redactText(truncate(cleanText((el as HTMLElement).innerText ?? el.textContent), 200));
  const ariaLabel = cleanText(el.getAttribute("aria-label")) || null;
  const ariaLabelledBy = resolveLabelledBy(el);
  const name = redactText(truncate(accessibleName(el), 200));
  const title = cleanText(el.getAttribute("title")) || null;
  const rect = el.getBoundingClientRect();
  // Out-of-scope controls (a nav rail) are listed by name only -- their surroundings are page chrome.
  const nearbyText = outsideScope ? null : nearbyTextOf(el, text);
  const riskLabel = [name, text, title ?? ""].join(" ");
  const { risk, reason } = classifyActionRisk(riskLabel, el);
  const disabled =
    (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true" || el.closest('[aria-disabled="true"]') !== null;

  const state: ControlInfo["state"] = {};
  for (const [key, attr] of [
    ["expanded", "aria-expanded"],
    ["pressed", "aria-pressed"],
    ["selected", "aria-selected"],
    ["current", "aria-current"],
    ["hasPopup", "aria-haspopup"],
  ] as const) {
    const value = el.getAttribute(attr);
    if (value !== null) state[key] = value;
  }

  return {
    index,
    tag: el.tagName.toLowerCase(),
    role,
    explicitRole: explicit,
    text,
    ariaLabel,
    ariaLabelledBy,
    accessibleName: name,
    title,
    href: el.hasAttribute("href") ? sanitizeUrl(el.getAttribute("href")) : null,
    dataTestId: el.getAttribute("data-testid"),
    disabled,
    ariaHidden: el.closest('[aria-hidden="true"]') !== null,
    state,
    inViewport: isInViewport(rect),
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    ancestry: describeAncestry(el),
    nearbyText,
    selectorHints: buildSelectorHints(el, { name, text, nearbyLabel: text || name ? null : nearbyText }),
    risk: risk ?? "neutral",
    riskReason: reason,
    outsideScope,
  };
}

function collectControlElements(roots: Element[]): Element[] {
  const seen = new Set<Element>();
  const result: Element[] = [];
  for (const root of roots) {
    for (const el of queryIncludingSelf(root, CONTROL_SELECTOR)) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (isExcludedRegion(el) || !isElementVisible(el)) continue;
      // Inputs are listed (type/label only, never value); everything else inside a form field is skipped.
      if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement) && el.closest(NEVER_READ_SELECTOR)) continue;
      result.push(el);
    }
  }
  return result;
}

const INLINE_DISPLAYS = new Set(["inline", "inline-block", "inline-flex", "inline-grid", "contents"]);

/** Groups visible text nodes by their nearest block-level container, so a label and its value
 * rendered as sibling spans read as one line ("Match ID 2268962413853082") rather than the raw DOM
 * being dumped. */
function collectText(roots: Element[]): { blocks: TextBlockRecord[]; truncated: boolean; shortTexts: ShortText[] } {
  const displayCache = new Map<Element, string>();
  const visibleCache = new Map<Element, boolean>();
  const display = (el: Element) => {
    let value = displayCache.get(el);
    if (value === undefined) {
      value = getComputedStyle(el).display;
      displayCache.set(el, value);
    }
    return value;
  };
  const visible = (el: Element) => {
    let value = visibleCache.get(el);
    if (value === undefined) {
      value = isElementVisible(el);
      visibleCache.set(el, value);
    }
    return value;
  };

  const order: Element[] = [];
  const parts = new Map<Element, string[]>();
  const shortTextEls = new Set<Element>();
  const shortTexts: ShortText[] = [];

  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const text = cleanText(node.data);
      if (!text) continue;
      const parent = node.parentElement;
      if (!parent || parent.closest(NEVER_READ_SELECTOR) || parent.closest("svg") || isExcludedRegion(parent) || !visible(parent)) continue;

      let block: Element = parent;
      while (block !== root && block.parentElement && INLINE_DISPLAYS.has(display(block))) block = block.parentElement;
      if (!parts.has(block)) {
        parts.set(block, []);
        order.push(block);
      }
      parts.get(block)!.push(text);

      // Innermost element whose full text is short -- a label, a value, a count, a chip.
      if (!shortTextEls.has(parent)) {
        const full = cleanText(parent.textContent);
        if (full && full.length <= 160) {
          shortTextEls.add(parent);
          shortTexts.push({ el: parent, text: full });
        }
      }
    }
  }

  const blocks: TextBlockRecord[] = [];
  let previous = "";
  for (const el of order) {
    const text = redactText(truncate(cleanText(parts.get(el)!.join(" ")), 500));
    if (!text || text === previous) continue;
    previous = text;
    const headingEl = el.closest('[role="heading"], h1, h2, h3, h4, h5, h6');
    const isHeading = headingEl !== null;
    const levelAttr = headingEl?.getAttribute("aria-level");
    const tagLevel = headingEl && /^H[1-6]$/.test(headingEl.tagName) ? Number(headingEl.tagName[1]) : null;
    blocks.push({
      el,
      block: {
        index: blocks.length,
        text,
        heading: isHeading,
        headingLevel: isHeading ? (levelAttr ? Number(levelAttr) : tagLevel) : null,
        inViewport: isInViewport(el.getBoundingClientRect()),
        ancestry: describeAncestry(el, 3),
      },
    });
  }
  return { blocks: blocks.slice(0, MAX_TEXT_BLOCKS), truncated: blocks.length > MAX_TEXT_BLOCKS, shortTexts };
}

/** Matches a navigation-looking name -- used only to decide which controls from out-of-scope
 * navigation landmarks are worth listing at all (the rest of a nav rail is noise). */
const OUT_OF_SCOPE_NAV_RE = /\b(next|previous|prev|back|matches|content protection|close)\b/i;

export function buildPageModel(): PageModel {
  const { roots, scope, outOfScopeNavigation } = resolveScope();

  const inScope = collectControlElements(roots);
  const controls: ControlRecord[] = inScope.slice(0, MAX_CONTROLS).map((el, i) => ({ el, info: describeControl(el, i) }));
  for (const el of collectControlElements(outOfScopeNavigation)) {
    if (!OUT_OF_SCOPE_NAV_RE.test(accessibleName(el))) continue;
    controls.push({ el, info: describeControl(el, controls.length, true) });
  }

  const { blocks, truncated, shortTexts } = collectText(roots);
  return {
    roots,
    scope,
    controls,
    controlsTruncated: inScope.length > MAX_CONTROLS,
    textBlocks: blocks,
    textBlocksTruncated: truncated,
    shortTexts,
  };
}
