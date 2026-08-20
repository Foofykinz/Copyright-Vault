import type { ApiHandler } from "../../../lib/env";
import { errorResponse, NotFoundError } from "../../../lib/http";
import { getInfringementReportOrThrow } from "../../../lib/db";

// Staff-only by construction: this route isn't in SESSION_EXEMPT_* or EXTENSION_TOKEN_READ_PATTERNS
// in worker/index.ts, so it falls through to the default session check like everything else in the
// app. Screenshots are never served from a public R2 URL.
export const onRequestGet: ApiHandler = async (context) => {
  try {
    const db = context.env.DB;
    const id = context.params.id as string;
    const report = await getInfringementReportOrThrow(db, id);
    if (!report.screenshotKey) throw new NotFoundError("This report has no screenshot.");

    const object = await context.env.SCREENSHOTS.get(report.screenshotKey);
    if (!object) throw new NotFoundError("Screenshot not found in storage.");

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-type", object.httpMetadata?.contentType ?? "image/png");
    headers.set("cache-control", "private, max-age=3600");
    return new Response(object.body, { headers });
  } catch (err) {
    return errorResponse(err);
  }
};
