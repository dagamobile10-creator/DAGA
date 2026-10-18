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
    "0009_daga_payment_submission_uniqueness.sql",
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

    def test_order_listing_and_payment_submission_are_scoped_to_the_authenticated_owner(self):
        self.assertIn("WHERE o.account_id=? AND o.store_id=?", self.source)
        self.assertIn(".bind(account.id, storeId).all()", self.source)
        self.assertIn("WHERE id=? AND account_id=?", self.source)
        self.assertIn("ownedApprovedStore(db, account.id, order.store_id)", self.source)
        self.assertIn("WHERE id=? AND owner_account_id=? AND status='approved'", self.source)

    def test_order_creation_cannot_cross_company_or_trust_client_identity(self):
        create_start = self.source.index('if (path === "/api/company/orders" && request.method === "POST")')
        create_end = self.source.index("if (orderPayment && request.method === \"POST\")", create_start)
        create_handler = self.source[create_start:create_end]
        self.assertIn("ownedApprovedStore(db, account.id, storeId)", create_handler)
        self.assertIn("account.id", create_handler)
        self.assertNotRegex(create_handler, r"body\\.(?:accountId|ownerId|userId)")
        self.assertIn("owner_account_id=? AND status='approved'", create_handler)

    def test_price_is_calculated_server_side_and_snapshotted(self):
        self.assertIn("Math.floor(Number(plan.price_minor) * Number(offer.discount_value) / 100)", self.source)
        self.assertIn("Math.min(Number(plan.price_minor), Number(offer.discount_value))", self.source)
        self.assertIn("Math.max(0, listPrice - discount)", self.source)
        self.assertIn("agreed_price_minor", self.source)
        self.assertIn("daga_order_price_adjustments", self.source)
        self.assertIn('/api/company/offers', self.source)
        self.assertIn("offer_name_snapshot", self.source)
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

    def test_company_portal_exposes_checkout_only_to_store_owner_and_uses_authenticated_apis(self):
        portal = (ROOT / "company" / "portal.html").read_text(encoding="utf-8")
        for element_id in ("checkoutCard", "checkoutService", "checkoutPlan", "checkoutOffer", "createOrder", "paymentMethod", "transactionReference", "receiptUrl", "submitPayment", "orders"):
            self.assertIn('id="' + element_id + '"', portal)
        self.assertIn('activeCompany.role==="store_owner"', portal)
        self.assertIn('/api/company/plans?service=', portal)
        self.assertIn('/api/company/orders', portal)
        self.assertIn('/api/company/payment-methods', portal)
        self.assertIn('/api/company/offers?service=', portal)
        self.assertIn("offerId:offerId||null", portal)
        self.assertIn("function orderStatusLabel(value)", portal)
        self.assertIn("مستني مراجعة المالك", portal)
        self.assertIn('الاشتراك مش هيتفعل قبل التأكيد', portal)

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


    def test_order_creation_requires_successful_immutable_price_snapshot(self):
        start = self.source.index('if (path === "/api/company/orders" && request.method === "POST")')
        end = self.source.index('if (orderPayment && request.method === "POST")', start)
        handler = self.source[start:end]
        self.assertIn('Number(results?.[0]?.meta?.changes || 0) !== 1', handler)
        self.assertIn('Number(results?.[1]?.meta?.changes || 0) !== 1', handler)
        self.assertIn('error: "order_price_snapshot_failed"', handler)
        self.assertIn('DELETE FROM daga_plan_orders WHERE id=? AND account_id=? AND status=\'awaiting_payment\'', handler)
        self.assertLess(handler.index('error: "order_price_snapshot_failed"'), handler.index('status: "awaiting_payment" } }, 201'))


    def test_only_one_pending_payment_submission_per_order_is_allowed(self):
        db = sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys=ON")
        for migration in MIGRATIONS:
            db.executescript((ROOT / "migrations" / migration).read_text(encoding="utf-8"))
        db.execute("INSERT INTO daga_accounts (id,display_name,phone_e164,email,password_hash,role,status,created_at,updated_at) VALUES ('acct','Shop','+201000000000','shop@example.com','hash','store_owner','approved','2026-01-01','2026-01-01')")
        db.execute("INSERT INTO daga_stores (id,owner_account_id,legal_identity,display_name,status) VALUES ('store','acct','legal-1','Shop','approved')")
        db.execute("INSERT INTO daga_plans (id,service,name,price_minor,currency,duration_days,is_active,version) VALUES ('plan','store','Monthly',10000,'EGP',30,1,1)")
        db.execute("INSERT INTO daga_payment_methods (id,provider,display_label,destination_value,is_active) VALUES ('method','vodafone_cash','Vodafone Cash','01000000000',1)")
        db.execute("INSERT INTO daga_plan_orders (id,account_id,store_id,plan_id,plan_version,agreed_price_minor,currency,status) VALUES ('order','acct','store','plan',1,10000,'EGP','payment_submitted')")
        db.execute("INSERT INTO daga_payment_submissions (id,order_id,payment_method_id,claimed_amount_minor,status) VALUES ('pay-1','order','method',10000,'pending_review')")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO daga_payment_submissions (id,order_id,payment_method_id,claimed_amount_minor,status) VALUES ('pay-2','order','method',10000,'pending_review')")
        db.execute("UPDATE daga_payment_submissions SET status='rejected' WHERE id='pay-1'")
        db.execute("INSERT INTO daga_payment_submissions (id,order_id,payment_method_id,claimed_amount_minor,status) VALUES ('pay-3','order','method',10000,'pending_review')")
        db.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
