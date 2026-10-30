from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class ShopDashboardAuthBridgeTests(unittest.TestCase):
    def test_original_v30_dashboard_is_served_on_shop_route(self):
        worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        self.assertIn('import shopDashboardHtml from "./shop-dashboard-v30.html";', worker)
        self.assertIn('url.pathname === "/shop"', worker)

    def test_dashboard_requires_authenticated_shop_session(self):
        dashboard = (ROOT / "shop-dashboard-v30.html").read_text(encoding="utf-8")
        self.assertIn("DAGA_SHOP_READY", dashboard)
        self.assertIn("bootAuthenticatedDashboard(event.data.token,event.data.companyId)", dashboard)
        self.assertNotIn("sessionStorage", dashboard)
        self.assertIn("fetch('/api/shop/auth/me'", dashboard)
        self.assertIn("window.location.replace('/shop-access/')", dashboard)
        self.assertIn("if(window.opener)", dashboard)
        self.assertIn("loadStoreData(company.id)", dashboard)
        self.assertIn("daga_dashboard_v30_store_", dashboard)

    def test_portal_passes_session_and_selected_company(self):
        portal = (ROOT / "company" / "portal.html").read_text(encoding="utf-8")
        self.assertIn('type:"DAGA_AUTH",token:sessionToken,companyId:activeCompany.id', portal)
        self.assertNotIn("sessionStorage", portal)
        self.assertIn('window.open("about:blank","_blank")', portal)
        self.assertIn('shopWindow.location.assign("/shop/")', portal)
        self.assertIn('event.source!==shopWindow', portal)

    def test_role_is_normalized_and_not_used_as_security_boundary(self):
        dashboard = (ROOT / "shop-dashboard-v30.html").read_text(encoding="utf-8")
        self.assertIn("if(role==='owner')role='store_owner';", dashboard)
        self.assertIn("Authorization:'Bearer '+token", dashboard)
        self.assertIn("api/shop/auth/logout", dashboard)

    def test_store_plan_tier_is_saved_and_editable(self):
        admin = (ROOT / "owner-admin.js").read_text(encoding="utf-8")
        console = (ROOT / "owner-console.html").read_text(encoding="utf-8")
        self.assertIn("normalizeStoreFeatures(b.features)", admin)
        self.assertIn("features_json=?,is_active=?", admin)
        self.assertIn("features={tier:smart?'smart':'standard',smartAssistantEnabled:smart,historyEnabled:smart}", console)
        self.assertIn("مستوى اشتراك المحل:", console)

    def test_smart_entitlement_enables_assistant_and_history_separately_from_live_daga(self):
        auth = (ROOT / "shop-auth.js").read_text(encoding="utf-8")
        dashboard = (ROOT / "shop-dashboard-v30.html").read_text(encoding="utf-8")
        self.assertIn("p.features_json", auth)
        self.assertIn('features.smartAssistantEnabled===true||features.tier==="smart"', auth)
        self.assertIn('features.historyEnabled===true||features.tier==="smart"', auth)
        self.assertIn("smartAssistantEnabled:company.smartAssistantEnabled===true", dashboard)
        self.assertIn("historyEnabled:company.historyEnabled===true", dashboard)
        self.assertIn("b.hidden=!window.DAGA_AUTH_USER.smartAssistantEnabled", dashboard)
        self.assertIn("b.hidden=!window.DAGA_AUTH_USER.historyEnabled", dashboard)


if __name__ == "__main__":
    unittest.main()
