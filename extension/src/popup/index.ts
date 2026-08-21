import { getConfig, updateConfig } from "../lib/storage";
import { getSession, updateSession, type DateMode } from "../lib/session";
import { extensionApi } from "../lib/api";
import { ENRICH_VIEW_COUNTS_MESSAGE, SCAN_MESSAGE, type EnrichViewCountsResult, type ScanResult, type ScrapedVideo } from "../lib/scraped";
import {
  COLLECT_CURRENT_MATCH_MESSAGE,
  DETECT_RIGHTS_MANAGER_PAGE_MESSAGE,
  isRightsManagerHost,
  QUICK_CAPTURE_AND_SEND_MESSAGE,
  type CapturedMatch,
  type CollectMatchResult,
  type DetectRightsManagerPageResult,
} from "../lib/rights-manager-scraped";
import type {
  Client,
  ExtensionInfringementReportImportInput,
  ExtensionVideoImportInput,
  Platform,
  RightsManagerAccount,
  SocialAccount,
  YouTubeClassificationStatus,
} from "../../../shared/types";
import { PLATFORM_LABELS } from "../../../shared/types";
import { suggestFilename } from "../../../shared/format";
import { centralDateString } from "../../../shared/dates";

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

  // ---- Rights Manager match capture (business.facebook.com/*/rights_manager/*) ----
  // A completely separate flow from the video-import state above: one match captured, reviewed,
  // and sent at a time, rather than a multi-select scan list. See renderRightsManagerView().
  isRightsManager: boolean;
  rightsManagerAccounts: RightsManagerAccount[];
  selectedRightsManagerAccountId: string;
  capturedMatch: CapturedMatch | null;
  matchScreenshotDataUrl: string | null;
  capturingMatch: boolean;
  matchError: string | null;
  matchStatus: string | null;
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

  isRightsManager: false,
  rightsManagerAccounts: [],
  selectedRightsManagerAccountId: "",
  capturedMatch: null,
  matchScreenshotDataUrl: null,
  capturingMatch: false,
  matchError: null,
  matchStatus: null,
};

