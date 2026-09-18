const { payload, LlmError } = require("./llm_security");
const {
  JEV_ENDPOINT,
  JevError,
  jevPayload,
  jevCharged,
} = require("./jev_payload");
// Dependency-injected handler keeps the public security boundary testable without
// credentials. Every completion needs a session AND a reserved question.
//
// `jevApiKey` is optional: without it the `systemone` action reports
// `ai_unavailable` and the chat's Jev lane degrades to its own fallback (the
// deterministic router in the No-LLM lane, the full Gemini prompt in the AI
// lane). An unconfigured key must never take the chat down.
// The reservation protocol lives HERE and nowhere else: every paid lane claims
// before its upstream call and settles on EVERY exit path — including one where
// settle itself threw. `settle()` is idempotent (`if (!q.inflight) return`), so
// the catch may always retry it; guarding that retry with a "already settled"
// flag turns a transient Firestore failure into a PERMANENT inflight leak
// (claim 429s for ever, finish() can never close the question, and its
// day/month budget reservation is never refunded).
//
// `run()` returns { body, cost }: `body` is what the client gets, `cost` is the
// proven settlement (or undefined to keep the full reservation).
async function withReservation(security, { sessionToken, ip, questionId }, run) {
  await security.claim(sessionToken, ip, questionId);
  let cost;
  try {
    const result = await run();
    cost = result.cost;
    await security.settle(questionId, cost);
    return result.body;
  } catch (error) {
    await security.settle(questionId, cost).catch(() => {});
    throw error;
  }
}

function createLlmHandler({
  security,
  apiKey,
  jevApiKey,
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
      // Cache the preflight. Without it Chrome keeps one for 5 s, so nearly
      // every call from a cross-origin page paid an extra round trip to
      // us-central1 before its POST. (naiasno.bg now calls same-origin and
      // sends no preflight at all; this covers every other caller.)
      res.set("Access-Control-Max-Age", "600");
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
      // Jev routing: a constrained, non-generative classification call. It
      // claims + settles against the SAME question reservation as a completion,
      // so a turn cannot spend unbounded money by routing repeatedly, and the
      // per-question `calls` cap covers both paths together.
      if (body.action === "systemone") {
        if (!jevApiKey) throw new LlmError(503, "ai_unavailable");
        const upstream = jevPayload(body);
        const projected = await withReservation(security, { sessionToken: body.sessionToken, ip, questionId: body.questionId }, async () => {
          const response = await fetchImpl(JEV_ENDPOINT, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${jevApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(upstream),
            // ⚠️ COUPLED TO THE CLIENT'S OWN BUDGET (JEV_TIMEOUT_MS, 2500 ms,
            // ai/llm/jevClient.ts), and it must stay well BELOW it. This handler
            // holds the question's reservation (`inflight`) until it returns;
            // once the client stops waiting it falls through to its lane's
            // fallback, which claims THE SAME question — so if we were still
            // holding it, that fallback would 429 with `call_limit`, turning the
            // slow-Jev case into a hard failure in exactly the degraded scenario
            // the ladder exists to absorb. So we give up first, and the gap
            // covers the Firestore claim/settle plus the browser's round trip.
            // Change one, change the other.
            signal: AbortSignal.timeout(1500),
          });
          if (!response.ok) throw new LlmError(502, "model_unavailable");
          const data = await response.json();
          if (!data || typeof data !== "object" || !data.answers)
            throw new LlmError(502, "model_unavailable");
          // A proven cost refunds the difference; unparseable usage keeps the
          // full reservation (never refund a saving we cannot prove).
          const charged = jevCharged(data.usage);
          return {
            // Project rather than forward: the upstream is free to add account,
            // quota or diagnostic fields in a future release and none of them
            // belong in a browser. `usage` is included deliberately — the chat
            // reports routing tokens in its "how this was produced" band.
            body: { answers: data.answers, model: data.model, usage: data.usage },
            cost: charged == null ? undefined : { microDollars: charged },
          };
        });
        return res.json(projected);
      }
      if (body.action !== "complete") throw new LlmError(400, "invalid_action");
      const upstreamBody = payload(body);
      // Same reservation protocol as the Jev lane above — claim, settle on every
      // exit path. Uncertainty keeps the reservation: never refund a potentially
      // billed request, and never retry upstream automatically.
      const completion = await withReservation(security, { sessionToken: body.sessionToken, ip, questionId: body.questionId }, async () => {
        const response = await fetchImpl(
          "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(upstreamBody),
            signal: AbortSignal.timeout(30000),
          },
        );
        if (!response.ok) throw new LlmError(502, "model_unavailable");
        const data = await response.json();
        if (data.error) throw new LlmError(502, "model_unavailable");
        return { body: data, cost: data.usage };
      });
      return res.json(completion);
    } catch (error) {
      // JevError carries the same {status, code} contract as LlmError but is a
      // distinct class (its module has no dependency on llm_security), so a
      // validation rejection from the Jev path must map to its own status
      // rather than falling through to a generic 503.
      const known = error instanceof LlmError || error instanceof JevError;
      if (!known) console.error("llm request failed", error?.name || "Error");
      return res.status(known ? error.status : 503).json({
        error: known ? error.code : "ai_unavailable",
      });
    }
  };
}
module.exports = { createLlmHandler };
