-- Vimeo channel identity (cached on the social account after first resolution), same pattern as
-- the YouTube fields added in 0003_youtube_fields.sql.

ALTER TABLE social_accounts ADD COLUMN vimeo_user_id TEXT;
