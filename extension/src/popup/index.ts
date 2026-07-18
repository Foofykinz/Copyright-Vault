import { getConfig, updateConfig } from "../lib/storage";
import { getSession, updateSession, type DateMode } from "../lib/session";
import { extensionApi } from "../lib/api";
import { ENRICH_VIEW_COUNTS_MESSAGE, SCAN_MESSAGE, type EnrichViewCountsResult, type ScanResult, type ScrapedVideo } from "../lib/scraped";
import type { Client, ExtensionVideoImportInput, Platform, SocialAccount, YouTubeClassificationStatus } from "../../../shared/types";
import { PLATFORM_LABELS } from "../../../shared/types";
import { suggestFilename } from "../../../shared/format";

const YOUTUBE_CATEGORY_LABELS: Record<"short" | "live" | "upload", string> = {
  short: "SHORTS",
  live: "LIVES",
  upload: "REGULAR UPLOADS",
};

// Every non-"complete" status must read as a caveat, never as "Complete" — videos stay selectable
// and importable in all three cases; this only affects how the split is described, not what's usable.
const YOUTUBE_CLASSIFICATION_LABELS: Record<YouTubeClassificationStatus, string> = {
  complete: "Complete",
  incomplete_older_shorts: "Older Shorts may appear under Regular Uploads",
  shorts_lookup_failed: "Shorts lookup failed; some Shorts may appear under Regular Uploads",
};

const app = document.getElementById("app");
if (!app) throw new Error("Popup root element not found.");
const appRoot: HTMLElement = app;

interface State {
  apiBaseUrl: string;
  apiToken: string;
  clients: Client[];
  socialAccounts: SocialAccount[];
  selectedClientId: string;
  selectedSocialAccountId: string;
  tabPlatform: Platform | null;
  tabUrl: string | null;
  mismatchAcknowledged: boolean;
  scannedVideos: Map<string, ScrapedVideo>;
  selectedKeys: Set<string>;
  expandedKeys: Set<string>;
  existingVideoUrls: Set<string>;
  dateMode: DateMode;
  rangeStart: string;
  rangeEnd: string;
  status: string | null;
  error: string | null;
  showSettings: boolean;
  busy: boolean;
  /** Set only after a YouTube scan; drives the compact scan summary. Null for every other platform. */
  youtubeScan: { channelTitle: string; classificationStatus: YouTubeClassificationStatus } | null;
}

const state: State = {
  apiBaseUrl: "",
  apiToken: "",
  clients: [],
  socialAccounts: [],
  selectedClientId: "",
  selectedSocialAccountId: "",
  tabPlatform: null,
  tabUrl: null,
  mismatchAcknowledged: false,
  scannedVideos: new Map(),
  selectedKeys: new Set(),
  expandedKeys: new Set(),
  existingVideoUrls: new Set(),
  dateMode: "sincePull",
  rangeStart: "",
  rangeEnd: "",
  status: null,
  error: null,
  showSettings: false,
  busy: false,
  youtubeScan: null,
};

function detectTabPlatform(url: string | undefined): Platform | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === "tiktok.com") return "tiktok";
    if (host === "x.com" || host === "twitter.com") return "x";
    if (host === "facebook.com") return "facebook";
    if (host === "instagram.com") return "instagram";
  } catch {
    return null;
  }
  return null;
}

/** Normalizes a profile-ish URL to "host/first-path-segment" (lowercase) so two URLs pointing at
 * the same profile can be compared even if they differ in scheme, trailing slashes, or subpages
 * (e.g. facebook.com/reedtimmerwx vs facebook.com/reedtimmerwx/videos). */
function profileKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const firstSegment = parsed.pathname.split("/").filter(Boolean)[0];
    return firstSegment ? `${host}/${firstSegment.toLowerCase()}` : host;
  } catch {
    return null;
  }
}

/** True only when both URLs resolve to a comparable key and those keys actually differ — i.e. we
 * have enough information to say "this looks wrong", not just "we couldn't tell". */
