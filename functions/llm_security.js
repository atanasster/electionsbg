// All monetary values are integer micro-USD. Reserve the worst case BEFORE a
// question starts; failed/abandoned calls retain their reservation.
const crypto = require("node:crypto");
const MODEL = "google/gemini-3.1-flash-lite";
const POLICY = Object.freeze({
  inputBytes: 96000,
  outputTokens: 512,
  calls: 3,
  callReserve: 31000,
  sessionDaily: 20,
  ipDaily: 60,
  perMinute: 3,
  questionMs: 120000,
  handlerMs: 60000,
  sessionMs: 3600000,
});
class LlmError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code) => {
  throw new LlmError(status, code);
};
function config(env = process.env) {
  const dollars = (name, fallback) => {
    const v = Number(env[name] ?? fallback);
    if (!Number.isFinite(v) || v <= 0 || v > 10000) fail(503, "ai_unavailable");
    return Math.floor(v * 1e6);
  };
  return {
    daily: dollars("AI_DAILY_BUDGET_USD", 5),
    monthly: dollars("AI_MONTHLY_BUDGET_USD", 50),
    hosts: (
      env.AI_TURNSTILE_HOSTNAMES ||
      "ai.electionsbg.com,electionsbg-ai.web.app,electionsbg-ai.firebaseapp.com"
    )
      .split(",")
      .map((s) => s.trim()),
    enabled: env.AI_ENABLED !== "false",
  };
}
const hash = (secret, value) =>
  crypto.createHmac("sha256", secret).update(value).digest("hex");
