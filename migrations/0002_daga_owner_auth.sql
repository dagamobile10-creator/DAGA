-- DAGA V30 owner-auth foundation. Apply only after confirming the dedicated DAGA application D1 database.
PRAGMA foreign_keys = ON;

-- Challenges store only hashes of OTPs. Delivery is handled by the Worker via configured providers.
CREATE TABLE IF NOT EXISTS daga_auth_challenges (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  purpose TEXT NOT NULL CHECK (purpose IN ('owner_bootstrap_phone','owner_bootstrap_email','login_phone','login_email','password_reset')),
  destination_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS daga_auth_challenges_destination ON daga_auth_challenges(destination_hash, purpose, created_at);

-- Store a hash of the opaque session token, never the raw bearer token.
CREATE TABLE IF NOT EXISTS daga_auth_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES daga_accounts(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT
);
CREATE INDEX IF NOT EXISTS daga_auth_sessions_account ON daga_auth_sessions(account_id, expires_at);

-- Minimal security audit; do not store OTPs, passwords, raw session tokens, or full request bodies here.
CREATE TABLE IF NOT EXISTS daga_security_events (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success','failure','blocked')),
  source_hash TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS daga_security_events_type_date ON daga_security_events(event_type, created_at);
