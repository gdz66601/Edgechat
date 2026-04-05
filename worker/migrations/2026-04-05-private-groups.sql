PRAGMA foreign_keys = OFF;

CREATE TABLE channels_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('public', 'private', 'dm')),
  dm_key TEXT UNIQUE,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

INSERT INTO channels_new (id, name, description, kind, dm_key, created_by, created_at, deleted_at)
SELECT id, name, description, kind, dm_key, created_by, created_at, deleted_at
FROM channels;

DROP TABLE channels;
ALTER TABLE channels_new RENAME TO channels;

ALTER TABLE channel_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member'));
ALTER TABLE channel_members ADD COLUMN invited_by INTEGER REFERENCES users(id);

UPDATE channel_members
SET role = 'owner'
WHERE channel_id IN (
  SELECT id FROM channels WHERE kind IN ('public', 'private')
)
AND user_id IN (
  SELECT created_by FROM channels WHERE channels.id = channel_members.channel_id
);

CREATE INDEX IF NOT EXISTS idx_messages_channel_created
  ON messages(channel_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_messages_sender_created
  ON messages(sender_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_channels_kind
  ON channels(kind, id DESC);

CREATE INDEX IF NOT EXISTS idx_users_username
  ON users(username);

PRAGMA foreign_keys = ON;
