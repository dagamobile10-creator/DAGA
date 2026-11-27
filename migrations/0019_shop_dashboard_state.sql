-- Central per-company V30 dashboard snapshot with optimistic concurrency.
-- Existing browser data is preserved and imported by the dashboard client; no legacy data is deleted.
CREATE TABLE IF NOT EXISTS daga_shop_dashboard_state (
  store_id TEXT PRIMARY KEY REFERENCES daga_stores(id),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  payload_json TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES daga_accounts(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS daga_shop_dashboard_state_updated ON daga_shop_dashboard_state(updated_at);
