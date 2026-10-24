-- Store-scoped V30 accounting ledger snapshots. Writes are authorized by authenticated store ownership.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS daga_store_ledgers (
  store_id TEXT PRIMARY KEY REFERENCES daga_stores(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES daga_accounts(id),
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS daga_store_ledgers_updated_at ON daga_store_ledgers(updated_at);
