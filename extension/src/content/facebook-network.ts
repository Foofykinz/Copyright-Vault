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

  // Debug-only: keeps raw captured stories on window so they can be inspected directly from the
  // normal DevTools console (this script runs in the page's MAIN world, so no context-switching
  // needed). Run `window.__viralDrmFbDebug()` in the console to see stories whose video
  // attachment has no permalink findable — the same failure mode fixed once already for /reel/.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const debugStories: any[] = ((window as any).__viralDrmFbRawStories ??= []); // eslint-disable-line @typescript-eslint/no-explicit-any

  function findVideoNode(node: unknown, depth = 0): Record<string, unknown> | null {
    if (!node || typeof node !== "object" || depth > 8) return null;
    const obj = node as Record<string, unknown>;
    if (obj.__typename === "Video") return obj;
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") {
        const found = findVideoNode(value, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  function hasUsableUrl(video: Record<string, unknown>): boolean {
    return typeof video.permalink_url === "string" || video.id !== undefined;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__viralDrmFbDebug = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withVideo = debugStories.filter((s) => (s.attachments ?? []).some((a: any) => findVideoNode(a)));
    // eslint-disable-line @typescript-eslint/no-explicit-any
    const stuck = withVideo.filter((s) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const video = (s.attachments ?? []).map((a: any) => findVideoNode(a)).find((v: unknown) => v);
      return !video || !hasUsableUrl(video);
    });
    console.log(`${debugStories.length} stories captured, ${withVideo.length} have a video, ${stuck.length} have neither a permalink nor an ID.`);
    for (const s of stuck) {
      console.log(`--- post_id ${s.post_id} ---`);
      console.log(JSON.stringify(s.attachments, null, 2));
    }
    return { total: debugStories.length, withVideo: withVideo.length, stuck: stuck.length };
  };

  function postStories(stories: unknown): void {
    if (!Array.isArray(stories) || stories.length === 0) return;
    debugStories.push(...(stories as any[])); // eslint-disable-line @typescript-eslint/no-explicit-any
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
