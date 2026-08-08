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
const { runDbTable, runDbFacets } = require("./db_table.js");
const { sendJson } = require("./send_json.js");
const { handleOfficialsRequest } = require("./officials_redirect.js");
const {
  handlePersonRequest,
  RETIRED_TARGET_SQL,
} = require("./person_redirect.js");
const {
  handleSpaPageRequest,
  contractPage,
  companyPage,
  interregPage,
  FALLBACK_SHELL,
} = require("./spa_page.js");

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
      temperature:
        typeof body.temperature === "number"
          ? Math.min(Math.max(0, body.temperature), 2)
          : 0,
      max_tokens: Math.min(
        Math.max(1, Number(body.max_tokens) || 256),
        MAX_TOKENS,
      ),
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
      // Log server-side only — never surface internal error text to clients
      // (same policy as the db route's catch below).
      console.error("scenario submit error", e);
      return res.status(500).json({ error: "storage error" });
    }
  });

if ((process.env.GCLOUD_PROJECT || "") !== "electionsbg-ai")
  exports.scenarios = makeScenarios();

// ---- db: Postgres-backed person / company / search API (elections-bg) --------
// Serves the same JSON the dev Vite plugin (/api/db/*) serves, so the person
// (/person/:name) and company (/db/company/:eik) pages — and the search/recent
// builders — work in production, not just dev. Reached same-origin via the
// `/api/db/**` hosting rewrite. Region europe-west3 (colocated with Cloud SQL,
// closest to BG). Connects to Cloud SQL over the Node connector (public IP + TLS,
// no proxy sidecar). Secret: ELECTIONSBG_DB_PASSWORD. The heavy lifting is in the
// PG functions (search_all / person_roles / company_officers / ...).
const DB_ALLOWED_ORIGINS = [
  /^https:\/\/elections-bg\.web\.app$/,
  /^https:\/\/elections-bg\.firebaseapp\.com$/,
  /^https:\/\/electionsbg\.com$/,
  /^https:\/\/www\.electionsbg\.com$/,
  /^https:\/\/naiasno\.bg$/,
  /^https:\/\/www\.naiasno\.bg$/,
  // Standalone AI app (electionsbg-ai project) — no db function of its own, so
  // it calls this one cross-origin (VITE_DB_API_ORIGIN in ai/tools/dataClient).
  /^https:\/\/ai\.electionsbg\.com$/,
  /^https:\/\/electionsbg-ai\.web\.app$/,
  /^https:\/\/electionsbg-ai\.firebaseapp\.com$/,
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
];

let dbPool = null;
const getDbPool = async (password) => {
  if (dbPool) return dbPool;
  // eslint-disable-next-line global-require
  const { Connector } = require("@google-cloud/cloud-sql-connector");
  // eslint-disable-next-line global-require
  const { Pool } = require("pg");
  const connector = new Connector();
  const clientOpts = await connector.getOptions({
    instanceConnectionName: "elections-bg:europe-west3:electionsbg-pg",
    ipType: "PUBLIC",
  });
  // Connect as the least-privilege read-only role (see roles_readonly.sql) —
  // it can only SELECT + EXECUTE in `public`, so a public SQL console can never
  // write, regardless of the read-only-tx guard.
  dbPool = new Pool({
    ...clientOpts,
    user: "app_readonly",
    password,
    database: "electionsbg",
    max: 4,
    // Server-side kill switch: no /api/db query may hold a connection longer
    // than this (the /api/sql console has its own 8s cap in sql_lib.js).
    statement_timeout: 10000,
    // And no query may spend that budget WAITING for a lock. A loader taking an
    // AccessExclusiveLock — the plain REFRESH a matview gets when it is rebuilt
    // from scratch — otherwise queues every reader behind it, each burning the
    // full 10s above before failing. That turns a routine reload into a wave of
    // 500s, and on the settlement route it would defeat the precompute's own
    // fallback: the fallback only helps if the failed probe returns FAST enough
    // to leave budget for the live query behind it.
    lock_timeout: 2000,
  });
  return dbPool;
};

// Shared route table (functions/db_routes.js) — also mounted by the Vite dev
// plugin (vite/db-api.ts), so dev == prod by construction.
const { DB_ROUTES } = require("./db_routes.js");

