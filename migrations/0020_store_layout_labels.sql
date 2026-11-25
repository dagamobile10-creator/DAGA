CREATE TABLE IF NOT EXISTS daga_store_layout_labels (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES daga_stores(id) ON DELETE CASCADE,
  target_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  updated_by TEXT REFERENCES daga_accounts(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(store_id,target_key)
);
CREATE INDEX IF NOT EXISTS daga_store_layout_labels_store ON daga_store_layout_labels(store_id);
