-- Public company onboarding requests: email must be verified before creating pending records.
-- No session or password is issued here; program-owner approval remains mandatory.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS daga_company_onboarding_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  company_name TEXT NOT NULL,
  legal_identity TEXT NOT NULL,
  destination_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at TEXT,
  claim_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS daga_company_onboarding_lookup
  ON daga_company_onboarding_challenges(destination_hash, expires_at, consumed_at);
CREATE INDEX IF NOT EXISTS daga_company_onboarding_email_created
  ON daga_company_onboarding_challenges(email, created_at);
