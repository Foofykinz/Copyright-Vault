import { useCallback, useEffect, useState } from "react";
import { api, ApiRequestError } from "../lib/api";
import type { SessionUser } from "../../shared/types";

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
}

/** Checks the session cookie on mount. `user: null` after loading means "not logged in," not an
 * error — a 401 from /auth/session is the expected response for a logged-out visitor. */
export function useAuth() {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  const refetch = useCallback(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    api.auth
      .session()
      .then(({ user }) => {
        if (!cancelled) setState({ user, loading: false });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (!(err instanceof ApiRequestError && err.status === 401)) {
          console.error(err);
        }
        setState({ user: null, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => refetch(), [refetch]);

  const logout = useCallback(async () => {
    await api.auth.logout();
    setState({ user: null, loading: false });
  }, []);

  return { ...state, refetch, logout };
}