function isRightsManagerHostTab(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return isRightsManagerHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Whether the given tab is a page content/rights-manager.ts recognizes as a match-review page —
 * either interface, classic Rights Manager or the newer Content Protection. Content-based (asks
 * the content script, which inspects the live page), not URL-path-based: Content Protection has no
 * confirmed URL pattern to check against, unlike classic Rights Manager's "/rights_manager/". Only
 * messages the content script at all when the host could plausibly be one of these (any
 * facebook.com subdomain — see isRightsManagerHost), so this doesn't add a round-trip to every tab
 * on every poll tick. */
async function detectRightsManagerTab(tab: chrome.tabs.Tab | undefined): Promise<boolean> {
  if (!isRightsManagerHostTab(tab?.url) || tab?.id === undefined) return false;
  try {
    // Timeout-guarded (see sendMessageWithTimeout's comment below) for the same reason as the
    // Facebook post-scan poll -- this call sits inside facebookPollTick()'s own try/finally too,
    // so a hang here would freeze all future polling just as badly.
    const result = await sendMessageWithTimeout<DetectRightsManagerPageResult>(tab.id, { type: DETECT_RIGHTS_MANAGER_PAGE_MESSAGE });
    return result?.recognized ?? false;
  } catch {
    return false; // content script not ready yet (e.g. page still loading) — retried next poll tick
  }
}

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
    const day = centralDateString(video.publicationDate);
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

async function loadRightsManagerAccounts(): Promise<void> {
  try {
    const { rightsManagerAccounts } = await extensionApi.listRightsManagerAccounts({
      apiBaseUrl: state.apiBaseUrl,
      apiToken: state.apiToken,
    });
    state.rightsManagerAccounts = rightsManagerAccounts;
    if (!state.selectedRightsManagerAccountId && rightsManagerAccounts.length > 0) {
      state.selectedRightsManagerAccountId = rightsManagerAccounts[0].id;
    }
  } catch (err) {
    state.matchError = err instanceof Error ? err.message : "Couldn't load Rights Manager accounts.";
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
  state.isRightsManager = await detectRightsManagerTab(tab);

  if (!state.apiBaseUrl || !state.apiToken) {
    state.showSettings = true;
    render();
    return;
  }

  await loadClients();
  if (state.isRightsManager) await loadRightsManagerAccounts();
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

  // Now effectively a no-op that always resolves true -- manifest.json's host_permissions is
  // "<all_urls>" (needed for chrome.tabs.captureVisibleTab during screenshot capture, which
  // doesn't accept a scoped host permission the way chrome.scripting.executeScript does). Left in
  // place as a harmless safety net in case host_permissions is ever narrowed again.
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
  const startDate = state.dateMode === "range" ? state.rangeStart || undefined : account.lastPullAt ? centralDateString(account.lastPullAt) : undefined;
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

/** Re-reads the active tab and updates tabPlatform/tabUrl accordingly — shared by the manual scan
 * flow and the background Facebook poll so both agree on what "the current page" means. */
async function refreshActiveTabInfo(): Promise<chrome.tabs.Tab | undefined> {
  const tab = await activeTab();
  if (tab?.url !== state.tabUrl) state.mismatchAcknowledged = false;
  state.tabPlatform = detectTabPlatform(tab?.url);
  state.tabUrl = tab?.url ?? null;
  state.isRightsManager = await detectRightsManagerTab(tab);
  return tab;
}

async function scanActiveTab(): Promise<void> {
  state.status = null;
  state.error = null;

  const selectedAccount = state.socialAccounts.find((a) => a.id === state.selectedSocialAccountId);
  if (selectedAccount?.platform === "youtube") {
    await scanYouTubeAccount(selectedAccount);
    return;
  }

  const tab = await refreshActiveTabInfo();
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
      noPermalink: "video found but no link available yet",
      noDate: "video found but no date available yet",
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

/** chrome.tabs.sendMessage has no built-in timeout -- if a content script's handler for a given
 * message ever fails to call sendResponse (hangs instead of erroring, e.g. on a page shape it
 * wasn't built for), the returned promise waits forever. That's not just a failed one-off call:
 * facebookPollTick() below awaits calls like this directly inside its own try/finally, so a hang
 * here means that finally never runs either, leaving facebookPollInFlight stuck true
 * PERMANENTLY -- silently freezing all future polling (including Rights Manager page detection)
 * until the side panel is closed and reopened. Race against a timeout so a hung content script can
 * never do that again, for any reason, not just the one this was found from. */
function sendMessageWithTimeout<T>(tabId: number, message: unknown, timeoutMs = 4000): Promise<T | undefined> {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, message) as Promise<T | undefined>,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs)),
  ]);
}

/** Facebook has no Scan button — the content script accumulates videos continuously as you scroll
 * (see content/facebook.ts), and this quietly pulls whatever it's found so far into the review
 * list on a timer, the same merge scanActiveTab() does for a manual scan on every other platform,
 * just without writing a status line on every tick. Returns whether anything new was merged, so
 * the caller only re-renders (and disturbs the list/scroll position) when something actually
 * changed. */
async function pollFacebookTab(tabId: number): Promise<boolean> {
  try {
    const result = await sendMessageWithTimeout<ScanResult>(tabId, { type: SCAN_MESSAGE });
    if (!result || !Array.isArray(result.videos)) return false;

    let added = 0;
    for (const video of result.videos) {
      if (state.existingVideoUrls.has(video.videoUrl)) continue;
      if (!state.scannedVideos.has(video.key)) added += 1;
      state.scannedVideos.set(video.key, video);
      state.selectedKeys.add(video.key);
    }
    if (added > 0) persistSession();
    return added > 0;
  } catch {
    return false; // content script not ready yet (e.g. page still loading) — retried next tick
  }
}

const FACEBOOK_POLL_INTERVAL_MS = 1500;
let facebookPollInFlight = false;

