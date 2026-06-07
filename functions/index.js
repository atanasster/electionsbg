// Cloud-LLM proxy for the Наясно AI chat.
//
// The chat is a static SPA, so it cannot hold the OpenRouter API key in the
// browser. This HTTPS function holds the key (a Firebase secret) and forwards a
// single chat-completion request to OpenRouter. It is reached same-origin via
// the hosting rewrite `/api/llm` (see firebase.json), so no CORS in prod.
//
// Cost-abuse guards (the endpoint is public): origin allowlist, model
// allowlist, max_tokens cap, message cap, POST-only. For production hardening
// also enable Firebase App Check and set a hard spend cap on the OpenRouter key.
//
// Deploy:  firebase deploy --only functions -P ai
// Secret:  firebase functions:secrets:set OPENROUTER_API_KEY -P ai

const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const OPENROUTER_API_KEY = defineSecret("OPENROUTER_API_KEY");

// Only these (cheap, Bulgarian-capable) models may be requested. Keep in sync
// with the cloud entries in ai/llm/models.ts.
const ALLOWED_MODELS = new Set([
  "google/gemini-3.1-flash-lite",
  "google/gemma-4-31b-it:free",
]);

// Origins allowed to use the proxy (the AI app + local dev).
const ALLOWED_ORIGINS = [
  /^https:\/\/electionsbg-ai\.web\.app$/,
  /^https:\/\/electionsbg-ai\.firebaseapp\.com$/,
  /^https:\/\/ai\.electionsbg\.com$/,
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
];

const MAX_TOKENS = 512; // per-call output cap (routing ~30, narration ~160)
const MAX_MESSAGES = 12;

exports.llm = onRequest(
  { secrets: [OPENROUTER_API_KEY], region: "us-central1", maxInstances: 10 },
  async (req, res) => {
    // Same-origin requests via the hosting rewrite often arrive with NO Origin
    // header (the proxy drops it), so a missing origin is allowed; a PRESENT
    // foreign origin is rejected. (The real anti-abuse is App Check + the model
    // allowlist + the max_tokens cap, not this spoofable header.)
    const origin = req.headers.origin || "";
    const originOk = !origin || ALLOWED_ORIGINS.some((re) => re.test(origin));
    if (origin && originOk) res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");

    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }
    if (req.method !== "POST")
      return res.status(405).json({ error: "POST only" });
    if (!originOk) return res.status(403).json({ error: "forbidden origin" });

    const body = req.body || {};
    if (!ALLOWED_MODELS.has(body.model))
      return res.status(400).json({ error: "model not allowed" });
    if (!Array.isArray(body.messages) || body.messages.length === 0)
      return res.status(400).json({ error: "messages required" });

    // Streaming is opt-in (the narration call) and incompatible with a forced
    // JSON response_format (the routing call), so it's disabled when one is set.
    const stream = body.stream === true && !body.response_format;

    const payload = {
      model: body.model,
      messages: body.messages.slice(0, MAX_MESSAGES),
      temperature: typeof body.temperature === "number" ? body.temperature : 0,
      max_tokens: Math.min(Number(body.max_tokens) || 256, MAX_TOKENS),
    };
    if (body.response_format) payload.response_format = body.response_format;
    if (body.tools) payload.tools = body.tools;
    if (body.tool_choice) payload.tool_choice = body.tool_choice;
    if (stream) {
      payload.stream = true;
      // ask OpenRouter to emit a final usage chunk so token counts survive
      payload.stream_options = { include_usage: true };
    }

    try {
      const upstream = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY.value()}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://electionsbg.com",
            "X-Title": "Naiasno AI",
          },
          body: JSON.stringify(payload),
        },
      );

      // Non-stream (routing, or upstream error before the body): forward JSON.
      if (!stream || !upstream.ok || !upstream.body) {
        const data = await upstream.json();
        return res.status(upstream.status).json(data);
      }

      // Stream: pipe the upstream Server-Sent Events through to the client. The
      // browser provider parses these `data:` lines incrementally.
      res.status(200);
      res.set("Content-Type", "text/event-stream; charset=utf-8");
      res.set("Cache-Control", "no-cache, no-transform");
      res.set("Connection", "keep-alive");
      for await (const chunk of upstream.body) {
        res.write(chunk);
      }
      return res.end();
    } catch (e) {
      if (res.headersSent) return res.end();
      return res
        .status(502)
        .json({ error: "upstream error", detail: String(e) });
    }
  },
);
