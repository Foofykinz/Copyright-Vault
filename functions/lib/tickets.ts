// Shared row mapping + lookup for the ticket routes (migration 0019).
import { NotFoundError, ValidationError } from "./http";
import type { Ticket, TicketCategory, TicketPriority, TicketStatus } from "../../shared/types";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from "../../shared/types";

export interface TicketRow {
  id: string;
  title: string;
  description: string;
  priority: string;
  category: string;
  status: string;
  created_by_user_id: string;
  attachment_key: string | null;
  seen_at: string | null;
  created_at: string;
  updated_at: string;
  created_by_name: string;
}

export const TICKET_SELECT = `
  SELECT t.*, u.name as created_by_name
  FROM tickets t
  JOIN users u ON u.id = t.created_by_user_id
`;

export function mapTicket(row: TicketRow): Ticket {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority as TicketPriority,
    category: row.category as TicketCategory,
    status: row.status as TicketStatus,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name,
    hasAttachment: row.attachment_key !== null,
    seenAt: row.seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getTicketRowOrThrow(db: D1Database, id: string): Promise<TicketRow> {
  const row = await db.prepare(`${TICKET_SELECT} WHERE t.id = ?`).bind(id).first<TicketRow>();
  if (!row) throw new NotFoundError("Ticket not found.");
  return row;
}

function requireOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw new ValidationError(`${field} must be one of: ${allowed.join(", ")}.`, { [field]: "invalid" });
}

export const requireTicketPriority = (v: unknown) => requireOneOf(v, TICKET_PRIORITIES, "priority");
export const requireTicketCategory = (v: unknown) => requireOneOf(v, TICKET_CATEGORIES, "category");
export const requireTicketStatus = (v: unknown) => requireOneOf(v, TICKET_STATUSES, "status");

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/** Decodes an optional screenshot data URL. Unlike the extension's import (where a bad screenshot
 * is silently dropped), a person attached this on purpose, so a bad one is an error they can fix. */
export function decodeTicketScreenshot(dataUrl: unknown): { bytes: Uint8Array; contentType: string } | null {
  if (dataUrl === undefined || dataUrl === null || dataUrl === "") return null;
  const match = typeof dataUrl === "string" ? /^data:([^;,]+);base64,(.+)$/.exec(dataUrl) : null;
  if (!match || !ALLOWED_IMAGE_TYPES.includes(match[1])) {
    throw new ValidationError("The screenshot must be a PNG, JPEG, WebP, or GIF image.", { screenshotDataUrl: "invalid" });
  }
  const binary = atob(match[2]);
  if (binary.length > MAX_ATTACHMENT_BYTES) {
    throw new ValidationError("The screenshot is too large (8 MB max).", { screenshotDataUrl: "too_large" });
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, contentType: match[1] };
}
