import type {
  AffiliationTag,
  ApiError,
  Client,
  ClientStats,
  CreateAffiliationTagInput,
  CombinationFolder,
  CombinationFolderWithComputed,
  CreateClientInput,
  CreateCombinationFolderInput,
  CreateSocialAccountInput,
  CreateInfringementReportInput,
  CreateVideoInput,
  DashboardStats,
  DataPullListParams,
  DataPullListResult,
  DeadlineVideo,
  HuntSourceResult,
  InfringementReportListParams,
  InfringementReportListResult,
  InfringementReportWithNames,
  MarkRightsManagerSentResult,
  RightsManagerAccount,
  RightsManagerBatchWithVideos,
  CreateRightsManagerAccountInput,
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

/** Shared between infringementReports.list and .exportUrl so the export link's filters always
 * match whatever's currently on screen. */
function buildInfringementReportQuery(filters?: InfringementReportListParams | DataPullListParams): string {
  const params = new URLSearchParams();
  if (!filters) return "";
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  return params.toString();
}

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
    rightsManagerHistory: (id: string) =>
      request<{ batches: RightsManagerBatchWithVideos[] }>(`/clients/${id}/rights-manager-history`),
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
    deadlines: (status?: string) =>
      request<{ videos: DeadlineVideo[] }>(`/videos/deadlines${status ? `?status=${status}` : ""}`),
  },
  metadata: {
    lookup: (url: string) => request<{ metadata: VideoMetadataResult }>(`/metadata?url=${encodeURIComponent(url)}`),
  },
  combinationFolders: {
    listForClient: (clientId: string) =>
      request<{ combinationFolders: CombinationFolderWithComputed[] }>(
        `/combination-folders?clientId=${clientId}`
      ),
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
    list: (filters?: InfringementReportListParams) => {
      const qs = buildInfringementReportQuery(filters);
      return request<InfringementReportListResult>(`/infringement-reports${qs ? `?${qs}` : ""}`);
    },
    create: (input: CreateInfringementReportInput) =>
      post<{ infringementReport: InfringementReportWithNames }>("/infringement-reports", input),
    update: (id: string, input: UpdateInfringementReportInput) =>
      patch<{ infringementReport: InfringementReportWithNames }>(`/infringement-reports/${id}`, input),
    remove: (id: string) => del(`/infringement-reports/${id}`),
    /** A direct download link (session-cookie authenticated, not fetch()) — see the `run_worker_first`
     * comment in wrangler.toml for why this has to be a real Worker route and not a static asset. */
    exportUrl: (filters?: InfringementReportListParams) => {
      const qs = buildInfringementReportQuery(filters);
      return `/api/infringement-reports/export${qs ? `?${qs}` : ""}`;
    },
  },
  dataPulls: {
    list: (params: DataPullListParams) => {
      const qs = buildInfringementReportQuery(params);
      return request<DataPullListResult>(`/data-pulls${qs ? `?${qs}` : ""}`);
    },
    /** Direct download link, same as infringementReports.exportUrl. */
    exportUrl: (filters?: DataPullListParams) => {
      const qs = buildInfringementReportQuery(filters);
      return `/api/data-pulls/export${qs ? `?${qs}` : ""}`;
    },
  },
  stats: {
    get: () => request<{ stats: DashboardStats }>("/stats"),
  },
  affiliationTags: {
    list: () => request<{ affiliationTags: AffiliationTag[] }>("/affiliation-tags"),
    getOrCreate: (input: CreateAffiliationTagInput) =>
      post<{ affiliationTag: AffiliationTag }>("/affiliation-tags", input),
  },
  rightsManagerAccounts: {
    list: () => request<{ rightsManagerAccounts: RightsManagerAccount[] }>("/rights-manager-accounts"),
    getOrCreate: (input: CreateRightsManagerAccountInput) =>
      post<{ rightsManagerAccount: RightsManagerAccount }>("/rights-manager-accounts", input),
  },
  hunter: {
    /** HUNT THIS SOURCE NOW — private, requires hunterAccess (enforced server-side regardless of
     * what the frontend shows). See functions/api/hunter/sources/byId/hunt.ts. */
    hunt: (videoId: string) => post<HuntSourceResult>(`/hunter/sources/${videoId}/hunt`, {}),
  },
};
