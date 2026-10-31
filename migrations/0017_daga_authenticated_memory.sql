CREATE TABLE IF NOT EXISTS daga_user_memory (
  user_id TEXT PRIMARY KEY NOT NULL,
  profile_json TEXT NOT NULL DEFAULT '{}',
  history_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_daga_user_memory_updated_at ON daga_user_memory(updated_at);
