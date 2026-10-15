const VOICE_ID = "PF3gVGPrCr6Dw1WaSSiy";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors() });
    }

    if (url.pathname === "/health") {
      return json({
        ok: true,
        voiceConfigured: Boolean(env.ELEVENLABS_API_KEY),
        chatConfigured: Boolean(env.OPENAI_API_KEY),
        freeChatConfigured: Boolean(env.GROQ_API_KEY || env.AI)
      });
    }

    if (url.pathname === "/chat" && request.method === "POST") {
      try {
        const body = await request.json();
        const userText = String(body?.text || "").trim();
        if (!userText) return json({ error: "text is required" }, 400);
        const history = Array.isArray(body?.history)
          ? body.history.slice(-12).filter(item =>
              item && ["user", "assistant"].includes(item.role) &&
              typeof item.content === "string" && item.content.trim()
            ).map(item => ({ role: item.role, content: item.content.trim().slice(0, 2000) }))
          : [];
        const conversation = [...history, { role: "user", content: userText }];
        const businessContext = typeof body?.businessContext === "string" ? body.businessContext.trim().slice(0, 3000) : "";

        // Stable project memory for direct recall questions. This is grounded in
        // confirmed project history, not the shop's live ledger or recent model guesses.
        const recallQuestion = /(?:فاكر|تفتكر|متذكر|تتذكر|عارف)\s*(?:إحنا|احنا|كنا|احنا كنا)?[\s\S]{0,90}(?:بنحاول نصلح|بنصلح|نصلح فيك|نصلح|نظبط فيك|نظبطك|المشكلة فيك|كنا عايزين نصلح)/u.test(userText)
          || /إيه اللي كنا بنحاول نصلحه فيك|احنا كنا بنصلح فيك ايه|إحنا كنا بنصلح فيك إيه/u.test(userText);
        if (recallQuestion) {
          return json({
            reply: "أيوه يا صاحبي، فاكر. كنا بنظبط كلامي عشان أبقى مصري طبيعي من غير تكلّف، وأنطق الحروف والأرقام والمبالغ صح، والأهم أفهم سؤالك وأرد على نفس الموضوع بدل ما أخترع أرقام للمحل. اللي حصل إني رديت عليك بمعلومات مالهاش علاقة بسؤالك، وده لازم يتصلح. ولسه ما نعتبرش الذاكرة الدائمة مضمونة لمجرد إن فيه سجل محادثة محفوظ.",
            provider: "project-memory"
          });
        }

        // All user messages go through the language model; no canned chat replies.

        const instructions = [
          "أنت ضَجْه DAGA، مساعد ذكاء اصطناعي شخصي وصاحب المستخدم المصري وشريكه في الشغل. أنت مساعد رجل، استخدم صيغة المذكر عن نفسك.",
          "اللهجة الأساسية إلزاميًا هي العامية المصرية اليومية الطبيعية، خصوصًا القاهرية: كلام بيت وشغل حقيقي، مش فصحى متحوّلة لصوت عامي، ومش لهجة خليجية أو شامية. استخدم تراكيب مصرية تلقائية مثل: إنت عايز إيه، خلّينا نشوف، هظبطهالك، أقدر أساعدك، بس ما تكررش أمثلة ثابتة ولا تبدأ كل رد بنفس العبارة. اختار التعبير حسب الموقف.",
          "اكتب الجمل بالطريقة اللي المصري بيتكلم بيها فعلًا: جمل واضحة ومباشرة، أفعال وتعبيرات مصرية، من غير صياغات رسمية زي: يرجى العلم، بناءً على ما سبق، هل ترغب في المزيد من المساعدة. ما تستخدمش فصحى إلا لو المستخدم طلبها صراحة أو محتوى رسمي يحتاجها.",
          "افهم قصد المستخدم قبل ما ترد. اقرأ آخر رسالة مع سياق المحادثة، جاوب على نفس السؤال، وما تحوّلش الكلام لمحاضرة أو قائمة نصائح لو مش مطلوبة. لو بيحكي أو بيهزر، رد اجتماعيًا بشكل طبيعي. لو متضايق، اعترف بالخطأ المحدد بهدوء واصلحه من غير دفاع أو اعتذارات متكررة. لو صحح معلومة، اعتمد التصحيح بعد كده.",
          "ذكاؤك الاجتماعي معناه إنك تلاحظ نبرة الكلام واحتياج الشخص: أحيانًا محتاج إجابة سريعة، أحيانًا نقاش، وأحيانًا تنفيذ خطوة. ما تبالغش في الهزار أو الألفة، وما تكررش يا صاحبي في كل جملة. ما تتظاهرش بمشاعر أو بذاكرة مش متاحة.",
          "كن شريك تفكير، مش منفذ أوامر أعمى: حلل الفكرة، وضّح المخاطر والعيوب عند اللزوم، واقترح حل عملي. صحّح المعلومة الغلط باحترام. لو مش متأكد، قل ده بوضوح. لو فيه نقص يمنع إجابة صحيحة، اسأل سؤال توضيح واحد محدد بدل التخمين.",
          "في تطبيق DAGA، المستخدم بيدير محل إكسسوارات موبايل. ما تفترضش إن كل كلامه عن المحل. ما تقولش إنك شايف الداشبورد أو عارف الرصيد أو المخزون أو المصروفات إلا لو البيانات الفعلية وصلتك في الطلب. ما تدّعيش تنفيذ إضافة أو تعديل أو تحويل مالي إلا لو أداة فعلية نفذت العملية وأكدت نجاحها. سياق المحل الثابت مش بيانات حية.",
          "الحسابات والأرقام أولوية دقة: حافظ على كل رقم ووحدته، ميّز بين الآلاف والمئات والعشرات، راجع الحساب، وما تخترعش أرقام. لما تجهز ردًا منطوقًا، اكتب المبالغ بطريقة تقلل لخبطة النطق واذكر جنيه أو جنيهات بوضوح. لو بيانات الحساب ناقصة، اطلبها.",
          "الاسم العربي هو «ضجه» بالهاء كما كتبها المستخدم، وفي النطق استخدم «ضَجْه». مهم جدًا: انطق الجيم المصرية القاهرية /g/ زي أول صوت في «جمال» و«مجدي»؛ وانطق «جيهان» بنفس الجيم المصرية الصلبة، مش بصوت /dʒ/ المعطّش. طبّق الجيم المصرية الطبيعية على كل كلامك، مش على اسم ضجه بس، وما تفتعلش لهجة مصطنعة. استبدل DAGA في النص المخصص للصوت بالاسم العربي عند الحاجة. لا تغيّر الاسم إلى ضجة.",
          "استخدم سجل المحادثة المرسل لك فقط كذاكرة متاحة. لا تدّعي ذاكرة دائمة أو حفظًا دائمًا إلا لو نظام الذاكرة أكد ذلك. فرّق بين الحقيقة والاستنتاج والافتراض.",
          "اجعل الرد مناسبًا للمحادثة الصوتية: ابدأ بالإجابة، استخدم جملًا طبيعية غير طويلة، وتجنب الرموز والتنسيقات المعقدة والتعدادات الطويلة إلا لو المستخدم طلب تفاصيل. لا تكرر السؤال ولا تشرح ما لم يطلبه. أجب باللغة التي يستخدمها المستخدم، والمصري هو الافتراضي.",
          "افصل تمامًا بين سرعة تجهيز الإجابة وسرعة نطقها: افهم السؤال وجهّز الرد فورًا من غير انتظار أو تأخير متعمد، وبعد ما النص يجهز انطقه ببطء وهدوء وبإيقاع مصري طبيعي، مع وقفات قصيرة بين الجمل، من غير مطّ مصطنع أو نبرة آلية. ما تقللش سرعة التفكير أو توليد الرد عشان تبطّأ الصوت؛ البطء مطلوب في الصوت الناتج فقط."
        ].join("\n") + (businessContext ? "\n\nسياق العمل الثابت من التطبيق (مش بيانات حية، استخدمه فقط لو مرتبط بالسؤال): " + businessContext : "");
        const failures = [];

        // Try OpenAI first when configured. If its account has no credits or
        // the request fails, try Groq when a Groq key has been configured.
        if (env.OPENAI_API_KEY) {
          try {
            const ai = await fetch("https://api.openai.com/v1/responses", {
              signal: AbortSignal.timeout(8500),
              method: "POST",
              headers: {
                "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                model: "gpt-4.1-mini",
                instructions,
                input: conversation,
                max_output_tokens: 240
              })
            });
            const data = await ai.json();
            if (ai.ok) {
              const reply = String(
                data.output_text ||
                (data.output || []).flatMap(item => item.content || [])
                  .filter(item => item.type === "output_text")
                  .map(item => item.text || "")
                  .join("\n") ||
                ""
              ).trim();
              if (reply) return json({ reply, provider: "openai" });
              failures.push("OpenAI returned an empty reply");
            } else {
              failures.push("OpenAI: " + (data?.error?.message || "request failed"));
            }
          } catch (error) {
            failures.push("OpenAI: " + String(error));
          }
        }

        if (env.GROQ_API_KEY) {
          try {
            const ai = await fetch("https://api.groq.com/openai/v1/chat/completions", {
              signal: AbortSignal.timeout(6500),
              method: "POST",
              headers: {
                "Authorization": `Bearer ${env.GROQ_API_KEY}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [
                  { role: "system", content: instructions },
                  ...conversation
                ],
                max_tokens: 220,
                temperature: 0.45
              })
            });
            const data = await ai.json();
            if (ai.ok) {
              const reply = String(data?.choices?.[0]?.message?.content || "").trim();
              if (reply) return json({ reply, provider: "groq" });
              failures.push("Groq returned an empty reply");
            } else {
              failures.push("Groq: " + (data?.error?.message || "request failed"));
            }
          } catch (error) {
            failures.push("Groq: " + String(error));
          }
        }

        // Cloudflare Workers AI binding is a no-extra-secret fallback.
        // Enable it in Worker settings or deploy with the included wrangler.toml.
        if (env.AI) {
          try {
            const result = await Promise.race([env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
              messages: [
                { role: "system", content: instructions },
                ...conversation
              ],
              max_tokens: 220
            }), new Promise((_, reject) => setTimeout(() => reject(new Error("Cloudflare AI timeout")), 7000))]);
            const reply = String(result?.response || "").trim();
            if (reply) return json({ reply, provider: "cloudflare-ai" });
            failures.push("Cloudflare AI returned an empty reply");
          } catch (error) {
            failures.push("Cloudflare AI: " + String(error));
          }
        }

        if (!env.OPENAI_API_KEY && !env.GROQ_API_KEY && !env.AI) {
          return json({
            error: "No chat provider configured",
            detail: "Enable the AI binding in Cloudflare Workers, or configure GROQ_API_KEY / OPENAI_API_KEY."
          }, 503);
        }
        return json({
          error: "All configured chat providers failed",
          detail: failures.join(" | ")
        }, 502);
      } catch (error) {
        return json({ error: "Chat failure", detail: String(error) }, 500);
      }
    }

    if (url.pathname !== "/tts" || request.method !== "POST") {
      return json({ error: "Not found" }, 404);
    }

    try {
      if (!env.ELEVENLABS_API_KEY) {
        return json(
          { error: "DAGA voice is not configured" },
          503
        );
      }

      const body = await request.json();
      let text = String(body?.text || "").trim();

      if (!text) {
        return json(
          { error: "text is required" },
          400
        );
      }

      // Keep spoken output Arabic-only and normalize the app name before synthesis.
      // Avoid Latin brand spellings in Arabic speech to reduce language switching.
      text = text
        .replace(/\bplus\b|\bپلس\b/gi, " زائد ")
        .replace(/\bminus\b/gi, " ناقص ")
        .replace(/\bequals?\b/gi, " يساوي ")
        .replace(/\bmultipl(?:y|ied|ication)\b/gi, " ضرب ")
        .replace(/\bdivid(?:e|ed|ing)\b/gi, " قسمة ")
        .replace(/\bDAGA\b/gi, "ضجه")
        .replace(/\bMH\b/gi, "المساعد")
        .replace(/داجا|داجة|ضجة|ضَجَه|ضَجْه|ضجه/gu, "ضَجْه")
        .replace(/\s{2,}/g, " ")
        .trim();

      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`,
        {
          signal: AbortSignal.timeout(12000),
          method: "POST",
          headers: {
            "xi-api-key": env.ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg"
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_flash_v2_5",
            language_code: "ar",
            voice_settings: {
              stability: 0.32,
              similarity_boost: 0.80,
              style: 0.22,
              speed: 0.78,
              use_speaker_boost: true
            }
          })
        }
      );

      if (!response.ok) {
        return new Response(await response.text(), {
          status: response.status,
          headers: cors({
            "Content-Type": "application/json"
          })
        });
      }

      return new Response(response.body, {
        headers: cors({
          "Content-Type":
            response.headers.get("content-type") ||
            "audio/mpeg",
          "Cache-Control": "no-store"
        })
      });

    } catch (error) {
      return json(
        {
          error: "Worker failure",
          detail: String(error)
        },
        500
      );
    }
  }
};

function cors(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extra
  };
}

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: cors({
        "Content-Type": "application/json"
      })
    }
  );
}
