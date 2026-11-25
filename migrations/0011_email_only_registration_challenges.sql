-- Remove legacy phone-channel challenges; all company verification is email-only.
-- Historical migration 0007 remains immutable, while this forward migration
-- enforces the current policy at the database level as well as in the API.
PRAGMA foreign_keys = ON;

CREATE TABLE daga_company_registration_challenges_email_only (
  id TEXT PRIMARY KEY,
  invitation_token_hash TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel = 'email'),
  destination_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at TEXT,
  claim_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO daga_company_registration_challenges_email_only
  (id, invitation_token_hash, channel, destination_hash, code_hash, expires_at, attempts, consumed_at, claim_id, created_at)
SELECT id, invitation_token_hash, channel, destination_hash, code_hash, expires_at, attempts, consumed_at, claim_id, created_at
FROM daga_company_registration_challenges
WHERE channel = 'email';

DROP TABLE daga_company_registration_challenges;
ALTER TABLE daga_company_registration_challenges_email_only RENAME TO daga_company_registration_challenges;

CREATE INDEX IF NOT EXISTS daga_company_registration_lookup
  ON daga_company_registration_challenges(invitation_token_hash, channel, expires_at, consumed_at);
