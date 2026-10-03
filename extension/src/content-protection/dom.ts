/** Generic DOM/SPA helpers for the Content Protection module. Meta's interface is a React SPA:
 * moving between matches doesn't reload the page, so everything here waits on what the page
 * actually does (MutationObserver, URL changes) instead of fixed sleeps. Nothing in this file is
 * Content Protection-specific. */

// Zero-width space / ZWNJ / ZWJ / BOM -- Facebook's markup uses these as spacing hacks, same set
// content/rights-manager.ts strips.
const INVISIBLE_CHARS_RE = /[​‌‍﻿]/g;

export function cleanText(text: string | null | undefined): string {
  return (text ?? "").replace(INVISIBLE_CHARS_RE, "").replace(/\s+/g, " ").trim();
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/** Last-line privacy guard for any free text that ends up in a diagnostic. Scope selection
 * (inspector.ts) already keeps Facebook's account chrome out; this just makes sure a stray email
 * address in page text doesn't get copied along with it. */
export function redactText(text: string): string {
  return text.replace(EMAIL_RE, "[email]");
}

/** Visible in the "rendered and takes up space" sense -- an element scrolled out of view still
 * counts (see isInViewport for that). */
export function isElementVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  const html = el as HTMLElement;
  if (typeof html.checkVisibility === "function") {
    if (!html.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
  } else {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width >= 1 && rect.height >= 1) return true;
  // display: contents has no box of its own -- visible if anything inside it is.
  if (getComputedStyle(el).display === "contents") return [...el.children].some(isElementVisible);
  return false;
}

export function isInViewport(rect: DOMRect | { x: number; y: number; width: number; height: number }): boolean {
  return rect.y + rect.height > 0 && rect.x + rect.width > 0 && rect.y < window.innerHeight && rect.x < window.innerWidth;
}

export class WaitTimeoutError extends Error {
  constructor(what: string, timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms waiting for ${what}.`);
    this.name = "WaitTimeoutError";
  }
}

export interface WaitOptions {
  timeoutMs?: number;
  root?: Node;
  signal?: AbortSignal;
}

/** Re-runs `check` on every DOM mutation under `root` (plus once immediately, plus on a slow
 * fallback poll for changes a MutationObserver can't see, like the URL) until it returns a
 * non-null value. The building block for every waitFor* below. */
function observeUntil<T>(
  what: string,
  check: () => T | null | undefined,
  options: WaitOptions & { pollMs?: number; subscribe?: (run: () => void) => () => void } = {}
): Promise<T> {
  const { timeoutMs = 10_000, root = document.documentElement, signal, pollMs = 250, subscribe } = options;
  return new Promise<T>((resolve, reject) => {
    const first = check();
    if (first !== null && first !== undefined) {
      resolve(first);
      return;
    }

    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      clearInterval(poll);
      unsubscribe?.();
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const run = () => {
      const value = check();
      if (value !== null && value !== undefined) finish(() => resolve(value));
    };
    const onAbort = () => finish(() => reject(new DOMException("Aborted", "AbortError")));

    const observer = new MutationObserver(run);
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
    const timer = setTimeout(() => finish(() => reject(new WaitTimeoutError(what, timeoutMs))), timeoutMs);
    const poll = setInterval(run, pollMs);
    const unsubscribe = subscribe?.(run);
    signal?.addEventListener("abort", onAbort);
  });
}

/** Resolves with the first element matching `target` (a CSS selector, or a finder function) that
 * is also visible, unless `visible: false`. */
export function waitForElement(
  target: string | (() => Element | null),
  options: WaitOptions & { visible?: boolean } = {}
): Promise<Element> {
  const { visible = true } = options;
  const find = typeof target === "string" ? () => document.querySelector(target) : target;
  return observeUntil(
    typeof target === "string" ? `element ${target}` : "element",
    () => {
      const el = find();
      return el && (!visible || isElementVisible(el)) ? el : null;
    },
    options
  );
}

/** Resolves with the new value once `read()` returns something other than `previous`. */
export function waitForTextChange(read: () => string, previous: string, options: WaitOptions = {}): Promise<string> {
  return observeUntil(
    "text change",
    () => {
      const current = read();
      return current !== previous ? current : null;
    },
    options
  );
}

/** Resolves with the new URL once location.href differs from `previousUrl`. Isolated-world content
 * scripts can't patch the page's history.pushState, so this listens for the Navigation API's
 * currententrychange (Chrome 102+) and popstate, re-checks on every DOM mutation (an SPA route
 * change always re-renders something), and polls as a last resort. */
export function waitForUrlChange(previousUrl: string = location.href, options: WaitOptions = {}): Promise<string> {
  return observeUntil("URL change", () => (location.href !== previousUrl ? location.href : null), {
    ...options,
    pollMs: 200,
    subscribe: (run) => {
      const nav = (window as unknown as { navigation?: EventTarget }).navigation;
      nav?.addEventListener("currententrychange", run);
      window.addEventListener("popstate", run);
      return () => {
        nav?.removeEventListener("currententrychange", run);
        window.removeEventListener("popstate", run);
      };
    },
  });
}

export interface StableDomResult {
  stable: boolean;
  waitedMs: number;
  mutations: number;
}

/** Resolves once `root` has gone `quietMs` without a single mutation, or after `timeoutMs`
 * regardless (stable: false) -- never rejects, since a page with a constantly-ticking element
 * (a playing video's timestamp, a live counter) would otherwise never settle at all. */
export function waitForStableDOM(options: { quietMs?: number; timeoutMs?: number; root?: Node } = {}): Promise<StableDomResult> {
  const { quietMs = 500, timeoutMs = 5000, root = document.documentElement } = options;
  const started = performance.now();
  return new Promise((resolve) => {
    let mutations = 0;
    let quietTimer: ReturnType<typeof setTimeout>;
    const finish = (stable: boolean) => {
      observer.disconnect();
      clearTimeout(quietTimer);
      clearTimeout(hardTimer);
      resolve({ stable, waitedMs: Math.round(performance.now() - started), mutations });
    };
    const observer = new MutationObserver((records) => {
      mutations += records.length;
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => finish(true), quietMs);
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
    quietTimer = setTimeout(() => finish(true), quietMs);
    const hardTimer = setTimeout(() => finish(false), timeoutMs);
  });
}

/** Generic polled wait for a condition that isn't tied to a DOM mutation. */
export function waitForCondition<T>(what: string, check: () => T | null | undefined, options: WaitOptions = {}): Promise<T> {
  return observeUntil(what, check, options);
}
