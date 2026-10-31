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

    def test_live_assistant_uses_v30_shop_auth_and_isolated_staging_api(self):
        assistant = (ROOT / "index.html").read_text(encoding="utf-8")
        worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        self.assertIn("daga-app-staging.dagamobile10.workers.dev", assistant)
        self.assertNotIn("daga-voice.dagamobile10.workers.dev", assistant)
        self.assertIn("/api/shop/auth/login", assistant)
        self.assertIn("/api/shop/auth/me", assistant)
        self.assertNotIn("/api/company/auth/login", assistant)
        self.assertIn('url.pathname === "/assistant"', worker)
        self.assertIn("smart_store_subscription_required", worker)
        self.assertIn("body?.liveAvatar === true", worker)
        self.assertIn("live_daga_subscription_required", worker)

    def test_live_assistant_receives_authenticated_shop_session_from_dashboard(self):
        dashboard = (ROOT / "shop-dashboard-v30.html").read_text(encoding="utf-8")
        assistant = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn("DAGA_ASSISTANT_READY", dashboard)
        self.assertIn("assistant.postMessage({type:'DAGA_AUTH',token,companyId:String(user.storeId||'')}", dashboard)
        self.assertIn("window.open('/assistant/','_blank')", dashboard)
        self.assertIn("DAGA_ASSISTANT_READY", assistant)
        self.assertIn("event.data.type!=='DAGA_AUTH'", assistant)
        self.assertIn("sessionStorage.setItem(DAGA_SESSION_KEY,event.data.token)", assistant)
        self.assertIn("refreshIdentity();", assistant)
        self.assertIn("event.source!==window.opener", assistant)

    def test_live_assistant_is_served_from_same_staging_worker_origin(self):
        worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        dashboard = (ROOT / "shop-dashboard-v30.html").read_text(encoding="utf-8")
        self.assertIn('url.pathname === "/assistant"', worker)
        self.assertIn("window.open('/assistant/','_blank')", dashboard)
        self.assertNotIn("window.location.assign('https://dagamobile10-creator.github.io/DAGA/')", dashboard)

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


    def test_team_invites_use_email_only_and_real_invitation_api(self):
        dashboard = (ROOT / "shop-dashboard-v30.html").read_text(encoding="utf-8")
        invitations = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        self.assertIn('id="teamEmail" type="email"', dashboard)
        self.assertNotIn("teamCountryCode", dashboard)
        self.assertNotIn("teamPhone", dashboard)
        self.assertIn("fetch('/api/company/invitations'", dashboard)
        self.assertIn("window.DAGA_SESSION_TOKEN=token", dashboard)
        self.assertIn('path === "/api/company/invitations" && request.method === "POST"', invitations)

    def test_live_daga_requires_both_smart_store_plan_and_live_entitlement_server_side(self):
        worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        self.assertIn("smart_store_subscription_required", worker)
        self.assertIn("json_extract(p.features_json,'$.tier')='smart'", worker)
        self.assertIn("live_daga_subscription_required", worker)
        self.assertIn("live_daga_quota_insufficient", worker)

    def test_standard_plan_overrides_legacy_smart_flags(self):
        admin = (ROOT / "owner-admin.js").read_text(encoding="utf-8")
        self.assertIn('source.tier !== "standard" && (source.smartAssistantEnabled === true || source.historyEnabled === true)', admin)

    def test_smart_entitlement_enables_assistant_and_history_separately_from_live_daga(self):
        auth = (ROOT / "shop-auth.js").read_text(encoding="utf-8")
        dashboard = (ROOT / "shop-dashboard-v30.html").read_text(encoding="utf-8")
        self.assertIn("p.features_json", auth)
        self.assertIn('features.smartAssistantEnabled===true||features.tier==="smart"', auth)
        self.assertIn('features.historyEnabled===true||features.tier==="smart"', auth)
        self.assertIn("smartAssistantEnabled:company.smartAssistantEnabled===true", dashboard)
        self.assertIn("historyEnabled:company.historyEnabled===true", dashboard)
        self.assertIn("b.hidden=false;b.disabled=!smartAllowed", dashboard)
        self.assertIn("b.hidden=false;b.disabled=!liveAllowed", dashboard)
        self.assertIn("b.hidden=false;b.disabled=!window.DAGA_AUTH_USER.historyEnabled", dashboard)
        self.assertIn("smartAllowed&&window.DAGA_AUTH_USER.liveDagaEnabled===true", dashboard)


if __name__ == "__main__":
    unittest.main()
