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
 */
(function () {
  const MESSAGE_SOURCE = "viral-drm-tiktok";

  function postItems(items: unknown): void {
    if (!Array.isArray(items) || items.length === 0) return;
    window.postMessage({ source: MESSAGE_SOURCE, items }, "*");
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
