import type { ApiHandler } from "../../lib/env";
import { errorResponse, json, UnauthorizedError } from "../../lib/http";
import { verifySession } from "../../lib/session";
import type { SessionUser } from "../../../shared/types";

interface UserRow {
  id: string;
  name: string;
  username: string;
  must_change_password: number;
}

export const onRequestGet: ApiHandler = async (context) => {
  try {
    const userId = await verifySession(context.request, context.env);
    if (!userId) throw new UnauthorizedError("Not logged in.");

    const row = await context.env.DB.prepare("SELECT id, name, username, must_change_password FROM users WHERE id = ?")
      .bind(userId)
      .first<UserRow>();
    if (!row) throw new UnauthorizedError("Not logged in.");

    const user: SessionUser = {
      id: row.id,
      name: row.name,
      username: row.username,
      mustChangePassword: row.must_change_password === 1,
    };
    return json({ user });
  } catch (err) {
    return errorResponse(err);
  }
};
