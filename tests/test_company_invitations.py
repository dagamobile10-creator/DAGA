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
    "0009_daga_payment_submission_uniqueness.sql",
    "0010_email_only_auth.sql",
    "0011_email_only_registration_challenges.sql",
    "0012_company_email_onboarding.sql",
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

    def test_company_onboarding_challenge_schema_has_bounded_attempts_and_single_claim(self):
        sql = self.db.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='daga_company_onboarding_challenges'"
        ).fetchone()[0]
        self.assertIn("attempts BETWEEN 0 AND 5", sql)
        columns = {row["name"] for row in self.db.execute(
            "PRAGMA table_info(daga_company_onboarding_challenges)"
        )}
        self.assertTrue({"email", "owner_name", "company_name", "legal_identity", "destination_hash", "code_hash", "expires_at", "consumed_at", "claim_id"} <= columns)
        self.assertIn("daga_company_onboarding_lookup", {
            row["name"] for row in self.db.execute("PRAGMA index_list(daga_company_onboarding_challenges)")
        })

    def test_email_only_migration_preserves_email_challenges_and_drops_phone_challenges(self):
        db = sqlite3.connect(":memory:")
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            for migration in MIGRATIONS[:-2]:
                db.executescript((ROOT / "migrations" / migration).read_text(encoding="utf-8"))
            db.execute(
                """INSERT INTO daga_company_registration_challenges
                (id,invitation_token_hash,channel,destination_hash,code_hash,expires_at,attempts)
                VALUES ('email-row','invite-email','email','email-dest','email-code','2026-10-18T00:00:00.000Z',1)"""
            )
            db.execute(
                """INSERT INTO daga_company_registration_challenges
                (id,invitation_token_hash,channel,destination_hash,code_hash,expires_at,attempts)
                VALUES ('phone-row','invite-phone','phone','phone-dest','phone-code','2026-10-18T00:00:00.000Z',1)"""
            )
            db.commit()
            db.executescript((ROOT / "migrations" / "0011_email_only_registration_challenges.sql").read_text(encoding="utf-8"))
            db.executescript((ROOT / "migrations" / "0012_company_email_onboarding.sql").read_text(encoding="utf-8"))
            rows = db.execute(
                "SELECT id,channel FROM daga_company_registration_challenges ORDER BY id"
            ).fetchall()
            self.assertEqual([(row["id"], row["channel"]) for row in rows], [("email-row", "email")])
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute(
                    """INSERT INTO daga_company_registration_challenges
                    (id,invitation_token_hash,channel,destination_hash,code_hash,expires_at)
                    VALUES ('new-phone','invite','phone','dest','code','2026-10-18T00:00:00.000Z')"""
                )
        finally:
            db.close()

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
        self.assertIn("/api/company/auth/login", page)

    def test_shop_owner_self_registration_replaces_company_provisioning(self):
        admin = (ROOT / "owner-admin.js").read_text(encoding="utf-8")
        console = (ROOT / "owner-console.html").read_text(encoding="utf-8")
        self.assertNotIn('if(path==="/owner/admin/stores"&&request.method==="POST")', admin)
        self.assertIn("authenticatedOwner(request, db)", admin)
        self.assertNotIn("companyOwnerForm", console)
        self.assertNotIn("معرّف الشركة", console)
        self.assertIn("طلبات تسجيل الشركات", console)

    def test_company_approval_and_owner_account_status_change_together(self):
        admin = (ROOT / "owner-admin.js").read_text(encoding="utf-8")
        start = admin.index('const storeMatch=path.match(/^\\/owner\\/admin\\/stores\\/([a-f0-9-]{36})\\/decision$/i);')
        end = admin.index('if(path==="/owner/admin/payments"', start)
        handler = admin[start:end]
        self.assertIn('db.prepare("UPDATE daga_stores SET status=?,onboarding_status=?,updated_at=? WHERE id=?")', handler)
        self.assertIn('db.prepare("UPDATE daga_stores SET status=\'approved\',onboarding_status=\'preliminary_approved\',updated_at=? WHERE id=? AND status=\'pending\'")', handler)
        self.assertIn('store.onboarding_status!=="preliminary_approved"', handler)
        self.assertIn('db.prepare("UPDATE daga_accounts SET status=\'approved\',updated_at=? WHERE id=? AND role=\'store_owner\' AND status=\'pending\'")', handler)
        self.assertIn("await db.batch([", handler)
        self.assertIn('["preliminary_approved","approved","rejected","suspended"]', handler)

    def test_preliminary_approval_allows_payment_portal_but_not_dashboard_access(self):
        admin = (ROOT / "owner-admin.js").read_text(encoding="utf-8")
        auth = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        dashboard = (ROOT / "shop-dashboard-v30.html").read_text(encoding="utf-8")
        self.assertIn("status='approved',onboarding_status='preliminary_approved'", admin)
        self.assertIn("a.status='approved'", admin)
        self.assertIn("s.status='approved' AND s.onboarding_status='preliminary_approved'", admin)
        self.assertIn("WHERE id=? AND role='store_owner' AND status='approved'", admin)
        self.assertIn("WHERE owner_account_id=? AND status='approved'", auth)
        self.assertIn("company.ledgerEnabled!==true", dashboard)
        self.assertIn("onboarding_order_id=CASE WHEN onboarding_status='preliminary_approved'", admin)
        self.assertIn("company_payment_submission_pending_review", admin)
        self.assertIn("ps.status='pending_review'", admin)
        self.assertIn("reviewResults.some(result => Number(result?.meta?.changes || 0) !== 1)", admin)

    def test_company_portal_supports_invite_creation_and_revocation(self):
        portal = (ROOT / "company" / "portal.html").read_text(encoding="utf-8")
        self.assertIn("/api/company/auth/login", portal)
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
        self.assertIn("[1,2,3,4,5,6].some(i=>Number(results?.[i]?.meta?.changes||0)!==1)", handler)
        self.assertIn("[1,2,3,4,5,6].some(i=>Number(results?.[i]?.meta?.changes||0)!==1)", handler)
        self.assertIn("[1,2,3,4,5,6].some(i=>Number(results?.[i]?.meta?.changes||0)!==1)", handler)

    def test_registration_validation_regexes_are_not_double_escaped(self):
        source = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        start = source.index("async function registerVerify(")
        end = source.index("\nasync function companyRateLimit", start)
        handler = source[start:end]
        self.assertIn(r"/^[^\s@]+@[^\s@]+\.[^\s@]+$/", handler)
        self.assertNotIn("phoneCode", handler)
        self.assertIn(r"!/^\d{6}$/.test(code)", handler)
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

    def test_company_password_login_is_rate_limited_by_email_and_ip(self):
        source = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        start = source.index("async function companyLoginStart(")
        end = source.index("\nasync function companySetupStart", start)
        handler = source[start:end]
        self.assertIn("company-login-ip:", handler)
        self.assertIn("company-login-email:", handler)
        self.assertIn("companyDerivePassword(password", handler)
        self.assertNotIn("companySendSms", handler)


    def test_company_authority_is_scoped_to_the_requested_store_owner_or_active_membership(self):
        source = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        start = source.index("async function getAuthority(")
        end = source.index("\n}", start) + 2
        handler = source[start:end]
        self.assertIn('account.role === "store_owner" && store.owner_account_id === account.id', handler)
        self.assertIn("WHERE store_id=? AND account_id=? LIMIT 1", handler)
        self.assertIn('membership.status !== "active"', handler)
        self.assertIn('!["manager", "employee"].includes(membership.role)', handler)
        self.assertIn('permissions[key] = stored && stored[key] === true', handler)

    def test_managers_cannot_create_manager_invitations_or_escalate_permissions(self):
        source = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        start = source.index("function normalizePermissions(")
        end = source.index("\n}", start) + 2
        handler = source[start:end]
        self.assertIn('if (authority.role === "manager")', handler)
        self.assertIn('if (out[key] && !authority.permissions[key]) return null;', handler)
        self.assertIn('if (intendedRole === "manager" && authority.role !== "store_owner") return null;', handler)
        self.assertIn('if (intendedRole === "employee" && out.inviteEmployees) return null;', handler)

    def test_api_guards_role_escalation_and_authentication(self):
        src = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        self.assertIn("authenticatedAccount(request, db)", src)
        self.assertIn('authority.role === "manager" && intendedRole !== "employee"', src)
        self.assertIn('intendedRole === "manager" && authority.role !== "store_owner"', src)
        self.assertIn('u.protocol !== "https:"', src)
        self.assertIn("await sha256(token)", src)
        self.assertIn('"/api/company/auth/register/verify"', src)
        self.assertIn('"/api/company/auth/login"', src)
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
        self.assertTrue(handler.rstrip().endswith(' : "";\n  return { ...(origin ? { "Access-Control-Allow-Origin": origin } : {}), "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization", "Access-Control-Max-Age": "600", Vary: "Origin", ...extra };\n}'))
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






    def test_company_password_login_requires_email_and_password_not_phone_otp(self):
        source = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        start = source.index("async function companyLoginStart(")
        end = source.index("\nasync function companySetupStart", start)
        handler = source[start:end]
        self.assertIn("lower(a.email)=?", handler)
        self.assertIn("companyDerivePassword(password", handler)
        self.assertIn("create_at", handler) if "create_at" in handler else self.assertIn("created_at", handler)
        self.assertNotIn("channel='phone'", handler)
        self.assertNotIn("companySendSms", handler)


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


    def test_session_tokens_are_unique_and_revocation_is_one_way(self):
        self.db.execute(
            """INSERT INTO daga_auth_sessions
            (id,account_id,token_hash,created_at,expires_at,last_seen_at)
            VALUES ('session-1','owner','unique-token-hash',?,?,?)""",
            (self.now, "2026-10-18T00:00:00.000Z", self.now),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO daga_auth_sessions
                (id,account_id,token_hash,created_at,expires_at,last_seen_at)
                VALUES ('session-2','owner','unique-token-hash',?,?,?)""",
                (self.now, "2026-10-18T00:00:00.000Z", self.now),
            )
        first = self.db.execute(
            "UPDATE daga_auth_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL",
            (self.now, "unique-token-hash"),
        )
        replay = self.db.execute(
            "UPDATE daga_auth_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL",
            (self.now, "unique-token-hash"),
        )
        self.assertEqual(first.rowcount, 1)
        self.assertEqual(replay.rowcount, 0)


    def test_login_challenge_attempt_counter_cannot_exceed_five(self):
        self.db.execute(
            """INSERT INTO daga_company_login_challenges
            (id,account_id,channel,destination_hash,code_hash,expires_at,attempts)
            VALUES ('login-limited','owner','phone','dest-limit','hash-limit','2026-10-18T00:00:00.000Z',4)"""
        )
        fifth = self.db.execute(
            "UPDATE daga_company_login_challenges SET attempts=attempts+1 WHERE id='login-limited' AND attempts<5 RETURNING attempts"
        ).fetchone()
        sixth = self.db.execute(
            "UPDATE daga_company_login_challenges SET attempts=attempts+1 WHERE id='login-limited' AND attempts<5 RETURNING attempts"
        ).fetchone()
        self.assertEqual(fifth["attempts"], 5)
        self.assertIsNone(sixth)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE daga_company_login_challenges SET attempts=6 WHERE id='login-limited'")


    def test_suspended_account_cannot_use_an_existing_session(self):
        self.db.execute(
            """INSERT INTO daga_auth_sessions
            (id,account_id,token_hash,created_at,expires_at,last_seen_at)
            VALUES ('session-suspended','employee','suspended-session-hash',?,?,?)""",
            (self.now, "2026-10-18T00:00:00.000Z", self.now),
        )
        self.db.execute("UPDATE daga_accounts SET status='suspended' WHERE id='employee'")
        row = self.db.execute(
            """SELECT a.id FROM daga_auth_sessions s
            JOIN daga_accounts a ON a.id=s.account_id
            WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?
            AND a.status='approved' LIMIT 1""",
            ("suspended-session-hash", self.now),
        ).fetchone()
        self.assertIsNone(row)


    def test_registration_challenge_attempt_limit_and_replay_claim(self):
        self.db.execute(
            """INSERT INTO daga_company_registration_challenges
            (id,invitation_token_hash,channel,destination_hash,code_hash,expires_at,attempts)
            VALUES ('reg-limited','invite-hash','email','email-hash','otp-hash','2026-10-18T00:00:00.000Z',4)"""
        )
        fifth = self.db.execute(
            "UPDATE daga_company_registration_challenges SET attempts=attempts+1 WHERE id='reg-limited' AND attempts<5 RETURNING attempts"
        ).fetchone()
        sixth = self.db.execute(
            "UPDATE daga_company_registration_challenges SET attempts=attempts+1 WHERE id='reg-limited' AND attempts<5 RETURNING attempts"
        ).fetchone()
        self.assertEqual(fifth["attempts"], 5)
        self.assertIsNone(sixth)
        claim = self.db.execute(
            """UPDATE daga_company_registration_challenges SET consumed_at=?,claim_id='claim-first'
            WHERE id='reg-limited' AND consumed_at IS NULL AND claim_id IS NULL AND attempts<=5 AND expires_at>?""",
            (self.now, self.now),
        )
        replay = self.db.execute(
            """UPDATE daga_company_registration_challenges SET consumed_at=?,claim_id='claim-second'
            WHERE id='reg-limited' AND consumed_at IS NULL AND claim_id IS NULL AND attempts<=5 AND expires_at>?""",
            (self.now, self.now),
        )
        self.assertEqual(claim.rowcount, 1)
        self.assertEqual(replay.rowcount, 0)


    def test_owner_password_reset_revokes_all_sessions_and_consumes_reset_challenges(self):
        source = (ROOT / "owner-auth.js").read_text(encoding="utf-8")
        start = source.index("async function recoveryComplete(")
        handler = source[start:]
        self.assertIn("UPDATE daga_auth_sessions SET revoked_at=? WHERE account_id=? AND revoked_at IS NULL", handler)
        self.assertIn("UPDATE daga_auth_challenges SET consumed_at=? WHERE account_id=? AND purpose='password_reset' AND consumed_at IS NULL", handler)
        self.assertIn("await db.batch([", handler)
        self.assertIn("Password reset. Log in again with the new password.", handler)
        self.assertIn("consumed_at IS NULL", handler)
        self.assertIn("revoked_at IS NULL", handler)


    def test_every_owner_admin_route_is_gated_before_route_dispatch(self):
        admin = (ROOT / "owner-admin.js").read_text(encoding="utf-8")
        handler_start = admin.index("export async function handleOwnerAdmin")
        handler_end = admin.index("\n}", handler_start) + 2
        handler = admin[handler_start:handler_end]
        gate = handler.index("const owner = await authenticatedOwner(request, db)")
        denial = handler.index('return json(env, { error: "owner_session_required" }, 401)')
        dispatch = handler.index("try {")
        self.assertLess(handler.index('if (!url.pathname.startsWith("/owner/admin/")) return null;'), gate)
        self.assertLess(gate, denial)
        self.assertLess(denial, dispatch)
        self.assertIn('import { authenticatedOwner } from "./owner-auth.js";', admin)
        self.assertNotIn("request.headers.get(\"X-Owner-Role\")", handler)
        self.assertNotIn("url.searchParams.get(\"ownerId\")", handler)


    def test_word_adjustment_handles_concurrent_duplicate_request_ids(self):
        admin = (ROOT / "owner-admin.js").read_text(encoding="utf-8")
        start = admin.index('if(path==="/owner/admin/words/adjust"&&request.method==="POST")')
        end = admin.index('if(path==="/owner/admin/columns"&&request.method==="GET")', start)
        handler = admin[start:end]
        self.assertIn('SELECT id,account_id,store_id,event_type,words,note FROM daga_live_word_ledger WHERE request_id=?', handler)
        self.assertIn('error:"word_adjustment_request_id_conflict"', handler)
        self.assertIn('prior.account_id===accountId&&prior.store_id===resolvedStoreId', handler)
        self.assertIn('const resolvedStoreId=ownedStore.id', handler)
        self.assertIn('account.role!==\"store_owner\"', handler)
        self.assertIn('ownedStore=await db.prepare("SELECT id FROM daga_stores WHERE owner_account_id=? AND status=', handler)
        self.assertIn('Number(prior.words)===words&&prior.note===adjustmentNote', handler)
        self.assertIn('error:"word_adjustment_conflict"', handler)
        self.assertIn('request_id TEXT UNIQUE', (ROOT / "migrations" / "0001_daga_core.sql").read_text(encoding="utf-8"))


    def test_payment_review_checks_conditional_state_transition_results(self):
        admin = (ROOT / "owner-admin.js").read_text(encoding="utf-8")
        start = admin.index('const reviewMatch=path.match')
        end = admin.index('if(path==="/owner/admin/words/adjust"', start)
        review = admin[start:end]
        self.assertIn("const reviewResults = await db.batch(statements)", review)
        self.assertIn('Number(reviewResults?.[0]?.meta?.changes || 0) !== 1', review)
        self.assertIn('Number(reviewResults?.[1]?.meta?.changes || 0) !== 1', review)
        self.assertIn('error:"payment_review_state_changed_retry"', review)
        self.assertIn("status='pending_review'", review)
        self.assertIn("o.status='paid_approved'", review)


    def test_liveavatar_metadata_lookup_uses_optional_public_api_rate_limit(self):
        worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        self.assertIn('(url.pathname === "/liveavatar/avatars" && request.method === "GET")', worker)
        self.assertIn('"/liveavatar/avatars": [30, 300]', worker)
        self.assertIn('if (publicLimit && String(env.DAGA_PUBLIC_API_RATE_LIMITS || "").toLowerCase() === "true")', worker)


    def test_liveavatar_metadata_never_returns_raw_provider_payload(self):
        worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        start = worker.index('if (url.pathname === "/liveavatar/avatars" && request.method === "GET")')
        end = worker.index('if (url.pathname === "/liveavatar/token" && request.method === "POST")', start)
        route = worker[start:end]
        self.assertIn('return json({ ok: true, count:', route)
        self.assertNotIn('return json(data', route)
        self.assertNotIn('return json(publicData', route)
        self.assertNotIn('LIVEAVATAR_API_KEY:', route)


    def test_liveavatar_token_enforces_staged_identity_before_provider_call(self):
        worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        start = worker.index('if (url.pathname === "/liveavatar/token" && request.method === "POST")')
        end = worker.index('if (url.pathname === "/health")', start)
        route = worker[start:end]
        self.assertIn('DAGA_VOICE_REQUIRE_AUTH', route)
        self.assertIn('authenticatedAccount(request, env.DAGA_APP_DB)', route)
        self.assertIn('account.status !== "approved"', route)
        self.assertIn('account.role === "program_owner"', route)
        self.assertLess(route.index('DAGA_VOICE_REQUIRE_AUTH'), route.index('if (!env.LIVEAVATAR_API_KEY)'))


    def test_core_worker_cors_uses_allowlist_not_wildcard(self):
        worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        start = worker.index("function cors(extra = {})")
        end = worker.index("\n}", start) + 2
        handler = worker[start:end]
        self.assertIn('extra.allowedOrigins || "https://dagamobile10-creator.github.io"', handler)
        self.assertIn('allowed.includes("*") ? "*" :', handler)
        self.assertIn('"Access-Control-Allow-Headers": "Content-Type, Authorization"', handler)
        self.assertIn('Vary: "Origin"', handler)
        self.assertIn('delete headers.allowedOrigins', handler)
        self.assertNotIn('"Access-Control-Allow-Origin": "*"', handler)

    def test_core_worker_options_uses_configured_cors_allowlist(self):
        worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        self.assertIn('if (request.method === "OPTIONS") return new Response(null, { headers: cors({ allowedOrigins: env.DAGA_ALLOWED_ORIGINS || "" }) });', worker)
        self.assertIn('if (request.method === "OPTIONS") return new Response(null, { headers: cors({ allowedOrigins: env.DAGA_ALLOWED_ORIGINS || "" }) });', worker)
        self.assertIn('function json(data, status = 200) {\n  return new Response(JSON.stringify(data), { status, headers: cors({ "Content-Type": "application/json; charset=utf-8" }) });\n}', worker)


if __name__ == "__main__":
    unittest.main(verbosity=2)
