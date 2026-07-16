/**
 * DIAGNOSTIC ONLY — not wired into the scan flow yet.
 *
 * Facebook doesn't have one clean internal endpoint the way TikTok's /api/post/item_list is; it's
 * GraphQL with query IDs ("doc_id") that Meta rotates on every deploy, and the response shapes
 * aren't public. Rather than guess (which is exactly what produced "0 videos found" for TikTok
 * before we intercepted the real traffic), this runs in the page's MAIN world at document_start,
 * watches every /api/graphql/ call, and console.logs the ones whose body looks like it contains
 * video/post data — so we can see the real shape before writing a parser against it.
 *
 * This file is deliberately temporary. Once we know the real response shape, replace it with a
 * facebook-network.ts + facebook.ts pair mirroring the TikTok/X content scripts.
 */
(function () {
  const VIDEO_INDICATORS = ["playable_url", "\"video_id\"", "publish_time", "creation_story", "\"is_video\""];

  function looksLikeVideoData(text: string): boolean {
    return VIDEO_INDICATORS.some((marker) => text.includes(marker));
  }

  function logCandidate(url: string, text: string): void {
    // eslint-disable-next-line no-console
    console.log(
      `%c[ViralDRM FB debug] ${url}`,
      "color:#4d8dff;font-weight:bold",
      `\n${text.length} chars — preview:\n${text.slice(0, 1500)}`
    );
  }

  function isTrackedUrl(url: string): boolean {
    return url.includes("/api/graphql/");
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
          .then((text) => {
            if (looksLikeVideoData(text)) logCandidate(url, text);
          })
          .catch(() => {});
      }
    } catch {
      // best-effort — never let diagnostics break the page's real request
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
      if (looksLikeVideoData(xhr.responseText)) logCandidate(trackedUrl, xhr.responseText);
    });

    return xhr;
  }
  PatchedXHR.prototype = OriginalXHR.prototype;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  window.XMLHttpRequest = PatchedXHR as any;

  console.log("%c[ViralDRM FB debug] listener active — scroll a Videos tab to trigger GraphQL calls", "color:#9ca3af");
})();
