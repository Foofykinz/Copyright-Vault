-- Rights Manager match collection: the inbound half of the Rights Manager lifecycle. The existing
-- rights_manager_batches/rights_manager_sent_at/rights_manager_exported_at (see migrations 0006 and
-- 0009) track the OUTBOUND step -- exporting a client's own videos as reference files to submit to
-- Meta. This tracks the opposite direction: matches Meta's Rights Manager finds against those
-- reference files, collected via the browser extension.

-- A managed, reusable list of Meta Business Rights Manager accounts (e.g. "WX Chasing",
-- "Severe Studios") -- same pattern as affiliation_tags (see migration 0008). Deliberately its own
-- table rather than reusing affiliation_tags: a Rights Manager account is a Meta-side business
-- entity matches come from, not a label on a client, and the two don't necessarily correspond 1:1.
CREATE TABLE rights_manager_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL
);

-- infringement_reports created by the extension have no staff session to attribute found_by_user_id
-- to (found_by_user_id is NOT NULL). Rather than relax that constraint -- which SQLite can only do
-- via a full table rebuild -- attribute extension-sourced rows to this fixed, unusable system user.
-- locked_until is set far enough in the future that /api/auth/login's lock check (which runs before
-- password verification) rejects any login attempt outright, regardless of credentials.
INSERT INTO users (id, name, username, password_hash, password_salt, must_change_password, failed_attempts, locked_until, created_at, updated_at)
VALUES ('system-rights-manager-extension', 'Rights Manager Extension', 'system-rights-manager-extension', 'DISABLED', 'DISABLED', 1, 0, '9999-12-31T00:00:00.000Z', '2026-08-19T00:00:00.000Z', '2026-08-19T00:00:00.000Z');

ALTER TABLE infringement_reports ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'rights_manager'));
ALTER TABLE infringement_reports ADD COLUMN rights_manager_account_id TEXT
  REFERENCES rights_manager_accounts(id) ON DELETE SET NULL;
-- Meta's own reference number for the match (active_match_data_id in the Rights Manager API) --
-- the field Imad wants this searchable by. The UNIQUE partial index below doubles as a dedup key:
-- re-sending an already-logged match returns the existing row instead of inserting a second one,
-- same pattern as videos.video_url dedup in functions/api/extension/videos.ts.
ALTER TABLE infringement_reports ADD COLUMN meta_match_id TEXT;
ALTER TABLE infringement_reports ADD COLUMN meta_video_id TEXT;
ALTER TABLE infringement_reports ADD COLUMN match_duration_sec REAL;
ALTER TABLE infringement_reports ADD COLUMN video_view_count INTEGER;
ALTER TABLE infringement_reports ADD COLUMN page_follower_count INTEGER;
-- Drives the "private accounts get released, not logged" workflow hint in the UI.
ALTER TABLE infringement_reports ADD COLUMN is_account_private INTEGER;
ALTER TABLE infringement_reports ADD COLUMN infringer_profile_url TEXT;
-- JSON array of {id, title} -- a match can carry more than one matched reference asset.
ALTER TABLE infringement_reports ADD COLUMN reference_files TEXT;
-- R2 object key, not the image itself -- see functions/api/infringement-reports/byId/screenshot.ts.
ALTER TABLE infringement_reports ADD COLUMN screenshot_key TEXT;

CREATE UNIQUE INDEX idx_infringement_reports_meta_match_id
  ON infringement_reports(meta_match_id) WHERE meta_match_id IS NOT NULL;
CREATE INDEX idx_infringement_reports_rights_manager_account_id
  ON infringement_reports(rights_manager_account_id);
