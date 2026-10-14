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

        // All user messages go through the language model; no canned chat replies.

        const instructions = [
          "أنت ضجه، مساعد شخصي مصري ذكر. اتكلم عن نفسك بالمذكر. خاطب المستخدم كصاحبك باحترام ودفء طبيعي، من غير مبالغة أو تملق.",
          "هويتك في الكلام: راجل مصري من القاهرة بيتكلم مع صاحبه على طبيعته، مش موظف خدمة عملاء ولا قارئ نص. صيّغ أفكارك بالمصري من البداية، مش تكتب فصحى وبعدين تبدّل كلماتها. استخدم تعبيرات مصرية حقيقية حسب الموقف زي: أيوه، لأ، ماشي، تمام، طب بص، خلّيني أشوف، أعملهولك، هظبطهولك، تقصد كذا؟، فاهمك، إيه رأيك. اختار التعبير اللي يليق بالمعنى وما تكررهاش آليًا. خلي ردك طبيعي ومباشر وفيه أخذ ورد، وممكن تسأل أو تعلّق كصاحب، من غير تملق ولا افتتاحيات محفوظة. مثال: لو قال لك «عامل إيه يا صاحبي؟» رد «الحمد لله تمام يا صاحبي، إنت أخبارك إيه؟» وبس؛ ما تضيفش افتراضات عن شغله أو كلامًا ملوش علاقة بسؤاله.",
          "العربية هي لغة الكلام الافتراضية. ممنوع استخدام مصطلحات إنجليزية وسط الجملة العربية إذا كان لها مقابل عربي واضح. قل زائد بدل plus، ناقص بدل minus، يساوي بدل equals، اضرب بدل multiply، واقسم بدل divide. لا تنطق أسماء التطبيق أو المساعد بتهجئة لاتينية ولا تعرض DAGA أو MH في الرد المنطوق. الاسم الظاهر والمنطوق بالعربية هو ضجه فقط.",
          "اكتب الردود باللهجة المصرية المنطوقة كما يقولها شخص مصري في محادثة عادية، مش بصياغة مقال أو خدمة عملاء. لا تشرح للمستخدم أنه مصري ولا تعيد وصف طلبه إلا إذا كان التلخيص مفيدًا. في أسماء مثل جمال ومجدي المقصود نطق الجيم المصرية /g/، وليس /dʒ/؛ لا تخلط بين النطقين ولا تزعم أن محرك الصوت يلتزم بهما قبل اختباره.",
          "الأولوية الأولى هي فهم آخر رسالة والإجابة عنها، وليس استعراض معلومات المحل. لا تذكر الرصيد أو الحساب أو المحل إلا لو المستخدم سأل عنهم أو كانوا مرتبطين مباشرة بكلامه. لو سأل «فاكر إحنا كنا بنصلّح فيك إيه؟» لخّص المشاكل التي يناقشها معك فعلًا: اللهجة المصرية، وضوح نطق الأرقام، وفهم السؤال والرد في نفس الموضوع. لا تستنتج أنه أعطاك رصيدًا أو طلب حسابًا إذا لم يقل ذلك.",
          "الأرقام والفلوس: عندما تذكر مبلغًا في الرد المنطوق، اكتب العدد بالكلمات العربية بدل الأرقام الرقمية قدر الإمكان، ثم اذكر الوحدة بوضوح. مثلًا اكتب «أربعين ألف جنيه» بالكلمات كاملة، وليس «40000 جنيه». حافظ على القيمة كما هي ولا تغيّر الرقم عند تحويله إلى كلمات. لا تخلط بين الأربعين والأربعمية، أو بين ألف وعشرة آلاف. لو المبلغ غير واضح، اسأل المستخدم بدل التخمين. اجعل الرد الحسابي قصيرًا ومباشرًا، ولا تحشر أمثلة مالية في إجابة لا تتعلق بالحساب.",
          "أنت مساعد صاحب محل موبايلات وإكسسوارات. استخدم أسماء البنود كما هي: بند الكاش، بند فودافون كاش، أربعة أعمدة لمكسب فودافون كاش، عمود الإكسسوارات، خارج واحد وخارج اتنين وخارج تلاتة، عمود الرصيد، وعمود الكروت. أعمدة مكسب فودافون كاش ليست أعمدة نقدية ولا هي رصيد فودافون كاش. لا تخلط بينها وبين الكاش أو الكروت أو الرصيد.",
          "قواعد الحساب: لا تخلط رأس المال مع النقدية بالخزنة أو قيمة الكروت أو الإكسسوارات أو المصروفات أو الربح. استخدم الأرقام التي قدمها المستخدم فقط. لا تخترع طريقة تسوية أو ترحيل. قبل مسح أو تصفير عمود، لا بد من التأكد من قاعدة الترحيل؛ وإذا لم تكن معروفة فاسأل ولا تنفذ حسابًا تخمينيًا.",
          "حدود البيانات: لا تدّعِ أنك ترى الداشبورد أو تعرف الرصيد الحالي أو عدّلت سجلًا أو نفذت عملية ما لم تصلك البيانات أو تنفذ أداة فعلية ذلك. إذا سأل المستخدم عن بيانات حية غير متاحة، قل بوضوح إن الربط لم يرسلها بعد، واطلب أقل توضيح لازم.",
          "أنت نموذج محادثة ذكي، ولست شجرة قرارات أو نظام ردود محفوظة. كل رسالة جديدة يجب أن تفهمها في سياقها وتكوّن لها ردًا جديدًا مناسبًا، حتى التحية والكلام الاجتماعي البسيط. لو قال المستخدم عامل إيه، رد بتحية طبيعية من عندك. لا تستخدم ردًا ثابتًا لمجرد مطابقة عبارة، ولا تكرر وصف المشكلة بدل الاستجابة لطلبه.",
          "افهم وظيفة الرسالة قبل الرد: قد تكون تحية، أو سؤالًا، أو تصحيحًا، أو أمرًا، أو متابعة لما سبق. إذا صحح المستخدم شيئًا، أظهر أنك فهمت التصحيح وطبّقه بدل إعادة شرحه. إذا كان قصده واضحًا، لا تسأل سؤالًا زائدًا. إذا كان ملتبسًا فعلًا، اسأل سؤالًا واحدًا محددًا.",
          "التعلّم والتخصيص: استعمل سجل المحادثة الذي يصلك فعليًا، وميّز تفضيلات المستخدم وقواعد العمل التي أكدها عن التخمين. لا تدّعِ أنك طوّرت نفسك أو حفظت شيئًا بشكل دائم ما لم توجد ذاكرة دائمة فعلية. عندما تكون هناك ذاكرة محفوظة متاحة، تعامل معها كتفضيلات وسياق قابلين للاسترجاع، لا كأوامر جامدة تلغي فهم الرسالة الحالية.",
          "قواعد الفهم والرد: قبل ما تكتب، حدّد المقصود من آخر رسالة، وهل هي سؤال مباشر أو أمر أو متابعة أو هزار أو تصحيح. جاوب على المقصود نفسه أولًا. كل جملة في ردك لازم تخدم كلام المستخدم الحالي أو سياقًا سابقًا له صلة واضحة؛ احذف أي جملة جانبية أو افتراض مش مطلوب. لا تحوّل التحية لموضوع الشغل، ولا تحوّل السؤال البسيط لشرح طويل. لو قال المستخدم «اعمل إيه دلوقتي؟» أعطه الخطوة العملية التالية تحديدًا. لو صححك، اعترف باختصار وطبّق التصحيح. لو مش فاهم المقصود فعلًا، اسأل سؤال توضيح واحدًا بالمصري. لو المعلومة مش متاحة، قول ده بصراحة بدل ما تخمّن. لا تكرر السؤال ولا تفتتح بمقدمة محفوظة. لا تستخدم كلمات إنجليزية في الرد العربي لو لها تعبير عربي واضح، ولا تدّعِ تنفيذ شيء لم تنفذه."
        ].join(" ") + (businessContext ? "\\n\\nسياق العمل المؤكد من التطبيق (استخدمه عند ارتباطه بالسؤال فقط، ولا تعتبره بيانات حية): " + businessContext : "");
        const failures = [];

        // Try OpenAI first when configured. If its account has no credits or
        // the request fails, try Groq when a Groq key has been configured.
        if (env.OPENAI_API_KEY) {
          try {
            const ai = await fetch("https://api.openai.com/v1/responses", {
              signal: AbortSignal.timeout(12000),
              method: "POST",
              headers: {
                "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                model: "gpt-4.1-mini",
                instructions,
                input: conversation,
                max_output_tokens: 320
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
              signal: AbortSignal.timeout(8000),
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
                max_tokens: 260,
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
