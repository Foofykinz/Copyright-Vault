import type { Env } from "./env";
import { UnauthorizedError } from "./http";
import { verifySession } from "./session";

/**
 * The server-side gate for every /api/hunter/* route. Vault Hunter is private to a small set of
 * staff (see migration 0014's users.hunter_access column) — frontend nav/UI hiding is convenience
 * only, this is the actual enforcement. Every Hunter handler must call this before doing anything
 * else, the same way non-Hunter routes call verifySession/requireBearerToken.
 *
 * Fails closed: no session, no user row, or hunter_access = 0 all produce the same 401 so a caller
 * can't distinguish "not logged in" from "logged in but not authorized for Hunter."
 */
export async function requireHunterAccess(request: Request, env: Env): Promise<string> {
  const userId = await verifySession(request, env);
  if (!userId) throw new UnauthorizedError("Not logged in.");

  const row = await env.DB.prepare("SELECT hunter_access FROM users WHERE id = ?")
    .bind(userId)
    .first<{ hunter_access: number }>();
  if (!row || row.hunter_access !== 1) {
    throw new UnauthorizedError("Not authorized for Vault Hunter.");
  }
  return userId;
}