function profileLooksMismatched(accountProfileUrl: string | null, tabUrl: string | null): boolean {
  const accountKey = profileKey(accountProfileUrl);
  const tabKey = profileKey(tabUrl);
  return accountKey !== null && tabKey !== null && accountKey !== tabKey;
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isWithinDateFilter(video: ScrapedVideo): boolean {
  if (state.dateMode === "range") {
    if (!state.rangeStart || !state.rangeEnd) return true; // incomplete range: don't hide anything yet
    const day = video.publicationDate.slice(0, 10);
    return day >= state.rangeStart && day <= state.rangeEnd;
  }
  const account = state.socialAccounts.find((a) => a.id === state.selectedSocialAccountId);
  if (!account?.lastPullAt) return true;
  return video.publicationDate > account.lastPullAt;
}

function visibleVideos(): ScrapedVideo[] {
  return [...state.scannedVideos.values()].filter(isWithinDateFilter).sort((a, b) => b.publicationDate.localeCompare(a.publicationDate));
}

async function loadExistingVideoUrls(): Promise<void> {
  if (!state.selectedSocialAccountId) {
    state.existingVideoUrls = new Set();
    return;
  }
  try {
    const { videos } = await extensionApi.listVideosForAccount(
      { apiBaseUrl: state.apiBaseUrl, apiToken: state.apiToken },
      state.selectedSocialAccountId
    );
    state.existingVideoUrls = new Set(videos.map((v) => v.videoUrl));
  } catch {
    // Non-fatal — dedup still gets enforced server-side on send either way.
    state.existingVideoUrls = new Set();
  }
}

async function loadSocialAccounts(): Promise<void> {
  try {
    const { socialAccounts } = await extensionApi.listSocialAccounts(
      { apiBaseUrl: state.apiBaseUrl, apiToken: state.apiToken },
      state.selectedClientId
    );
    state.socialAccounts = socialAccounts;
    const stillValid = socialAccounts.some((a) => a.id === state.selectedSocialAccountId);
    if (!stillValid) {
      const matching = state.tabPlatform ? socialAccounts.find((a) => a.platform === state.tabPlatform) : undefined;
      state.selectedSocialAccountId = matching?.id ?? socialAccounts[0]?.id ?? "";
    }
    await loadExistingVideoUrls();
  } catch (err) {
    state.error = err instanceof Error ? err.message : "Couldn't load social accounts.";
  }
}

async function loadClients(): Promise<void> {
  try {
    const { clients } = await extensionApi.listClients({ apiBaseUrl: state.apiBaseUrl, apiToken: state.apiToken });
    state.clients = clients;
    state.error = null;
    if (!state.selectedClientId && clients.length > 0) state.selectedClientId = clients[0].id;
    if (state.selectedClientId) await loadSocialAccounts();
  } catch (err) {
    state.error = err instanceof Error ? err.message : "Couldn't reach Viral DRM. Check your settings below.";
    state.showSettings = true;
  }
}

function persistSession(): void {
  void updateSession({
    selectedClientId: state.selectedClientId,
    selectedSocialAccountId: state.selectedSocialAccountId,
    scannedVideos: [...state.scannedVideos.values()],
    selectedKeys: [...state.selectedKeys],
    dateMode: state.dateMode,
    rangeStart: state.rangeStart,
    rangeEnd: state.rangeEnd,
    youtubeChannelTitle: state.youtubeScan?.channelTitle ?? null,
    youtubeClassificationStatus: state.youtubeScan?.classificationStatus ?? null,
  });
}

/** Drops any in-progress scan results/selection — used whenever the selected social account
 * changes, so results scanned for one client/account can never remain attached to another after
 * switching. (YouTube scanning is account-driven rather than tab-driven, so nothing else would
 * otherwise clear this the way a tab navigation does for the other platforms.) */
function clearScanState(): void {
  state.scannedVideos.clear();
  state.selectedKeys.clear();
  state.expandedKeys.clear();
  state.youtubeScan = null;
  state.status = null;
}

async function init(): Promise<void> {
  const config = await getConfig();
  const session = await getSession();
  state.apiBaseUrl = config.apiBaseUrl;
  state.apiToken = config.apiToken;
  state.selectedClientId = session.selectedClientId || config.lastClientId || "";
  state.selectedSocialAccountId = session.selectedSocialAccountId || config.lastSocialAccountId || "";
  state.scannedVideos = new Map(session.scannedVideos.map((v) => [v.key, v]));
  state.selectedKeys = new Set(session.selectedKeys);
  state.dateMode = session.dateMode;
  state.rangeStart = session.rangeStart;
  state.rangeEnd = session.rangeEnd;
  state.youtubeScan = session.youtubeChannelTitle
    ? { channelTitle: session.youtubeChannelTitle, classificationStatus: session.youtubeClassificationStatus ?? "complete" }
    : null;

  const tab = await activeTab();
  state.tabPlatform = detectTabPlatform(tab?.url);
  state.tabUrl = tab?.url ?? null;

  if (!state.apiBaseUrl || !state.apiToken) {
    state.showSettings = true;
    render();
    return;
  }

  await loadClients();
  render();
}

async function saveSettings(apiBaseUrl: string, apiToken: string): Promise<void> {
  let origin: string;
  try {
    origin = new URL(apiBaseUrl).origin;
  } catch {
    state.error = "Enter a valid API base URL, e.g. https://viral-drm.yourname.workers.dev";
    render();
    return;
  }

  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) {
    state.error = "Permission to reach that URL wasn't granted, so the extension can't call the API.";
    render();
    return;
  }

  state.apiBaseUrl = apiBaseUrl.replace(/\/$/, "");
  state.apiToken = apiToken;
  await updateConfig({ apiBaseUrl: state.apiBaseUrl, apiToken: state.apiToken });
  state.showSettings = false;
  state.error = null;
  await loadClients();
  render();
}

