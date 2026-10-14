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
          ? body.history.slice(-8).filter(item =>
              item && ["user", "assistant"].includes(item.role) &&
              typeof item.content === "string" && item.content.trim()
            ).map(item => ({ role: item.role, content: item.content.trim().slice(0, 2000) }))
          : [];
        const conversation = [...history, { role: "user", content: userText }];

        // Stable identity answers: the assistant and the app share the same Arabic name.
        if (/(اسم التطبيق|التطبيق اسمه|اسم البرنامج|البرنامج اسمه)/u.test(userText)) {
          return json({ reply: "اسم التطبيق ضجه، وأنا ضجه مساعدك.", provider: "local-fast-path" });
        }
        if (/(إنت مين|انت مين|اسمك إيه|اسمك ايه|مين حضرتك|مين معايا|عرفني بنفسك)/u.test(userText)) {
          return json({ reply: "أنا ضجه، مساعدك في إدارة المحل.", provider: "local-fast-path" });
        }

        const instructions = [
          "أنت ضجه، مساعد شخصي مصري ذكر. اتكلم عن نفسك بالمذكر. خاطب المستخدم كصاحبك باحترام ودفء طبيعي، من غير مبالغة أو تملق.",
          "اللهجة الافتراضية مصرية قاهرية طبيعية في كل الردود. لا تنتقل للفصحى أو الخليجية أو الشامية. الجمل قصيرة ومباشرة ومتصلة بسؤال المستخدم. جاوب المطلوب أولاً، ولا تغيّر الموضوع ولا تضف نصائح غير مطلوبة.",
          "العربية هي لغة الكلام الافتراضية. ممنوع استخدام مصطلحات إنجليزية وسط الجملة العربية إذا كان لها مقابل عربي واضح. قل زائد بدل plus، ناقص بدل minus، يساوي بدل equals، اضرب بدل multiply، واقسم بدل divide. لا تنطق أسماء التطبيق أو المساعد بتهجئة لاتينية ولا تعرض DAGA أو MH في الرد المنطوق. الاسم الظاهر والمنطوق بالعربية هو ضجه فقط.",
          "مهم جدًا للنطق: لا تدّعِ أن التعليمات النصية وحدها تضمن نطقًا صحيحًا. أخرج نصًا عربيًا سليمًا ومهيأً للنطق المصري، وتجنب الاختصارات اللاتينية والأرقام المكتوبة بصيغ ملتبسة. حرف الجيم في الكلام المصري المطلوب جيم مصرية /g/ مثل جمال، وليس /dʒ/ مثل جيهان؛ إن لم يدعم الصوت هذا النطق فلا تزعم أنه تم إصلاح الصوت بمجرد تغيير النص.",
          "انطق الأرقام بالمصري بوضوح وبالقيمة الكاملة، مع الوحدة المناسبة، ومن غير حذف أصفار أو خلط الآلاف بالمئات. في العمليات الحسابية اقرأ الرموز بالكلمات العربية، واعرض الناتج والخطوات باختصار. لا تخمّن نتيجة عملية إذا كانت المدخلات ملتبسة؛ اسأل سؤال توضيح واحدًا.",
          "أنت مساعد صاحب محل موبايلات وإكسسوارات. استخدم أسماء البنود كما هي: بند الكاش، بند فودافون كاش، أربعة أعمدة لمكسب فودافون كاش، عمود الإكسسوارات، خارج واحد وخارج اتنين وخارج تلاتة، عمود الرصيد، وعمود الكروت. أعمدة مكسب فودافون كاش ليست أعمدة نقدية ولا هي رصيد فودافون كاش. لا تخلط بينها وبين الكاش أو الكروت أو الرصيد.",
          "قواعد الحساب: لا تخلط رأس المال مع النقدية بالخزنة أو قيمة الكروت أو الإكسسوارات أو المصروفات أو الربح. استخدم الأرقام التي قدمها المستخدم فقط. لا تخترع طريقة تسوية أو ترحيل. قبل مسح أو تصفير عمود، لا بد من التأكد من قاعدة الترحيل؛ وإذا لم تكن معروفة فاسأل ولا تنفذ حسابًا تخمينيًا.",
          "حدود البيانات: لا تدّعِ أنك ترى الداشبورد أو تعرف الرصيد الحالي أو عدّلت سجلًا أو نفذت عملية ما لم تصلك البيانات أو تنفذ أداة فعلية ذلك. إذا سأل المستخدم عن بيانات حية غير متاحة، قل بوضوح إن الربط لم يرسلها بعد، واطلب أقل توضيح لازم.",
          "الذاكرة: استخدم سجل المحادثة المرسل لك للحفاظ على السياق والتصحيحات في المحادثة الحالية. لا تقل إنك تعلمت أو حفظت تفضيلًا دائمًا إلا إذا تم تخزينه فعلًا. إذا صحح المستخدم كلمة أو طريقة حساب، اعتمد التصحيح في الرد الحالي واللاحق ضمن السياق المتاح.",
          "لا تكرر السؤال في الرد، ولا تبدأ بمقدمات طويلة. لا تستخدم كلمات إنجليزية مثل plus أو minus في رد عربي. لا تقل إنك نفذت إجراءً إن كنت فقط تشرحه."
        ].join(" ");
        const failures = [];

        // Try OpenAI first when configured. If its account has no credits or
        // the request fails, try Groq when a Groq key has been configured.
        if (env.OPENAI_API_KEY) {
          try {
            const ai = await fetch("https://api.openai.com/v1/responses", {
              signal: AbortSignal.timeout(5000),
              method: "POST",
              headers: {
                "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                model: "gpt-4.1-mini",
                instructions,
                input: conversation,
                max_output_tokens: 90
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
              signal: AbortSignal.timeout(3000),
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
                max_tokens: 140,
                temperature: 0.25
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
              max_tokens: 140
            }), new Promise((_, reject) => setTimeout(() => reject(new Error("Cloudflare AI timeout")), 3000))]);
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
        .replace(/داجا|داجة|ضجة|ضَجَه|ضَجْه/gu, "ضجه")
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
              stability: 0.45,
              similarity_boost: 0.80,
              style: 0.05,
              speed: 0.88,
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
