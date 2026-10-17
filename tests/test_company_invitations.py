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
    "0007_daga_company_registration_challenges.sql",
    "0008_daga_company_login_challenges.sql",
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

    def test_registration_challenges_store_only_hashes_and_limit_attempts(self):
        columns = {row["name"] for row in self.db.execute("PRAGMA table_info(daga_company_registration_challenges)")}
        self.assertTrue({"invitation_token_hash", "channel", "destination_hash", "code_hash", "expires_at", "attempts", "consumed_at", "claim_id"} <= columns)
        login_columns = {row["name"] for row in self.db.execute("PRAGMA table_info(daga_company_login_challenges)")}
        self.assertTrue({"account_id", "channel", "destination_hash", "code_hash", "expires_at", "attempts", "consumed_at", "claim_id"} <= login_columns)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO daga_company_registration_challenges
              (id,invitation_token_hash,channel,destination_hash,code_hash,expires_at,attempts)
              VALUES ('bad','hash','phone','dest','hash','2026-10-18T00:00:00.000Z',6)""")

    def test_registration_page_does_not_accept_single_use_invitation_twice(self):
        page = (ROOT / "invite" / "index.html").read_text(encoding="utf-8")
        start = page.index('$("verifyRegister").addEventListener')
        end = page.index('$("sendLogin")', start)
        handler = page[start:end]
        self.assertIn("data.membership?.role", handler)
        self.assertNotIn("await acceptInvite()", handler)
        self.assertIn("تم إنشاء الحساب وقبول الدعوة بنجاح", handler)

    def test_invitation_token_is_removed_from_visible_url_immediately(self):
        page = (ROOT / "invite" / "index.html").read_text(encoding="utf-8")
        self.assertIn('history.replaceState(null, "", location.pathname)', page)
        self.assertLess(page.index("history.replaceState(null, \"\", location.pathname)"), page.index("function say(message, kind)"))

    def test_invitation_page_does_not_persist_bearer_secrets(self):
        page = (ROOT / "invite" / "index.html").read_text(encoding="utf-8")
        self.assertIn('name="referrer" content="no-referrer"', page)
        self.assertIn('credentials:"omit"', page)
        self.assertNotIn("localStorage", page)
        self.assertNotIn("sessionStorage", page)
        self.assertIn("/api/company/invitations/accept", page)
        self.assertIn("/api/company/auth/register/verify", page)
        self.assertIn("/api/company/auth/login/verify", page)

    def test_company_owner_provisioning_is_program_owner_only(self):
        admin = (ROOT / "owner-admin.js").read_text(encoding="utf-8")
        console = (ROOT / "owner-console.html").read_text(encoding="utf-8")
        self.assertIn('if(path==="/owner/admin/stores"&&request.method==="POST")', admin)
        self.assertIn("authenticatedOwner(request, db)", admin)
        self.assertIn("DAGA-COMPANY-", admin)
        self.assertIn("DAGA-USER-", admin)
        self.assertIn("companyOwnerForm", console)

    def test_company_portal_supports_invite_creation_and_revocation(self):
        portal = (ROOT / "company" / "portal.html").read_text(encoding="utf-8")
        self.assertIn("/api/company/auth/login/verify", portal)
        self.assertIn("/api/company/auth/me", portal)
        self.assertIn("/api/company/invitations", portal)
        self.assertIn("/revoke", portal)
        self.assertIn("navigator.share", portal)
        self.assertNotIn("localStorage", portal)
        self.assertNotIn("sessionStorage", portal)

    def test_official_qr_page_is_separate_from_invitation_qr(self):
        page = (ROOT / "go" / "index.html").read_text(encoding="utf-8")
        worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        self.assertIn("DAGA", page)
        self.assertIn('location.origin+"/go/"', page)
        self.assertIn("new QRCode", page)
        self.assertNotIn("api.qrserver.com", page)
        self.assertIn('url.pathname === "/go"', worker)
        self.assertIn('url.pathname === "/invite"', worker)
        self.assertIn('url.pathname === "/company"', worker)

    def test_existing_membership_does_not_consume_another_invitation(self):
        source = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        start = source.index("async function acceptInvitation(")
        end = source.index("\nasync function revokeInvitation", start)
        handler = source[start:end]
        self.assertIn("AND NOT EXISTS (SELECT 1 FROM daga_store_memberships m WHERE m.store_id=daga_store_invitations.store_id AND m.account_id=?)", handler)
        self.assertIn(".bind(account.id, now, invite.id, tokenHash, now, account.id)", handler)
        self.assertIn("const inserted = Number(results?.[1]?.meta?.changes || 0)", handler)

    def test_invitation_registration_is_atomic_with_membership_and_token_claim(self):
        source = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        start = source.index("async function registerVerify(")
        end = source.index("\nasync function companyRateLimit", start)
        handler = source[start:end]
        self.assertIn("UPDATE daga_store_invitations SET status='accepted',use_count=1", handler)
        self.assertIn("AND status='pending' AND use_count=0 AND max_uses=1", handler)
        self.assertIn("INSERT INTO daga_store_memberships", handler)
        self.assertIn("await db.batch([", handler)
        self.assertIn("WHERE EXISTS (SELECT 1 FROM daga_store_invitations WHERE id=? AND status='accepted' AND accepted_by_account_id=? AND use_count=1)", handler)
        self.assertIn("Number(results?.[2]?.meta?.changes || 0) !== 1", handler)
        self.assertIn("Number(results?.[3]?.meta?.changes || 0) !== 1", handler)
        self.assertIn("Number(results?.[4]?.meta?.changes || 0) !== 1", handler)

    def test_company_login_otp_verification_is_rate_limited(self):
        source = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        start = source.index("async function companyLoginVerify(")
        end = source.index("\nasync function registerStart", start)
        handler = source[start:end]
        self.assertIn('company-login-verify-ip:', handler)
        self.assertIn('company-login-verify-account:', handler)
        self.assertIn('companyRateLimit(db, env, "company-login-verify-account:" + account.id, 8, 900)', handler)

    def test_api_guards_role_escalation_and_authentication(self):
        src = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        self.assertIn("authenticatedAccount(request, db)", src)
        self.assertIn('authority.role === "manager" && intendedRole !== "employee"', src)
        self.assertIn('intendedRole === "manager" && authority.role !== "store_owner"', src)
        self.assertIn('u.protocol !== "https:"', src)
        self.assertIn("await sha256(token)", src)
        self.assertIn('"/api/company/auth/register/verify"', src)
        self.assertIn('"/api/company/auth/login/verify"', src)
        self.assertIn("claim_id=?", src)
        self.assertIn("SET consumed_at=?,claim_id=?", src)
        self.assertIn("export async function authenticatedAccount", (ROOT / "owner-auth.js").read_text(encoding="utf-8"))
        self.assertIn('authority.role === "manager" && !authority.permissions.inviteEmployees', src)
        self.assertIn('WHERE store_id=? AND inviter_account_id=?', src)
        self.assertIn('invite.inviter_account_id !== account.id', src)


if __name__ == "__main__":
    unittest.main(verbosity=2)
