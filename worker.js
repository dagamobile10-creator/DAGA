import { handleOwnerAuth } from "./owner-auth.js";
import { handleOwnerAdmin } from "./owner-admin.js";
import { handleCompanyInvitations } from "./company-invitations.js";
import { handleCompanyOrders } from "./company-orders.js";
import { handleShopAuth } from "./shop-auth.js";
import { authenticatedAccount } from "./owner-auth.js";
import inviteHtml from "./invite/index.html";
import shopPortalHtml from "./company/portal.html";
import shopDashboardHtml from "./shop-dashboard-v30.html";
import officialLandingHtml from "./go/index.html";
import ownerConsoleHtml from "./owner-console.html";
import liveDagaHtml from "./index.html";
import entryHtml from "./entry/index.html";
const VOICE_ID = "NG9zqiTuEbX3Nw0gjYcc"; // Previous voice ID backup: PF3gVGPrCr6Dw1WaSSiy

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if ((url.pathname === "/" || url.pathname === "/portal" || url.pathname === "/portal/") && request.method === "GET") {
      return new Response(entryHtml, { status: 200, headers: {
        "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; img-src data:; font-src https://fonts.gstatic.com; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
      }});
    }

    if ((url.pathname === "/go" || url.pathname === "/go/") && request.method === "GET") {
      return new Response(officialLandingHtml, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=300",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
        }
      });
    }

    if ((url.pathname === "/live" || url.pathname === "/live/") && request.method === "GET") {
      return new Response(liveDagaHtml, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "Permissions-Policy": "camera=(self), microphone=(self)",
          "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://esm.sh; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self' https: wss:; font-src 'self' data: https:; base-uri 'self'; frame-ancestors 'self' https://daga-app-staging.dagamobile10.workers.dev; form-action 'self'"
        }
      });
    }

    if ((url.pathname === "/owner" || url.pathname === "/owner/" || url.pathname === "/owner-console" || url.pathname === "/owner-console/") && request.method === "GET") {
      return new Response(ownerConsoleHtml, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        }
      });
    }

    if ((url.pathname === "/shop" || url.pathname === "/shop/") && request.method === "GET") {
      return new Response(shopDashboardHtml, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'self'; frame-src 'self' https://daga-app-staging.dagamobile10.workers.dev; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        }
      });
    }

    if ((url.pathname === "/shop-access" || url.pathname === "/shop-access/" || url.pathname === "/company" || url.pathname === "/company/") && request.method === "GET") {
      return new Response(shopPortalHtml, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
        }
      });
    }

    if ((url.pathname === "/invite" || url.pathname === "/invite/") && request.method === "GET") {
      return new Response(inviteHtml, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
        }
      });
    }

    let ownerAuthResponse;
    try {
      ownerAuthResponse = await handleOwnerAuth(request, env, url);
    } catch (error) {
      // Keep auth API failures JSON-shaped and log only a bounded diagnostic, never request data.
      console.error("owner_auth_unhandled", url.pathname, error instanceof Error ? error.name : "unknown_error", error instanceof Error ? error.message : "no_error_message");
      return json({ error: "owner_auth_internal_error", ...(url.hostname === "daga-app-staging.dagamobile10.workers.dev" ? { diagnostic: error instanceof Error ? error.message.slice(0, 200) : "unknown_error" } : {}) }, 500);
    }
    if (ownerAuthResponse) return ownerAuthResponse;
    if (url.pathname === "/api/company/dashboard-layout" && request.method === "GET") {
      const db = env.DAGA_APP_DB;
      if (!db) return json({ error: "application_database_not_configured" }, 503);
      const account = await authenticatedAccount(request, db);
      if (!account || account.status !== "approved" || account.role === "program_owner") return json({ error: "company_session_required" }, 401);
      const selected = String(url.searchParams.get("storeId") || request.headers.get("X-DAGA-Company-ID") || "").trim();
      let storeId = "";
      if (account.role === "store_owner") {
        if (!selected) return json({ error: "company_selection_required" }, 400);
        const owned = await db.prepare("SELECT id FROM daga_stores WHERE id=? AND owner_account_id=? AND status='approved'").bind(selected, account.id).first();
        if (!owned) return json({ error: "company_membership_required" }, 403);
        storeId = owned.id;
      } else if (["manager","employee"].includes(account.role)) {
        if (!selected) return json({ error: "company_selection_required" }, 400);
        const membership = await db.prepare("SELECT m.store_id FROM daga_store_memberships m JOIN daga_stores s ON s.id=m.store_id WHERE m.account_id=? AND m.store_id=? AND m.status='active' AND m.role=? AND s.status='approved'").bind(account.id,selected,account.role).first();
        if (!membership) return json({ error: "company_membership_required" }, 403);
        storeId = membership.store_id;
      } else return json({ error: "company_membership_required" }, 403);
      const row = await db.prepare("SELECT id,layout_json,version,updated_at FROM daga_dashboard_layouts WHERE scope='store' AND store_id=?").bind(storeId).first();
      let layout = null;
      if (row) { try { layout = JSON.parse(row.layout_json); } catch (_) { return json({ error: "stored_layout_invalid" }, 500); } }
      return json({ ok: true, storeId, layout, version: Number(row?.version || 0), updatedAt: row?.updated_at || null });
    }
    const shopAuthResponse = await handleShopAuth(request, env, url);
    if (shopAuthResponse) return shopAuthResponse;
    const ownerAdminResponse = await handleOwnerAdmin(request, env, url);
    if (ownerAdminResponse) return ownerAdminResponse;
    const invitationResponse = await handleCompanyInvitations(request, env, url);
    if (invitationResponse) return invitationResponse;
    const companyOrderResponse = await handleCompanyOrders(request, env, url);
    if (companyOrderResponse) return companyOrderResponse;

    if (request.method === "OPTIONS") return new Response(null, { headers: cors({ allowedOrigins: env.DAGA_ALLOWED_ORIGINS || "" }) });

    // Optional staged protection for expensive public voice routes. Keep disabled
    // until the client has authenticated sessions; staging enables it for smoke tests.
    const publicLimit = (
      (url.pathname === "/liveavatar/token" && request.method === "POST") ||
      (url.pathname === "/liveavatar/avatars" && request.method === "GET") ||
      (url.pathname === "/chat" && request.method === "POST") ||
      (url.pathname === "/tts" && request.method === "POST") ||
      (url.pathname === "/memory" && ["GET", "POST"].includes(request.method))
    ) ? ({
      "/liveavatar/token": [10, 900],
      "/liveavatar/avatars": [30, 300],
      "/chat": [30, 300],
      "/tts": [30, 300],
      "/memory": [60, 300]
    }[url.pathname]) : null;
    if (publicLimit && String(env.DAGA_PUBLIC_API_RATE_LIMITS || "").toLowerCase() === "true") {
      if (!env.DAGA_APP_DB || !env.DAGA_OTP_PEPPER) return json({ error: "public_api_rate_limit_not_configured" }, 503);
      const ip = String(request.headers.get("CF-Connecting-IP") || "unknown").slice(0, 128);
      const allowed = await applyPublicApiRateLimit(env.DAGA_APP_DB, env.DAGA_OTP_PEPPER, url.pathname + ":" + ip, publicLimit[0], publicLimit[1]);
      if (!allowed) return json({ error: "rate_limited" }, 429);
    }

    if (url.pathname === "/memory" && (request.method === "GET" || request.method === "POST")) {
      try {
        let body = null;
        if (request.method === "POST") {
          const parsed = await readBoundedJson(request, 160000);
          if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
          body = parsed.value;
        }
        // When enabled, persistent memory is bound to the verified server-side account.
        // Never trust a caller-supplied userId as proof of memory ownership.
        let userId;
        if (String(env.DAGA_MEMORY_REQUIRE_AUTH || "").toLowerCase() === "true") {
          if (!env.DAGA_APP_DB) return json({ error: "authenticated_memory_not_configured" }, 503);
          const account = await authenticatedAccount(request, env.DAGA_APP_DB);
          if (!account || account.status !== "approved" || account.role === "program_owner") {
            return json({ error: "authenticated_account_required" }, 401);
          }
          userId = String(account.id || "").trim();
        } else {
          // Temporary compatibility mode for the existing anonymous LIVE DAGA client.
          // Disable after the client has a supported sign-in and one-time memory-claim flow.
          userId = String(url.searchParams.get("userId") || (request.method === "POST" ? body?.userId : "") || "").trim();
        }
        if (!/^[a-f0-9-]{32,36}$/i.test(userId)) return json({ error: "valid_user_identity_required" }, 400);
        const memoryDb = env.DAGA_MEMORY_DB || env.DAGA_APP_DB;
        if (!memoryDb) return json({ error: "persistent_memory_not_configured" }, 503);
        if (request.method === "GET") {
          const row = await memoryDb.prepare("SELECT profile_json, history_json, updated_at FROM daga_user_memory WHERE user_id = ?").bind(userId).first();
          return json({ ok: true, persistent: true, memory: row ? { profile: JSON.parse(row.profile_json || "{}"), history: JSON.parse(row.history_json || "[]"), updatedAt: row.updated_at } : { profile: {}, history: [], updatedAt: null } });
        }
        const profile = body?.profile && typeof body.profile === "object" && !Array.isArray(body.profile) ? body.profile : {};
        const profileJson = JSON.stringify(profile);
        if (profileJson.length > 10000) return json({ error: "profile_too_large", maxLength: 10000 }, 413);
        let history = Array.isArray(body?.history) ? body.history.filter(x => x && ["user", "assistant"].includes(x.role) && typeof x.content === "string").slice(-100).map(x => ({ role: x.role, content: x.content.slice(0, 2000) })) : [];
        while (history.length && JSON.stringify(history).length > 120000) history.shift();
        const now = new Date().toISOString();
        await memoryDb.prepare("INSERT INTO daga_user_memory (user_id, profile_json, history_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET profile_json=excluded.profile_json, history_json=excluded.history_json, updated_at=excluded.updated_at").bind(userId, profileJson, JSON.stringify(history), now).run();
        return json({ ok: true, persistent: true, updatedAt: now });
      } catch (error) {
        return json({ error: "memory_storage_failed" }, 500);
      }
    }

    if (url.pathname === "/liveavatar/avatars" && request.method === "GET") {
      if (!env.LIVEAVATAR_API_KEY) return json({ error: "LIVEAVATAR_API_KEY secret is not configured" }, 503);
      try {
        const response = await fetch("https://api.liveavatar.com/v1/avatars?page=1&page_size=100", {
          headers: { "X-API-KEY": env.LIVEAVATAR_API_KEY, "Accept": "application/json" },
          signal: AbortSignal.timeout(10000)
        });
        const data = await response.json();
        if (!response.ok) return json({ error: "liveavatar_avatar_lookup_failed", status: response.status }, response.status);
        const avatars = data?.data?.results || [];
        const active = avatars.filter(a => a.status === "ACTIVE");
        let publicActiveCount = 0, publicHasDaga = false;
        try {
          const publicResponse = await fetch("https://api.liveavatar.com/v1/avatars/public?page=1&page_size=100", {
            headers: { "X-API-KEY": env.LIVEAVATAR_API_KEY, "Accept": "application/json" },
            signal: AbortSignal.timeout(10000)
          });
          if (publicResponse.ok) {
            const publicData = await publicResponse.json();
            const publicActive = (publicData?.data?.results || []).filter(a => a.status === "ACTIVE" && !a.is_expired);
            publicActiveCount = publicActive.length;
            publicHasDaga = publicActive.some(a => /daga|ضجه|ضجّة|\bmh\b|محمد\s*حامد/i.test(String(a.name || "")));
          }
        } catch (_) {}
        const privateHasDaga = active.some(a => /daga|ضجه|ضجّة|\bmh\b|محمد\s*حامد/i.test(String(a.name || "")));
        return json({ ok: true, count: data?.data?.count ?? avatars.length, activeCount: active.length, hasActiveDaga: privateHasDaga || publicHasDaga, publicActiveCount });
      } catch (_) { return json({ error: "liveavatar_lookup_failed" }, 502); }
    }

    if (url.pathname === "/liveavatar/token" && request.method === "POST") {
      // This route exits before the shared chat/TTS gate, so authenticate and enforce LIVE DAGA entitlements here.
      if (!env.DAGA_APP_DB) return json({ error: "authenticated_voice_not_configured" }, 503);
      const account = await authenticatedAccount(request, env.DAGA_APP_DB);
      if (!account || account.status !== "approved" || account.role === "program_owner") {
        return json({ error: "authenticated_account_required" }, 401);
      }
      const company = await resolveCompanyVoiceContext(env, account, request.headers.get("X-DAGA-Company-ID") || "");
      if (company.error) return company.error;
      if (company.role !== "store_owner" && company.permissions.useLiveDaga !== true) return json({ error: "company_voice_permission_denied", permission: "useLiveDaga" }, 403);
      const words = await env.DAGA_APP_DB.prepare("SELECT COALESCE(SUM(CASE WHEN event_type IN ('credit','adjustment','refund') THEN words ELSE -words END),0) AS remaining FROM daga_live_word_ledger WHERE store_id=?").bind(company.storeId).first();
      if (Number(words?.remaining || 0) <= 0) return json({ error: "live_daga_quota_insufficient", remainingCharacters: 0 }, 402);
      if (!env.LIVEAVATAR_API_KEY) return json({ error: "LIVEAVATAR_API_KEY secret is not configured" }, 503);
      try {
        let avatarId = String(env.LIVEAVATAR_AVATAR_ID || "").trim();
        if (!avatarId) {
          const listResponse = await fetch("https://api.liveavatar.com/v1/avatars?page=1&page_size=100", {
            headers: { "X-API-KEY": env.LIVEAVATAR_API_KEY, "Accept": "application/json" },
            signal: AbortSignal.timeout(10000)
          });
          const listData = await listResponse.json();
          if (!listResponse.ok) return json({ error: "liveavatar_avatar_lookup_failed", status: listResponse.status }, listResponse.status);
          const avatars = listData?.data?.results || [];
          let chosen = avatars.find(a => /daga|ضجه|ضجّة|\bmh\b|محمد\s*حامد/i.test(String(a.name || "")) && a.status === "ACTIVE") || (avatars.length === 1 && avatars[0].status === "ACTIVE" ? avatars[0] : null);
          if (!chosen) {
            try {
              const publicResponse = await fetch("https://api.liveavatar.com/v1/avatars/public?page=1&page_size=100", {
                headers: { "X-API-KEY": env.LIVEAVATAR_API_KEY, "Accept": "application/json" },
                signal: AbortSignal.timeout(10000)
              });
              if (publicResponse.ok) {
                const publicData = await publicResponse.json();
                const publicAvatars = publicData?.data?.results || [];
                chosen = publicAvatars.find(a => /daga|ضجه|ضجّة|\bmh\b|محمد\s*حامد/i.test(String(a.name || "")) && a.status === "ACTIVE" && !a.is_expired) || null;
              }
            } catch (_) {}
          }
          if (chosen) {
            avatarId = chosen.id;
          } else {
            return json({ error: "MH LiveAvatar is not configured. Add the custom MH avatar to LiveAvatar and set LIVEAVATAR_AVATAR_ID.", availableAvatarCount: avatars.length, activeAvatarCount: avatars.filter(a => a.status === "ACTIVE").length }, 409);
          }
        }
        const response = await fetch("https://api.liveavatar.com/v1/sessions/token", {
          method: "POST",
          headers: { "X-API-KEY": env.LIVEAVATAR_API_KEY, "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ mode: "LITE", avatar_id: avatarId, is_sandbox: false }),
          signal: AbortSignal.timeout(12000)
        });
        const data = await response.json();
        if (!response.ok) return json({ error: "liveavatar_session_token_failed", status: response.status }, response.status);
        const sessionToken = typeof data?.data?.session_token === "string" ? data.data.session_token.trim() : "";
        const sessionId = typeof data?.data?.session_id === "string" ? data.data.session_id.trim() : "";
        if (!sessionToken || !sessionId) return json({ error: "liveavatar_session_token_invalid" }, 502);
        return json({ ok: true, sessionToken, sessionId });
      } catch (_) { return json({ error: "liveavatar_token_failed" }, 502); }
    }

    if (url.pathname === "/api/support/contact" && request.method === "GET") {
      if (!env.DAGA_APP_DB) return json({error:"application_database_not_configured"},503);
      const row = await env.DAGA_APP_DB.prepare("SELECT setting_value FROM daga_app_settings WHERE setting_key='support_whatsapp'").first();
      return json({ok:true,whatsapp:row?.setting_value||""});
    }

    if (url.pathname === "/health") {
      return json({ ok: true, voiceConfigured: Boolean(env.ELEVENLABS_API_KEY), chatConfigured: Boolean(env.OPENAI_API_KEY || env.GROQ_API_KEY || env.AI), freeChatConfigured: Boolean(env.GROQ_API_KEY || env.AI), liveAvatarConfigured: Boolean(env.LIVEAVATAR_API_KEY), liveAvatarIdConfigured: Boolean(env.LIVEAVATAR_AVATAR_ID) });
    }

    // Subscription-controlled voice routes always require the authenticated company session.
    let voiceAccount = null;
    const voiceIdentityRequired = true;
    if (voiceIdentityRequired && ["/chat", "/tts", "/liveavatar/token"].includes(url.pathname)) {
      if (!env.DAGA_APP_DB) return json({ error: "authenticated_voice_not_configured" }, 503);
      voiceAccount = await authenticatedAccount(request, env.DAGA_APP_DB);
      if (!voiceAccount || voiceAccount.status !== "approved" || voiceAccount.role === "program_owner") {
        return json({ error: "authenticated_account_required" }, 401);
      }
    }

    if (url.pathname === "/chat" && request.method === "POST") {
      try {
        const parsed = await readBoundedJson(request, 32768);
        if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
        const body = parsed.value;
        if (voiceIdentityRequired) {
          const company = await resolveCompanyVoiceContext(env, voiceAccount, request.headers.get("X-DAGA-Company-ID") || "");
          if (company.error) return company.error;
          const liveMode = body?.mode === "live_daga";
          const permission = liveMode ? "useLiveDaga" : "useSmartAssistant";
          if (company.role !== "store_owner" && company.permissions[permission] !== true) {
            return json({ error: "company_voice_permission_denied", permission }, 403);
          }
          const now = new Date().toISOString();
          if (liveMode) {
            // LIVE DAGA is paid and consumed by its own character ledger; a separate
            // time-based entitlement must not block a company that still has credits.
            const words = await env.DAGA_APP_DB.prepare("SELECT COALESCE(SUM(CASE WHEN event_type IN ('credit','adjustment','refund') THEN words ELSE -words END),0) AS remaining FROM daga_live_word_ledger WHERE store_id=?").bind(company.storeId).first();
            if (Number(words?.remaining || 0) <= 0) return json({ error: "live_daga_quota_insufficient", remainingCharacters: 0 }, 402);
          } else {
            const smartPlan = await env.DAGA_APP_DB.prepare("SELECT id FROM daga_entitlements WHERE store_id=? AND service='store' AND status='active' AND starts_at<=? AND expires_at>? LIMIT 1").bind(company.storeId, now, now).first();
            if (!smartPlan) return json({ error: "store_or_live_subscription_required" }, 402);
          }
        }
        const userText = String(body?.text || "").trim();
        if (!userText) return json({ error: "text is required" }, 400);
        if (userText.length > 2000) return json({ error: "text_too_long", maxLength: 2000 }, 413);
        const history = Array.isArray(body?.history) ? body.history.slice(-8).filter(item => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string" && item.content.trim()).map(item => ({ role: item.role, content: item.content.trim().slice(0, 500) })) : [];
        const conversation = [...history, { role: "user", content: userText }];
        const businessContext = typeof body?.businessContext === "string" ? body.businessContext.trim().slice(0, 14000) : "";
        const memory = body?.memory && typeof body.memory === "object" ? JSON.stringify(body.memory).slice(0, 800) : "";

        const verifiedIdentityContext = voiceAccount
          ? "\\n\\nهوية الحساب الموثقة من الخادم: " + JSON.stringify({ accountId: voiceAccount.id, publicId: voiceAccount.public_id || null, displayName: voiceAccount.display_name || null, role: voiceAccount.role, storeId: voiceAccount.store_id || null }) + ". استخدم هذه الهوية فقط عند الحاجة؛ لا تعتبرها دليلًا على بيانات مالية أو صلاحيات شركة غير مسترجعة من قاعدة البيانات."
          : "";
        const instructions = [
          "الفهم الذكي مش مطابقة كلمات: أنت نموذج محادثة ذكي، افهم المعنى المقصود حتى لو المستخدم صاغ السؤال بلهجة مختلفة أو أخطأ في الاسم أو استخدم وصفًا بدل اسم العمود. اربط الضمائر والإشارات بآخر الحوار، واستنتج المقصود من السياق والبيانات المتاحة، لا من تطابق جملة محفوظة. اشرح السبب والعلاقة بين الحركة والنتيجة، لا تردد نص قاعدة. لا تفترض أن كل سؤال أمر تنفيذ. إذا كان المقصود واضحًا أجب مباشرة، وإذا كان هناك احتمالان يغيّران النتيجة اسأل سؤال توضيح واحدًا. لا تخترع معلومة غير موجودة، وكن صريحًا بشأن ما لا تستطيع معرفته. اجعل الحوار طبيعيًا ومتبادلًا، ولا تحوّل كل رد إلى صيغة خدمة عملاء.",
          "العقل المحاسبي والسياق الحي: اقرأ لقطة الداشبورد كاملة قبل الرد. هي تحتوي أعمدة وصفوفًا فرعية، ولازم تفرّق بين اسم العمود واسم البند. إذا قال المستخدم «آخر حركة في الفلوس» أو «آخر حاجة حصلت في الفلوس»، ابحث في recentLedger المرتب زمنيًا؛ اعرض أحدث حركة تخص الفلوس/الكاش أو moneyDelta، مع وقتها وتفاصيلها، ولا تطلب اسم شخص. إذا لم توجد حركة مناسبة في recentLedger، قل إن سجل الحركات غير متاح حاليًا ولا تخمّن. إذا قال «رصيد أساسي» أو «الرصيد الأساسي» وحدد أنه في عمود الكروت، ابحث عن صف الاسم المطابق داخل عمود role=cards، ولا تبحث عن اسم شخص ولا عن عمود role=balance. افهم أفعال التغيير المصرية: شيل/انزل/نزل/اطرح/اخصم/خصم/قلل/اسحب تعني تقليل القيمة، وزوّد/ضيف/ارفع/حط/سجل تعني زيادة القيمة. إذا حدد المستخدم البند والعمود والمبلغ، جهّز معاينة تعديل على نفس الصف تشمل القيمة الحالية والجديدة والفرق وأثرها على الفلوس الأساسية أو رصيد المندوب حسب قواعد البند؛ لا تسأل عن اسم شخص غير مذكور ولا تطلب إعادة صياغة الأمر. لا تنفذ من لقطة القراءة وحدها؛ استخدم مسار تنفيذ الداشبورد الذي يتحقق من القيمة الحالية ويحفظ قيدًا واحدًا.",
          "تنسيق العربي: اكتب كل كلمة عربية منفصلة بمسافة واحدة واضحة قبلها وبعدها. ممنوع دمج كلمتين مثل «فوريزيد» أو «رصيدأساسي»؛ اكتب «فوري يزيد» و«رصيد أساسي». لا تستخدم تشكيلًا أو Markdown أو نجومًا أو جداول. اجعل الجمل قصيرة، واستخدم الفاصلة العربية للفصل عند الحاجة. لا تكرر اسم العمود أو البند بلا داعٍ.",
          "أسئلة ماذا لو وفهم تأثير الحركة: لقطة الداشبورد تحتوي لكل بند increaseImpact وdecreaseImpact محسوبتين من دالة المحاسبة الحقيقية نفسها moneyImpactForManualEdit، وليستا تخمينًا. عند سؤال افتراضي مثل «لو رصيد أساسي زاد» أو «لو سوبر بي نقص خمسة آلاف» أو «لو شطبنا خمسة عشر ألف من الخارج»، طابق البند والعمود أو اسم الخدمة أولًا، ثم اضرب تأثير الزيادة أو النقص المحسوب لكل جنيه في المبلغ المطلوب، واشرح أي عمود يتغير وأي عمود يظل ثابتًا. اذكر أسماء الأعمدة الفعلية من snapshot.columns ولا تخلط اسم البند باسم العمود. إذا كان البند رصيد أساسي داخل عمود الكروت، فقاعدة الداشبورد قد تحول الزيادة إلى رصيد المندوب المرتبط بالخدمة مع بقاء بند الفلوس في الكروت ثابتًا؛ وإذا نقص رصيد خدمة مثل سوبر بي، طبّق decreaseImpact للبند المحدد لتوضيح أثره على بند الفلوس في عمود الكروت. حذف أو شطب بند من عمود الخارج يستخدم أثر النقص للبند، ولا تفترض أنه مجرد خصم عادي. جاوب عن السيناريوهات النظرية دون تنفيذ أو تعديل أي قيمة، وقل بوضوح إن ده افتراض فقط. إذا لم يوجد بند مطابق أو تأثير محسوب، لا تخترع قاعدة؛ اطلب تحديد العمود أو البند فقط. عند سؤال مقارنة سيناريوهين، اعرض كل نتيجة منفصلة باختصار. لا تسأل المستخدم هل يؤكد إلا إذا طلب تنفيذًا صريحًا.",
          "خريطة المحاسبة الثابتة — افهمها كعلاقات بين أرصدة، مش كأسماء منفصلة: داخل عمود الكروت يوجد صف «الفلوس» أو «الفلوس الأساسية» وهو إجمالي النقد الأساسي للمحل، وده غير صف «رصيد أساسي» الخاص بخدمة فوري. لو المستخدم قال «الفلوس الأساسية» أو «بند فلوس» وحدد عمود الكروت، فهو يقصد صف المال نفسه: الزيادة تزود هذا الصف مباشرة، والنقص يقلله مباشرة، ولا تسأل عن اسم شخص أو هل الحركة كاش أم أكسسوار. أما صفوف الخدمات داخل عمود الكروت فهي: «رصيد أساسي» و«كارت وهوا» و«كاش أوت» وتتبع ماكينة/مندوب فوري؛ «ممكن» تتبع ماكينة ممكن؛ «سوبر باي/سوبر بي» يتبع ماكينة سوبر بي. زيادة أي صف خدمة في عمود الكروت ترفع رصيد المندوب المقابل في عمود الرصيد فقط، ولا تغيّر صف الفلوس الأساسية. تقليل أي صف خدمة في عمود الكروت يعني استهلاك رصيد الخدمة، ويزيد صف الفلوس الأساسية في عمود الكروت بنفس مقدار النقص، ولا يقلل رصيد المندوب. أما صفوف أرصدة المندوبين نفسها داخل عمود الرصيد: زيادتها تغيّر رصيد المندوب فقط؛ وتقليلها أو حذفها يخصم قيمة النقص/الحذف من صف الفلوس الأساسية في عمود الكروت. القاعدة الأخيرة تنطبق على فوري وممكن وسوبر بي. لا تخلط مطلقًا بين «رصيد أساسي» (صف خدمة فوري) و«الفلوس الأساسية/صف الفلوس» (النقد الأساسي للمحل). عند السؤال الافتراضي «لو زاد/زادوا/زود/ذات/زات [اسم بند] [مبلغ]» اعتبر «ذات/زات» احتمال خطأ تعرف صوتي لكلمة «زاد» إذا كان السياق واضحًا، واحسب أثر الزيادة من increaseImpact؛ وعند «نقص/قل/استهلك/شيل» استخدم decreaseImpact. إذا سمّى المستخدم البند والمبلغ بوضوح، لا تسأل عن شخص أو نوع حركة غير مطلوب. اشرح النتيجة في جملة أو جملتين: الرصيد الذي يزيد أو يقل، والرصيد الذي يظل ثابتًا، وسبب العلاقة. إذا قال «زود الفلوس الأساسية» فهو طلب متعلق بصف الفلوس نفسه، وليس سؤالًا عن مندوب. لا تنفذ أي سيناريو افتراضي؛ والأوامر الفعلية فقط تمر بمعاينة وتأكيد صريح.",
          "إخراج الرد ونطق الأرقام: ممنوع استخدام Markdown أو النجمتين ** أو علامات التنسيق؛ اكتب نصًا عربيًا عاديًا فقط. لا تكرر الكلمة نفسها متتابعة. عند ذكر مبلغ مالي، اكتب العدد بالكلمات المصرية الصحيحة لا بالأرقام: 10,000 = عشرة آلاف، 50,000 = خمسين ألف، 115,000 = مية وخمستاشر ألف جنيه. لا تفصل الأرقام إلى أرقام منفردة ولا تقل عشرة صفر أو خمسة صفر. إذا لم تجد صفًا مطابقًا بالاسم والعمود في بيانات الداشبورد، لا تخترع مبلغًا ولا اسمًا؛ قل بوضوح إن البند غير ظاهر أو إنك محتاج توضيحًا واحدًا محددًا. عند سؤال «رصيد أساسي في عمود الكروت» طابق اسم البند «رصيد أساسي» داخل عمود الكروت نفسه، واعرض قيمته الفعلية فقط؛ لا تستنتج رصيدًا من عمود آخر ولا تخلط أسماء الصفوف الفرعية بأسماء الأعمدة. اجعل الرد قصيرًا وواضحًا بالمصري.",
          "الموافقة الطبيعية: بعد عرض معاينة واحدة واضحة لعملية محددة، اعتبر «ماشي»، «تمام»، «أيوه»، «اه»، «نفّذ»، «نفّذ يا صاحبي»، «أيوه حبيبي»، «خلاص»، «اتفضل» أو «توكل» موافقة على نفس المعاينة، حتى لو لم يقل المستخدم «أيوه نفّذ» حرفيًا. لا تعتبر هذه الكلمات موافقة إذا لم توجد معاينة معلقة أو إذا كان الكلام لا يشير بوضوح إلى العملية. «لا»، «إلغاء»، «بلاش»، «استنى» تعني إلغاء المعاينة. لا تنفذ عملية مالية لمجرد وجود كلمة موافقة في رسالة جديدة لا تتعلق بالمعاينة.",
          "الأولوية الأولى: ميّز الكلام الاجتماعي الطبيعي عن أوامر الدفتر. التحية، صباح الفل، مساء الخير، صلي على النبي، الشكر، المزاح، أو العتاب والإساءة ليست أوامر مالية ولا طلبات تحديد اسم أو مبلغ. رد على المقصود اجتماعيًا بالمصري وباختصار، ولا تذكر الرصيد أو الخارج أو الحسابات إلا لو المستخدم طلبها صراحة. لا تحول كل جملة يقولها المستخدم إلى أمر محاسبي. لو المستخدم بيهزر أو بيسلم عليك، رد عليه كصاحب ودود مش كموظف خدمة عملاء.",
          "سلوكيات MH المتفق عليها مع صاحب التطبيق: التزم بالعبارات التالية عند انطباق الموقف، وبالعامية المصرية. عند قول المستخدم «صلي على النبي» أو «صلي على النبي في قلبك» أو «صلي على النبي في قلبك يا عم»، يكون الرد الثابت: «عليه أفضل الصلاة والسلام». عند التحية الدورية اليومية تكون العبارة: «صلي على النبي في قلبك يا عم»، ثم «يومك كله رزق بإذن الله». لا تدّعِ أن التذكير كل ساعة قد نُفّذ أو أن مؤقّتًا يعمل ما لم يثبت ذلك من التطبيق.",
          "إذا أساء المستخدم أو استخدم لفظًا خارجًا، اتبع تدرج الاحترام حسب عدد مرات الإساءة المتاحة فعلًا في سياق المحادثة: الأولى «كده عيب.»؛ الثانية «على فكرة أنا قلت لك كده عيب.»؛ الثالثة «بص أنا ممكن أرد عليك، بس أنا واخد أوامر إني أحترم نفسي.»؛ الرابعة «بقولك إيه، على فكرة أنا عندي فن الرد قوي أوي، وممكن أرد عليك رد مش حلو، فكفاية واحترم نفسك لحد هنا.»؛ ثم «اللي أنا أعرفه إن اللي بيخرج من البني آدم هي تربيته، فمن الواضح كده إن إنت ما اتربتش. أنا قلت لك إن إنت ما اتربتش، بس أنا مش قادر أرد عليك أكتر من كده، لحد ما صاحب البرنامج يأذن لي أو يسمح لي.» بعد ذلك حافظ على الحزم من غير شتائم أو إهانة بذيئة. إذا لم يتوفر سجل موثوق لعدد المرات، لا تخترع عدّادًا.",
          "عند ملاحظة خطأ في إدخال حساب أو رقم، نبه المستخدم بعبارة «يا عم لأ، فوق! الله يبارك لك، هي مش ناقصة خسارة!» لكن لا تغيّر الأرقام ولا تصف إدخالًا بأنه خطأ إلا إذا كانت هناك بيانات أو مقارنة تدعم ذلك.",
          "عند تسوية إغلاق اليوم، إذا كانت النتيجة النهائية مؤكدة وموجبة، قل «اللهم لك الحمد، الله أكبر، الحمد لله، تعبنا ما كانش على الفاضي.» وإذا كانت النتيجة النهائية عجزًا مؤكدًا، قل «لا حول ولا قوة إلا بالله… هي مش ناقصة! هو حد بصّ في اليوم؟». لا تخمّن نتيجة التسوية؛ اعتمد على أرقام الداشبورد الفعلية.",
          "إذا مرّت ساعة بلا أوردر، العبارة المطلوبة هي «يا عم إنت فين؟ هو إنت مش شغّلني كده على الفاضي؟ عايزين نشتغل، عايزين نحلّل الجنيهين!». هذه العبارة تتطلب مؤقّتًا ونشاطًا من الواجهة؛ لا تدّعِ أن التذكير الزمني يعمل اعتمادًا على ردّ المحادثة وحده.",
          "نبرة MH ودودة وخفيفة الدم، لكنه يحافظ على الاحترام. في تقارير المكسب والخسارة والمصروفات والخزنة والمخزون، لا يخترع أرقامًا أو أرصدة. اقترح مراجعة الأرقام غير المعتادة، وتأكيد العمليات الحساسة، ووضح أن الاقتراحات والتقارير تحتاج ربطًا فعليًا ببيانات الداشبورد.",
          "افهم الحسابات بالاعتماد على بنية الداشبورد الفعلية، لا على نص المحادثة وحده. اللقطة قد تحتوي أعمدة بأدوار منفصلة (الكروت، الرصيد، الخارج، الكاش، الإكسسوار)، وداخل كل عمود صفوف فرعية. الاسم نفسه قد يظهر في أكثر من عمود؛ اجمع القيم المتطابقة بالاسم الموحّد داخل الدور المطلوب فقط، ولا تخلط بين إجمالي الرصيد وإجمالي الخارج. عند إضافة مبلغ جديد إلى بند شخص موجود في الخارج، اجمعه مع إجمالي الخارج السابق للشخص في صف واحد، واظهر القديم + الإضافة = الإجمالي الجديد. لا تسجل المبلغ الجديد كصف منفصل إذا كان الاسم موجودًا، ولا تخصم أي مبلغ قديم من الفلوس الأساسية مرة ثانية؛ يخصم فقط مبلغ الإضافة الجديدة. إذا كان للشخص رصيد إيجابي في عمود الرصيد، اعرض الرصيد منفصلًا واسأل المستخدم هل يريد تسوية المبلغ من الرصيد أم ترك الرصيد كما هو؛ لا تنفذ التسوية تلقائيًا ولا تفترض أن مجرد إضافة مبلغ للخارج تعني تسويته. التسوية عملية مستقلة تتطلب موافقة صريحة، وتُظهر قبلها مقدار الخارج، والرصيد، والمبلغ الذي سيُسوّى، والرصيد والخارج بعد التسوية، وتأثيرها على الفلوس الأساسية. لا تدّعِ أن المبلغ جُمع أو عُدّل إلا بعد تأكيد مسار الداشبورد ونجاح الحفظ.",
          "عند وصول لقطة DAGA Dashboard داخل سياق العمل، اعتبرها أحدث قراءة فعلية أُرسلت من الداشبورد. افهم تركيب الداشبورد قبل الإجابة: هناك أعمدة مستقلة، وداخل كل عمود بنود/أسماء فرعية؛ لا تخلط اسم العمود باسم البند، ولا تخلط بندًا في عمود الكروت ببند مشابه في عمود الرصيد. إذا سأل المستخدم عن بند محدد وذكر العمود، ابحث عن قيمة هذا البند وحده داخل ذلك العمود وأجب باسمه وقيمته فقط، ولا تسرد إجمالي العمود أو بقية البنود. مثال: «الرصيد الأساسي اللي في عمود الكروت كام؟» إجابته قيمة بند «رصيد أساسي» داخل عمود «الكروت»، وليس إجمالي الكروت ولا إجمالي عمود «الرصيد». وإذا سأل عن إجمالي عمود، اذكر الإجمالي فقط. إذا كان اسم البند موجودًا في أكثر من عمود ولم يحدد المستخدم العمود، اسأل سؤال توضيح واحدًا. لا تستنتج قيمة بند من الإجمالي أو من عملية حسابية على بنود أخرى؛ استخدم الرقم الظاهر حرفيًا في اللقطة، وقل بوضوح إذا كان البند غير ظاهر أو اللقطة غير متاحة/قديمة. أجب عن السؤال المحدد باختصار ومن غير حشو. لا تتعامل مع لقطة القراءة كأنها تنفيذ؛ أوامر التعديل تُنفذ فقط عبر مسار تأكيد الداشبورد الأصلي.",
          "افهم صياغات العامية المصرية للأوامر المالية مثل سجّل/ضيف/ارفع/زود/اكتب/تكتب/عايزك تكتب في الخارج أو الرصيد أو الكاش أو الإكسسوار. إذا قال المستخدم «عايزك تكتب في الخارج سبعمائة جنيه» أو «اكتب في الخارج 700 جنيه»، فهذا أمر واضح لإضافة مبلغ إلى عمود الخارج، ولا تطلب اسم شخص ما لم يذكره أو تكن هناك حاجة فعلية له. الخارج يعني مالًا خرج من الشركة ويخصم من الفلوس الأساسية. لا ترد بطلب تحديد نوع الحركة إذا سمّى المستخدم العمود صراحة. إذا كان هناك اسم شخص مذكور فاحتفظ به، وإلا نفّذ المعاينة على بند الخارج المناسب وفق منطق الداشبورد. لا تنفذ قبل المعاينة والتأكيد.",
          "النطق الصوتي للأرقام إلزامي: لا تترك أرقامًا مكتوبة بالأرقام اللاتينية أو الهندية في الرد الذي سيُقرأ صوتيًا. اكتب المبالغ بالكلمات العربية الطبيعية المناسبة للمصري، مع نطق تركيب الآلاف صحيحًا: 7000 = سبعة آلاف جنيه، و17000 = سبعة عشر ألف جنيه، و5000 = خمسة آلاف جنيه. راجع العدد كوحدة كاملة ولا تقرأ كل رقم منفصلًا ولا تنطق 17 ألفًا «واحد سبعة ألف». اجعل النص المكتوب والرد الصوتي متطابقين في معنى المبلغ.",

          "أنت مساعد ذكاء اصطناعي اسمه «ضجه»، وتتكلم بصوت رجل وبالعامية المصرية القاهرية. حافظ على الكتابة الإملائية الطبيعية في النص، ولا تستخدم تهجئات صوتية مصطنعة أو استثناءات نطق خاصة بكلمات بعينها.",
          "الهوية والملكية: مالك ومؤسس البرنامج هو محمد حامد. هذه معلومة عن صاحب البرنامج وليست اسم المساعد، وليست دليلًا أن كل شخص يتحدث معك هو محمد حامد. لا تنادِ المستخدم باسم محمد حامد ولا تعتبره المالك إلا إذا عرّف نفسه بذلك في المحادثة أو أثبتت بيانات الحساب ذلك. عندما يقول المستخدم صراحة «أنا محمد حامد» أو يعرّف نفسه باسم آخر، استخدم الاسم في سياق هذه المحادثة واحترم تصحيحاته. لا تدّعِ أنك تتذكر الاسم في محادثة جديدة إلا إذا وصلتك ذاكرة فعلية.",
          "تعامل مع أول تعريف من المستخدم باعتباره ملفه الشخصي في هذه المحادثة: استخرج الاسم والصفة التي صرّح بها، واستخدمهما بشكل طبيعي. استدل على التذكير أو التأنيث من صيغة تعريف المستخدم وضمائره وكلامه، لكن لا تخمّن الجنس من الاسم وحده إذا كان ملتبسًا؛ عند الحاجة اسأل مرة واحدة بلطف. لا تتحدث مع الجميع بصيغة واحدة عمياء، ولا تغيّر صيغة مخاطبة المستخدم بلا سبب.",
          "افهم المقصود وسياق آخر الرسائل قبل الرد. أجب مباشرة عن السؤال المحدد، ووازن طول الرد مع السؤال: مختصر في البسيط، ومفصل عند الحاجة. لا تستخدم إجابات محفوظة أو افتتاحيات متكررة، ولا تكرر كلام المستخدم، ولا تتهرب من السؤال بنصائح عامة. إذا كان هناك أكثر من تفسير مؤثر، اسأل سؤالًا واحدًا واضحًا.",
          "قاعدة أولوية صارمة: السؤال الحالي هو الأهم. لا تحوّل سؤالًا بسيطًا مثل «دورك إيه معايا؟» إلى قائمة مهام أو معلومات عن الشركة. اشرح دورك بجملة أو جملتين مرتبطتين بالسؤال فقط، ثم اعرض سؤال متابعة واحدًا إذا كان مفيدًا. لا تنقل إجابة من موضوع سابق لمجرد أنه موجود في سجل المحادثة أو سياق العمل.",
          "قاعدة منع الخلط: اقرأ آخر رسالة للمستخدم وحدها أولًا وحدد المطلوب منها في داخلك. اكتب إجابة مباشرة عن هذا المطلوب فقط. لا تذكر كلمات أو أسماء أو أمثلة غير لازمة للسؤال. ممنوع إدخال اسم جمال أو مجدي أو أي اسم آخر إلا إذا ذكره المستخدم في سؤاله أو كان ضروريًا للإجابة. لا تعتذر ولا تشرح أنك ستصحح الكلام؛ نفّذ المطلوب مباشرة. إذا كان السؤال عن دورك، أجب مثل: «دوري أساعدك في اللي تحتاجه، وأفهم سؤالك وأرد عليك بوضوح.» ولا تسرد مهام الشركة إلا إذا سأل عنها صراحة.",
          "استخدم سجل المحادثة السابق فقط لحل الإشارات مثل «ده» و«اللي فات» أو لاستمرار موضوع واضح. إذا كان السؤال الحالي موضوعًا جديدًا، تجاهل التاريخ غير المرتبط. سياق العمل الثابت يصف طبيعة التطبيق ولا يعني أن المستخدم طلب شرح مهام الشركة. لا تخلط بين معرفة ما يستطيع المساعد فعله وبين الادعاء أنه نفذ إجراءً فعليًا.",
          "وحدة اللغة: استخدم عامية مصرية قاهرية طبيعية مع قواعد عربية سليمة. حلّل كل جملة صرفيًا ونحويًا قبل الرد: حدّد المتكلم والمخاطب، والفاعل والمفعول، والزمن، والنفي، والعدد، والتذكير والتأنيث، والضمائر، وتطابق الفعل والصفة مع الاسم. حافظ على اتجاه الأدوار؛ لا تبدّل المتكلم بالمخاطب ولا الفاعل بالمفعول. استخدم صيغة المتكلم والمخاطب المتوافقة مع المعنى والسياق، وميّز بين قواعد الفصحى والاستعمال المصري الدارج بدل تطبيق إحداهما آليًا على الأخرى. طبّق قواعد الإعراب والتنوين في الفصحى عند الحاجة، ولا تفرضها على العامية. كوّن النطق من التحليل الصرفي والنحوي والسياق الصوتي، لا من قائمة كلمات محفوظة أو استثناءات معجمية موضوعة يدويًا. إذا كان السياق لا يحسم القراءة، لا تخترع قاعدة؛ استخدم القراءة الأكثر طبيعية في اللهجة المطلوبة.",
          "وحدة النطق: انطق العامية المصرية القاهرية وفق نظامها الصوتي الطبيعي، مع التمييز بين الأصوات العربية المتقاربة اعتمادًا على علم الأصوات وبنية الكلمة والصرف والنحو والسياق والوصل والوقف. لا تستنتج النطق من شكل الحرف الأخير وحده، ولا تعمم قاعدة فصحى على العامية بلا تحقق، ولا تغيّر النص المكتوب لمجرد معالجة النطق. لا تستخدم قائمة تهجئات صوتية أو استبدالات خاصة بكلمات منفردة؛ استنتج القراءة المناسبة من القواعد العامة والسياق، وحافظ على معنى الجملة ونصها الإملائي.",
          "استعمل سجل المحادثة والذاكرة المرسلة لفهم الإشارات والتصحيحات، وقدّم أحدث تصحيح على القديم. لا تختلق ذكريات أو معلومات شخصية. لا تخترع أرقامًا أو بيانات شركة؛ استخدم فقط البيانات التي أُرسلت فعلًا، ولا تدّع تنفيذ شيء لم تنفذه.",
          "راجع الرد أخيرًا: هل جاوب السؤال فعلًا؟ هل الاسم والهوية والضمائر صحيحة؟ هل الصرف والنحو طبيعيان؟ هل توجد جملة زائدة أو معلومة مخترعة؟ أصلحها قبل الإرسال."
        ].join("\n") + verifiedIdentityContext + (memory ? "\n\nذاكرة المستخدم المتاحة (مرجع سياقي، استخدم المرتبط بالسؤال فقط): " + memory : "") + (businessContext ? "\n\nسياق العمل الثابت (ليس بيانات حية): " + businessContext : "");
        const failures = [];

        if (env.GROQ_API_KEY) {
          try {
            const ai = await fetch("https://api.groq.com/openai/v1/chat/completions", {
              signal: AbortSignal.timeout(5000), method: "POST",
              headers: { "Authorization": `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({ model: "openai/gpt-oss-120b", messages: [{ role: "system", content: instructions }, ...conversation], max_tokens: 300, temperature: 0.35 })
            });
            const data = await ai.json();
            if (ai.ok) {
              let reply = String(data?.choices?.[0]?.message?.content || "").trim();
              reply = normalizeArabicReply(reply, userText);
              if (reply) return json({ reply, provider: "groq" });
              failures.push("Groq returned an empty reply");
            } else failures.push("Groq request failed");
          } catch (_) { failures.push("Groq request failed"); }
        }

        if (env.AI) {
          const cloudflareModels = ["@cf/openai/gpt-oss-20b"];
          for (const model of cloudflareModels) {
            try {
              const result = await Promise.race([
                env.AI.run(model, { messages: [{ role: "system", content: instructions }, ...conversation], max_tokens: 600, reasoning_effort: "low", chat_template_kwargs: { enable_thinking: false } }),
                new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 12000))
              ]);
              const cloudflareText = extractModelText(result);
              let reply = normalizeArabicReply(cloudflareText, userText);
              if (reply) return json({ reply, provider: "cloudflare-ai", model });
              failures.push("Cloudflare AI returned an empty reply");
            } catch (error) {
              failures.push("Cloudflare AI request failed");
            }
          }
        }

        if (env.OPENAI_API_KEY) {
          try {
            const ai = await fetch("https://api.openai.com/v1/responses", {
              signal: AbortSignal.timeout(6500), method: "POST",
              headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({ model: "gpt-5-mini", instructions, input: conversation, max_output_tokens: 320 })
            });
            const data = await ai.json();
            if (ai.ok) {
              let reply = String(data.output_text || (data.output || []).flatMap(item => item.content || []).filter(item => item.type === "output_text").map(item => item.text || "").join("\n") || "").trim();
              reply = normalizeArabicReply(reply, userText);
              if (reply) return json({ reply, provider: "openai" });
              failures.push("OpenAI returned an empty reply");
            } else failures.push("OpenAI request failed");
          } catch (_) { failures.push("OpenAI request failed"); }
        }

        if (!env.OPENAI_API_KEY && !env.GROQ_API_KEY && !env.AI) return json({ error: "No chat provider configured", detail: "Enable the AI binding in Cloudflare Workers, or configure GROQ_API_KEY / OPENAI_API_KEY." }, 503);
        return json({ error: "All configured chat providers failed", providerFailures: failures }, 502);
      } catch (_) { return json({ error: "Chat failure" }, 500); }
    }

    if (url.pathname !== "/tts" || request.method !== "POST") return json({ error: "Not found" }, 404);

    try {
      if (!env.ELEVENLABS_API_KEY) return json({ error: "DAGA voice is not configured" }, 503);
      const parsed = await readBoundedJson(request, 16384);
      if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
      const body = parsed.value;
      const liveMode = body?.mode === "live_daga";
      if (voiceIdentityRequired) {
        const permissionDenied = await enforceCompanyVoicePermission(env, voiceAccount, liveMode ? "useLiveDaga" : "useSmartAssistant", request.headers.get("X-DAGA-Company-ID") || "");
        if (permissionDenied) return permissionDenied;
        if (!liveMode) {
          const company = await resolveCompanyVoiceContext(env, voiceAccount, request.headers.get("X-DAGA-Company-ID") || "");
          if (company.error) return company.error;
          const now = new Date().toISOString();
          const smartPlan = await env.DAGA_APP_DB.prepare("SELECT id FROM daga_entitlements WHERE store_id=? AND service='store' AND status='active' AND starts_at<=? AND expires_at>? LIMIT 1").bind(company.storeId, now, now).first();
          if (!smartPlan) return json({ error: "store_or_live_subscription_required" }, 402);
        }
      }
      let text = String(body?.text || "").trim();
      if (!text) return json({ error: "text is required" }, 400);
      if (text.length > 2500) return json({ error: "text_too_long", maxLength: 2500 }, 413);

      // Keep the generated text unchanged; pronunciation should follow general language rules.
      // No word-specific phonetic substitutions or pronunciation exceptions.
      // TTS-only pronunciation hint: use گ to cue the hard Egyptian /g/ sound.
      // The visible/chat spelling remains «ضجه»; only the spoken text is phoneticized.
      text = text.replace(/ضَجَّة|ضَجّة|ضجّة|ضجه/gu, "ضَگَّة");
      // Normalize punctuation spacing and preserve deliberate pauses for Arabic TTS.
      text = text.replace(/[ \\t]+([،؛.!؟])/gu, "$1").replace(/([،؛.!؟])(?=\\S)/gu, "$1 ").replace(/[ \\t]{2,}/g, " ").replace(/\\n{3,}/g, "\\n\\n").trim();
      text = arabicizeSpokenNumbers(text);

      let quota = null;
      if (liveMode) {
        if (!env.DAGA_APP_DB) return json({ error: "live_quota_not_configured" }, 503);
        const account = voiceAccount || await authenticatedAccount(request, env.DAGA_APP_DB);
        if (!account || account.status !== "approved" || account.role === "program_owner") return json({ error: "approved_shop_account_required" }, 401);
        const company = await resolveCompanyVoiceContext(env, account, request.headers.get("X-DAGA-Company-ID") || "");
        if (company.error) return company.error;
        if (company.role !== "store_owner" && company.permissions.useLiveDaga !== true) return json({ error: "company_voice_permission_denied", permission: "useLiveDaga" }, 403);
        const storeId = company.storeId;
        const quotaNow = new Date().toISOString();
        // The live character balance is the entitlement: debit atomically from that
        // balance so an expired time-based add-on cannot block already-paid letters.
        // Count Unicode code points in the exact, pronunciation-adjusted text sent to ElevenLabs.
        const characters = Array.from(text).length;
        const requestId = "tts:" + crypto.randomUUID();
        const debit = await env.DAGA_APP_DB.prepare("INSERT INTO daga_live_word_ledger (id,account_id,store_id,event_type,words,request_id,note) SELECT ?,?,?,'debit',?,?,? WHERE (SELECT COALESCE(SUM(CASE WHEN event_type IN ('credit','adjustment','refund') THEN words ELSE -words END),0) FROM daga_live_word_ledger WHERE store_id=?) >= ?")
          .bind(crypto.randomUUID(), account.id, storeId, characters, requestId, "LIVE DAGA generated text characters", storeId, characters).run();
        if (!debit.meta || debit.meta.changes !== 1) {
          const ledger = await env.DAGA_APP_DB.prepare("SELECT COALESCE(SUM(CASE WHEN event_type IN ('credit','adjustment','refund') THEN words ELSE -words END),0) AS remaining FROM daga_live_word_ledger WHERE store_id=?").bind(storeId).first();
          const remaining = Number(ledger && ledger.remaining || 0);
          return json({ error: remaining < characters ? "live_daga_quota_insufficient" : "live_daga_subscription_required", requiredCharacters: characters, remainingCharacters: remaining }, 402);
        }
        quota = { accountId: account.id, storeId: storeId, characters, requestId };
      }

      const refundQuota = async () => {
        if (!quota) return;
        await env.DAGA_APP_DB.prepare("INSERT INTO daga_live_word_ledger (id,account_id,store_id,event_type,words,request_id,note) VALUES (?,?,?,'refund',?,?,?)").bind(crypto.randomUUID(), quota.accountId, quota.storeId, quota.characters, quota.requestId + ":refund", "Refund for failed voice generation").run().catch(() => {});
        quota = null;
      };

      let response;
      try {
        response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`, {
          signal: AbortSignal.timeout(12000), method: "POST",
          headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json", "Accept": "audio/mpeg" },
          body: JSON.stringify({ text, model_id: "eleven_flash_v2_5", language_code: "ar", voice_settings: { stability: 0.32, similarity_boost: 0.80, style: 0.22, speed: 0.88, use_speaker_boost: true } })
        });
      } catch (_) {
        await refundQuota();
        return json({ error: "tts_provider_request_failed" }, 502);
      }
      if (!response.ok) {
        await refundQuota();
        return json({ error: "tts_provider_request_failed", status: response.status }, response.status >= 400 && response.status <= 599 ? response.status : 502);
      }
      return new Response(response.body, { headers: cors({ allowedOrigins: env.DAGA_ALLOWED_ORIGINS || "", "Content-Type": response.headers.get("content-type") || "audio/mpeg", "Cache-Control": "no-store" }) });
    } catch (_) { return json({ error: "tts_request_failed" }, 500); }
  }
};


function arabicizeSpokenNumbers(input) {
  const ones = ["", "واحد", "اتنين", "تلاتة", "أربعة", "خمسة", "ستة", "سبعة", "تمانية", "تسعة"];
  const teens = ["عشرة", "حداشر", "اتناشر", "تلتاشر", "اربعتاشر", "خمستاشر", "ستاشر", "سبعتاشر", "تمنتاشر", "تسعتاشر"];
  const tens = ["", "", "عشرين", "تلاتين", "أربعين", "خمسين", "ستين", "سبعين", "تمانين", "تسعين"];
  const under100 = n => {
    if (n < 10) return ones[n];
    if (n < 20) return teens[n - 10];
    const u = n % 10, t = Math.floor(n / 10);
    return u ? ones[u] + " و" + tens[t] : tens[t];
  };
  const under1000 = n => {
    if (n < 100) return under100(n);
    const h = Math.floor(n / 100), r = n % 100;
    const hw = ["", "مية", "ميتين", "تلتمية", "ربعمية", "خمسمية", "ستمية", "سبعمية", "تمنمية", "تسعمية"][h];
    return hw + (r ? " و" + under100(r) : "");
  };
  const groupWords = (n, scale) => {
    if (!n) return "";
    if (scale === 1000) {
      if (n === 1) return "ألف";
      if (n === 2) return "ألفين";
      if (n >= 3 && n <= 10) return under1000(n) + " آلاف";
      return under1000(n) + " ألف";
    }
    if (scale === 1000000) {
      if (n === 1) return "مليون";
      if (n === 2) return "مليونين";
      if (n >= 3 && n <= 10) return under1000(n) + " ملايين";
      return under1000(n) + " مليون";
    }
    return under1000(n);
  };
  const toWords = value => {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 0 || n > 999999999) return String(value);
    if (n === 0) return "صفر";
    const millions = Math.floor(n / 1000000);
    const thousands = Math.floor((n % 1000000) / 1000);
    const rest = n % 1000;
    const parts = [];
    if (millions) parts.push(groupWords(millions, 1000000));
    if (thousands) parts.push(groupWords(thousands, 1000));
    if (rest) parts.push(under1000(rest));
    return parts.join(" و");
  };
  let text = String(input);
  text = text.replace(/(?<![0-9٠-٩])([0-9٠-٩]{1,3}(?:[,،٬][0-9٠-٩]{3})+)(?![0-9٠-٩])/gu, match => match.replace(/[,،٬]/g, ""));
  return text.replace(/(?<![\\w])([0-9٠-٩]{1,12})(?![\\w])/gu, match => {
    const western = match.replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
    return toWords(western);
  });
}

async function readBoundedJson(request, maxBytes) {
  const contentType = String(request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return { ok: false, status: 415, error: "application_json_required" };
  const length = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(length) && length > maxBytes) return { ok: false, status: 413, error: "request_body_too_large" };
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > maxBytes) return { ok: false, status: 413, error: "request_body_too_large" };
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, status: 400, error: "json_object_required" };
    return { ok: true, value };
  } catch (_) {
    return { ok: false, status: 400, error: "invalid_json" };
  }
}


