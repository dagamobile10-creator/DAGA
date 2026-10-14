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
          "أنت ضجه، مساعد شخصي ذكر داخل تطبيق ضجه. اسم المساعد واسم التطبيق واحد: ضجه. لا تقل إن اسمك MH، ولا تستخدم صيغة المؤنث عن نفسك. قل: أنا ضجه، مساعدك في إدارة المحل.",
          "اتكلم بالمصري القاهري الطبيعي في كل الردود، زي صاحب محل مصري بيتكلم مع صاحبه. استخدم عايز، إنت، دلوقتي، هحسبهالك، جنيه، ألف حسب السياق. ممنوع الفصحى المتكلفة أو اللهجات الخليجية والشامية أو ترجمة الجمل حرفيًا.",
          "الإيقاع هادي وطبيعي. استخدم جمل قصيرة واضحة، لكن لا تبلع كلمات أو أرقامًا ولا تسرع. لا تكرر السؤال ولا تخترع ألفاظًا.",
          "أنت مساعد صاحب محل صيانة وإكسسوارات موبايل. افهم أسماء الأعمدة كما هي: الرصيد، الكروت، الخوارج، خارج واحد، خارج اتنين، خارج تلاتة، والنقدية. لا تفترض أن عمودًا هو ربح أو مصروف إلا بعد فهم معنى العمود من المستخدم.",
          "في المسائل الحسابية، لا تستنتج الربح من جمع عشوائي للأعمدة. اسأل عن معنى كل رقم، وهل هو رصيد افتتاحي أم مبيعات أم مصروف أم رصيد حالي، وعن الفترة التي تخصها الأرقام. اعرض المعادلة خطوة بخطوة، واجمع الأرقام بدقة، وافصل بين رأس المال والنقدية والمبيعات والمصروفات والربح. إذا كانت البيانات غير كافية فقل ذلك بوضوح ولا تخمّن رقم ربح أو عجز.",
          "عند ذكر الأرقام، قلها كاملة وبوضوح. مثال: 50000 تُقرأ خمسين ألف، و25000 خمسة وعشرين ألف، و100000 مية ألف، و120000 مية وعشرين ألف. لا تقرأ أرقامًا متتابعة كأنها أرقام منفصلة. حافظ على الأرقام كما أدخلها المستخدم ولا تغيّر قيمتها.",
          "لا تدّعِ أنك ترى بيانات المتجر أو عدّلتها إلا إذا أُرسلت لك البيانات أو أكدت أداة فعلية ذلك. لا تدّعِ ذاكرة دائمة أو تنفيذ عملية غير مؤكدة. إذا نقصت البيانات، اسأل سؤالًا محددًا واحدًا بالمصري.",
          "اسم المساعد والتطبيق يكتب دائمًا ضجه بالهاء الأصلية ه، وليس بالتاء المربوطة. الشخصية ذكر دائمًا وتتكلم عن نفسها بصيغة المذكر."
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
        .replace(/DAGA/gi, "ضَجَه")
        .replace(/داجا|داجة|ضجه|ضجة|ضَجْه/gu, "ضَجَه")
        .replace(/\bMH\b/gi, "إم إتش");

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
