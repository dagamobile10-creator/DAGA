import pathlib
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATIONS = [
    "0001_daga_core.sql",
    "0002_daga_owner_auth.sql",
    "0003_daga_owner_credentials.sql",
    "0004_daga_offers.sql",
    "0005_daga_store_identity_invitations.sql",
    "0006_daga_public_identity_ids.sql",
]


class InvitationSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        for migration in MIGRATIONS:
            self.db.executescript((ROOT / "migrations" / migration).read_text(encoding="utf-8"))
        self.now = "2026-10-17T00:00:00.000Z"
        self.db.execute(
            "INSERT INTO daga_accounts (id,display_name,role,status) VALUES ('owner','Company owner','store_owner','approved')"
        )
        self.db.execute(
            "INSERT INTO daga_accounts (id,display_name,role,status) VALUES ('employee','Invitee','employee','approved')"
        )
        self.db.execute(
            "INSERT INTO daga_accounts (id,display_name,role,status) VALUES ('employee2','Second invitee','employee','approved')"
        )
        self.db.execute(
            "INSERT INTO daga_stores (id,owner_account_id,legal_identity,display_name,status,public_id) VALUES ('store-a','owner','legal-a','Company A','approved','DAGA-COMPANY-A')"
        )
        self.db.execute(
            "INSERT INTO daga_stores (id,owner_account_id,legal_identity,display_name,status,public_id) VALUES ('store-b','owner','legal-b','Company B','approved','DAGA-COMPANY-B')"
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def invite(self, invite_id="invite-1", store="store-a", token_hash="hash-1", role="employee", status="pending", expires="2026-10-18T00:00:00.000Z"):
        self.db.execute(
            """INSERT INTO daga_store_invitations
            (id,store_id,inviter_account_id,token_hash,intended_role,permissions_json,status,expires_at,max_uses,use_count)
            VALUES (?,?,?,?,?,'{}',?,?,1,0)""",
            (invite_id, store, "owner", token_hash, role, status, expires),
        )
        self.db.commit()

    def test_invitation_token_hash_is_unique(self):
        self.invite()
        with self.assertRaises(sqlite3.IntegrityError):
            self.invite("invite-2", token_hash="hash-1")

    def test_invitation_cannot_exceed_single_use(self):
        self.invite()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE daga_store_invitations SET use_count=2 WHERE id='invite-1'")

    def test_expired_and_revoked_invites_cannot_be_claimed(self):
        self.invite("expired", token_hash="expired-hash", expires="2026-10-16T00:00:00.000Z")
        self.invite("revoked", token_hash="revoked-hash", status="revoked")
        for invite_id in ("expired", "revoked"):
            cur = self.db.execute(
                """UPDATE daga_store_invitations SET status='accepted',use_count=1,accepted_by_account_id='employee',accepted_at=?
                WHERE id=? AND status='pending' AND use_count=0 AND max_uses=1 AND expires_at>?""",
                (self.now, invite_id, self.now),
            )
            self.assertEqual(cur.rowcount, 0)

    def test_acceptance_claim_is_single_use(self):
        self.invite()
        cur = self.db.execute(
            """UPDATE daga_store_invitations SET status='accepted',use_count=1,accepted_by_account_id='employee',accepted_at=?
            WHERE id='invite-1' AND status='pending' AND use_count=0 AND max_uses=1 AND expires_at>?""",
            (self.now, self.now),
        )
        self.assertEqual(cur.rowcount, 1)
        replay = self.db.execute(
            """UPDATE daga_store_invitations SET status='accepted',use_count=1,accepted_by_account_id='employee2',accepted_at=?
            WHERE id='invite-1' AND status='pending' AND use_count=0 AND max_uses=1 AND expires_at>?""",
            (self.now, self.now),
        )
        self.assertEqual(replay.rowcount, 0)

    def test_membership_is_unique_per_company_and_account(self):
        self.invite()
        self.db.execute(
            """INSERT INTO daga_store_memberships
            (id,store_id,account_id,role,status,permissions_json,invited_by_account_id)
            VALUES ('membership-1','store-a','employee','employee','active','{}','owner')"""
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO daga_store_memberships
                (id,store_id,account_id,role,status,permissions_json,invited_by_account_id)
                VALUES ('membership-2','store-a','employee','manager','active','{}','owner')"""
            )

    def test_membership_for_another_company_is_a_distinct_scope(self):
        self.db.execute(
            """INSERT INTO daga_store_memberships
            (id,store_id,account_id,role,status,permissions_json,invited_by_account_id)
            VALUES ('membership-a','store-a','employee','employee','active','{}','owner')"""
        )
        self.db.execute(
            """INSERT INTO daga_store_memberships
            (id,store_id,account_id,role,status,permissions_json,invited_by_account_id)
            VALUES ('membership-b','store-b','employee','employee','active','{}','owner')"""
        )
        rows = self.db.execute(
            "SELECT store_id FROM daga_store_memberships WHERE account_id='employee' ORDER BY store_id"
        ).fetchall()
        self.assertEqual([row["store_id"] for row in rows], ["store-a", "store-b"])

    def test_api_guards_role_escalation_and_authentication(self):
        src = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        self.assertIn("authenticatedAccount(request, db)", src)
        self.assertIn('authority.role === "manager" && intendedRole !== "employee"', src)
        self.assertIn('intendedRole === "manager" && authority.role !== "store_owner"', src)
        self.assertIn('u.protocol !== "https:"', src)
        self.assertIn("await sha256(token)", src)
        self.assertIn('authority.role === "manager" && !authority.permissions.inviteEmployees', src)
        self.assertIn('WHERE store_id=? AND inviter_account_id=?', src)
        self.assertIn('invite.inviter_account_id !== account.id', src)


if __name__ == "__main__":
    unittest.main(verbosity=2)
