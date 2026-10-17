-- DAGA V30 promotions/discounts. Apply after migrations 0001-0003.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS daga_promotions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  service TEXT NOT NULL CHECK (service IN ('store','live_daga','both')),
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent','fixed')),
  discount_value INTEGER NOT NULL CHECK (discount_value > 0),
  starts_at TEXT,
  ends_at TEXT,
  max_redemptions INTEGER,
  redemption_count INTEGER NOT NULL DEFAULT 0 CHECK (redemption_count >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_by TEXT NOT NULL REFERENCES daga_accounts(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (discount_type != 'percent' OR discount_value <= 100)
);
CREATE INDEX IF NOT EXISTS daga_promotions_active_dates ON daga_promotions(is_active, starts_at, ends_at);

-- Snapshot the list price and discount separately at order creation. Later promo edits do not rewrite existing orders.
ALTER TABLE daga_plan_orders ADD COLUMN list_price_minor INTEGER;
ALTER TABLE daga_plan_orders ADD COLUMN promotion_id TEXT REFERENCES daga_promotions(id);
ALTER TABLE daga_plan_orders ADD COLUMN discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0);