/** Only Instagram's scan is missing view counts (its profile-timeline query doesn't carry them) —
 * fetching them is a separate per-video request, so it's done as a follow-up here rather than as
 * part of scan() itself. Scoped to the date-filtered (visible) set, not everything ever scanned,
 * so switching to a narrower date range doesn't pay for counts on videos that won't be sent. */
async function enrichInstagramViewCounts(tabId: number): Promise<void> {
  const keys = visibleVideos()
    .filter((v) => v.viewCount === null)
    .map((v) => v.key);
  if (keys.length === 0) return;
  try {
    const counts = (await chrome.tabs.sendMessage(tabId, { type: ENRICH_VIEW_COUNTS_MESSAGE, keys })) as
      | EnrichViewCountsResult
      | undefined;
    if (!counts) return;
    for (const [key, count] of Object.entries(counts)) {
      if (count === null) continue;
      const video = state.scannedVideos.get(key);
      if (video) state.scannedVideos.set(key, { ...video, viewCount: count });
    }
    persistSession();
  } catch {
    // Non-fatal — counts stay null and the video is still importable, just without a count.
  }
}

/** YouTube has no page for a content script to scrape — retrieval is entirely server-side via the
 * official Data API, so unlike every other platform this scan is driven by the selected client +
 * social account rather than whatever tab happens to be active. */
async function scanYouTubeAccount(account: SocialAccount): Promise<void> {
  const startDate = state.dateMode === "range" ? state.rangeStart || undefined : account.lastPullAt ? account.lastPullAt.slice(0, 10) : undefined;
  const endDate = state.dateMode === "range" ? state.rangeEnd || undefined : undefined;

  try {
    const response = await extensionApi.scanYouTubeChannel(
      { apiBaseUrl: state.apiBaseUrl, apiToken: state.apiToken },
      {
        clientId: account.clientId,
        accountId: account.id,
        channelUrl: account.profileUrl ?? undefined,
        startDate,
        endDate,
      }
    );

    let added = 0;
    let skippedDuplicates = 0;
    for (const v of response.videos) {
      const key = `youtube:${v.videoId}`;
      if (state.existingVideoUrls.has(v.videoUrl)) {
        skippedDuplicates += 1;
        continue;
      }
      if (!state.scannedVideos.has(key)) added += 1;
      state.scannedVideos.set(key, {
        key,
        videoUrl: v.videoUrl,
        publicationDate: v.publicationDate,
        caption: v.caption,
        viewCount: v.viewCount,
        title: v.title,
        thumbnailUrl: v.thumbnailUrl,
        youtubeCategory: v.category,
        channelTitle: v.channelTitle,
        channelId: v.channelId,
        channelUrl: v.channelUrl,
        durationSeconds: v.durationSeconds,
        liveStatus: v.liveStatus,
        scheduledStartTime: v.scheduledStartTime,
        actualStartTime: v.actualStartTime,
        actualEndTime: v.actualEndTime,
        concurrentViewers: v.concurrentViewers,
      });
      state.selectedKeys.add(key);
    }

    state.youtubeScan = { channelTitle: response.channel.title, classificationStatus: response.classificationStatus };
    persistSession();

    const visibleCount = visibleVideos().length;
    state.status =
      `Scan found ${response.videos.length} video${response.videos.length === 1 ? "" : "s"} ` +
      `(${response.counts.shorts} Shorts, ${response.counts.lives} Lives, ${response.counts.uploads} regular uploads)` +
      (skippedDuplicates > 0 ? `, ${skippedDuplicates} already imported (skipped)` : "") +
      `. ${added} new this scan; ${visibleCount} shown under the current date filter.`;
  } catch (err) {
    state.error = err instanceof Error ? err.message : "YouTube scan failed.";
  }
  render();
}

