// Pure helpers for the `scenarios` cloud function (functions/index.js) — the
// budget simulator's public tally. Extracted so the security-critical input
// gate and the displayed-number math are unit-testable without loading
// firebase-functions (see functions/scenarios.test.js, run via `npm test`
// with Node's built-in test runner).

// The simulator's URL contract — keep in sync with the clampIntParam bounds
// and enums in src/screens/components/budget/BudgetPolicySimulator.tsx.
// int: inclusive range; flag: exact "1" (or "0" where the default is on);
// enum: value set. Unknown keys or out-of-range values reject the submission.
const VAT_REGIMES = ["standard", "reduced", "zero"];
const PARAM_SPEC = {
  dds: { int: [10, 27] },
  ddsr: { int: [0, 27] },
  food: { enum: VAT_REGIMES },
  medicines: { enum: VAT_REGIMES },
  energy: { enum: VAT_REGIMES },
  restaurants: { enum: VAT_REGIMES },
  hotels: { enum: VAT_REGIMES },
  books: { enum: VAT_REGIMES },
  pit: { int: [0, 30] },
  nm: { int: [0, 1200] },
  b2: { flag: "1" },
  t2: { int: [1000, 6000] },
  r2: { int: [0, 30] },
  corp: { int: [0, 30] },
  div: { int: [0, 20] },
  mod: { int: [1000, 8000] }, // generous; the UI clamps to the cap grid
  nocap: { flag: "1" },
  pw: { int: [0, 100] },
  ks: { flag: "0" },
  ph: { int: [1, 5] },
  adm: { int: [0, 20] },
  mrz: { flag: "1" },
  def: { int: [15, 50] },
  wi: { int: [-5, 15] },
  wex: { flag: "0" },
  kap: { int: [-30, 30] },
  ssp: { flag: "1" },
  sspg: { flag: "1" },
  hp: { int: [0, 3] },
  mp: { int: [0, 600] },
  tp: { int: [0, 140] },
  mat: { int: [0, 12] },
  mpf: { flag: "1" },
  psub: { int: [0, 450] },
};

const RATE_LIMIT_PER_DAY = 20;
const HEADLINE_BUCKET_EUR = 250e6;
const HEADLINE_BUCKET_MAX = 40; // ±€10B

// Per-lever histogram bucketing (FINDING-003): the single `scenario_agg/v1`
// document holds one value-histogram per lever, so the key domain of each
// must stay small. WIDE-range integer levers are bucketed to a step (so e.g.
// `mod` ∈ [1000,8000] collapses from ~7000 possible keys to ~70); narrow
// integer levers are stored raw; enum/flag levers get NO histogram at all
// (their `histMedian` is always null — pure storage waste).
const HIST_BUCKET = { mod: 100, t2: 250, nm: 100, mp: 50, psub: 50, tp: 10 };

// Salt for the per-IP rate-limit hash. Fixed (not secret): the goal is to
// keep raw IPs out of storage, not cryptographic anonymity. NOTE: a fixed
// public salt is REVERSIBLE for IPv4 under a DB compromise (the whole 2^32
// space is enumerable against a known salt). Acceptable here because the
// rate docs are server-only (Firestore rules deny client reads, the API
// never returns ipHash); move to a Firebase secret if that threat model
// tightens.
const IP_SALT = "naiasno-scenarios-2026";

/** Parse + validate the submitted query string against PARAM_SPEC.
 *  Returns { levers } (param → string value, defaults-only qs = {}) or null. */
const parseScenarioQs = (qs) => {
  if (typeof qs !== "string" || qs.length > 500) return null;
  const clean = qs.replace(/^\?/, "");
  // Null prototype + hasOwn lookups: a key like "constructor" must read as
  // unknown, not resolve through the object prototype.
  const levers = Object.create(null);
  if (clean === "") return { levers };
  let params;
  try {
    params = new URLSearchParams(clean);
  } catch {
    return null;
  }
  for (const [key, value] of params) {
    const spec = Object.hasOwn(PARAM_SPEC, key) ? PARAM_SPEC[key] : undefined;
    if (!spec || Object.hasOwn(levers, key)) return null;
    if (spec.int) {
      if (!/^-?\d+$/.test(value)) return null;
      const n = Number(value);
      if (n < spec.int[0] || n > spec.int[1]) return null;
    } else if (spec.flag) {
      if (value !== spec.flag) return null;
    } else if (spec.enum && !spec.enum.includes(value)) {
      return null;
    }
    levers[key] = value;
  }
  return { levers };
};

const clampNum = (v, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0;
};

/** Weighted median over a {key → count} histogram with numeric keys. */
const histMedian = (hist) => {
  const entries = Object.entries(hist || {})
    .map(([k, n]) => [Number(k), Number(n) || 0])
    .filter(([k, n]) => Number.isFinite(k) && n > 0)
    .sort((a, b) => a[0] - b[0]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (!total) return null;
  let cum = 0;
  for (const [k, n] of entries) {
    cum += n;
    if (cum * 2 >= total) return k;
  }
  return entries[entries.length - 1][0];
};

/** Histogram key to store for (param, value), or null to store NO histogram
 *  for this lever — enum/flag levers (no numeric median) and unknown params.
 *  Wide-range int levers are rounded to their HIST_BUCKET step so the stored
 *  key IS the representative value `histMedian` returns. */
const histKey = (param, value) => {
  const spec = PARAM_SPEC[param];
  if (!spec || !spec.int) return null;
  const step = HIST_BUCKET[param];
  if (!step) return value; // narrow int: raw value
  return String(Math.round(Number(value) / step) * step);
};

module.exports = {
  VAT_REGIMES,
  PARAM_SPEC,
  RATE_LIMIT_PER_DAY,
  HEADLINE_BUCKET_EUR,
  HEADLINE_BUCKET_MAX,
  HIST_BUCKET,
  IP_SALT,
  parseScenarioQs,
  clampNum,
  histMedian,
  histKey,
};
