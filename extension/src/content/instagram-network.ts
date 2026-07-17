/**
 * Runs in the page's own MAIN world at document_start, so it can patch fetch/XHR before
 * Instagram's own code makes its first request. Confirmed via live capture: profile timeline
 * data comes back from /graphql/query as a Relay-style connection
 * (data.xdt_api__v1__feed__user_timeline_graphql_connection.edges[].node), but — same lesson
 * learned from Facebook — pagination or other query variants likely use a different field name
 * for that connection. Rather than hardcode one path, this generically finds ANY object shaped
 * like a Relay connection ({ edges: [...], page_info: ... }) anywhere in the response and treats
 * its edges[].node entries as candidate posts, so it isn't tied to one specific query's field name.
 *
 * Isolated-world content scripts can't see MAIN-world globals directly, so captured nodes are
 * relayed to content/instagram.ts via window.postMessage, which both worlds share.
 */
(function () {
  const MESSAGE_SOURCE = "viral-drm-instagram";

  // Debug-only: keeps raw captured connections on window for direct console inspection (this
  // script runs in the page's MAIN world, so no DevTools context-switching needed).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const debugConnections: any[] = ((window as any).__viralDrmIgRawConnections ??= []); // eslint-disable-line @typescript-eslint/no-explicit-any

  // TEMPORARY DIAGNOSTIC: the confirmed profile-timeline connection never populates view_count,
  // so this widens capture to any instagram.com/api/ response (not just /graphql/query, in case
  // opening an individual Reel hits an older REST-style endpoint) and stashes anything containing
  // a *populated* view/play count, regardless of whether it's shaped like a Relay connection.
  // Remove once we know where real view counts live (or confirm they don't exist anywhere public).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewCountCandidates: any[] = ((window as any).__viralDrmIgViewCountDebug ??= []); // eslint-disable-line @typescript-eslint/no-explicit-any

  function looksLikePopulatedViewCount(text: string): boolean {
    return /"(view_count|play_count)":\s*[1-9]\d*/.test(text);
  }

  function maybeStashViewCountCandidate(url: string, text: string): void {
    if (!looksLikePopulatedViewCount(text)) return;
    try {
      viewCountCandidates.push({ url, json: JSON.parse(text) });
    } catch {
      viewCountCandidates.push({ url, raw: text.slice(0, 5000) });
    }
    // eslint-disable-next-line no-console
    console.log(
      `%c[ViralDRM IG view-count debug] populated view/play count found in ${url}`,
      "color:#ffd60a;font-weight:bold",
      `— total candidates: ${viewCountCandidates.length}. Inspect via window.__viralDrmIgViewCountDebug`
    );
  }

  function postNodes(nodes: unknown[]): void {
    if (nodes.length === 0) return;
    window.postMessage({ source: MESSAGE_SOURCE, nodes }, "*");
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

  function extractNodes(json: unknown): unknown[] {
    const connections: { edges: unknown[] }[] = [];
    collectConnections(json, connections);
    debugConnections.push(...connections);

    const nodes: unknown[] = [];
    for (const conn of connections) {
      for (const edge of conn.edges) {
        const node = (edge as Record<string, unknown> | undefined)?.node;
        if (node && typeof node === "object") nodes.push(node);
      }
    }
    return nodes;
  }

  function isTrackedUrl(url: string): boolean {
    // Widened from just /graphql/query so the view-count diagnostic (below) can also see
    // Instagram's older REST-style /api/v1/ endpoints, in case an individual Reel view uses one
    // of those instead. The real connection-extraction logic no-ops harmlessly on anything that
    // isn't shaped like a Relay connection, so this is safe to broaden.
    return url.includes("/graphql/query") || url.includes("instagram.com/api/v1/");
  }

  function handleResponseText(url: string, text: string): void {
    maybeStashViewCountCandidate(url, text);

    // Instagram, like Facebook, can return newline-delimited JSON for some multipart responses.
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          postNodes(extractNodes(JSON.parse(line)));
        } catch {
          // not JSON, skip
        }
      }
      return;
    }
    postNodes(extractNodes(json));
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
          .then((text) => handleResponseText(url, text))
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
      if (isTrackedUrl(trackedUrl)) handleResponseText(trackedUrl, xhr.responseText);
    });

    return xhr;
  }
  PatchedXHR.prototype = OriginalXHR.prototype;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  window.XMLHttpRequest = PatchedXHR as any;
})();
