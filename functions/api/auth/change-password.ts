import type { ApiHandler } from "../../lib/env";
import { errorResponse, json, readJson, UnauthorizedError, ValidationError } from "../../lib/http";
import { nowIso } from "../../lib/ids";
import { requireString } from "../../lib/validation";
import { hashPassword, verifyPassword } from "../../lib/password";
import { verifySession } from "../../lib/session";

interface UserRow {
  id: string;
  password_hash: string;
  password_salt: string;
}

const MIN_PASSWORD_LENGTH = 8;

export const onRequestPost: ApiHandler = async (context) => {
  try {
    const userId = await verifySession(context.request, context.env);
    if (!userId) throw new UnauthorizedError("Not logged in.");

    const body = await readJson<{ currentPassword?: string; newPassword?: string }>(context.request);
    const currentPassword = requireString(body.currentPassword, "currentPassword");
    const newPassword = requireString(body.newPassword, "newPassword", { maxLength: 200 });
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new ValidationError(`newPassword must be at least ${MIN_PASSWORD_LENGTH} characters.`, {
        newPassword: "too_short",
      });
    }

    const db = context.env.DB;
    const row = await db.prepare("SELECT id, password_hash, password_salt FROM users WHERE id = ?")
      .bind(userId)
      .first<UserRow>();
    if (!row) throw new UnauthorizedError("Not logged in.");

    const valid = await verifyPassword(currentPassword, row.password_hash, row.password_salt);
    if (!valid) throw new ValidationError("Current password is incorrect.", { currentPassword: "invalid" });

    const { hash, salt } = await hashPassword(newPassword);
    await db
      .prepare(
        "UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0, updated_at = ? WHERE id = ?"
      )
      .bind(hash, salt, nowIso(), userId)
      .run();

    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
};
