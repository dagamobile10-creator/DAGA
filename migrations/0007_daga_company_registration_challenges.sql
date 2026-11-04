-- Separate invitation-bound company registration challenges.
-- OTPs and invitation tokens are represented only by hashes.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS daga_company_registration_challenges (
  id TEXT PRIMARY KEY,
  invitation_token_hash TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('phone','email')),
  destination_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at TEXT,
  claim_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS daga_company_registration_lookup
  ON daga_company_registration_challenges(invitation_token_hash, channel, expires_at, consumed_at);
