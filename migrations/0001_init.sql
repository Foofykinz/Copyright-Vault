-- Core schema for Viral DRM.

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE social_accounts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram', 'tiktok', 'youtube', 'x', 'other')),
  account_name TEXT NOT NULL,
  profile_url TEXT,
  last_pull_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_social_accounts_client_id ON social_accounts(client_id);

CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  social_account_id TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram', 'tiktok', 'youtube', 'x', 'other')),
  video_url TEXT NOT NULL,
  publication_date TEXT NOT NULL,
  caption TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  view_count_checked_at TEXT,
  thumbnail_url TEXT,
  notes TEXT,
  collected_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_videos_client_id ON videos(client_id);
CREATE INDEX idx_videos_social_account_id ON videos(social_account_id);
CREATE INDEX idx_videos_publication_date ON videos(publication_date);

CREATE TABLE combination_folders (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_combination_folders_client_id ON combination_folders(client_id);

CREATE TABLE combination_folder_videos (
  combination_folder_id TEXT NOT NULL REFERENCES combination_folders(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY (combination_folder_id, video_id)
);

CREATE INDEX idx_combination_folder_videos_video_id ON combination_folder_videos(video_id);
