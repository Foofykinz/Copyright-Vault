import type { ApiHandler } from "../../lib/env";
import { errorResponse, json, readJson, UnauthorizedError } from "../../lib/http";
import { nowIso } from "../../lib/ids";
import { requireString } from "../../lib/validation";
import { verifyPassword } from "../../lib/password";
import { createSessionCookie } from "../../lib/session";
import type { SessionUser } from "../../../shared/types";

interface UserRow {
  id: string;
  name: string;
  username: string;
  password_hash: string;
  password_salt: string;
  must_change_password: number;
  failed_attempts: number;
  locked_until: string | null;
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export const onRequestPost: ApiHandler = async (context) => {
  try {
    const body = await readJson<{ username?: string; password?: string }>(context.request);
    const username = requireString(body.username, "username").toLowerCase();
    const password = requireString(body.password, "password");

    const db = context.env.DB;
    const row = await db.prepare("SELECT * FROM users WHERE username = ?").bind(username).first<UserRow>();

    // Same generic error whether the username doesn't exist or the password is wrong, so a caller
    // can't use this endpoint to discover which usernames are valid.
    const invalidCredentials = () => new UnauthorizedError("Invalid username or password.");

    if (!row) throw invalidCredentials();

    if (row.locked_until && row.locked_until > nowIso()) {
      throw new UnauthorizedError("This account is temporarily locked after repeated failed attempts. Try again later.");
    }

    const valid = await verifyPassword(password, row.password_hash, row.password_salt);
    if (!valid) {
      const attempts = row.failed_attempts + 1;
      const lockedUntil =
        attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString() : null;
      await db
        .prepare("UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?")
        .bind(attempts, lockedUntil, row.id)
        .run();
      throw invalidCredentials();
    }

    await db.prepare("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?").bind(row.id).run();

    const cookie = await createSessionCookie(row.id, context.request, context.env);
    const user: SessionUser = {
      id: row.id,
      name: row.name,
      username: row.username,
      mustChangePassword: row.must_change_password === 1,
    };
    return json({ user }, { headers: { "set-cookie": cookie } });
  } catch (err) {
    return errorResponse(err);
  }
};
