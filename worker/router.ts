import type { ApiHandler } from "../functions/lib/env";

interface Route<Env> {
  method: string;
  segments: string[];
  handler: ApiHandler<Env>;
}

/** Tiny path-pattern router (":param" segments) replacing Pages' file-based routing under `wrangler deploy`. */
export class Router<Env> {
  private routes: Route<Env>[] = [];

  add(method: string, pattern: string, handler: ApiHandler<Env>): void {
    this.routes.push({ method, segments: pattern.split("/").filter(Boolean), handler });
  }

  async handle(request: Request, env: Env): Promise<Response | null> {
    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean);

    for (const route of this.routes) {
      if (route.method !== request.method) continue;
      if (route.segments.length !== segments.length) continue;

      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i++) {
        const routeSeg = route.segments[i];
        const seg = segments[i];
        if (routeSeg.startsWith(":")) {
          params[routeSeg.slice(1)] = decodeURIComponent(seg);
        } else if (routeSeg !== seg) {
          matched = false;
          break;
        }
      }
      if (matched) return route.handler({ request, env, params });
    }
    return null;
  }
}
