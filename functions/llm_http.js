const { payload, LlmError } = require("./llm_security");
// Dependency-injected handler keeps the public security boundary testable without
// credentials. Every completion needs a session AND a reserved question.
function createLlmHandler({
  security,
  apiKey,
  fetchImpl = fetch,
  allowedOrigins,
}) {
  return async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.set("Vary", "Origin");
    const origin = req.headers.origin || "";
    if (origin && !allowedOrigins.some((re) => re.test(origin)))
      return res.status(403).json({ error: "forbidden_origin" });
    if (origin) res.set("Access-Control-Allow-Origin", origin);
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      return res.status(204).send("");
    }
    if (req.method !== "POST")
      return res.status(405).json({ error: "post_only" });
    // req.ip uses the platform's configured proxy trust; never take the first
    // arbitrary client-supplied X-Forwarded-For entry as an identity.
    const ip = req.ip;
    if (!ip) return res.status(503).json({ error: "ai_unavailable" });
    const body = req.body;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      (req.rawBody?.length || Buffer.byteLength(JSON.stringify(body))) > 110000
    )
      return res.status(413).json({ error: "input_too_large" });
    try {
      if (body.action === "session")
        return res.json(await security.issue(body.turnstileToken, ip));
      if (body.action === "start")
        return res.json(await security.start(body.sessionToken, ip));
      if (body.action === "finish") {
        await security.finish(body.sessionToken, ip, body.questionId);
        return res.json({ ok: true });
      }
      if (body.action !== "complete") throw new LlmError(400, "invalid_action");
      const upstreamBody = payload(body);
      await security.claim(body.sessionToken, ip, body.questionId);
      let usage;
      try {
        const response = await fetchImpl(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "X-Title": "Naiasno AI",
            },
            body: JSON.stringify(upstreamBody),
            signal: AbortSignal.timeout(30000),
          },
        );
        if (!response.ok) throw new LlmError(502, "model_unavailable");
        const data = await response.json();
        if (data.error) throw new LlmError(502, "model_unavailable");
        usage = data.usage;
        // Settle before returning; uncertainty keeps the reservation, never
        // refunds a potentially billed request or retries upstream automatically.
        await security.settle(body.questionId, usage);
        return res.json(data);
      } catch (error) {
        await security.settle(body.questionId, usage).catch(() => {});
        throw error;
      }
    } catch (error) {
      if (!(error instanceof LlmError))
        console.error("llm request failed", error?.name || "Error");
      return res.status(error instanceof LlmError ? error.status : 503).json({
        error: error instanceof LlmError ? error.code : "ai_unavailable",
      });
    }
  };
}
module.exports = { createLlmHandler };
