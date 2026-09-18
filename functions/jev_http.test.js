// The `systemone` (Jev routing) action on the llm handler. The handler is
// dependency-injected precisely so this boundary is testable without
// credentials — what matters here is that a PAID upstream call cannot happen
// without a claimed reservation, and that the reservation is always settled.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createLlmHandler } = require("./llm_http");
const { JEV_ENDPOINT, JEV_MODEL } = require("./jev_payload");
const { LlmError, POLICY } = require("./llm_security");

const makeRes = () => {
  const res = {
    statusCode: 200,
    body: undefined,
    headers: {},
    set(k, v) {
      if (typeof k === "object") Object.assign(this.headers, k);
      else this.headers[k] = v;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
};

const makeSecurity = (calls) => ({
  async issue() {
    return {};
  },
  async start() {
    return {};
  },
  async claim(...args) {
    calls.push(["claim", ...args]);
  },
  async settle(id, usage) {
    calls.push(["settle", id, usage]);
  },
  async finish() {},
});

const okAnswer = {
  model: "jev-1.13.0",
  answers: { tool: { type: "choice", choice: "turnout", probabilities: {}, confidence: 0.9 } },
  usage: { input_tokens: 1000, output_tokens: 50 },
};

const body = (over = {}) => ({
  action: "systemone",
  sessionToken: "s",
  questionId: "q",
  state: "Каква беше избирателната активност?",
  questions: {
    tool: { type: "choice", instructions: "Which tool?", criteria: { turnout: null, results: null } },
  },
  ...over,
});

const run = async ({
  jevApiKey = "k",
  fetchImpl,
  reqBody = body(),
  security,
  rawBody = Buffer.from("{}"),
} = {}) => {
  const calls = [];
  const handler = createLlmHandler({
    security: security ?? makeSecurity(calls),
    apiKey: "gemini",
    jevApiKey,
    fetchImpl:
      fetchImpl ??
      (async () => ({ ok: true, json: async () => okAnswer })),
    allowedOrigins: [/^https:\/\/electionsbg\.com$/],
  });
  const res = makeRes();
  await handler(
    { method: "POST", headers: {}, ip: "1.2.3.4", body: reqBody, rawBody },
    res,
  );
  return { res, calls };
};

test("routes a valid request and returns the model's typed answers", async () => {
  const { res, calls } = await run();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.answers.tool.choice, "turnout");
  assert.deepEqual(
    calls.map((c) => c[0]),
    ["claim", "settle"],
    "must claim BEFORE the paid call and settle after",
  );
});

test("settles at Jev's own price, not the Gemini formula", async () => {
  const { calls } = await run();
  const settle = calls.find((c) => c[0] === "settle");
  // 1000 input tokens x 0.042 µ$ = 42 µ$; output is free.
  assert.deepEqual(settle[2], { microDollars: 42 });
});

test("keeps the full reservation when usage is unusable", async () => {
  const { calls } = await run({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ ...okAnswer, usage: undefined }),
    }),
  });
  const settle = calls.find((c) => c[0] === "settle");
  // `undefined` makes llm_security's `charged` retain the reservation — an
  // unproven saving is never refunded.
  assert.equal(settle[2], undefined);
});

test("never calls upstream without a configured key, and does not claim", async () => {
  let fetched = false;
  const { res, calls } = await run({
    // `null`, not `undefined`: a destructuring default fires on undefined, so
    // passing undefined here would silently restore the configured key and the
    // test would assert nothing.
    jevApiKey: null,
    fetchImpl: async () => {
      fetched = true;
      return { ok: true, json: async () => okAnswer };
    },
  });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "ai_unavailable");
  assert.equal(fetched, false);
  assert.deepEqual(calls, [], "an unconfigured key must not consume quota");
});

test("maps a validation rejection to its own 400, not a generic 503", async () => {
  const { res, calls } = await run({
    reqBody: body({ questions: { q: { type: "essay", instructions: "i" } } }),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "invalid_question_type");
  assert.deepEqual(calls, [], "a malformed request must not reserve budget");
});

test("settles the reservation when the upstream call fails", async () => {
  const { res, calls } = await run({
    fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }),
  });
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, "model_unavailable");
  assert.deepEqual(
    calls.map((c) => c[0]),
    ["claim", "settle"],
    "a failed call must not leak an inflight reservation",
  );
});

test("rejects a response that carries no answers", async () => {
  const { res } = await run({
    fetchImpl: async () => ({ ok: true, json: async () => ({ model: "x" }) }),
  });
  assert.equal(res.statusCode, 502);
});

