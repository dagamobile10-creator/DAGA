from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class ShopSelfRegistrationTests(unittest.TestCase):
    def test_shop_auth_routes_and_email_only_registration_exist(self):
        worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        auth = (ROOT / "shop-auth.js").read_text(encoding="utf-8")
        self.assertIn('import { handleShopAuth } from "./shop-auth.js";', worker)
        for route in ("/api/shop/registration/start", "/api/shop/registration/verify",
                      "/api/shop/auth/setup/start", "/api/shop/auth/setup/verify",
                      "/api/shop/auth/login", "/api/shop/auth/me", "/api/shop/auth/logout"):
            self.assertIn(route, auth)

    def test_registration_collects_no_company_or_legal_identifier(self):
        portal = (ROOT / "company" / "portal.html").read_text(encoding="utf-8")
        owner = (ROOT / "owner-console.html").read_text(encoding="utf-8")
        self.assertIn('id="shopRegistrationForm"', portal)
        self.assertIn('shopName:$("onboardingShopName").value.trim()', portal)
        self.assertNotIn('id="onboardingLegalIdentity"', portal)
        self.assertNotIn('id="companyOwnerForm"', owner)
        self.assertNotIn("معرّف الشركة", owner)
        self.assertNotIn("الشركات ومالكوها", owner)

    def test_owner_approval_then_payment_controls_ledger_access(self):
        auth = (ROOT / "shop-auth.js").read_text(encoding="utf-8")
        admin = (ROOT / "owner-admin.js").read_text(encoding="utf-8")
        dashboard = (ROOT / "shop-dashboard-v30.html").read_text(encoding="utf-8")
        self.assertIn("ledgerEnabled:Boolean(entitlement)", auth)
        self.assertIn('store.onboarding_status!=="preliminary_approved"', admin)
        self.assertIn('"preliminary_approved"', admin)
        self.assertIn("onboarding_status", admin)
        self.assertIn("contact_phone", auth)
        self.assertIn("onboardingContactPhone", (ROOT / "company" / "portal.html").read_text(encoding="utf-8"))
        self.assertIn("data-wa-store", (ROOT / "owner-console.html").read_text(encoding="utf-8"))
        self.assertIn("company.ledgerEnabled!==true", dashboard)
        self.assertIn("daga_entitlements", auth)

    def test_shop_data_is_not_opened_before_active_entitlement(self):
        auth = (ROOT / "shop-auth.js").read_text(encoding="utf-8")
        self.assertIn("e.service='store' AND e.status='active' AND e.starts_at<=? AND e.expires_at>?", auth)
        self.assertIn("/api/shop/auth/me", (ROOT / "shop-dashboard-v30.html").read_text(encoding="utf-8"))

if __name__ == "__main__":
    unittest.main()
