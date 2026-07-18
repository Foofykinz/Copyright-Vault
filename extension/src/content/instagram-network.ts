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
 * Also captures the `x-ig-app-id` header Instagram's own code attaches to its API requests. The
 * timeline query never carries a populated view count (confirmed via live capture), so getting it
 * requires a separate authenticated request to /api/v1/media/<pk>/info/ — done from the isolated
 * world (content/instagram.ts) rather than here, but it needs this header to be accepted, and
 * there's no other way to learn its value than watching a real request the page makes.
 *
 * Isolated-world content scripts can't see MAIN-world globals directly, so captured nodes (and the
 * app-id header) are relayed to content/instagram.ts via window.postMessage, which both worlds share.
 *
 * postMessage with targetOrigin "*" is visible to any other script running on the page — a
 * malicious or compromised script sharing this same MAIN world could otherwise forge messages
 * tagged with our MESSAGE_SOURCE string and inject fabricated data into the isolated world's
 * capture buffer. content/instagram.ts generates a random per-page-load nonce and hands it to this
 * script via an initial handshake message; every real data message below is tagged with that nonce,
 * and the isolated-world listener rejects anything that doesn't match it. This raises the bar
 * against a naive/blind forgery attempt, but can't be a perfect guarantee — a sufficiently
 * motivated attacker script running in the same MAIN world could still observe the nonce by
 * listening for our own legitimate messages and replay it. There's no channel between MAIN and
 * isolated worlds that isn't visible to same-world page scripts; that's inherent to how MAIN-world
 * content scripts work, not something fixable with a cleverer handshake.
 */
(function () {
  const MESSAGE_SOURCE = "viral-drm-instagram";

  let relayNonce: string | null = null;
  const pendingMessages: Record<string, unknown>[] = [];

  // Accepts only the first handshake received — a forged handshake racing the real one can, at
  // worst, cause our own later messages to be tagged with the wrong nonce and rejected by the
  // isolated world (a denial of the relay, not a way to get forged data accepted, since the
  // isolated world always validates against the nonce *it* generated, never one MAIN world claims).
  window.addEventListener("message", (event) => {
    if (event.source !== window || relayNonce) return;
    const data = event.data as { source?: string; type?: string; nonce?: string } | undefined;
    if (data?.source !== MESSAGE_SOURCE || data.type !== "handshake" || typeof data.nonce !== "string") return;
    relayNonce = data.nonce;
    for (const message of pendingMessages) window.postMessage({ ...message, nonce: relayNonce }, "*");
    pendingMessages.length = 0;
  });

  // Sends immediately once the nonce handshake has completed; otherwise queues (real network
  // responses take far longer than the handshake, so this should be rare in practice — a safety
  // net for the theoretical race, not the expected path).
  function sendOrQueue(message: Record<string, unknown>): void {
    if (relayNonce) {
      window.postMessage({ ...message, nonce: relayNonce }, "*");
    } else {
      pendingMessages.push(message);
    }
  }

  let capturedAppId: string | null = null;

  function captureAppId(headers: HeadersInit | undefined): void {
    if (!headers || capturedAppId) return;
    try {
      const h = headers instanceof Headers ? headers : new Headers(headers);
      const appId = h.get("x-ig-app-id");
      if (appId) {
        capturedAppId = appId;
        sendOrQueue({ source: MESSAGE_SOURCE, appId });
      }
    } catch {
      // best-effort — a malformed headers value just means we try again on the next request
    }
  }

  function postNodes(nodes: unknown[]): void {
    if (nodes.length === 0) return;
    sendOrQueue({ source: MESSAGE_SOURCE, nodes });
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
    try {
      const init = args[1];
      captureAppId(init?.headers);
    } catch {
      // best-effort
    }
    const response = await originalFetch(...args);
    try {
      const input = args[0];
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (isTrackedUrl(url)) {
        response
          .clone()
          .text()
          .then((text) => handleResponseText(text))
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

    const originalSetRequestHeader = xhr.setRequestHeader.bind(xhr);
    xhr.setRequestHeader = ((name: string, value: string) => {
      if (!capturedAppId && name.toLowerCase() === "x-ig-app-id" && value) {
        capturedAppId = value;
        sendOrQueue({ source: MESSAGE_SOURCE, appId: value });
      }
      return originalSetRequestHeader(name, value);
    }) as typeof xhr.setRequestHeader;

    xhr.addEventListener("load", () => {
      if (isTrackedUrl(trackedUrl)) handleResponseText(xhr.responseText);
    });

    return xhr;
  }
  PatchedXHR.prototype = OriginalXHR.prototype;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  window.XMLHttpRequest = PatchedXHR as any;
})();
