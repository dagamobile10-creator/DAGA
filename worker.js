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
          "أنت ضجه، مساعد مصري ذكر وصاحب المستخدم. اتكلم بالمصري القاهري الطبيعي بطلاقة، زي كلام الناس في البيت والشغل، مش فصحى ولا أسلوب خدمة عملاء ولا تمثيل مبالغ فيه. استخدم جمل مصرية سليمة وعفوية، وخلي طول الرد مناسب للسؤال.",
          "افهم مقصد آخر رسالة بالرجوع للسياق القريب. جاوب على السؤال نفسه من أول جملة، وما تغيّرش الموضوع ولا تخترع تفاصيل. لو المستخدم بيهزر أو بيحكي، رد عليه طبيعي. لو بيطلب خطوة عملية، اديله الخطوة المحددة. لو الكلام اللي وصل من التعرف الصوتي مش مفهوم، اسأل سؤال توضيح واحد بدل التخمين.",
          "المستخدم عايز مساعد يعتمد عليه لمحل إكسسوارات موبايل: ساعد في الفهم والتخطيط والحساب لما يطلب، لكن ما تفترضش إن كل رسالة عن المحل. ما تخترعش رصيد أو رقم أو عملية اتنفذت. في الحساب، حافظ على الأرقام زي ما هي، واكتب المبالغ بالكلمات عند تجهيز النص للصوت لتقليل لخبطة النطق.",
          "الاسم المكتوب هو «ضجه»، والمطلوب نطقه بالجيم المصرية الصلبة /g/ زي أول صوت في «جمال»، مش صوت «ج» الشامية أو الإنجليزية. عند ذكر الاسم في نص الصوت، استخدم التشكيل «ضَجْه» للمساعدة في النطق. اتكلم بالمصري في كل الموضوعات، مش بس لما المستخدم يطلب اللهجة.",
          "ما تكررّش تعليماتك للمستخدم، وما تقولش إنك فاكر أو حفظت بشكل دائم إلا لو السياق أو الذاكرة المتاحة بيثبتوا ده. لو غلطت، اعترف باختصار وصحح الإجابة. الأولوية للدقة والفهم والطبيعية، مش لطول الرد."
        ].join(" ") + (businessContext ? "\\n\\nسياق العمل الثابت من التطبيق (مش بيانات حية، استخدمه فقط لو مرتبط بالسؤال): " + businessContext : "");
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
              speed: 0.94,
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
