-- DAGA V30 store identity and invitation foundation.
-- Apply only to a dedicated staging D1 database after review.
PRAGMA foreign_keys = ON;

-- Stable, non-secret identifier suitable for displaying in a store QR.
-- Existing stores can be backfilled by the onboarding implementation before rollout.
ALTER TABLE daga_stores ADD COLUMN public_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS daga_stores_public_id_unique ON daga_stores(public_id) WHERE public_id IS NOT NULL;

-- Membership is explicit and scoped to one store. Role never comes from the client.
CREATE TABLE IF NOT EXISTS daga_store_memberships (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES daga_stores(id),
  account_id TEXT NOT NULL REFERENCES daga_accounts(id),
  role TEXT NOT NULL CHECK (role IN ('manager','employee')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','removed')),
  permissions_json TEXT NOT NULL DEFAULT '{}',
  invited_by_account_id TEXT NOT NULL REFERENCES daga_accounts(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(store_id, account_id)
);
CREATE INDEX IF NOT EXISTS daga_store_memberships_account_status
  ON daga_store_memberships(account_id, status);
CREATE INDEX IF NOT EXISTS daga_store_memberships_store_status
  ON daga_store_memberships(store_id, status);

-- Store invite tokens are random bearer secrets; only their SHA-256 hashes are stored.
-- Default invitations are single-use. The raw token is returned once by the future API.
CREATE TABLE IF NOT EXISTS daga_store_invitations (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES daga_stores(id),
  inviter_account_id TEXT NOT NULL REFERENCES daga_accounts(id),
  token_hash TEXT NOT NULL UNIQUE,
  intended_role TEXT NOT NULL CHECK (intended_role IN ('manager','employee')),
  permissions_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired')),
  expires_at TEXT NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses = 1),
  use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count BETWEEN 0 AND max_uses),
  accepted_by_account_id TEXT REFERENCES daga_accounts(id),
  accepted_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS daga_store_invitations_store_status
  ON daga_store_invitations(store_id, status, expires_at);
