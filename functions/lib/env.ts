export interface Env {
  DB: D1Database;
  /** Optional shared secret the future browser extension authenticates with. Unset in local dev. */
  EXTENSION_API_TOKEN?: string;
  /** Optional YouTube Data API v3 key. Without it, YouTube metadata lookup is unavailable. */
  YOUTUBE_API_KEY?: string;
  /** Key used to sign staff login session cookies. Session verification fails closed without it —
   * nobody can be authenticated, rather than trusting an unsigned cookie. */
  SESSION_SECRET?: string;
}

/** Minimal per-request context passed to each API handler by the worker's manual router. */
export interface ApiContext<E = Env> {
  request: Request;
  env: E;
  params: Record<string, string>;
}

export type ApiHandler<E = Env> = (ctx: ApiContext<E>) => Promise<Response> | Response;
