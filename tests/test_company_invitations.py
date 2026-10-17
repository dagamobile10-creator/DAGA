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

    def test_company_approval_and_owner_account_status_change_together(self):
        admin = (ROOT / "owner-admin.js").read_text(encoding="utf-8")
        start = admin.index('const storeMatch=path.match(/^\\/owner\\/admin\\/stores\\/([a-f0-9-]{36})\\/decision$/i);')
        end = admin.index('if(path==="/owner/admin/payments"', start)
        handler = admin[start:end]
        self.assertIn('db.prepare("UPDATE daga_stores SET status=?,updated_at=? WHERE id=?")', handler)
        self.assertIn('db.prepare("UPDATE daga_accounts SET status=?,updated_at=? WHERE id=? AND role=\'store_owner\'")', handler)
        self.assertIn("await db.batch([", handler)
        self.assertIn('["approved","rejected","suspended"]', handler)

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

    def test_registration_validation_regexes_are_not_double_escaped(self):
        source = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        start = source.index("async function registerVerify(")
        end = source.index("\nasync function companyRateLimit", start)
        handler = source[start:end]
        self.assertIn(r"/^[^\s@]+@[^\s@]+\.[^\s@]+$/", handler)
        self.assertIn(r"!/^\d{6}$/.test(phoneCode)", handler)
        self.assertIn(r"!/^\d{6}$/.test(emailCode)", handler)
        self.assertNotIn(r"\\s", handler)
        self.assertNotIn(r"\\d", handler)

    def test_invitation_creation_is_rate_limited_by_account_and_ip(self):
        source = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        start = source.index("async function createInvitation(")
        end = source.index("\nasync function listInvitations", start)
        handler = source[start:end]
        self.assertIn('company-invite-create-account:', handler)
        self.assertIn('company-invite-create-ip:', handler)
        self.assertIn('companyRateLimit(db, env, "company-invite-create-account:" + account.id, 30, 3600)', handler)
        self.assertIn('companyRateLimit(db, env, "company-invite-create-ip:" + ip, 60, 3600)', handler)

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



    def test_company_cors_does_not_wildcard_when_allowlist_is_missing(self):
        source = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        start = source.index("function cors(env, extra = {})")
        end = source.index("\n}", start) + 2
        handler = source[start:end]
        self.assertIn('allowed.includes("*") ? "*" :', handler)
        self.assertTrue(handler.rstrip().endswith(' : "";\n  return { ...(origin ? { "Access-Control-Allow-Origin": origin } : {}), "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization", "Access-Control-Max-Age": "600", Vary: "Origin", ...extra };\n}'))
        self.assertNotIn('allowed.length === 0 ? "*" :', handler)

    def test_company_and_invitation_pages_set_no_store_and_security_headers(self):
        worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        for route in ('url.pathname === "/company"', 'url.pathname === "/invite"'):
            start = worker.index(route)
            end = worker.index("\n    }", start)
            handler = worker[start:end]
            self.assertIn('"Cache-Control": "no-store"', handler)
            self.assertIn('"Referrer-Policy": "no-referrer"', handler)
            self.assertIn('"X-Content-Type-Options": "nosniff"', handler)
            self.assertIn('"Content-Security-Policy":', handler)
            self.assertIn("frame-ancestors 'none'", handler)

    def test_official_landing_disallows_framing_and_sniffing(self):
        worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        start = worker.index('url.pathname === "/go"')
        end = worker.index("\n    }", start)
        handler = worker[start:end]
        self.assertIn('"X-Content-Type-Options": "nosniff"', handler)
        self.assertIn('"Content-Security-Policy":', handler)
        self.assertIn("frame-ancestors 'none'", handler)






    def test_company_login_verification_requires_both_channels_and_single_use_claim(self):
        source = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        start = source.index("async function companyLoginVerify(")
        end = source.index("\n}", start) + 2
        handler = source[start:end]
        self.assertIn("channel='phone'", handler)
        self.assertIn("channel='email'", handler)
        self.assertIn("claim_id IS NULL", handler)
        self.assertIn("WHERE EXISTS (SELECT 1 FROM daga_company_login_challenges WHERE id=? AND claim_id=? AND channel='phone')", handler)
        self.assertIn("AND EXISTS (SELECT 1 FROM daga_company_login_challenges WHERE id=? AND claim_id=? AND channel='email')", handler)

    def test_company_logout_revokes_exact_session_once(self):
        source = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        start = source.index("async function companyAccountLogout(")
        end = source.index("\n}", start) + 2
        handler = source[start:end]
        self.assertIn("WHERE token_hash=? AND revoked_at IS NULL", handler)
        self.assertIn('Number(result?.meta?.changes || 0) !== 1', handler)
        self.assertIn('error: "session_already_revoked"', handler)


    def test_invitation_listing_is_scoped_to_company_and_manager(self):
        source = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        start = source.index("async function listInvitations(")
        end = source.index("\n}", start) + 2
        handler = source[start:end]
        self.assertIn('WHERE store_id=? AND inviter_account_id=?', handler)
        self.assertIn('WHERE store_id=? ORDER BY created_at DESC LIMIT 100', handler)
        self.assertIn('if (!authority) return json(null, { error: "company_not_found_or_access_denied" }, 404);', handler)

    def test_manager_can_revoke_only_own_employee_invitations(self):
        source = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        start = source.index("async function revokeInvitation(")
        end = source.index("\n}", start) + 2
        handler = source[start:end]
        self.assertIn('authority.role === "manager"', handler)
        self.assertIn('invite.intended_role !== "employee"', handler)
        self.assertIn('invite.inviter_account_id !== account.id', handler)


    def test_invitation_claim_requires_pending_unexpired_single_use_and_approved_company(self):
        source = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        start = source.index("async function acceptInvitation(")
        end = source.index("\n}", start) + 2
        handler = source[start:end]
        self.assertIn("i.status='pending' AND i.use_count=0 AND i.max_uses=1 AND i.expires_at>?", handler)
        self.assertIn("s.status='approved'", handler)
        self.assertIn("NOT EXISTS (SELECT 1 FROM daga_store_memberships", handler)
        self.assertIn("RETURNING id,store_id,intended_role,permissions_json", handler)

    def test_invitation_revoke_is_conditional_and_only_pending_unused(self):
        source = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        start = source.index("async function revokeInvitation(")
        end = source.index("\n}", start) + 2
        handler = source[start:end]
        self.assertIn('invite.status !== "pending"', handler)
        self.assertIn("WHERE id=? AND status='pending' AND use_count=0", handler)
        self.assertIn('Number(result?.meta?.changes || 0) !== 1', handler)


    def test_company_manager_cannot_escalate_invitation_role_or_permissions(self):
        source = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        start = source.index("function normalizePermissions(")
        end = source.index("\n}", start) + 2
        handler = source[start:end]
        self.assertIn('if (intendedRole === "manager" && authority.role !== "store_owner") return null;', handler)
        self.assertIn('if (out[key] && !authority.permissions[key]) return null;', handler)
        self.assertIn('if (intendedRole === "employee" && out.inviteEmployees) return null;', handler)

    def test_company_authority_is_scoped_to_active_membership(self):
        source = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        start = source.index("async function getAuthority(")
        end = source.index("\n}", start) + 2
        handler = source[start:end]
        self.assertIn('WHERE store_id=? AND account_id=? LIMIT 1', handler)
        self.assertIn('membership.status !== "active"', handler)
        self.assertIn('!["manager", "employee"].includes(membership.role)', handler)


    def test_owner_api_cors_does_not_wildcard_when_allowlist_is_missing(self):
        source = (ROOT / "owner-auth.js").read_text(encoding="utf-8")
        start = source.index("function cors(env, extra = {})")
        end = source.index("\n}", start) + 2
        handler = source[start:end]
        self.assertIn('allowed.includes("*") ? "*" :', handler)
        self.assertNotIn('allowed.length === 0 ? "*" :', handler)
        self.assertIn('...(origin ? { "Access-Control-Allow-Origin": origin } : {})', handler)



    def test_owner_api_cors_fails_closed_without_allowlist(self):
        source = (ROOT / "owner-auth.js").read_text(encoding="utf-8")
        start = source.index("function cors(env, extra = {})")
        end = source.index("\n}", start) + 2
        handler = source[start:end]
        self.assertIn('allowed.includes("*") ? "*" :', handler)
        self.assertNotIn('allowed.length === 0 ? "*" :', handler)
        self.assertIn('...(origin ? { "Access-Control-Allow-Origin": origin } : {})', handler)


    def test_owner_admin_cors_fails_closed_without_allowlist(self):
        source = (ROOT / "owner-admin.js").read_text(encoding="utf-8")
        self.assertIn('allowed.includes("*")?"*":allowed.length===1?allowed[0]:""', source)
        self.assertNotIn('allowed.length===0?"*"', source)


    def test_company_api_cors_fails_closed_without_allowlist(self):
        source = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        start = source.index("function cors(env, extra = {})")
        end = source.index("\n}", start) + 2
        handler = source[start:end]
        self.assertIn('allowed.includes("*") ? "*" :', handler)
        self.assertNotIn('allowed.length === 0 ? "*" :', handler)
        self.assertIn('...(origin ? { "Access-Control-Allow-Origin": origin } : {})', handler)


    def test_company_session_rejects_expired_revoked_or_unapproved_account(self):
        source = (ROOT / "owner-auth.js").read_text(encoding="utf-8")
        start = source.index("export async function authenticatedAccount(")
        end = source.index("\n}", start) + 2
        handler = source[start:end]
        self.assertIn("s.revoked_at IS NULL", handler)
        self.assertIn("s.expires_at>?", handler)
        self.assertIn("a.status='approved'", handler)
        self.assertIn("WHERE token_hash=? AND revoked_at IS NULL", handler)
        self.assertIn("return null;", handler)


    def test_login_challenge_claim_is_single_use_and_expiry_guarded(self):
        self.db.execute(
            """INSERT INTO daga_company_login_challenges
            (id,account_id,channel,destination_hash,code_hash,expires_at)
            VALUES ('login-once','owner','phone','dest-hash','code-hash','2026-10-18T00:00:00.000Z')"""
        )
        self.db.execute(
            """INSERT INTO daga_company_login_challenges
            (id,account_id,channel,destination_hash,code_hash,expires_at)
            VALUES ('login-expired','owner','email','dest-hash-2','code-hash-2','2026-10-16T00:00:00.000Z')"""
        )
        first = self.db.execute(
            """UPDATE daga_company_login_challenges SET consumed_at=?,claim_id='claim-once'
            WHERE id='login-once' AND consumed_at IS NULL AND claim_id IS NULL AND expires_at>?""",
            (self.now, self.now),
        )
        replay = self.db.execute(
            """UPDATE daga_company_login_challenges SET consumed_at=?,claim_id='claim-replay'
            WHERE id='login-once' AND consumed_at IS NULL AND claim_id IS NULL AND expires_at>?""",
            (self.now, self.now),
        )
        expired = self.db.execute(
            """UPDATE daga_company_login_challenges SET consumed_at=?,claim_id='claim-expired'
            WHERE id='login-expired' AND consumed_at IS NULL AND claim_id IS NULL AND expires_at>?""",
            (self.now, self.now),
        )
        self.assertEqual(first.rowcount, 1)
        self.assertEqual(replay.rowcount, 0)
        self.assertEqual(expired.rowcount, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