async function facebookPollTick(): Promise<void> {
  // Not configured / mid-send / on the settings screen — nothing to poll into.
  if (!state.apiBaseUrl || !state.apiToken || state.showSettings || state.busy) return;
  if (facebookPollInFlight) return;
  facebookPollInFlight = true;
  try {
    const previousPlatform = state.tabPlatform;
    const previousIsRightsManager = state.isRightsManager;
    const tab = await refreshActiveTabInfo();
    let changed = state.tabPlatform !== previousPlatform || state.isRightsManager !== previousIsRightsManager;

    // Skip the post-scan poll on a page already recognized as Rights Manager -- scanning for
    // posts there is meaningless (it's a match-review page, not a profile feed) and was sending
    // SCAN_MESSAGE into content-facebook.js, a content script never built to handle this page
    // shape (confirmed live: business.facebook.com/web.facebook.com/www.facebook.com Content
    // Protection pages all satisfy state.tabPlatform === "facebook" too, since that's host-based).
    if (state.tabPlatform === "facebook" && !state.isRightsManager && tab?.id) {
      changed = (await pollFacebookTab(tab.id)) || changed;
    }
    // Side panel stays open across navigation — switching onto a Rights Manager tab without ever
    // closing it means loadRightsManagerAccounts() never ran (init() only runs once, at open).
    if (state.isRightsManager && state.rightsManagerAccounts.length === 0 && !state.capturingMatch) {
      await loadRightsManagerAccounts();
      changed = true;
    }
    if (changed) render();
  } finally {
    facebookPollInFlight = false;
  }
}

setInterval(() => void facebookPollTick(), FACEBOOK_POLL_INTERVAL_MS);

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

  // Wrapped in try/finally (wasn't before) -- state.busy is the same flag facebookPollTick() checks
  // before doing anything at all, including Rights Manager page detection. An uncaught exception
  // anywhere below (updateConfig failing, a storage quota error, anything) used to leave it stuck
  // true forever, silently freezing all future polling right alongside the sendMessage-hang bug
  // fixed above -- same symptom ("has to refresh to trigger it"), different cause.
  try {
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

    state.status =
      `Sent ${succeeded} new video${succeeded === 1 ? "" : "s"}` +
      (duplicates > 0 ? `, ${duplicates} already imported (skipped)` : "") +
      (failed > 0 ? `. ${failed} failed — still listed below, safe to retry.` : ".");
  } finally {
    state.busy = false;
    render();
  }
}

/** Ported from the old standalone tool's captureFullPage, with two bugs fixed: (1) setZoom is
 * awaited before measuring/scrolling/capturing anything, instead of racing with the very next
 * step; (2) each screenshot is placed on the canvas at the *actual* scroll position achieved (read
 * back right after scrolling), not the nominal requested offset — a page whose height isn't an
 * exact multiple of the viewport height would otherwise get a misaligned/duplicated strip at the
 * bottom. Restores whatever zoom the tab actually had beforehand, not a hardcoded 1.
 *
 * Needs the "<all_urls>" host permission, not just activeTab or a scoped host permission for this
 * one origin — two different Chrome APIs are involved with two different rules here:
 * chrome.scripting.executeScript accepts a scoped host permission (e.g. business.facebook.com/*),
 * but chrome.tabs.captureVisibleTab specifically requires either "<all_urls>" or a currently-valid
 * activeTab grant (which isn't reliable in a side panel that stays open across navigations — see
 * facebookPollTick's comment on that). A scoped host_permissions entry alone throws "Cannot access
 * contents of url..." on the executeScript calls; without "<all_urls>" specifically, captureVisibleTab
 * separately throws "Either the '<all_urls>' or 'activeTab' permission is required." See
 * manifest.json's host_permissions. */
// Reverted back to this after four rounds of trying to make normal-zoom scroll+stitch work
// reliably (crop-to-container, sticky-row pixel comparison, video pausing, locked container
// identity) -- each fixed a real, confirmed issue, but something in that pipeline was still wrong
// after all four, and by then it wasn't worth a fifth guess without more direct evidence than a
// screenshot could give. This version is simpler and was already confirmed to capture Content
// Protection's match-details page completely; the only known complaint about it is being a little
// more zoomed out than ideal, not missing/duplicated content. If the scroll+stitch approach is
// ever worth revisiting, the fix should start from confirmed CSS (position: sticky/fixed and their
// bounds via getComputedStyle), not pixel comparison -- see the console snippet offered for that.
//
// Tries zoom levels from most-readable to least and stops at the first one a page actually fits
// into in ~1 shot -- 0.25 is the last resort and is what's confirmed to fully capture Content
// Protection's page; 0.5/0.35 are tried first so a page that doesn't need to zoom out that far
// gets a more readable screenshot automatically.
const ZOOM_CANDIDATES = [0.5, 0.35, 0.25];