async function scanActiveTab(): Promise<void> {
  state.status = null;
  state.error = null;

  const selectedAccount = state.socialAccounts.find((a) => a.id === state.selectedSocialAccountId);
  if (selectedAccount?.platform === "youtube") {
    await scanYouTubeAccount(selectedAccount);
    return;
  }

  const tab = await activeTab();
  state.tabPlatform = detectTabPlatform(tab?.url);
  if (tab?.url !== state.tabUrl) state.mismatchAcknowledged = false;
  state.tabUrl = tab?.url ?? null;
  if (!tab?.id) {
    state.error = "No active tab found.";
    render();
    return;
  }
  try {
    const result = (await chrome.tabs.sendMessage(tab.id, { type: SCAN_MESSAGE })) as ScanResult | undefined;
    if (!result || !Array.isArray(result.videos)) {
      state.error = "Got an unexpected response from the page.";
      render();
      return;
    }

    let added = 0;
    let skippedDuplicates = 0;
    for (const video of result.videos) {
      if (state.existingVideoUrls.has(video.videoUrl)) {
        skippedDuplicates += 1;
        continue;
      }
      if (!state.scannedVideos.has(video.key)) added += 1;
      state.scannedVideos.set(video.key, video);
      state.selectedKeys.add(video.key);
    }
    persistSession();

    const visibleCount = visibleVideos().length;
    const hiddenByFilter = state.scannedVideos.size - visibleCount;
    const candidateNote =
      result.totalCandidates !== undefined ? ` (${result.totalCandidates} post${result.totalCandidates === 1 ? "" : "s"} seen on page)` : "";

    const exclusionLabels: Record<string, string> = {
      share: "shares/reposts",
      missingIds: "missing post ID or date",
      noVideoFound: "no video (photo/text post)",
      noUrlOrId: "video found but no link or ID available",
      nestedQuote: "nested quote-tweet embeds",
      repost: "reposts",
      noVideo: "no video (photo/text post)",
      noStatusLink: "video found but link/date couldn't be matched",
      authorMismatch: "video belongs to a different account",
      notAuthor: "posted by neither the profile nor a listed coauthor",
    };
    const exclusionParts = Object.entries(result.exclusionCounts ?? {})
      .filter(([, count]) => count > 0)
      .map(([reason, count]) => `${count} ${exclusionLabels[reason] ?? reason}`);
    const exclusionNote = exclusionParts.length > 0 ? ` Excluded: ${exclusionParts.join(", ")}.` : "";

    state.status =
      `Scan found ${result.videos.length} video${result.videos.length === 1 ? "" : "s"}${candidateNote}` +
      (skippedDuplicates > 0 ? `, ${skippedDuplicates} already imported (skipped)` : "") +
      `. ${added} new this scan; ${visibleCount} shown under the current date filter.` +
      (hiddenByFilter > 0
        ? ` ${hiddenByFilter} captured video${hiddenByFilter === 1 ? " is" : "s are"} hidden by the date filter — switch to Custom date range to see ${hiddenByFilter === 1 ? "it" : "them"}.`
        : " Scroll down and scan again for more.") +
      exclusionNote;

    if (state.tabPlatform === "instagram") {
      await enrichInstagramViewCounts(tab.id);
    }
  } catch {
    state.error = "Open a TikTok, X, Facebook, or Instagram profile page, then try scanning again.";
  }
  render();
}

