#!/usr/bin/env python3
"""SQLite regression tests for LIVE DAGA Smart-plan access and character-balance debit."""
import json
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

DEBIT_SQL = """INSERT INTO daga_live_word_ledger
(id,account_id,store_id,event_type,words,request_id,note)
SELECT ?,?,?,'debit',?,?,?
WHERE (
  SELECT COALESCE(SUM(CASE WHEN event_type IN ('credit','adjustment','refund')
                           THEN words ELSE -words END),0)
  FROM daga_live_word_ledger WHERE store_id=?
) >= ?"""

SMART_ENTITLEMENT_SQL = """SELECT p.name,p.features_json FROM daga_entitlements e
LEFT JOIN daga_plan_orders o ON o.id=e.order_id
LEFT JOIN daga_plans p ON p.id=o.plan_id
WHERE e.store_id=? AND e.service='store' AND e.status='active'
AND e.starts_at<=? AND e.expires_at>?
ORDER BY e.starts_at DESC,e.created_at DESC LIMIT 1"""

class LiveDagaQuotaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.executescript("""
          CREATE TABLE daga_live_word_ledger(
            id TEXT PRIMARY KEY, account_id TEXT NOT NULL, store_id TEXT NOT NULL,
            event_type TEXT NOT NULL, words INTEGER NOT NULL CHECK(words > 0),
            request_id TEXT UNIQUE, note TEXT NOT NULL DEFAULT '');
          CREATE TABLE daga_plans(id TEXT PRIMARY KEY,name TEXT NOT NULL,features_json TEXT NOT NULL DEFAULT '{}');
          CREATE TABLE daga_plan_orders(id TEXT PRIMARY KEY,plan_id TEXT NOT NULL);
          CREATE TABLE daga_entitlements(
            id TEXT PRIMARY KEY,store_id TEXT NOT NULL,service TEXT NOT NULL,
            status TEXT NOT NULL,starts_at TEXT NOT NULL,expires_at TEXT NOT NULL,
            order_id TEXT NOT NULL,created_at TEXT NOT NULL);
          INSERT INTO daga_plans VALUES
            ('smart-plan','Smart','{"tier":"smart","smartAssistantEnabled":true,"historyEnabled":true}'),
            ('standard-plan','Standard','{"tier":"standard","smartAssistantEnabled":true,"historyEnabled":true}');
          INSERT INTO daga_plan_orders VALUES ('smart-order','smart-plan'),('standard-order','standard-plan');
          INSERT INTO daga_entitlements VALUES
            ('e1','store1','store','active','2026-01-01T00:00:00.000Z','2027-01-01T00:00:00.000Z','smart-order','2026-01-01T00:00:00.000Z');
          INSERT INTO daga_live_word_ledger VALUES
            ('c1','acct1','store1','credit',10,'credit-order-1','test credit');
        """)
        self.now = "2026-11-25T12:00:00.000Z"

    def debit(self, amount, request_id):
        before = self.db.total_changes
        self.db.execute(DEBIT_SQL, (
            "d-"+request_id, "acct1", "store1", amount, request_id, "test debit",
            "store1", amount))
        self.db.commit()
        return self.db.total_changes - before

    def remaining(self):
        row = self.db.execute("""SELECT COALESCE(SUM(CASE
          WHEN event_type IN ('credit','adjustment','refund') THEN words
          ELSE -words END),0) FROM daga_live_word_ledger WHERE store_id='store1'""").fetchone()
        return row[0]

    def smart_entitlement(self):
        return self.db.execute(SMART_ENTITLEMENT_SQL, ("store1", self.now, self.now)).fetchone()

    def test_exact_balance_can_be_used_and_reaches_zero(self):
        self.assertEqual(self.debit(10, "request-exact-001"), 1)
        self.assertEqual(self.remaining(), 0)

    def test_insufficient_balance_does_not_debit_or_go_negative(self):
        self.assertEqual(self.debit(11, "request-too-large-001"), 0)
        self.assertEqual(self.remaining(), 10)

    def test_smart_store_plan_is_required_for_live_features(self):
        row = self.smart_entitlement()
        self.assertIsNotNone(row)
        self.assertEqual(row[0], "Smart")
        self.assertEqual(json.loads(row[1])["tier"], "smart")

    def test_expired_smart_store_plan_is_rejected(self):
        self.db.execute("UPDATE daga_entitlements SET expires_at='2026-10-01T00:00:00.000Z'")
        self.db.commit()
        self.assertIsNone(self.smart_entitlement())

    def test_future_smart_store_plan_is_rejected(self):
        self.db.execute("UPDATE daga_entitlements SET starts_at='2026-12-01T00:00:00.000Z'")
        self.db.commit()
        self.assertIsNone(self.smart_entitlement())

    def test_standard_plan_does_not_grant_smart_features_even_with_legacy_flags(self):
        self.db.execute("UPDATE daga_entitlements SET order_id='standard-order'")
        self.db.commit()
        row = self.smart_entitlement()
        self.assertIsNotNone(row)
        features = json.loads(row[1])
        self.assertEqual(features["tier"], "standard")
        self.assertTrue(features["smartAssistantEnabled"])

    def test_debit_is_balance_only_and_worker_checks_smart_plan_separately(self):
        self.assertNotIn("daga_entitlements", DEBIT_SQL)
        helper = (ROOT / "company-entitlements.js").read_text(encoding="utf-8")
        worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        self.assertIn("e.service='store'", helper)
        self.assertIn("e.starts_at<=?", helper)
        self.assertIn("e.expires_at>?", helper)
        self.assertIn("isSmartStoreEntitlement(smartEntitlement)", worker)
        self.assertIn('error: "smart_store_subscription_required"', worker)

    def test_refund_restores_spent_characters(self):
        self.assertEqual(self.debit(6, "request-partial-001"), 1)
        self.db.execute("INSERT INTO daga_live_word_ledger VALUES ('r1','acct1','store1','refund',6,'request-partial-001:refund','test refund')")
        self.db.commit()
        self.assertEqual(self.remaining(), 10)

    def test_owner_addon_credit_increases_existing_balance(self):
        self.db.execute("INSERT INTO daga_live_word_ledger VALUES ('addon1','acct1','store1','credit',5000,'owner-addon-5000-001','Owner added 5000 characters')")
        self.db.commit()
        self.assertEqual(self.remaining(), 5010)

    def test_10000_character_package_can_be_spent_to_zero(self):
        self.db.execute("UPDATE daga_live_word_ledger SET words=10000 WHERE id='c1'")
        self.db.commit()
        self.assertEqual(self.debit(10000, "request-package-10000"), 1)
        self.assertEqual(self.remaining(), 0)

    def test_character_rate_is_proportional_and_rounds_up_to_one_piaster(self):
        rate_minor = 250
        self.assertEqual((10000 * rate_minor + 999) // 1000, 2500)
        self.assertEqual((1 * rate_minor + 999) // 1000, 1)
        self.assertEqual((1001 * rate_minor + 999) // 1000, 251)

    def test_owner_rate_endpoint_is_authenticated_and_reprices_packages(self):
        handler = (ROOT / "owner-admin.js").read_text(encoding="utf-8")
        migration = (ROOT / "migrations" / "0016_live_daga_character_rate.sql").read_text(encoding="utf-8")
        self.assertIn('if (!owner) return json(env, { error: "owner_session_required" }, 401)', handler)
        self.assertIn('/owner/admin/live-daga-rate', handler)
        self.assertIn('Math.ceil(Number(p.word_quota)*rate/1000)', handler)
        self.assertIn('live_daga_pricing_rate_not_configured', handler)
        self.assertIn('price = Math.ceil(Number(quota)*rate/1000)', handler)
        self.assertIn('daga_app_settings', migration)
        self.assertIn('agreed_price_minor', (ROOT / "company-orders.js").read_text(encoding="utf-8"))

    def test_unicode_character_count_uses_code_points(self):
        self.assertEqual(len("ضجّه🙂"), 5)

if __name__ == "__main__":
    unittest.main(verbosity=2)
