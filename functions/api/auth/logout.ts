import type { ApiHandler } from "../../lib/env";
import { json } from "../../lib/http";
import { clearSessionCookie } from "../../lib/session";

export const onRequestPost: ApiHandler = async (context) => {
  return json({ ok: true }, { headers: { "set-cookie": clearSessionCookie(context.request) } });
};
