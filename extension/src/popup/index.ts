import { getConfig, updateConfig } from "../lib/storage";
import { extensionApi } from "../lib/api";
import { SCAN_MESSAGE, type ScanResult, type ScrapedVideo } from "../lib/scraped";
import type { Client, ExtensionVideoImportInput, Platform, SocialAccount } from "../../../shared/types";
import { PLATFORM_LABELS } from "../../../shared/types";

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
  scannedVideos: Map<string, ScrapedVideo>;
  selectedKeys: Set<string>;
  status: string | null;
  error: string | null;
  showSettings: boolean;
  busy: boolean;
}

const state: State = {
  apiBaseUrl: "",
  apiToken: "",
  clients: [],
  socialAccounts: [],
  selectedClientId: "",
  selectedSocialAccountId: "",
  tabPlatform: null,
  scannedVideos: new Map(),
  selectedKeys: new Set(),
  status: null,
  error: null,
  showSettings: false,
  busy: false,
};

function detectTabPlatform(url: string | undefined): Platform | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === "tiktok.com") return "tiktok";
    if (host === "x.com" || host === "twitter.com") return "x";
  } catch {
    return null;
  }
  return null;
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
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

async function init(): Promise<void> {
  const config = await getConfig();
  state.apiBaseUrl = config.apiBaseUrl;
  state.apiToken = config.apiToken;
  state.selectedClientId = config.lastClientId ?? "";
  state.selectedSocialAccountId = config.lastSocialAccountId ?? "";

  const tab = await activeTab();
  state.tabPlatform = detectTabPlatform(tab?.url);

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

async function scanActiveTab(): Promise<void> {
  state.status = null;
  state.error = null;
  const tab = await activeTab();
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
    for (const video of result.videos) {
      state.scannedVideos.set(video.key, video);
      state.selectedKeys.add(video.key);
    }
    state.status = `Found ${result.videos.length} video${result.videos.length === 1 ? "" : "s"} on this scan (${state.scannedVideos.size} total so far). Scroll down and scan again to pick up more.`;
  } catch {
    state.error = "Open a TikTok profile (tiktok.com/@handle) or an X profile/timeline page, then try scanning again.";
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

  const toSend = [...state.scannedVideos.values()].filter((v) => state.selectedKeys.has(v.key));
  if (toSend.length === 0) {
    state.error = "Select at least one video to send.";
    render();
    return;
  }

  state.busy = true;
  state.error = null;
  render();

  let succeeded = 0;
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
    };
    try {
      await extensionApi.importVideo({ apiBaseUrl: state.apiBaseUrl, apiToken: state.apiToken }, input);
      state.scannedVideos.delete(video.key);
      state.selectedKeys.delete(video.key);
      succeeded += 1;
    } catch {
      failed += 1;
    }
  }

  await updateConfig({ lastClientId: state.selectedClientId, lastSocialAccountId: state.selectedSocialAccountId });

  state.busy = false;
  state.status =
    `Sent ${succeeded} of ${toSend.length} video${toSend.length === 1 ? "" : "s"}.` +
    (failed > 0 ? ` ${failed} failed — still listed below, safe to retry.` : "");
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

  container.append(urlField, tokenField, hint, saveBtn);
  if (state.error) container.appendChild(el("div", { className: "error", textContent: state.error }));
  return container;
}

function renderVideoRow(video: ScrapedVideo): HTMLElement {
  const checkbox = el("input", { type: "checkbox", checked: state.selectedKeys.has(video.key) });
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) state.selectedKeys.add(video.key);
    else state.selectedKeys.delete(video.key);
  });

  const meta = el("div", { className: "meta" }, [
    el("div", { className: "caption", textContent: video.caption || "(no caption)" }),
    el("div", {
      className: "sub",
      textContent: `${new Date(video.publicationDate).toLocaleDateString()} · ${video.viewCount !== null ? `${video.viewCount.toLocaleString()} views` : "views unknown"}`,
    }),
  ]);

  return el("div", { className: "video-row" }, [checkbox, meta]);
}

function renderMainView(): HTMLElement {
  const container = el("div");

  if (state.tabPlatform === "tiktok" || state.tabPlatform === "x") {
    container.appendChild(el("div", { className: "hint", textContent: `Detected platform: ${PLATFORM_LABELS[state.tabPlatform]}` }));
  } else {
    container.appendChild(
      el("div", { className: "hint", textContent: "Navigate to a TikTok or X profile to scan for videos." })
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
    void loadSocialAccounts().then(render);
  });

  const filteredAccounts = state.tabPlatform
    ? state.socialAccounts.filter((a) => a.platform === state.tabPlatform)
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
    state.selectedSocialAccountId = accountSelect.value;
  });
  if (accountsToShow.length > 0 && !accountsToShow.some((a) => a.id === state.selectedSocialAccountId)) {
    state.selectedSocialAccountId = accountsToShow[0].id;
  }

  const scanBtn = el("button", { textContent: "Scan this page" });
  scanBtn.addEventListener("click", () => void scanActiveTab());

  const videos = [...state.scannedVideos.values()];
  const videoList = el(
    "div",
    { className: "video-list" },
    videos.length > 0 ? videos.map(renderVideoRow) : [el("div", { className: "hint", textContent: "No videos scanned yet." })]
  );

  const sendBtn = el("button", {
    className: "primary",
    textContent: state.busy ? "Sending…" : `Send ${state.selectedKeys.size} selected`,
    disabled: state.busy || state.selectedKeys.size === 0 || !state.selectedSocialAccountId,
  });
  sendBtn.addEventListener("click", () => void sendSelected());

  const settingsLink = el("button", { textContent: "Settings" });
  settingsLink.addEventListener("click", () => {
    state.showSettings = true;
    render();
  });

  container.append(clientField, accountField, el("hr"), scanBtn, videoList, sendBtn);

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
