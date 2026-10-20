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


    def test_staging_setup_applies_all_ten_migrations(self):
        workflow = (ROOT / ".github" / "workflows" / "daga-staging-setup.yml").read_text(encoding="utf-8")
        for migration in MIGRATIONS:
            self.assertIn("migrations/" + migration, workflow, f"Staging setup omits {migration}")
        self.assertIn('migrations_dir = "staging-migrations"', workflow)


    def test_only_one_pending_payment_submission_per_order_is_allowed(self):
        db = sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys=ON")
        for migration in MIGRATIONS:
            db.executescript((ROOT / "migrations" / migration).read_text(encoding="utf-8"))
        db.execute("INSERT INTO daga_accounts (id,display_name,phone_e164,email,role,status,created_at,updated_at) VALUES ('acct','Shop','+201000000000','shop@example.com','store_owner','approved','2026-01-01','2026-01-01')")
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


    def test_duplicate_pending_payment_returns_conflict(self):
        start = self.source.index('if (orderPayment && request.method === "POST")')
        end = self.source.index('return json(env, { error: "method_not_allowed" }, 405);', start)
        handler = self.source[start:end]
        self.assertIn("payment_submission_already_pending", handler)
        self.assertIn("SELECT id FROM daga_payment_submissions WHERE order_id=? AND status='pending_review'", handler)
        self.assertIn("daga_payment_one_pending_submission_per_order", (ROOT / "migrations" / "0009_daga_payment_submission_uniqueness.sql").read_text(encoding="utf-8"))


class CompanyInvitationAuthorizationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        cls.worker = (ROOT / "worker.js").read_text(encoding="utf-8")

    def test_invitation_routes_are_wired_and_require_a_session(self):
        self.assertIn('import { handleCompanyInvitations } from "./company-invitations.js";', self.worker)
        self.assertIn("handleCompanyInvitations(request, env, url)", self.worker)
        handler = self.source[:self.source.index("async function companyAccountMe")]
        self.assertIn("authenticatedAccount(request, db)", handler)
        self.assertIn('account.status !== "approved"', handler)
        self.assertIn('account.role === "program_owner"', handler)

    def test_store_id_from_request_is_never_authority_by_itself(self):
        create = self.source[self.source.index("async function createInvitation"):self.source.index("async function listInvitations")]
        listing = self.source[self.source.index("async function listInvitations"):self.source.index("async function acceptInvitation")]
        self.assertIn("getAuthority(db, account, store)", create)
        self.assertIn("getAuthority(db, account, store)", listing)
        self.assertIn('store.status !== "approved"', create)
        self.assertIn('store.status === "approved"', listing)

    def test_owner_and_manager_invitation_scope_is_enforced(self):
        authority = self.source[self.source.index("async function getAuthority"):self.source.index("function normalizePermissions")]
        create = self.source[self.source.index("async function createInvitation"):self.source.index("async function listInvitations")]
        revoke = self.source[self.source.index("async function revokeInvitation"):self.source.index("async function getAuthority")]
        self.assertIn('store.owner_account_id === account.id', authority)
        self.assertIn('authority.role === "manager" && intendedRole !== "employee"', create)
        self.assertIn('!authority.permissions.inviteEmployees', create)
        self.assertIn('invite.inviter_account_id !== account.id', revoke)
        self.assertIn('invite.intended_role !== "employee"', revoke)

    def test_manager_cannot_escalate_permissions_or_invite_another_manager(self):
        normalize = self.source[self.source.index("function normalizePermissions"):self.source.index("function safeStoredPermissions")]
        self.assertIn('if (value[key] !== undefined && typeof value[key] !== "boolean") return null;', normalize)
        self.assertIn('if (out[key] && !authority.permissions[key]) return null;', normalize)
        self.assertIn('if (intendedRole === "manager" && authority.role !== "store_owner") return null;', normalize)
        self.assertIn('if (intendedRole === "employee" && out.inviteEmployees) return null;', normalize)

    def test_acceptance_is_single_use_and_checks_active_store(self):
        accept = self.source[self.source.index("async function acceptInvitation"):self.source.index("async function revokeInvitation")]
        self.assertIn("i.status='pending' AND i.use_count=0 AND i.max_uses=1", accept)
        self.assertIn("i.expires_at>?", accept)
        self.assertIn("s.status='approved'", accept)
        self.assertIn("NOT EXISTS (SELECT 1 FROM daga_store_memberships", accept)
        self.assertIn("claimed !== 1 || inserted !== 1", accept)

    def test_invitation_schema_has_single_use_and_role_constraints(self):
        migration = (ROOT / "migrations" / "0005_daga_store_identity_invitations.sql").read_text(encoding="utf-8")
        self.assertIn("max_uses", migration)
        self.assertIn("use_count", migration)
        self.assertIn("token_hash", migration)
        self.assertIn("UNIQUE", migration)


class VoiceIdentityGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.worker = (ROOT / "worker.js").read_text(encoding="utf-8")

    def test_voice_auth_gate_is_opt_in_and_preserves_legacy_client_by_default(self):
        self.assertIn('env.DAGA_VOICE_REQUIRE_AUTH || ""', self.worker)
        self.assertIn('voiceIdentityRequired && ["/chat", "/tts", "/liveavatar/token"].includes(url.pathname)', self.worker)
        self.assertIn('if (!voiceAccount || voiceAccount.status !== "approved" || voiceAccount.role === "program_owner")', self.worker)
        self.assertIn('error: "authenticated_account_required"', self.worker)

    def test_chat_identity_context_comes_from_server_authenticated_account(self):
        self.assertIn('JSON.stringify({ accountId: voiceAccount.id, publicId: voiceAccount.public_id || null, displayName: voiceAccount.display_name || null, role: voiceAccount.role, storeId: voiceAccount.store_id || null })', self.worker)
        self.assertIn('].join("\\n") + verifiedIdentityContext', self.worker)
        self.assertIn('authenticatedAccount(request, env.DAGA_APP_DB)', self.worker)

    def test_voice_identity_gate_does_not_claim_to_authorize_company_financial_data(self):
        self.assertIn('لا تعتبرها دليلًا على بيانات مالية أو صلاحيات شركة غير مسترجعة من قاعدة البيانات', self.worker)
        self.assertIn('DAGA_MEMORY_REQUIRE_AUTH', self.worker)




class LiveClientSessionForwardingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = (ROOT / "index.html").read_text(encoding="utf-8")
        cls.worker = (ROOT / "worker.js").read_text(encoding="utf-8")

    def test_session_bridge_uses_session_storage_and_bearer_header(self):
        self.assertIn("const DAGA_SESSION_KEY='daga_account_session_v1'", self.client)
        self.assertIn("sessionStorage.getItem(DAGA_SESSION_KEY)", self.client)
        self.assertIn("headers.Authorization='Bearer '+token", self.client)
        self.assertNotIn("localStorage.setItem(DAGA_SESSION_KEY", self.client)

    def test_existing_live_api_calls_forward_optional_session(self):
        self.assertIn("headers:dagaAuthHeaders({'Content-Type':'application/json'})", self.client)
        self.assertIn('headers:dagaAuthHeaders({"Content-Type":"application/json"})', self.client)
        self.assertIn("daga-voice.dagamobile10.workers.dev/chat", self.client)
        self.assertIn("daga-voice.dagamobile10.workers.dev/tts", self.client)
        self.assertIn("LIVE_ENDPOINT", self.client)
        self.assertIn("headers:dagaAuthHeaders()", self.client)

    def test_legacy_client_remains_compatible_without_session(self):
        helper_start = self.client.index("function dagaAuthHeaders")
        helper_end = self.client.index("\n", helper_start)
        helper = self.client[helper_start:helper_end]
        self.assertIn("const headers={...extra}", helper)
        self.assertIn("if(token&&token.length<=4096)", helper)
        self.assertIn("return headers", helper)
        self.assertIn('const voiceIdentityRequired = String(env.DAGA_VOICE_REQUIRE_AUTH || "").toLowerCase() === "true"', self.worker)



class LiveDagaLoginFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = (ROOT / "index.html").read_text(encoding="utf-8")
        cls.worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        cls.auth = (ROOT / "company-invitations.js").read_text(encoding="utf-8")

    def test_live_page_has_email_password_login_and_session_verification(self):
        for element_id in ("dagaAuthIdentifier", "dagaAuthPassword", "dagaAuthSend", "dagaAuthLogout"):
            self.assertIn('id="' + element_id + '"', self.client)
        self.assertNotIn('id="dagaAuthPhoneCode"', self.client)
        self.assertNotIn('id="dagaAuthEmailCode"', self.client)
        self.assertIn("'/api/company/auth/login'", self.client)
        self.assertNotIn("'/api/company/auth/login/verify'", self.client)
        self.assertIn("sessionStorage.setItem('daga_account_session_v1',data.sessionToken)", self.client)
        self.assertIn("'/api/company/auth/me'", self.client)
        self.assertIn("'/api/company/auth/logout'", self.client)


    def test_session_is_forwarded_to_chat_tts_memory_and_liveavatar(self):
        self.assertIn("headers.Authorization='Bearer '+token", self.client)
        self.assertIn("headers:dagaAuthHeaders({'Content-Type':'application/json'})", self.client)
        self.assertIn('headers:dagaAuthHeaders({"Content-Type":"application/json"})', self.client)
        self.assertIn("headers:dagaAuthHeaders()", self.client)

    def test_worker_cors_allows_authorization_header(self):
        self.assertIn('"Access-Control-Allow-Headers": "Content-Type, Authorization"', self.worker)

    def test_email_password_login_issues_a_hashed_server_session(self):
        login = self.auth[self.auth.index("async function companyLoginStart"):self.auth.index("async function companySetupStart")]
        self.assertIn("companyRandomToken(32)", login)
        self.assertIn("await sha256(token)", login)
        self.assertIn("INSERT INTO daga_auth_sessions", login)
        self.assertIn("return json(env,{ok:true,account:", login)
        self.assertIn("sessionToken:token,expiresAt:expires", login)


    def test_optional_voice_gate_and_memory_gate_use_server_verified_identity(self):
        self.assertIn('voiceIdentityRequired && ["/chat", "/tts", "/liveavatar/token"].includes(url.pathname)', self.worker)
        self.assertIn('const account = await authenticatedAccount(request, env.DAGA_APP_DB)', self.worker)
        self.assertIn('DAGA_MEMORY_REQUIRE_AUTH', self.worker)
        self.assertIn('DAGA_VOICE_REQUIRE_AUTH', self.worker)




class AuthenticatedMemoryIsolationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        cls.client = (ROOT / "index.html").read_text(encoding="utf-8")

    def test_authenticated_memory_uses_server_account_id_not_client_user_id(self):
        route = self.worker[self.worker.index('if (url.pathname === "/memory"'):self.worker.index('if (url.pathname === "/liveavatar/avatars"')]
        auth_branch = route[route.index('if (String(env.DAGA_MEMORY_REQUIRE_AUTH'):route.index('} else {')]
        self.assertIn('authenticatedAccount(request, env.DAGA_APP_DB)', auth_branch)
        self.assertIn('userId = String(account.id || "").trim()', auth_branch)
        self.assertNotIn('body?.userId', auth_branch)
        self.assertNotIn('url.searchParams.get("userId")', auth_branch)

    def test_legacy_memory_identity_is_not_mistaken_for_authenticated_identity(self):
        route = self.worker[self.worker.index('if (url.pathname === "/memory"'):self.worker.index('if (url.pathname === "/liveavatar/avatars"')]
        self.assertIn('Temporary compatibility mode for the existing anonymous LIVE DAGA client', route)
        self.assertIn('DAGA_MEMORY_REQUIRE_AUTH', route)
        self.assertIn("dagaServerUserId()", self.client)
        self.assertIn("dagaAuthHeaders()", self.client)

    def test_voice_and_memory_auth_remain_separately_gated(self):
        self.assertIn('DAGA_VOICE_REQUIRE_AUTH', self.worker)
        self.assertIn('DAGA_MEMORY_REQUIRE_AUTH', self.worker)
        self.assertIn('voiceIdentityRequired && ["/chat", "/tts", "/liveavatar/token"].includes(url.pathname)', self.worker)




if __name__ == "__main__":
    unittest.main(verbosity=2)
