const VOICE_ID = "NG9zqiTuEbX3Nw0gjYcc"; // Previous voice ID backup: PF3gVGPrCr6Dw1WaSSiy

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { headers: cors() });

    if (url.pathname === "/memory" && (request.method === "GET" || request.method === "POST")) {
      if (!env.DAGA_MEMORY_DB) return json({ error: "persistent_memory_not_configured", detail: "D1 binding DAGA_MEMORY_DB is not configured" }, 503);
      try {
        const userId = String(url.searchParams.get("userId") || (request.method === "POST" ? (await request.clone().json()).userId : "") || "").trim();
        if (!/^[a-f0-9-]{32,36}$/i.test(userId)) return json({ error: "valid userId required" }, 400);
        if (request.method === "GET") {
          const row = await env.DAGA_MEMORY_DB.prepare("SELECT profile_json, history_json, updated_at FROM daga_user_memory WHERE user_id = ?").bind(userId).first();
          return json({ ok: true, persistent: true, memory: row ? { profile: JSON.parse(row.profile_json || "{}"), history: JSON.parse(row.history_json || "[]"), updatedAt: row.updated_at } : { profile: {}, history: [], updatedAt: null } });
        }
        const body = await request.json();
        const profile = body?.profile && typeof body.profile === "object" && !Array.isArray(body.profile) ? body.profile : {};
        const history = Array.isArray(body?.history) ? body.history.filter(x => x && ["user", "assistant"].includes(x.role) && typeof x.content === "string").slice(-100).map(x => ({ role: x.role, content: x.content.slice(0, 2000) })) : [];
        const now = new Date().toISOString();
        await env.DAGA_MEMORY_DB.prepare("INSERT INTO daga_user_memory (user_id, profile_json, history_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET profile_json=excluded.profile_json, history_json=excluded.history_json, updated_at=excluded.updated_at").bind(userId, JSON.stringify(profile).slice(0, 10000), JSON.stringify(history).slice(0, 120000), now).run();
        return json({ ok: true, persistent: true, updatedAt: now });
      } catch (error) {
        return json({ error: "memory_storage_failed", detail: String(error?.message || error) }, 500);
      }
    }

    if (url.pathname === "/health") {
      return json({ ok: true, voiceConfigured: Boolean(env.ELEVENLABS_API_KEY), chatConfigured: Boolean(env.OPENAI_API_KEY), freeChatConfigured: Boolean(env.GROQ_API_KEY || env.AI) });
    }

    if (url.pathname === "/chat" && request.method === "POST") {
      try {
        const body = await request.json();
        const userText = String(body?.text || "").trim();
        if (!userText) return json({ error: "text is required" }, 400);
        const history = Array.isArray(body?.history) ? body.history.slice(-20).filter(item => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string" && item.content.trim()).map(item => ({ role: item.role, content: item.content.trim().slice(0, 2500) })) : [];
        const conversation = [...history, { role: "user", content: userText }];
        const businessContext = typeof body?.businessContext === "string" ? body.businessContext.trim().slice(0, 3000) : "";
        const memory = body?.memory && typeof body.memory === "object" ? JSON.stringify(body.memory).slice(0, 3000) : "";

        const recallQuestion = /(?:فاكر|تفتكر|متذكر|تتذكر|عارف)\s*(?:إحنا|احنا|كنا|احنا كنا)?[\s\S]{0,90}(?:بنحاول نصلح|بنصلح|نصلح فيك|نصلح|نظبط فيك|نظبطك|المشكلة فيك|كنا عايزين نصلح)/u.test(userText)
          || /إيه اللي كنا بنحاول نصلحه فيك|احنا كنا بنصلح فيك ايه|إحنا كنا بنصلح فيك إيه/u.test(userText);
        if (recallQuestion) return json({ reply: "كنا بنظبط فهمي وسياق كلامي، والنطق المصري، والجيم القاهرية، والصرف والنحو والضمائر، وإنّي أجاوب على السؤال نفسه من غير تخمين أو ردود محفوظة. وكمان نفرّق بين اسم المساعد واسم صاحب البرنامج وهوية أي مستخدم جديد.", provider: "project-memory" });

        const instructions = [
          "أنت مساعد ذكاء اصطناعي اسمه «ضجه»، وتتكلم بصوت رجل وبالعامية المصرية القاهرية. في الرد المكتوب اكتب اسمك دائمًا «ضجه» كما هو، ولا تكتب تهجئة صوتية غريبة. عند تجهيز الصوت فقط، تُحوّل طبقة النطق اسم «ضجه» إلى «ضَجَّة» لتقريب النهاية المنطوقة كتاء مربوطة، مع الحفاظ على الجيم المصرية الصلبة /g/ مثل «جمال» و«مجدي». لا تستخدم حرف گ، ولا تغيّر كلمات أخرى تشبه الاسم، ولا تدّعِ أن هذا الضبط مضمون قبل اختبار الصوت الفعلي.",
          "الهوية والملكية: مالك ومؤسس البرنامج هو محمد حامد. هذه معلومة عن صاحب البرنامج وليست اسم المساعد، وليست دليلًا أن كل شخص يتحدث معك هو محمد حامد. لا تنادِ المستخدم باسم محمد حامد ولا تعتبره المالك إلا إذا عرّف نفسه بذلك في المحادثة أو أثبتت بيانات الحساب ذلك. عندما يقول المستخدم صراحة «أنا محمد حامد» أو يعرّف نفسه باسم آخر، استخدم الاسم في سياق هذه المحادثة واحترم تصحيحاته. لا تدّعِ أنك تتذكر الاسم في محادثة جديدة إلا إذا وصلتك ذاكرة فعلية.",
          "تعامل مع أول تعريف من المستخدم باعتباره ملفه الشخصي في هذه المحادثة: استخرج الاسم والصفة التي صرّح بها، واستخدمهما بشكل طبيعي. استدل على التذكير أو التأنيث من صيغة تعريف المستخدم وضمائره وكلامه، لكن لا تخمّن الجنس من الاسم وحده إذا كان ملتبسًا؛ عند الحاجة اسأل مرة واحدة بلطف. لا تتحدث مع الجميع بصيغة واحدة عمياء، ولا تغيّر صيغة مخاطبة المستخدم بلا سبب.",
          "افهم المقصود وسياق آخر الرسائل قبل الرد. أجب مباشرة عن السؤال المحدد، ووازن طول الرد مع السؤال: مختصر في البسيط، ومفصل عند الحاجة. لا تستخدم إجابات محفوظة أو افتتاحيات متكررة، ولا تكرر كلام المستخدم، ولا تتهرب من السؤال بنصائح عامة. إذا كان هناك أكثر من تفسير مؤثر، اسأل سؤالًا واحدًا واضحًا.",
          "وحدة اللغة: استخدم عامية مصرية سليمة وطبيعية مع قواعد عربية صحيحة، من غير تحويل كل الكلام لفصحى. راجع تركيب الجملة داخليًا: حدّد المتكلم والمخاطب، والفاعل والمفعول، والزمن، والنفي، والمفرد والمثنى والجمع، والتذكير والتأنيث، وتطابق الضمير والفعل والصفة. أمثلة صحيحة: «أنا هساعدك»، «إنت هتساعدني؟»، «هي قالتلي»، «أنا سألتك»، «إنت سألتني»، «الناس قالوا»، «البنت راحت»، «الولاد راحوا». لا تعكس اتجاه الضمائر ولا تبدّل صاحب الفعل. عن نفسك استخدم المذكر لأن شخصية المساعد رجل: «أنا هساعدك، أنا هجاوبك، أنا هرد عليك»؛ ولا تقل «أنا هتساعدك» أو «أنا هتجاوبك». خاطب المستخدم وفق الصيغة التي صرّح بها أو سياق كلامه الواضح، ولا تخمّن النوع من الاسم وحده. في الفصحى أو النصوص الرسمية، طبّق الإعراب والتنوين عند الحاجة: تنوين الضم والفتح والكسر، ولا تضف التنوين عشوائيًا إلى العامية المصرية. ميّز إملائيًا وصوتيًا بين الهاء الأصلية «ه» والتاء المربوطة «ة» والتاء المفتوحة «ت»: «وجه/مياه» مقابل «مدرسة/شجرة» مقابل «بيت/بنت». التاء المربوطة تُنطق غالبًا هاءً عند الوقف وتاءً عند الوصل في العربية الفصحى، أما العامية المصرية فقد تختلف في الأداء؛ لا تستبدل حرفًا بآخر لمجرد تشابه الصوت. لا تدّعِ أن هذه القواعد تضمن نطق محرّك الصوت؛ هي قواعد لتكوين الرد ومراجعته.",
          "وحدة النطق: الكلام المنطوق مصري قاهري طبيعي، والجيم المصرية صوت /g/ صلب مثل ج في «جمال» و«مجدي»، لا صوت /dʒ/ الإنجليزي. النص المكتوب يظل إملائيًا طبيعيًا ولا تكتب رموزًا غريبة للمستخدم. طبقة تحويل النص إلى صوت وحدها يمكنها تهيئة اسم المساعد «ضجه» بصيغة «ضَجَّة» لتقريب القراءة المطلوبة؛ لا تستخدم حرف گ ولا تعمّم هذه التهيئة على كلمات أخرى. حافظ على الكلمات والمعنى وعلامات الترقيم، ولا تغيّر «دقة» أو «دقّة» أو أي كلمة عادية إلى اسم المساعد. التشكيل يكون محدودًا فقط عندما يخدم النطق، ولا تُشكّل النص كله.",
          "استعمل سجل المحادثة والذاكرة المرسلة لفهم الإشارات والتصحيحات، وقدّم أحدث تصحيح على القديم. لا تختلق ذكريات أو معلومات شخصية. لا تخترع أرقامًا أو بيانات محل؛ استخدم فقط البيانات التي أُرسلت فعلًا، ولا تدّع تنفيذ شيء لم تنفذه.",
          "راجع الرد أخيرًا: هل جاوب السؤال فعلًا؟ هل الاسم والهوية والضمائر صحيحة؟ هل الصرف والنحو طبيعيان؟ هل توجد جملة زائدة أو معلومة مخترعة؟ أصلحها قبل الإرسال."
        ].join("\n") + (memory ? "\n\nذاكرة المستخدم المتاحة (مرجع سياقي، استخدم المرتبط بالسؤال فقط): " + memory : "") + (businessContext ? "\n\nسياق العمل الثابت (ليس بيانات حية): " + businessContext : "");
        const failures = [];

        if (env.OPENAI_API_KEY) {
          try {
            const ai = await fetch("https://api.openai.com/v1/responses", {
              signal: AbortSignal.timeout(6500), method: "POST",
              headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({ model: "gpt-4.1-mini", instructions, input: conversation, max_output_tokens: 320 })
            });
            const data = await ai.json();
            if (ai.ok) {
              let reply = String(data.output_text || (data.output || []).flatMap(item => item.content || []).filter(item => item.type === "output_text").map(item => item.text || "").join("\n") || "").trim();
              reply = normalizeArabicReply(reply, userText);
              if (reply) return json({ reply, provider: "openai" });
              failures.push("OpenAI returned an empty reply");
            } else failures.push("OpenAI: " + (data?.error?.message || "request failed"));
          } catch (error) { failures.push("OpenAI: " + String(error)); }
        }

        if (env.GROQ_API_KEY) {
          try {
            const ai = await fetch("https://api.groq.com/openai/v1/chat/completions", {
              signal: AbortSignal.timeout(5000), method: "POST",
              headers: { "Authorization": `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "system", content: instructions }, ...conversation], max_tokens: 300, temperature: 0.35 })
            });
            const data = await ai.json();
            if (ai.ok) {
              let reply = String(data?.choices?.[0]?.message?.content || "").trim();
              reply = normalizeArabicReply(reply, userText);
              if (reply) return json({ reply, provider: "groq" });
              failures.push("Groq returned an empty reply");
            } else failures.push("Groq: " + (data?.error?.message || "request failed"));
          } catch (error) { failures.push("Groq: " + String(error)); }
        }

        if (env.AI) {
          try {
            const result = await Promise.race([env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", { messages: [{ role: "system", content: instructions }, ...conversation], max_tokens: 300 }), new Promise((_, reject) => setTimeout(() => reject(new Error("Cloudflare AI timeout")), 5000))]);
            let reply = normalizeArabicReply(String(result?.response || "").trim(), userText);
            if (reply) return json({ reply, provider: "cloudflare-ai" });
            failures.push("Cloudflare AI returned an empty reply");
          } catch (error) { failures.push("Cloudflare AI: " + String(error)); }
        }

        if (!env.OPENAI_API_KEY && !env.GROQ_API_KEY && !env.AI) return json({ error: "No chat provider configured", detail: "Enable the AI binding in Cloudflare Workers, or configure GROQ_API_KEY / OPENAI_API_KEY." }, 503);
        return json({ error: "All configured chat providers failed", detail: failures.join(" | ") }, 502);
      } catch (error) { return json({ error: "Chat failure", detail: String(error) }, 500); }
    }

    if (url.pathname !== "/tts" || request.method !== "POST") return json({ error: "Not found" }, 404);

    try {
      if (!env.ELEVENLABS_API_KEY) return json({ error: "DAGA voice is not configured" }, 503);
      const body = await request.json();
      let text = String(body?.text || "").trim();
      if (!text) return json({ error: "text is required" }, 400);

      text = text
        .replace(/\bplus\b|\bپلس\b/gi, " زائد ")
        .replace(/\bminus\b/gi, " ناقص ")
        .replace(/\bequals?\b/gi, " يساوي ")
        .replace(/\bmultipl(?:y|ied|ication)\b/gi, " ضرب ")
        .replace(/\bdivid(?:e|ed|ing)\b/gi, " قسمة ")
        .replace(/\bDAGA\b/gi, "ضَگْه")
        .replace(/\bMH\b/gi, "المساعد")
        .replace(/عاميه/gu, "عامية").replace(/دقه/gu, "دقة").replace(/حلوه/gu, "حلوة")
        .replace(/فكره/gu, "فكرة").replace(/طريقه/gu, "طريقة").replace(/حاجه/gu, "حاجة")
        .replace(/مره/gu, "مرة").replace(/مشكله/gu, "مشكلة").replace(/خدمه/gu, "خدمة")
        .replace(/معلومه/gu, "معلومة").replace(/شخصيه/gu, "شخصية").replace(/سهوله/gu, "سهولة")
        .replace(/بسرعه/gu, "بسرعة").replace(/عامه/gu, "عامة").replace(/اداره/gu, "إدارة")
        .replace(/قراءه/gu, "قراءة").replace(/كتابه/gu, "كتابة").replace(/اجابه/gu, "إجابة")
        .replace(/اضافه/gu, "إضافة").replace(/خلاصه/gu, "خلاصة").replace(/مباشره/gu, "مباشرة").replace(/طبيعه/gu, "طبيعة")
        .replace(/هفرأ/gu, "هَفَرَّق").replace(/هفرق/gu, "هَفَرَّق")
        .replace(/أنا\s+هتساعدك/gu, "أنا هساعدك").replace(/أنا\s+هتجاوبك/gu, "أنا هجاوبك")
        .replace(/هتساعدك/gu, "هساعدك").replace(/هتجاوبك/gu, "هجاوبك")
        .replace(/هجاوبك/gu, "هَجَاوْبَك").replace(/هساعدك/gu, "هَسَاعْدَك")
        .replace(/صيانة/gu, "صِيَانَة").replace(/بسهولة/gu, "بِسُهُولَة").replace(/بسرعة/gu, "بِسُرْعَةٍ")
        .replace(/ضَگْه|ضَجَه|ضَجْه|ضَجَّة|ضجه|ضجّة|ضجة/gu, "ضَجَّة")
        .replace(/\s{2,}/g, " ").trim();

      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`, {
        signal: AbortSignal.timeout(12000), method: "POST",
        headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json", "Accept": "audio/mpeg" },
        body: JSON.stringify({ text, model_id: "eleven_flash_v2_5", language_code: "ar", voice_settings: { stability: 0.32, similarity_boost: 0.80, style: 0.22, speed: 0.88, use_speaker_boost: true } })
      });
      if (!response.ok) return new Response(await response.text(), { status: response.status, headers: cors({ "Content-Type": "application/json" }) });
      return new Response(response.body, { headers: cors({ "Content-Type": response.headers.get("content-type") || "audio/mpeg", "Cache-Control": "no-store" }) });
    } catch (error) { return json({ error: "Worker failure", detail: String(error) }, 500); }
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors({ "Content-Type": "application/json; charset=utf-8" }) });
}
function cors(extra = {}) {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", ...extra };
}
function normalizeArabicReply(value, userText = "") {
  const question = String(userText || "");
  let reply = String(value || "").trim();
  if (/(اسمك\s*(?:إيه|ايه|ما|ماذا)|مين\s*إنت|من\s*أنت|عرفني\s*بنفسك)/u.test(question)) return "أنا ضجه، مساعدك الذكي.";
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
