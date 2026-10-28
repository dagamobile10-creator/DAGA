#!/usr/bin/env python3
"""SQLite regression tests for LIVE DAGA character-balance debit rules."""
import sqlite3
import unittest

DEBIT_SQL = """INSERT INTO daga_live_word_ledger
(id,account_id,store_id,event_type,words,request_id,note)
SELECT ?,?,?,'debit',?,?,?
WHERE (
  SELECT COALESCE(SUM(CASE WHEN event_type IN ('credit','adjustment','refund')
                           THEN words ELSE -words END),0)
  FROM daga_live_word_ledger WHERE store_id=?
) >= ?
AND EXISTS (
  SELECT 1 FROM daga_entitlements
  WHERE store_id=? AND service='live_daga' AND status='active'
    AND starts_at<=? AND expires_at>?
)"""

class LiveDagaQuotaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.executescript("""
          CREATE TABLE daga_live_word_ledger(
            id TEXT PRIMARY KEY, account_id TEXT NOT NULL, store_id TEXT NOT NULL,
            event_type TEXT NOT NULL, words INTEGER NOT NULL CHECK(words > 0),
            request_id TEXT UNIQUE, note TEXT NOT NULL DEFAULT '');
          CREATE TABLE daga_entitlements(
            id TEXT PRIMARY KEY, store_id TEXT NOT NULL, service TEXT NOT NULL,
            status TEXT NOT NULL, starts_at TEXT NOT NULL, expires_at TEXT NOT NULL);
          INSERT INTO daga_entitlements VALUES
            ('e1','store1','live_daga','active','2026-01-01T00:00:00.000Z','2027-01-01T00:00:00.000Z');
          INSERT INTO daga_live_word_ledger VALUES
            ('c1','acct1','store1','credit',10,'credit-order-1','test credit');
        """)
        self.now = "2026-10-26T12:00:00.000Z"

    def debit(self, amount, request_id):
        before = self.db.total_changes
        self.db.execute(DEBIT_SQL, (
            "d-"+request_id, "acct1", "store1", amount, request_id, "test debit",
            "store1", amount, "store1", self.now, self.now))
        self.db.commit()
        return self.db.total_changes - before

    def remaining(self):
        row = self.db.execute("""SELECT COALESCE(SUM(CASE
          WHEN event_type IN ('credit','adjustment','refund') THEN words
          ELSE -words END),0) FROM daga_live_word_ledger WHERE store_id='store1'""").fetchone()
        return row[0]

    def test_exact_balance_can_be_used_and_reaches_zero(self):
        self.assertEqual(self.debit(10, "request-exact-001"), 1)
        self.assertEqual(self.remaining(), 0)

    def test_insufficient_balance_does_not_debit_or_go_negative(self):
        self.assertEqual(self.debit(11, "request-too-large-001"), 0)
        self.assertEqual(self.remaining(), 10)

    def test_active_entitlement_is_required(self):
        self.db.execute("UPDATE daga_entitlements SET expires_at='2026-10-01T00:00:00.000Z'")
        self.db.commit()
        self.assertEqual(self.debit(1, "request-expired-001"), 0)
        self.assertEqual(self.remaining(), 10)

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

    def test_future_subscription_does_not_allow_live_usage(self):
        self.db.execute("UPDATE daga_entitlements SET starts_at='2026-11-01T00:00:00.000Z'")
        self.db.commit()
        self.assertEqual(self.debit(1, "request-not-started-001"), 0)
        self.assertEqual(self.remaining(), 10)

    def test_unicode_character_count_uses_code_points(self):
        # Python len on Unicode strings matches the code-point count of JS Array.from.
        self.assertEqual(len("ضجّة🙂"), 5)

if __name__ == "__main__":
    unittest.main(verbosity=2)
