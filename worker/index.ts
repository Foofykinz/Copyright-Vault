import type { Env as ApiEnv, ApiHandler } from "../functions/lib/env";
import { Router } from "./router";
import { verifySession } from "../functions/lib/session";

import * as authLogin from "../functions/api/auth/login";
import * as authLogout from "../functions/api/auth/logout";
import * as authSession from "../functions/api/auth/session";
import * as authChangePassword from "../functions/api/auth/change-password";
import * as clientsIndex from "../functions/api/clients/index";
import * as clientById from "../functions/api/clients/byId";
import * as clientSocialAccounts from "../functions/api/clients/byId/social-accounts";
import * as clientStats from "../functions/api/clients/byId/stats";
import * as socialAccountById from "../functions/api/social-accounts/byId";
import * as socialAccountVideos from "../functions/api/social-accounts/byId/videos";
import * as socialAccountVideosExport from "../functions/api/social-accounts/byId/videos/export";
import * as videoById from "../functions/api/videos/byId";
import * as combinationFoldersIndex from "../functions/api/combination-folders/index";
import * as combinationFolderById from "../functions/api/combination-folders/byId";
import * as combinationFolderVideos from "../functions/api/combination-folders/byId/videos";
import * as combinationFolderVideoById from "../functions/api/combination-folders/byId/videos/byVideoId";
import * as rightsManagerMarkSent from "../functions/api/rights-manager/mark-sent";
import * as infringementReportsIndex from "../functions/api/infringement-reports/index";
import * as infringementReportById from "../functions/api/infringement-reports/byId";
import * as extensionVideos from "../functions/api/extension/videos";
import * as metadataLookup from "../functions/api/metadata/index";
import * as youtubeChannelVideos from "../functions/api/youtube/channel-videos";

export interface Env extends ApiEnv {
  ASSETS: Fetcher;
}

type RouteModule = Partial<{
  onRequestGet: ApiHandler<Env>;
  onRequestPost: ApiHandler<Env>;
  onRequestPatch: ApiHandler<Env>;
  onRequestDelete: ApiHandler<Env>;
}>;

const router = new Router<Env>();

function register(pattern: string, mod: RouteModule): void {
  if (mod.onRequestGet) router.add("GET", pattern, mod.onRequestGet);
  if (mod.onRequestPost) router.add("POST", pattern, mod.onRequestPost);
  if (mod.onRequestPatch) router.add("PATCH", pattern, mod.onRequestPatch);
  if (mod.onRequestDelete) router.add("DELETE", pattern, mod.onRequestDelete);
}

register("/api/auth/login", authLogin);
register("/api/auth/logout", authLogout);
register("/api/auth/session", authSession);
register("/api/auth/change-password", authChangePassword);
register("/api/clients", clientsIndex);
register("/api/clients/:id", clientById);
register("/api/clients/:id/social-accounts", clientSocialAccounts);
register("/api/clients/:id/stats", clientStats);
register("/api/social-accounts/:id", socialAccountById);
register("/api/social-accounts/:id/videos", socialAccountVideos);
register("/api/social-accounts/:id/videos/export", socialAccountVideosExport);
register("/api/videos/:id", videoById);
register("/api/combination-folders", combinationFoldersIndex);
register("/api/combination-folders/:id", combinationFolderById);
register("/api/combination-folders/:id/videos", combinationFolderVideos);
register("/api/combination-folders/:id/videos/:videoId", combinationFolderVideoById);
register("/api/rights-manager/mark-sent", rightsManagerMarkSent);
register("/api/infringement-reports", infringementReportsIndex);
register("/api/infringement-reports/:id", infringementReportById);
register("/api/extension/videos", extensionVideos);
register("/api/metadata", metadataLookup);
register("/api/youtube/channel-videos", youtubeChannelVideos);

// Routes reachable without a staff login: /api/auth/* handles its own auth (login has none by
// nature; logout/session/change-password each call verifySession internally), and the extension
// routes authenticate machine-to-machine via requireBearerToken instead of a browser session.
const SESSION_EXEMPT_PREFIXES = ["/api/auth/"];
const SESSION_EXEMPT_EXACT = ["/api/extension/videos", "/api/youtube/channel-videos"];

function isSessionExempt(pathname: string): boolean {
  return SESSION_EXEMPT_EXACT.includes(pathname) || SESSION_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (!isSessionExempt(url.pathname)) {
        const userId = await verifySession(request, env);
        if (!userId) {
          return new Response(JSON.stringify({ error: "Not authenticated." }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }
      }

      const response = await router.handle(request, env);
      return (
        response ??
        new Response(JSON.stringify({ error: "Not found." }), {
          status: 404,
          headers: { "content-type": "application/json" },
        })
      );
    }

    return env.ASSETS.fetch(request);
  },
};
