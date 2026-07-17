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
    return url.includes("/graphql/query");
  }

  function handleResponseText(text: string): void {
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
