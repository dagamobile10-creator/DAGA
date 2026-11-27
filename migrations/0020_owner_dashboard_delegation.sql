-- Short-lived, store-scoped app-owner delegation for opening the original V30 dashboard.
CREATE TABLE IF NOT EXISTS daga_owner_dashboard_delegations (
  id TEXT PRIMARY KEY,
  owner_account_id TEXT NOT NULL REFERENCES daga_accounts(id),
  store_id TEXT NOT NULL REFERENCES daga_stores(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT
);
CREATE INDEX IF NOT EXISTS daga_owner_dashboard_delegations_scope ON daga_owner_dashboard_delegations(store_id,expires_at,revoked_at);
