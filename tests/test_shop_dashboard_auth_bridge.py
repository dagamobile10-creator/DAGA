from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class ShopDashboardAuthBridgeTests(unittest.TestCase):
    def test_original_v30_dashboard_is_served_on_shop_route(self):
        worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        self.assertIn('import shopDashboardHtml from "./shop-dashboard-v30.html";', worker)
        self.assertIn('url.pathname === "/shop"', worker)

    def test_dashboard_requires_authenticated_company_session(self):
        dashboard = (ROOT / "shop-dashboard-v30.html").read_text(encoding="utf-8")
        self.assertIn("sessionStorage.getItem('daga_company_session')", dashboard)
        self.assertIn("fetch('/api/company/auth/me'", dashboard)
        self.assertIn("window.location.replace('/company/')", dashboard)
        self.assertIn("bootAuthenticatedDashboard();", dashboard)

    def test_portal_passes_session_and_selected_company(self):
        portal = (ROOT / "company" / "portal.html").read_text(encoding="utf-8")
        self.assertIn('sessionStorage.setItem("daga_company_session",sessionToken)', portal)
        self.assertIn('sessionStorage.setItem("daga_selected_company",activeCompany?activeCompany.id:"")', portal)
        self.assertIn('window.location.assign("/shop/")', portal)

    def test_role_is_normalized_and_not_used_as_security_boundary(self):
        dashboard = (ROOT / "shop-dashboard-v30.html").read_text(encoding="utf-8")
        self.assertIn("if(role==='owner')role='store_owner';", dashboard)
        self.assertIn("Authorization:'Bearer '+token", dashboard)
        self.assertIn("api/company/auth/logout", dashboard)


if __name__ == "__main__":
    unittest.main()
