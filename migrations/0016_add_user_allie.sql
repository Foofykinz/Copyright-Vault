-- Adds Allie Kemp's staff login. Temp password (must_change_password = 1, same as the original
-- seed batch in 0005_seed_users.sql) generated once and handed out directly -- not stored here.

INSERT INTO users (id, name, username, password_hash, password_salt, must_change_password, failed_attempts, locked_until, created_at, updated_at) VALUES
  ('ce750671-d517-4edb-a0f9-fa4c47eedc3a', 'Allie', 'allie', '71d36e4bb2adfeab7246f7f88d3acc875a7b803117cd7735c0c2208700baadde', '4817800d9f129db4ed2bd8307da58667', 1, 0, NULL, '2026-08-26T15:06:52.100Z', '2026-08-26T15:06:52.100Z');
