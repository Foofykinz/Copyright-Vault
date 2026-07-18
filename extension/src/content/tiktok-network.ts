/**
 * Runs in the page's own MAIN world (not the extension's isolated world) at document_start, so it
 * can patch fetch/XHR before TikTok's own code makes its first request. TikTok's profile pages no
 * longer embed the video list in server-rendered JSON — it's fetched client-side via an internal
 * API (observed at /api/post/item_list/) for both the initial batch and every subsequent page of
 * infinite scroll. Intercepting that response is the only reliable way to get the real data
 * (exact createTime, stats.playCount, desc) without an official API.
 *
 * Isolated-world content scripts can't see MAIN-world globals directly, so captured items are
 * relayed to content/tiktok.ts via window.postMessage, which both worlds share.
 *
 * postMessage with targetOrigin "*" is visible to any other script running on the page — a
 * malicious or compromised script sharing this same MAIN world could otherwise forge messages
 * tagged with our MESSAGE_SOURCE string and inject fabricated data into the isolated world's
 * capture buffer. content/tiktok.ts generates a random per-page-load nonce and hands it to this
 * script via an initial handshake message; every real data message below is tagged with that nonce,
 * and the isolated-world listener rejects anything that doesn't match it. This raises the bar
 * against a naive/blind forgery attempt, but can't be a perfect guarantee — see the same caveat in
 * content/instagram-network.ts, which uses the identical pattern.
 */
(function () {
  const MESSAGE_SOURCE = "viral-drm-tiktok";

  let relayNonce: string | null = null;
  const pendingMessages: Record<string, unknown>[] = [];

  // Accepts only the first handshake received — see content/instagram-network.ts for why a raced
  // forged handshake only risks a denial of the relay, not forged data being accepted.
  window.addEventListener("message", (event) => {
    if (event.source !== window || relayNonce) return;
    const data = event.data as { source?: string; type?: string; nonce?: string } | undefined;
    if (data?.source !== MESSAGE_SOURCE || data.type !== "handshake" || typeof data.nonce !== "string") return;
    relayNonce = data.nonce;
    for (const message of pendingMessages) window.postMessage({ ...message, nonce: relayNonce }, "*");
    pendingMessages.length = 0;
  });

  function postItems(items: unknown): void {
    if (!Array.isArray(items) || items.length === 0) return;
    const message = { source: MESSAGE_SOURCE, items };
    if (relayNonce) {
      window.postMessage({ ...message, nonce: relayNonce }, "*");
    } else {
      pendingMessages.push(message);
    }
  }

  function extractFromJson(json: unknown): void {
    if (json && typeof json === "object" && Array.isArray((json as Record<string, unknown>).itemList)) {
      postItems((json as Record<string, unknown>).itemList);
    }
  }

  function isTrackedUrl(url: string): boolean {
    return url.includes("/api/post/item_list");
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
          .json()
          .then(extractFromJson)
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
      if (!isTrackedUrl(trackedUrl)) return;
      try {
        extractFromJson(JSON.parse(xhr.responseText));
      } catch {
        // ignore non-JSON or unrelated responses
      }
    });

    return xhr;
  }
  PatchedXHR.prototype = OriginalXHR.prototype;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  window.XMLHttpRequest = PatchedXHR as any;
})();
