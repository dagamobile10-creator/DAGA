-- DAGA V30 stable public identities for every company and every account.
-- Public IDs identify records; they are not credentials and must never grant access.
PRAGMA foreign_keys = ON;

ALTER TABLE daga_accounts ADD COLUMN public_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS daga_accounts_public_id_unique
  ON daga_accounts(public_id) WHERE public_id IS NOT NULL;

-- Backfill existing records deterministically so names/roles can change without changing identity.
UPDATE daga_accounts
SET public_id = 'DAGA-USER-' || upper(replace(id, '-', ''))
WHERE public_id IS NULL OR trim(public_id) = '';

UPDATE daga_stores
SET public_id = 'DAGA-COMPANY-' || upper(replace(id, '-', ''))
WHERE public_id IS NULL OR trim(public_id) = '';

CREATE UNIQUE INDEX IF NOT EXISTS daga_stores_public_id_unique_v2
  ON daga_stores(public_id) WHERE public_id IS NOT NULL;
