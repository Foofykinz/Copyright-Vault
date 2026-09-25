import { createContext, useContext } from "react";
import type { SessionUser } from "../../shared/types";

/**
 * The logged-in staff member, provided once in App.tsx (where useAuth's session fetch already
 * resolved a non-null user before the authenticated app shell renders) rather than re-fetching
 * /api/auth/session in every component that needs it — e.g. VideoTableRow checking
 * user.hunterAccess to decide whether to show "Hunt This Source Now".
 */
export const CurrentUserContext = createContext<SessionUser | null>(null);

/** Only valid inside the authenticated app shell (see App.tsx) — every call site today is already
 * nested there, so a null read indicates a missing provider, not a logged-out visitor. */
export function useCurrentUser(): SessionUser {
  const user = useContext(CurrentUserContext);
  if (!user) throw new Error("useCurrentUser() called outside CurrentUserContext.Provider.");
  return user;
}
