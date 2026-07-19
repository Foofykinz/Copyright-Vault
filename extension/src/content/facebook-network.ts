/**
 * Runs in the page's own MAIN world at document_start, so it can patch fetch/XHR before
 * Facebook's own code makes its first request. Facebook has no single stable endpoint like
 * TikTok's item_list — it's GraphQL with query IDs Meta rotates on every deploy, and different
 * queries (initial load vs. scroll-triggered pagination) can have entirely different root field
 * names even though they both return Story nodes. Rather than target one specific path (which is
 * what silently missed pagination responses before), this searches every /api/graphql/ response
 * for objects shaped like a "Story" — __typename "Story", with post_id, creation_time,
 * attachments, and (when it's a share rather than an original post) a populated attached_story.
 *
 * Isolated-world content scripts can't see MAIN-world globals directly, so captured stories are
 * relayed to content/facebook.ts via window.postMessage, which both worlds share.
 */
(function () {
  const MESSAGE_SOURCE = "viral-drm-facebook";

  function postStories(stories: unknown): void {
    if (!Array.isArray(stories) || stories.length === 0) return;
    window.postMessage({ source: MESSAGE_SOURCE, stories }, "*");
  }

  // Scroll-triggered "load more" requests almost certainly use a different GraphQL query (and
  // therefore a different root field) than the initial page load's timeline_list_feed_units —
  // hardcoding that one path meant pagination responses were being intercepted but silently
  // ignored, which is why capture volume stayed tiny even after scrolling. This walks the whole
  // response looking for Story-typed nodes wherever they are, so it doesn't matter which query
  // shape produced them.
  function collectStories(node: unknown, out: unknown[], depth = 0): void {
    if (!node || typeof node !== "object" || depth > 14) return;
    if (Array.isArray(node)) {
      for (const item of node) collectStories(item, out, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (obj.__typename === "Story") {
      out.push(obj);
      return; // don't recurse into an already-captured story (avoids picking up nested attached_story/quoted content as if it were top-level)
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") collectStories(value, out, depth + 1);
    }
  }

  function extractStories(json: unknown): void {
    if (!json || typeof json !== "object") return;
    const stories: unknown[] = [];
    collectStories(json, stories);
    if (stories.length > 0) postStories(stories);
  }

  function isTrackedUrl(url: string): boolean {
    return url.includes("/api/graphql/");
  }

  function handleResponseText(text: string): void {
    // Facebook sometimes returns newline-delimited JSON (Relay multipart/defer responses)
    // instead of one JSON object.
    try {
      extractStories(JSON.parse(text));
      return;
    } catch {
      // fall through to line-by-line
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        extractStories(JSON.parse(line));
      } catch {
        // not JSON, skip
      }
    }
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = (async (...args: Parameters<typeof fetch>) => {
    const response = await originalFetch(...args);
    try {
      const input = args[0];
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (isTrackedUrl(url)) {
        response
          .clone()
          .text()
          .then(handleResponseText)
          .catch(() => {});
      }
    } catch {
      // best-effort — never let interception break the page's real request
    }
    return response;
  }) as typeof fetch;

  const OriginalXHR = window.XMLHttpRequest;
  function PatchedXHR(this: XMLHttpRequest) {
    const xhr = new OriginalXHR();
    let trackedUrl = "";

    const originalOpen = xhr.open.bind(xhr);
    xhr.open = ((method: string, url: string | URL, ...rest: unknown[]) => {
      trackedUrl = typeof url === "string" ? url : url.toString();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (originalOpen as any)(method, url, ...rest);
    }) as typeof xhr.open;

    xhr.addEventListener("load", () => {
      if (isTrackedUrl(trackedUrl)) handleResponseText(xhr.responseText);
    });

    return xhr;
  }
  PatchedXHR.prototype = OriginalXHR.prototype;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  window.XMLHttpRequest = PatchedXHR as any;
})();
