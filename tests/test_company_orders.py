import pathlib
import re
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATIONS = [
    "0001_daga_core.sql", "0002_daga_owner_auth.sql",
    "0003_daga_owner_credentials.sql", "0004_daga_offers.sql",
    "0005_daga_store_identity_invitations.sql", "0006_daga_public_identity_ids.sql",
    "0007_daga_company_registration_challenges.sql", "0008_daga_company_login_challenges.sql",
]


class CompanyOrderRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / "company-orders.js").read_text(encoding="utf-8")
        cls.worker = (ROOT / "worker.js").read_text(encoding="utf-8")

    def test_routes_are_wired_into_worker(self):
        self.assertIn('import { handleCompanyOrders } from "./company-orders.js";', self.worker)
        self.assertIn("const companyOrderResponse = await handleCompanyOrders(request, env, url);", self.worker)

    def test_all_routes_require_an_authenticated_store_owner(self):
        handler = self.source[self.source.index("export async function handleCompanyOrders"):self.source.index("async function ownedApprovedStore")]
        self.assertIn("authenticatedAccount(request, db)", handler)
        self.assertIn('account.role !== "store_owner"', handler)
        self.assertIn('return json(env, { error: "authentication_required" }, 401)', handler)
        self.assertIn('return json(env, { error: "store_owner_required" }, 403)', handler)

    def test_order_is_bound_to_approved_store_owned_by_session_account(self):
        self.assertIn("async function ownedApprovedStore(db, accountId, storeId)", self.source)
        self.assertIn("WHERE id=? AND owner_account_id=? AND status='approved'", self.source)
        self.assertIn("approved_owned_store_required", self.source)
        self.assertIn("WHERE id=? AND owner_account_id=? AND status='approved')", self.source)

    def test_price_is_calculated_server_side_and_snapshotted(self):
        self.assertIn("Math.floor(Number(plan.price_minor) * Number(offer.discount_value) / 100)", self.source)
        self.assertIn("Math.min(Number(plan.price_minor), Number(offer.discount_value))", self.source)
        self.assertIn("Math.max(0, listPrice - discount)", self.source)
        self.assertIn("agreed_price_minor", self.source)
        self.assertIn("daga_order_price_adjustments", self.source)
        self.assertNotRegex(self.source, r"body\\.(?:price|amount|discountMinor|agreedPriceMinor)")

    def test_offer_is_active_in_window_and_redemption_limit_is_atomic(self):
        self.assertIn("starts_at IS NULL OR starts_at<=?", self.source)
        self.assertIn("ends_at IS NULL OR ends_at>?", self.source)
        self.assertIn("redemption_count<max_redemptions", self.source)
        self.assertIn("UPDATE daga_offers SET redemption_count=redemption_count+1", self.source)
        self.assertIn("RETURNING id", self.source)

    def test_payment_submission_uses_server_price_and_cannot_activate_entitlement(self):
        self.assertIn("Number(order.agreed_price_minor)", self.source)
        self.assertIn("status='awaiting_payment'", self.source)
        self.assertIn("'pending_review'", self.source)
        self.assertNotIn("INSERT INTO daga_entitlements", self.source)
        self.assertNotIn("INSERT INTO daga_live_word_ledger", self.source)

    def test_schema_supports_order_adjustment_and_unique_entitlement(self):
        db = sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys=ON")
        for migration in MIGRATIONS:
            db.executescript((ROOT / "migrations" / migration).read_text(encoding="utf-8"))
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertIn("daga_plan_orders", tables)
        self.assertIn("daga_payment_submissions", tables)
        self.assertIn("daga_order_price_adjustments", tables)
        indexes = db.execute("PRAGMA index_list(daga_order_price_adjustments)").fetchall()
        unique_cols = [[row[2] for row in db.execute("PRAGMA index_info(" + idx[1] + ")")] for idx in indexes if idx[2]]
        self.assertIn(["order_id"], unique_cols)
        db.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
