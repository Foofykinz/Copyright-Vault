export interface ExtensionConfig {
  apiBaseUrl: string;
  apiToken: string;
  lastClientId?: string;
  lastSocialAccountId?: string;
}

const STORAGE_KEY = "viralDrmConfig";
const EMPTY_CONFIG: ExtensionConfig = { apiBaseUrl: "", apiToken: "" };

export async function getConfig(): Promise<ExtensionConfig> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as ExtensionConfig | undefined) ?? EMPTY_CONFIG;
}

export async function updateConfig(patch: Partial<ExtensionConfig>): Promise<ExtensionConfig> {
  const current = await getConfig();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}
