/**
 * Runs in the page's own MAIN world at document_start, same technique as
 * content/facebook-network.ts. Intercepts the `copyright_matches` Graph API response — unlike
 * Facebook's profile timeline (internal Comet GraphQL with rotating query IDs), Rights Manager's
 * match list comes from a real, stable Graph API edge
 * (`graph.facebook.com/v2.6/<asset_id>/copyright_matches`). Every match the page has loaded gets
 * captured and relayed, keyed (by content/rights-manager.ts) under several candidate id fields.
 *
 * Identifying which match is *currently open* is handled separately, by reading the "Match ID"
 * label straight off the page (content/rights-manager.ts) — the same technique the original
 * standalone tool used. An earlier version of this file also tried clicking the match detail
 * view's "Copy Link" button and parsing the id out of the copied URL, on the theory that it'd be
 * one of this response's own id fields — live testing showed that copied id doesn't appear
 * anywhere in this response at all, so that approach was dropped rather than chasing where else
 * the button's id might come from.
 *
 * Isolated-world content/rights-manager.ts can't see MAIN-world globals directly, so captured
 * matches are relayed via window.postMessage, which both worlds share.
 */
(function () {
  if (!location.pathname.includes("/rights_manager/")) return;

  const MATCHES_SOURCE = "viral-drm-rights-manager-matches";

  function postMatches(data: unknown): void {
    if (!Array.isArray(data) || data.length === 0) return;
    window.postMessage({ source: MATCHES_SOURCE, matches: data }, "*");
  }

  function isTrackedUrl(url: string): boolean {
    return url.includes("/copyright_matches");
  }

  function handleResponseText(text: string): void {
    try {
      const json = JSON.parse(text) as { data?: unknown };
      postMatches(json?.data);
    } catch {
      // not JSON, or not the shape expected — ignore
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
