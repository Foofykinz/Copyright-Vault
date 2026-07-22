import type {
  ApiError,
  Client,
  ClientStats,
  CombinationFolder,
  CombinationFolderWithComputed,
  CreateClientInput,
  CreateCombinationFolderInput,
  CreateSocialAccountInput,
  CreateInfringementReportInput,
  CreateVideoInput,
  InfringementReportWithNames,
  MarkRightsManagerSentResult,
  SessionUser,
  SocialAccount,
  UpdateClientInput,
  UpdateCombinationFolderInput,
  UpdateInfringementReportInput,
  UpdateSocialAccountInput,
  UpdateVideoInput,
  VideoMetadataResult,
  VideoWithDeadline,
} from "../../shared/types";

export class ApiRequestError extends Error {
  status: number;
  details?: Record<string, string>;
  constructor(status: number, body: ApiError) {
    super(body.error);
    this.status = status;
    this.details = body.details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: "Unexpected server error." }))) as ApiError;
    throw new ApiRequestError(res.status, body);
  }
  return res.json() as Promise<T>;
}

const del = (path: string) => request<{ ok: true }>(path, { method: "DELETE" });
const post = <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) });

export const api = {
  auth: {
    login: (username: string, password: string) => post<{ user: SessionUser }>("/auth/login", { username, password }),
    logout: () => post<{ ok: true }>("/auth/logout", {}),
    session: () => request<{ user: SessionUser }>("/auth/session"),
    changePassword: (currentPassword: string, newPassword: string) =>
      post<{ ok: true }>("/auth/change-password", { currentPassword, newPassword }),
  },
  clients: {
    list: (includeArchived = false) =>
      request<{ clients: Client[] }>(`/clients${includeArchived ? "?archived=true" : ""}`),
    get: (id: string) => request<{ client: Client }>(`/clients/${id}`),
    create: (input: CreateClientInput) => post<{ client: Client }>("/clients", input),
    update: (id: string, input: UpdateClientInput) => patch<{ client: Client }>(`/clients/${id}`, input),
    remove: (id: string) => del(`/clients/${id}`),
    stats: (id: string) => request<{ stats: ClientStats }>(`/clients/${id}/stats`),
  },
  socialAccounts: {
    listForClient: (clientId: string) =>
      request<{ socialAccounts: SocialAccount[] }>(`/clients/${clientId}/social-accounts`),
    create: (clientId: string, input: CreateSocialAccountInput) =>
      post<{ socialAccount: SocialAccount }>(`/clients/${clientId}/social-accounts`, input),
    get: (id: string) => request<{ socialAccount: SocialAccount }>(`/social-accounts/${id}`),
    update: (id: string, input: UpdateSocialAccountInput) =>
      patch<{ socialAccount: SocialAccount }>(`/social-accounts/${id}`, input),
    remove: (id: string) => del(`/social-accounts/${id}`),
  },
  videos: {
    listForAccount: (socialAccountId: string) =>
      request<{ socialAccount: SocialAccount; videos: VideoWithDeadline[] }>(
        `/social-accounts/${socialAccountId}/videos`
      ),
    create: (socialAccountId: string, input: CreateVideoInput) =>
      post<{ video: VideoWithDeadline }>(`/social-accounts/${socialAccountId}/videos`, input),
    update: (id: string, input: UpdateVideoInput) => patch<{ video: VideoWithDeadline }>(`/videos/${id}`, input),
    remove: (id: string) => del(`/videos/${id}`),
  },
  metadata: {
    lookup: (url: string) => request<{ metadata: VideoMetadataResult }>(`/metadata?url=${encodeURIComponent(url)}`),
  },
  combinationFolders: {
    listForClient: (clientId: string) =>
      request<{ combinationFolders: CombinationFolderWithComputed[] }>(
        `/combination-folders?clientId=${clientId}`
      ),
    listAll: () => request<{ combinationFolders: CombinationFolderWithComputed[] }>("/combination-folders"),
    get: (id: string) =>
      request<{ combinationFolder: CombinationFolderWithComputed; videos: VideoWithDeadline[] }>(
        `/combination-folders/${id}`
      ),
    create: (input: CreateCombinationFolderInput) =>
      post<{ combinationFolder: CombinationFolderWithComputed }>("/combination-folders", input),
    update: (id: string, input: UpdateCombinationFolderInput) =>
      patch<{ combinationFolder: CombinationFolder }>(`/combination-folders/${id}`, input),
    remove: (id: string) => del(`/combination-folders/${id}`),
    addVideos: (id: string, videoIds: string[]) =>
      post<{ combinationFolder: CombinationFolderWithComputed }>(`/combination-folders/${id}/videos`, {
        videoIds,
      }),
    removeVideo: (id: string, videoId: string) =>
      request<{ combinationFolder: CombinationFolderWithComputed }>(
        `/combination-folders/${id}/videos/${videoId}`,
        { method: "DELETE" }
      ),
  },
  rightsManager: {
    markSent: (clientId: string, videoIds: string[]) =>
      post<MarkRightsManagerSentResult>("/rights-manager/mark-sent", { clientId, videoIds }),
  },
  infringementReports: {
    list: (filters?: { status?: string; clientId?: string }) => {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      if (filters?.clientId) params.set("clientId", filters.clientId);
      const qs = params.toString();
      return request<{ infringementReports: InfringementReportWithNames[] }>(
        `/infringement-reports${qs ? `?${qs}` : ""}`
      );
    },
    create: (input: CreateInfringementReportInput) =>
      post<{ infringementReport: InfringementReportWithNames }>("/infringement-reports", input),
    update: (id: string, input: UpdateInfringementReportInput) =>
      patch<{ infringementReport: InfringementReportWithNames }>(`/infringement-reports/${id}`, input),
    remove: (id: string) => del(`/infringement-reports/${id}`),
  },
};
