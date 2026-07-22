-- Tracks third-party infringements of a client's content (someone else re-posting it without
-- permission) — the opposite direction from `videos`, which tracks a client's own posts on their
-- own accounts. Replaces the "post it in Signal, react with an emoji to mark it logged" workflow.

CREATE TABLE infringement_reports (
  id TEXT PRIMARY KEY,
  -- Optional: which client's content was infringed. Nullable so logging stays fast even when the
  -- specific client isn't identified yet — SET NULL (not CASCADE) since the report itself is still
  -- meaningful even if the client reference is later cleared.
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  infringer_name TEXT NOT NULL,
  infringing_url TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram', 'tiktok', 'youtube', 'x', 'other')),
  -- When the infringing content was itself posted (distinct from created_at, when it was logged here).
  posted_at TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'needs_review' CHECK (status IN ('needs_review', 'logged', 'takedown', 'ignored')),
  found_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_infringement_reports_client_id ON infringement_reports(client_id);
CREATE INDEX idx_infringement_reports_status ON infringement_reports(status);
CREATE INDEX idx_infringement_reports_found_by_user_id ON infringement_reports(found_by_user_id);
CREATE INDEX idx_infringement_reports_created_at ON infringement_reports(created_at);
