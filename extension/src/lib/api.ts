import type {
  Client,
  ExtensionDataPullInput,
  ExtensionDataPullResult,
  ExtensionInfringementReportExistsResult,
  ExtensionInfringementReportImportInput,
  ExtensionInfringementReportImportResult,
  ExtensionVideoImportInput,
  ExtensionVideoImportResult,
  RightsManagerAccount,
  SocialAccount,
  VideoWithDeadline,
  VimeoChannelVideosRequest,
  VimeoChannelVideosResponse,
  YouTubeChannelVideosRequest,
  YouTubeChannelVideosResponse,
} from "../../../shared/types";
import type { ExtensionConfig } from "./storage";

/** Carries the HTTP status so callers can tell an auth failure (401/403 -- e.g. a wrong or rotated
 * extension token) apart from an ordinary bad request. Same message as before for display. */
export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

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
    throw new ApiRequestError((body && body.error) || `Request failed with status ${res.status}.`, res.status);
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
  scanYouTubeChannel: (config: ExtensionConfig, input: YouTubeChannelVideosRequest) =>
    request<YouTubeChannelVideosResponse>(config, "/api/youtube/channel-videos", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  scanVimeoChannel: (config: ExtensionConfig, input: VimeoChannelVideosRequest) =>
    request<VimeoChannelVideosResponse>(config, "/api/vimeo/channel-videos", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  listRightsManagerAccounts: (config: ExtensionConfig) =>
    request<{ rightsManagerAccounts: RightsManagerAccount[] }>(config, "/api/rights-manager-accounts"),
  importInfringementReport: (config: ExtensionConfig, input: ExtensionInfringementReportImportInput) =>
    request<ExtensionInfringementReportImportResult>(config, "/api/extension/infringement-reports", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  infringementReportExists: (config: ExtensionConfig, metaMatchId: string) =>
    request<ExtensionInfringementReportExistsResult>(config, `/api/extension/infringement-reports?metaMatchId=${encodeURIComponent(metaMatchId)}`),
  importDataPull: (config: ExtensionConfig, input: ExtensionDataPullInput) =>
    request<ExtensionDataPullResult>(config, "/api/extension/data-pulls", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
