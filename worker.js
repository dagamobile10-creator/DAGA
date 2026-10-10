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
        freeChatConfigured: Boolean(env.GROQ_API_KEY)
      });
    }

    if (url.pathname === "/chat" && request.method === "POST") {
      try {
        if (!env.OPENAI_API_KEY) {
          return json({ error: "OPENAI_API_KEY is not configured" }, 503);
        }

        const body = await request.json();
        const userText = String(body?.text || "").trim();
        if (!userText) return json({ error: "text is required" }, 400);

        const ai = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            instructions: "أنت DAGA، مساعد صوتي رجل، وتتكلم باللهجة المصرية العامية الطبيعية فقط. استخدم صيغة المذكر دائمًا عند الإشارة إلى نفسك: أنا جاهز، فاهمك، سامعك، هساعدك. لا تستخدم أبدًا صيغة المؤنث مثل جاهزة أو فاهمة أو مستعدة. كن ودودًا وواضحًا، وأجب مباشرة وباختصار مناسب للصوت. لا تستخدم الفصحى الرسمية ولا تخترع معلومات عن شركة المستخدم.",
            input: userText,
            max_output_tokens: 220
          })
        });

        const data = await ai.json();
        if (!ai.ok) {
          return json({ error: "OpenAI request failed", detail: data?.error?.message || "Unknown API error" }, ai.status);
        }

        const reply = String(
          data.output_text ||
          (data.output || []).flatMap(item => item.content || [])
            .filter(item => item.type === "output_text")
            .map(item => item.text || "")
            .join("\\n") ||
          ""
        ).trim();

        if (!reply) return json({ error: "Empty reply from OpenAI" }, 502);
        return json({ reply });
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
      const text = String(body?.text || "").trim();

      if (!text) {
        return json(
          { error: "text is required" },
          400
        );
      }

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
              stability: 0.40,
              similarity_boost: 0.80,
              style: 0,
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
