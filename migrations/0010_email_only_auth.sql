-- DAGA email-only authentication for company owners, managers, and employees.
-- Apply only to the intended staging/application D1 database after backup and review.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS daga_account_credentials (
  account_id TEXT PRIMARY KEY REFERENCES daga_accounts(id),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 310000,
  recovery_code_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Phone numbers are no longer authentication identifiers or verification channels.
UPDATE daga_accounts SET phone_e164=NULL, phone_verified_at=NULL;
