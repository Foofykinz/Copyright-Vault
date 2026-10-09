import type { ApiHandler } from "../../lib/env";
import { errorResponse, json, readJson, UnauthorizedError } from "../../lib/http";
import { verifySession } from "../../lib/session";
import { requireTicketInboxAccess } from "../../lib/ticketAuth";
import { generateId, nowIso } from "../../lib/ids";
import { requireString } from "../../lib/validation";
import {
  decodeTicketScreenshot,
  mapTicket,
  requireTicketCategory,
  requireTicketPriority,
  requireTicketStatus,
  TICKET_SELECT,
  type TicketRow,
} from "../../lib/tickets";
import type { CreateTicketInput, TicketListResult } from "../../../shared/types";

/** Inbox owner only: every ticket (optionally by status), newest first, plus the unseen count. */
export const onRequestGet: ApiHandler = async (context) => {
  try {
    await requireTicketInboxAccess(context.request, context.env);
    const db = context.env.DB;
    const statusParam = new URL(context.request.url).searchParams.get("status");
    const status = statusParam ? requireTicketStatus(statusParam) : null;

    const rows = await (status
      ? db.prepare(`${TICKET_SELECT} WHERE t.status = ? ORDER BY t.created_at DESC`).bind(status)
      : db.prepare(`${TICKET_SELECT} ORDER BY t.created_at DESC`)
    ).all<TicketRow>();
    const unseen = await db.prepare("SELECT COUNT(*) as count FROM tickets WHERE seen_at IS NULL").first<{ count: number }>();

    const result: TicketListResult = { tickets: rows.results.map(mapTicket), unseenCount: unseen?.count ?? 0 };
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
};

/** Any logged-in staff member can submit a ticket. The response deliberately returns only the new
 * ticket's id -- submitters never read tickets back, not even their own. */
export const onRequestPost: ApiHandler = async (context) => {
  try {
    const userId = await verifySession(context.request, context.env);
    if (!userId) throw new UnauthorizedError("Not logged in.");
    const body = await readJson<CreateTicketInput>(context.request);

    const title = requireString(body.title, "title", { maxLength: 200 });
    const description = requireString(body.description, "description", { maxLength: 5000 });
    const priority = requireTicketPriority(body.priority);
    const category = requireTicketCategory(body.category);
    const screenshot = decodeTicketScreenshot(body.screenshotDataUrl);

    const id = generateId();
    let attachmentKey: string | null = null;
    if (screenshot) {
      attachmentKey = `tickets/${id}`;
      await context.env.SCREENSHOTS.put(attachmentKey, screenshot.bytes, { httpMetadata: { contentType: screenshot.contentType } });
    }

    const now = nowIso();
    await context.env.DB.prepare(
      `INSERT INTO tickets (id, title, description, priority, category, status, created_by_user_id, attachment_key, seen_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, NULL, ?, ?)`
    )
      .bind(id, title, description, priority, category, userId, attachmentKey, now, now)
      .run();

    return json({ id }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
};