// In-memory sliding-window rate limit per instance (same approach as /api/sql
// below, which has a stricter 40/min). Generous: a busy page fires ~1-3 calls,
// type-ahead search is debounced client-side.
const DB_RATE_WINDOW_MS = 60 * 1000;
const DB_RATE_MAX = 120; // requests per IP per minute
const dbHits = new Map();
const dbRateLimited = (ip) => {
  const now = Date.now();
  const arr = (dbHits.get(ip) || []).filter((t) => now - t < DB_RATE_WINDOW_MS);
  if (arr.length >= DB_RATE_MAX) {
    dbHits.set(ip, arr);
    return true;
  }
  arr.push(now);
  dbHits.set(ip, arr);
  if (dbHits.size > 5000)
    for (const [k, v] of dbHits)
      if (!v.some((t) => now - t < DB_RATE_WINDOW_MS)) dbHits.delete(k);
  return false;
};

// The SPA shell, fetched once per instance from hosting and reused.
//
// The function has no dist/, and the shell's <script> tags carry content-hashed
// filenames that change every build — so baking a copy in would couple
// `deploy:db` to `npm run build` and go stale silently the first time someone
// forgot. Fetching whatever hosting is actually serving cannot drift. One
// request per cold instance; a failure degrades to a bundle-less page rather
// than a 500 (see spa_page.js).
// The TTL is load-bearing, not a micro-optimisation. `npm run deploy` ships
// HOSTING ONLY and does not restart this function, so aever-lived cache would keep
// a `minInstances: 1` prod container serving a shell whose
// /assets/index-<hash>.js no longer exists — a blank page on every contract and
// company URL until the next unrelated `deploy:db`. Ten minutes bounds that to
// one deploy's worth of stale hashes and costs one extra request per instance
// per ten minutes.
const SPA_SHELL_TTL_MS = 10 * 60 * 1000;
let spaShellCache = null;
let spaShellCachedAt = 0;
const loadSpaShell = async () => {
  if (spaShellCache && Date.now() - spaShellCachedAt < SPA_SHELL_TTL_MS)
    return spaShellCache;
  const r = await fetch("https://electionsbg.com/", {
    headers: { "User-Agent": "naiasno-spa-shell" },
    // Never let a CDN hand us the very stale copy the TTL exists to escape.
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`shell fetch ${r.status}`);
  const text = await r.text();
  // Keep serving the last good shell if hosting starts returning something
  // unusable, rather than replacing it with a page we cannot render into.
  if (!text.includes("<!-- SEO -->") || !text.includes("<!-- BODY -->")) {
    if (spaShellCache) return spaShellCache;
    throw new Error("shell has no marker blocks");
  }
  spaShellCache = text;
  spaShellCachedAt = Date.now();
  return spaShellCache;
};

/** One indexed lookup: the officials slug -> the /person slug that replaced it, or null.
 *  Shared shape with vite/db-api.ts's dev stand-in so the two cannot answer differently. */
const resolveOfficialsTarget = async (pool, slug) => {
  const { rows } = await pool.query(
    "SELECT officials_person_slug($1) AS slug",
    [slug],
  );
  return (rows[0] && rows[0].slug) || null;
};

/** One indexed lookup: a RETIRED person slug -> the slug that replaced it, or null.
 *  Plain SQL rather than a serving function on purpose — person_slug_retired is a two-column
 *  table with a PK, and a new SQL function would need its own "applied, never loaded" step on
 *  Cloud SQL (CLAUDE.md) for no gain. Shared with vite/db-api.ts via RETIRED_TARGET_SQL so the
 *  dev server and the Cloud Function cannot answer differently. */
const resolveRetiredPersonTarget = async (pool, slug) => {
  const { rows } = await pool.query(RETIRED_TARGET_SQL, [slug]);
  return (rows[0] && rows[0].slug) || null;
};

const makeDb = () => {
  const DB_PASSWORD = defineSecret("ELECTIONSBG_DB_READONLY_PASSWORD");
  return onRequest(
    // minInstances: 1 (PROD ONLY) keeps one container + its pooled DB connection
    // warm, so "first run" of a /api/db page skips the cold container boot +
    // Cloud SQL connector handshake (the most-perceptible slice of first-load
    // latency). Staging / ai stay at 0 — no always-on bill for non-prod.
    {
      secrets: [DB_PASSWORD],
      region: "europe-west3",
      minInstances:
        (process.env.GCLOUD_PROJECT || "") === "elections-bg" ? 1 : 0,
      maxInstances: 10,
    },
    async (req, res) => {
      // ---- /officials/<slug> -> /person/<slug>, 301 -------------------------------
      //
      // FIRST, ahead of every gate below, because this is a PAGE URL and those gates are
      // written for an XHR API. Each of them is wrong for a browser navigation:
      //   * the origin allowlist 403s any request carrying a foreign `Origin` (including
      //     `Origin: null`, which a redirect from a sandboxed context sends);
      //   * `GET only` 405s HEAD, which is what a link checker and half the crawlers use;
      //   * the 120/min per-IP limit 429s a crawler sweeping 20.9k retired URLs — and a
      //     429 instead of a 301 keeps the OLD url in the index, which is the one outcome
      //     this feature exists to prevent.
      // The lookup itself is one indexed SELECT (1.5 ms) and maxInstances bounds the rest.
      //
      // This function serves the redirect because a firebase.json rule cannot: the two
      // slug spaces do not map (106's header has the measurements), and enumerating the
      // ~20.9k pairs is 20× Firebase's per-site redirect limit.
      //
      // NOT REACHABLE IN PRODUCTION YET — there is deliberately no `/officials/*` hosting
      // rewrite. It lands in the same commit that deletes OfficialProfileScreen and swaps
      // the prerender group, because only 5,000 of the 20,887 officials slugs are
      // prerendered (OFFICIALS_STATIC_PAGE_LIMIT): adding the rewrite now would flip the
      // other 15,887 to a live 301 while the officials page is still shipping, so the same
      // URL would render one thing on an in-app click and another on a hard reload. Until
      // then this branch is exercised by the dev server (vite/db-api.ts) and the tests.
      try {
        const pool = () => getDbPool(DB_PASSWORD.value());
        const handled = await handleOfficialsRequest(req, res, async (slug) =>
          resolveOfficialsTarget(await pool(), slug),
        );
        if (handled) return;
      } catch (e) {
        console.error("officials redirect error", e);
        return res.status(500).type("text/plain").send("redirect error");
      }

      // ---- /person/<retired-slug> -> /person/<current-slug>, 301 -------------------
      //
      // Ahead of the API gates for exactly the reasons the officials block lists: these
      // are PAGE urls, and the origin allowlist / GET-only / per-IP limit are all wrong
      // for a browser navigation — and a 429 instead of a 301 to a crawler sweeping the
      // 23,916 retired URLs would keep every one of them in the index.
      //
      // Unlike officials this branch owns EVERY /person url the rewrite reaches, because
      // nothing downstream can serve one. Non-retired slugs get the SPA shell, which is
      // what hosting returned for them before the rewrite existed.
      try {
        const handled = await handlePersonRequest(req, res, {
          resolve: async (slug) =>
            resolveRetiredPersonTarget(
              await getDbPool(DB_PASSWORD.value()),
              slug,
            ),
          // The shell fetch is the one dependency that can fail on a healthy database, and
          // a person URL that already works must not start 500ing because of it. Degrade
          // to the static fallback shell: the SPA still boots and renders the profile.
          loadShell: () => loadSpaShell().catch(() => FALLBACK_SHELL),
        });
        if (handled) return;
      } catch (e) {
        // A DB failure means we cannot tell "retired" from "current". Serving the shell is
        // the safe answer — a current slug renders normally, and a retired one is no worse
        // off than it was before this branch existed. A 500 would break both.
        console.error("person redirect error", e);
        if (!res.headersSent) {
          return res
            .status(200)
            .type("text/html; charset=utf-8")
            .send(await loadSpaShell().catch(() => FALLBACK_SHELL));
        }
        return;
      }

      // ---- /funds/contract/<n> and /company/<eik>: server-rendered head + body -----
      //
      // Ahead of the API gates for the same reason as the /officials 301 above:
      // these are PAGE urls, and an origin allowlist / GET-only / per-IP limit
      // written for an XHR API is wrong for a browser navigation and worse for
      // a crawler. Returns false for anything it does not own, so the request
      // falls through untouched.
      try {
        const handled = await handleSpaPageRequest(req, res, {
          loadShell: () => loadSpaShell(),
          loadContract: async (key, lang, selfUrl) => {
            const p = await getDbPool(DB_PASSWORD.value());
            const { rows } = await p.query(
              "SELECT fund_contract_detail($1) AS r",
              [key],
            );
            return rows[0]?.r ? contractPage(rows[0].r, lang, selfUrl) : null;
          },
          loadInterreg: async (keepId, lang, selfUrl) => {
            const p = await getDbPool(DB_PASSWORD.value());
            const { rows } = await p.query(
              "SELECT interreg_operation($1) AS r",
              [Number(keepId)],
            );
            return rows[0]?.r ? interregPage(rows[0].r, lang, selfUrl) : null;
          },
          loadCompany: async (eik, lang, selfUrl) => {
            const p = await getDbPool(DB_PASSWORD.value());
            const [co, money] = await Promise.all([
              p.query(
                "SELECT uic, name, legal_form, seat, status FROM tr_companies WHERE uic = $1",
                [eik],
              ),
              p.query(
                `SELECT (SELECT count(*)::int FROM contracts WHERE contractor_eik = $1) AS contracts,
                        (SELECT coalesce(sum(amount_eur) FILTER (WHERE tag = 'contract'), 0)
                           FROM contracts WHERE contractor_eik = $1) AS contracts_eur,
                        (SELECT coalesce(sum(total_eur), 0) FROM fund_projects
                          WHERE beneficiary_eik = $1) AS funds_eur`,
                [eik],
              ),
            ]);
            if (!co.rows[0]) return null;
            const m = money.rows[0] || {};
            return companyPage(
              co.rows[0],
              {
                contracts: Number(m.contracts) || 0,
                contractsEur: Number(m.contracts_eur) || 0,
                fundsEur: Number(m.funds_eur) || 0,
              },
              lang,
              selfUrl,
            );
          },
        });
        if (handled) return;
      } catch (e) {
        console.error("spa page error", e);
        // Never 500 a page URL over a head-injection failure — falling through
        // serves the SPA, which is exactly today's behaviour.
      }

      // ---- /api/db/<route> ---------------------------------------------------------
      const origin = req.headers.origin || "";
      const originOk =
        !origin || DB_ALLOWED_ORIGINS.some((re) => re.test(origin));
      if (origin && originOk) res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
      if (req.method === "OPTIONS") {
        res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.set("Access-Control-Allow-Headers", "Content-Type");
        res.set("Access-Control-Max-Age", "3600");
        return res.status(204).send("");
      }
      if (!originOk) return res.status(403).json({ error: "forbidden origin" });
      if (req.method !== "GET")
        return res.status(405).json({ error: "GET only" });

      const ip =
        String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
        req.ip ||
        "?";
      if (dbRateLimited(ip))
        return res
          .status(429)
          .json({ error: "rate limit — too many requests, try again shortly" });

      // Reached as `/api/db/{route}` via the rewrite — match the last segment.
      const seg = (req.path || "").split("/").filter(Boolean).pop();
      const route = DB_ROUTES[seg];
      if (!route) return res.status(404).json({ error: "unknown db route" });
      try {
        const pool = await getDbPool(DB_PASSWORD.value());
        const dbRows = (sql, params) =>
          pool.query(sql, params).then((r) => r.rows);
        // Pin multi-statement engines (the table engine's rows + aggregate) to
        // ONE READ ONLY-transaction snapshot, so a page and its totals can't
        // straddle a concurrent ingest COMMIT. Inherits the pool's
        // statement_timeout; always rolls back + releases the client.
        dbRows.tx = async (cb) => {
          const c = await pool.connect();
          try {
            await c.query("BEGIN TRANSACTION READ ONLY");
            const out = await cb((sql, params) =>
              c.query(sql, params).then((r) => r.rows),
            );
            await c.query("COMMIT");
            return out;
          } catch (e) {
            await c.query("ROLLBACK").catch(() => {});
            throw e;
          } finally {
            c.release();
          }
        };
        const started = Date.now();
        const { status = 200, body } = await route(dbRows, req.query || {});
        const elapsed = Date.now() - started;
        if (elapsed > 500) console.warn(`slow db route ${seg}: ${elapsed}ms`);
        // The data changes only on ingest (~daily): let the CDN hold responses
        // for an hour and serve stale while it revalidates; browsers keep them
        // for 5 minutes.
        // SECURITY: this assumes the CDN cache key includes the FULL query
        // string (true for Firebase Hosting function rewrites). If a future
        // rewrite/CDN config ever normalizes or drops query params, different
        // ?eik=/?name=/?key= values would collide and serve each other's
        // (public, non-PII) payloads.
        // ⚠️ This header only reaches the client because firebase.json carries an
        // `/api/db/**` headers entry. Hosting's blanket `**` rule
        // (`no-cache, max-age=0, must-revalidate`) overrides function-set
        // Cache-Control on any path that has no more specific rule — which is why
        // this block was dead until 2026-07-29, and why /officials/** needed the
        // same treatment. The rule does not SUPPLY the value; it stops the `**`
        // rule clobbering it, so THIS string is what ships. Keep the two in sync.
        //
        // On the two numbers: `s-maxage=3600` is the DOMINANT term — it is how
        // long a shared cache serves without revalidating at all, and
        // stale-while-revalidate only applies after it expires. So the worst-case
        // post-ingest staleness is ~1 h + the SWR window, and 600 (down from
        // 86400) takes that from ~25 h to ~70 min. Tune s-maxage, not SWR, if an
        // hour is too long.
        //
        // Purging is possible but coarse: a hosting deploy clears the CDN, and an
        // ingest does not redeploy hosting — so in the normal daily flow nothing
        // invalidates these, which is what makes the window the operative bound.
        if (status === 200)
          res.set(
            "Cache-Control",
            "public, max-age=300, s-maxage=3600, stale-while-revalidate=600",
          );
        return await sendJson(req, res, body, status);
      } catch (e) {
        console.error("db route error", e);
        return res.status(500).json({ error: "db error" });
      }
    },
  );
};

if ((process.env.GCLOUD_PROJECT || "") !== "electionsbg-ai")
  exports.db = makeDb();

// ---- sql: PUBLIC read-only SQL console over the open data (elections-bg) ------
// Datasette-style: anyone can run SELECTs against the TR + procurement data.
// Hardening: every query runs READ ONLY + statement_timeout + a server-side row
// cap (sql_lib.js); this function caps maxInstances (bounds concurrent DB load)
// and rate-limits per IP. Reached via the `/api/sql/**` hosting rewrite.
//   GET  /api/sql/schema           → { databases[], tables[] }
//   POST /api/sql/query {sql,limit} → { columns, rows, rowCount, truncated, elapsedMs }
const sqlLib = require("./sql_lib");

// In-memory sliding-window rate limit, per instance. maxInstances is small so
// this bounds abuse well enough without external state; the real caps are the
// read-only tx + statement_timeout + row cap in sql_lib.
const SQL_RATE_WINDOW_MS = 60 * 1000;
const SQL_RATE_MAX = 40; // queries per IP per minute
const sqlHits = new Map();
const sqlRateLimited = (ip) => {
  const now = Date.now();
  const arr = (sqlHits.get(ip) || []).filter((t) => now - t < SQL_RATE_WINDOW_MS);
  if (arr.length >= SQL_RATE_MAX) {
    sqlHits.set(ip, arr);
    return true;
  }
  arr.push(now);
  sqlHits.set(ip, arr);
  if (sqlHits.size > 5000)
    for (const [k, v] of sqlHits)
      if (!v.some((t) => now - t < SQL_RATE_WINDOW_MS)) sqlHits.delete(k);
  return false;
};

const makeSql = () => {
  const DB_PASSWORD = defineSecret("ELECTIONSBG_DB_READONLY_PASSWORD");
  return onRequest(
    { secrets: [DB_PASSWORD], region: "europe-west3", maxInstances: 3 },
    async (req, res) => {
      const origin = req.headers.origin || "";
      const originOk =
        !origin || DB_ALLOWED_ORIGINS.some((re) => re.test(origin));
      if (origin && originOk) res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
      if (req.method === "OPTIONS") {
        res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.set("Access-Control-Allow-Headers", "Content-Type");
        res.set("Access-Control-Max-Age", "3600");
        return res.status(204).send("");
      }
      if (!originOk) return res.status(403).json({ error: "forbidden origin" });

      const ip =
        String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
        req.ip ||
        "?";
      if (sqlRateLimited(ip))
        return res
          .status(429)
          .json({ error: "rate limit — too many queries, try again shortly" });

      const seg = (req.path || "").split("/").filter(Boolean).pop();
      try {
        const pool = await getDbPool(DB_PASSWORD.value());
        if (req.method === "GET" && seg === "schema") {
          res.set("Cache-Control", "public, max-age=300");
          return await sendJson(req, res, await sqlLib.readSchema(pool));
        }
        if (req.method === "POST" && seg === "query") {
          const body = req.body || {};
          if (!body.sql || typeof body.sql !== "string")
            return res.status(400).json({ error: "missing `sql`" });
          const out = await sqlLib.runQuery(pool, body.sql, body.limit, {
            rowCapMax: 2000,
            statementTimeout: "8s",
          });
          return await sendJson(req, res, out);
        }
        return res.status(404).json({ error: "unknown /api/sql endpoint" });
      } catch (e) {
        return res.status(400).json({ error: String(e?.message || e) });
      }
    },
  );
};

if ((process.env.GCLOUD_PROJECT || "") !== "electionsbg-ai")
  exports.sql = makeSql();
