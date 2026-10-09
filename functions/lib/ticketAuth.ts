import type { Env } from "./env";
import { UnauthorizedError } from "./http";
import { verifySession } from "./session";

/**
 * The server-side gate for reading tickets: listing, opening, updating, deleting, and viewing a
 * ticket's screenshot. Submitting a ticket only needs a normal staff session. Same pattern as
 * requireHunterAccess (functions/lib/hunterAuth.ts): the frontend hiding the inbox is convenience
 * only, this is the enforcement.
 *
 * Fails closed: no session, no user row, or ticket_inbox_access = 0 all produce the same 401.
 */
export async function requireTicketInboxAccess(request: Request, env: Env): Promise<string> {
  const userId = await verifySession(request, env);
  if (!userId) throw new UnauthorizedError("Not logged in.");

  const row = await env.DB.prepare("SELECT ticket_inbox_access FROM users WHERE id = ?")
    .bind(userId)
    .first<{ ticket_inbox_access: number }>();
  if (!row || row.ticket_inbox_access !== 1) {
    throw new UnauthorizedError("Not authorized to view tickets.");
  }
  return userId;
}
