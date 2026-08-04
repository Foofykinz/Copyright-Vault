import type { Env } from "./env";
import { UnauthorizedError } from "./http";

/** Open in local dev when EXTENSION_API_TOKEN isn't set — same posture as requireBearerToken. */
export function hasValidBearerToken(request: Request, env: Env): boolean {
  if (!env.EXTENSION_API_TOKEN) return true;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token === env.EXTENSION_API_TOKEN;
}

/** Shared by every route the extension calls directly (import, YouTube channel scan, ...). */
export function requireBearerToken(request: Request, env: Env): void {
  if (!hasValidBearerToken(request, env)) {
    throw new UnauthorizedError("Invalid or missing extension API token.");
  }
}
