-- V30 shop onboarding contact and separate approval lifecycle.
ALTER TABLE daga_shop_registration_challenges ADD COLUMN contact_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE daga_stores ADD COLUMN contact_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE daga_stores ADD COLUMN onboarding_status TEXT NOT NULL DEFAULT 'pending';
CREATE INDEX IF NOT EXISTS daga_stores_onboarding_status ON daga_stores(onboarding_status, created_at);
ALTER TABLE daga_stores ADD COLUMN onboarding_order_id TEXT;
ALTER TABLE daga_stores ADD COLUMN onboarding_payment_method_id TEXT;
