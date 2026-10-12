/**
 * Edge gate — only requests that came through Cloudflare may reach the data.
 *
 * Why it exists: the `db` and `sql` functions are reachable by FOUR routes, and
 * only one of them goes through Cloudflare, where the scraper rules live:
 *
 *   naiasno.bg/api/db/…                          → Cloudflare → Hosting → here
 *   elections-bg.web.app/api/db/…                → Hosting → here
 *   elections-bg.firebaseapp.com/api/db/…        → Hosting → here
 *   db-<n>.europe-west3.run.app/api/db/…         → here
 *
 * plus a fifth that looks like the first: a client can connect to Firebase's
 * IP (199.36.158.100) with SNI/Host `naiasno.bg` and skip Cloudflare even once
 * the DNS is proxied — measured 2026-10-12, a 200 with the contracts payload.
 * The `Origin` allowlist does not help: a request with NO Origin header passes
 * it, and a scraper sends none.
 *
 * So Cloudflare attaches a secret header (a Transform Rule) and this module
 * checks it. Hosting forwards request headers to the function, the other four
 * routes never carry it, and the value is in Secret Manager
 * (`EDGE_SHARED_SECRET`). The secret may hold several comma-separated tokens,
 * so a rotation (old + new) and a CI-only token can coexist.
 *
 * Modes, set by EDGE_GATE_MODE below and active ONLY on the prod project:
 *   "log"     — never blocks; logs every request that would have been refused.
 *               Ship this first: until the Cloudflare rule exists EVERY request
 *               misses, and the log is how we confirm real traffic carries the
 *               header before anything is enforced.
 *   "enforce" — API requests get a no-store 403; PAGE requests get a 301 to
 *               naiasno.bg, so a human who lands on web.app is moved to the real
 *               site instead of shown an error.
 *
 * ⚠️ A refused response must be `no-store`. firebase.json gives /api/db/** an
 * `s-maxage=3600`, and the direct-to-IP route above arrives under the REAL
 * naiasno.bg cache key — a cacheable 403 there would be served to real readers
 * for an hour. (A 4xx measured MISS twice on 2026-10-12, but do not rely on the
 * CDN's default.)
 */
const crypto = require("node:crypto");
const { SITE_ORIGIN } = require("./site_origin");

const EDGE_HEADER = "x-naiasno-edge";
const EDGE_GATE_MODE = "log";
const PROD_PROJECT = "elections-bg";

const isProdProject = () => (process.env.GCLOUD_PROJECT || "") === PROD_PROJECT;

/** Constant-time compare of one presented token against the configured set. */
const tokenMatches = (presented, secretValue) => {
  if (!presented || !secretValue) return false;
  const p = Buffer.from(String(presented));
  return String(secretValue)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .some((t) => {
      const b = Buffer.from(t);
      return b.length === p.length && crypto.timingSafeEqual(b, p);
    });
};

/**
 * Classify a request. `secretValue` is the raw secret (comma-separated tokens);
 * pass null/"" when the gate is not configured — everything then reads as
 * `missing`, which is only ever acted on in "enforce" mode on prod.
 */
const edgeStatus = (req, secretValue) => {
  const presented = req.headers?.[EDGE_HEADER];
  if (!presented) return "missing";
  return tokenMatches(presented, secretValue) ? "ok" : "bad";
};

/**
 * The client IP to rate-limit on. Behind Cloudflare `CF-Connecting-IP` is the
 * real visitor, but any client can SEND that header — so it is trusted only when
 * the edge token proved the request came through Cloudflare. Otherwise fall back
 * to the first X-Forwarded-For entry (the previous behaviour).
 */
const clientIp = (req, edge) => {
  if (edge === "ok") {
    const cf = String(req.headers?.["cf-connecting-ip"] || "").trim();
    if (cf) return cf;
  }
  return (
    String(req.headers?.["x-forwarded-for"] || "")
      .split(",")[0]
      .trim() ||
    req.ip ||
    "?"
  );
};

/**
 * Run the gate. Returns true when the request was answered (refused) and the
 * caller must stop; false to continue. Anything under /api/ is an API call;
 * the rest (the server-rendered /company, /funds/contract, /person … pages) is
 * a page.
 */
const applyEdgeGate = (req, res, { secretValue, mode = EDGE_GATE_MODE }) => {
  if (!isProdProject()) return false;
  const kind = String(req.path || "").startsWith("/api/") ? "api" : "page";
  const edge = edgeStatus(req, secretValue);
  if (edge === "ok") return false;
  const host = String(
    req.headers?.["x-forwarded-host"] || req.headers?.host || "",
  );
  console.log(
    JSON.stringify({
      severity: "INFO",
      message: "edge-gate miss",
      edgeGate: { mode, edge, kind, host, path: req.path || req.url || "" },
      ua: String(req.headers?.["user-agent"] || "").slice(0, 160),
    }),
  );
  if (mode !== "enforce") return false;
  res.set("Cache-Control", "no-store");
  if (kind === "page" && (req.method === "GET" || req.method === "HEAD")) {
    res.redirect(301, `${SITE_ORIGIN}${req.originalUrl || req.url || "/"}`);
    return true;
  }
  res.status(403).json({ error: "forbidden" });
  return true;
};

module.exports = {
  EDGE_HEADER,
  EDGE_GATE_MODE,
  PROD_PROJECT,
  isProdProject,
  tokenMatches,
  edgeStatus,
  clientIp,
  applyEdgeGate,
};
