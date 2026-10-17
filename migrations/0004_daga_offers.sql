PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS daga_offers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  service TEXT NOT NULL CHECK (service IN ('store','live_daga')),
  discount_type TEXT NOT NULL CHECK (discount_type IN ('fixed_minor','percent')),
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
CREATE INDEX IF NOT EXISTS daga_offers_service_active ON daga_offers(service,is_active,starts_at,ends_at);

CREATE TABLE IF NOT EXISTS daga_order_price_adjustments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES daga_plan_orders(id),
  offer_id TEXT REFERENCES daga_offers(id),
  list_price_minor INTEGER NOT NULL CHECK (list_price_minor >= 0),
  discount_minor INTEGER NOT NULL CHECK (discount_minor >= 0),
  final_price_minor INTEGER NOT NULL CHECK (final_price_minor >= 0),
  offer_name_snapshot TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
