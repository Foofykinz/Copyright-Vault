export interface Env {
  DB: D1Database;
  /** Rights Manager match screenshots captured by the extension — see
   * functions/api/extension/infringement-reports.ts and functions/api/infringement-reports/byId/screenshot.ts. */
  SCREENSHOTS: R2Bucket;
  /** Optional shared secret the future browser extension authenticates with. Unset in local dev. */
  EXTENSION_API_TOKEN?: string;
  /** Optional YouTube Data API v3 key. Without it, YouTube metadata lookup is unavailable. */
  YOUTUBE_API_KEY?: string;
  /** Optional Vimeo API personal access token (Public scope). Without it, Vimeo channel scanning is unavailable. */
  VIMEO_ACCESS_TOKEN?: string;
  /** Optional override for Vault Hunter's configured daily search.list call budget (see
   * functions/lib/hunterQuota.ts). search.list has its own separate per-day quota bucket, distinct
   * from the general Data API pool the rest of this app's YouTube calls draw from — this is NOT an
   * assumption about the Google Cloud project's actual configured limit, just Hunter's own
   * self-imposed ceiling, adjustable here without a code change as that limit is raised. */
  HUNTER_YOUTUBE_SEARCH_DAILY_BUDGET?: string;
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
