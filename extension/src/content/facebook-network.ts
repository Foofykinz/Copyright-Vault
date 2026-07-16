/**
 * Runs in the page's own MAIN world at document_start, so it can patch fetch/XHR before
 * Facebook's own code makes its first request. Facebook has no single stable endpoint like
 * TikTok's item_list — it's GraphQL with query IDs Meta rotates on every deploy — but the
 * `timeline_list_feed_units` query response shape (confirmed via live capture) is consistent:
 * data.node.timeline_list_feed_units.edges[].node is a "Story", each with post_id, creation_time,
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

  function extractStories(json: unknown): void {
    if (!json || typeof json !== "object") return;
    const edges = (json as Record<string, any>)?.data?.node?.timeline_list_feed_units?.edges; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!Array.isArray(edges)) return;
    const stories = edges.map((edge: any) => edge?.node).filter((node: any) => node?.__typename === "Story"); // eslint-disable-line @typescript-eslint/no-explicit-any
    postStories(stories);
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
