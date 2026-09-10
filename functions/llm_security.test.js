const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createSecurity,
  config,
  payload,
  POLICY,
  MODEL,
  sign,
  verify,
  charged,
} = require("./llm_security");
const { createLlmHandler } = require("./llm_http");
function memoryDb() {
  const rows = new Map();
  let queue = Promise.resolve();
  const ref = (id) => ({ id });
  const snap = (r) => ({
    exists: rows.has(r.id),
    data: () => structuredClone(rows.get(r.id)),
  });
  return {
    rows,
    collection: () => ({ doc: ref }),
    runTransaction(fn) {
      const run = queue.then(async () => {
        const writes = [];
        const tx = {
          get: async (r) => snap(r),
          getAll: async (...rs) => rs.map(snap),
          set: (r, v) => writes.push(() => rows.set(r.id, v)),
          update: (r, v) =>
            writes.push(() => rows.set(r.id, { ...rows.get(r.id), ...v })),
        };
        const result = await fn(tx);
        writes.forEach((f) => f());
        return result;
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}
function fixture(overrides = {}) {
  const db = memoryDb();
  let time = Date.parse("2026-09-10T10:00:00Z");
  let result = {
    success: true,
    hostname: "ai.electionsbg.com",
    action: "ai_chat",
    challenge_ts: new Date(time).toISOString(),
  };
  const options = {
    db,
    secret: "s".repeat(32),
    turnstileSecret: "secret",
    now: () => time,
    policy: config({}),
    fetchImpl: async () => ({ ok: true, json: async () => result }),
    ...overrides,
  };
  return {
    db,
    options,
    security: createSecurity(options),
    advance: (ms) => {
      time += ms;
      result.challenge_ts = new Date(time).toISOString();
    },
    result: (v) => {
      result = v;
    },
  };
}
const code = (expected) => (error) => error.code === expected;
test("validates signatures, expiration and IP binding", () => {
  const s = "x".repeat(32),
    value = { id: "12345678-1234-1234-1234-123456789abc", ip: "ip", exp: 100 };
  const token = sign(s, value);
  assert.equal(verify(s, token, "ip", 99).id, value.id);
  for (const [t, ip, now] of [
    [token + "x", "ip", 99],
    [token, "other", 99],
    [token, "ip", 100],
  ])
    assert.throws(() => verify(s, t, ip, now), code("verification_required"));
});
test("only bounded text for the one model reaches upstream", () => {
  const body = {
    model: MODEL,
    messages: [{ role: "user", content: "hello" }],
    max_tokens: 420,
    stream: true,
  };
  assert.equal(payload(body).stream, false);
  assert.equal(payload(body).model, "gemini-3.5-flash-lite");
  assert.equal(payload(body).reasoning_effort, "minimal");
  assert.equal(payload(body).provider, undefined);
  assert.equal(payload(body).reasoning, undefined);
  for (const change of [
    { model: "expensive" },
    { max_tokens: 513 },
    { max_tokens: NaN },
    { tools: [] },
    { messages: [{ role: "user", content: "x".repeat(96001) }] },
    { messages: [{ role: "user", content: [] }] },
  ])
    assert.throws(() => payload({ ...body, ...change }));
  assert.equal(charged(undefined), POLICY.callReserve);
  assert.equal(charged({ prompt_tokens: 1000, completion_tokens: 100 }), 550);
});
test("fails closed on disabled or missing security configuration", async () => {
  for (const overrides of [
    { secret: "" },
    { turnstileSecret: "" },
    { policy: config({ AI_ENABLED: "false" }) },
  ])
    await assert.rejects(
      fixture(overrides).security.issue("t", "ip"),
      code("ai_unavailable"),
    );
});
test("rejects invalid, wrong-host, wrong-action, old challenges and replay", async () => {
  const f = fixture();
  for (const result of [
    { success: false },
    {
      success: true,
      hostname: "evil",
      action: "ai_chat",
      challenge_ts: "2026-09-10T10:00:00Z",
    },
    {
      success: true,
      hostname: "ai.electionsbg.com",
      action: "other",
      challenge_ts: "2026-09-10T10:00:00Z",
    },
    {
      success: true,
      hostname: "ai.electionsbg.com",
      action: "ai_chat",
      challenge_ts: "2026-09-10T09:00:00Z",
    },
  ]) {
    f.result(result);
    await assert.rejects(
      f.security.issue("token", "ip"),
      code("invalid_verification"),
    );
  }
  const good = fixture();
  await good.security.issue("once", "ip");
  await assert.rejects(
    good.security.issue("once", "ip"),
    code("invalid_verification"),
  );
});
test("shared transactions admit only one active question across instances", async () => {
  const f = fixture(),
    other = createSecurity(f.options);
  const { token } = await f.security.issue("token", "ip");
  const results = await Promise.allSettled([
    f.security.start(token, "ip"),
    other.start(token, "ip"),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    results.find((x) => x.status === "rejected").reason.code,
    "question_busy",
  );
});
test("global budget reservation is atomic across independent sessions", async () => {
  const f = fixture({ policy: config({ AI_DAILY_BUDGET_USD: ".10" }) });
  const a = await f.security.issue("a", "a"),
    b = await f.security.issue("b", "b");
  const r = await Promise.allSettled([
    f.security.start(a.token, "a"),
    f.security.start(b.token, "b"),
  ]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    r.find((x) => x.status === "rejected").reason.code,
    "budget_limit",
  );
});
test("in-flight, replay, call caps, refunds and idempotent finish", async () => {
  const f = fixture(),
    { token } = await f.security.issue("t", "ip");
  const { questionId: id } = await f.security.start(token, "ip");
  await f.security.claim(token, "ip", id);
  await assert.rejects(f.security.claim(token, "ip", id), code("call_limit"));
  await assert.rejects(
    f.security.finish(token, "ip", id),
    code("question_busy"),
  );
  await f.security.settle(id, { prompt_tokens: 1000, completion_tokens: 100 });
  for (let i = 0; i < 2; i++) {
    await f.security.claim(token, "ip", id);
    await f.security.settle(id);
  }
  await assert.rejects(f.security.claim(token, "ip", id), code("call_limit"));
  await f.security.finish(token, "ip", id);
  await f.security.finish(token, "ip", id);
  assert.equal(
    f.db.rows.get("day:2026-09-10").reserved,
    550 + 2 * POLICY.callReserve,
  );
  await assert.rejects(
    f.security.claim(token, "ip", id),
    code("question_expired"),
  );
});
test("abandoned questions retain reservations, expire and cannot start calls", async () => {
  const f = fixture(),
    { token } = await f.security.issue("t", "ip"),
    { questionId: id } = await f.security.start(token, "ip");
  f.advance(POLICY.questionMs + 1);
  await assert.rejects(
    f.security.claim(token, "ip", id),
    code("question_expired"),
  );
  f.advance(POLICY.handlerMs);
  await f.security.start(token, "ip");
  assert.equal(
    f.db.rows.get("day:2026-09-10").reserved,
    2 * POLICY.calls * POLICY.callReserve,
  );
});
test("session daily cap survives completed questions; rolling minute cap works", async () => {
  const f = fixture(),
    { token } = await f.security.issue("t", "ip");
  for (let i = 0; i < 20; i++) {
    if (i === 3)
      await assert.rejects(
        f.security.start(token, "ip"),
        code("question_limit"),
      );
    if (i % 3 === 0 && i) f.advance(60001);
    const { questionId } = await f.security.start(token, "ip");
    await f.security.finish(token, "ip", questionId);
  }
  f.advance(60001);
  await assert.rejects(f.security.start(token, "ip"), code("question_limit"));
});
function response() {
  return {
    statusCode: 200,
    headers: {},
    set(k, v) {
      this.headers[k] = v;
    },
    status(n) {
      this.statusCode = n;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}
test("HTTP direct completion without credentials never reaches paid upstream", async () => {
  const f = fixture();
  let calls = 0;
  const handler = createLlmHandler({
    security: f.security,
    apiKey: "key",
    allowedOrigins: [],
    fetchImpl: async () => {
      calls++;
    },
  });
  const res = response();
  await handler(
    {
      method: "POST",
      headers: {},
      ip: "ip",
      body: {
        action: "complete",
        model: MODEL,
        messages: [{ role: "user", content: "x" }],
      },
    },
    res,
  );
  assert.equal(res.statusCode, 401);
  assert.equal(calls, 0);
  assert.equal(res.headers["Cache-Control"], "no-store");
});
test("HTTP failures settle conservatively and never retry paid upstream", async () => {
  const f = fixture(),
    { token } = await f.security.issue("t", "ip"),
    { questionId } = await f.security.start(token, "ip");
  let calls = 0;
  const handler = createLlmHandler({
    security: f.security,
    apiKey: "key",
    allowedOrigins: [],
    fetchImpl: async () => {
      calls++;
      return { ok: false };
    },
  });
  const res = response();
  await handler(
    {
      method: "POST",
      headers: {},
      ip: "ip",
      body: {
        action: "complete",
        sessionToken: token,
        questionId,
        model: MODEL,
        messages: [{ role: "user", content: "x" }],
      },
    },
    res,
  );
  assert.equal(res.statusCode, 502);
  assert.equal(calls, 1);
  await f.security.finish(token, "ip", questionId);
  assert.equal(f.db.rows.get("day:2026-09-10").reserved, POLICY.callReserve);
});

test("verified completion uses direct Gemini and settles its compatible usage", async () => {
  const f = fixture();
  const { token } = await f.security.issue("t", "ip");
  const { questionId } = await f.security.start(token, "ip");
  const data = {
    choices: [{ message: { content: '{"tool":"turnout","args":{}}' } }],
    usage: { prompt_tokens: 1000, completion_tokens: 100 },
  };
  let calls = 0;
  const handler = createLlmHandler({
    security: f.security,
    apiKey: "gemini-test-key",
    allowedOrigins: [],
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(
        url,
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      );
      assert.equal(options.headers.Authorization, "Bearer gemini-test-key");
      const body = JSON.parse(options.body);
      assert.equal(body.model, "gemini-3.5-flash-lite");
      assert.equal(body.reasoning_effort, "minimal");
      assert.deepEqual(body.response_format, { type: "json_object" });
      assert.equal(body.provider, undefined);
      assert.equal(body.service_tier, undefined);
      return { ok: true, json: async () => data };
    },
  });
  const res = response();
  await handler(
    {
      method: "POST",
      headers: {},
      ip: "ip",
      body: {
        action: "complete",
        sessionToken: token,
        questionId,
        model: MODEL,
        messages: [{ role: "user", content: "Return JSON" }],
        response_format: { type: "json_object" },
        provider: { order: ["other"] },
        service_tier: "priority",
      },
    },
    res,
  );
  assert.deepEqual(res.body, data);
  assert.equal(calls, 1);
  await f.security.finish(token, "ip", questionId);
  assert.equal(f.db.rows.get("day:2026-09-10").reserved, 550);
});

test("last-moment call keeps session locked through handler timeout", async () => {
  const f = fixture(),
    { token } = await f.security.issue("t", "ip"),
    { questionId } = await f.security.start(token, "ip");
  f.advance(POLICY.questionMs - 1);
  await f.security.claim(token, "ip", questionId);
  f.advance(2);
  await assert.rejects(f.security.start(token, "ip"), code("question_busy"));
  await f.security.settle(questionId);
  await f.security.finish(token, "ip", questionId);
  await f.security.start(token, "ip");
});

test("main and staging origins are additive and hostname lookalikes stay rejected", async () => {
  const { AI_HOSTNAMES, AI_ALLOWED_ORIGINS } = require("./llm_origins");
  for (const host of AI_HOSTNAMES) {
    assert.ok(
      AI_ALLOWED_ORIGINS.some((pattern) => pattern.test(`https://${host}`)),
    );
    const f = fixture();
    f.result({
      success: true,
      hostname: host,
      action: "ai_chat",
      challenge_ts: "2026-09-10T10:00:00Z",
    });
    assert.ok((await f.security.issue(`challenge-${host}`, "ip")).token);
  }
  for (const origin of [
    "https://electionsbg.com.evil.test",
    "https://evil-electionsbg.com",
    "http://electionsbg.com",
    "https://random.web.app",
  ])
    assert.equal(
      AI_ALLOWED_ORIGINS.some((pattern) => pattern.test(origin)),
      false,
    );
});

test("renewing sessions does not clear the shared IP day cap", async () => {
  const f = fixture({
    policy: config({
      AI_DAILY_BUDGET_USD: "100",
      AI_MONTHLY_BUDGET_USD: "1000",
    }),
  });
  for (let session = 0; session < 3; session++) {
    const { token } = await f.security.issue(
      `challenge-${session}`,
      "shared-ip",
    );
    for (let i = 0; i < POLICY.sessionDaily; i++) {
      if (i && i % POLICY.perMinute === 0) f.advance(60001);
      const { questionId } = await f.security.start(token, "shared-ip");
      await f.security.finish(token, "shared-ip", questionId);
    }
  }
  const renewed = await f.security.issue("challenge-renewed", "shared-ip");
  await assert.rejects(
    f.security.start(renewed.token, "shared-ip"),
    code("question_limit"),
  );
  const other = await f.security.issue("challenge-other", "other-ip");
  assert.ok((await f.security.start(other.token, "other-ip")).questionId);
  f.advance(24 * 60 * 60 * 1000);
  const nextDay = await f.security.issue("challenge-next-day", "shared-ip");
  assert.ok((await f.security.start(nextDay.token, "shared-ip")).questionId);
});