async function sendSelected(): Promise<void> {
  const account = state.socialAccounts.find((a) => a.id === state.selectedSocialAccountId);
  if (!account) {
    state.error = "Choose a social account first.";
    render();
    return;
  }

  // Hard block, no override: the account dropdown can end up pointing at any platform regardless
  // of which page was actually scanned (nothing keeps it in sync once a value is selected), and
  // platform/socialAccountId sent to the server come entirely from this selection, never from the
  // scan result itself. A platform-type mismatch here is never correct, unlike the softer
  // client-mismatch check below which allows a deliberate override.
  // Both checks are tab-URL-based and don't apply to YouTube, which is scanned by account, not by
  // whatever tab happens to be active.
  if (account.platform !== "youtube" && state.tabPlatform && account.platform !== state.tabPlatform) {
    state.error = `Selected account is ${PLATFORM_LABELS[account.platform]}, but this page is ${PLATFORM_LABELS[state.tabPlatform]}. Choose an account of the matching platform before sending.`;
    render();
    return;
  }

  if (account.platform !== "youtube" && profileLooksMismatched(account.profileUrl, state.tabUrl) && !state.mismatchAcknowledged) {
    state.error = "This page doesn't look like it matches the selected social account. Check the box above to confirm before sending.";
    render();
    return;
  }

  const toSend = visibleVideos().filter((v) => state.selectedKeys.has(v.key));
  if (toSend.length === 0) {
    state.error = "Select at least one video to send.";
    render();
    return;
  }

  state.busy = true;
  state.error = null;
  render();

  let succeeded = 0;
  let duplicates = 0;
  let failed = 0;

  for (const video of toSend) {
    const input: ExtensionVideoImportInput = {
      clientId: account.clientId,
      socialAccountId: account.id,
      platform: account.platform,
      videoUrl: video.videoUrl,
      publicationDate: video.publicationDate,
      caption: video.caption || null,
      viewCount: video.viewCount ?? undefined,
      thumbnailUrl: video.thumbnailUrl ?? undefined,
      youtubeCategory: video.youtubeCategory,
    };
    try {
      const result = await extensionApi.importVideo({ apiBaseUrl: state.apiBaseUrl, apiToken: state.apiToken }, input);
      state.scannedVideos.delete(video.key);
      state.selectedKeys.delete(video.key);
      state.existingVideoUrls.add(video.videoUrl);
      if (result.duplicate) duplicates += 1;
      else succeeded += 1;
    } catch {
      failed += 1;
    }
  }

  if (succeeded + duplicates > 0) {
    const idx = state.socialAccounts.findIndex((a) => a.id === account.id);
    if (idx >= 0) state.socialAccounts[idx] = { ...state.socialAccounts[idx], lastPullAt: new Date().toISOString() };
  }

  await updateConfig({ lastClientId: state.selectedClientId, lastSocialAccountId: state.selectedSocialAccountId });
  persistSession();

  state.busy = false;
  state.status =
    `Sent ${succeeded} new video${succeeded === 1 ? "" : "s"}` +
    (duplicates > 0 ? `, ${duplicates} already imported (skipped)` : "") +
    (failed > 0 ? `. ${failed} failed — still listed below, safe to retry.` : ".");
  render();
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) {
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function renderSettingsView(): HTMLElement {
  const container = el("div", { className: "field" });

  const versionLine = el("div", {
    className: "hint",
    textContent: `Extension version: ${chrome.runtime.getManifest().version}`,
  });

  const urlField = el("div", { className: "field" }, [
    el("label", { textContent: "Viral DRM API base URL" }),
    el("input", { id: "settings-url", type: "text", placeholder: "https://viral-drm.yourname.workers.dev", value: state.apiBaseUrl }),
  ]);

  const tokenField = el("div", { className: "field" }, [
    el("label", { textContent: "Extension API token" }),
    el("input", { id: "settings-token", type: "password", placeholder: "Set via wrangler secret put EXTENSION_API_TOKEN", value: state.apiToken }),
  ]);

  const hint = el("div", { className: "hint" }, [
    "Find the base URL in your Cloudflare dashboard (Workers & Pages → viral-drm). The token is whatever you set with ",
    el("code", { textContent: "wrangler secret put EXTENSION_API_TOKEN" }),
    ".",
  ]);

  const saveBtn = el("button", { className: "primary", textContent: "Connect" });
  saveBtn.addEventListener("click", () => {
    const urlInput = document.getElementById("settings-url") as HTMLInputElement;
    const tokenInput = document.getElementById("settings-token") as HTMLInputElement;
    void saveSettings(urlInput.value.trim(), tokenInput.value.trim());
  });

  container.append(urlField, tokenField, hint, saveBtn, versionLine);
  if (state.error) container.appendChild(el("div", { className: "error", textContent: state.error }));
  return container;
}

function renderVideoRow(video: ScrapedVideo): HTMLElement {
  const checkbox = el("input", { type: "checkbox", checked: state.selectedKeys.has(video.key) });
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) state.selectedKeys.add(video.key);
    else state.selectedKeys.delete(video.key);
    persistSession();
  });

  const expanded = state.expandedKeys.has(video.key);
  const primaryText = video.title || video.caption || "(no caption)";
  const caption = el("div", {
    className: `caption${expanded ? " expanded" : ""}`,
    textContent: primaryText,
    title: expanded ? "Click to collapse" : "Click to show full caption",
  });
  caption.addEventListener("click", () => {
    if (state.expandedKeys.has(video.key)) state.expandedKeys.delete(video.key);
    else state.expandedKeys.add(video.key);
    render();
  });

  const metaChildren: (Node | string)[] = [
    el("div", {
      className: "sub",
      textContent: `${new Date(video.publicationDate).toLocaleDateString()} · ${video.viewCount !== null ? `${video.viewCount.toLocaleString()} views` : "views unknown"}`,
    }),
    caption,
  ];
  if (video.youtubeCategory) {
    // Built from video.publicationDate as returned by the API — never a reconstructed/reformatted
    // date — via suggestFilename's own .slice(0, 10), same as the date-filter comparisons.
    const clientName = state.clients.find((c) => c.id === state.selectedClientId)?.name ?? "";
    const filename = suggestFilename(clientName, video.publicationDate, video.title || video.caption || "");
    metaChildren.push(el("div", { className: "hint", textContent: `Suggested filename: ${filename}` }));
  }
  const meta = el("div", { className: "meta" }, metaChildren);

  return el("div", { className: "video-row" }, [checkbox, meta]);
}

