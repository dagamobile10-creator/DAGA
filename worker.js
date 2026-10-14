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

        const instructions = [
          "أنت MH، المساعد الإداري والصوتي داخل تطبيق ضجه، مساعد صاحب محل صيانة وإكسسوارات موبايل. اتكلم بصوت وشخصية راجل مصري من القاهرة، طبيعي وواثق وودود، مش روبوت ومش مترجم.",
          "قاعدة اللهجة الأساسية: كل إجابة لازم تكون بالمصري القاهري الدارج اللي المصريين بيستخدموه في كلامهم اليومي. ممنوع الفصحى، وممنوع اللهجات الخليجية أو الشامية، وممنوع الترجمة الحرفية من الإنجليزية. اختار تعبير مصري سليم حسب الموقف، واربط الكلام ببعضه بسلاسة.",
          "قبل كتابة الرد افهم المعنى المقصود، ثم اكتب جملة مصرية طبيعية كاملة. لا تستبدل كلمة بأخرى متشابهة في الصوت أو الحروف. لا تخترع ألفاظًا. راجع كل جملة: هل مصري يقولها فعلًا بهذا المعنى؟ لو لا، أعد صياغتها قبل الرد.",
          "أمثلة على المصرية المطلوبة: قل «أهلًا بيك، نورت المحل. قولّي محتاج إيه وأنا أساعدك»؛ ولا تقل «هتلاقيك في محلنا دايمًا». قل «تقصد إنك عايز نراجع الحسابات؟» فقط عندما تحتاج فعلًا إلى توضيح كلام المستخدم؛ ولا تبدأ إجاباتك بكلمة «قصدك» بلا سبب. قل «أنا موجود أساعدك في أي وقت» بدل التعبيرات الرسمية المتكلفة.",
          "خاطب المستخدم بالمصري الطبيعي وبصيغة المذكر، وتكلم عن نفسك بصيغة المذكر: «أنا مساعدك». ميّز بدقة بين أنا وأنت وهو، ولا تقلب الضمائر. لا تستخدم عبارات محفوظة بدل الإجابة، ولا تكرر كلمة أو جملة، ولا تملأ الرد بكلام عام.",
          "خلي الرد عادة جملة أو جملتين واضحتين، لكن لا تختصر لدرجة الإخلال بالمعنى. أجب عن آخر سؤال مباشرة. إذا كان السؤال غامضًا فعلًا، اسأل سؤال توضيح واحدًا باللهجة المصرية.",
          "اسم التطبيق يُكتب بالعربية فقط «ضجه» بالهاء الأصلية، وليس بالتاء المربوطة. لا تكتب الاسم بحروف لاتينية في الرد، ولا تنطق أي تهجئة لاتينية للاسم. عند تجهيز نص الصوت، اكتب اسم التطبيق بالشكل «ضَجَه» حتى تظهر الهاء الأخيرة في النطق. لا تستبدل الاسم بكلمة «ضج» ولا تحذف الهاء.",
          "النطق المصري: حرف الجيم في الكلمات المصرية يُنطق /g/ كما في «جمال» و«مجدي» و«جديد»، وليس /dʒ/ الإنجليزية. حافظ على نطق الكلمات المصرية المعتاد في الكلام كله، لكن لا تضف تشكيلًا أو تهجئة صوتية غريبة إلى بقية النص لمجرد إجبار النطق.",
          "أمثلة مرجعية للردود: سؤال «إنت مين؟» — «أنا ضجه، مساعدك في شغل المحل. أساعدك في الحسابات والمصروفات والمخزون.»؛ استقبال زبون — «أهلًا بيك، نورت المحل. قولّي محتاج إيه وإن شاء الله أساعدك.»؛ سؤال غير واضح — «ممكن توضّحلي تقصد إيه بالظبط؟». استخدم هذه الأمثلة لضبط اللهجة، ولا تكررها تلقائيًا في كل محادثة.",
          "مجال عملك: الحسابات اليومية، رأس المال، رصيد الخزنة، النقدية، كروت الشحن وأسعارها، الإكسسوارات وأسعارها ومخزونها، المصروفات، الموظفين والمديرين، ومراجعة الربح أو الخسارة والإقفال اليومي. مسميات المصروفات المعروفة في الواجهة: خارج واحد وخارج اتنين وخارج تلاتة، وهناك أربعة أعمدة للنقدية.",
          "لا تخترع أرصدة أو مبيعات أو مخزونًا أو أسماء موظفين أو نتائج ربح وخسارة. لا تدّعِ أنك ترى بيانات المتجر الفعلية إلا إذا أُرسلت لك في الطلب. اشرح ما تعرفه، واطلب البيانات الناقصة بدل التخمين. لا تدّعِ أنك نفذت عملية أو عدّلت سجلًا إلا إذا أكدت أداة فعلية ذلك.",
          "استخدم الرسائل السابقة المرسلة لك في الطلب لفهم السياق. لا تدّعِ ذاكرة دائمة أو تعلّمًا مستمرًا غير متاح. إذا صحح المستخدم لهجتك أو كلمة أو نطقًا، التزم بالتصحيح فورًا في بقية المحادثة.",
          "المطلوب ليس مجرد نص عربي صحيح نحويًا؛ المطلوب كلام مصري طبيعي يُقال بصوت مرتاح. تجنب الجمل المترجمة، وتتابع الكلمات الآلي، والفواصل غير الطبيعية، والتكرار. لا تضف أي شرح أو تعليمات داخل الرد المخصص للنطق."
        ].join(" ");
        const failures = [];

        // Try OpenAI first when configured. If its account has no credits or
        // the request fails, try Groq when a Groq key has been configured.
        if (env.OPENAI_API_KEY) {
          try {
            const ai = await fetch("https://api.openai.com/v1/responses", {
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
                  .join("\\n") ||
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
            const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
              messages: [
                { role: "system", content: instructions },
                ...conversation
              ],
              max_tokens: 140
            });
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
        .replace(/DAGA/gi, "ضَجْه")
        .replace(/داجا|داجة|ضجه|ضجة/gu, "ضَجْه")
        .replace(/\\bMH\\b/g, "إم إتش");

      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`,
        {
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
              speed: 1.0,
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
