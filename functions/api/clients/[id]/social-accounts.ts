import type { Env } from "../../../lib/env";
import { errorResponse, json, readJson } from "../../../lib/http";
import { generateId, nowIso } from "../../../lib/ids";
import { getClientOrThrow, mapSocialAccount } from "../../../lib/db";
import { optionalUrl, requirePlatform, requireString } from "../../../lib/validation";
import type { CreateSocialAccountInput } from "../../../../shared/types";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const clientId = context.params.id as string;
    await getClientOrThrow(context.env.DB, clientId);
    const rows = await context.env.DB.prepare(
      "SELECT * FROM social_accounts WHERE client_id = ? ORDER BY created_at ASC"
    )
      .bind(clientId)
      .all();
    return json({ socialAccounts: rows.results.map((r) => mapSocialAccount(r as never)) });
  } catch (err) {
    return errorResponse(err);
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const clientId = context.params.id as string;
    await getClientOrThrow(context.env.DB, clientId);
    const body = await readJson<CreateSocialAccountInput>(context.request);

    const platform = requirePlatform(body.platform);
    const accountName = requireString(body.accountName, "accountName", { maxLength: 200 });
    const profileUrl = optionalUrl(body.profileUrl, "profileUrl");

    const id = generateId();
    const now = nowIso();

    await context.env.DB.prepare(
      `INSERT INTO social_accounts (id, client_id, platform, account_name, profile_url, last_pull_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
    )
      .bind(id, clientId, platform, accountName, profileUrl, now, now)
      .run();

    return json(
      {
        socialAccount: mapSocialAccount({
          id,
          client_id: clientId,
          platform,
          account_name: accountName,
          profile_url: profileUrl,
          last_pull_at: null,
          created_at: now,
          updated_at: now,
        }),
      },
      { status: 201 }
    );
  } catch (err) {
    return errorResponse(err);
  }
};
