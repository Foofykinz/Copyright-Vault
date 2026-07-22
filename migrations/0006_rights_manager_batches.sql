-- Rights Manager export tracking. Separate from combination_folders on purpose — that table tracks
-- a different concept (registration-deadline grouping off earliest publication date, see
-- functions/lib/folders.ts) that has nothing to do with whether a video has been sent to Rights
-- Manager.

CREATE TABLE rights_manager_batches (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_rights_manager_batches_client_id ON rights_manager_batches(client_id);

-- exported_at lives per video-in-batch, not on the batch itself, so a video already added to a CSV
-- export keeps an accurate record even if more videos get added to the same batch afterward.
CREATE TABLE rights_manager_batch_videos (
  rights_manager_batch_id TEXT NOT NULL REFERENCES rights_manager_batches(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  exported_at TEXT,
  PRIMARY KEY (rights_manager_batch_id, video_id)
);

CREATE INDEX idx_rights_manager_batch_videos_video_id ON rights_manager_batch_videos(video_id);

-- Denormalized fast-path cache (source of truth is rights_manager_batch_videos.exported_at above) —
-- same pattern as videos.view_count_checked_at — so listing videos with their Rights Manager status
-- doesn't need a join or per-row subquery.
ALTER TABLE videos ADD COLUMN rights_manager_sent_at TEXT;