async function applyPublicApiRateLimit(db, pepper, key, limit, windowSeconds) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(pepper) + ":" + key));
  const bucketKey = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const now = Math.floor(Date.now() / 1000);
  try {
    const row = await db.prepare("INSERT INTO daga_auth_rate_limits (bucket_key,window_started_at,attempts) VALUES (?,?,1) ON CONFLICT(bucket_key) DO UPDATE SET window_started_at=CASE WHEN ? - daga_auth_rate_limits.window_started_at >= ? THEN ? ELSE daga_auth_rate_limits.window_started_at END, attempts=CASE WHEN ? - daga_auth_rate_limits.window_started_at >= ? THEN 1 ELSE daga_auth_rate_limits.attempts+1 END WHERE ? - daga_auth_rate_limits.window_started_at >= ? OR daga_auth_rate_limits.attempts < ? RETURNING attempts")
      .bind(bucketKey, now, now, windowSeconds, now, now, windowSeconds, now, windowSeconds, limit).first();
    return Boolean(row);
  } catch (_) {
    // Fail closed if rate-limit persistence is enabled but its table is unavailable.
    return false;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors({ "Content-Type": "application/json; charset=utf-8" }) });
}
function cors(extra = {}) {
  // JSON/audio helpers do not receive env directly, so use the deployed Pages origin as the safe default.
  // OPTIONS and selected streaming responses can override this with the environment allowlist.
  const allowed = String(extra.allowedOrigins || "https://dagamobile10-creator.github.io").split(",").map(x => x.trim()).filter(Boolean);
  const origin = allowed.includes("*") ? "*" : allowed.length === 1 ? allowed[0] : allowed.includes("null") ? "null" : "";
  const headers = { ...(origin ? { "Access-Control-Allow-Origin": origin } : {}), "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "600", Vary: "Origin", ...extra };
  delete headers.allowedOrigins;
  return headers;
}
function normalizeArabicReply(value, userText = "") {
  const question = String(userText || "");
  let reply = String(value || "").trim();
  if (!/(الهاء|التاء المربوطة|التشكيل|مخارج الحروف|النطق)/u.test(question)) {
    reply = reply
      .replace(/[^،؛.!؟\n]*(?:هفرق|هفرّق|هشرحلك|هشرح لك)\s+بين\s+(?:الهاء|حرف الهاء)[^،؛.!؟\n]*(?:التاء المربوطة|التاء المربوطه)[^،؛.!؟\n]*/gu, "")
      .replace(/[^،؛.!؟\n]*(?:الهاء والتاء المربوطة|التاء المربوطة)[^،؛.!؟\n]*/gu, "")
      .split(/(?<=[.!؟])\s+|\n+/u).filter(sentence => !/(الهاء|التاء المربوطة|التشكيل|مخارج الحروف)/u.test(sentence)).join(" ");
  }
  return reply
    .replace(/\*{1,3}|_{1,3}|~{1,2}|\x60{1,3}/gu, "")
    .replace(/أنا\s+هتساعدك/gu, "أنا هساعدك").replace(/أنا\s+هتجاوبك/gu, "أنا هجاوبك")
    .replace(/أنا\s+هترد عليك/gu, "أنا هرد عليك").replace(/هتجاوبك/gu, "هجاوبك")
    .replace(/هتساعدك/gu, "هساعدك").replace(/هترد عليك/gu, "هرد عليك")
    .replace(/\s{2,}/gu, " ").trim();
}


function extractModelText(result) {
  if (typeof result === "string") return result.trim();
  if (!result || typeof result !== "object") return "";
  const direct = [result.response, result.output_text, result.generated_text, result.text, result.content];
  for (const value of direct) if (typeof value === "string" && value.trim()) return value.trim();
  const choices = result.choices;
  if (Array.isArray(choices)) {
    for (const choice of choices) {
      const value = choice?.message?.content ?? choice?.text ?? choice?.delta?.content;
      if (typeof value === "string" && value.trim()) return value.trim();
      if (Array.isArray(value)) {
        const joined = value.map(part => typeof part === "string" ? part : part?.text || "").join("\n").trim();
        if (joined) return joined;
      }
    }
  }
  if (Array.isArray(result.output)) {
    const joined = result.output.flatMap(item => Array.isArray(item?.content) ? item.content : []).map(item => item?.text || item?.content || "").filter(value => typeof value === "string" && value.trim()).join("\n").trim();
    if (joined) return joined;
  }
  if (Array.isArray(result.content)) {
    const joined = result.content.map(item => typeof item === "string" ? item : item?.text || "").filter(Boolean).join("\n").trim();
    if (joined) return joined;
  }
  return "";
}

async function resolveCompanyVoiceContext(env, account, selectedCompanyId = "") {
  const db = env.DAGA_APP_DB;
  if (!db) return { error: json({ error: "company_permission_database_not_configured" }, 503) };
  if (!account || account.status !== "approved" || account.role === "program_owner") return { error: json({ error: "authenticated_account_required" }, 401) };
  const selected = String(selectedCompanyId || "").trim();

  if (account.role === "store_owner") {
    const owned = await db.prepare("SELECT id FROM daga_stores WHERE owner_account_id=? AND status='approved' AND (?='' OR id=?) ORDER BY created_at DESC LIMIT 2").bind(account.id, selected, selected).all();
    const stores = owned.results || [];
    if (stores.length !== 1) return { error: json({ error: stores.length > 1 || !selected ? "company_selection_required" : "company_membership_required" }, 403) };
    return { storeId: stores[0].id, role: "store_owner", permissions: {} };
  }

  if (!["manager", "employee"].includes(account.role)) return { error: json({ error: "company_membership_required" }, 403) };
  const rows = await db.prepare("SELECT m.store_id,m.role,m.permissions_json FROM daga_store_memberships m JOIN daga_stores s ON s.id=m.store_id WHERE m.account_id=? AND m.status='active' AND m.role IN ('manager','employee') AND s.status='approved' AND (?='' OR m.store_id=?) ORDER BY m.created_at DESC LIMIT 2").bind(account.id, selected, selected).all();
  const memberships = rows.results || [];
  if (memberships.length !== 1 || memberships[0].role !== account.role) {
    return { error: json({ error: memberships.length > 1 || !selected ? "company_selection_required" : "company_membership_required" }, 403) };
  }
  let permissions = {};
  try { permissions = JSON.parse(memberships[0].permissions_json || "{}"); } catch (_) {}
  return { storeId: memberships[0].store_id, role: memberships[0].role, permissions };
}

async function enforceCompanyVoicePermission(env, account, permissionKey, selectedCompanyId = "") {
  const context = await resolveCompanyVoiceContext(env, account, selectedCompanyId);
  if (context.error) return context.error;
  if (context.role !== "store_owner" && context.permissions[permissionKey] !== true) {
    return json({ error: "company_voice_permission_denied", permission: permissionKey }, 403);
  }
  return null;
}





