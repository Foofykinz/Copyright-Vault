import type { ApiHandler } from "../../lib/env";
import { errorResponse, json, readJson } from "../../lib/http";
import { generateId, nowIso } from "../../lib/ids";
import { mapAffiliationTag } from "../../lib/db";
import { requireString } from "../../lib/validation";
import type { CreateAffiliationTagInput } from "../../../shared/types";

export const onRequestGet: ApiHandler = async (context) => {
  try {
    const rows = await context.env.DB.prepare("SELECT * FROM affiliation_tags ORDER BY name ASC").all();
    return json({ affiliationTags: rows.results.map((r) => mapAffiliationTag(r as never)) });
  } catch (err) {
    return errorResponse(err);
  }
};

// Get-or-create: tag names are case-insensitively unique (see migration 0008), so typing a name
// that already exists (in any casing) returns the existing tag instead of erroring.
export const onRequestPost: ApiHandler = async (context) => {
  try {
    const db = context.env.DB;
    const body = await readJson<CreateAffiliationTagInput>(context.request);
    const name = requireString(body.name, "name", { maxLength: 100 });

    const existing = await db.prepare("SELECT * FROM affiliation_tags WHERE name = ? COLLATE NOCASE").bind(name).first();
    if (existing) return json({ affiliationTag: mapAffiliationTag(existing as never) });

    const id = generateId();
    const now = nowIso();
    await db.prepare("INSERT INTO affiliation_tags (id, name, created_at) VALUES (?, ?, ?)").bind(id, name, now).run();
    return json({ affiliationTag: mapAffiliationTag({ id, name, created_at: now }) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
};
