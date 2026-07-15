import type { Env } from "../../lib/env";
import { errorResponse, json, readJson } from "../../lib/http";
import { nowIso } from "../../lib/ids";
import { getSocialAccountOrThrow } from "../../lib/db";
import { optionalUrl, requirePlatform, requireString } from "../../lib/validation";
import type { UpdateSocialAccountInput } from "../../../shared/types";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const account = await getSocialAccountOrThrow(context.env.DB, context.params.id as string);
    return json({ socialAccount: account });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  try {
    const id = context.params.id as string;
    await getSocialAccountOrThrow(context.env.DB, id);
    const body = await readJson<UpdateSocialAccountInput>(context.request);

    const updates: string[] = [];
    const values: unknown[] = [];

    if (body.platform !== undefined) {
      updates.push("platform = ?");
      values.push(requirePlatform(body.platform));
    }
    if (body.accountName !== undefined) {
      updates.push("account_name = ?");
      values.push(requireString(body.accountName, "accountName", { maxLength: 200 }));
    }
    if (body.profileUrl !== undefined) {
      updates.push("profile_url = ?");
      values.push(optionalUrl(body.profileUrl, "profileUrl"));
    }

    if (updates.length > 0) {
      updates.push("updated_at = ?");
      values.push(nowIso());
      values.push(id);
      await context.env.DB.prepare(`UPDATE social_accounts SET ${updates.join(", ")} WHERE id = ?`)
        .bind(...values)
        .run();
    }

    const account = await getSocialAccountOrThrow(context.env.DB, id);
    return json({ socialAccount: account });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  try {
    const id = context.params.id as string;
    await getSocialAccountOrThrow(context.env.DB, id);
    await context.env.DB.prepare("DELETE FROM social_accounts WHERE id = ?").bind(id).run();
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
};
