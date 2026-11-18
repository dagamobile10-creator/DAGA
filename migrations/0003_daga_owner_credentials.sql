-- DAGA V30 owner credentials and one-time bootstrap state.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS daga_owner_credentials (
  account_id TEXT PRIMARY KEY REFERENCES daga_accounts(id),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 310000,
  recovery_code_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS daga_owner_bootstrap_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  consumed_at TEXT,
  consumed_account_id TEXT REFERENCES daga_accounts(id)
);

-- Rate-limit buckets use hashed keys only; old rows can be pruned periodically.
CREATE TABLE IF NOT EXISTS daga_auth_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