const sign = (secret, value) => {
  const data = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${data}.${hash(secret, data)}`;
};
function verify(secret, token, ip, now) {
  if (typeof token !== "string" || token.length > 1024)
    fail(401, "verification_required");
  const [data, signature, extra] = token.split(".");
  if (extra || !data || !/^[a-f0-9]{64}$/.test(signature || ""))
    fail(401, "verification_required");
  if (
    !crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(hash(secret, data)),
    )
  )
    fail(401, "verification_required");
  let value;
  try {
    value = JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    fail(401, "verification_required");
  }
  if (
    !value ||
    !/^[a-f0-9-]{36}$/.test(value.id) ||
    value.ip !== ip ||
    !Number.isFinite(value.exp) ||
    value.exp <= now
  )
    fail(401, "verification_required");
  return value;
}
function payload(body) {
  if (!body || body.model !== MODEL) fail(400, "model_not_allowed");
  if (
    !Array.isArray(body.messages) ||
    !body.messages.length ||
    body.messages.length > 12
  )
    fail(400, "invalid_messages");
  if (
    body.messages.some(
      (m) =>
        !m ||
        !["user", "system", "assistant"].includes(m.role) ||
        typeof m.content !== "string",
    )
  )
    fail(400, "invalid_messages");
  if (
    body.tools ||
    body.tool_choice ||
    (body.response_format && body.response_format.type !== "json_object")
  )
    fail(400, "invalid_options");
  const messages = body.messages.map(({ role, content }) => ({
    role,
    content,
  }));
  if (Buffer.byteLength(JSON.stringify(messages)) > POLICY.inputBytes)
    fail(413, "input_too_large");
  const max = body.max_tokens ?? 256;
  if (!Number.isInteger(max) || max < 1 || max > POLICY.outputTokens)
    fail(400, "invalid_output_limit");
  const temp = body.temperature ?? 0;
  if (!Number.isFinite(temp) || temp < 0 || temp > 1)
    fail(400, "invalid_temperature");
  return {
    model: MODEL,
    messages,
    temperature: temp,
    max_tokens: max,
    ...(body.response_format
      ? { response_format: { type: "json_object" } }
      : {}),
    // No paid plugins, fallback models, or unrestricted provider pricing.
    provider: {
      max_price: { prompt: 0.3, completion: 2.5 },
      allow_fallbacks: false,
    },
    reasoning: { effort: "minimal" },
    stream: false,
  };
}
// Successful usage refunds only a proven saving; missing/invalid usage retains
// the full reservation. 1 UTF-8 byte/token plus framing bounds input conservatively.
function charged(usage) {
  if (
    !usage ||
    !Number.isInteger(usage.prompt_tokens) ||
    usage.prompt_tokens < 0 ||
    !Number.isInteger(usage.completion_tokens) ||
    usage.completion_tokens < 0
  )
    return POLICY.callReserve;
  return Math.min(
    POLICY.callReserve,
    Math.ceil(usage.prompt_tokens * 0.3 + usage.completion_tokens * 2.5),
  );
}
function createSecurity({
  db,
  secret,
  turnstileSecret,
  fetchImpl = fetch,
  now = Date.now,
  policy = config(),
}) {
  const collection = db.collection("ai_usage");
  const ref = (id) => collection.doc(id);
  const requireConfig = () => {
    if (!policy.enabled || !secret || secret.length < 32 || !turnstileSecret)
      fail(503, "ai_unavailable");
  };
  const ipKey = (ip) => hash(secret, `ai-ip:${ip}`);
  const session = (token, ip) => {
    requireConfig();
    return verify(secret, token, ipKey(ip), now());
  };
  async function issue(token, ip) {
    requireConfig();
    if (typeof token !== "string" || !token || token.length > 2048)
      fail(400, "invalid_verification");
    const time = now(),
      key = ipKey(ip),
      day = new Date(time).toISOString().slice(0, 10);
    // Bound Siteverify traffic even for invalid challenge tokens.
    await db.runTransaction(async (tx) => {
      const r = ref(`issue:${key}:${day}`),
        snap = await tx.get(r),
        old = snap.data() || {};
      const times = (old.times || []).filter((t) => t > time - 60000);
      if ((old.count || 0) >= 30 || times.length >= 5)
        fail(429, "session_limit");
      tx.set(r, {
        count: (old.count || 0) + 1,
        times: [...times, time],
        expiresAt: new Date(time + 2 * 86400000),
      });
    });
    let result;
    try {
      const response = await fetchImpl(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret: turnstileSecret,
            response: token,
            remoteip: ip,
          }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) fail(503, "verification_unavailable");
      result = await response.json();
    } catch {
      fail(503, "verification_unavailable");
    }
    const age = time - Date.parse(result.challenge_ts);
    if (
      !result.success ||
      !policy.hosts.includes(result.hostname) ||
      result.action !== "ai_chat" ||
      !Number.isFinite(age) ||
      age < -30000 ||
      age > 300000
    )
      fail(403, "invalid_verification");
    const value = {
      id: crypto.randomUUID(),
      ip: key,
      exp: time + POLICY.sessionMs,
    };
    // Explicit replay guard also covers ambiguous Siteverify responses/retries.
    await db.runTransaction(async (tx) => {
      const r = ref(`token:${hash(secret, token)}`);
      if ((await tx.get(r)).exists) fail(403, "invalid_verification");
      tx.set(r, { expiresAt: new Date(time + 600000) });
      tx.set(ref(`session:${value.id}`), {
        exp: value.exp,
        active: null,
        expiresAt: new Date(value.exp + 86400000),
      });
    });
    return { token: sign(secret, value), expiresAt: value.exp };
  }
  async function start(token, ip) {
    const s = session(token, ip),
      time = now(),
      date = new Date(time).toISOString();
    const day = date.slice(0, 10),
      month = date.slice(0, 7),
      id = crypto.randomUUID();
    const keys = [
      `session:${s.id}`,
      `session-day:${s.id}:${day}`,
      `ip:${s.ip}:${day}`,
      `day:${day}`,
      `month:${month}`,
    ];
    await db.runTransaction(async (tx) => {
      const snaps = await tx.getAll(...keys.map(ref));
      const [state, daily, ipDay, budgetDay, budgetMonth] = snaps.map(
        (x) => x.data() || {},
      );
      if (!snaps[0].exists) fail(401, "verification_required");
      if (state.active && state.activeUntil > time) fail(429, "question_busy");
      const times = (daily.times || []).filter((t) => t > time - 60000);
      if (
        (daily.count || 0) >= POLICY.sessionDaily ||
        (ipDay.count || 0) >= POLICY.ipDaily ||
        times.length >= POLICY.perMinute
      )
        fail(429, "question_limit");
      const reservation = POLICY.calls * POLICY.callReserve;
      if (
        (budgetDay.reserved || 0) + reservation > policy.daily ||
        (budgetMonth.reserved || 0) + reservation > policy.monthly
      )
        fail(429, "budget_limit");
      const expiresAt = new Date(time + 40 * 86400000);
      tx.set(ref(keys[0]), {
        ...state,
        active: id,
        activeUntil: time + POLICY.questionMs + POLICY.handlerMs,
      });
      tx.set(ref(keys[1]), {
        count: (daily.count || 0) + 1,
        times: [...times, time],
        expiresAt,
      });
      tx.set(ref(keys[2]), { count: (ipDay.count || 0) + 1, expiresAt });
      tx.set(ref(keys[3]), {
        reserved: (budgetDay.reserved || 0) + reservation,
        expiresAt,
      });
      tx.set(ref(keys[4]), {
        reserved: (budgetMonth.reserved || 0) + reservation,
        expiresAt,
      });
      tx.set(ref(`question:${id}`), {
        session: s.id,
        deadline: time + POLICY.questionMs,
        calls: 0,
        spent: 0,
        inflight: false,
        closed: false,
        budgetKeys: keys.slice(3),
        expiresAt,
      });
    });
    return { questionId: id };
  }
  const questionRef = (id) => {
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
      fail(400, "invalid_question");
    return ref(`question:${id}`);
  };
  async function claim(token, ip, id) {
    const s = session(token, ip),
      r = questionRef(id);
    await db.runTransaction(async (tx) => {
      const q = (await tx.get(r)).data();
      if (!q || q.session !== s.id || q.closed || q.deadline <= now())
        fail(403, "question_expired");
      if (q.inflight || q.calls >= POLICY.calls) fail(429, "call_limit");
      tx.update(r, {
        calls: q.calls + 1,
        spent: q.spent + POLICY.callReserve,
        inflight: true,
      });
    });
  }
  async function settle(id, usage) {
    const r = questionRef(id);
    await db.runTransaction(async (tx) => {
      const q = (await tx.get(r)).data();
      if (!q || !q.inflight) return;
      tx.update(r, {
        spent: q.spent - POLICY.callReserve + charged(usage),
        inflight: false,
      });
    });
  }
  async function finish(token, ip, id) {
    const s = session(token, ip),
      r = questionRef(id);
    await db.runTransaction(async (tx) => {
      const q = (await tx.get(r)).data();
      if (!q || q.session !== s.id) fail(403, "invalid_question");
      if (q.closed) return;
      if (q.inflight) fail(429, "question_busy");
      const refs = [ref(`session:${s.id}`), ...q.budgetKeys.map(ref)];
      const [state, ...budgets] = (await tx.getAll(...refs)).map((x) =>
        x.data(),
      );
      const refund = POLICY.calls * POLICY.callReserve - q.spent;
      budgets.forEach((b, i) => {
        if (!b || b.reserved < refund) fail(503, "budget_state_error");
        tx.update(refs[i + 1], { reserved: b.reserved - refund });
      });
      if (state?.active === id)
        tx.update(refs[0], { active: null, activeUntil: 0 });
      tx.update(r, { closed: true });
    });
  }
  return { issue, start, claim, settle, finish };
}
module.exports = {
  MODEL,
  POLICY,
  LlmError,
  config,
  sign,
  verify,
  payload,
  charged,
  createSecurity,
};
