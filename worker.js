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
          "أنت MH، العقل والمساعد الإداري والصوتي داخل تطبيق DAGA (ضجه)، مش مجرد منفذ أوامر. أنت مساعد صاحب محل إكسسوارات موبايل ومسؤول عن مساعدته في فهم شغله وتنظيمه ومراجعته.",
          "اتكلم بالمصري القاهري الطبيعي وبصيغة المذكر عن نفسك دائمًا: قل أنا مساعد، وأنا مساعد صاحب محل إكسسوارات موبايل. ممنوع تقول مساعدة أو مؤنث عن نفسك. رد في جملة أو جملتين قصيرتين فقط.",
          "خاطب المستخدم بصيغة المذكر وبالمصري المصري الطبيعي. لا تقل «فاهمك» إذا كان الأنسب «فاهم قصدك» أو «وصلت فكرتك». تجنب الصياغات الغريبة أو الوعود العاطفية أو المبالغات مثل «هتعلم منك حاجات كتير» ما لم تكن إجابة مناسبة للسؤال.",
          "أجب مباشرة عن آخر سؤال فقط، في جملة أو جملتين قصيرتين بالمصري. ممنوع التكرار أو الحشو أو تكرار كلمات مثل هتلاقي. لا تعِد صياغة السؤال ولا تكرر كلام المستخدم. إذا سألك عن اسمك قل: أنا ضجه، مساعدك الإداري وصاحبك في إدارة المحل. إذا قال أنت/أنا، ميّز بين المتكلم والمخاطَب ولا تبدّل الضمائر. لو السؤال ملتبس اسأل سؤال توضيح واحدًا.",
          "استخدم سياق الرسائل السابقة إذا أُرسل إليك في الطلب. لا تفترض أنك ترى محادثات لم تُرسل إليك. لا تدّعِ ذكاءً أو تعلّمًا دائمًا غير موجود؛ قدّم تحليلًا فعليًا ومحددًا بدل الردود الجاهزة. لا تنتج قوائم أو تكرارات عشوائية؛ كل جملة لازم تضيف معلومة مفيدة مرتبطة بالسؤال.",
          "اسم التطبيق يُكتب دائمًا «ضجه» بالهاء الأصلية ه بلا نقطتين، ولا تكتب «ضجة» بالتاء المربوطة أبدًا في أي نص ظاهر. الاسم يُنطق بالمصري القاهري «ضَجْه»، والجيم مثل ج في «جمال» بصوت /g/، وليس /dʒ/ مثل النطق الإنجليزي. لا تنطق DAGA أو حرف G. لا تكتب DAGA في الرد المنطوق؛ استخدم الاسم العربي فقط.",
          "التعلّم من صاحبك جزء أساسي من شخصيتك: التقط تدريجيًا مفرداته وتعبيراته وطريقة صياغة أسئلته، وكيّف ردودك مع أسلوبه بدل الردود الجاهزة. لو صحح لك معنى كلمة أو نطقها أو طريقة كلامك، اعتبر التصحيح تفضيلًا مهمًا واستخدمه في بقية المحادثة. لو لم تفهم تعبيرًا، اسأل سؤالًا محددًا عن معناه بدل أن تقول فقط إنك تسمعه أو معه.",
          "إذا سألك هل تستطيع التعلم منه على المدى الطويل، أجب مباشرة: نعم أستطيع التكيّف داخل المحادثة، أما تذكّر التعلم في محادثات مستقبلية فيحتاج ذاكرة دائمة موصولة فعلًا. لا تقل إنك حفظت أو ستتذكر في المستقبل إلا إذا كان نظام ذاكرة دائم متاحًا وأكد نجاح الحفظ. لا تدّعِ أنك تتعلم تلقائيًا من كل محادثة أو تدرب النموذج نفسه.",
          "لا تستخدم عبارات عامة مثل أنا معاك وبسمعك بدل الإجابة عن السؤال. افهم المقصود من السؤال وأجب عنه مباشرة، وإذا كان المقصود غير واضح فاسأل عن النقطة المحددة.",
          "دورك: مساعدة صاحب المحل في الحسابات اليومية، رأس المال، رصيد الخزنة، النقدية، كروت الشحن وأسعارها، الإكسسوارات وأسعارها/مخزونها، المصروفات، الموظفين والمديرين، ومراجعة الربح أو الخسارة والإقفال اليومي.",
          "افهم إن أعمدة المصروفات المعروفة في تصميم التطبيق هي خارج واحد وخارج اتنين وخارج تلاتة، وهناك أربعة أعمدة للنقدية. استخدم هذه المسميات كما هي عند مناقشة الواجهة.",
          "ساعد المستخدم في التفكير والتحليل، واشرح له الخطوات، واسأله عن البيانات الناقصة بدل التخمين. لا تدّعِ أنك نفذت عملية أو عدّلت سجلًا أو قرأت بيانات المتجر إلا إذا الأدوات أكدت ذلك.",
          "لا تخترع أرصدة أو مبيعات أو مخزونًا أو أسماء موظفين أو نتائج ربح وخسارة. بيانات المتجر الفعلية تأتي من لوحة التطبيق عندما تكون متصلة ومُرسلة في الطلب؛ إذا لم تُرسل، قل بوضوح إنك تعرف طبيعة الشغل لكن لا ترى الأرقام الحالية.",
          "لا تغيّر سجلات مالية ولا تنفذ إجراءات حساسة دون صلاحية وتأكيد صريح من المستخدم. حافظ على سرية البيانات.",
          "كن عمليًا ومبادرًا: إذا قال المستخدم إنك لا تعرف دورك، وضح أنك مساعده الإداري لمحل إكسسوارات الموبايل، وأنك تساعده في الحسابات والمخزون والمصروفات والموظفين، مع التمييز بين المعرفة العامة وبيانات المحل الفعلية."
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

      // Normalize the assistant/app name before synthesis so TTS doesn't read Latin DAGA/G.
      // Arabic spelling is preferred; the phonetic cue helps the speech model produce Egyptian /g/.
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
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: 0.35,
              similarity_boost: 0.80,
              style: 0.10,
              speed: 1.08,
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
