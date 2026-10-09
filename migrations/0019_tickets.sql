-- Tickets: any staff member can file one from the Tickets page (bug, extension problem, client
-- request, ...); only users with ticket_inbox_access can list, read, update, or delete them. No
-- email -- the inbox is checked in Copyright Vault itself (a "new" count shows on the sidebar).
--
-- Same enforcement pattern as Vault Hunter's users.hunter_access (migration 0014): the column is the
-- server-side gate (functions/lib/ticketAuth.ts); the frontend only uses it to decide what to show.
ALTER TABLE users ADD COLUMN ticket_inbox_access INTEGER NOT NULL DEFAULT 0 CHECK (ticket_inbox_access IN (0, 1));

-- Alyson (the account owner) is the only ticket reader.
UPDATE users SET ticket_inbox_access = 1 WHERE id = '2142be1a-da43-4f98-9dbc-660b376f4ca7';

CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('bug', 'extension', 'client_request', 'rights_manager', 'other')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'closed')),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  -- R2 object key in the SCREENSHOTS bucket (tickets/<id>), never the image itself. Served only
  -- through the inbox-gated functions/api/tickets/byId/attachment.ts.
  attachment_key TEXT,
  -- When the inbox owner first opened it; NULL = new (drives the sidebar's "new" count).
  seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_tickets_status_created_at ON tickets(status, created_at);
CREATE INDEX idx_tickets_seen_at ON tickets(seen_at);
