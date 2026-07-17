/**
 * DIAGNOSTIC ONLY — not wired into the scan flow yet.
 *
 * Instagram's web client mixes REST-ish endpoints (/api/v1/...) and GraphQL, and neither the
 * exact endpoint nor the response shape is public. Rather than guess (which produced "0 videos
 * found" for TikTok before we intercepted real traffic, and would very likely fail worse here —
 * Instagram is the most obfuscated of the four platforms), this runs in the page's MAIN world at
 * document_start, watches every fetch/XHR response, and stashes the ones that look post/video-ish
 * so the real shape can be inspected before writing a parser against it.
 *
 * This file is deliberately temporary. Once we know the real response shape, replace it with an
 * instagram-network.ts + instagram.ts pair mirroring the TikTok/Facebook content scripts.
 */
(function () {
  const MEDIA_INDICATORS = [
    "video_versions",
    "\"media_type\"",
    "carousel_media",
    "taken_at",
    "\"play_count\"",
    "\"view_count\"",
  ];

  const captures: unknown[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__viralDrmIgCaptures = captures;

  function looksLikeMediaData(text: string): boolean {
    return MEDIA_INDICATORS.some((marker) => text.includes(marker));
  }

  function storeCaptures(text: string): number {
    let stored = 0;
    try {
      captures.push(JSON.parse(text));
      return 1;
    } catch {
      // fall through to line-by-line (some IG responses are newline-delimited too)
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        captures.push(JSON.parse(line));
        stored += 1;
      } catch {
        // not JSON, skip
      }
    }
    return stored;
  }

  function logCandidate(url: string, text: string): void {
    const stored = storeCaptures(text);
    // eslint-disable-next-line no-console
    console.log(
      `%c[ViralDRM IG debug] ${url}`,
      "color:#e1306c;font-weight:bold",
      `\n${text.length} chars, ${stored} JSON object(s) stored — total captured: ${captures.length}. Inspect via window.__viralDrmIgCaptures`
    );
  }

  function isTrackedUrl(url: string): boolean {
    return url.includes("instagram.com/api/") || url.includes("/graphql/query");
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
            if (looksLikeMediaData(text)) logCandidate(url, text);
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
      if (looksLikeMediaData(xhr.responseText)) logCandidate(trackedUrl, xhr.responseText);
    });

    return xhr;
  }
  PatchedXHR.prototype = OriginalXHR.prototype;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  window.XMLHttpRequest = PatchedXHR as any;

  console.log(
    "%c[ViralDRM IG debug] listener active — visit a profile's Reels/posts and scroll to trigger requests",
    "color:#9ca3af"
  );
})();
