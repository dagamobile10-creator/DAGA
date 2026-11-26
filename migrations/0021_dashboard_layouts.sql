-- DAGA configurable dashboard layouts (staging feature)
-- Global layout is the default for every company. A company-specific row is an
-- explicit override and must never be overwritten by later global changes.
CREATE TABLE IF NOT EXISTS daga_dashboard_layouts (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('global','store')),
  store_id TEXT REFERENCES daga_stores(id) ON DELETE CASCADE,
  layout_json TEXT NOT NULL DEFAULT '{"version":1,"columns":[]}',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by TEXT REFERENCES daga_accounts(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((scope = 'global' AND store_id IS NULL) OR (scope = 'store' AND store_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS daga_dashboard_layouts_global_unique
  ON daga_dashboard_layouts(scope) WHERE scope = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS daga_dashboard_layouts_store_unique
  ON daga_dashboard_layouts(store_id) WHERE scope = 'store';
CREATE INDEX IF NOT EXISTS daga_dashboard_layouts_updated
  ON daga_dashboard_layouts(updated_at);

-- Keep a versioned snapshot for safe review/rollback and auditability.
CREATE TABLE IF NOT EXISTS daga_dashboard_layout_versions (
  id TEXT PRIMARY KEY,
  layout_id TEXT NOT NULL REFERENCES daga_dashboard_layouts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  layout_json TEXT NOT NULL,
  changed_by TEXT REFERENCES daga_accounts(id),
  change_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(layout_id, version)
);
CREATE INDEX IF NOT EXISTS daga_dashboard_layout_versions_history
  ON daga_dashboard_layout_versions(layout_id, version DESC);