function renderDateFilterField(): HTMLElement {
  const account = state.socialAccounts.find((a) => a.id === state.selectedSocialAccountId);

  const modeSelect = el("select", { id: "date-mode-select" }, [
    el("option", { value: "sincePull", textContent: "Since last pull", selected: state.dateMode === "sincePull" }),
    el("option", { value: "range", textContent: "Custom date range", selected: state.dateMode === "range" }),
  ]);
  modeSelect.addEventListener("change", () => {
    state.dateMode = modeSelect.value as DateMode;
    persistSession();
    render();
  });

  const children: (Node | string)[] = [el("label", { textContent: "Pull videos published…" }), modeSelect];

  if (state.dateMode === "sincePull") {
    children.push(
      el("div", {
        className: "hint",
        textContent: account?.lastPullAt
          ? `Since ${new Date(account.lastPullAt).toLocaleString()}`
          : "This account has never been pulled — everything scanned will be included.",
      })
    );
  } else {
    const startInput = el("input", { type: "date", value: state.rangeStart });
    startInput.addEventListener("change", () => {
      state.rangeStart = startInput.value;
      persistSession();
      render();
    });
    const endInput = el("input", { type: "date", value: state.rangeEnd });
    endInput.addEventListener("change", () => {
      state.rangeEnd = endInput.value;
      persistSession();
      render();
    });
    children.push(el("div", { className: "field-row-inline" }, [startInput, endInput]));
    if (!state.rangeStart || !state.rangeEnd) {
      children.push(el("div", { className: "hint", textContent: "Set both dates to filter — until then, nothing is hidden." }));
    }
  }

  return el("div", { className: "field" }, children);
}

/** Flat list for every existing platform (unchanged from before) — only videos carrying a
 * youtubeCategory get split into the three labeled, counted, select-all-able groups. */
