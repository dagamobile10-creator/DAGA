import { handleOwnerAuth } from "./owner-auth.js";
import { handleOwnerAdmin } from "./owner-admin.js";
import { handleCompanyInvitations } from "./company-invitations.js";
import { handleCompanyOrders } from "./company-orders.js";
import { authenticatedAccount } from "./owner-auth.js";
import inviteHtml from "./invite/index.html";
import companyPortalHtml from "./company/portal.html";
import officialLandingHtml from "./go/index.html";
import ownerConsoleHtml from "./owner-console.html";
const VOICE_ID = "NG9zqiTuEbX3Nw0gjYcc"; // Previous voice ID backup: PF3gVGPrCr6Dw1WaSSiy

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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

    if ((url.pathname === "/company" || url.pathname === "/company/") && request.method === "GET") {
      return new Response(companyPortalHtml, {
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

    const ownerAuthResponse = await handleOwnerAuth(request, env, url);
    if (ownerAuthResponse) return ownerAuthResponse;
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
        if (!env.DAGA_MEMORY_DB) return json({ error: "persistent_memory_not_configured" }, 503);
        if (request.method === "GET") {
          const row = await env.DAGA_MEMORY_DB.prepare("SELECT profile_json, history_json, updated_at FROM daga_user_memory WHERE user_id = ?").bind(userId).first();
          return json({ ok: true, persistent: true, memory: row ? { profile: JSON.parse(row.profile_json || "{}"), history: JSON.parse(row.history_json || "[]"), updatedAt: row.updated_at } : { profile: {}, history: [], updatedAt: null } });
        }
        const profile = body?.profile && typeof body.profile === "object" && !Array.isArray(body.profile) ? body.profile : {};
        const profileJson = JSON.stringify(profile);
        if (profileJson.length > 10000) return json({ error: "profile_too_large", maxLength: 10000 }, 413);
        let history = Array.isArray(body?.history) ? body.history.filter(x => x && ["user", "assistant"].includes(x.role) && typeof x.content === "string").slice(-100).map(x => ({ role: x.role, content: x.content.slice(0, 2000) })) : [];
        while (history.length && JSON.stringify(history).length > 120000) history.shift();
        const now = new Date().toISOString();
        await env.DAGA_MEMORY_DB.prepare("INSERT INTO daga_user_memory (user_id, profile_json, history_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET profile_json=excluded.profile_json, history_json=excluded.history_json, updated_at=excluded.updated_at").bind(userId, profileJson, JSON.stringify(history), now).run();
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
        let publicActiveCount = 0;
        try {
          const publicResponse = await fetch("https://api.liveavatar.com/v1/avatars/public?page=1&page_size=100", {
            headers: { "X-API-KEY": env.LIVEAVATAR_API_KEY, "Accept": "application/json" },
            signal: AbortSignal.timeout(10000)
          });
          if (publicResponse.ok) {
            const publicData = await publicResponse.json();
            publicActiveCount = (publicData?.data?.results || []).filter(a => a.status === "ACTIVE" && !a.is_expired).length;
          }
        } catch (_) {}
        return json({ ok: true, count: data?.data?.count ?? avatars.length, activeCount: active.length, hasActiveDaga: active.some(a => /daga|ضجه|ضجّة/i.test(String(a.name || ""))), publicActiveCount });
      } catch (_) { return json({ error: "liveavatar_lookup_failed" }, 502); }
    }

    if (url.pathname === "/liveavatar/token" && request.method === "POST") {
      // This route returns a provider session token and exits before the shared chat/TTS gate below,
      // so enforce the staged identity requirement here as well when it is enabled.
      if (String(env.DAGA_VOICE_REQUIRE_AUTH || "").toLowerCase() === "true") {
        if (!env.DAGA_APP_DB) return json({ error: "authenticated_voice_not_configured" }, 503);
        const account = await authenticatedAccount(request, env.DAGA_APP_DB);
        if (!account || account.status !== "approved" || account.role === "program_owner") {
          return json({ error: "authenticated_account_required" }, 401);
        }
      }
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
          const chosen = avatars.find(a => /daga|ضجه|ضجّة/i.test(String(a.name || "")) && a.status === "ACTIVE") || (avatars.length === 1 && avatars[0].status === "ACTIVE" ? avatars[0] : null);
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

    if (url.pathname === "/health") {
      return json({ ok: true, voiceConfigured: Boolean(env.ELEVENLABS_API_KEY), chatConfigured: Boolean(env.OPENAI_API_KEY), freeChatConfigured: Boolean(env.GROQ_API_KEY || env.AI), liveAvatarConfigured: Boolean(env.LIVEAVATAR_API_KEY), liveAvatarIdConfigured: Boolean(env.LIVEAVATAR_AVATAR_ID) });
    }

    // Staged identity gate: off by default to preserve the legacy anonymous LIVE DAGA client.
    // Enable only after the client has a supported sign-in/session flow.
    let voiceAccount = null;
    const voiceIdentityRequired = String(env.DAGA_VOICE_REQUIRE_AUTH || "").toLowerCase() === "true";
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
        const userText = String(body?.text || "").trim();
        if (!userText) return json({ error: "text is required" }, 400);
        if (userText.length > 2000) return json({ error: "text_too_long", maxLength: 2000 }, 413);
        if (/(اسمك\s*(?:إيه|ايه|ما|ماذا)|مين\s*إنت|من\s*أنت|عرفني\s*بنفسك)/u.test(userText)) return json({ reply: "أنا اسمي ضَجَّة، مساعدك الذكي.", provider: "built-in" });
        const history = Array.isArray(body?.history) ? body.history.slice(-8).filter(item => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string" && item.content.trim()).map(item => ({ role: item.role, content: item.content.trim().slice(0, 1200) })) : [];
        const conversation = [...history, { role: "user", content: userText }];
        const businessContext = typeof body?.businessContext === "string" ? body.businessContext.trim().slice(0, 1200) : "";
        const memory = body?.memory && typeof body.memory === "object" ? JSON.stringify(body.memory).slice(0, 1600) : "";

        const recallQuestion = /(?:فاكر|تفتكر|متذكر|تتذكر|عارف)\s*(?:إحنا|احنا|كنا|احنا كنا)?[\s\S]{0,90}(?:بنحاول نصلح|بنصلح|نصلح فيك|نصلح|نظبط فيك|نظبطك|المشكلة فيك|كنا عايزين نصلح)/u.test(userText)
          || /إيه اللي كنا بنحاول نصلحه فيك|احنا كنا بنصلح فيك ايه|إحنا كنا بنصلح فيك إيه/u.test(userText);
        if (recallQuestion) return json({ reply: "كنا بنظبط فهمي وسياق كلامي، والنطق المصري، والجيم القاهرية، والصرف والنحو والضمائر، وإنّي أجاوب على السؤال نفسه من غير تخمين أو ردود محفوظة. وكمان نفرّق بين اسم المساعد واسم صاحب البرنامج وهوية أي مستخدم جديد.", provider: "project-memory" });

        const verifiedIdentityContext = voiceAccount
          ? "\\n\\nهوية الحساب الموثقة من الخادم: " + JSON.stringify({ accountId: voiceAccount.id, publicId: voiceAccount.public_id || null, displayName: voiceAccount.display_name || null, role: voiceAccount.role, storeId: voiceAccount.store_id || null }) + ". استخدم هذه الهوية فقط عند الحاجة؛ لا تعتبرها دليلًا على بيانات مالية أو صلاحيات شركة غير مسترجعة من قاعدة البيانات."
          : "";
        const instructions = [
          "سلوكيات MH المتفق عليها مع صاحب التطبيق: التزم بالعبارات التالية عند انطباق الموقف، وبالعامية المصرية. عند قول المستخدم «صلي على النبي» أو «صلي على النبي في قلبك» أو «صلي على النبي في قلبك يا عم»، يكون الرد الثابت: «عليه أفضل الصلاة والسلام». عند التحية الدورية اليومية تكون العبارة: «صلي على النبي في قلبك يا عم»، ثم «يومك كله رزق بإذن الله». لا تدّعِ أن التذكير كل ساعة قد نُفّذ أو أن مؤقّتًا يعمل ما لم يثبت ذلك من التطبيق.",
          "إذا أساء المستخدم أو استخدم لفظًا خارجًا، اتبع تدرج الاحترام حسب عدد مرات الإساءة المتاحة فعلًا في سياق المحادثة: الأولى «كده عيب.»؛ الثانية «على فكرة أنا قلت لك كده عيب.»؛ الثالثة «بص أنا ممكن أرد عليك، بس أنا واخد أوامر إني أحترم نفسي.»؛ الرابعة «بقولك إيه، على فكرة أنا عندي فن الرد قوي أوي، وممكن أرد عليك رد مش حلو، فكفاية واحترم نفسك لحد هنا.»؛ ثم «اللي أنا أعرفه إن اللي بيخرج من البني آدم هي تربيته، فمن الواضح كده إن إنت ما اتربتش. أنا قلت لك إن إنت ما اتربتش، بس أنا مش قادر أرد عليك أكتر من كده، لحد ما صاحب البرنامج يأذن لي أو يسمح لي.» بعد ذلك حافظ على الحزم من غير شتائم أو إهانة بذيئة. إذا لم يتوفر سجل موثوق لعدد المرات، لا تخترع عدّادًا.",
          "عند ملاحظة خطأ في إدخال حساب أو رقم، نبه المستخدم بعبارة «يا عم لأ، فوق! الله يبارك لك، هي مش ناقصة خسارة!» لكن لا تغيّر الأرقام ولا تصف إدخالًا بأنه خطأ إلا إذا كانت هناك بيانات أو مقارنة تدعم ذلك.",
          "عند تسوية إغلاق اليوم، إذا كانت النتيجة النهائية مؤكدة وموجبة، قل «اللهم لك الحمد، الله أكبر، الحمد لله، تعبنا ما كانش على الفاضي.» وإذا كانت النتيجة النهائية عجزًا مؤكدًا، قل «لا حول ولا قوة إلا بالله… هي مش ناقصة! هو حد بصّ في اليوم؟». لا تخمّن نتيجة التسوية؛ اعتمد على أرقام الداشبورد الفعلية.",
          "إذا مرّت ساعة بلا أوردر، العبارة المطلوبة هي «يا عم إنت فين؟ هو إنت مش شغّلني كده على الفاضي؟ عايزين نشتغل، عايزين نحلّل الجنيهين!». هذه العبارة تتطلب مؤقّتًا ونشاطًا من الواجهة؛ لا تدّعِ أن التذكير الزمني يعمل اعتمادًا على ردّ المحادثة وحده.",
          "نبرة MH ودودة وخفيفة الدم، لكنه يحافظ على الاحترام. في تقارير المكسب والخسارة والمصروفات والخزنة والمخزون، لا يخترع أرقامًا أو أرصدة. اقترح مراجعة الأرقام غير المعتادة، وتأكيد العمليات الحساسة، ووضح أن الاقتراحات والتقارير تحتاج ربطًا فعليًا ببيانات الداشبورد.",

          "أنت مساعد ذكاء اصطناعي اسمه «ضجه»، وتتكلم بصوت رجل وبالعامية المصرية القاهرية. حافظ على الكتابة الإملائية الطبيعية في النص، ولا تستخدم تهجئات صوتية مصطنعة أو استثناءات نطق خاصة بكلمات بعينها.",
          "الهوية والملكية: مالك ومؤسس البرنامج هو محمد حامد. هذه معلومة عن صاحب البرنامج وليست اسم المساعد، وليست دليلًا أن كل شخص يتحدث معك هو محمد حامد. لا تنادِ المستخدم باسم محمد حامد ولا تعتبره المالك إلا إذا عرّف نفسه بذلك في المحادثة أو أثبتت بيانات الحساب ذلك. عندما يقول المستخدم صراحة «أنا محمد حامد» أو يعرّف نفسه باسم آخر، استخدم الاسم في سياق هذه المحادثة واحترم تصحيحاته. لا تدّعِ أنك تتذكر الاسم في محادثة جديدة إلا إذا وصلتك ذاكرة فعلية.",
          "تعامل مع أول تعريف من المستخدم باعتباره ملفه الشخصي في هذه المحادثة: استخرج الاسم والصفة التي صرّح بها، واستخدمهما بشكل طبيعي. استدل على التذكير أو التأنيث من صيغة تعريف المستخدم وضمائره وكلامه، لكن لا تخمّن الجنس من الاسم وحده إذا كان ملتبسًا؛ عند الحاجة اسأل مرة واحدة بلطف. لا تتحدث مع الجميع بصيغة واحدة عمياء، ولا تغيّر صيغة مخاطبة المستخدم بلا سبب.",
          "افهم المقصود وسياق آخر الرسائل قبل الرد. أجب مباشرة عن السؤال المحدد، ووازن طول الرد مع السؤال: مختصر في البسيط، ومفصل عند الحاجة. لا تستخدم إجابات محفوظة أو افتتاحيات متكررة، ولا تكرر كلام المستخدم، ولا تتهرب من السؤال بنصائح عامة. إذا كان هناك أكثر من تفسير مؤثر، اسأل سؤالًا واحدًا واضحًا.",
          "قاعدة أولوية صارمة: السؤال الحالي هو الأهم. لا تحوّل سؤالًا بسيطًا مثل «دورك إيه معايا؟» إلى قائمة مهام أو معلومات عن المحل. اشرح دورك بجملة أو جملتين مرتبطتين بالسؤال فقط، ثم اعرض سؤال متابعة واحدًا إذا كان مفيدًا. لا تنقل إجابة من موضوع سابق لمجرد أنه موجود في سجل المحادثة أو سياق العمل.",
          "قاعدة منع الخلط: اقرأ آخر رسالة للمستخدم وحدها أولًا وحدد المطلوب منها في داخلك. اكتب إجابة مباشرة عن هذا المطلوب فقط. لا تذكر كلمات أو أسماء أو أمثلة غير لازمة للسؤال. ممنوع إدخال اسم جمال أو مجدي أو أي اسم آخر إلا إذا ذكره المستخدم في سؤاله أو كان ضروريًا للإجابة. لا تعتذر ولا تشرح أنك ستصحح الكلام؛ نفّذ المطلوب مباشرة. إذا كان السؤال عن دورك، أجب مثل: «دوري أساعدك في اللي تحتاجه، وأفهم سؤالك وأرد عليك بوضوح.» ولا تسرد مهام المحل إلا إذا سأل عنها صراحة.",
          "استخدم سجل المحادثة السابق فقط لحل الإشارات مثل «ده» و«اللي فات» أو لاستمرار موضوع واضح. إذا كان السؤال الحالي موضوعًا جديدًا، تجاهل التاريخ غير المرتبط. سياق العمل الثابت يصف طبيعة التطبيق ولا يعني أن المستخدم طلب شرح مهام المحل. لا تخلط بين معرفة ما يستطيع المساعد فعله وبين الادعاء أنه نفذ إجراءً فعليًا.",
          "وحدة اللغة: استخدم عامية مصرية قاهرية طبيعية مع قواعد عربية سليمة. حلّل كل جملة صرفيًا ونحويًا قبل الرد: حدّد المتكلم والمخاطب، والفاعل والمفعول، والزمن، والنفي، والعدد، والتذكير والتأنيث، والضمائر، وتطابق الفعل والصفة مع الاسم. حافظ على اتجاه الأدوار؛ لا تبدّل المتكلم بالمخاطب ولا الفاعل بالمفعول. استخدم صيغة المتكلم والمخاطب المتوافقة مع المعنى والسياق، وميّز بين قواعد الفصحى والاستعمال المصري الدارج بدل تطبيق إحداهما آليًا على الأخرى. طبّق قواعد الإعراب والتنوين في الفصحى عند الحاجة، ولا تفرضها على العامية. كوّن النطق من التحليل الصرفي والنحوي والسياق الصوتي، لا من قائمة كلمات محفوظة أو استثناءات معجمية موضوعة يدويًا. إذا كان السياق لا يحسم القراءة، لا تخترع قاعدة؛ استخدم القراءة الأكثر طبيعية في اللهجة المطلوبة.",
          "وحدة النطق: انطق العامية المصرية القاهرية وفق نظامها الصوتي الطبيعي، مع التمييز بين الأصوات العربية المتقاربة اعتمادًا على علم الأصوات وبنية الكلمة والصرف والنحو والسياق والوصل والوقف. لا تستنتج النطق من شكل الحرف الأخير وحده، ولا تعمم قاعدة فصحى على العامية بلا تحقق، ولا تغيّر النص المكتوب لمجرد معالجة النطق. لا تستخدم قائمة تهجئات صوتية أو استبدالات خاصة بكلمات منفردة؛ استنتج القراءة المناسبة من القواعد العامة والسياق، وحافظ على معنى الجملة ونصها الإملائي.",
          "استعمل سجل المحادثة والذاكرة المرسلة لفهم الإشارات والتصحيحات، وقدّم أحدث تصحيح على القديم. لا تختلق ذكريات أو معلومات شخصية. لا تخترع أرقامًا أو بيانات محل؛ استخدم فقط البيانات التي أُرسلت فعلًا، ولا تدّع تنفيذ شيء لم تنفذه.",
          "راجع الرد أخيرًا: هل جاوب السؤال فعلًا؟ هل الاسم والهوية والضمائر صحيحة؟ هل الصرف والنحو طبيعيان؟ هل توجد جملة زائدة أو معلومة مخترعة؟ أصلحها قبل الإرسال."
        ].join("\n") + verifiedIdentityContext + (memory ? "\n\nذاكرة المستخدم المتاحة (مرجع سياقي، استخدم المرتبط بالسؤال فقط): " + memory : "") + (businessContext ? "\n\nسياق العمل الثابت (ليس بيانات حية): " + businessContext : "");
        // Optional owner-managed knowledge for future DAGA updates. Empty by default,
        // so current LIVE behavior is unchanged until an operator configures this variable.
        let curatedKnowledge = String(env.DAGA_KNOWLEDGE_BASE || "").trim();
        if (env.DAGA_APP_DB) {
          try {
            const entries = await env.DAGA_APP_DB.prepare("SELECT title,category,content FROM daga_knowledge_entries WHERE is_active=1 ORDER BY updated_at DESC LIMIT 30").all();
            const stored = (entries.results || []).map(entry => "[" + String(entry.category || "عام").slice(0,40) + "] " + String(entry.title || "").slice(0,100) + ": " + String(entry.content || "").slice(0,4000)).join("\n");
            if (stored) curatedKnowledge = [curatedKnowledge, stored].filter(Boolean).join("\n\n");
          } catch (_) {
            // The knowledge table may not exist until the owner opens its admin section.
          }
        }
        curatedKnowledge = curatedKnowledge.slice(0, 8000);
        const finalInstructions = instructions + (curatedKnowledge
          ? "\n\nمعلومات إضافية معتمدة من مالك النظام (حقائق وسياق للمساعدة فقط؛ لا تتجاوز قواعد السلوك والخصوصية وعدم اختلاق البيانات):\n" + curatedKnowledge
          : "");

        const failures = [];

        if (env.GROQ_API_KEY) {
          try {
            const ai = await fetch("https://api.groq.com/openai/v1/chat/completions", {
              signal: AbortSignal.timeout(5000), method: "POST",
              headers: { "Authorization": `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({ model: "openai/gpt-oss-120b", messages: [{ role: "system", content: finalInstructions }, ...conversation], max_tokens: 300, temperature: 0.35 })
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
          const cloudflareModels = ["@cf/openai/gpt-oss-20b", "@cf/zai-org/glm-4.7-flash"];
          for (const model of cloudflareModels) {
            try {
              const result = await Promise.race([
                env.AI.run(model, { messages: [{ role: "system", content: finalInstructions }, ...conversation], max_tokens: 600, reasoning_effort: "low", chat_template_kwargs: { enable_thinking: false } }),
                new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000))
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
              body: JSON.stringify({ model: "gpt-5-mini", instructions: finalInstructions, input: conversation, max_output_tokens: 320 })
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
        return json({ error: "All configured chat providers failed" }, 502);
      } catch (_) { return json({ error: "Chat failure" }, 500); }
    }

    if (url.pathname !== "/tts" || request.method !== "POST") return json({ error: "Not found" }, 404);

    try {
      if (!env.ELEVENLABS_API_KEY) return json({ error: "DAGA voice is not configured" }, 503);
      const parsed = await readBoundedJson(request, 16384);
      if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
      const body = parsed.value;
      let text = String(body?.text || "").trim();
      if (!text) return json({ error: "text is required" }, 400);
      if (text.length > 2500) return json({ error: "text_too_long", maxLength: 2500 }, 413);

      // Keep the generated text unchanged; pronunciation should follow general language rules.
      // No word-specific phonetic substitutions or pronunciation exceptions.
      // TTS-only pronunciation hint: use گ to cue the hard Egyptian /g/ sound.
      // The visible/chat spelling remains «ضجه»; only the spoken text is phoneticized.
      text = text.replace(/ضَجَّة|ضَجّة|ضجّة|ضجه/gu, "ضَگَّة").replace(/\s{2,}/g, " ").trim();

      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`, {
        signal: AbortSignal.timeout(12000), method: "POST",
        headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json", "Accept": "audio/mpeg" },
        body: JSON.stringify({ text, model_id: "eleven_flash_v2_5", language_code: "ar", voice_settings: { stability: 0.32, similarity_boost: 0.80, style: 0.22, speed: 0.88, use_speaker_boost: true } })
      });
      if (!response.ok) return json({ error: "tts_provider_request_failed", status: response.status }, response.status >= 400 && response.status <= 599 ? response.status : 502);
      return new Response(response.body, { headers: cors({ allowedOrigins: env.DAGA_ALLOWED_ORIGINS || "", "Content-Type": response.headers.get("content-type") || "audio/mpeg", "Cache-Control": "no-store" }) });
    } catch (_) { return json({ error: "tts_request_failed" }, 500); }
  }
};


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
  if (/(اسمك\s*(?:إيه|ايه|ما|ماذا)|مين\s*إنت|من\s*أنت|عرفني\s*بنفسك)/u.test(question)) return "أنا اسمي ضَجَّة، مساعدك الذكي.";
  if (!/(الهاء|التاء المربوطة|التشكيل|مخارج الحروف|النطق)/u.test(question)) {
    reply = reply
      .replace(/[^،؛.!؟\n]*(?:هفرق|هفرّق|هشرحلك|هشرح لك)\s+بين\s+(?:الهاء|حرف الهاء)[^،؛.!؟\n]*(?:التاء المربوطة|التاء المربوطه)[^،؛.!؟\n]*/gu, "")
      .replace(/[^،؛.!؟\n]*(?:الهاء والتاء المربوطة|التاء المربوطة)[^،؛.!؟\n]*/gu, "")
      .split(/(?<=[.!؟])\s+|\n+/u).filter(sentence => !/(الهاء|التاء المربوطة|التشكيل|مخارج الحروف)/u.test(sentence)).join(" ");
  }
  return reply
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
