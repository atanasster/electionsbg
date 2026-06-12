// Наясно cloud functions — two independent endpoints in one codebase:
//
//  - `llm` (deployed to the electionsbg-ai project): the cloud-LLM proxy for
//    the AI chat. The chat is a static SPA, so it cannot hold the OpenRouter
//    API key in the browser; this function holds it (a Firebase secret) and
//    forwards a single chat-completion request. Reached same-origin via the
//    `/api/llm` hosting rewrite on ai.electionsbg.com.
//    Deploy:  firebase deploy --only functions:llm -P ai
//    Secret:  firebase functions:secrets:set OPENROUTER_API_KEY -P ai
//
//  - `scenarios` (deployed to the elections-bg project): the public scenario
//    tally for /budget/simulator ("what the public chose"). Reached
//    same-origin via the `/api/scenarios` rewrite on electionsbg.com; the AI
//    chat origin (ai.electionsbg.com) is CORS-allowlisted for future use.
//    Deploy:  firebase deploy --only functions:scenarios -P default
//
// Cost-abuse guards (both endpoints are public): origin allowlists, strict
// input validation, per-IP rate limits / token caps. For production hardening
// also enable Firebase App Check.

const crypto = require("crypto");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

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

// The llm endpoint is constructed lazily and exported ONLY outside the
// elections-bg project: the deploy CLI resolves the secrets of every
// exported function against the TARGET project, so an unconditional export
// would make `--only functions:scenarios -P default` demand the OpenRouter
// secret in elections-bg, where it deliberately doesn't exist.
const makeLlm = () => {
  // The secret param is declared HERE, not at module top: the deploy CLI
  // resolves every declared secret against the target project, so a
  // top-level defineSecret would break `--only functions:scenarios -P
  // default` (no such secret in elections-bg).
  const OPENROUTER_API_KEY = defineSecret("OPENROUTER_API_KEY");
  return onRequest(
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
};

if ((process.env.GCLOUD_PROJECT || "") !== "elections-bg")
  exports.llm = makeLlm();

// ---------------------------------------------------------------------------
// `scenarios` — the budget simulator's public tally ("what the public chose").
//
// POST /submit  { qs, metrics, lang, mode, goal } — one visitor scenario.
//   `qs` is the simulator's own query string (defaults omitted), validated
//   key-by-key against PARAM_SPEC below; `metrics` are the CLIENT-computed
//   headline numbers (deterministic from qs for honest clients — they are
//   range-clamped and displayed with that caveat, never re-trusted as truth).
// GET  /stats   — cached aggregates for the "Какво избра публиката" card.
//
// Storage (Firestore, elections-bg): raw docs in `scenario_submissions`,
// atomic counters/histograms on `scenario_agg/v1` (every lever value is a
// bounded integer or enum, so the histogram key sets are bounded), per-IP
// daily rate docs in `scenario_rate`. Privacy: no PII — IPs are stored only
// as salted SHA-256 hashes in the rate docs; submissions carry levers and
// derived numbers only.
// ---------------------------------------------------------------------------

const SCENARIO_ALLOWED_ORIGINS = [
  /^https:\/\/electionsbg\.com$/,
  /^https:\/\/www\.electionsbg\.com$/,
  /^https:\/\/elections-bg\.web\.app$/,
  /^https:\/\/elections-bg\.firebaseapp\.com$/,
  /^https:\/\/electionsbg-staging\.web\.app$/,
  /^https:\/\/electionsbg-staging\.firebaseapp\.com$/,
  // The AI chat site (separate origin) is allowlisted from day one so the
  // assistant can read/write the tally without a function change.
  /^https:\/\/ai\.electionsbg\.com$/,
  /^https:\/\/electionsbg-ai\.web\.app$/,
  /^https:\/\/electionsbg-ai\.firebaseapp\.com$/,
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
];

// Pure validation + aggregation helpers (unit-tested in scenarios.test.js).
const {
  RATE_LIMIT_PER_DAY,
  HEADLINE_BUCKET_EUR,
  HEADLINE_BUCKET_MAX,
  IP_SALT,
  parseScenarioQs,
  clampNum,
  histMedian,
  histKey,
} = require("./scenarios_lib");

// firebase-admin is initialized lazily so deploying/analyzing the codebase
// for the other project never touches it.
let scenarioDb = null;
const getDb = () => {
  if (!scenarioDb) {
    // eslint-disable-next-line global-require
    const admin = require("firebase-admin");
    if (!admin.apps.length) admin.initializeApp();
    scenarioDb = admin.firestore();
  }
  return scenarioDb;
};

// Symmetric gate: the tally deploys everywhere EXCEPT the AI project (its
// Firestore lives in elections-bg).
const makeScenarios = () =>
  onRequest({ region: "us-central1", maxInstances: 5 }, async (req, res) => {
    // Same origin-allowlist convention as `llm` above: the hosting rewrite
    // usually drops the Origin header, so a missing origin is allowed and a
    // present foreign origin is rejected.
    const origin = req.headers.origin || "";
    const originOk =
      !origin || SCENARIO_ALLOWED_ORIGINS.some((re) => re.test(origin));
    if (origin && originOk) res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");

    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      res.set("Access-Control-Max-Age", "3600");
      return res.status(204).send("");
    }
    if (!originOk) return res.status(403).json({ error: "forbidden origin" });

    const { FieldValue } = require("firebase-admin/firestore");
    const db = getDb();

    // Route on the final path segment exactly — the function is reached as
    // `/stats` / `/submit` directly and `/api/scenarios/{stats,submit}` via
    // the hosting rewrite, so match the last segment, not a loose suffix.
    const seg = (req.path || "").split("/").filter(Boolean).pop();

    // ---- GET /stats --------------------------------------------------------
    if (req.method === "GET" && seg === "stats") {
      const snap = await db.doc("scenario_agg/v1").get();
      res.set("Cache-Control", "public, max-age=300");
      if (!snap.exists) return res.json({ total: 0 });
      const agg = snap.data();
      const total = agg.total || 0;
      const pct = (n) => (total > 0 ? Math.round((100 * (n || 0)) / total) : 0);
      const topLevers = Object.entries(agg.levers || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([key, count]) => ({
          key,
          count,
          medianValue: histMedian((agg.hist || {})[key]),
        }));
      const medianBucket = histMedian(agg.histHeadline);
      return res.json({
        total,
        pctEdpMet: pct(agg.edpMet),
        pctDebtMet: pct(agg.debtMet),
        pctDefMet: pct(agg.defMet),
        topLevers,
        medianHeadlineEur:
          medianBucket === null ? null : medianBucket * HEADLINE_BUCKET_EUR,
      });
    }

    // ---- POST /submit ------------------------------------------------------
    if (req.method !== "POST" || seg !== "submit")
      return res.status(404).json({ error: "not found" });

    const body = req.body || {};
    const parsed = parseScenarioQs(body.qs);
    if (!parsed) return res.status(400).json({ error: "invalid scenario" });
    if (Object.keys(parsed.levers).length === 0)
      return res.status(400).json({ error: "current-law scenario" });

    const m = body.metrics || {};
    const metrics = {
      headlineEur: clampNum(m.headlineEur, -50e9, 50e9),
      balancePctGdp: clampNum(m.balancePctGdp, -30, 30),
      debtPct2030: clampNum(m.debtPct2030, 0, 200),
      edpMet: m.edpMet === true,
      debtMet: m.debtMet === true,
      defMet: m.defMet === true,
    };
    const lang = body.lang === "en" ? "en" : "bg";
    const mode = body.mode === "static" ? "static" : "dynamic";

    const ip =
      (String(req.headers["x-forwarded-for"] || "").split(",")[0] || "").trim() ||
      req.ip ||
      "unknown";
    const ipHash = crypto
      .createHash("sha256")
      .update(IP_SALT + ip)
      .digest("hex")
      .slice(0, 24);
    const qsHash = crypto
      .createHash("sha256")
      .update(body.qs)
      .digest("hex")
      .slice(0, 16);
    const day = new Date().toISOString().slice(0, 10);

    try {
      const result = await db.runTransaction(async (tx) => {
        const rateRef = db.doc(`scenario_rate/${ipHash}`);
        const rateSnap = await tx.get(rateRef);
        const rate = rateSnap.exists ? rateSnap.data() : {};
        const sameDay = rate.day === day;
        const n = sameDay ? rate.n || 0 : 0;
        const seen = sameDay && Array.isArray(rate.qsHashes) ? rate.qsHashes : [];
        if (seen.includes(qsHash)) return { duplicate: true };
        if (n >= RATE_LIMIT_PER_DAY) return { limited: true };

        tx.set(rateRef, {
          day,
          n: n + 1,
          qsHashes: [...seen.slice(-RATE_LIMIT_PER_DAY + 1), qsHash],
        });
        tx.set(db.collection("scenario_submissions").doc(), {
          qs: body.qs.replace(/^\?/, ""),
          metrics,
          lang,
          mode,
          ts: FieldValue.serverTimestamp(),
          ipHash,
        });

        // Aggregate counters via deep-merged increments. Histogram key sets
        // are kept small by histKey (wide levers bucketed, enum/flag skipped),
        // so the single scenario_agg/v1 doc stays well under Firestore limits.
        const bucket = Math.max(
          -HEADLINE_BUCKET_MAX,
          Math.min(
            HEADLINE_BUCKET_MAX,
            Math.round(metrics.headlineEur / HEADLINE_BUCKET_EUR),
          ),
        );
        const inc = FieldValue.increment(1);
        const agg = {
          total: inc,
          levers: {},
          hist: {},
          histHeadline: { [String(bucket)]: inc },
        };
        if (metrics.edpMet) agg.edpMet = inc;
        if (metrics.debtMet) agg.debtMet = inc;
        if (metrics.defMet) agg.defMet = inc;
        for (const [key, value] of Object.entries(parsed.levers)) {
          agg.levers[key] = inc;
          // Per-lever value histogram only where a numeric median is
          // meaningful; wide-range ints are bucketed, enum/flag levers get
          // none (histKey returns null) — bounds the single hot doc's growth.
          const hk = histKey(key, value);
          if (hk !== null) agg.hist[key] = { [hk]: inc };
        }
        tx.set(db.doc("scenario_agg/v1"), agg, { merge: true });
        return { ok: true };
      });

      if (result.limited)
        return res.status(429).json({ error: "daily limit reached" });
      return res.json({ ok: true, duplicate: result.duplicate === true });
    } catch (e) {
      return res.status(500).json({ error: "storage error", detail: String(e) });
    }
  });

if ((process.env.GCLOUD_PROJECT || "") !== "electionsbg-ai")
  exports.scenarios = makeScenarios();
