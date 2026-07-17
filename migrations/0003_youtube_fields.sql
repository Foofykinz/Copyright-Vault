-- YouTube channel identity (cached on the social account after first resolution) and a persisted
-- content category for YouTube videos (short / live / upload). NULL for every non-YouTube video.

ALTER TABLE social_accounts ADD COLUMN youtube_channel_id TEXT;
ALTER TABLE social_accounts ADD COLUMN youtube_uploads_playlist_id TEXT;
ALTER TABLE social_accounts ADD COLUMN youtube_handle TEXT;

ALTER TABLE videos ADD COLUMN youtube_category TEXT CHECK (youtube_category IN ('short', 'live', 'upload'));
