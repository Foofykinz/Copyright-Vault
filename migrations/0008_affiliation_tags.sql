-- Lets a client be tagged with the agency/company they're affiliated with (e.g. "LSM Client").
-- Tags are a managed, reusable list rather than free text, so labels don't drift ("LSM" vs "lsm").

CREATE TABLE affiliation_tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL
);

ALTER TABLE clients ADD COLUMN affiliation_tag_id TEXT REFERENCES affiliation_tags(id) ON DELETE SET NULL;
CREATE INDEX idx_clients_affiliation_tag_id ON clients(affiliation_tag_id);
