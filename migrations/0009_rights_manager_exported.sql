-- Tracks whether a video has been included in a "Export Rights Manager CSV" download, distinct
-- from rights_manager_sent_at (the manual "mark as sent" confirmation) -- exporting the CSV is a
-- separate, earlier workflow step that's worth seeing at a glance.
ALTER TABLE videos ADD COLUMN rights_manager_exported_at TEXT;