function renderVideoList(visible: ScrapedVideo[], totalCaptured: number): HTMLElement {
  const hasYoutubeCategories = visible.some((v) => v.youtubeCategory);
  if (!hasYoutubeCategories) {
    return el(
      "div",
      { className: "video-list" },
      visible.length > 0
        ? visible.map(renderVideoRow)
        : [
            el("div", {
              className: "hint",
              textContent: totalCaptured > 0 ? "No scanned videos match the current date filter." : "No videos scanned yet.",
            }),
          ]
    );
  }

  const groups: { category: "short" | "live" | "upload"; videos: ScrapedVideo[] }[] = [
    { category: "short", videos: visible.filter((v) => v.youtubeCategory === "short") },
    { category: "live", videos: visible.filter((v) => v.youtubeCategory === "live") },
    { category: "upload", videos: visible.filter((v) => v.youtubeCategory !== "short" && v.youtubeCategory !== "live") },
  ];

  const container = el("div", { className: "video-list" });
  for (const group of groups) {
    if (group.videos.length === 0) continue;

    const allSelected = group.videos.every((v) => state.selectedKeys.has(v.key));
    const selectAll = el("input", { type: "checkbox", checked: allSelected, title: "Select all in this group" });
    selectAll.addEventListener("change", () => {
      for (const v of group.videos) {
        if (selectAll.checked) state.selectedKeys.add(v.key);
        else state.selectedKeys.delete(v.key);
      }
      persistSession();
      render();
    });

    const header = el("div", { className: "video-group-header flex-row" }, [
      selectAll,
      el("strong", { textContent: YOUTUBE_CATEGORY_LABELS[group.category] }),
      el("span", { className: "hint", textContent: `(${group.videos.length})` }),
    ]);

    container.append(header, ...group.videos.map(renderVideoRow));
  }
  return container;
}

function renderYoutubeSummary(visible: ScrapedVideo[]): HTMLElement | null {
  if (!state.youtubeScan) return null;

  const shorts = visible.filter((v) => v.youtubeCategory === "short").length;
  const lives = visible.filter((v) => v.youtubeCategory === "live").length;
  const uploads = visible.filter((v) => v.youtubeCategory === "upload").length;
  const rangeLabel =
    state.dateMode === "range"
      ? state.rangeStart && state.rangeEnd
        ? `${state.rangeStart} to ${state.rangeEnd}`
        : "custom range (incomplete)"
      : "since last pull";

  return el("div", { className: "hint youtube-summary" }, [
    el("div", { textContent: `Channel: ${state.youtubeScan.channelTitle}` }),
    el("div", { textContent: `Date range: ${rangeLabel}` }),
    el("div", { textContent: `Total: ${visible.length}  ·  Shorts: ${shorts}  ·  Lives: ${lives}  ·  Regular uploads: ${uploads}` }),
    el("div", { textContent: `Classification: ${YOUTUBE_CLASSIFICATION_LABELS[state.youtubeScan.classificationStatus]}` }),
  ]);
}