// Each chrome.scripting.executeScript() call below re-declares its own copy of a
// findScrollContainer() helper -- functions passed to that API must be fully self-contained (no
// closures over anything outside the function body), so it can't be shared as a normal helper the
// way everything else in this file is. Finds the element with the largest scroll overflow
// (scrollHeight - clientHeight) among anything with overflow-y: auto/scroll, falling back to the
// page's own scrolling element when nothing else overflows -- some pages (Content Protection's
// match-details view, possibly) keep their content in an independently-scrolling inner pane rather
// than scrolling the whole document, where window.scrollTo() is a no-op. Kept as a real fallback
// for whatever a single zoomed-out shot still doesn't cover, on top of the zoom-stepping below, not
// instead of it.
async function captureFullPageScreenshot(tabId: number, windowId: number): Promise<string> {
  const originalZoom = await chrome.tabs.getZoom(tabId);

  try {
    type ScreenshotDims = { width: number; height: number; windowWidth: number; windowHeight: number };
    let dims: ScreenshotDims | null = null;

    for (const candidate of ZOOM_CANDIDATES) {
      await chrome.tabs.setZoom(tabId, candidate);
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          function findScrollContainer(): Element {
            let best: Element = document.scrollingElement || document.documentElement;
            let bestOverflow = best.scrollHeight - best.clientHeight;
            for (const el of document.querySelectorAll<HTMLElement>("*")) {
              const style = getComputedStyle(el);
              if (!/(auto|scroll)/.test(style.overflowY)) continue;
              const overflow = el.scrollHeight - el.clientHeight;
              if (overflow > bestOverflow) {
                best = el;
                bestOverflow = overflow;
              }
            }
            return best;
          }
          const container = findScrollContainer();
          return {
            width: Math.max(container.scrollWidth, window.innerWidth),
            height: container.scrollHeight,
            windowWidth: window.innerWidth,
            windowHeight: window.innerHeight,
          };
        },
      });
      dims = result as ScreenshotDims;
      // Fits in essentially one shot at this zoom -- good enough, stop here rather than zoom out
      // any further than this page actually needs.
      if (dims.height <= dims.windowHeight * 1.05) break;
    }
    const { width, height, windowWidth, windowHeight } = dims!;

    const screenshots: { y: number; dataUrl: string }[] = [];
    let requestedY = 0;
    let lastCapturedY = -1;

    for (;;) {
      const [{ result: actualY }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (y: number) => {
          function findScrollContainer(): Element {
            let best: Element = document.scrollingElement || document.documentElement;
            let bestOverflow = best.scrollHeight - best.clientHeight;
            for (const el of document.querySelectorAll<HTMLElement>("*")) {
              const style = getComputedStyle(el);
              if (!/(auto|scroll)/.test(style.overflowY)) continue;
              const overflow = el.scrollHeight - el.clientHeight;
              if (overflow > bestOverflow) {
                best = el;
                bestOverflow = overflow;
              }
            }
            return best;
          }
          const container = findScrollContainer();
          container.scrollTo(0, y);
          return container.scrollTop;
        },
        args: [requestedY],
      });
      if (actualY === lastCapturedY) break; // no further scroll room — already captured this position

      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
      screenshots.push({ y: actualY as number, dataUrl });
      lastCapturedY = actualY as number;

      if ((actualY as number) + windowHeight >= height) break; // just captured the bottom
      requestedY += windowHeight;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    for (const shot of screenshots) {
      const img = new Image();
      img.src = shot.dataUrl;
      await new Promise<void>((resolve) => (img.onload = () => resolve()));
      ctx.drawImage(img, 0, shot.y, windowWidth, windowHeight);
    }
    return canvas.toDataURL("image/png");
  } finally {
    await chrome.tabs.setZoom(tabId, originalZoom);
  }
}

