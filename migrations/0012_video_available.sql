-- Whether the infringing video is still live on the platform at the time the match was reviewed.
-- Nullable/tri-state like is_account_private (see migration 0011): true/false once someone (or the
-- extension) has checked, null until then. Surfaced as a checkbox column on the Rights Manager
-- archive tab.
ALTER TABLE infringement_reports ADD COLUMN video_available INTEGER;
