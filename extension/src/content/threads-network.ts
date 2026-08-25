/**
 * Runs in the page's own MAIN world at document_start, so it can patch fetch/XHR before Threads'
 * own code makes its first request. Confirmed via live capture: https://www.threads.com/graphql/query
 * is the one endpoint every query goes through (same path Instagram itself uses -- Threads is built
 * on Instagram's web stack, and post objects share Instagram's exact schema: media_type,
 * taken_at, video_versions, image_versions2, code, ...). Two things Threads does differently from
 * Instagram's endpoint, confirmed the same way:
 *   1. Every response body is prefixed with "for (;;);" before the JSON (an anti-JSON-hijacking
 *      convention Instagram's endpoint doesn't use) -- stripped before parsing.
 *   2. A profile page's query nests posts one level deeper: connection edges are "XDTThread" nodes
 *      (edge.node.thread_items[].post), not the post object itself. That nesting is unwrapped here,
 *      so what gets relayed onward is already a flat list of post-like objects, matching the shape
 *      content/instagram.ts's captured nodes have.
 *
 * Also confirmed via live capture: a profile's query response mixes the profile owner's own posts
 * with OTHER users' replies to those posts in the same top-level edge list -- author filtering
 * happens downstream in content/threads.ts, the same way X/Instagram filter by author rather than
 * trusting everything a query happens to return.
 *
 * Isolated-world content scripts can't see MAIN-world globals directly, so captured posts are
 * relayed to content/threads.ts via window.postMessage, which both worlds share.
 */
(function () {
  const MESSAGE_SOURCE = "viral-drm-threads";

  function postPosts(posts: unknown[]): void {
    if (posts.length === 0) return;
    window.postMessage({ source: MESSAGE_SOURCE, posts }, "*");
  }

  function isConnectionLike(value: unknown): value is { edges: unknown[] } {
    if (!value || typeof value !== "object") return false;
    const obj = value as Record<string, unknown>;
    return Array.isArray(obj.edges) && "page_info" in obj;
  }

  function collectConnections(node: unknown, out: unknown[], depth = 0): void {
    if (!node || typeof node !== "object" || depth > 12) return;
    if (isConnectionLike(node)) {
      out.push(node);
      return; // don't recurse into a matched connection's own edges here — handled separately
    }
    if (Array.isArray(node)) {
      for (const item of node) collectConnections(item, out, depth + 1);
      return;
    }
    for (const value of Object.values(node as Record<string, unknown>)) {
      if (value && typeof value === "object") collectConnections(value, out, depth + 1);
    }
  }

  /** Unwraps a captured connection node down to post-like objects. A profile query's nodes are
   * "XDTThread" wrappers (thread_items[].post); if some other query shape ever returns a bare
   * post-like object directly (has pk + user), that's accepted too rather than dropped, so this
   * doesn't silently go blind if Threads' pagination query nests differently. */
  function extractPosts(node: unknown): unknown[] {
    if (!node || typeof node !== "object") return [];
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.thread_items)) {
      return (obj.thread_items as Record<string, unknown>[]).map((item) => item?.post).filter((post) => post && typeof post === "object");
    }
    if (obj.pk && obj.user) return [obj];
    return [];
  }

  function extractAllPosts(json: unknown): unknown[] {
    const connections: { edges: unknown[] }[] = [];
    collectConnections(json, connections);

    const posts: unknown[] = [];
    for (const conn of connections) {
      for (const edge of conn.edges) {
        const node = (edge as Record<string, unknown> | undefined)?.node;
        posts.push(...extractPosts(node));
      }
    }
    return posts;
  }

  function isTrackedUrl(url: string): boolean {
    return url.includes("/graphql/query");
  }

  function stripJsonHijackPrefix(text: string): string {
    return text.startsWith("for (;;);") ? text.slice("for (;;);".length) : text;
  }

  function handleResponseText(rawText: string): void {
    const text = stripJsonHijackPrefix(rawText);
    try {
      postPosts(extractAllPosts(JSON.parse(text)));
      return;
    } catch {
      // fall through to line-by-line — same newline-delimited-JSON possibility Facebook/Instagram
      // responses sometimes carry
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        postPosts(extractAllPosts(JSON.parse(stripJsonHijackPrefix(line))));
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
