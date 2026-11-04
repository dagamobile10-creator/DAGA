-- DAGA V30: archive cancelled companies from the owner dashboard without destroying financial history.
ALTER TABLE daga_stores ADD COLUMN archived_at TEXT;
CREATE INDEX IF NOT EXISTS daga_stores_archived_created
  ON daga_stores(archived_at, created_at);
