-- Data Pulls: match data collected by the extension's automated "Data pull" clickthrough of Meta's
-- Content Protection matches. A separate purpose from infringement_reports (Rights Manager
-- evidence capture: one match reviewed at a time, with a screenshot) -- no screenshot, no review
-- workflow/status, just the match data, exportable as CSV.
--
-- One row per Meta match (meta_match_id UNIQUE): pulling a match again updates its row in place
-- with the latest values (e.g. a takedown going from requested to approved) and bumps
-- last_pulled_at, rather than piling up a duplicate per pull.
CREATE TABLE data_pulls (
  id TEXT PRIMARY KEY,
  rights_manager_account_id TEXT REFERENCES rights_manager_accounts(id) ON DELETE SET NULL,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  meta_match_id TEXT NOT NULL UNIQUE,
  infringer_name TEXT NOT NULL,
  -- Nullable: a match whose takedown went through may no longer show a link to the post.
  infringing_url TEXT,
  infringer_profile_url TEXT,
  platform TEXT NOT NULL,
  -- When Meta detected the match ("Detected Sep 25" on the page) -- the page shows no posting date.
  detected_at TEXT,
  match_duration_sec REAL,
  video_view_count INTEGER,
  page_follower_count INTEGER,
  -- JSON array of {id, title}, same shape as infringement_reports.reference_files.
  reference_files TEXT,
  -- From the match page: "You requested a takedown" -> requested, "Your takedown request was
  -- approved" -> approved. Null when neither is shown.
  takedown_status TEXT CHECK (takedown_status IN ('requested', 'approved')),
  first_pulled_at TEXT NOT NULL,
  last_pulled_at TEXT NOT NULL
);

CREATE INDEX idx_data_pulls_rights_manager_account_id ON data_pulls(rights_manager_account_id);
CREATE INDEX idx_data_pulls_last_pulled_at ON data_pulls(last_pulled_at);
