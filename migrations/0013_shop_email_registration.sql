-- DAGA V30 self-service shop registration and email verification.
-- Internal registration state only; no company/legal identity is collected from users.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS daga_shop_registration_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  shop_name TEXT NOT NULL,
  internal_identity TEXT NOT NULL,
  destination_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at TEXT,
  claim_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS daga_shop_registration_lookup
  ON daga_shop_registration_challenges(destination_hash, expires_at, consumed_at);
CREATE INDEX IF NOT EXISTS daga_shop_registration_email_created
  ON daga_shop_registration_challenges(email, created_at);
