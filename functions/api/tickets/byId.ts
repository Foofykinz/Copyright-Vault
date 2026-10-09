import type { ApiHandler } from "../../lib/env";
import { errorResponse, json, readJson } from "../../lib/http";
import { requireTicketInboxAccess } from "../../lib/ticketAuth";
import { nowIso } from "../../lib/ids";
import { getTicketRowOrThrow, mapTicket, requireTicketStatus } from "../../lib/tickets";
import type { UpdateTicketInput } from "../../../shared/types";

/** Inbox owner only: change status and/or mark seen. */
export const onRequestPatch: ApiHandler = async (context) => {
  try {
    await requireTicketInboxAccess(context.request, context.env);
    const db = context.env.DB;
    const id = context.params.id as string;
    const existing = await getTicketRowOrThrow(db, id);
    const body = await readJson<UpdateTicketInput>(context.request);

    const status = body.status !== undefined ? requireTicketStatus(body.status) : existing.status;
    const seenAt = body.seen === true ? (existing.seen_at ?? nowIso()) : existing.seen_at;
    // Opening a ticket (seen) isn't an edit -- only a status change bumps updated_at.
    const updatedAt = status !== existing.status ? nowIso() : existing.updated_at;

    await db.prepare("UPDATE tickets SET status = ?, seen_at = ?, updated_at = ? WHERE id = ?").bind(status, seenAt, updatedAt, id).run();
    return json({ ticket: mapTicket(await getTicketRowOrThrow(db, id)) });
  } catch (err) {
    return errorResponse(err);
  }
};

/** Inbox owner only: delete the ticket and its screenshot. */
export const onRequestDelete: ApiHandler = async (context) => {
  try {
    await requireTicketInboxAccess(context.request, context.env);
    const db = context.env.DB;
    const id = context.params.id as string;
    const existing = await getTicketRowOrThrow(db, id);
    if (existing.attachment_key) await context.env.SCREENSHOTS.delete(existing.attachment_key);
    await db.prepare("DELETE FROM tickets WHERE id = ?").bind(id).run();
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
};
