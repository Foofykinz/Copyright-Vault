import type { ApiHandler } from "../../lib/env";
import { errorResponse, json, ValidationError } from "../../lib/http";
import { lookupVideoMetadata } from "../../lib/metadata";

export const onRequestGet: ApiHandler = async ({ request, env }) => {
  try {
    const url = new URL(request.url).searchParams.get("url");
    if (!url) throw new ValidationError("url query parameter is required.", { url: "required" });
    try {
      new URL(url);
    } catch {
      throw new ValidationError("url must be a valid URL.", { url: "invalid_url" });
    }

    const metadata = await lookupVideoMetadata(url, env);
    return json({ metadata });
  } catch (err) {
    return errorResponse(err);
  }
};
