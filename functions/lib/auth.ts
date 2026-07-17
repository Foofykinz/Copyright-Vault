import type { Env } from "./env";
import { UnauthorizedError } from "./http";

/** Shared by every route the extension calls directly (import, YouTube channel scan, ...). Open in
 * local dev when EXTENSION_API_TOKEN isn't set. */
export function requireBearerToken(request: Request, env: Env): void {
  if (!env.EXTENSION_API_TOKEN) return;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token !== env.EXTENSION_API_TOKEN) {
    throw new UnauthorizedError("Invalid or missing extension API token.");
  }
}
