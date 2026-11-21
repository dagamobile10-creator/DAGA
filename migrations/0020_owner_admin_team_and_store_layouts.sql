-- Owner-managed administration team and per-company dashboard naming overrides.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS daga_owner_team_memberships (
  account_id TEXT PRIMARY KEY REFERENCES daga_accounts(id),
  role TEXT NOT NULL CHECK (role IN ('manager','employee')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','removed')),
  permissions_json TEXT NOT NULL DEFAULT '{}',
  invited_by_account_id TEXT NOT NULL REFERENCES daga_accounts(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS daga_owner_team_status ON daga_owner_team_memberships(status, role);

CREATE TABLE IF NOT EXISTS daga_owner_team_setup_challenges (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES daga_accounts(id),
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS daga_owner_team_setup_account ON daga_owner_team_setup_challenges(account_id, expires_at);

CREATE TABLE IF NOT EXISTS daga_store_layout_settings (
  store_id TEXT PRIMARY KEY REFERENCES daga_stores(id),
  layout_json TEXT NOT NULL DEFAULT '{}',
  updated_by TEXT NOT NULL REFERENCES daga_accounts(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
