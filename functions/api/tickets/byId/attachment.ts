import type { ApiHandler } from "../../../lib/env";
import { errorResponse, NotFoundError } from "../../../lib/http";
import { requireTicketInboxAccess } from "../../../lib/ticketAuth";
import { getTicketRowOrThrow } from "../../../lib/tickets";

/** Inbox owner only: a ticket's screenshot, proxied from R2 -- never a public bucket URL. */
export const onRequestGet: ApiHandler = async (context) => {
  try {
    await requireTicketInboxAccess(context.request, context.env);
    const ticket = await getTicketRowOrThrow(context.env.DB, context.params.id as string);
    if (!ticket.attachment_key) throw new NotFoundError("This ticket has no screenshot.");

    const object = await context.env.SCREENSHOTS.get(ticket.attachment_key);
    if (!object) throw new NotFoundError("Screenshot not found in storage.");

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("cache-control", "private, max-age=3600");
    return new Response(object.body, { headers });
  } catch (err) {
    return errorResponse(err);
  }
};