async function collectCurrentMatch(): Promise<void> {
  const tab = await activeTab();
  if (!tab?.id || tab.windowId === undefined) {
    state.matchError = "No active tab found.";
    render();
    return;
  }

  state.capturingMatch = true;
  state.matchError = null;
  state.matchStatus = null;
  render();

  let result: CollectMatchResult | undefined;
  try {
    result = (await chrome.tabs.sendMessage(tab.id, { type: COLLECT_CURRENT_MATCH_MESSAGE })) as CollectMatchResult | undefined;
  } catch (err) {
    // Real error text surfaced (not a fixed guess) — most likely cause is no content script on
    // this tab yet (wrong page, or extension just updated and the tab needs a refresh), but
    // showing what Chrome actually reported beats asserting that when it might not be true.
    state.matchError = `Couldn't reach the page: ${err instanceof Error ? err.message : String(err)}`;
    state.capturingMatch = false;
    render();
    return;
  }

  if (!result) {
    state.matchError = "Got an unexpected response from the page.";
  } else if (!result.ok) {
    state.matchError = result.error;
  } else {
    // Match capture succeeded — this is kept even if the screenshot step below fails, since the
    // screenshot is optional server-side and a failure there shouldn't discard a good capture.
    state.capturedMatch = result.match;
    try {
      state.matchScreenshotDataUrl = await captureFullPageScreenshot(tab.id, tab.windowId);
    } catch (err) {
      state.matchError = `Match captured, but the screenshot failed: ${err instanceof Error ? err.message : String(err)}. You can still send without one.`;
    }
  }

  state.capturingMatch = false;
  render();
}

async function sendCapturedMatch(): Promise<void> {
  const match = state.capturedMatch;
  if (!match) return;
  if (!state.selectedRightsManagerAccountId) {
    state.matchError = "Choose a Rights Manager account first.";
    render();
    return;
  }

  state.busy = true;
  state.matchError = null;
  render();

  const input: ExtensionInfringementReportImportInput = {
    clientId: state.selectedClientId || null,
    rightsManagerAccountId: state.selectedRightsManagerAccountId,
    infringerName: match.infringerName,
    infringingUrl: match.infringingUrl,
    platform: match.platform,
    postedAt: match.postedAt,
    notes: match.notes || null,
    metaMatchId: match.metaMatchId,
    metaVideoId: match.metaVideoId,
    matchDurationSec: match.matchDurationSec,
    videoViewCount: match.videoViewCount,
    pageFollowerCount: match.pageFollowerCount,
    isAccountPrivate: match.isAccountPrivate,
    infringerProfileUrl: match.infringerProfileUrl,
    referenceFiles: match.referenceFiles,
    screenshotDataUrl: state.matchScreenshotDataUrl,
    videoAvailable: match.videoAvailable,
  };

  try {
    const result = await extensionApi.importInfringementReport({ apiBaseUrl: state.apiBaseUrl, apiToken: state.apiToken }, input);
    state.matchStatus = result.duplicate ? "This match was already logged — no new record created." : "Sent.";
    state.capturedMatch = null;
    state.matchScreenshotDataUrl = null;
  } catch (err) {
    state.matchError = err instanceof Error ? err.message : "Failed to send.";
  } finally {
    state.busy = false;
    render();
  }
}

/** Triggered by the Ctrl+Shift+F keyboard shortcut (background/index.ts relays it here) —
 * captures the current match and sends it immediately, no review step. By design: this is a
 * deliberate speed-over-safety tradeoff the user asked for, not an oversight. Fields that
 * collectCurrentMatch() below the review card normally lets someone glance at before sending go
 * out exactly as scraped -- infringerName may be "Unknown", videoAvailable is always still unset.
 * Reuses collectCurrentMatch()/sendCapturedMatch() as-is rather than a separate code path, so this
 * can never drift from what manually capturing-then-sending actually does. */
