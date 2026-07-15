import type { Env as ApiEnv, ApiHandler } from "../functions/lib/env";
import { Router } from "./router";

import * as clientsIndex from "../functions/api/clients/index";
import * as clientById from "../functions/api/clients/byId";
import * as clientSocialAccounts from "../functions/api/clients/byId/social-accounts";
import * as clientStats from "../functions/api/clients/byId/stats";
import * as socialAccountById from "../functions/api/social-accounts/byId";
import * as socialAccountVideos from "../functions/api/social-accounts/byId/videos";
import * as videoById from "../functions/api/videos/byId";
import * as combinationFoldersIndex from "../functions/api/combination-folders/index";
import * as combinationFolderById from "../functions/api/combination-folders/byId";
import * as combinationFolderVideos from "../functions/api/combination-folders/byId/videos";
import * as combinationFolderVideoById from "../functions/api/combination-folders/byId/videos/byVideoId";
import * as extensionVideos from "../functions/api/extension/videos";

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

register("/api/clients", clientsIndex);
register("/api/clients/:id", clientById);
register("/api/clients/:id/social-accounts", clientSocialAccounts);
register("/api/clients/:id/stats", clientStats);
register("/api/social-accounts/:id", socialAccountById);
register("/api/social-accounts/:id/videos", socialAccountVideos);
register("/api/videos/:id", videoById);
register("/api/combination-folders", combinationFoldersIndex);
register("/api/combination-folders/:id", combinationFolderById);
register("/api/combination-folders/:id/videos", combinationFolderVideos);
register("/api/combination-folders/:id/videos/:videoId", combinationFolderVideoById);
register("/api/extension/videos", extensionVideos);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
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