test("retries the settle when the settle itself fails — never leaks inflight", async () => {
  let attempts = 0;
  const security = {
    async issue() {
      return {};
    },
    async start() {
      return {};
    },
    async finish() {},
    async claim() {},
    async settle() {
      attempts++;
      throw new Error("firestore unavailable");
    },
  };
  const { res } = await run({ security });
  // settle() is idempotent (`if (!q.inflight) return`), so a transient failure
  // MUST be retried — otherwise `inflight` stays true, finish() 429s for ever
  // and the day/month budget reservation is never refunded. Assert the ATTEMPT
  // COUNT, not the status: the handler returns 503 either way.
  assert.equal(attempts, 2, "a failed settle must be retried, not swallowed");
  assert.equal(res.statusCode, 503);
});

test("sends the pinned payload to the pinned endpoint with the server-held key", async () => {
  let seen;
  await run({
    reqBody: body({
      model: "evil-model",
      questions: { t: { type: "noul", instructions: "i" } },
    }),
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return { ok: true, json: async () => okAnswer };
    },
  });
  assert.equal(seen.url, JEV_ENDPOINT);
  assert.equal(seen.init.headers.Authorization, "Bearer k");
  const sent = JSON.parse(seen.init.body);
  // The client's `model` must never reach the upstream, and neither may the
  // session credentials it sent us. The model pin is only as strong as this
  // wiring: a regression passing the raw `body` to fetch would leave every
  // other test in this file green.
  assert.equal(sent.model, JEV_MODEL);
  assert.equal(sent.sessionToken, undefined);
  assert.equal(sent.questionId, undefined);
  assert.equal(sent.action, undefined);
});

test("a refused reservation never reaches the paid upstream", async () => {
  let fetched = false;
  const security = {
    ...makeSecurity([]),
    async claim() {
      throw new LlmError(429, "call_limit");
    },
  };
  const { res } = await run({
    security,
    fetchImpl: async () => {
      fetched = true;
      return { ok: true, json: async () => okAnswer };
    },
  });
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error, "call_limit");
  assert.equal(fetched, false, "claim must gate the paid call, not follow it");
});

test("projects the upstream response instead of forwarding it verbatim", async () => {
  const { res } = await run({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        ...okAnswer,
        account: { plan: "internal", balanceUsd: 412.5 },
        debug: { requestId: "abc" },
      }),
    }),
  });
  assert.deepEqual(Object.keys(res.body).sort(), ["answers", "model", "usage"]);
  assert.equal(res.body.account, undefined, "upstream account data must not reach a browser");
  assert.equal(res.body.debug, undefined);
});

test("the shared body cap applies to systemone, before any reservation", async () => {
  const { res, calls } = await run({ rawBody: Buffer.alloc(110001) });
  assert.equal(res.statusCode, 413);
  assert.equal(res.body.error, "input_too_large");
  assert.deepEqual(calls, [], "an oversized body must not reserve budget");
});

test("one Jev route plus one completion plus a retry fits the per-question call budget", () => {
  // FINDING-006: both lanes now share POLICY.calls. The plan's §6 AI-lane
  // degradation is "Jev fails -> full Gemini prompt, same turn", which is 2
  // calls; a single retry makes 3. If this ever stops holding, a legitimate
  // turn starts 429ing with `call_limit` — fail here instead, loudly.
  assert.ok(
    POLICY.calls >= 3,
    `POLICY.calls is ${POLICY.calls}: a Jev route + completion + retry no longer fits`,
  );
});

test("still enforces the origin allowlist", async () => {
  const handler = createLlmHandler({
    security: makeSecurity([]),
    apiKey: "gemini",
    jevApiKey: "k",
    fetchImpl: async () => ({ ok: true, json: async () => okAnswer }),
    allowedOrigins: [/^https:\/\/electionsbg\.com$/],
  });
  const res = makeRes();
  await handler(
    {
      method: "POST",
      headers: { origin: "https://evil.example" },
      ip: "1.2.3.4",
      body: body(),
      rawBody: Buffer.from("{}"),
    },
    res,
  );
  assert.equal(res.statusCode, 403);
});

// Every call from a cross-origin page is preceded by a CORS preflight; without
// a cache lifetime Chrome keeps one for 5 s, so nearly every call paid an extra
// round trip to us-central1 — enough, with Jev's own ~1 s, to expire the
// client's routing budget on every live turn (measured 2026-09-18).
test("caches the CORS preflight for an allowed origin", async () => {
  const handler = createLlmHandler({
    security: makeSecurity([]),
    apiKey: "gemini",
    jevApiKey: "k",
    fetchImpl: async () => ({ ok: true, json: async () => okAnswer }),
    allowedOrigins: [/^https:\/\/naiasno\.bg$/],
  });
  const res = makeRes();
  await handler(
    { method: "OPTIONS", headers: { origin: "https://naiasno.bg" }, ip: "1.2.3.4" },
    res,
  );
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["Access-Control-Allow-Origin"], "https://naiasno.bg");
  assert.equal(res.headers["Access-Control-Max-Age"], "600");
});
