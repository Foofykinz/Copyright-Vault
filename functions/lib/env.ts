export interface Env {
  DB: D1Database;
  /** Optional shared secret the future browser extension authenticates with. Unset in local dev. */
  EXTENSION_API_TOKEN?: string;
}
