import type { ApiHandler } from "../../lib/env";
import { errorResponse, json, readJson } from "../../lib/http";
import { generateId, nowIso } from "../../lib/ids";
import { mapRightsManagerAccount } from "../../lib/db";
import { requireString } from "../../lib/validation";
import type { CreateRightsManagerAccountInput } from "../../../shared/types";

export const onRequestGet: ApiHandler = async (context) => {
  try {
    const rows = await context.env.DB.prepare("SELECT * FROM rights_manager_accounts ORDER BY name ASC").all();
    return json({ rightsManagerAccounts: rows.results.map((r) => mapRightsManagerAccount(r as never)) });
  } catch (err) {
    return errorResponse(err);
  }
};

// Get-or-create: names are case-insensitively unique (see migration 0011), so typing a name that
// already exists (in any casing) returns the existing account instead of erroring.
export const onRequestPost: ApiHandler = async (context) => {
  try {
    const db = context.env.DB;
    const body = await readJson<CreateRightsManagerAccountInput>(context.request);
    const name = requireString(body.name, "name", { maxLength: 100 });

    const existing = await db.prepare("SELECT * FROM rights_manager_accounts WHERE name = ? COLLATE NOCASE").bind(name).first();
    if (existing) return json({ rightsManagerAccount: mapRightsManagerAccount(existing as never) });

    const id = generateId();
    const now = nowIso();
    await db.prepare("INSERT INTO rights_manager_accounts (id, name, created_at) VALUES (?, ?, ?)").bind(id, name, now).run();
    return json({ rightsManagerAccount: mapRightsManagerAccount({ id, name, created_at: now }) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
};
