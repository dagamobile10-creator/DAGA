from pathlib import Path
import sqlite3
import unittest

ROOT = Path(__file__).resolve().parents[1]

class ShopDashboardStateTests(unittest.TestCase):
    def test_migration_creates_tenant_scoped_revisioned_snapshot(self):
        db = sqlite3.connect(":memory:")
        db.executescript("CREATE TABLE daga_stores(id TEXT PRIMARY KEY); CREATE TABLE daga_accounts(id TEXT PRIMARY KEY);")
        db.executescript((ROOT / "migrations/0019_shop_dashboard_state.sql").read_text(encoding="utf-8"))
        db.execute("INSERT INTO daga_stores(id) VALUES ('store-a'),('store-b')")
        db.execute("INSERT INTO daga_accounts(id) VALUES ('owner-a'),('owner-b')")
        db.execute("INSERT INTO daga_shop_dashboard_state(store_id,revision,payload_json,updated_by) VALUES (?,?,?,?)", ("store-a", 1, '{"cols":[],"ledger":[],"closedDays":[]}', "owner-a"))
        self.assertEqual(db.execute("SELECT revision FROM daga_shop_dashboard_state WHERE store_id='store-a'").fetchone()[0], 1)
        self.assertIsNone(db.execute("SELECT revision FROM daga_shop_dashboard_state WHERE store_id='store-b'").fetchone())

    def test_api_requires_authenticated_store_scope_and_revision(self):
        source = (ROOT / "shop-dashboard-state.js").read_text(encoding="utf-8")
        self.assertIn("authenticatedAccount(request, db)", source)
        self.assertIn("account.store_id", source)
        self.assertIn("store.owner_account_id !== account.id", source)
        self.assertIn("dashboard_state_revision_conflict", source)
        self.assertIn("expectedRevision", source)
        self.assertIn("daga_audit_log", source)
        self.assertIn("validateState(state)", source)

    def test_worker_routes_dashboard_state_api(self):
        worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        self.assertIn('import { handleShopDashboardState } from "./shop-dashboard-state.js";', worker)
        self.assertIn("handleShopDashboardState(request, env, url)", worker)

    def test_staging_only_workflow_applies_new_migration(self):
        workflow = (ROOT / ".github/workflows/daga-staging-setup.yml").read_text(encoding="utf-8")
        self.assertIn("migrations/0019_shop_dashboard_state.sql", workflow)
        self.assertIn('name = "daga-app-staging"', workflow)

if __name__ == "__main__":
    unittest.main()
