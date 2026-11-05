ALTER TABLE daga_plans ADD COLUMN owner_archived_at TEXT;
ALTER TABLE daga_payment_submissions ADD COLUMN owner_archived_at TEXT;
CREATE INDEX IF NOT EXISTS idx_daga_plans_owner_visible ON daga_plans(owner_archived_at,is_active,service);
CREATE INDEX IF NOT EXISTS idx_daga_payments_owner_visible ON daga_payment_submissions(owner_archived_at,status,submitted_at);