async function quickCaptureAndSend(): Promise<void> {
  if (state.busy || state.capturingMatch) return; // already mid-flight — the shortcut fired twice
  if (!state.isRightsManager) {
    state.matchError = "This page isn't a recognized Rights Manager match — open a specific match's details first.";
    render();
    return;
  }
  if (!state.selectedRightsManagerAccountId) {
    state.matchError = "Choose a Rights Manager account first.";
    render();
    return;
  }
  await collectCurrentMatch();
  // Only proceed if the capture itself actually succeeded -- state.capturedMatch is set on a
  // successful result.ok capture regardless of whether the screenshot step separately failed (that
  // failure is optional and already reflected as a non-blocking matchError on its own), so this is
  // the right thing to check, not "matchError is empty".
  if (state.capturedMatch) {
    await sendCapturedMatch();
  }
}

function discardCapturedMatch(): void {
  state.capturedMatch = null;
  state.matchScreenshotDataUrl = null;
  state.matchError = null;
  state.matchStatus = null;
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

function renderMatchReviewCard(match: CapturedMatch): HTMLElement {
  const container = el("div", { className: "field" });

  const nameField = el("div", { className: "field" }, [el("label", { textContent: "Infringer name" }), el("input", { type: "text", value: match.infringerName })]);
  (nameField.querySelector("input") as HTMLInputElement).addEventListener("input", (e) => {
    match.infringerName = (e.target as HTMLInputElement).value;
  });

  // The captured link was never actually shown anywhere in this card before -- staff had no way
  // to visually confirm it was right before sending, which is very plausibly what "the link isn't
  // being captured" reports were really about even when the underlying value was fine.
  const linkField = el("div", { className: "field" }, [
    el("label", { textContent: "Infringing link" }),
    el("a", { href: match.infringingUrl, textContent: match.infringingUrl, target: "_blank", rel: "noreferrer" }),
  ]);

  const notesField = el("div", { className: "field" }, [el("label", { textContent: "Notes" }), el("textarea", { value: match.notes, rows: 3 })]);
  (notesField.querySelector("textarea") as HTMLTextAreaElement).addEventListener("input", (e) => {
    match.notes = (e.target as HTMLTextAreaElement).value;
  });

  // Nothing on the page states this directly, so it's never scraped — left for whoever's
  // reviewing the match to set, same as infringerName/notes above. Defaults to "Unknown" and stays
  // that way if left untouched; the server stores it as a nullable tri-state either way.
  const availabilityField = el("div", { className: "field" }, [
    el("label", { textContent: "Video available" }),
    el("select", {}, [
      el("option", { value: "", textContent: "Unknown", selected: match.videoAvailable === null }),
      el("option", { value: "true", textContent: "Available", selected: match.videoAvailable === true }),
      el("option", { value: "false", textContent: "Not available", selected: match.videoAvailable === false }),
    ]),
  ]);
  (availabilityField.querySelector("select") as HTMLSelectElement).addEventListener("change", (e) => {
    const value = (e.target as HTMLSelectElement).value;
    match.videoAvailable = value === "" ? null : value === "true";
  });

  const privacyNote = match.isAccountPrivate
    ? el("div", {
        className: "warning",
        textContent: "🔒 Private account — Meta withholds the infringer's identity for these, and they're usually released rather than logged. Double-check before sending.",
      })
    : null;

  const referenceLine =
    match.referenceFiles.length > 0 ? `Reference files: ${match.referenceFiles.map((f) => f.title).join(", ")}` : "Reference files: —";
  const readOnly = el("div", { className: "hint" }, [
    el("div", { textContent: `Match ID: ${match.metaMatchId}` }),
    el("div", { textContent: `Video ID: ${match.metaVideoId ?? "—"}` }),
    el("div", { textContent: `Platform: ${PLATFORM_LABELS[match.platform]}  ·  Posted: ${new Date(match.postedAt).toLocaleDateString()}` }),
    el("div", {
      textContent: `Match duration: ${match.matchDurationSec !== null ? `${match.matchDurationSec}s` : "—"}  ·  Views: ${match.videoViewCount ?? "—"}  ·  Followers: ${match.pageFollowerCount ?? "—"}`,
    }),
    el("div", { textContent: referenceLine }),
  ]);

  const screenshot = state.matchScreenshotDataUrl ? el("img", { src: state.matchScreenshotDataUrl }) : null;

  const sendBtn = el("button", { className: "primary", textContent: state.busy ? "Sending…" : "Send", disabled: state.busy });
  sendBtn.addEventListener("click", () => void sendCapturedMatch());

  const discardBtn = el("button", { textContent: "Discard", disabled: state.busy });
  discardBtn.addEventListener("click", () => discardCapturedMatch());

  container.append(nameField, linkField, notesField, availabilityField);
  if (privacyNote) container.appendChild(privacyNote);
  container.appendChild(readOnly);
  if (screenshot) container.appendChild(screenshot);
  container.append(sendBtn, discardBtn);

  return container;
}

function renderRightsManagerView(): HTMLElement {
  const container = el("div");

  container.appendChild(el("div", { className: "hint", textContent: "Detected: Rights Manager match" }));

  const accountField = el("div", { className: "field" }, [
    el("label", { textContent: "Rights Manager account" }),
    el(
      "select",
      { id: "rm-account-select" },
      state.rightsManagerAccounts.map((a) => el("option", { value: a.id, textContent: a.name, selected: a.id === state.selectedRightsManagerAccountId }))
    ),
  ]);
  const accountSelect = accountField.querySelector("select") as HTMLSelectElement;
  accountSelect.addEventListener("change", () => {
    state.selectedRightsManagerAccountId = accountSelect.value;
  });

  const clientOptions = [el("option", { value: "", textContent: "—", selected: state.selectedClientId === "" })].concat(
    state.clients.map((c) => el("option", { value: c.id, textContent: c.name, selected: c.id === state.selectedClientId }))
  );
  const clientField = el("div", { className: "field" }, [el("label", { textContent: "Client (optional)" }), el("select", { id: "rm-client-select" }, clientOptions)]);
  const clientSelect = clientField.querySelector("select") as HTMLSelectElement;
  clientSelect.addEventListener("change", () => {
    state.selectedClientId = clientSelect.value;
  });

  container.append(accountField, clientField);

  if (!state.capturedMatch) {
    const captureBtn = el("button", {
      className: "primary",
      textContent: state.capturingMatch ? "Capturing…" : "Capture this match",
      disabled: state.capturingMatch || !state.selectedRightsManagerAccountId,
    });
    captureBtn.addEventListener("click", () => void collectCurrentMatch());
    container.appendChild(captureBtn);
  } else {
    container.appendChild(renderMatchReviewCard(state.capturedMatch));
  }

  if (state.matchStatus) container.appendChild(el("div", { className: "hint", textContent: state.matchStatus }));
  if (state.matchError) container.appendChild(el("div", { className: "error", textContent: state.matchError }));

  container.appendChild(el("hr"));
  const settingsLink = el("button", { textContent: "Settings" });
  settingsLink.addEventListener("click", () => {
    state.showSettings = true;
    render();
  });
  container.appendChild(settingsLink);

  return container;
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

  const isYoutubeAccount = selectedAccount?.platform === "youtube";
  // Facebook has no Scan button — facebookPollTick() populates the list automatically as you
  // scroll (see content/facebook.ts), so a manual scan trigger would just be redundant.
  const isFacebookPage = !isYoutubeAccount && state.tabPlatform === "facebook";
  let scanBtn: HTMLButtonElement | null = null;
  if (!isFacebookPage) {
    scanBtn = el("button", { textContent: isYoutubeAccount ? "Scan channel" : "Scan this page" });
    scanBtn.addEventListener("click", () => void scanActiveTab());
  }

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
  container.append(renderDateFilterField(), el("hr"));
  if (scanBtn) {
    container.appendChild(scanBtn);
  } else if (isFacebookPage) {
    container.appendChild(
      el("div", { className: "hint", textContent: "Videos populate automatically below as you scroll this page." })
    );
  }
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
  if (state.isRightsManager) {
    appRoot.appendChild(renderRightsManagerView());
    return;
  }
  appRoot.appendChild(renderMainView());
}

// Relayed from background/index.ts's chrome.commands.onCommand listener for the Ctrl+Shift+F
// quick-capture shortcut. No sendResponse call -- background only awaits chrome.runtime.
// sendMessage() far enough to confirm a listener is present (its retry loop), not for a result.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === QUICK_CAPTURE_AND_SEND_MESSAGE) {
    void quickCaptureAndSend();
  }
});

void init();
