-- OTP challenges for existing company accounts to renew sessions after registration.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS daga_company_login_challenges (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES daga_accounts(id),
  channel TEXT NOT NULL CHECK (channel IN ('phone','email')),
  destination_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at TEXT,
  claim_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS daga_company_login_lookup
  ON daga_company_login_challenges(account_id, channel, expires_at, consumed_at);
