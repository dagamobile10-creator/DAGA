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
        self.assertIn("fetch('/api/company/auth/me'", dashboard)
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
        self.assertIn("api/company/auth/logout", dashboard)

    def test_store_plan_tier_is_saved_and_editable(self):
        admin = (ROOT / "owner-admin.js").read_text(encoding="utf-8")
        console = (ROOT / "owner-console.html").read_text(encoding="utf-8")
        self.assertIn("normalizeStoreFeatures(b.features)", admin)
        self.assertIn("features_json=?,is_active=?", admin)
        self.assertIn("features={tier:smart?'smart':'standard',smartAssistantEnabled:smart,historyEnabled:smart}", console)
        self.assertIn("مستوى اشتراك الشركه:", console)


    def test_team_invites_use_email_only_and_real_invitation_api(self):
        dashboard = (ROOT / "shop-dashboard-v30.html").read_text(encoding="utf-8")
        invitations = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        self.assertIn('id="teamEmail" type="email"', dashboard)
        self.assertNotIn("teamCountryCode", dashboard)
        self.assertNotIn("teamPhone", dashboard)
        self.assertIn("fetch('/api/company/invitations'", dashboard)
        self.assertIn("window.DAGA_SESSION_TOKEN=token", dashboard)
        self.assertIn('path === "/api/company/invitations" && request.method === "POST"', invitations)

    def test_live_daga_requires_live_entitlement_without_smart_plan_dependency(self):
        worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        self.assertIn("smart_store_subscription_required", worker)
        self.assertNotIn("store_subscription_required", worker)
        tts = worker[worker.index('if (url.pathname !== "/tts"'):]
        self.assertNotIn("smart_store_subscription_required", tts)
        self.assertIn("live_daga_subscription_required", tts)
        self.assertIn('resolveCompanyVoiceContext(env, account, request.headers.get("X-DAGA-Company-ID") || "")', tts)
        self.assertIn("live_daga_quota_insufficient", worker)

    def test_standard_plan_overrides_legacy_smart_flags(self):
        admin = (ROOT / "owner-admin.js").read_text(encoding="utf-8")
        self.assertIn('source.tier !== "standard" && (source.smartAssistantEnabled === true || source.historyEnabled === true)', admin)

    def test_smart_entitlement_enables_assistant_and_history_separately_from_live_daga(self):
        auth = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        dashboard = (ROOT / "shop-dashboard-v30.html").read_text(encoding="utf-8")
        self.assertIn("const smartEnabled = Boolean(storeEntitlement && (features.smartAssistantEnabled === true || features.tier === \"smart\"))", auth)
        self.assertIn("smartAssistantEnabled: smartEnabled", auth)
        self.assertIn('features.historyEnabled === true || features.tier === "smart"', auth)
        self.assertIn("smartAssistantEnabled:company.smartAssistantEnabled===true&&(role==='store_owner'||company.permissions?.useSmartAssistant===true)", dashboard)
        self.assertIn("historyEnabled:company.historyEnabled===true", dashboard)
        self.assertIn("b.hidden=false;b.disabled=!smartAllowed", dashboard)
        self.assertIn("b.hidden=false;b.disabled=!liveAllowed", dashboard)
        self.assertIn("const liveAllowed=window.DAGA_AUTH_USER.liveDagaEnabled===true", dashboard)
        self.assertIn("اشحن رصيد حروف LIVE DAGA لتفعيل الزر.", dashboard)
        self.assertNotIn("smartAllowed&&window.DAGA_AUTH_USER.liveDagaEnabled===true", dashboard)


    
    def test_company_dashboard_is_locked_until_owner_confirms_payment(self):
        auth = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        portal = (ROOT / "company" / "portal.html").read_text(encoding="utf-8")
        dashboard = (ROOT / "shop-dashboard-v30.html").read_text(encoding="utf-8")
        self.assertIn('const accountPaths = ["/api/company/auth/me", "/api/company/auth/logout"]', auth)
        self.assertIn('return json(env, { ok: true, account:', auth)
        self.assertIn('ledgerEnabled: Boolean(storeEntitlement)', auth)
        self.assertIn('activeCompany.ledgerEnabled===true', portal)
        self.assertIn('لوحة الشركة هتفتح بعد ما مالك التطبيق يأكد الدفع.', portal)
        self.assertIn('company.ledgerEnabled!==true', dashboard)

    def test_live_daga_requires_smart_subscription_and_positive_word_balance(self):
        auth = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        live = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn('liveDagaEnabled: smartEnabled && remainingWords > 0', auth)
        self.assertIn('liveWordsRemaining: remainingWords', auth)
        self.assertIn('body:JSON.stringify({mode:\'live_daga\',text})', live)
        self.assertIn('if (liveMode) {', worker)
        self.assertIn("live_daga_quota_insufficient", worker)
        self.assertIn("LIVE DAGA generated text characters", worker)
        self.assertIn('const voiceIdentityRequired = true;', worker)

    def test_only_smart_store_entitlement_enables_kallim_daga(self):
        auth = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        dashboard = (ROOT / "shop-dashboard-v30.html").read_text(encoding="utf-8")
        self.assertIn('smartAssistantEnabled: Boolean(storeEntitlement)', auth)
        self.assertIn('service=\'store\' AND status=\'active\'', worker)
        self.assertIn('b.disabled=!smartAllowed', dashboard)
        self.assertIn('ميزة كلم ضجه متاحة بعد تأكيد الاشتراك العادي أو الذكي للشركة.', dashboard)

    def test_company_owner_can_list_members_and_update_individual_permissions(self):
        invitations = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        dashboard = (ROOT / "shop-dashboard-v30.html").read_text(encoding="utf-8")
        self.assertIn('path === "/api/company/members"', invitations)
        self.assertIn('request.method === "PATCH"', invitations)
        self.assertIn("company_owner_required", invitations)
        self.assertIn("company_member_permissions_updated", invitations)
        self.assertIn("manageUsers", invitations)
        self.assertIn("useSmartAssistant", invitations)
        self.assertIn("useLiveDaga", invitations)
        self.assertIn("fetch('/api/company/members?storeId='", dashboard)
        self.assertIn("saveTeamMemberPermissions", dashboard)
        self.assertIn("data-team-permission", dashboard)

    def test_company_visible_labels_are_updated_without_changing_storage_identifiers(self):
        portal = (ROOT / "company" / "portal.html").read_text(encoding="utf-8")
        self.assertIn("تسجيل شركة جديدة", portal)
        self.assertIn("اسم صاحب الشركه", portal)
        self.assertIn("اسم الشركه", portal)
        self.assertIn("daga_stores", (ROOT / "company-invitations.js").read_text(encoding="utf-8"))

    def test_preliminary_store_approval_cannot_activate_before_payment_confirmation(self):
        admin = (ROOT / "owner-admin.js").read_text(encoding="utf-8")
        self.assertIn('final_payment_confirmation_required', admin)
        self.assertIn('paymentManuallyConfirmed:true', admin)
        self.assertIn('paymentConfirmed!==true', admin)

    def test_live_daga_chat_requires_smart_plan_and_word_balance(self):
        worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        live = (ROOT / "index.html").read_text(encoding="utf-8")
        chat = worker[worker.index('if (url.pathname === "/chat"'):worker.index('if (url.pathname !== "/tts"')]
        self.assertIn("body?.mode === \"live_daga\"", chat)
        self.assertIn('permission = liveMode ? "useLiveDaga" : "useSmartAssistant"', chat)
        self.assertIn("service='store'", chat)
        self.assertIn("smart_store_subscription_required", chat)
        self.assertIn("live_daga_quota_insufficient", chat)
        self.assertNotIn("service='live_daga'", chat)
        self.assertIn("smart_store_subscription_required", chat)
        self.assertNotIn("store_subscription_required", chat)
        self.assertIn("mode:'live_daga'", live)

    def test_voice_routes_enforce_member_permissions_independently(self):
        worker = (ROOT / "worker.js").read_text(encoding="utf-8")
        self.assertIn('const permission = liveMode ? "useLiveDaga" : "useSmartAssistant"', worker)
        self.assertIn('company.permissions.useLiveDaga !== true', worker)
        self.assertIn('context.permissions[permissionKey] !== true', worker)
        self.assertIn('company_voice_permission_denied', worker)

    def test_shop_registration_uses_email_only_and_company_contact_is_optional(self):
        auth = (ROOT / "shop-auth.js").read_text(encoding="utf-8")
        self.assertIn("valid_shop_owner_name_and_email_required", auth)
        self.assertIn("if(contactPhone&&contactPhone.replace", auth)
        self.assertIn("valid_optional_company_contact_phone_required", auth)
        portal = (ROOT / "company" / "portal.html").read_text(encoding="utf-8")
        self.assertIn("رقم واتساب الشركة للتواصل والدعم (اختياري)", portal)
        self.assertNotIn('id="onboardingContactPhone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" required', portal)

    def test_company_support_whatsapp_uses_selected_company_contact_not_app_owner(self):
        profile = (ROOT / "company-invitations.js").read_text(encoding="utf-8")
        self.assertIn("s.contact_phone", profile)
        self.assertIn("contactPhone: row.contact_phone || \"\"", profile)
        dashboard = (ROOT / "shop-dashboard-v30.html").read_text(encoding="utf-8")
        self.assertIn("contactPhone:company.contactPhone||''", dashboard)
        self.assertIn("String(user.contactPhone||\"\")", dashboard)
        self.assertIn('const url="https://wa.me/"+phone', dashboard)


if __name__ == "__main__":
    unittest.main()