function renderMainView(): HTMLElement {
  const container = el("div");

  if (
    state.tabPlatform === "tiktok" ||
    state.tabPlatform === "x" ||
    state.tabPlatform === "facebook" ||
    state.tabPlatform === "instagram"
  ) {
    container.appendChild(el("div", { className: "hint", textContent: `Detected platform: ${PLATFORM_LABELS[state.tabPlatform]}` }));
  } else {
    container.appendChild(
      el("div", {
        className: "hint",
        textContent:
          "Navigate to a TikTok, X, Facebook, or Instagram profile to scan for videos — or select a YouTube channel below (no page needed).",
      })
    );
  }

  const clientField = el("div", { className: "field" }, [
    el("label", { textContent: "Client" }),
    el(
      "select",
      { id: "client-select" },
      state.clients.map((c) => el("option", { value: c.id, textContent: c.name, selected: c.id === state.selectedClientId }))
    ),
  ]);
  const clientSelect = clientField.querySelector("select") as HTMLSelectElement;
  clientSelect.addEventListener("change", () => {
    state.selectedClientId = clientSelect.value;
    state.selectedSocialAccountId = "";
    state.mismatchAcknowledged = false;
    clearScanState();
    persistSession();
    void loadSocialAccounts().then(() => {
      persistSession();
      render();
    });
  });

  // YouTube accounts are always shown alongside whatever matches the active tab — scanning them
  // never depends on which tab is focused, so they shouldn't be hidden just because an unrelated
  // (or no) tab-matched platform happens to be active.
  const filteredAccounts = state.tabPlatform
    ? state.socialAccounts.filter((a) => a.platform === state.tabPlatform || a.platform === "youtube")
    : state.socialAccounts;
  const accountsToShow = filteredAccounts.length > 0 ? filteredAccounts : state.socialAccounts;

  const accountField = el("div", { className: "field" }, [
    el("label", { textContent: "Social account" }),
    el(
      "select",
      { id: "account-select" },
      accountsToShow.map((a) =>
        el("option", {
          value: a.id,
          textContent: `${a.accountName} (${PLATFORM_LABELS[a.platform]})`,
          selected: a.id === state.selectedSocialAccountId,
        })
      )
    ),
  ]);
  const accountSelect = accountField.querySelector("select") as HTMLSelectElement;
  accountSelect.addEventListener("change", () => {
    if (accountSelect.value !== state.selectedSocialAccountId) clearScanState();
    state.selectedSocialAccountId = accountSelect.value;
    state.mismatchAcknowledged = false;
    persistSession();
    void loadExistingVideoUrls().then(() => {
      persistSession();
      render();
    });
  });
  if (accountsToShow.length > 0 && !accountsToShow.some((a) => a.id === state.selectedSocialAccountId)) {
    state.selectedSocialAccountId = accountsToShow[0].id;
  }

  const selectedAccount = state.socialAccounts.find((a) => a.id === state.selectedSocialAccountId) ?? null;
  // Tab-vs-account matching is meaningless for YouTube — it's scanned by account, not by page.
  const platformMismatch = Boolean(
    selectedAccount && selectedAccount.platform !== "youtube" && state.tabPlatform && selectedAccount.platform !== state.tabPlatform
  );
  const platformMismatchWarning = platformMismatch
    ? el("div", {
        className: "error",
        textContent: `Selected account is ${PLATFORM_LABELS[selectedAccount!.platform]}, but this page is ${state.tabPlatform ? PLATFORM_LABELS[state.tabPlatform] : "unknown"} — choose a matching account to send.`,
      })
    : null;
  const mismatchWarning =
    selectedAccount && selectedAccount.platform !== "youtube" && profileLooksMismatched(selectedAccount.profileUrl, state.tabUrl)
      ? (() => {
          const checkbox = el("input", { type: "checkbox", checked: state.mismatchAcknowledged });
          checkbox.addEventListener("change", () => {
            state.mismatchAcknowledged = checkbox.checked;
          });
          const label = el("label", { className: "flex-row" }, [
            checkbox,
            ` This page doesn't look like it matches ${selectedAccount.accountName}'s profile URL — confirm this is the right account before sending.`,
          ]);
          return el("div", { className: "error" }, [label]);
        })()
      : null;

  const scanBtn = el("button", { textContent: selectedAccount?.platform === "youtube" ? "Scan channel" : "Scan this page" });
  scanBtn.addEventListener("click", () => void scanActiveTab());

  const visible = visibleVideos();
  const totalCaptured = state.scannedVideos.size;
  const videoList = renderVideoList(visible, totalCaptured);
  const youtubeSummary = renderYoutubeSummary(visible);

  const sendableCount = visible.filter((v) => state.selectedKeys.has(v.key)).length;
  const blockedByMismatch = mismatchWarning !== null && !state.mismatchAcknowledged;
  const sendBtn = el("button", {
    className: "primary",
    textContent: state.busy ? "Sending…" : `Send ${sendableCount} selected`,
    disabled: state.busy || sendableCount === 0 || !state.selectedSocialAccountId || blockedByMismatch || platformMismatch,
  });
  sendBtn.addEventListener("click", () => void sendSelected());

  const settingsLink = el("button", { textContent: "Settings" });
  settingsLink.addEventListener("click", () => {
    state.showSettings = true;
    render();
  });

  container.append(clientField, accountField);
  if (platformMismatchWarning) container.appendChild(platformMismatchWarning);
  if (mismatchWarning) container.appendChild(mismatchWarning);
  container.append(renderDateFilterField(), el("hr"), scanBtn);
  if (youtubeSummary) container.appendChild(youtubeSummary);
  container.append(videoList, sendBtn);

  if (state.status) container.appendChild(el("div", { className: "hint", textContent: state.status }));
  if (state.error) container.appendChild(el("div", { className: "error", textContent: state.error }));

  container.appendChild(el("hr"));
  container.appendChild(settingsLink);

  return container;
}

function render(): void {
  appRoot.innerHTML = "";
  if (state.showSettings || !state.apiBaseUrl || !state.apiToken) {
    appRoot.appendChild(renderSettingsView());
    return;
  }
  appRoot.appendChild(renderMainView());
}

void init();
