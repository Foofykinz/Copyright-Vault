import type {
  Client,
  ExtensionVideoImportInput,
  ExtensionVideoImportResult,
  SocialAccount,
  VideoWithDeadline,
} from "../../../shared/types";
import type { ExtensionConfig } from "./storage";

async function request<T>(config: ExtensionConfig, path: string, init?: RequestInit): Promise<T> {
  const base = config.apiBaseUrl.replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(config.apiToken ? { authorization: `Bearer ${config.apiToken}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error((body && body.error) || `Request failed with status ${res.status}.`);
  }
  return res.json() as Promise<T>;
}

export const extensionApi = {
  listClients: (config: ExtensionConfig) => request<{ clients: Client[] }>(config, "/api/clients"),
  listSocialAccounts: (config: ExtensionConfig, clientId: string) =>
    request<{ socialAccounts: SocialAccount[] }>(config, `/api/clients/${clientId}/social-accounts`),
  listVideosForAccount: (config: ExtensionConfig, socialAccountId: string) =>
    request<{ socialAccount: SocialAccount; videos: VideoWithDeadline[] }>(
      config,
      `/api/social-accounts/${socialAccountId}/videos`
    ),
  importVideo: (config: ExtensionConfig, input: ExtensionVideoImportInput) =>
    request<ExtensionVideoImportResult>(config, "/api/extension/videos", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
