import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class NavigationRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        cls.live = (ROOT / "index.html").read_text(encoding="utf-8")
        cls.landing = (ROOT / "go" / "index.html").read_text(encoding="utf-8")
        cls.owner = (ROOT / "owner-console.html").read_text(encoding="utf-8")
        cls.company = (ROOT / "company" / "portal.html").read_text(encoding="utf-8")
        cls.invite = (ROOT / "invite" / "index.html").read_text(encoding="utf-8")
        cls.review = (ROOT / "review" / "index.html").read_text(encoding="utf-8")
        cls.company_auth = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        cls.company_orders = (ROOT / "company-orders.js").read_text(encoding="utf-8")
        cls.shop_auth = (ROOT / "shop-auth.js").read_text(encoding="utf-8")
        cls.owner_admin = (ROOT / "owner-admin.js").read_text(encoding="utf-8")

    def test_worker_serves_all_navigation_destinations(self):
        for path in ("/go", "/owner-console", "/company", "/invite"):
            with self.subTest(path=path):
                self.assertIn(path, self.worker)

    def test_live_navigation_uses_worker_origin_for_worker_pages(self):
        for path in ("/go/", "/company/", "/owner-console/"):
            with self.subTest(path=path):
                self.assertIn("https://daga-voice.dagamobile10.workers.dev" + path, self.live)

    def test_navigation_pages_link_to_each_other(self):
        for page, paths in (
            (self.live, ("/go/", "/company/", "/owner-console/")),
            (self.landing, ("/company/", "/owner-console/")),
            (self.owner, ("/shop-access/", "/go/")),
            (self.company, ("/owner-console/", "/go/")),
            (self.invite, ("/company/", "/owner-console/", "/go/")),
        ):
            for path in paths:
                with self.subTest(path=path):
                    self.assertIn(path, page)

    def test_invitation_acceptance_is_not_linked_without_a_token(self):
        for page in (self.live, self.landing):
            self.assertNotIn('href="/invite/"', page)

    def test_shop_portal_api_paths_have_server_handlers(self):
        for path in (
            "/api/shop/auth/me",
            "/api/shop/auth/login",
            "/api/shop/auth/setup/start",
            "/api/shop/auth/setup/verify",
            "/api/shop/auth/recovery/start",
            "/api/shop/auth/recovery/complete",
            "/api/shop/auth/logout",
            "/api/company/invitations",
            "/api/company/orders",
            "/api/company/plans",
            "/api/company/payment-methods",
            "/api/company/offers",
        ):
            with self.subTest(path=path):
                portal_path = path.replace("/api/shop", "")
                self.assertTrue(path in self.company or portal_path in self.company or path in self.live,
                                f"no frontend call found for {path}")
                handler_sources = self.shop_auth + self.company_auth + self.company_orders + self.worker
                self.assertIn(path, handler_sources, f"no server handler found for {path}")

    def test_shop_auth_routes_are_dispatched_to_the_real_handler(self):
        self.assertIn('import { handleShopAuth } from "./shop-auth.js";', self.worker)
        self.assertIn("const shopAuthResponse = await handleShopAuth(request, env, url);", self.worker)
        for path in (
            "/api/shop/registration/start",
            "/api/shop/registration/verify",
            "/api/shop/auth/login",
            "/api/shop/auth/setup/start",
            "/api/shop/auth/setup/verify",
            "/api/shop/auth/recovery/start",
            "/api/shop/auth/recovery/complete",
            "/api/shop/auth/me",
            "/api/shop/auth/logout",
        ):
            with self.subTest(path=path):
                self.assertIn(path, self.shop_auth)


    def test_shop_onboarding_routes_require_email_verification_and_pending_approval(self):
        for route in ('"/api/shop/registration/start"', '"/api/shop/registration/verify"'):
            with self.subTest(route=route):
                self.assertIn(route, self.shop_auth)
        self.assertIn('id="showShopRegistration"', self.company)
        self.assertIn('<form id="shopRegistrationForm"', self.company)
        self.assertIn('id="onboardingShopName"', self.company)
        self.assertNotIn('id="onboardingLegalIdentity"', self.company)
        self.assertNotIn('id="companyRegistrationForm"', self.company)
        self.assertNotIn('id="companyOwnerForm"', self.owner)
        self.assertNotIn("معرّف الشركة", self.owner)
        self.assertIn('id="onboardingEmailCode"', self.company)
        self.assertIn('/api/shop/registration/start', self.company)
        self.assertIn('/api/shop/registration/verify', self.company)
        self.assertIn("موافقة مالك التطبيق", self.company)
        self.assertNotIn("/api/company/onboarding/start", self.company_auth)
        self.assertNotIn("/api/company/onboarding/verify", self.company_auth)

    def test_company_and_program_owner_auth_ui_are_email_only(self):
        self.assertIn('id="identifier" type="email"', self.company)
        self.assertIn('id="bootstrapEmail" type="email"', self.owner)
        self.assertIn('id="bootstrapEmailCode"', self.owner)
        self.assertIn('id="recoveryEmailCode"', self.owner)
        for page_name, page in (("company", self.company), ("program_owner", self.owner)):
            for forbidden in (
                'id="phone"',
                'id="phoneNumber"',
                'id="loginPhone"',
                'id="setupPhoneCode"',
                'id="recoveryPhoneCode"',
                'id="registerPhone"',
                'id="smsCode"',
                'id="bootstrapPhone"',
                'id="bootstrapPhoneCode"',
                'id="recoveryPhone"',
            ):
                with self.subTest(page=page_name, forbidden=forbidden):
                    self.assertNotIn(forbidden, page)
        for route in (
            "/api/shop/auth/setup/start",
            "/api/shop/auth/setup/verify",
            "/api/shop/auth/recovery/start",
            "/api/shop/auth/recovery/complete",
        ):
            with self.subTest(route=route):
                self.assertIn(route, self.shop_auth)
        self.assertIn("emailCode", self.shop_auth)
        self.assertIn("RESEND_API_KEY", self.shop_auth)
        self.assertIn("/owner/bootstrap/start", self.owner)
        self.assertIn("/owner/bootstrap/verify", self.owner)
        self.assertIn("/owner/recovery/complete", self.owner)

    def test_owner_console_admin_endpoints_have_server_handlers(self):
        for path in (
            "/owner/admin/overview",
            "/owner/admin/plans",
            "/owner/admin/payment-methods",
            "/owner/admin/offers",
            "/owner/admin/payments",
            "/owner/admin/stores",
            "/owner/admin/accounts",
            "/owner/admin/columns",
            "/owner/admin/words/adjust",
        ):
            with self.subTest(path=path):
                self.assertIn(path, self.owner)
                self.assertIn(path, self.owner_admin)
        self.assertIn("authenticatedOwner(request, db)", self.owner_admin)

    def test_approved_shop_owner_is_sent_email_password_setup_code(self):
        # The admin decision must persist approval first, then request the
        # existing email-only setup OTP flow. Rejected/pending accounts must
        # not receive a setup code, and invitation registration stays separate.
        start = self.owner.index("document.addEventListener('click',async e=>")
        end = self.owner.index("\n})();", start)
        handler = self.owner[start:end]
        self.assertIn("b.dataset.decision==='approved'", handler)
        self.assertIn("'/api/shop/auth/setup/start'", handler)
        self.assertIn("JSON.stringify({email:approved.email})", handler)
        self.assertIn("تمت الموافقة المبدئية على المحل", handler)
        self.assertIn("company-invitations.js", self.worker)

    def test_navigation_does_not_remove_live_voice_contract_markers(self):
        for marker in ("workers.dev/chat", "workers.dev/tts", "playVoiceTest", "daga_mh_memory_v1"):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.live)

    def test_first_time_owner_setup_is_visible_on_initial_load(self):
        self.assertIn('<details id="ownerBootstrap" open', self.owner)
        self.assertIn('id="bootstrapStartForm"', self.owner)
        self.assertIn('id="bootstrapVerifyForm"', self.owner)
        self.assertIn('/owner/bootstrap/start', self.owner)
        self.assertIn('/owner/bootstrap/verify', self.owner)

    def test_review_hub_links_to_all_current_daga_destinations(self):
        for path in ("/go/", "/company/", "/owner-console/", "/invite/", "https://dagamobile10-creator.github.io/DAGA/"):
            with self.subTest(path=path):
                self.assertIn(path, self.review)


if __name__ == "__main__":
    unittest.main()
