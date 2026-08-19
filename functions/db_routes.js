// Shared /api/db route table — ONE definition consumed by both the production
// Cloud Function (functions/index.js) and the Vite dev plugin (vite/db-api.ts),
// so dev == prod by construction and a route added here ships to both.
//
// Every handler is (dbRows, query) => Promise<{ status?, body }>, where
// `dbRows(sql, params)` is the caller's query fn (Cloud SQL pool or dev pool).
// All values are bound parameters; identifiers never come from the client.

const {
  runDbTable,
  runDbFacets,
  DbRequestError,
  SHLYO_TRIGGER_RAW,
} = require("./db_table.js");
const { interregQueryFor } = require("./interreg_topics.js");

// Shared by the fit resolver's three queries. 42883 FIRST — the arms are FUNCTIONS, so a database
// without 143 raises undefined_function and never 42P01. 55000 is a matview created WITH NO DATA,
// i.e. every first cloud deploy. 57014 (the pool's own statement_timeout) and 42501 (a permanent
// missing GRANT) are deliberately ABSENT: the first means the budget is already spent so a retry
// cannot finish, the second is not a refresh artifact and degrading hides it for ever.
const FIT_DEGRADE = ["42883", "42P01", "55000", "55P03"];

// Below this a trigram query matches noise and scans widely. Mirrors FIT_MIN_QUERY in
// src/data/funds/useFundsFit.ts — the client stops asking and the server stops answering, so
// neither depends on the other getting it right.
const FIT_MIN_QUERY = 3;

// The 28 canonical oblast codes (src/lib/regionalOblast.ts OBLAST_NAME) plus the folded capital.
// `fund_fit.oblasti` is keyed in this namespace by `canon_oblast()` in 143 — the raw S22/S23/S24/S25
// shards `fund_projects` stores are NOT valid here, and passing one would quietly return zero.
// Hand-copied because `functions/` is CommonJS and cannot import the TS module — so
// `db_routes.fundsfit.test.js` asserts this set EQUALS OBLAST_NAME's keys. The first draft of this
// list had a typo („VidIN") and a missing code (RAZ), which is the argument for the gate rather
// than for care.
const OBLAST_CODES = new Set([
  "BGS",
  "BLG",
  "DOB",
  "GAB",
  "HKV",
  "JAM",
  "KNL",
  "KRZ",
  "LOV",
  "MON",
  "PAZ",
  "PDV",
  "PER",
  "PVN",
  "RAZ",
  "RSE",
  "SFO",
  "SHU",
  "SLS",
  "SLV",
  "SML",
  "SOFIA_CITY",
  "SZR",
  "TGV",
  "VAR",
  "VID",
  "VRC",
  "VTR",
]);

const clampInt = (v, def, lo, hi) => {
  // trunc so a fractional query param (?limit=12.5) becomes a valid int rather
  // than being bound to an int SQL arg and 500-ing with 22P02.
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : def;
};

const s = (q, k) => String(q[k] || "").trim();
const orNull = (q, k) => s(q, k) || null;

// The table engine's REQUEST-validation failures answered 500 until 2026-07-31,
// because index.js has one catch-all and a bare Error is indistinguishable there
// from a dead pool. That made "a UI fired before its route param resolved" the
// third-largest source of 500s on the `db` service (70 over 2026-07-28…07-31,
// each rejected in <10 ms before a query ran) — sitting in the same bucket as the
// statement_timeout and lock_timeout families it takes real work to tell apart.
//
// Mapped HERE rather than in index.js's catch so the contract is unit-testable
// without a pool (db_routes.table.test.js) — and so it stays scoped to the two
// routes that actually run the engine.
//
// RETHROWS anything else, deliberately: only DbRequestError carries caller blame.
// A registry/config fault or a dead pool must keep its 500, or this helper becomes
// the thing that hides the outages the 500 bucket exists to surface.
const badRequest = (e, seg) => {
  if (!(e instanceof DbRequestError)) throw e;
  // Not console.error: a malformed request is not an incident. Logged all the
  // same — 70 of these was itself the signal that a client was misfiring.
  console.warn(`db route ${seg}: bad request — ${e.message}`);
  return { status: 400, body: { error: e.message } };
};

// One-shot logging for precompute misses. A route that degrades to a live computation
// returns the RIGHT answer slowly, which means every reason the fast path was skipped — a
// window that maps to no scope, a matview never built on this database, a refresh that has
// been failing since some earlier deploy, a role that cannot read the relation — is
// otherwise completely invisible: 200s, correct numbers, nothing red anywhere. Logged once
// per process per distinct reason so a warm instance serving thousands of requests emits one
// line, not thousands.
//
// KEYS MUST NOT COME FROM THE CLIENT. This Set is module-level and never pruned, in a
// container that runs with minInstances=1 and lives for days, so a key derived from a query
// parameter is an unbounded, attacker-controlled allocation AND an unbounded log stream —
// defeating the exact bound this helper exists to provide. Every key below is a constant or
// a value that came out of the database.
const loggedMisses = new Set();
// Raw query params are interpolated into some of these messages (the "this window is not a
// precomputed scope" ones), so cap the length and strip anything outside printable ASCII.
// Two reasons, and the second is the one that matters: a newline would split one warning into
// several Cloud Logging entries, and — because logMissOnce fires ONCE per process — a crawler
// or stale bookmark carrying a junk window would otherwise permanently occupy the single line
// that exists to reveal a REAL new election window the scopes loader has not been re-run for.
const logSafe = (v) =>
  v === null || v === undefined
    ? "null"
    : String(v)
        .replace(/[^\x20-\x7E]/g, "·")
        .slice(0, 32);
const logMissOnce = (key, message) => {
  if (loggedMisses.has(key)) return;
  loggedMisses.add(key);
  // The KEY is printed, not just used for dedupe. It is the stable token an operator greps
  // Cloud Logging for ("psp:not-built") to answer "did the loader ever run on this
  // database?" — the question latency cannot answer, because the fallback keeps the numbers
  // right. A key that only existed in memory would make that grep silently return nothing
  // during exactly the failure it was meant to surface.
  console.warn(`${key} — ${message}`);
};
// Test-only: the Set outlives a single test, so without this the second test to provoke a
// given miss reason silently observes nothing and the assertions become order-dependent.
const __resetMissLog = () => loggedMisses.clear();

// Single contract by key → ProcurementContract shape (camelCased). The columns
// common to both the enriched (contracts_list) and base (contracts) queries.
// Every column is qualified `c.` because both queries LEFT JOIN tenders `t`
// (below), and ocid/cpv/currency/eu_program exist on both tables — unqualified
// they'd be ambiguous.
const CONTRACT_COLS = `
  c.key, c.ocid, c.tag, c.date, c.date_signed AS "dateSigned",
  c.awarder_eik AS "awarderEik", c.awarder_name AS "awarderName",
  c.awarder_region AS "awarderRegion",
  c.contractor_eik AS "contractorEik", c.contractor_eik_full AS "contractorEikFull",
  c.contractor_name AS "contractorName",
  c.amount, c.currency, c.amount_eur AS "amountEur",
  c.signing_amount_eur AS "signingAmountEur", c.title, c.cpv,
  c.procurement_method AS "procurementMethod",
  c.procurement_method_rationale AS "procurementMethodRationale",
  c.number_of_tenderers AS "numberOfTenderers",
  CASE WHEN c.eu_funded IS NULL THEN NULL ELSE c.eu_funded = 1 END AS "euFunded",
  c.eu_program AS "euProgram",
  c.tender_period_start_date AS "tenderPeriodStartDate",
  c.tender_period_end_date AS "tenderPeriodEndDate",
  c.category, c.bundle_uuid AS "bundleUuid", c.source_url AS "sourceUrl",
  c.lot_name AS "lotName",
  c.joint_kind AS "jointKind", c.consortium_role AS "consortiumRole",
  c.consortium_eik AS "consortiumEik", c.consortium_full_eur AS "consortiumFullEur"`;
// The procedure's PROGNOZA (estimated value) + поръчки source-day provenance,
// from the УНП-matched tender (tenders.unp is the PK → single-row seek). NULL for
// the ~49% of contracts with no matching tender — the UI degrades to two bases.
const TENDER_COLS = `
  t.estimated_value_eur AS "estimatedValueEur",
  t.source_url AS "tenderSourceUrl",
  t.source_day AS "tenderSourceDay"`;
// The per-contract risk index (112), carried on contracts_list only. The detail
// page decodes these masks into its chips (src/lib/contractRiskMask.ts) instead
// of downloading a corpus-wide payload to re-derive them, so omitting them here
// makes every contract render as UNSCORED.
const CONTRACT_RISK_COLS = `
  c.risk_cri AS "riskCri", c.risk_grade AS "riskGrade",
  c.risk_fired AS "riskFired", c.risk_available AS "riskAvailable",
  c.risk_fired_mask AS "riskFiredMask",
  c.risk_available_mask AS "riskAvailableMask"`;
const CONTRACT_SQL = `
  SELECT ${CONTRACT_COLS}, ${TENDER_COLS}, ${CONTRACT_RISK_COLS},
         c.has_appeal AS "hasAppeal", c.appeal_upheld AS "appealUpheld"
  FROM contracts_list c LEFT JOIN tenders t ON c.unp = t.unp
  WHERE c.key = $1 LIMIT 1`;
// Fallback for a DB predating migration 042 (contracts_list missing → 42P01):
// serve the contract without the appeal fields rather than 500 the whole page.
// NULL, not 0, for the risk masks: this branch is a DB with no contracts_list, so
// the checks were never run. NULL decodes to "unscored" in the SPA; 0 would
// decode to "all twelve checks passed", which is a claim this branch cannot make.
const CONTRACT_SQL_BASE = `
  SELECT ${CONTRACT_COLS}, ${TENDER_COLS},
         NULL::int AS "riskCri", NULL::text AS "riskGrade",
         NULL::int AS "riskFired", NULL::int AS "riskAvailable",
         NULL::int AS "riskFiredMask", NULL::int AS "riskAvailableMask"
  FROM contracts c LEFT JOIN tenders t ON c.unp = t.unp
  WHERE c.key = $1 LIMIT 1`;

// Degrade to "no appeals" ONLY for the missing-migration case (42883 =
// undefined_function): until 042 reaches this DB the appeals tile stays empty
// instead of 500-ing the whole tender page. Any other error still propagates.
const appealsOrEmpty = (e) =>
  e?.code === "42883" ? [{ r: [] }] : Promise.reject(e);

// Degrade a dedicated route to an empty result when its migration hasn't reached
// this DB yet — 42883 (undefined_function) OR 42P01 (undefined_table) — instead
// of hard-500-ing on a functions-before-migration deploy. Real errors propagate.
const missingMigrationEmpty = (e) =>
  e?.code === "42883" || e?.code === "42P01" ? [{ r: [] }] : Promise.reject(e);

// Same missing-migration degradation, but yields a bare `[]` — for routes that
// `return { body: rows }` directly (arrays of rows) rather than unwrapping
// `rows[0].r`. The `[{r:[]}]` sentinel would otherwise be served AS the array
// (e.g. price-history's fast path sees length 1 and returns it as the series;
// price-verdict returns `{r:[]}` and the tile computes NaN%).
const missingMigrationRows = (e) =>
  e?.code === "42883" || e?.code === "42P01" ? [] : Promise.reject(e);

// SHLIOKAVITSA — the second needle. Returns the folded query REWRITTEN into the spellings a
// Bulgarian actually types (6umen, 4erven, sofiq), or null when the query has no rewrite.
//
// Measured before this existed: "Jelqzkov" returned 0 rows from person_search while
// "Jelyazkov" returned 2. pg_trgm's %> absorbs the letter-for-letter variants and hides half
// the gap; what it cannot absorb is a substitution that changes the letter COUNT, which is
// every rule in shlyo_query_fold (migration 141, generated from src/lib/shlyoRules.ts).
//
// WHY A SEPARATE ROUND TRIP instead of ORing the rewrite into each query. Three reasons, and
// the first is the one that decides it:
//
//   1. DEGRADATION. ORed inline, a database without migration 141 raises 42883 for the WHOLE
//      query — so the route would return nothing at all rather than falling back to the plain
//      probe. Here a failure yields null and the caller behaves exactly as it did before 141
//      existed. That is the difference between "search is slightly worse on a stale database"
//      and "search is broken on one".
//   2. COST. NULLIF makes the common case explicit: a query with no trigger character gets
//      null and NO second probe is issued at all. Inlining would pay for the alternate on
//      every keystroke; the six procurement groups measured 390 buffers EACH for a query
//      that folds to nothing.
//   3. LATENCY. Callers run this concurrently with their main batch, so the extra trip costs
//      nothing in the common case — the batch is always the slower of the two.
//
// The result is a FOLDED string, so pass it where a raw query would go: translit_bg_latin is
// the identity on lowercase ASCII, and every search function folds its argument again.
//
// THE TRIGGER GATE IS NOT AN OPTIMISATION. Without it this fires on ordinary CYRILLIC, and
// injects rows the reader never asked for.
//
// The `y(?![aeiou]) -> a` rule exists because a Bulgarian types „y" for ъ. It cannot tell
// that apart from the „y" translit_bg_latin ITSELF emits for й and ь — so „Бойко Борисов"
// folds to `boyko borisov` and rewrites to `boako borisov`. Measured: 13.64% of the 539,985
// indexed names rewrite, and 97.4% of those contain no shliokavitsa character at all; 6 of 8
// ordinary Cyrillic queries fired a full second batch and injected 31 unrelated rows.
//
// The client tolerates the same ambiguity because it is a SUBSTRING test — a nonsense needle
// simply matches nothing. On the server the probe is `%>` trigram similarity, which is fuzzy
// by design, so a nonsense needle matches plenty.
//
// So the gate gives the rewrite a reason to exist: one of the characters that has no other
// use in a folded query. `y` alone is deliberately NOT a trigger — every Latin-typed
// Bulgarian name has one. A genuine shliokavitsa query almost always carries another marker
// („jelezopyten" has its j), and one that carries only a bare y is the case we decline.
//
// The pattern itself lives in db_table.js, which this module already require()s and which
// needs it for the same gate on the DbDataTable search arm. One definition, imported —
// not two that agree today.

const shlyoAlt = (dbRows, term) =>
  !SHLYO_TRIGGER_RAW.test(term)
    ? Promise.resolve(null)
    : dbRows(
        `SELECT NULLIF(shlyo_query_fold(translit_bg_latin($1)),
                       translit_bg_latin($1)) AS alt`,
        [term],
      )
        .then((r) => r[0]?.alt || null)
        .catch(() => null);

/** Append rows from the alternate needle that the plain probe did not already return.
 *  ADDITIVE BY CONSTRUCTION: the plain rows keep their order and their positions, and the
 *  alternate can only extend the tail. `keyOf` must identify a row across both probes. */
const mergeAlt = (plain, alt, keyOf, lim) => {
  if (!alt.length) return plain;
  const seen = new Set(plain.map(keyOf));
  return plain.concat(alt.filter((r) => !seen.has(keyOf(r)))).slice(0, lim);
};

// Reads of a MATERIALIZED VIEW, which fail two ways the helpers above do not cover.
//
//   55000 — object_not_in_prerequisite_state. A matview created WITH NO DATA does not
//           return zero rows when you select from it, it RAISES. That is precisely the
//           state of a database where the DDL has been applied and the refresh has not
//           run, i.e. every first deploy, so leaving it out turns the ordinary
//           deploy-ordering case into a 500.
//   55P03 — lock_not_available. A REFRESH is in progress; serving stale-but-empty beats
//           blocking the pool behind a multi-minute rebuild.
//
// 57014 is deliberately ABSENT, and it is the one that looks like it belongs. It is not the
// "locked" code (that is 55P03) — it is the pool's own statement_timeout, which means the
// request has already burned its full budget. Degrading there would turn a 10 s failure
// into a ~20 s one while still holding a pooled connection, under exactly the saturation
// that caused the timeout. Degrading is only correct when it beats failing.
// Reads of a plain TABLE, which fails differently from a matview.
//
// 55000 is dropped: a table is never "not populated" — that state belongs to a matview
// created WITH NO DATA. 42501 is dropped for a sharper reason: a missing GRANT on a table
// is PERMANENT, not a refresh artifact, so degrading it would serve an empty day at a 200
// for ever on a Cloud SQL database that never received 134's grants. That is precisely the
// silent-wrong-answer shape the degrade contract exists to avoid, so it must 500 and be
// noticed. 42P01 (table absent — a database before the migration) and 55P03 (a reload
// holding the lock) remain.
const tableRows = (label, loader) => (e) => {
  if (!["42P01", "55P03"].includes(e?.code)) return Promise.reject(e);
  logMissOnce(
    `rc:table-miss:${label}:${e.code}`,
    `${label}: read failed (${e.code}) — serving empty. Run ${loader}.`,
  );
  return [];
};

const matviewRows = (label) => (e) => {
  if (!["42P01", "42883", "55000", "55P03", "42501"].includes(e?.code)) {
    return Promise.reject(e);
  }
  logMissOnce(
    `rc:not-built:${label}:${e.code}`,
    `${label}: read failed (${e.code}) — serving empty. Run db:load:rollcall-derived:pg.`,
  );
  return [];
};

// Same degradation, but wrapping a caller-supplied sentinel as `[{ r: sentinel }]`
// — for a route whose empty payload is not `[]` (e.g. an object the client
// destructures). Served via `rows[0].r`, like the scalar-function routes.
const missingMigration = (sentinel) => (e) =>
  e?.code === "42883" || e?.code === "42P01"
    ? [{ r: sentinel }]
    : Promise.reject(e);

// Same again, but it LOGS. A zero-shaped sentinel is indistinguishable from a
// place that genuinely received no Interreg money, so without this line the only
// symptom of "deploy:db shipped before 138 was applied on Cloud SQL" is every
// municipality in the country reading €0 — at a 200, for ever, with nothing red.
// That is the reasoning CLAUDE.md already records for 123/124's `psp:`/`pp:`
// prefixes; this is the Interreg one. Once per process per label, so a crawler
// walking 265 municipalities produces one entry, not 265.
// ── /budget route family ───────────────────────────────────────────────────
//
// Factored out because eleven routes share one degrade contract, and repeating
// it eleven times is eleven chances to drop 55000 from the list.
const BUDGET_DEGRADE = ["42P01", "42883", "55000", "55P03", "42501"];

/** Degrade to `sentinel`, logging once per process with the loader to run. */
const budgetMiss = (label, sentinel) => (e) => {
  if (!BUDGET_DEGRADE.includes(e?.code)) return Promise.reject(e);
  logMissOnce(
    `bh:not-built:${label}:${e.code}`,
    `budget/${label}: read failed (${e.code}) — serving an empty payload. Run ` +
      "npm run db:load:budget-muni:pg:cloud (schema + municipal), then " +
      "npm run db:load:budget:pg:cloud (the state corpus).",
  );
  return [{ r: sentinel }];
};

/** The ?basis= control. Unknown values fall through to EUR rather than 400ing:
 *  a mistyped param must narrow nothing and blank nothing. */
const BUDGET_BASES = ["eur", "gdp", "share", "capita"];
const budgetBasis = (q) => {
  const b = s(q, "basis").toLowerCase();
  return BUDGET_BASES.includes(b) ? b : "eur";
};

/** A fiscal year, or null for "the latest". Out-of-range is null, not a 400 —
 *  every one of these functions treats null as "newest", which is a better
 *  answer to `?fy=abc` than an error page. */
const budgetFy = (q) => {
  const raw = s(q, "fy");
  if (raw === "") return null;
  return /^\d{4}$/.test(raw) && Number(raw) >= 1990 && Number(raw) <= 2100
    ? Number(raw)
    : null;
};

const budgetRoutes = () => ({
  // The hub's ONE stat call. Replaces 1,202 KB across four eager fetches with
  // ~1 KB — and the peer bands it carries are the three scalars that made
  // macro_peers.json 66% of that payload.
  "budget-hub-stats": async (dbRows, q) => {
    const rows = await dbRows("SELECT budget_hub_stats($1::int) AS r", [
      budgetFy(q),
    ]).catch(budgetMiss("hub-stats", null));
    // null, never a zero-shaped object: a hub that renders EUR 0 across the board
    // is indistinguishable from a real answer, and this is the one payload every
    // visitor sees.
    return { body: rows[0]?.r ?? null };
  },
  "budget-year": async (dbRows, q) => {
    const rows = await dbRows(
      "SELECT budget_year_summary($1::int, $2::text) AS r",
      [budgetFy(q), budgetBasis(q)],
    ).catch(budgetMiss("year", null));
    return { body: rows[0]?.r ?? null };
  },
  "budget-series": async (dbRows, q) => {
    const rows = await dbRows(
      "SELECT budget_series($1::int, $2::int, $3::text, $4::text) AS r",
      [
        budgetFy({ fy: s(q, "from") }),
        budgetFy({ fy: s(q, "to") }),
        s(q, "series") || null,
        budgetBasis(q),
      ],
    ).catch(budgetMiss("series", { points: [] }));
    return { body: rows[0]?.r ?? { points: [] } };
  },
  "budget-snapshot": async (dbRows, q) => {
    const fy = budgetFy(q);
    if (fy == null)
      return { status: 400, body: { error: "fy is required (YYYY)" } };
    const rows = await dbRows(
      "SELECT budget_snapshot($1::int, $2::text, $3::text) AS r",
      [fy, s(q, "kind") || null, budgetBasis(q)],
    ).catch(budgetMiss("snapshot", { sections: [] }));
    return { body: rows[0]?.r ?? { sections: [] } };
  },
  "budget-explorer": async (dbRows, q) => {
    const fy = budgetFy(q);
    if (fy == null)
      return { status: 400, body: { error: "fy is required (YYYY)" } };
    // The dimension is validated rather than passed through: an unknown one
    // returns zero rows from every arm of the UNION, which renders as "this
    // ministry spent nothing" instead of "no such view".
    const dim = s(q, "dimension") || "admin";
    if (!["admin", "functional"].includes(dim))
      return {
        status: 400,
        body: { error: "dimension must be admin|functional" },
      };
    const rows = await dbRows(
      "SELECT budget_explorer($1::int, $2::text, $3::text, $4::text) AS r",
      [fy, dim, s(q, "parent") || null, budgetBasis(q)],
    ).catch(budgetMiss("explorer", { rows: [] }));
    return { body: rows[0]?.r ?? { rows: [] } };
  },
  "budget-ministries": async (dbRows, q) => {
    const rows = await dbRows(
      "SELECT budget_admin_list($1::int, $2::text, $3::int) AS r",
      [budgetFy(q), s(q, "q") || null, clampInt(q.limit, 300, 1, 1000)],
    ).catch(budgetMiss("ministries", { rows: [] }));
    return { body: rows[0]?.r ?? { rows: [] } };
  },
  "budget-ministry": async (dbRows, q) => {
    const id = s(q, "id");
    if (!id) return { status: 400, body: { error: "id is required" } };
    const rows = await dbRows(
      "SELECT budget_admin_detail($1::text, $2::int) AS r",
      [id, budgetFy(q)],
    ).catch(budgetMiss("ministry", null));
    return { body: rows[0]?.r ?? null };
  },
  "budget-functional": async (dbRows, q) => {
    const fy = budgetFy(q);
    if (fy == null)
      return { status: 400, body: { error: "fy is required (YYYY)" } };
    const rows = await dbRows(
      "SELECT budget_cofog_list($1::int, $2::text) AS r",
      [fy, budgetBasis(q)],
    ).catch(budgetMiss("functional", { rows: [] }));
    return { body: rows[0]?.r ?? { rows: [] } };
  },
  "budget-variance": async (dbRows, q) => {
    const fy = budgetFy(q);
    if (fy == null)
      return { status: 400, body: { error: "fy is required (YYYY)" } };
    const rows = await dbRows("SELECT budget_variance($1::int, $2::int) AS r", [
      fy,
      clampInt(q.limit, 20, 1, 200),
    ]).catch(
      // The sentinel carries NULL coverage, not 0/0. A degraded payload reading
      // "0 of 0 units reported" is a claim about the corpus; null is the truth,
      // and the page renders "not loaded" from it.
      budgetMiss("variance", {
        rows: [],
        coveredUnits: null,
        totalUnits: null,
      }),
    );
    return { body: rows[0]?.r ?? { rows: [] } };
  },
  "budget-law": async (dbRows, q) => {
    const rows = await dbRows("SELECT budget_documents($1::int) AS r", [
      budgetFy(q),
    ]).catch(budgetMiss("law", { rows: [], obsCategoriesPresent: null }));
    return { body: rows[0]?.r ?? { rows: [] } };
  },
  "budget-personnel": async (dbRows, q) => {
    // `fy` selects which year the per-ministry breakdown is for. NULL means the
    // newest year that HAS one — which is not the newest year of the national
    // series: the Доклад runs to 2025 while the programme-budget reports reach
    // 2024, so defaulting to the national latest would show an empty list.
    const rows = await dbRows("SELECT budget_personnel_series($1::int) AS r", [
      budgetFy(q),
    ]).catch(budgetMiss("personnel", { points: [] }));
    return { body: rows[0]?.r ?? { points: [] } };
  },
  "budget-municipal": async (dbRows, q) => {
    const rows = await dbRows(
      "SELECT budget_muni_list($1::int, $2::text, $3::int) AS r",
      [budgetFy(q), s(q, "q") || null, clampInt(q.limit, 300, 1, 1000)],
    ).catch(budgetMiss("municipal", { rows: [] }));
    return { body: rows[0]?.r ?? { rows: [] } };
  },
  "budget-municipal-ipop": async (dbRows, q) => {
    const rows = await dbRows(
      "SELECT budget_muni_ipop($1::text, $2::int) AS r",
      [s(q, "q") || null, clampInt(q.limit, 300, 1, 1000)],
    ).catch(budgetMiss("municipal-ipop", { rows: [] }));
    return { body: rows[0]?.r ?? { rows: [] } };
  },
  "budget-municipal-capital": async (dbRows, q) => {
    const rows = await dbRows("SELECT budget_muni_capital($1::int) AS r", [
      budgetFy(q),
    ]).catch(budgetMiss("municipal-capital", { rows: [] }));
    return { body: rows[0]?.r ?? { rows: [] } };
  },
  "budget-municipality": async (dbRows, q) => {
    const code = s(q, "obshtina");
    if (!code) return { status: 400, body: { error: "obshtina is required" } };
    const rows = await dbRows(
      "SELECT budget_muni_detail($1::text, $2::int) AS r",
      [code, budgetFy(q)],
    ).catch(budgetMiss("municipality", null));
    return { body: rows[0]?.r ?? null };
  },
});

const missingMigrationLogged = (label, sentinel, loader) => (e) => {
  if (e?.code !== "42883" && e?.code !== "42P01") return Promise.reject(e);
  logMissOnce(
    `ir:not-built:${label}:${e.code}`,
    `${label}: read failed (${e.code}) — serving an empty payload that reads as €0. Run ${loader}.`,
  );
  return [{ r: sentinel }];
};

// ── The per-scope procurement dashboard payloads (migration 124) ──────────────
//
// Six routes — procurement-{overview,flow,rankings,concentration,sectors,benchmarks} — used
// to run a live whole-corpus GROUP BY per request. Three of them exceeded the 10 s
// statement_timeout and returned 500 on prod (10.010 s on a windowed overview, 10.006 s on
// flow); the other three touch as many or more pages and had simply not been unlucky yet.
// 124 stores all 6 kinds x 30 scopes = 180 rows, so this is a point lookup instead.
//
// THE (from,to) → scope_key MAPPING MUST BE NULL-SAFE. Two of the thirty scopes carry a NULL
// bound and they are the two that matter: `all` (both NULL — what the AI tools send, and what
// /api/db/procurement-flow 500'd on) and the NEWEST parliament (open-ended upper bound, the
// page default). The client omits the parameter entirely when a bound is null, so both arrive
// here as NULL — and `date_from = NULL` is never true. With `=` this whole change would serve
// precomputed rows only for the 16 `y:` windows and the 12 CLOSED `ns:` ones, leaving exactly
// the two requests that time out on the live path, while a spot check of any single year
// passed. Same hazard, same fix, as the settlement route above.
//
// Simpler than that route's probe in one respect, deliberately: every (kind, scope) pair has a
// non-NULL payload by construction — verified 180/180 — so a present row with a NULL payload
// is unambiguously "not built" and there is no legitimate-empty case to tell it apart from.
// 123 needed the extra `built` EXISTS because most of its (scope, ekatte) pairs are legitimately
// absent.
const scopedPayload = async (dbRows, kind, from, to) => {
  try {
    // ORDER BY + LIMIT 1 for determinism only — scope windows are unique.
    const hit = await dbRows(
      `SELECT sc.scope_key, p.payload AS r
         FROM procurement_scopes sc
         LEFT JOIN procurement_payloads p
           ON p.kind = $1 AND p.scope_key = sc.scope_key
        WHERE sc.date_from IS NOT DISTINCT FROM $2
          AND sc.date_to   IS NOT DISTINCT FROM $3
        ORDER BY sc.sort_ord
        LIMIT 1`,
      [kind, from, to],
    );
    if (!hit.length) {
      // Keyed on the KIND, never on the window: from/to are raw query parameters and keying
      // on them would let any caller grow loggedMisses and this log without bound. The first
      // such window is named in the message, which is all the diagnosis needs.
      logMissOnce(
        `pp:no-scope:${kind}`,
        `${kind}: [${logSafe(from)} , ${logSafe(to)}) is not a precomputed scope — serving live. (Logged once; later unmatched windows are silent.)`,
      );
    } else if (!hit[0].r) {
      logMissOnce(
        `pp:not-built:${kind}:${hit[0].scope_key}`,
        `${kind}: procurement_payloads holds no payload for scope ${hit[0].scope_key} — serving live. Run db:load:procurement-scopes:pg.`,
      );
    }
    return hit[0]?.r ?? null;
  } catch (e) {
    // NARROW, like the settlement route. Degrade only where the live path is genuinely the
    // better answer: the matview absent (42P01, a database that has not run the loader),
    // NOT POPULATED (55000), unreadable (42501, default privileges never applied), or locked
    // by a plain REFRESH (55P03 lock_not_available). A pool or connection error is NOT one of
    // these — retrying it as a second, much heavier query just doubles the load on a saturated
    // pool, so it rethrows.
    //
    // 57014 (query_canceled) is DELIBERATELY ABSENT, unlike the first draft of this list. The
    // lock case it looks like it covers is 55P03 — lock_timeout raises that, not this. What
    // actually raises 57014 here is the pool's own statement_timeout, i.e. the probe already
    // burned the full 10 s budget. Falling back then issues a query 25-70x heavier (199k-411k
    // buffers, see 124's header) which cannot finish in its own fresh budget either, so the
    // request 500s anyway — after ~20 s of a held connection, under exactly the saturation that
    // caused the first timeout. Degrading is only correct when it is cheaper than failing.
    //
    // 55000 IS THE ONE THIS ROUTE MOST NEEDS and the easiest to omit. Reading a matview created
    // WITH NO DATA does not return zero rows — it ERRORS with
    // `object_not_in_prerequisite_state`. That is the state of any database where the DDL was
    // applied and the REFRESH never ran: precisely the first-deploy case, and the one the
    // "ships in any order" property is about. Without 55000 here that case is a 500, not a
    // fallback — which is the opposite of the design.
    //
    // Deliberately UNLIKE cpv_catalog, where degrading yields a WRONG answer (an empty picker)
    // rather than a slow one, and so must fail loudly instead. Here it yields the RIGHT answer
    // at today's speed, which is why these six routes can ship in any order, to any database.
    if (!["42P01", "55000", "42501", "55P03"].includes(e?.code)) throw e;
    logMissOnce(
      `pp:read-failed:${kind}:${e.code}`,
      `${kind}: precompute read failed (${e.code}) — serving live.`,
    );
    return null;
  }
};

// Resolve the person slug the mp_assets()/mp_declarations() fns key on. The person screens
// have a slug; the candidate screens (persons-pg-retirement-v1 T2.1b) have only the mp id, so
// accept `?id=` and map it to the slug via person_role (source='mp', ref=<mp id>). A ?slug=
// wins when present. Returns null when neither resolves (unknown id, non-MP, or a DB predating
// the person layer) so the caller can serve its empty body.
const mpSlugFromQuery = async (dbRows, q) => {
  const slug = s(q, "slug");
  if (slug) return slug;
  const id = q.id != null ? clampInt(q.id, null, 0, 2147483647) : null;
  if (id == null) return null;
  const rows = await dbRows(
    `SELECT p.slug
       FROM person p
       JOIN person_role r ON r.person_id = p.person_id
                         AND r.source = 'mp' AND split_part(r.ref, ':', 1) = $1
      WHERE p.status = 'active' AND p.is_public_figure
      -- One mp id resolves to one person in practice, but idx_person_role_source_ref is
      -- non-unique, so ORDER BY makes the pick deterministic (as mp_entry/mp_assets do).
      ORDER BY p.person_id
      LIMIT 1`,
    [String(id)],
  ).catch(missingMigrationEmpty);
  return rows[0]?.slug ?? null;
};

// "Шльокавица" — the Latin-typed spellings a Bulgarian actually uses, turned
// back into Cyrillic so they match the Cyrillic product titles.
//
// TWO KINDS, and they compose. Neither alone is enough:
//
//   KEYBOARD substitutions — a digit or a spare Latin letter standing in for a
//   Cyrillic one: „6umen" (Шумен), „4erven" (Червен), „sofiq" (София),
//   „plowdiw" (Пловдив), „jelyazkov" (Желязков).
//
//   PHONETIC digraphs — an ordinary Latin rendering: „mlyako", „mliako",
//   „sirene", „kafe".
//
// Measured, this is why one is not the other: the site's maintained keyboard
// table (src/lib/shlyoRules.ts, mirrored into SQL as shlyo_query_fold) folds
// „6umen"→"shumen" and „sofiq"→"sofiya" but leaves „mliako" alone; the phonetic
// pass here handles „mlyako"→мляко but left „6umen" as „6умен". A user typing
// „mliako" got NOTHING from either.
//
// ⚠️ This is a THIRD spelling of a rule the repo otherwise keeps in one place.
// It has to be: `functions/` is a separate CJS package that cannot import from
// `src/`, and the shared table folds to STREAMLINED LATIN (for comparison
// against translit_bg_latin) while this needle must end up CYRILLIC, because
// price_products.title is Cyrillic and has no Latin-folded column. The keyboard
// rules below are kept deliberately IDENTICAL to SHLYO_RULES — if that table
// changes, change these. functions/db_routes.shlyo.test.js asserts they agree.
//
// STRICTLY ADDITIVE, like the shared table: every spelling is tried as its own
// candidate ALONGSIDE the raw term, so a rewrite can add matches and never
// remove one. That is what lets an ambiguous rule (x→х vs x→кс, q→я vs q→к)
// emit BOTH readings instead of having to choose.

/** Keyboard substitutions, in order. Mirrors SHLYO_RULES in src/lib/shlyoRules.ts —
 *  same left-hand sides, same order, same reasons ("6t" before "6"). */
const SHLYO_KEYBOARD = [
  [/6t/g, "sht"],
  [/6/g, "sh"],
  [/4/g, "ch"],
  [/9/g, "ya"],
  [/q/g, "ya"],
  [/j/g, "zh"],
  [/w/g, "v"],
  [/x/g, "h"],
  // ъ typed as y; a real й/ю/я keeps its vowel.
  [/y(?![aeiou])/g, "a"],
];

const LAT2CYR_DIGRAPHS = [
  ["sht", "щ"],
  // Before "ya", or that rule eats the "ya" and leaves a bare "i". "qica" is
  // яйца: q→ya (keyboard) then "yai"→яй, so the й survives. Without it the
  // needle is "яица" and misses all 228 egg products in the catalogue. Bulgarian
  // has essentially no other "yai" sequence, so this is narrow by construction.
  ["yai", "яй"],
  ["sh", "ш"],
  ["ch", "ч"],
  ["zh", "ж"],
  ["ts", "ц"],
  ["yu", "ю"],
  ["ya", "я"],
  ["yo", "йо"],
  // i-as-glide: "mliako" (мляко), "liulak" (люляк), "biuro" (бюро). Genuinely
  // ambiguous — "italia" is италиа here and италия in life — which is why it is
  // one CANDIDATE among several rather than a replacement for the plain read.
  ["ia", "я"],
  ["iu", "ю"],
  ["io", "йо"],
];
const LAT2CYR = {
  a: "а",
  b: "б",
  v: "в",
  g: "г",
  d: "д",
  e: "е",
  z: "з",
  i: "и",
  j: "ж",
  k: "к",
  l: "л",
  m: "м",
  n: "н",
  o: "о",
  p: "п",
  r: "р",
  s: "с",
  t: "т",
  u: "у",
  f: "ф",
  h: "х",
  c: "ц",
  y: "й",
  w: "в",
  x: "кс",
  q: "к",
};
const latinToCyrillic = (str, digraphs = LAT2CYR_DIGRAPHS) => {
  const lower = String(str).toLowerCase();
  let out = "";
  for (let i = 0; i < lower.length; ) {
    const digraph = digraphs.find(([lat]) => lower.startsWith(lat, i));
    if (digraph) {
      out += digraph[1];
      i += digraph[0].length;
      continue;
    }
    out += LAT2CYR[lower[i]] ?? lower[i];
    i += 1;
  }
  return out;
};

/** Every Cyrillic spelling worth trying for a Latin-typed term, most literal
 *  first. Deduped, and always non-empty (the raw term is candidate 0).
 *
 *  Four passes rather than one, because the ambiguities are real and a search
 *  needle costs nothing to add: the plain phonetic read, the same without the
 *  i-glide digraphs (so "italia" stays италиа), and both of those again after
 *  the keyboard substitutions (so "6umen" and "mliako" both work). */
const shlyoCandidates = (term) => {
  const raw = String(term).toLowerCase();
  const noGlide = LAT2CYR_DIGRAPHS.filter(
    ([lat]) => !["ia", "iu", "io"].includes(lat),
  );
  const keyboard = SHLYO_KEYBOARD.reduce(
    (t, [re, to]) => t.replace(re, to),
    raw,
  );
  const out = [
    raw,
    latinToCyrillic(raw, noGlide),
    latinToCyrillic(raw),
    latinToCyrillic(keyboard, noGlide),
    latinToCyrillic(keyboard),
  ];
  return [...new Set(out.filter(Boolean))];
};

/** documentId → signed URL, per function instance. The register's URLs live 1800 s;
 *  we hand them out for a third of that so a cached one is never near expiry.
 *  Bounded and cleared wholesale — this is a hot-path cache, not a store. */
const SIGNED_URL_CACHE = new Map();
const SIGNED_URL_TTL_MS = 600_000;
const SIGNED_URL_CACHE_MAX = 5000;

const DB_ROUTES = {
  async person(dbRows, q) {
    const name = s(q, "name");
    if (!name) return { status: 400, body: { error: "missing name" } };
    const from = orNull(q, "from");
    const to = orNull(q, "to");
    const [
      roles,
      politicians,
      procurement,
      cabinets,
      associates,
      byCompany,
      bySettlement,
    ] = await Promise.all([
      dbRows("SELECT * FROM person_roles($1)", [name]),
      dbRows("SELECT * FROM person_politicians($1)", [name]),
      dbRows("SELECT person_procurement($1, $2, $3) AS r", [name, from, to]),
      dbRows("SELECT * FROM person_by_cabinet($1)", [name]),
      dbRows("SELECT * FROM person_associates($1) LIMIT 500", [name]),
      // The two portfolio cuts (migration 125). Same name + window as person_procurement, so
      // they reconcile with its headline (person_procurement_breakdowns.data.test.ts).
      // DEGRADE to [] if 125 has not reached this DB yet (42883) — the route ships via
      // deploy:db but the functions apply on a separate, slower cloud path, so between the two
      // this must serve the page WITHOUT the tiles rather than 500 the whole crawler-walked
      // /person/{slug} (roles, politicians, procurement, everything).
      dbRows("SELECT person_procurement_by_company($1, $2, $3) AS r", [
        name,
        from,
        to,
      ]).catch(missingMigrationEmpty),
      dbRows("SELECT person_procurement_by_settlement($1, $2, $3) AS r", [
        name,
        from,
        to,
      ]).catch(missingMigrationEmpty),
    ]);
    return {
      body: {
        name,
        roles,
        politicians,
        procurement: procurement[0]?.r ?? null,
        cabinets,
        associates,
        byCompany: byCompany[0]?.r ?? [],
        bySettlement: bySettlement[0]?.r ?? [],
      },
    };
  },
  // Ranked, grouped, foldable people search over person_search (S1). Three tiers:
  //   power  — public/resolved people (P)          → Хора във властта
  //   money  — money-linked private owners (V)      → Свързани с обществени пари
  //   others — long-tail private owners (N)         → Други собственици
  // Each tier is its own top-K ordered by the precomputed rank_static, which uses
  // idx_person_search_rank (tier, rank_static DESC) and EARLY-STOPS — ~10 ms even for the most
  // common name in the corpus (a single blended ORDER BY over all matches was 231 ms because a
  // name like "Иван Иванов" matches ~45k rows). Exact-fold hits are fetched separately (cheap)
  // and floated to the front of their tier. No total N count — the "виж всички" link carries the
  // user to /persons?q, where pagination lives. See docs/plans/people-connections-phase1-impl-v1.md §S1.
  // NB: `person_search` here is the TABLE (126). A same-named FUNCTION person_search(text,int)
  // (082) still backs the `person-lookup` route below — legal in PostgreSQL (separate catalogs:
  // `FROM person_search` = table, `person_search($1,$2)` = function), kept distinct on purpose.
  "person-search": async (dbRows, q) => {
    const term = s(q, "q");
    if (!term) return { status: 400, body: { error: "missing q" } };
    // Back-compat: the pre-S2 combined-search box reads {people:[{name,companies}]}. Retained
    // until S2 rewires it to the grouped shape.
    const lim = clampInt(q.limit, 20, 1, 50);
    const COLS =
      "key, name, tier, position_type, primary_role, party, place_label, " +
      "top_eik, firms_count, public_money_eur, has_photo, identity_confidence, href, " +
      "has_declaration";
    // decl=1 restricts to people with a filing on record; decl=0 to the rest. The
    // /governance/declarations hub asks for BOTH, as two separate calls, because scope ranks
    // and never filters — the declared group is shown first and the rest below it, so a
    // reader searching for a minister who has not filed still finds them.
    //
    // Absent = no restriction, which is what /procurement's combined box wants.
    const declFilter =
      q.decl === "1"
        ? " AND has_declaration"
        : q.decl === "0"
          ? " AND NOT has_declaration"
          : "";
    // Each read degrades to [] if person_search has not been built on this DB (first cloud deploy,
    // before db:load:person-search:pg:cloud) — an empty result, never a 500.
    const exactQ = (tier, q) =>
      dbRows(
        `SELECT ${COLS} FROM person_search
          WHERE tier = $1 AND name_fold = translit_bg_latin($2)${declFilter}
          ORDER BY rank_static DESC LIMIT 3`,
        [tier, q],
      ).catch(missingMigrationRows);
    const fuzzyQ = (tier, k, q) =>
      dbRows(
        `SELECT ${COLS} FROM person_search
          WHERE tier = $1 AND name_fold %> translit_bg_latin($2)${declFilter}
          ORDER BY rank_static DESC LIMIT $3`,
        [tier, q, k],
      ).catch(missingMigrationRows);
    // Per-tier: exact-fold hits (cheap eq lookup) float ahead of the fuzzy rank-ordered top-K.
    // The exact fetch is PER TIER — a single cross-tier exact query is dominated by high-rank P
    // rows on common names, so the V/N float would never fire.
    const tierRows = async (tier, k, q) => {
      const [ex, fz] = await Promise.all([exactQ(tier, q), fuzzyQ(tier, k, q)]);
      const seen = new Set(ex.map((r) => r.key));
      return [...ex, ...fz.filter((r) => !seen.has(r.key))];
    };
    // The alternate needle runs CONCURRENTLY with the three tiers, so it adds no latency:
    // the tier queries are always the slower half. It is null for any query with no
    // shliokavitsa character in it, which is nearly all of them, and then nothing else runs.
    const [power, money, others, alt] = await Promise.all([
      tierRows("P", 6, term),
      tierRows("V", 4, term),
      tierRows("N", 4, term),
      shlyoAlt(dbRows, term),
    ]);
    // Captured BEFORE the merge. `people` is the pre-S2 back-compat array and it is built by
    // concatenating the three tiers, so appending alt rows to `power` in place would push
    // plain `money`/`others` rows past its slice — losing rows the plain probe had found.
    // Measured on the first draft: 4 plain rows dropped at limit=6.
    const plainPeople = [...power, ...money, ...others];
    if (alt) {
      // Strictly additive: each tier keeps every row and every position it already had, and
      // the rewrite can only extend the tail. The caps are exact — 3 (the exact probe's
      // LIMIT) + k — so the slice below can never truncate a plain row.
      //
      // allSettled, not all: the plain rows are already computed, so a failure in the
      // ALTERNATE batch must not 500 a request that has an answer. tierRows only swallows
      // 42883/42P01; a pool timeout (57014) or an admin shutdown would otherwise reject here.
      const [p2, m2, o2] = (
        await Promise.allSettled([
          tierRows("P", 6, alt),
          tierRows("V", 4, alt),
          tierRows("N", 4, alt),
        ])
      ).map((r) => (r.status === "fulfilled" ? r.value : []));
      const k = (r) => r.key;
      power.splice(0, power.length, ...mergeAlt(power, p2, k, 9));
      money.splice(0, money.length, ...mergeAlt(money, m2, k, 7));
      others.splice(0, others.length, ...mergeAlt(others, o2, k, 7));
    }
    // people (back-compat) spans ALL tiers so a public figure absent from the client's own roster
    // is never dropped from the pre-S2 combined search (S2 replaces this with the grouped shape).
    const people = mergeAlt(
      plainPeople,
      [...power, ...money, ...others],
      (r) => r.key,
      lim,
    ).map((r) => ({ name: r.name, companies: r.firms_count }));
    // `altQuery` is the needle that actually produced the extra rows. A caller building a
    // "see all" deep link must use it: the browse tables it lands on do their own search and
    // do not carry this rewrite, so a link built from what the reader typed advertises rows
    // the destination cannot find. Null whenever no rewrite fired.
    return { body: { power, money, others, people, altQuery: alt || null } };
  },
  // One parliament's voted TOPICS, for the /parliament hub's finder.
  //
  // WHY A ROUTE AND NOT AN INDEX. topic_index.json is 8 MB and the session files are 482 KB
  // on an average day; a hub that has to point somewhere cannot download either to answer a
  // two-character query. Measured on the 52nd:
  //   ns-scoped, superseded_by filtered, LIKE over the fold -> 182 buffers / 12.6 ms,
  // carried by idx_vote_item_ns_date. An NS holds ~1,400-1,900 standing items, so no
  // expression index is needed; an UNSCOPED version over all 16,741 would want one.
  //
  // superseded_by IS NULL IS MANDATORY, and not only for the usual over-counting reason:
  // dedupeRevotes keeps the LAST of a repeated vote, so an annulled first attempt returned
  // here would send a reader to an item the chamber decided not to stand by.
  "vote-item-search": async (dbRows, q) => {
    const term = s(q, "q");
    if (!term) return { status: 400, body: { error: "missing q" } };
    const ns = clampInt(q.ns, 0, 1, 99);
    const lim = clampInt(q.limit, 8, 1, 25);
    // scope=out searches every parliament EXCEPT the selected one. That is the hub's
    // out-of-scope group: scope ranks and never filters, so a reader on the 52nd still finds
    // a 47th-NS budget vote — below the in-scope ones, in a group that names why.
    const out = q.scope === "out";
    if (!ns && out) return { body: { items: [] } };
    // $2 is referenced in EVERY branch, with an explicit cast. A clause that drops it — the
    // obvious "true" for the unscoped case — leaves the parameter untyped and Postgres
    // rejects the whole statement with "could not determine data type of parameter $2",
    // which is a 500 rather than an unscoped search.
    const nsClause = out ? "ns <> $2::int" : "($2::int = 0 OR ns = $2::int)";

    const run = (needle) =>
      dbRows(
        `SELECT item_id AS "itemId", ns, date::text AS date, item_no AS "itemNo",
                title, topic, yes, no, abstain
           FROM vote_item
          WHERE ${nsClause}
            AND superseded_by IS NULL
            AND translit_bg_latin(title) LIKE '%' || translit_bg_latin($1) || '%'
          ORDER BY date DESC, item_no
          LIMIT $3`,
        [needle, ns || 0, lim],
      ).catch(missingMigrationRows);

    // Same two-probe shape as the person and procurement searches, and additive for the same
    // reason: the plain rows are computed first and the rewrite can only extend them.
    const [rows, alt] = await Promise.all([run(term), shlyoAlt(dbRows, term)]);
    const merged = alt
      ? mergeAlt(rows, await run(alt), (r) => String(r.itemId), lim)
      : rows;
    return { body: { items: merged, altQuery: alt || null } };
  },

  async company(dbRows, q) {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const [
      company,
      summary,
      officers,
      politicians,
      procurement,
      cabinets,
      debarred,
      funds,
      relationships,
      sectors,
      related,
      institution,
      geography,
      seatPlace,
      awarderProcurement,
      awarderAllTime,
      fundProjects,
      ngoDetails,
      awarderKindex,
      ngoFunding,
      awarderRiskGrade,
      supplierRiskGrade,
      corpusName,
      subsidies,
      retailChain,
      ngoSignals,
      ngoBoardLinks,
      nkid,
    ] = await Promise.all([
      dbRows(
        "SELECT uic, name, legal_form, seat, status, funds_amount, funds_currency, entity_class, ngo_type FROM tr_companies WHERE uic = $1",
        [eik],
      ),
      dbRows(
        "SELECT count(*)::int AS contracts, coalesce(sum(amount_eur) FILTER (WHERE tag = 'contract'), 0) AS contracts_eur FROM contracts WHERE contractor_eik = $1",
        [eik],
      ),
      // Bounded: a few pathological holdings have thousands of officer rows —
      // the page previews a handful and links to the paginated officers table.
      dbRows("SELECT * FROM company_officers($1) LIMIT 500", [eik]),
      // `relations` (the full connections jsonb) rides along so the shared
      // political-links tile can render "(former)" / "declared stake N%" /
      // role labels without a second round-trip to the company-politicians route.
      dbRows(
        "SELECT politician, ref, kind, role, relations, total_eur FROM company_politicians WHERE eik = $1 ORDER BY total_eur DESC NULLS LAST LIMIT 200",
        [eik],
      ),
      dbRows("SELECT company_procurement($1, $2, $3) AS r", [
        eik,
        orNull(q, "from"),
        orNull(q, "to"),
      ]),
      dbRows("SELECT * FROM company_by_cabinet($1)", [eik]),
      dbRows("SELECT * FROM company_debarred($1)", [eik]),
      dbRows("SELECT * FROM fund_beneficiaries WHERE eik = $1", [eik]),
      dbRows("SELECT company_buyer_relationships($1) AS r", [eik]),
      dbRows("SELECT company_sectors($1) AS r", [eik]),
      dbRows("SELECT company_related($1) AS r", [eik]),
      dbRows("SELECT institution_identity($1) AS r", [eik]),
      dbRows("SELECT company_geography($1) AS r", [eik]),
      // The registered seat as a composed, localizable place (settlement · obshtina ·
      // oblast) resolved via place_dim (117) — feeds the shared PlaceSeatLine. NULL for a
      // non-awarder (no awarder_seats row); the page then keeps the free-text seat.
      dbRows("SELECT awarder_seat_place($1) AS r", [eik]),
      dbRows("SELECT awarder_procurement($1, $2, $3) AS r", [
        eik,
        orNull(q, "from"),
        orNull(q, "to"),
      ]),
      // DELIBERATELY UNSCOPED: "is this an awarder at all, in any period?".
      // Everything else here is windowed by from/to, so an entity whose only
      // activity sits outside the selected scope looked like a blank page with
      // no scope control — stranding the reader with no way back to "all"
      // (exactly what the hadAwarder latch was meant to prevent, but the latch
      // never fires if you LAND on an empty window). Cheap: bitmap index scan
      // on idx_contracts_awarder (~cost 338).
      dbRows(
        `SELECT count(*)::int AS contracts,
                COALESCE(SUM(amount_eur), 0)::float8 AS total_eur
         FROM contracts WHERE awarder_eik = $1 AND tag = 'contract'`,
        [eik],
      ),
      dbRows(
        `SELECT contract_number, title, program_name, total_eur, paid_eur, status, duration_months
         FROM fund_projects WHERE beneficiary_eik = $1
         ORDER BY total_eur DESC NULLS LAST LIMIT 6`,
        [eik],
      ),
      dbRows(
        "SELECT public_benefit, private_benefit, objectives, means FROM ngo_details WHERE uic = $1",
        [eik],
      ),
      // Awarder K-Index (share of the buyer's contract value to politician /
      // NGO-board-linked suppliers). Returns a zero-ish payload for non-awarders.
      dbRows("SELECT awarder_kindex($1) AS r", [eik]),
      // External funding received (EU direct / state subsidy / foreign grants).
      dbRows("SELECT ngo_funding_for($1) AS r", [eik]),
      // Multi-component A–F risk grade — as a BUYER and as a SUPPLIER. Null when
      // the entity has no contracts in that role. Both <90ms worst-case (live).
      // Guarded on the missing-migration case ONLY (42883 = undefined_function):
      // until migration 041 lands on this DB these functions don't exist, so
      // degrade the two grade tiles to null instead of 500-ing the whole company
      // page. A real outage (timeout, pool exhaustion) still propagates.
      dbRows("SELECT awarder_risk_grade($1) AS r", [eik]).catch((e) =>
        e?.code === "42883" ? [] : Promise.reject(e),
      ),
      dbRows("SELECT supplier_risk_grade($1) AS r", [eik]).catch((e) =>
        e?.code === "42883" ? [] : Promise.reject(e),
      ),
      // Representative name as it appears in the procurement corpus — the only
      // identity we have for a contractor/awarder absent from the TR register
      // (foreign / deregistered). Both lookups are eik-indexed. Prefer the
      // longest variant (most complete legal name); sell-side then buy-side.
      dbRows(
        `SELECT coalesce(
           (SELECT name FROM contractor_search WHERE eik = $1
              ORDER BY length(name) DESC LIMIT 1),
           (SELECT name FROM awarder_search WHERE eik = $1
              ORDER BY length(name) DESC LIMIT 1)
         ) AS name`,
        [eik],
      ).catch((e) => (e?.code === "42P01" ? [] : Promise.reject(e))),
      // ДФ „Земеделие" farm-subsidy rollup for this EIK (cross-program money map:
      // subsidies alongside procurement + EU funds). null when no subsidies (or
      // migration 046 not yet applied).
      dbRows(
        "SELECT payload FROM agri_payloads WHERE kind = 'recipient' AND key = $1",
        [eik],
      ).catch((e) => (e?.code === "42P01" ? [] : Promise.reject(e))),
      // Retail-chain block: if this EIK is a КЗП price-monitored chain, its
      // comparable-basket cost + rank among chains (from the precomputed `chains`
      // payload, ~110 rows). Returns no row for a non-chain. Drives the reciprocal
      // "this company is a retail chain" tile → /consumption/chain/:eik. Guarded on
      // the missing-migration case (price_payloads absent pre-048).
      dbRows(
        `WITH arr AS (
           SELECT payload->'national' AS n FROM price_payloads
            WHERE kind = 'chains' AND key = ''
         ),
         ranked AS (
           SELECT (e->>'eik') AS eik,
                  (e->>'chain') AS chain,
                  (e->>'basket')::float8 AS basket,
                  (e->>'nPriced')::int AS n_priced,
                  coalesce((e->>'comparable')::boolean, false) AS comparable,
                  -- Rank and total over the COMPARABLE rows only. The basket
                  -- figure is a sum over whatever subset a chain priced, so
                  -- ranking all of them together placed a shop that skipped a
                  -- third of the basket above one that priced every item. A
                  -- NULL rank for a partial row is deliberate: it has no
                  -- position in this order, and the page must not print one.
                  CASE WHEN coalesce((e->>'comparable')::boolean, false)
                       THEN row_number() OVER (
                              PARTITION BY coalesce((e->>'comparable')::boolean, false)
                              ORDER BY (e->>'basket')::float8 ASC)
                  END AS rank,
                  count(*) FILTER (WHERE coalesce((e->>'comparable')::boolean, false))
                    OVER () AS total
             FROM arr, jsonb_array_elements(arr.n) e
         )
         SELECT chain, basket, n_priced, comparable, rank::int, total::int
           FROM ranked WHERE eik = $1`,
        [eik],
      ).catch((e) => (e?.code === "42P01" ? [] : Promise.reject(e))),
      // Per-NGO public-interest signal set (migration 080). ngo_signal_row is
      // entity-class-agnostic, so a commercial EIK with contracts/funds also gets
      // a non-empty array — the NGO page only RENDERS it for NGO classes. Guarded
      // on the missing-migration case (42883) so the page still renders pre-080.
      dbRows("SELECT ngo_signals_for($1) AS r", [eik]).catch((e) =>
        e?.code === "42883" ? [] : Promise.reject(e),
      ),
      // Politicians / officials / magistrates on this NGO's governing body
      // (migration 080). HIGH-confidence ONLY — medium (namesake company_count
      // 2–3) is deliberately withheld from the public page (a name coincidence is
      // too likely to name a real person). Empty for non-NGOs / pre-080.
      dbRows(
        `SELECT person, ref, kind, role, position, confidence FROM ngo_board_links
         WHERE eik = $1 AND confidence = 'high' ORDER BY person LIMIT 50`,
        [eik],
      ).catch((e) => (e?.code === "42P01" ? [] : Promise.reject(e))),
      // Declared НКИД (КИД-2008) division + label, for the "off-profile" chip
      // (does the firm win outside its declared line of business?). Guarded on
      // the missing-migration case (140 / company_nkid absent) so the page still
      // renders on a DB that never ran db:load:cr-nkid:pg.
      dbRows("SELECT nace_div, label FROM company_nkid WHERE eik = $1", [
        eik,
      ]).catch((e) => (e?.code === "42P01" ? [] : Promise.reject(e))),
    ]);
    return {
      body: {
        eik,
        company: company[0] ?? null,
        summary: summary[0] ?? null,
        officers,
        politicians,
        procurement: procurement[0]?.r ?? null,
        cabinets,
        debarred,
        funds: funds[0] ?? null,
        relationships: relationships[0]?.r ?? null,
        sectors: sectors[0]?.r ?? null,
        related: related[0]?.r ?? null,
        institution: institution[0]?.r ?? null,
        geography: geography[0]?.r ?? null,
        seatPlace: seatPlace[0]?.r ?? null,
        awarderProcurement: awarderProcurement[0]?.r ?? null,
        awarderAllTime: awarderAllTime[0] ?? null,
        fundProjects,
        ngoDetails: ngoDetails[0] ?? null,
        awarderKindex: awarderKindex[0]?.r ?? null,
        ngoFunding: ngoFunding[0]?.r ?? null,
        awarderRiskGrade: awarderRiskGrade[0]?.r ?? null,
        supplierRiskGrade: supplierRiskGrade[0]?.r ?? null,
        corpusName: corpusName[0]?.name ?? null,
        subsidies: subsidies[0]?.payload ?? null,
        retailChain: retailChain[0] ?? null,
        ngoSignals: ngoSignals[0]?.r ?? null,
        ngoBoardLinks,
        nkid: nkid[0] ?? null,
      },
    };
  },
  async table(dbRows, q) {
    let req;
    try {
      req = JSON.parse(q.q || "{}");
    } catch {
      return { status: 400, body: { error: "bad q" } };
    }
    try {
      return { body: await runDbTable(dbRows, req) };
    } catch (e) {
      return badRequest(e, "table");
    }
  },
  async facets(dbRows, q) {
    let req;
    try {
      req = JSON.parse(q.q || "{}");
    } catch {
      return { status: 400, body: { error: "bad q" } };
    }
    try {
      return { body: await runDbFacets(dbRows, req) };
    } catch (e) {
      return badRequest(e, "facets");
    }
  },
  // Registry-scale stat cards for the /procurement/ngos header. One round-trip,
  // ~14ms: entity_class counts hit the index, the register total is the pg_class
  // reltuples estimate (exact enough for a headline, no 1M-row scan), and the
  // state-awarder count reads the awarder_totals matview (one row per awarder).
  // OPEN CALLS — what a reader can apply to right now (open_calls, migration 142).
  //
  // Returns three groups in ONE response, because the page renders them as three separate
  // sections and must never merge them (funds-module-v2 §5.2):
  //   calls         — kind='call', status open or upcoming: a real application procedure
  //   indicative    — the ДФЗ forecast window; NO deadline exists yet, so no countdown
  //   consultations — draft guidance out for public COMMENT; applications are not open
  // …plus `crawl`, the per-source freshness stamp the banner reads.
  //
  // DEGRADE SET, and the two codes deliberately NOT in it:
  //   42883 absent FUNCTION · 42P01 absent table · 55000 unpopulated · 55P03 locked → empty page
  //   57014 is the pool's OWN statement_timeout: the probe has already burned the budget, so
  //         falling back cannot finish either and would turn a 10 s failure into a 20 s one.
  //   42501 is a missing GRANT on a PLAIN TABLE, which is permanent, not a refresh artifact
  //         (the 123/124 precedent includes it because those are matviews). Degrading would
  //         serve an empty page for ever instead of failing loudly once.
  // /api/db/funds-procedure-rates — the base-rate card on /funds/procedure/:code (143).
  //
  // A PK seek on `fund_fit` (0.05 ms, 201 buffers), separate from the page's existing
  // `fund-payload` blob because that blob is loaded from committed JSON and this is derived from
  // Postgres — writing one into the other would be generating JSON from PG.
  //
  // Returns the MEDIAN and nothing derived from it. The reference price („5% от медианния грант")
  // is computed client-side, in the open, so a reader can do the division themselves — we have no
  // fee corpus, so „a fair fee is Y" is a verdict we cannot support (plan §8.5-4).
  "funds-procedure-rates": async (dbRows, q) => {
    const code = (s(q, "code") || "").trim();
    if (!code) return { body: null };
    const rows = await dbRows(
      `SELECT procedure_code AS "procedureCode", procedure_name AS "procedureName",
              sample_title AS "sampleTitle", program_name AS "programName",
              project_count AS "projectCount", beneficiary_count AS "beneficiaryCount",
              paid_project_count AS "paidProjectCount",
              total_eur AS "totalEur", grant_eur AS "grantEur", paid_eur AS "paidEur",
              grant_p25 AS "grantP25", grant_median AS "grantMedian", grant_p75 AS "grantP75",
              org_forms AS "orgForms", org_kinds AS "orgKinds", oblasti
         FROM funds_fit_procedure($1)`,
      [code],
    ).catch((e) => {
      if (FIT_DEGRADE.includes(e?.code)) {
        logMissOnce(
          "fpr:not-built",
          "fund_fit is absent or unpopulated — procedure base rates are not being served. Run db:load:funds-fit:pg.",
        );
        return [];
      }
      throw e;
    });
    // NULL, not an empty object: a procedure with no rollup (a code the matview has never seen)
    // must render nothing rather than a card of zeroes, which would read as „nobody applied".
    return { body: rows[0] ?? null };
  },

  // /api/db/funds-wire — the /funds band-0 wire and band-2 news rail (migration 144).
  //
  // ONE ROUTE, TWO SURFACES, because they share the backfill exclusion and are always rendered
  // together — two routes would let the page show a wire saying „372 нови" beside a rail built
  // from a different window.
  //
  // EVERY FIGURE HERE IS AN INGEST WINDOW, and the payload says so. `fund_projects` carries no
  // date columns at all (no signing, start or end date — ИСУН's export publishes none), so „нови"
  // can only ever mean „new to us". The plan's §3.2 rule 2 („event date, not ingest date") was
  // written for the procurement corpus, which has `contracts.date`; here there is nothing to
  // prefer, and the labels have to carry that instead of implying a zero lag.
  "funds-wire": async (dbRows, q) => {
    const days = clampInt(q.days, 30, 1, 365);
    const newsDays = clampInt(q.newsDays, 60, 1, 365);
    const lim = clampInt(q.limit, 4, 1, 10);

    const [wireRows, newsRows, newsBackfill] = await Promise.all([
      dbRows(
        `SELECT checked_on AS "checkedOn", last_change_on AS "lastChangeOn",
                new_projects AS "newProjects", new_eur AS "newEur",
                backfill_days AS "backfillDays", backfill_rows AS "backfillRows",
                open_calls AS "openCalls"
           FROM funds_wire($1)`,
        [days],
      ),
      dbRows(
        `SELECT card, rank, label, sublabel, href,
                amount_eur AS "amountEur", pct
           FROM funds_news($1, $2)`,
        [newsDays, lim],
      ),
      // THE RAIL'S OWN BACKFILL FIGURE, over the RAIL's window. The wire's is over its own, and
      // the two windows differ (30 vs 60 days by default) — measured, the real 81,616-row load
      // sits inside the rail's and outside the wire's, so without this the rail quietly drops
      // 81,616 rows from cards that claim to cover 60 days and nothing on the page says why.
      dbRows(
        `SELECT backfill_days AS "backfillDays", backfill_rows AS "backfillRows"
           FROM funds_backfill($1)`,
        [newsDays],
      ),
    ]).catch((e) => {
      // Same narrow set as the resolver: 42883 first (both are FUNCTIONS, so a database without
      // 144 raises undefined_function), and 57014/42501 deliberately absent.
      if (FIT_DEGRADE.includes(e?.code)) {
        logMissOnce(
          "fw:not-built",
          "funds_wire/funds_news are absent — the /funds wire and news rail are serving nothing. Apply 144_funds_wire.sql.",
        );
        return [[], [], []];
      }
      throw e;
    });

    // Grouped server-side so a consumer cannot render two cards and silently drop the third.
    const news = { newContracts: [], byPlace: [], lowestPaid: [] };
    const KEY = {
      new_contracts: "newContracts",
      by_place: "byPlace",
      lowest_paid: "lowestPaid",
    };
    for (const r of newsRows) {
      const k = KEY[r.card];
      if (k) news[k].push(r);
    }

    return {
      body: {
        wire: wireRows[0] ?? null,
        news,
        // THE WINDOW, DECLARED. „372 нови" means nothing without „за 30 дни", and a caller that
        // hard-coded the label would drift the first time the default changed.
        windowDays: days,
        newsWindowDays: newsDays,
        // Belongs to the NEWS window, not the wire's — see the query above.
        newsBackfill: newsBackfill[0] ?? { backfillDays: 0, backfillRows: 0 },
      },
    };
  },

  // /api/db/funds-fit — „финансирано ли е нещо като моето" (migration 143).
  //
  // (`FIT_DEGRADE` and `OBLAST_CODES` are defined above the registry.)
  //
  // TWO ARMS, NEVER SUMMED, and the BASIS TRAVELS WITH THEM. ИСУН holds zero Interreg projects
  // (Interreg runs on Jems), and Interreg money lands almost entirely on border municipalities —
  // so an ИСУН-only answer tells exactly those readers „nothing like that has been funded near
  // you" while their neighbours hold grants. The `basis` block is returned in the payload rather
  // than left to UI copy, so a consumer that renders one arm cannot present it as the whole corpus.
  //
  // `place` RANKS, IT NEVER FILTERS (see 143): „в твоята област няма, но в страната има 340" is a
  // usable answer and „нищо подобно не е финансирано" is not, and for a resolver that exists to
  // tell someone whether to bother applying, the false negative is the expensive error.
  // The /funds hub's ONE stat call (migration 145). Replaces four per-tile fetches totalling
  // 277 KB, of which /api/db/dual-corpus-rankings alone was 247 KB pulled to draw a preview.
  //
  // Reads the one-row matview, never the live aggregate: measured, that aggregate is 18,855
  // buffers and spills to temp, against the dashboard-hub skill's ~2,000 ceiling for anything
  // served live. The seek is 40.
  //
  // DEGRADES TO NULL on the narrow set only. 42883/42P01 mean 145 was never applied, 55000 that
  // the matview exists WITH NO DATA (the first cloud deploy — 145 creates it that way on
  // purpose), and 55P03 that a REFRESH holds the lock. That last one is not hypothetical here:
  // every funds and Interreg reload refreshes this matview, so its absence made the hub 500 for
  // the duration of each reload's lock window — every sibling route already includes it.
  //
  // 57014 is the pool's own timeout and 42501 a permanent missing GRANT on a plain function:
  // both must 500 rather than render a hub whose every figure is silently absent for ever.
  "funds-hub-stats": async (dbRows) => {
    const rows = await dbRows("SELECT funds_hub_stats() AS r").catch((e) => {
      if (!["42883", "42P01", "55000", "55P03"].includes(e?.code))
        return Promise.reject(e);
      logMissOnce(
        `fhs:not-built:${e.code}`,
        `funds-hub-stats: read failed (${e.code}) — the hub will render without its figures. Run npm run db:load:funds:pg (applies + refreshes 145).`,
      );
      return [{ r: null }];
    });
    return { body: rows[0]?.r ?? null };
  },
  "funds-fit": async (dbRows, q) => {
    const query = (s(q, "q") || "").trim();
    // VALIDATED, not just upper-cased. The value reaches a jsonb key probe and an equality test,
    // so an unrecognised one cannot inject anything — but it CAN silently produce `local_count: 0`
    // on every row, which reads as „nothing near you" rather than as „that is not a place". A
    // rejected value becomes NULL, i.e. „nationwide", which is the honest fallback.
    const rawOblast = (s(q, "oblast") || "").trim().toUpperCase();
    const oblast = OBLAST_CODES.has(rawOblast) ? rawOblast : null;
    const lim = clampInt(q.limit, 6, 1, 20);
    const interregTerm = interregQueryFor(query);

    // The basis degrades on the SAME narrow set as the arms below — not on everything. A bare
    // `.catch(() => [null])` swallowed 57014 (the pool's own timeout) and 42501 (a permanent
    // missing GRANT), so the route would render a resolver with no declared basis instead of
    // failing once and loudly.
    const [basis] = await dbRows(`SELECT * FROM funds_fit_basis()`).catch(
      (e) => {
        if (FIT_DEGRADE.includes(e?.code)) return [null];
        throw e;
      },
    );
    const basisBody = basis
      ? {
          isunProjects: basis.isun_projects,
          isunProcedures: basis.isun_procedures,
          interregOperations: basis.interreg_operations,
          interregPartners: basis.interreg_partners,
          // The Tier-L caveat as a RATIO rather than a sentence, so the caption cannot drift from
          // the data: 2014-2020 Interreg carries no EIK, so an org breakdown over that arm is
          // partial and the page has to say by how much.
          interregWithEik: basis.interreg_with_eik,
        }
      : null;

    if (query.length < FIT_MIN_QUERY)
      return {
        body: {
          q: query,
          isun: [],
          interreg: [],
          interregQuery: null,
          basis: basisBody,
        },
      };

    const [isun, interreg] = await Promise.all([
      dbRows(
        `SELECT procedure_code AS "procedureCode", procedure_name AS "procedureName",
                sample_title AS "sampleTitle", program_name AS "programName",
                project_count AS "projectCount", beneficiary_count AS "beneficiaryCount",
                paid_project_count AS "paidProjectCount",
                total_eur AS "totalEur", grant_median AS "grantMedian",
                grant_p25 AS "grantP25", grant_p75 AS "grantP75",
                org_kinds AS "orgKinds", oblasti, local_count AS "localCount", score
           FROM funds_fit_isun($1, $2, $3)`,
        [query, oblast, lim],
      ),
      dbRows(
        `SELECT keep_id AS "keepId", title, title_is_english AS "titleIsEnglish",
                programme_name AS "programmeName", period,
                bg_budget_eur AS "bgBudgetEur", partner_count AS "partnerCount",
                oblast, obshtina, is_local AS "isLocal", score
           FROM funds_fit_interreg($1, $2, $3)`,
        // BRIDGED, and only on this arm. keep.eu publishes 86% of these titles in English only
        // (272 of 1,954 carry a Bulgarian one), so a Bulgarian query matches almost nothing here —
        // which would make the arm that exists to stop border municipalities being told „nothing
        // near you" invisible to the readers it is for. The bridge is one direction, query only,
        // and `interregQuery` below tells the reader which English term was used.
        [interregTerm.term, oblast, Math.min(lim, 4)],
      ),
    ]).catch((e) => {
      // 42883 first: both arms are FUNCTIONS, so a database without 143 raises undefined_function,
      // never 42P01. 55000 is a matview created WITH NO DATA — the first cloud deploy, before the
      // loader runs. 57014 is deliberately absent: that is the pool's own timeout, so the budget is
      // already spent and a retry cannot finish either.
      if (FIT_DEGRADE.includes(e?.code)) {
        logMissOnce(
          "ff:not-built",
          "fund_fit is absent, empty or locked — the resolver is serving nothing. Run db:load:funds-fit:pg (and :cloud on prod).",
        );
        return [[], []];
      }
      throw e;
    });

    return {
      body: {
        q: query,
        oblast,
        isun,
        interreg,
        // NAMED, not silent. An English row appearing under a Bulgarian query needs an
        // explanation, and a reader who sees „търсено и като „tourism"" can tell the bridge picked
        // the wrong topic — which they cannot do if it happens invisibly. Null when the query was
        // already Latin or no topic matched.
        interregQuery: interregTerm.bridged,
        basis: basisBody,
      },
    };
  },

  "open-calls": async (dbRows, q) => {
    const lim = clampInt(q.limit, 20, 1, 200);
    const audience = s(q, "audience") || null;
    // A per-group query, because ranking once and partitioning afterwards silently starves the
    // narrower tiers — the same failure the hub-search rule documents.
    const group = (status, kind) =>
      dbRows(
        // PROJECTION IS DELIBERATELY NARROW. `docs` (a jsonb array) and `objective` were 37%
        // and 19% of this response respectively and are rendered by nothing — neither the tile
        // nor /funds/calls, whose registry `select` already omits both. This is a HUB payload,
        // paid by every visitor. `status` and `opensAt` stay because the tile marks a
        // not-yet-open call from them; `enrichment` stays because it is the provenance a money
        // figure is only shown under. Add a field back when a consumer renders it.
        `SELECT id, source, source_key AS "sourceKey", code, kind, title,
                programme_name AS "programmeName",
                status, opens_at AS "opensAt", closes_at AS "closesAt",
                period_label AS "periodLabel", days_left AS "daysLeft",
                budget_eur AS "budgetEur",
                aid_rate_pct AS "aidRatePct", grant_max_eur AS "grantMaxEur",
                audience, source_url AS "sourceUrl", enrichment
         FROM open_calls_list($1, $2, $3, NULL, $4)`,
        [status, kind, audience, lim],
      );

    // GROUP TOTALS, and they are not decoration. The tile shows a count beside each section
    // heading and links to /funds/calls; without this it counted the returned ARRAY, so with
    // `limit=20` it announced „отворено сега: 20" next to a browse page showing 45 — two numbers
    // for one fact, and the smaller one on the page a reader sees first.
    //
    // Counted THROUGH open_calls_list() rather than with a second WHERE over the view, so the
    // count and the list cannot disagree: they run the identical predicate, including the
    // audience filter.
    //
    // NULL as the limit means UNBOUNDED (142). A number would be clamped by the function's own
    // `LEAST(p_limit, 2000)` and the total would silently saturate there once a group grew —
    // which on a table the loader never deletes from is a question of when, not if.
    //
    // ONE round trip, four scalar subqueries. As four separate queries this route issued nine
    // against a pool of four, so they ran in ~3 waves; the counts are also the cheap half, so
    // paying a wave for them was the wrong trade.
    const totalsQuery = dbRows(
      `SELECT (SELECT count(*) FROM open_calls_list('open', 'call', $1, NULL, NULL))::int
                + (SELECT count(*) FROM open_calls_list('upcoming', 'call', $1, NULL, NULL))::int
                AS calls,
              (SELECT count(*) FROM open_calls_list('indicative', 'call', $1, NULL, NULL))::int
                AS indicative,
              (SELECT count(*) FROM open_calls_list('consultation', 'consultation', $1, NULL, NULL))::int
                AS consultations`,
      [audience],
    );

    const [calls, upcoming, indicative, consultations, crawl, totalRows] =
      await Promise.all([
        group("open", "call"),
        group("upcoming", "call"),
        group("indicative", "call"),
        group("consultation", "consultation"),
        dbRows(
          `SELECT source, crawled_at AS "crawledAt", rows_seen AS "rowsSeen", ok, note
         FROM open_calls_crawl ORDER BY source`,
        ),
        totalsQuery,
      ]).catch((e) => {
        // 42883 FIRST, and it is the one that matters: the four group queries call
        // open_calls_list(), a FUNCTION, so a database without migration 142 raises
        // 42883 undefined_function — never 42P01. Only the crawl-stamp query reads a table
        // directly, and with the pool at max 4 it has not even been dispatched when the first
        // 42883 returns. Omitting 42883 therefore made this whole branch UNREACHABLE in exactly
        // the case it exists for (first cloud deploy, loader not yet run). The repo's own
        // missingMigrationEmpty pairs the two codes for this reason.
        if (["42883", "42P01", "55000", "55P03"].includes(e?.code)) {
          logMissOnce(
            "oc:not-built",
            "open_calls is absent, empty or locked — serving an empty page. Run db:load:open-calls:pg (and :cloud on prod).",
          );
          // One empty array per destructured position — four groups, the crawl stamps and the
          // totals row. A short array would leave `totalRows` undefined and throw on `[0]`,
          // turning the degrade path into the 500 it exists to avoid.
          return [[], [], [], [], [], []];
        }
        throw e;
      });

    const tot = totalRows[0] ?? {};
    return {
      body: {
        // open first, then not-yet-opened: both are real calls and share a section. Each row
        // carries its own `status`, so the client marks the not-yet-open ones rather than
        // letting them read as open — the merge is a layout decision, not a claim.
        calls: [...calls, ...upcoming],
        indicative,
        consultations,
        crawl,
        // The `calls` total sums the two statuses that group merges, so the heading count and
        // the rows under it describe the same set.
        totals: {
          calls: tot.calls ?? 0,
          indicative: tot.indicative ?? 0,
          consultations: tot.consultations ?? 0,
        },
      },
    };
  },

  "ngo-stats": async (dbRows) => {
    // NGOs carrying ≥1 signal runs as its OWN guarded query: a `FROM ngo_signals`
    // reference is resolved at parse time, so an in-SQL to_regclass CASE can't
    // gate it — a missing (42P01) or unpopulated (55000) matview would 500 the
    // whole card. Mirror the company route's per-source .catch degradation.
    const [rows, signalRows] = await Promise.all([
      dbRows(
        `SELECT
           (SELECT count(*)::int FROM tr_companies WHERE entity_class = 'ngo_assoc')      AS assoc,
           (SELECT count(*)::int FROM tr_companies WHERE entity_class = 'ngo_found')      AS found,
           (SELECT count(*)::int FROM tr_companies WHERE entity_class = 'chitalishte')    AS chitalishte,
           (SELECT count(*)::int FROM tr_companies WHERE entity_class = 'foreign_branch') AS foreign_branch,
           (SELECT reltuples::bigint FROM pg_class WHERE relname = 'tr_companies')        AS tr_companies,
           (SELECT count(*)::int FROM awarder_totals)                                     AS state_awarders,
           (SELECT count(DISTINCT eik)::int FROM ngo_funding WHERE eik IS NOT NULL)       AS ngos_funded,
           (SELECT COALESCE(ROUND(SUM(amount_eur)), 0) FROM ngo_funding WHERE eik IS NOT NULL) AS external_eur
         `,
      ),
      dbRows(
        "SELECT count(*)::int AS n FROM ngo_signals WHERE signal_count > 0",
      ).catch((e) =>
        ["42P01", "55000"].includes(e?.code) ? [{ n: 0 }] : Promise.reject(e),
      ),
    ]);
    return {
      body: { ...(rows[0] ?? {}), ngos_with_signal: signalRows[0]?.n ?? 0 },
    };
  },
  async tenders(dbRows, q) {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const limit = clampInt(q.limit, 25, 1, 200);
    const sort = s(q, "sort") === "value" ? "value" : "date";
    const [summary, recent] = await Promise.all([
      dbRows("SELECT * FROM tenders_buyer_summary($1)", [eik]),
      dbRows("SELECT * FROM tenders_by_buyer($1, $2, $3)", [eik, limit, sort]),
    ]);
    return { body: { eik, summary: summary[0] ?? null, recent } };
  },
  // Single tender by УНП or ocid → { tender: <FE Tender shape>, awards[] } in
  // one call (tender_detail, 032). Serves both /tenders/:unp and the
  // contract→tender lineage tile.
  async tender(dbRows, q) {
    const ocid = s(q, "ocid");
    const unp = s(q, "unp");
    if (!ocid && !unp)
      return { status: 400, body: { error: "missing ocid or unp" } };
    // КЗК appeals key on the УНП (exact join). On the hot ?unp= path (every
    // fact-check link) the unp is known up front, so fetch appeals in parallel
    // with the detail; only the ocid-only lineage tile needs the sequential
    // fallback (unp comes from the detail result).
    const [rows, appealsPre] = await Promise.all([
      dbRows("SELECT tender_detail($1, $2) AS r", [unp || null, ocid || null]),
      unp
        ? dbRows("SELECT tender_appeals($1) AS r", [unp]).catch(appealsOrEmpty)
        : Promise.resolve(null),
    ]);
    const detail = rows[0]?.r ?? { tender: null, awards: [] };
    let appeals = appealsPre ? (appealsPre[0]?.r ?? []) : [];
    if (!unp && detail.tender?.unp) {
      appeals =
        (
          await dbRows("SELECT tender_appeals($1) AS r", [
            detail.tender.unp,
          ]).catch(appealsOrEmpty)
        )[0]?.r ?? [];
    }
    return { body: { ...detail, appeals } };
  },
  async connection(dbRows, q) {
    const a = s(q, "a");
    const b = s(q, "b");
    if (!a || !b) return { status: 400, body: { error: "missing a or b" } };
    return {
      body: {
        a,
        b,
        shared: await dbRows("SELECT * FROM connection_between($1, $2)", [
          a,
          b,
        ]),
      },
    };
  },
  // Company ↔ person connection check: direct roles + 1-hop bridges
  // (company_connection) AND the shortest multi-hop path up to 3 degrees.
  "company-connection": async (dbRows, q) => {
    const eik = s(q, "eik");
    const name = s(q, "name");
    if (!eik || !name)
      return { status: 400, body: { error: "missing eik or name" } };
    const [conn, path] = await Promise.all([
      dbRows("SELECT company_connection($1, $2) AS r", [eik, name]),
      dbRows("SELECT company_person_path($1, $2, 3) AS r", [eik, name]),
    ]);
    const c = conn[0]?.r ?? { direct: [], shared: [] };
    return {
      body: {
        direct: c.direct ?? [],
        shared: c.shared ?? [],
        path: path[0]?.r ?? null,
      },
    };
  },
  // Sector competitors — lazy per-division.
  "sector-peers": async (dbRows, q) => {
    const division = s(q, "division");
    if (!division) return { status: 400, body: { error: "missing division" } };
    // eik is OPTIONAL. With it, the caller's company is flagged isSelf and
    // pulled in even if outside the division's top 8 (company page). Without it
    // (the state-wide /procurement/sectors page), s() yields "" — no contractor
    // matches, so the top 8 come back unflagged.
    const eik = s(q, "eik");
    // Optional date window (?from/?to, from ?pscope): when set, rank live within
    // the window so the panel matches the window-scoped division totals; corpus
    // scope (no window) uses the fast precomputed matview.
    const from = orNull(q, "from");
    const to = orNull(q, "to");
    const rows =
      from || to
        ? await dbRows("SELECT sector_peers_window($1, $2, $3, $4) AS r", [
            division,
            eik,
            from,
            to,
          ])
        : await dbRows("SELECT sector_peers($1, $2) AS r", [division, eik]);
    return { body: rows[0]?.r ?? { division, peers: [] } };
  },
  async search(dbRows, q) {
    const term = s(q, "q");
    if (!term) return { status: 400, body: { error: "missing q" } };
    return {
      body: {
        q: term,
        results: await dbRows("SELECT * FROM search_all($1, $2)", [
          term,
          clampInt(q.limit, 30, 1, 100),
        ]),
      },
    };
  },
  // Single contract by key → ProcurementContract shape.
  contract: async (dbRows, q) => {
    const key = s(q, "key");
    if (!key) return { status: 400, body: { error: "missing key" } };
    // Degrade to the base contracts table so /contract/:key still renders on a
    // partially-migrated database. TWO codes, not one:
    //   42P01 undefined_table  — contracts_list absent (042 not applied)
    //   42703 undefined_column — contracts_list EXISTS but predates 112, so it
    //                            has no risk_* columns. contracts_list is a
    //                            `SELECT c.*` view whose column list freezes at
    //                            creation, so this is the ordinary state of any
    //                            DB where the function deployed before the
    //                            migration ran — the exact ordering CLAUDE.md
    //                            warns about. Without 42703 every /contract/:key
    //                            500s until someone re-runs the rebuild.
    const rows = await dbRows(CONTRACT_SQL, [key]).catch((e) =>
      e?.code === "42P01" || e?.code === "42703"
        ? dbRows(CONTRACT_SQL_BASE, [key])
        : Promise.reject(e),
    );
    return { body: { contract: rows[0] ?? null } };
  },
  // Per-annex breakdown for one contract (migration 114) — the itemised
  // modifications behind its signing→current move: how many annexes, each Δ, and
  // the ЗОП ground. Answers "one annex at the cap, or several summing to it?".
  // Degrades to an empty payload on a DB predating the migration.
  "contract-annexes": async (dbRows, q) => {
    const key = s(q, "key");
    if (!key) return { status: 400, body: { error: "missing key" } };
    const rows = await dbRows("SELECT contract_annexes($1) AS r", [key]).catch(
      missingMigration({ annexCount: 0, rows: [] }),
    );
    return { body: rows[0]?.r ?? { annexCount: 0, rows: [] } };
  },
  // "How normal is this procurement?" — one contract positioned in its cohort of
  // similar procurements (adaptive-CPV-prefix, era-matched) across value, bidder
  // count, procedure mix, and supplier concentration. Descriptive context, not a
  // verdict — the companion to the per-contract CRI. Degrades to an empty payload
  // (missingMigrationEmpty → [], no cohort/concentration) on a DB predating
  // migration 063; both consumers treat that like the no-data case.
  "procurement-normalcy": async (dbRows, q) => {
    const key = s(q, "key");
    if (!key) return { status: 400, body: { error: "missing key" } };
    // Fast path: the precomputed matview (064) — one PK seek (~0.1ms) vs the live
    // function's ~290ms warm / 6-12s cold big-division scan. Fall back to the
    // live function for a key not yet in the cache (freshly ingested between
    // refreshes) or a DB predating the matview.
    try {
      const c = await dbRows(
        "SELECT payload FROM procurement_normalcy_cache WHERE key = $1",
        [key],
      );
      if (c[0]?.payload !== undefined) return { body: c[0].payload };
    } catch {
      // matview absent — fall through to the live computation
    }
    const rows = await dbRows("SELECT procurement_normalcy($1) AS r", [
      key,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // "How typical is this tender?" — cohort-distribution payload for one tender
  // (067). Cache-first PK seek on УНП; live fn fallback for a tender not yet in
  // the matview (freshly ingested) or a DB predating the migration.
  // The ЦАИС ЕОП DOSSIER for one procedure — plan A7. Everything the register
  // publishes beyond the notice header: the long description (mean ~1.6k chars vs
  // tenders.subject's 138), the contact officer, the attachment manifest, the
  // parsed обявление, the award-stage trail, and contract lineage.
  //
  // Degrades to `null` on a database where 146 has not been applied, so the page
  // and the deploy are order-independent — same posture as procurement_settlement.
  // How much of the tender corpus the B3 document search can actually see.
  //
  // ⚠️ THE POINT IS THAT THIS IS SMALL. The dossier crawl is ~26 h and has run for a
  // sample — 1,861 of 237,321 procedures at the time of writing. Any UI that says it
  // searched documents MUST say how much: "no results" from a 0.78%-covered index
  // reads as "no such tender", which is the failure this repo keeps rediscovering
  // (the "0 complaints" parser regression, the „част от" coverage-line rule).
  //
  // Two live numbers, never a constant — the fraction moves in both directions as
  // the crawl advances and as the tenders corpus grows. Degrades to nulls rather
  // than 500ing on a database where 147 has not been applied: a page that cannot
  // state its coverage should omit the claim, not fail.
  // Provenance of the served risk masks: which flag-catalogue version the last
  // rebuild_contract_risk_cache() ran under, and when.
  //
  // ⚠️ The methodology page MUST render this rather than the version compiled
  // into the bundle. The bundle says what the code declares; every flag a reader
  // sees came out of contract_risk_cache, and the two diverge for the whole
  // window between a deploy and a cache rebuild (on the cloud side an explicit,
  // easily-skipped operator step). A page citing the bundle's version over older
  // masks makes a claim we could not walk back.
  //
  // `version: null` means NOT STAMPED — either the database predates
  // contract_risk_meta, or the last rebuild used the unstamped overload. It is
  // NOT a failure and must not be rendered as one; it means the served flags
  // cannot be attributed to a catalogue version at all, and the page says so.
  "risk-catalog-version": async (dbRows) => {
    const rows = await dbRows(
      `SELECT catalog_version, rebuilt_at, row_count
         FROM contract_risk_meta
        WHERE only_row`,
      [],
    ).catch(missingMigrationRows);
    const r = rows[0];
    return {
      body: {
        version: r?.catalog_version ?? null,
        rebuiltAt: r?.rebuilt_at ?? null,
        rowCount: r?.row_count == null ? null : Number(r.row_count),
      },
    };
  },

  "tender-search-coverage": async (dbRows) => {
    const rows = await dbRows(
      "SELECT covered, corpus FROM tender_search_coverage()",
      [],
    ).catch(missingMigrationEmpty);
    const r = rows[0];
    if (!r) return { body: { covered: null, corpus: null, pct: null } };
    const covered = Number(r.covered);
    const corpus = Number(r.corpus);
    return {
      body: {
        covered,
        corpus,
        // Rounded to 2dp so a genuinely tiny share never renders as a bare "0%",
        // which reads as "nothing indexed" rather than "a small sample".
        pct: corpus > 0 ? Math.round((covered / corpus) * 10000) / 100 : null,
      },
    };
  },

  "tender-dossier": async (dbRows, q) => {
    const unp = s(q, "unp");
    if (!unp) return { status: 400, body: { error: "missing unp" } };
    try {
      const [d] = await dbRows(
        `SELECT unp, tender_id, organization_id, description_text,
                offer_phase_start, offer_phase_end, opening_of_offers, source_url
           FROM tender_dossier WHERE unp = $1`,
        [unp],
      );
      if (!d) return { body: null };
      const [docs, notices, anns, contracts, buyer] = await Promise.all([
        dbRows(
          `SELECT document_id, source, name, ext, size_bytes, kind, created_at
             FROM tender_document WHERE unp = $1
            ORDER BY source, kind NULLS LAST, name`,
          [unp],
        ),
        dbRows(
          `SELECT publication_id, form_type, notice_no, is_eforms, bt_count,
                  buyer_legal_category, buyer_activity, award_criteria,
                  selection_criteria, duration_value, offer_deadline_date,
                  offer_deadline_time
             FROM tender_notice WHERE unp = $1 ORDER BY bt_count DESC`,
          [unp],
        ),
        dbRows(
          `SELECT announcement_id, title, created_at
             FROM tender_announcement WHERE unp = $1 ORDER BY created_at`,
          [unp],
        ),
        dbRows(
          `SELECT contract_id, subject, value_native, current_value_native,
                  start_date, end_date, suppliers
             FROM tender_contract_item WHERE unp = $1 ORDER BY contract_id`,
          [unp],
        ),
        d.organization_id
          ? dbRows(
              `SELECT organization_id, eik, name, city, postcode, street
                 FROM tender_buyer_profile WHERE organization_id = $1`,
              [d.organization_id],
            )
          : Promise.resolve([]),
      ]);
      return {
        body: {
          ...d,
          documents: docs,
          notices,
          announcements: anns,
          contracts,
          buyer: buyer[0] ?? null,
        },
      };
    } catch (e) {
      // 42P01 — migration 146 not applied on this database yet.
      if (e && e.code === "42P01") return { body: null };
      throw e;
    }
  },

  // Redirect to one published document at the register.
  //
  // ⚠️ THIS IS AN UNAUTHENTICATED INDIRECTION TO A THIRD-PARTY HOST, parameterised
  // by an integer the caller supplies — so the id is VALIDATED AGAINST
  // tender_document before anything is signed. Without that check, any documentId
  // in the register (including ones we never published a link to) becomes fetchable
  // through our domain, which is an open redirect with our name on it.
  //
  // We deliberately do NOT proxy the bytes: the register hosts them, the corpus is
  // ~3.65 TB (plan §12), and streaming them through this function would put its
  // egress and its latency on every download.
  "tender-document": async (dbRows, q) => {
    // Per-instance cache of the signed URL. It is valid 1800 s; re-signing on every
    // click adds an outbound round-trip to the register on the hot path and holds a
    // Cloud Run slot for up to 8 s each time. Expire well short of the real TTL so a
    // handed-out URL is never close to death.
    const raw = s(q, "id");
    // Reject anything that is not a plain positive integer BEFORE it reaches SQL
    // or the register.
    // ⚠️ 15 digits, not 18. The value is re-parsed with Number() below, which is
    // lossy past 2^53 — an 18-digit id could therefore validate as one value and be
    // SIGNED as another, defeating the whole point of checking it first. Real ids
    // are ~8 digits, so this costs nothing and closes the gap.
    if (!raw || !/^[0-9]{1,15}$/.test(raw))
      return { status: 400, body: { error: "bad id" } };
    let known;
    try {
      known = await dbRows(
        "SELECT document_id, name FROM tender_document WHERE document_id = $1",
        [raw],
      );
    } catch (e) {
      if (e && e.code === "42P01")
        return { status: 404, body: { error: "no document index" } };
      throw e;
    }
    // Not one of ours: refuse rather than sign it. This is the open-redirect gate.
    if (!known.length)
      return { status: 404, body: { error: "unknown document" } };

    const cached = SIGNED_URL_CACHE.get(raw);
    if (cached && cached.until > Date.now()) return { redirect: cached.url };

    let signed;
    try {
      const r = await fetch(
        "https://service.eop.bg/NX1Service.svc/GetSignedUrlByDocumentId",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://app.eop.bg",
            "User-Agent": "electionsbg.com (procurement/tender-document)",
          },
          body: JSON.stringify({ documentId: Number(raw) }),
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!r.ok) throw new Error(`sign ${r.status}`);
      signed = await r.json();
    } catch (e) {
      // The register is a dependency of every click here; say so plainly rather
      // than 500ing, so the page can offer the app.eop.bg link instead.
      console.warn("tender-document sign failed", (e && e.message) || e);
      return { status: 502, body: { error: "register unavailable" } };
    }
    const url = signed && signed.Url;
    // ⚠️ ALLOWLIST THE TARGET HOST. The register hands us a URL; redirecting to
    // whatever it says would make this an open redirect the moment that response
    // is ever wrong or tampered with. The check stays — only the list widens.
    //
    // TWO HOSTS, not one. The register runs two blob stores and picks by document
    // age: `BlobStorageId: 3` → storage.eop.bg (current), `BlobStorageId: 2` →
    // blob.eop.bg/live/ (older documents). A storage.eop.bg-only check was measured
    // rejecting every pre-migration document — verified against the 2022 procedure
    // 00006-2022-0007, whose файлове all sign to blob.eop.bg and which therefore
    // 502'd on every link.
    // Anchored at BOTH ends: without `$` a trailing CR/LF passes the test and
    // reaches a raw setHeader in the dev server (Express escapes it in prod, so
    // this would have been a dev-only hang — the worst kind to debug).
    if (!url || !/^https:\/\/(storage|blob)\.eop\.bg\/[^\s]*$/.test(url))
      return { status: 502, body: { error: "unexpected signed url" } };
    if (SIGNED_URL_CACHE.size > SIGNED_URL_CACHE_MAX) SIGNED_URL_CACHE.clear();
    SIGNED_URL_CACHE.set(raw, { url, until: Date.now() + SIGNED_URL_TTL_MS });
    return { redirect: url };
  },

  "tender-normalcy": async (dbRows, q) => {
    const unp = s(q, "unp");
    if (!unp) return { status: 400, body: { error: "missing unp" } };
    try {
      const c = await dbRows(
        "SELECT payload FROM tender_normalcy_cache WHERE unp = $1",
        [unp],
      );
      if (c[0]?.payload !== undefined) return { body: c[0].payload };
    } catch {
      // matview absent — fall through to the live computation
    }
    const rows = await dbRows("SELECT tender_normalcy($1) AS r", [unp]).catch(
      missingMigrationEmpty,
    );
    return { body: rows[0]?.r ?? null };
  },
  // CPV catalogue — distinct named CPV codes (from the tenders feed's cpv_desc,
  // the only place we carry code→name beyond the 2-digit division titles). Feeds
  // the searchable CPV filter on the contracts browser (~3.6k codes, cached).
  // Reads the materialised cpv_catalog (121), rebuilt by load_tenders_pg.
  //
  // It used to run DISTINCT ON over the whole `tenders` corpus per request — a
  // full scan plus an external-merge sort, 130 ms locally but MEASURED at 17.7 s
  // and 20.8 s on two consecutive prod calls, one of which 500'd. Both the
  // contracts and the tenders browser fetch this on mount, so that was on the
  // critical path of two of the busiest pages.
  "cpv-catalog": async (dbRows) => {
    // NO missing-migration catch. Turning a 42P01 into an empty array is what
    // made the old failure invisible: an empty CPV picker served with a 200 is
    // indistinguishable from a corpus with no CPV codes. The table must exist
    // before this route ships — apply 121 and run db:load:tenders:pg BEFORE
    // deploy:db, the migration-before-writer order CLAUDE.md already requires —
    // and if it does not, a 500 is the honest answer.
    const rows = await dbRows(
      `SELECT cpv, "desc" FROM cpv_catalog ORDER BY cpv`,
      [],
    );
    return { body: rows };
  },
  // Risk-signals feed — top concentration + top MP-tied + headline counts +
  // per-oblast tally, window-scoped or full corpus.
  "procurement-risk-feed": async (dbRows, q) => {
    const rows = await dbRows("SELECT procurement_risk_feed($1, $2) AS r", [
      orNull(q, "from"),
      orNull(q, "to"),
    ]);
    return { body: rows[0]?.r ?? null };
  },
  // Public-money scanner — the full political-class (MP + official) procurement
  // index, window-scoped or full corpus.
  "procurement-scanner": async (dbRows, q) => {
    const rows = await dbRows("SELECT procurement_scanner($1, $2) AS r", [
      orNull(q, "from"),
      orNull(q, "to"),
    ]);
    return { body: rows[0]?.r ?? null };
  },
  // By-place: local-tier settlements + national card, window-scoped or full corpus.
  "procurement-by-settlement": async (dbRows, q) => {
    const from = orNull(q, "from");
    const to = orNull(q, "to");
    // Full-corpus scope → cache matview (030); the live aggregate is ~388ms.
    if (!from && !to) {
      try {
        const c = await dbRows(
          "SELECT r FROM procurement_by_settlement_cache",
          [],
        );
        if (c[0]?.r) return { body: c[0].r };
      } catch {
        // matview absent — fall through to the live computation
      }
    }
    const rows = await dbRows("SELECT procurement_by_settlement($1, $2) AS r", [
      from,
      to,
    ]);
    return { body: rows[0]?.r ?? null };
  },
  // The by-settlement page's maps + header: the four KPI tiles, the "national procurement"
  // card, and the ≤32-row per-oblast aggregate the three choropleths colour. Everything on
  // that page EXCEPT the ranking table, which is served by the `procurement_settlements`
  // DbDataTable resource.
  //
  // Precomputed per pscope (119), so this is a primary-key seek rather than the ~390 ms
  // live aggregate the page used to run on every cache miss. Falls back to computing the
  // window live when the scope has no precomputed row — a just-added election, or a cloud
  // database where db:load:procurement-scopes:pg:cloud has not been run yet — so the page
  // degrades to "slow" rather than to "empty".
  // Precomputed per pscope (119), so this is a primary-key seek rather than the ~390 ms
  // live aggregate the page used to run on every cache miss.
  //
  // NO LIVE FALLBACK, deliberately. An earlier draft recomputed the payload for a scope
  // with no row; it was removed because (a) it duplicated 119's payload SQL verbatim, which
  // 119's own header forbids for exactly the drift reason, (b) without that file's
  // AS MATERIALIZED fence it ran 4-5× slower — 3.3 s for the full corpus against a 10 s
  // statement_timeout — and (c) it was unreachable anyway: one loader command writes the
  // scope rows AND refreshes both matviews, so a scope either has a payload or does not
  // exist. A missing scope is an operational error (the loader was not run on this
  // database), not a slow path.
  "procurement-geo": async (dbRows, q) => {
    const scope = s(q, "scope") || "all";
    // missingMigrationRows, NOT missingMigrationEmpty: the latter's [{r:[]}] sentinel is
    // TRUTHY, so `rows[0]` would pass and `rows[0].payload` (undefined) would be served as
    // the body — an empty map under a confident heading.
    const rows = await dbRows(
      "SELECT payload FROM procurement_geo_payloads WHERE scope_key = $1",
      [scope],
    ).catch(missingMigrationRows);
    // 404 rather than a 200 carrying null: /api/db responses are CDN-cached for an hour
    // with a 24 h stale-while-revalidate, so a transient "loader hasn't run yet" null would
    // be pinned at the edge long after the data landed.
    if (!rows[0]?.payload)
      return { status: 404, body: { error: "unknown or unbuilt scope" } };
    return { body: rows[0].payload };
  },
  // Per-settlement detail (awarders + top contracts + by-year).
  // Per-settlement procurement detail. Two shapes, trimmed HERE rather than by a SQL
  // parameter — NOT because the function is hard to change (it is not: all three of 030's
  // dependent matviews hang off procurement_by_settlement, the LIST function, and 030
  // already DROPs this one outright on every load). The reason is rollout: the route
  // trims on whatever database it is pointed at, so the saving lands the moment the
  // function deploys, without waiting for a Cloud SQL reload to reshape the SQL.
  //
  //   default    — totals + every buyer, for /procurement/settlement/:ekatte.
  //   ?slim=1    — totals + the top few buyers, for the My-Area and settlement TILES,
  //                which render five rows and were paying for all 327 of София's.
  //
  // `topContracts` is dropped from BOTH: the page that used it now has a sortable
  // contracts table (sort by value), and no other consumer reads it. It was ~13 KB of
  // the payload — the single largest dead item measured in the plan's §1.2.
  "procurement-settlement": async (dbRows, q) => {
    const ekatte = s(q, "ekatte");
    if (!ekatte) return { status: 400, body: { error: "missing ekatte" } };
    const from = orNull(q, "from");
    const to = orNull(q, "to");

    // Served from the per-scope precompute (123) when the requested window IS one of the
    // scopes, because the live function is a GROUP BY over the settlement's whole contract
    // set: 401 ms locally for София and 10.009 s on a cold Cloud SQL buffer cache, which is
    // the 10 s statement_timeout exactly — it returned 500.
    //
    // IS NOT DISTINCT FROM, not `=`. Two of the thirty scopes carry a NULL bound and they
    // are the two that matter: `all` (both NULL, what the AI tools send) and the NEWEST
    // parliament (open-ended upper bound, the page DEFAULT). The client omits the parameter
    // entirely when a bound is null, so both arrive here as NULL — and `date_from = NULL` is
    // never true. With `=` this whole change would serve precomputed rows only for the `y:`
    // scopes, leaving София timing out on exactly the request that motivated it, while a
    // spot check of any single year passed.
    //
    // LEFT JOIN so the miss reasons stay distinguishable, and `built` to separate the two
    // that look identical from the payload alone. "This scope holds no rows AT ALL" means
    // the matview was never built for it and warns immediately; "no row for THIS ekatte"
    // cannot be judged from the probe, because only 869 of the ~5,400 settlements have a
    // seated buyer and every settlement tile asks for the corpus window whatever place the
    // reader picked — so it is deferred to the live call, which separates the benign case
    // from a partial matview for free (see `builtButMissing` below). `built` is an
    // index-only EXISTS on idx_psp_scope_ekatte.
    // ORDER BY + LIMIT 1 for determinism only — scope windows are unique.
    let r = null;
    // The scope whose stored row was absent even though the matview holds rows for it —
    // null unless the probe landed in exactly that state. Resolved after the live call.
    let builtButMissing = null;
    try {
      const hit = await dbRows(
        `SELECT sc.scope_key, p.payload AS r,
                EXISTS (SELECT 1 FROM procurement_settlement_payloads x
                         WHERE x.scope_key = sc.scope_key) AS built
           FROM procurement_scopes sc
           LEFT JOIN procurement_settlement_payloads p
             ON p.scope_key = sc.scope_key AND p.ekatte = $1
          WHERE sc.date_from IS NOT DISTINCT FROM $2
            AND sc.date_to   IS NOT DISTINCT FROM $3
          ORDER BY sc.sort_ord
          LIMIT 1`,
        [ekatte, from, to],
      );
      if (!hit.length) {
        // Keyed on a CONSTANT, not on the window: `from`/`to` are raw query parameters, and
        // keying on them would let any caller grow this Set and this log without bound. The
        // first such window is named in the message, which is all the diagnosis needs.
        logMissOnce(
          "psp:no-scope",
          `procurement-settlement: [${logSafe(from)} , ${logSafe(to)}) is not a precomputed scope — serving live. (Logged once; later unmatched windows are silent.)`,
        );
      } else if (!hit[0].r && !hit[0].built) {
        logMissOnce(
          `psp:not-built:${hit[0].scope_key}`,
          `procurement-settlement: procurement_settlement_payloads holds no rows for scope ${hit[0].scope_key} — serving live. Run db:load:procurement-scopes:pg.`,
        );
      } else if (!hit[0].r) {
        // Scope matched, matview BUILT, no row for this ekatte. Cannot be judged here —
        // it is the ordinary case for the ~4,500 settlements with no seated buyer, and
        // the defect for a seated one the build skipped. Remember it and decide AFTER the
        // live call, which separates the two for free: see the `builtButMissing` check
        // below. Warning here would emit a line per unseated settlement a crawler walks.
        builtButMissing = hit[0].scope_key;
      }
      r = hit[0]?.r ?? null;
    } catch (e) {
      // NARROW, like missingMigrationRows above. Degrade only for the states where the live
      // path is genuinely the better answer: the matview absent (42P01, a database that has
      // not run the loader), NOT POPULATED (55000, DDL applied but never REFRESHed — reading a
      // matview created WITH NO DATA raises object_not_in_prerequisite_state, it does NOT
      // return zero rows), unreadable (42501, default privileges never applied), or locked
      // by a plain REFRESH (55P03 lock_not_available). A pool or connection error is NOT one of
      // these — retrying it as a second, heavier query just doubles the load on a saturated
      // pool, so it rethrows. 57014 (statement_timeout) is deliberately absent for the same
      // reason — see the note on scopedPayload's catch above.
      //
      // Deliberately UNLIKE cpv_catalog, where degrading yields a WRONG answer (an empty
      // picker) rather than a slow one, and so must fail loudly instead.
      if (!["42P01", "55000", "42501", "55P03"].includes(e?.code)) throw e;
      logMissOnce(
        `psp:read-failed:${e.code}`,
        `procurement-settlement: precompute read failed (${e.code}) — serving live.`,
      );
    }

    if (!r) {
      const rows = await dbRows(
        "SELECT procurement_settlement_detail($1, $2, $3) AS r",
        [ekatte, from, to],
      );
      r = rows[0]?.r ?? null;
      // THE ONE MISS THE PROBE CANNOT CLASSIFY ON ITS OWN, resolved by what the live call
      // returned. 123 fans over exactly `awarder_seats WHERE source='geo' AND is_local_hq`,
      // and procurement_settlement_detail() returns NULL for precisely the settlements
      // outside that set — so the two outcomes mean opposite things:
      //
      //   live → NULL      no seated buyer. The ordinary case, ~4,500 settlements, and
      //                    CHEAP (the function exits before the GROUP BY). Silent.
      //   live → a payload the settlement IS seated, so 123 should hold a row for it and
      //                    does not. That is a PARTIAL matview — an interrupted refresh, a
      //                    fan-out that skipped rows — and it is the expensive path: this
      //                    is the shape that produced the 10.009 s statement_timeout 500s
      //                    on София this migration exists to end.
      //
      // Without this the second case is indistinguishable from the first: `built` is true so
      // psp:not-built cannot fire, the scope matched so psp:no-scope cannot, and the read
      // did not throw so psp:read-failed cannot. The page keeps serving correct numbers
      // slowly until it stops serving them at all — with nothing in the logs, which is
      // exactly the state CLAUDE.md says every skipped fast path must not be in.
      //
      // Keyed on the SCOPE, not the ekatte, for the reason psp:no-scope is keyed on a
      // constant: `ekatte` is a caller-supplied parameter. It is validated as five digits
      // by the client but NOT here, so keying on it would let a crawler grow this Set
      // without bound. Thirty scopes is a bounded key space; the first offending ekatte is
      // named in the message, which is what the diagnosis needs.
      if (r && builtButMissing) {
        logMissOnce(
          `psp:row-missing:${builtButMissing}`,
          `procurement-settlement: scope ${builtButMissing} is built but holds no row for a SEATED settlement (ekatte ${logSafe(ekatte)}) — served live. procurement_settlement_payloads is partial; re-run db:load:procurement-scopes:pg.`,
        );
      }
    }
    if (!r) return { body: null };

    // Still destructured away even though the SQL no longer builds it: a database that
    // has not yet re-run db:load:pg still returns the old shape, and this makes the two
    // indistinguishable to the client.
    const { topContracts: _dropped, ...rest } = r;
    const awarders = Array.isArray(rest.awarders) ? rest.awarders : [];
    rest.awarders = awarders;
    // ALWAYS present, in both shapes. The tiles show it as their "Възложители" KPI and
    // used to read `awarders.length` — which a truncated list would silently turn into
    // "5 buyers" for every settlement in the country.
    const body = { ...rest, awarderCount: awarders.length };
    // Parsed as a real boolean: `s()` returns a trimmed string, so a bare `?slim` (empty
    // value) would read as OFF while `?slim=0` and `?slim=false` would read as ON —
    // inverted for both spellings a caller would reach for first.
    const slimRaw = s(q, "slim").toLowerCase();
    const slim =
      "slim" in q && slimRaw !== "0" && slimRaw !== "false" && slimRaw !== "no";
    if (!slim) return { body };

    const limit = clampInt(q.limit, 5, 1, 50);
    return { body: { ...body, awarders: awarders.slice(0, limit) } };
  },
  // Money-flow Sankey (awarder → politician-tied contractor → mp|official).
  // Served from the per-scope precompute (124) — see scopedPayload. This is the route that
  // 500'd with NO window at all: procurement_flow(NULL,NULL) touches ~393,851 buffers (3.2 GB)
  // against a db-g1-small's 1.7 GB of RAM, so it can never be cache-resident there.
  "procurement-flow": async (dbRows, q) => {
    const from = orNull(q, "from");
    const to = orNull(q, "to");
    const hit = await scopedPayload(dbRows, "flow", from, to);
    if (hit) return { body: hit };
    const rows = await dbRows("SELECT procurement_flow($1, $2) AS r", [
      from,
      to,
    ]);
    return { body: rows[0]?.r ?? null };
  },
  // Single-supplier concentration cases (buyer→supplier ≥30%, buyer ≥€100k).
  // Served from the per-scope precompute (124). Heaviest of the six live (411,245 buffers on
  // the full corpus) and it had NO cache at all before — it simply had not been unlucky yet.
  "procurement-concentration": async (dbRows, q) => {
    const from = orNull(q, "from");
    const to = orNull(q, "to");
    const hit = await scopedPayload(dbRows, "concentration", from, to);
    if (hit) return { body: hit };
    const rows = await dbRows("SELECT procurement_concentration($1, $2) AS r", [
      from,
      to,
    ]);
    return { body: rows[0]?.r ?? null };
  },
  // Procurement dashboard overview — totals + treemaps + connected-people lists,
  // scoped to a parliament window [from, to) or the full corpus (both NULL).
  //
  // Served from the per-scope precompute (124), which covers ALL thirty scopes. The windowed
  // case is what returned 500 on prod (10.010 s on ?from=2023-04-02&to=2024-06-09, which is
  // exactly the ns:2023_04_02 scope): only `all` had a cache, and every parliament window fell
  // through to the live aggregate.
  //
  // 025's `all`-only cache matview used to sit between the precompute and the live function.
  // RETIRED once 124 was populated on Cloud SQL and verified: it answered exactly one of the
  // thirty scopes, and 124 answers that one identically (checked jsonb-equal before removal).
  // Two caches for one question is the drift this codebase keeps paying for.
  "procurement-overview": async (dbRows, q) => {
    const from = orNull(q, "from");
    const to = orNull(q, "to");
    const hit = await scopedPayload(dbRows, "overview", from, to);
    if (hit) return { body: hit };
    const rows = await dbRows("SELECT procurement_overview($1, $2) AS r", [
      from,
      to,
    ]);
    return { body: rows[0]?.r ?? null };
  },
  // National CPV-division totals ("what does the state buy"), window-scoped
  // [from, to) or full corpus. Served from the per-scope precompute (124); no cache before.
  "procurement-sectors": async (dbRows, q) => {
    const from = orNull(q, "from");
    const to = orNull(q, "to");
    const hit = await scopedPayload(dbRows, "sectors", from, to);
    if (hit) return { body: hit };
    const rows = await dbRows("SELECT procurement_sectors($1, $2) AS r", [
      from,
      to,
    ]);
    return { body: rows[0]?.r ?? null };
  },
  // EU Single Market Scoreboard competition indicators (single-bidder share,
  // no-call-for-bids share), window-scoped [from, to) or full corpus. Served from the
  // per-scope precompute (124); no cache before.
  // The whole-corpus single-bid rate FOR THE SAME WINDOW a sector page is
  // showing. Without it a scoped sector rate gets compared against an unscoped
  // baseline, which on the culture corpus inverted the sign on 2023+ — the
  // sector reads WORSE than the country while actually being better. Generic on
  // purpose: every sector dashboard needs the same denominator.
  // The people who told the Сметна палата they work at this buyer. See migration
  // 168 for exactly what that claims — and what it does not.
  "awarder-officers": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!/^\d{9,13}$/.test(eik))
      return { status: 400, body: { error: "missing or malformed eik" } };
    const rows = await dbRows("SELECT awarder_declared_officers($1) AS r", [
      eik,
    ]);
    return { body: rows[0]?.r ?? null };
  },
  "national-competition": async (dbRows, q) => {
    const rows = await dbRows("SELECT national_competition($1, $2) AS r", [
      orNull(q, "from"),
      orNull(q, "to"),
    ]);
    return { body: rows[0]?.r ?? null };
  },
  "procurement-benchmarks": async (dbRows, q) => {
    const from = orNull(q, "from");
    const to = orNull(q, "to");
    const hit = await scopedPayload(dbRows, "benchmarks", from, to);
    if (hit) return { body: hit };
    const rows = await dbRows("SELECT procurement_benchmarks($1, $2) AS r", [
      from,
      to,
    ]);
    return { body: rows[0]?.r ?? null };
  },
  // Award-criterion mix (ЗОП чл. 70) over the TENDER corpus — the "how do we buy"
  // lens beside procurement-benchmarks' "how competitive is it". Window-scoped
  // [from, to) or full corpus; NOT in the 124 precompute, so no scopedPayload.
  //
  // Degrades a missing 164 to null rather than 500ing the whole procurement
  // dashboard: this is one tile on a shared page, and the tile self-suppresses on
  // null. It is the non-logging variant deliberately — unlike the psp:/pp: routes,
  // a null here is unambiguous (the function either exists or it does not), so
  // there is no zero-shaped answer that could be mistaken for real data.
  "procurement-award-criteria": async (dbRows, q) => {
    const from = orNull(q, "from");
    const to = orNull(q, "to");
    const rows = await dbRows(
      "SELECT procurement_award_criteria($1, $2) AS r",
      [from, to],
    ).catch(missingMigration(null));
    return { body: rows[0]?.r ?? null };
  },
  // Full "see all" rankings (top contractors / awarders / MPs / officials),
  // window-scoped [from, to) or full corpus — the big-list sibling of
  // procurement-overview.
  // Served from the per-scope precompute (124). 031's `all`-only cache matview is RETIRED for
  // the same reason as 025's — see procurement-overview above.
  "procurement-rankings": async (dbRows, q) => {
    const from = orNull(q, "from");
    const to = orNull(q, "to");
    const hit = await scopedPayload(dbRows, "rankings", from, to);
    if (hit) return { body: hit };
    const rows = await dbRows("SELECT procurement_rankings($1, $2) AS r", [
      from,
      to,
    ]);
    return { body: rows[0]?.r ?? null };
  },
  // The 3 headline KPIs for /procurement/contractors ("Топ изпълнители"): total
  // awarded value, top-10 concentration, and the MP-tied share — a per-scope blob
  // (122) the per-row contractor_rankings table can't compute. Keyed by scope_key
  // (default 'all'); an unknown scope returns null (empty tiles, not an error).
  "contractor-scope-kpis": async (dbRows, q) => {
    const scope = orNull(q, "scope") ?? "all";
    const rows = await dbRows(
      `SELECT contractor_count, total_eur, top10_share,
              mp_tied_eur, mp_tied_share, mp_tied_count
         FROM contractor_scope_kpis WHERE scope_key = $1`,
      [scope],
    );
    return { body: rows[0] ?? null };
  },
  // Cross-corpus leaderboard — companies that appear in BOTH the procurement
  // (ЗОП) and EU-funds (ИСУН) corpora, ranked by combined public money. All-time
  // only (funds aren't date-windowed); no from/to. Served from the load-time
  // cache matview (077), falling through to the live function when it is empty
  // or absent, and to null on a DB predating the migration.
  "dual-corpus-rankings": async (dbRows) => {
    try {
      const c = await dbRows("SELECT r FROM dual_corpus_rankings_cache", []);
      if (c[0]?.r) return { body: c[0].r };
    } catch {
      // matview absent — fall through to the live computation
    }
    const rows = await dbRows("SELECT dual_corpus_rankings() AS r", []).catch(
      (e) =>
        e?.code === "42883" || e?.code === "42P01"
          ? [{ r: null }]
          : Promise.reject(e),
    );
    return { body: rows[0]?.r ?? null };
  },
  // National "recent КЗК appeals" feed — top-N from kzk_recent_appeals (042),
  // each joined to its tender by УНП. ?limit (≤200).
  "kzk-appeals": async (dbRows, q) => {
    const limit = clampInt(q.limit, 30, 1, 200);
    const rows = await dbRows("SELECT kzk_recent_appeals($1) AS r", [
      limit,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? [] };
  },
  // Buyer risk-grade leaderboard ("riskiest institutions") — top-N from the
  // precomputed awarder_risk_grade_scoped table (041). ?scope selects the pscope
  // window ('all' | 'y:<year>' | 'ns:<election>', default 'all'); ?limit (≤200);
  // ?minScore (grade floor — 55 is the E floor, 70 the F floor). One jsonb trip.
  "awarder-risk-top": async (dbRows, q) => {
    const scope = s(q, "scope") || "all";
    const limit = clampInt(q.limit, 20, 1, 200);
    const minScore = clampInt(q.minScore, 0, 0, 100);
    // Payload is { requested, scope, rows } (scope = the effective key served —
    // may differ from `requested` on a fallback). Degrade to an empty payload of
    // that shape when the migration is absent (42883/42P01).
    const rows = await dbRows(
      "SELECT awarder_risk_grade_top($1, $2, $3) AS r",
      [scope, limit, minScore],
    ).catch((e) =>
      e?.code === "42883" || e?.code === "42P01" ? [] : Promise.reject(e),
    );
    return { body: rows[0]?.r ?? { requested: scope, scope, rows: [] } };
  },
  // Per-flag SUPPORTING DETAIL for ONE contract — the tooltip contents the masks
  // cannot carry.
  //
  // contract_risk_cache (112) says WHICH checks fired, in two ints already on
  // every row. What it cannot say is which MP, what concentration share, or the
  // debarment dates, because a bit has no room for them. Those used to arrive via
  // the 1.29 MB corpus-wide risk-indexes payload — every visitor downloading every
  // supplier's debarment record to render a handful of tooltips on one page.
  //
  // Scoped to a single contract and fetched on demand (hover), so a page render
  // costs nothing: 63.5% of the corpus fires zero checks and 30.0% fires exactly
  // one (112's measured distribution), which means most hovers return almost
  // nothing.
  //
  // ⚠️ The five blocks are ONE statement, so they are NOT independently guarded: a
  // 42P01 on any single relation nulls all five tooltips, and the catch cannot
  // tell a missing migration from a typo'd relation name. That is the accepted
  // trade for one round trip — the failure mode is "tooltips are empty", never a
  // broken page.
  "contract-risk-detail": async (dbRows, q) => {
    const key = s(q, "key");
    if (!key) return { status: 400, body: { error: "missing key" } };
    const [row] = await dbRows(
      `SELECT c.awarder_eik, c.contractor_eik, c.contractor_name,
              COALESCE(NULLIF(c.date_signed, ''), NULLIF(c.date, '')) AS award_date,
              left(c.cpv, 2) AS cpv_div, substr(c.date, 1, 4) AS yr
         FROM contracts c WHERE c.key = $1 LIMIT 1`,
      [key],
    );
    if (!row) return { body: { detail: null } };

    // Validate the award date HERE, not in SQL. The `^\d{4}-\d\d-\d\d` shape
    // guard the scorer uses accepts 0000-00-00, 2024-02-31 and 9999-99-99, and
    // every one of those throws on ::date — taking the whole tooltip with it.
    // Date.parse round-tripped is the cheap way to require a REAL calendar date.
    const raw = String(row.award_date || "");
    const awardDate =
      /^\d{4}-\d\d-\d\d$/.test(raw) &&
      new Date(raw).toISOString().slice(0, 10) === raw
        ? raw
        : null;

    // fold_contractor_name (112) is the SQL mirror of the SPA's
    // normalizeContractorName — matching on the raw name misses every row whose
    // registry spelling carries a quote or a legal-form suffix.
    const [detail] = await dbRows(
      `SELECT
         (SELECT jsonb_build_object(
                   'name', d.name, 'publishedAt', d.published_at,
                   'debarredUntil', d.debarred_until, 'detailsUrl', d.details_url)
            FROM debarred d
           WHERE fold_contractor_name(d.name) = fold_contractor_name($3)
           ORDER BY d.published_at DESC NULLS LAST LIMIT 1)          AS debarred,
         (SELECT jsonb_agg(jsonb_build_object('mpId', mp_id, 'mpName', politician)
                           ORDER BY mp_id)
            FROM (SELECT DISTINCT
                    NULLIF(regexp_replace(ref, '^/candidate/mp-', ''), '')::int AS mp_id,
                    politician
                    FROM company_politicians
                   WHERE eik = $2 AND kind = 'mp' AND ref LIKE '/candidate/mp-%') m)
                                                                     AS "mpConnected",
         (SELECT jsonb_build_object(
                   'sharePct', ROUND((p.pair_total / NULLIF(p.awarder_total, 0))::numeric, 4),
                   'awarderTotalEur', ROUND(p.awarder_total)::float8,
                   'pairTotalEur', ROUND(p.pair_total)::float8,
                   'contractCount', p.n,
                   'awarderName', p.awarder_name, 'contractorName', p.contractor_name)
            FROM risk_pair_concentration p
           WHERE p.awarder_eik = $1 AND p.contractor_eik = $2)       AS concentration,
         (SELECT jsonb_build_object(
                   'foundedDate', cf.founded_date,
                   -- 2629800000 ms = 30.4375 d, the same MS_PER_MONTH the TS scorer
                   -- uses, so the month count is identical rather than merely close.
                   'newFirmMonths',
                   CASE WHEN $4::date >= cf.founded_date
                        THEN floor(($4::date - cf.founded_date) * 86400000.0 / 2629800000.0)
                        END)
            FROM company_founded cf
           WHERE cf.eik = $2 AND cf.founded_date IS NOT NULL)        AS founded,
         (SELECT jsonb_build_object(
                   'contractCount', g.n,
                   'totalEur', ROUND(g.total)::float8,
                   'ceilingEur', g.ceiling::float8,
                   'cpvDiv', g.cpv_div, 'year', g.yr)
            FROM risk_split_group g
           WHERE g.awarder_eik = $1 AND g.contractor_eik = $2
             AND g.cpv_div = $5 AND g.yr = $6)                       AS "splitPurchase"`,
      [
        row.awarder_eik,
        row.contractor_eik,
        row.contractor_name,
        awardDate,
        row.cpv_div,
        row.yr,
      ],
    ).catch(missingMigrationRows);
    return { body: { detail: detail ?? null } };
  },
  // The foreign-funded-NGO disclosure, on its own. NEUTRAL — it is not one of the
  // 12 scored checks and deliberately does not move the CRI, which is exactly why
  // it is not carried by contract_risk_cache's masks: nothing in Postgres has a
  // bit for it. The contract screens decode their chips from those masks now, so
  // without this slice the disclosure would silently vanish from them while
  // ProjectFileScreen (still on the old scorer) kept showing it — the same
  // contract disclosing on one page and not another.
  //
  // ~35 rows / 6.3 kB, versus the 1.29 MB corpus payload it was embedded in.
  "procurement-ngo-foreign": async (dbRows) => {
    const rows = await dbRows(
      `SELECT eik, kind, ngo_name AS "ngoName", ngo_eik AS "ngoEik",
              person, funder,
              -- ::float8, NOT bare numeric. node-postgres serializes a PG numeric
              -- as a STRING, so eur would arrive as "87584323" and
              -- formatEurCompact would render nothing — the same numeric-as-string
              -- trap that blanked the money columns on /persons. The jsonb payload
              -- this route replaces was immune because jsonb numbers stay numbers.
              CASE WHEN eur IS NULL THEN NULL
                   ELSE ROUND(eur)::float8 END AS eur
         FROM procurement_ngo_foreign_link
        ORDER BY eur DESC NULLS LAST, eik`,
      [],
    ).catch(missingMigrationRows);
    return { body: { entries: rows } };
  },
  // Consolidated client-side risk-scorer indexes (debarred register,
  // awarder→contractor concentration pairs, MP/official-connected EIK sets,
  // per-CPV-division competition baseline) — one payload, corpus-scoped.
  // Served from the load-time matview (the live function is a full-corpus
  // aggregate, ~2.8s warm on Cloud SQL); falls back to the live function on
  // a DB that predates the cache.
  "procurement-risk-indexes": async (dbRows) => {
    try {
      const rows = await dbRows(
        "SELECT r FROM procurement_risk_indexes_cache",
        [],
      );
      if (rows[0]?.r) return { body: rows[0].r };
    } catch {
      // matview absent — fall through to the live computation
    }
    const rows = await dbRows("SELECT procurement_risk_indexes() AS r", []);
    return { body: rows[0]?.r ?? null };
  },
  // Every contract row for one awarder (ProcurementContract shape) — the road
  // dashboard's model input. Bounded: the biggest buyer (АПИ) has ~2.1k rows.
  "awarder-contracts": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const limit = clampInt(q.limit, 10000, 1, 25000);
    const contracts = await dbRows(
      `SELECT key, ocid, tag, date, date_signed AS "dateSigned",
              awarder_eik AS "awarderEik", awarder_name AS "awarderName",
              contractor_eik AS "contractorEik", contractor_name AS "contractorName",
              amount, currency, amount_eur AS "amountEur",
  signing_amount_eur AS "signingAmountEur", title, cpv,
              procurement_method AS "procurementMethod",
              number_of_tenderers AS "numberOfTenderers",
              CASE WHEN eu_funded IS NULL THEN NULL ELSE eu_funded = 1 END AS "euFunded",
              eu_program AS "euProgram", category, source_url AS "sourceUrl"
       FROM contracts WHERE awarder_eik = $1
       ORDER BY date DESC, key LIMIT $2`,
      [eik, limit],
    );
    return { body: { eik, contracts } };
  },
  // Consolidated per-awarder rollup over a SET of EIKs — one grouped aggregate
  // (eik, contractCount, totalEur) for a sector browse pack's context strip,
  // instead of fanning out over awarder-contracts and downloading every row for
  // 26+ operators. Windowed [from, to) with sargable COALESCE bounds so the
  // date guard doesn't defeat the awarder-eik index.
  "awarder-group-rollup": async (dbRows, q) => {
    const eiks = s(q, "eiks")
      .split(",")
      .map((e) => e.trim())
      .filter((e) => /^\d{9,13}$/.test(e))
      .slice(0, 300);
    if (!eiks.length) return { status: 400, body: { error: "missing eiks" } };
    const from = orNull(q, "from");
    const to = orNull(q, "to");
    const operators = await dbRows(
      `SELECT awarder_eik AS eik,
              count(*)::int AS "contractCount",
              round(sum(amount_eur))::double precision AS "totalEur",
              count(*) FILTER (WHERE number_of_tenderers IS NOT NULL)::int
                AS "bidKnownN",
              count(*) FILTER (WHERE number_of_tenderers = 1)::int
                AS "singleBidN"
       FROM contracts
       WHERE awarder_eik = ANY($1) AND tag = 'contract'
         AND date >= COALESCE($2, '')
         AND date <  COALESCE($3, '99999999')
       GROUP BY awarder_eik
       ORDER BY sum(amount_eur) DESC NULLS LAST, awarder_eik`,
      [eiks, from, to],
    );
    return { body: { operators } };
  },
  // FULL sector-pack model over a SET of EIKs in ONE aggregate — the server-side
  // replacement for the 25+-request client fan-out (awarder-contracts × each
  // budget unit) that the Води/ВСС/Отбрана/НОИ/НЗОК/Култура packs used to run.
  // Returns the compact aggregates buildAwarderModelFromAggregates() folds back
  // into the identical AwarderModel (CPV→category classification stays in TS).
  // Windowed [from, to) with sargable COALESCE bounds. See 061_awarder_group_model.
  "awarder-group-model": async (dbRows, q) => {
    const eiks = s(q, "eiks")
      .split(",")
      .map((e) => e.trim())
      .filter((e) => /^\d{9,13}$/.test(e))
      .slice(0, 300);
    if (!eiks.length) return { status: 400, body: { error: "missing eiks" } };
    const rows = await dbRows("SELECT awarder_group_model($1, $2, $3) AS r", [
      eiks,
      orNull(q, "from"),
      orNull(q, "to"),
    ]);
    return { body: rows[0]?.r ?? null };
  },
  // Top-N contracts by € across a SET of EIKs — the award-level tile's input
  // (e.g. the МВР pack's "biggest contracts"). Server-side ORDER BY amount_eur +
  // LIMIT so the client gets only the rows it renders, instead of fanning out over
  // awarder-contracts and downloading every full corpus (МВР's 4 big buyers were
  // ~3.5 MB for 8 rows). Windowed [from, to) with sargable COALESCE bounds; the
  // awarder_eik + amount_eur indexes carry it.
  "awarder-group-top-contracts": async (dbRows, q) => {
    const eiks = s(q, "eiks")
      .split(",")
      .map((e) => e.trim())
      .filter((e) => /^\d{9,13}$/.test(e))
      .slice(0, 300);
    if (!eiks.length) return { status: 400, body: { error: "missing eiks" } };
    const limit = clampInt(q.limit, 8, 1, 50);
    const from = orNull(q, "from");
    const to = orNull(q, "to");
    const contracts = await dbRows(
      `SELECT key, date,
              contractor_eik AS "contractorEik", contractor_name AS "contractorName",
              amount_eur AS "amountEur", title,
              number_of_tenderers AS "numberOfTenderers",
              CASE WHEN eu_funded IS NULL THEN NULL ELSE eu_funded = 1 END AS "euFunded"
       FROM contracts
       WHERE awarder_eik = ANY($1) AND tag = 'contract' AND amount_eur IS NOT NULL
         -- Exclude €0 consortium member rows (migration 087) — the carrier row
         -- carries the joint value into this "top contracts" list.
         AND consortium_role IS DISTINCT FROM 'member'
         AND date >= COALESCE($2, '')
         AND date <  COALESCE($3, '99999999')
       ORDER BY amount_eur DESC NULLS LAST, key
       LIMIT $4`,
      [eiks, from, to, limit],
    );
    return { body: { contracts } };
  },
  // EU-funds (ИСУН) rollup over a SET of EIKs — per-beneficiary contracted/paid
  // from the already-rolled fund_beneficiaries table (one row per EIK). Not
  // date-windowed: EU-funds figures are programme-period lifetime totals, not a
  // parliament slice. Feeds the water pack's EU-investment tile.
  "awarder-funds-rollup": async (dbRows, q) => {
    const eiks = s(q, "eiks")
      .split(",")
      .map((e) => e.trim())
      .filter((e) => /^\d{9,13}$/.test(e))
      .slice(0, 300);
    if (!eiks.length) return { status: 400, body: { error: "missing eiks" } };
    const operators = await dbRows(
      `SELECT eik,
              round(contracted_eur)::double precision AS "contractedEur",
              round(paid_eur)::double precision AS "paidEur",
              contract_count::int AS "projectCount"
       FROM fund_beneficiaries
       WHERE eik = ANY($1)
       ORDER BY contracted_eur DESC NULLS LAST, eik`,
      [eiks],
    );
    return { body: { operators } };
  },
  // Lightweight awarder rollup (as a BUYER): top suppliers (byContractor),
  // by-year series + headline totals — the same awarder_procurement() the
  // /awarder page's company payload embeds, plus the awarder's own name (the
  // function omits it) from awarder_search. Window-scoped [from, to) or full.
  "awarder-procurement": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const [roll, named] = await Promise.all([
      dbRows("SELECT awarder_procurement($1, $2, $3) AS r", [
        eik,
        orNull(q, "from"),
        orNull(q, "to"),
      ]),
      // Canonical display name = the modal awarder_name across this eik's
      // contracts (awarder_search carries several spellings per eik).
      dbRows(
        `SELECT awarder_name AS name FROM contracts WHERE awarder_eik = $1
         GROUP BY awarder_name ORDER BY count(*) DESC, length(awarder_name) LIMIT 1`,
        [eik],
      ),
    ]);
    const r = roll[0]?.r ?? null;
    if (r && named[0]?.name) r.name = named[0].name;
    return { body: r };
  },
  // Full grouped counterparty list for one entity — every awarder that paid a
  // company (side=contractor) or every contractor a state buyer paid
  // (side=awarder), with the MP-tie badge inline.
  //
  // DELIBERATELY UNBOUNDED — a known exception to this file's LIMIT policy:
  // these are the "see everyone" breakdown pages, and the result is naturally
  // capped by grouping (one row per distinct counterparty; the biggest buyer,
  // АПИ, has ~2.1k). The 1h CDN cache absorbs the two aggregate scans.
  "company-counterparties": async (dbRows, q) => {
    const eik = s(q, "eik");
    const side = s(q, "side") === "awarder" ? "awarder" : "contractor";
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const me = side === "awarder" ? "awarder" : "contractor";
    const other = side === "awarder" ? "contractor" : "awarder";
    const from = orNull(q, "from");
    const to = orNull(q, "to");
    // SECURITY: `me`/`other` are spliced into SQL as identifiers — they MUST
    // stay this fixed two-branch ternary; never derive them from client text.
    // from/to are bound params ($2/$3), inclusive — the date-scope pill.
    const entries = await dbRows(
      `WITH mine AS (
         SELECT ${other}_eik AS eik, ${other}_name AS name, tag,
                amount, currency, amount_eur
         FROM contracts
         WHERE ${me}_eik = $1 AND ${other}_eik IS NOT NULL AND ${other}_eik <> ''
           -- Exclude €0 consortium member rows (migration 087): the joint value
           -- sits on the carrier entity, so member rows would list a counterparty
           -- at €0. Participation is surfaced separately on the company page.
           AND consortium_role IS DISTINCT FROM 'member'
           AND ($2::text IS NULL OR date >= $2::text)
           AND ($3::text IS NULL OR date <= $3::text)
       ),
       others AS (
         SELECT eik, jsonb_object_agg(cur, s2) AS other FROM (
           SELECT eik, currency AS cur, ROUND(SUM(amount)) AS s2
           FROM mine
           WHERE tag = 'contract' AND amount_eur IS NULL
             AND amount IS NOT NULL AND currency IS NOT NULL
           GROUP BY eik, currency
         ) q GROUP BY eik
       )
       SELECT g.eik, g.name, g."totalEur",
              COALESCE(o.other, '{}'::jsonb) AS "totalOther",
              g."contractCount",
              EXISTS (SELECT 1 FROM company_politicians cp
                      WHERE cp.eik = g.eik AND cp.kind = 'mp') AS "mpTied"
       FROM (
         SELECT eik, MIN(name) AS name,
                ROUND(COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract'), 0)) AS "totalEur",
                (COUNT(*) FILTER (WHERE tag = 'contract'))::int AS "contractCount"
         FROM mine
         GROUP BY eik
         HAVING COUNT(*) FILTER (WHERE tag = 'contract') > 0
       ) g
       LEFT JOIN others o ON o.eik = g.eik
       ORDER BY g."totalEur" DESC NULLS LAST`,
      [eik, from, to],
    );
    // Contract rows carry several name aliases per EIK (АПИ vs its regional
    // ОПУ branches) — pick the most frequent one as the display name.
    const name = await dbRows(
      `SELECT ${me}_name AS name FROM contracts WHERE ${me}_eik = $1
       GROUP BY ${me}_name ORDER BY count(*) DESC LIMIT 1`,
      [eik],
    );
    return { body: { eik, side, name: name[0]?.name ?? null, entries } };
  },
  // Light per-entity activity signature for the watchlist — contract count,
  // total, latest date, top counterparty — one indexed aggregate per followed
  // company / awarder / place.
  "watch-signature": async (dbRows, q) => {
    const id = s(q, "id");
    const kind = s(q, "kind");
    if (!id) return { status: 400, body: { error: "missing id" } };
    if (kind === "company" || kind === "awarder") {
      // SECURITY: `me`/`other` are spliced into SQL as identifiers — they MUST
      // stay this fixed two-branch ternary; never derive them from client text.
      const me = kind === "company" ? "contractor" : "awarder";
      const other = kind === "company" ? "awarder" : "contractor";
      const rows = await dbRows(
        `SELECT (COUNT(*) FILTER (WHERE tag = 'contract'))::int AS count,
                ROUND(COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract'), 0)) AS "totalEur",
                COALESCE(MAX(date) FILTER (WHERE tag = 'contract'), '') AS "latestDate",
                (SELECT COALESCE(jsonb_object_agg(cur, s2), '{}'::jsonb) FROM (
                   SELECT currency AS cur, ROUND(SUM(amount)) AS s2
                   FROM contracts c2
                   WHERE c2.${me}_eik = $1 AND c2.tag = 'contract'
                     AND c2.amount_eur IS NULL AND c2.amount IS NOT NULL
                     AND c2.currency IS NOT NULL
                   GROUP BY currency
                ) o) AS "totalOther"
         FROM contracts WHERE ${me}_eik = $1`,
        [id],
      );
      const top = await dbRows(
        `SELECT ${other}_eik AS eik, MIN(${other}_name) AS name
         FROM contracts
         WHERE ${me}_eik = $1 AND tag = 'contract'
           AND ${other}_eik IS NOT NULL AND ${other}_eik <> ''
         GROUP BY ${other}_eik
         ORDER BY SUM(amount_eur) DESC NULLS LAST LIMIT 1`,
        [id],
      );
      const sig = rows[0] ?? null;
      if (!sig || sig.count === 0) return { body: { found: false } };
      return {
        body: {
          found: true,
          ...sig,
          topEik: top[0]?.eik ?? null,
          topName: top[0]?.name ?? null,
          topKind: kind === "company" ? "awarder" : "company",
        },
      };
    }
    if (kind === "place") {
      const rows = await dbRows(
        `SELECT (COUNT(*) FILTER (WHERE c.tag = 'contract'))::int AS count,
                ROUND(COALESCE(SUM(c.amount_eur) FILTER (WHERE c.tag = 'contract'), 0)) AS "totalEur",
                COALESCE(MAX(c.date) FILTER (WHERE c.tag = 'contract'), '') AS "latestDate",
                (SELECT COALESCE(jsonb_object_agg(cur, s2), '{}'::jsonb) FROM (
                   SELECT c2.currency AS cur, ROUND(SUM(c2.amount)) AS s2
                   FROM contracts c2
                   JOIN awarder_seats s3 ON s3.eik = c2.awarder_eik
                   WHERE s3.ekatte = $1 AND s3.source = 'geo' AND s3.is_local_hq
                     AND c2.tag = 'contract' AND c2.amount_eur IS NULL
                     AND c2.amount IS NOT NULL AND c2.currency IS NOT NULL
                   GROUP BY c2.currency
                ) o) AS "totalOther"
         FROM contracts c
         JOIN awarder_seats s ON s.eik = c.awarder_eik
         WHERE s.ekatte = $1 AND s.source = 'geo' AND s.is_local_hq`,
        [id],
      );
      const top = await dbRows(
        `SELECT c.awarder_eik AS eik, MIN(c.awarder_name) AS name
         FROM contracts c
         JOIN awarder_seats s ON s.eik = c.awarder_eik
         WHERE s.ekatte = $1 AND s.source = 'geo' AND s.is_local_hq
           AND c.tag = 'contract'
         GROUP BY c.awarder_eik
         ORDER BY SUM(c.amount_eur) DESC NULLS LAST LIMIT 1`,
        [id],
      );
      const sig = rows[0] ?? null;
      if (!sig || sig.count === 0) return { body: { found: false } };
      return {
        body: {
          found: true,
          ...sig,
          topEik: top[0]?.eik ?? null,
          topName: top[0]?.name ?? null,
          topKind: "awarder",
        },
      };
    }
    return { status: 400, body: { error: "bad kind" } };
  },
  // Per-politician procurement detail (candidate/officials procurement pages):
  // every linked contractor with live totals, byYear and top awarders.
  "ref-procurement": async (dbRows, q) => {
    const ref = s(q, "ref");
    if (!ref) return { status: 400, body: { error: "missing ref" } };
    const rows = await dbRows("SELECT ref_procurement($1) AS r", [ref]);
    return { body: rows[0]?.r ?? null };
  },
  // One MP's connected-contract scorecard metric (value + rank + cohort) for the
  // candidate-page scorecard tile — replaces the derived/per-mp/ shard fetch.
  "mp-scorecard": async (dbRows, q) => {
    const mpId = parseInt(s(q, "mpId"), 10);
    if (!Number.isFinite(mpId))
      return { status: 400, body: { error: "missing mpId" } };
    const rows = await dbRows("SELECT mp_scorecard($1) AS r", [mpId]);
    return { body: rows[0]?.r ?? null };
  },
  // The MPs / officials declared as officers/owners of one contractor — the
  // "connected people" chips on contract/company pages. `relations` is the
  // full jsonb from the connections pipeline (kind/isCurrent/shareSize/
  // confidence), so chips keep "(former)" / "declared stake N%" fidelity.
  "company-politicians": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const entries = await dbRows(
      `SELECT politician, ref, kind, role, relations, total_eur AS "totalEur"
       FROM company_politicians WHERE eik = $1
       ORDER BY total_eur DESC NULLS LAST LIMIT 200`,
      [eik],
    );
    return { body: { eik, entries } };
  },
  // A company's links to people in public OFFICE (migration 158) → the AI chat's
  // `companyConnections` tool. Replaces the `parliament/company-connections/{eik}.json` shard
  // family, which `bucket_sync_paths.ts` had excluded from sync — and since `gsutil rsync -x`
  // excludes a match from DELETION as well as upload, the 16,609 objects were FROZEN at their
  // 2026-07-29 vintage and the tool answered from that snapshot at a 200.
  //
  // Not the same question as `company-politicians` above, and the two must not be conflated.
  // That one reads `company_politicians` (008), which is built from the procurement-side
  // mp_connected/pep_connected joins and is therefore MONEY-restricted — 347 EIKs. This reads
  // the gated person layer and covers 26,047, most of which never signed a public contract.
  //
  // TWO ARMS, DELIBERATELY SEPARATE ARRAYS. `direct` is an office-holder personally on this
  // company's registry filings; `bridged` is one hop further out (an officer here also sits at
  // a company where an office-holder sits) and is a second-degree lead, never a first-degree
  // finding. Merging them behind one confidence column is how the shards let a coincidence read
  // as a claim.
  //
  // Degrades to a shaped empty on a database predating 158 rather than 500ing — the tool asks
  // per EIK and "no links on record" is its ordinary answer, so a missing migration must not
  // become an error page. It is the NON-logging `missingMigration` variant, like mp-management
  // and place-mp-companies: a premature deploy therefore reads as "no political links" until
  // the migration lands, with nothing in the logs. Apply 158 to the serving database BEFORE the
  // deploy:db that ships this route (CLAUDE.md's ordering rule).
  "company-connections": async (dbRows, q) => {
    // 9 digits (ЕИК) or 13 (клон/поделение). Anything else is a null body rather than a bind
    // error; the function itself is safe on an unknown eik and returns an empty answer.
    const eik = s(q, "eik");
    if (!/^\d{9}(\d{4})?$/.test(eik)) return { body: null };
    const rows = await dbRows("SELECT company_political_links($1, $2) AS r", [
      eik,
      clampInt(q.limit, 25, 1, 200),
    ]).catch(missingMigration(null));
    return { body: rows[0]?.r ?? null };
  },
  // ── The /company/:eik political-links tile, unioned server-side ──────────────────────────
  //
  // THE DEFECT THIS EXISTS TO END. The tile used to read TWO arms, both MONEY-GATED:
  // `company_politicians` (008, procurement-derived — 347 EIKs) and the ИСУН
  // `political-by-eik` shard (971 EIKs). `tr_companies` holds 1,020,707 companies and only
  // 29,616 have ever signed a contract, so a company that neither contracts nor draws EU
  // funds was invisible to both BY CONSTRUCTION — and the tile does not self-suppress, it
  // prints «Няма установени връзки с политици.» So /company/175155542 asserted that an NGO
  // chaired by a former Deputy PM and Minister of Defence has no political links, at a 200.
  // A false claim about a named public figure is worse than an absent section.
  //
  // 158 (`company_political_links`) already answered it — 26,047 EIKs — and was wired only to
  // the AI chat's `companyConnections` tool, so the chat and the page disagreed about the same
  // company. This route is the third arm.
  //
  // ═══════════════════════════════════════════════════════════════════════════════════════
  // WHY THE UNION IS HERE AND NOT IN THE BROWSER. Four measurements, not a preference.
  //
  // 1. DEDUP IS THE MAJORITY CASE. Of 522 `company_politicians` rows, 436 (83.5%) are also in
  //    158's direct arm; of 1,249 funds rows, 852 (68.2%). Rendering the arms unmerged would
  //    double-print 1,288 rows.
  //
  // 2. THE DEDUP KEY IS ONLY RESOLVABLE SERVER-SIDE. The three arms name one human three ways
  //    (`/candidate/mp-2829`, `/officials/<officials-slug>`, and 158's person slug). The key is
  //    the person slug resolved FORWARD through `officials_person_slug()` (106), which is
  //    TOTAL — 522/522 and 1,249/1,249 — because it falls through `person_slug_retired`. 408 of
  //    445 distinct officials refs are person slugs outright; the other 37 are RETIRED, and
  //    only that function knows their target. The reverse direction is not total
  //    (`person_role.ref` at official_exec/muni covers 417 of 445), so "have 158 return its
  //    aliases" would silently miss 28. A browser cannot call the function at all.
  //
  // 3. THE FUNDS ARM CANNOT BE RESOLVED WHERE IT IS SERVED. `/api/db/fund-payload` is a generic
  //    passthrough over ~18 payload kinds; special-casing one kind's identity join there rots.
  //    Baking the slug into the stored shard at load time is worse — a re-resolve MOVES slugs
  //    (the whole reason `person_slug_retired` exists), so the artifact would go quietly stale.
  //
  // 4. ⚠️ THE UNION REINTRODUCES A COLLISION 158 FORBIDS INTERNALLY. 158's own data test
  //    asserts a person is never in both `direct` and `bridged`, because the two are rendered
  //    with different wording and the same human would be described to the reader twice — once
  //    as an officer here, once as a distant lead. The union breaks that FROM OUTSIDE: a PG-arm
  //    person with no `person_role` at source tr/ngo for this EIK is not in 158's `direct_role`,
  //    so 158 may legitimately place them in `bridged` while the PG arm puts them in ours.
  //    Measured: 7 people. `bridged` is therefore filtered against the resolved direct-slug set
  //    below — deleting that filter is the defect, and the data test gates it.
  //
  // NOT folded into `/api/db/company` despite that route's own note about avoiding a second
  // round-trip: it is a `Promise.all` of ~18 queries, so its latency is its slowest member, and
  // 158 costs 14 ms typical / 56 ms cold at the worst post-cap fan-out (12,303 buffers, EIK
  // 204332614, measured). Adding that to the critical path of EVERY company page — including the
  // 96.6% that are not contractors — delays the whole page rather than one tile.
  //
  // ⚠️ THE THREE ARMS DEGRADE INDEPENDENTLY, and `arms` REPORTS WHICH ANSWERED. A missing
  // migration must never blank the other two, and — this is the point — "no links found" must
  // never be printed when an arm could not run. `unavailable` is what lets the tile say "the
  // check could not run" instead of repeating the denial this route exists to delete.
  //
  // DEPLOY ORDER. 158 is "applied, never loaded", and 148 must PRECEDE it — 158's `LANGUAGE sql`
  // body SELECTs `person_company_bridge_a` and is validated at CREATE, so 158 alone fails the
  // whole file with 42P01. Verify on the serving database BEFORE the `deploy:db` that ships this
  // route, then ship the function before the bundle that calls it:
  //   psql "$CLOUD_URL" -c "SELECT to_regprocedure('company_political_links(text,int)')::text;"
  //   npx tsx scripts/db/apply_functions.ts 148_person_company_basis.sql 158_company_political_links.sql
  //   npm run deploy:db   # this route
  //   npm run deploy      # the tile
  //
  // `?limit` bounds the 158 ARM'S ARRAYS ONLY. The PG arm is fixed at 200 and the funds arm is
  // whatever the shard holds; see the measured-headroom note on each.
  //
  // ORDERING CONTRACT. `direct` is ordered PG (money, `total_eur DESC`) → funds → 158 (office
  // prominence), and every row carries `arm`. A consumer may sort WITHIN an arm; sorting ACROSS
  // them destroys the property the tile depends on, because only the PG arm has money to sort by
  // and a `?? -1` fallback scatters the other two into the tail.
  "company-political": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!/^\d{9}(\d{4})?$/.test(eik)) return { body: null };
    const lim = clampInt(q.limit, 50, 1, 200);

    // A sentinel distinct from every legitimate result, so "the arm could not run" is not
    // confusable with "the arm ran and found nothing".
    //
    // ⚠️ DELIBERATELY NOT `missingMigration`'s SHAPE. That helper wraps as `[{ r }]` because its
    // callers read `rows[0].r`; the three arms below read `res.r` off a BARE object. An earlier
    // draft carried an unused `[{ r }]`-shaped copy beside three inline catches, which is the
    // trap worth naming rather than deleting silently: "tidying" the catches into it would make
    // `res.r` undefined, `pgRows` undefined, and the first `for…of` throw — a 500 on the whole
    // route, from a refactor that looks like pure cleanup. One helper, one shape, all three arms.
    //
    // It also LOGS, once per process per arm. That is this file's settled convention for a
    // missing migration (`rc:`/`psp:`/`pp:`/`ff:`/`oc:`… `:not-built`), and CLAUDE.md's reason is
    // exactly this route's hazard: "that log, not latency, is the signal that the cloud loader
    // never ran". `arms` tells the reader's TILE; this tells the OPERATOR. Without it a
    // `deploy:db` that shipped before 158 reached Cloud SQL reads as "no political links" for
    // ever, with nothing red anywhere — the same silence the route exists to end.
    const UNAVAILABLE = Symbol("unavailable");
    const armMiss = (label, run) => (e) => {
      if (e?.code !== "42883" && e?.code !== "42P01") return Promise.reject(e);
      logMissOnce(
        `cp:unavailable:${label}:${e.code}`,
        `company-political/${label}: read failed (${e.code}) — arm reported unavailable. Run ${run}.`,
      );
      return { r: UNAVAILABLE };
    };
    const APPLY_158 =
      "npx tsx scripts/db/apply_functions.ts 148_person_company_basis.sql 158_company_political_links.sql";

    // ⚠️ THE ROWS AND THE IDENTITY RESOLUTION ARE SEPARATE QUERIES, ON PURPOSE. Resolving the
    // slug INSIDE the row query couples two independent migrations: a database missing the
    // person layer (106) would take the whole PG arm to `unavailable` and discard 454 official
    // rows it could still serve — rows the pre-existing `company-politicians` route returns
    // unconditionally, so the new tile would show strictly LESS than the one it replaces during
    // a deploy window. Split, a missing 106 costs only dedup QUALITY: the rows survive with a
    // null slug, fall back to their own ref as a key, and render once each.
    //
    // Caps: `LIMIT 200` on the PG arm is headroom, not an undeclared truncation — the measured
    // maximum is 9 `company_politicians` rows per EIK (and 12 `mps + officials` per funds shard,
    // which is why that arm needs none). If either ever approaches its cap, report it the way
    // 158 reports `directTruncated` rather than letting it truncate silently.
    const [pgRes, pgSlugRes, fundsRes, fundsSlugRes, linkRes] =
      await Promise.all([
        dbRows(
          `SELECT politician, ref, kind, role, relations, total_eur
           FROM company_politicians
          WHERE eik = $1
          ORDER BY total_eur DESC NULLS LAST
          LIMIT 200`,
          [eik],
        )
          .then((rows) => ({ r: rows }))
          .catch(
            armMiss("pg", "db:load:tr:pg (company_politicians, migration 008)"),
          ),
        // The dedup key, resolved FORWARD — see note 2 in the header.
        //
        // ⚠️ BOTH BRANCHES MUST GO THROUGH A REDIRECT-AWARE RESOLVER, and the `mp` one is the easy
        // miss. `officials_person_slug` already falls through `person_slug_redirect`, which is what
        // makes the officials side "total"; an `mp-N` ref taken verbatim does not. MP slugs are
        // retired by the SAME mechanism and two already are (`mp-4769 → mp-4594`,
        // `mp-3252 → mp-2454`). A retired one here keys the OLD slug while 158 emits the NEW one,
        // so the same human renders TWICE in the direct block AND escapes the `directSlugs`
        // subtraction below — both defects this route exists to delete, arriving through the one
        // branch that skipped the redirect. Latent today (0 rows on either), and
        // `person_slug_retired` only ever grows.
        //
        // `officials_person_slug('mp-2829')` returns NULL (it requires `person_officials_sources`),
        // so the two branches cannot be collapsed into one call.
        dbRows(
          `SELECT cp.ref,
                CASE WHEN cp.kind = 'mp'
                     THEN COALESCE(person_slug_redirect(replace(cp.ref, '/candidate/', '')),
                                   replace(cp.ref, '/candidate/', ''))
                     ELSE officials_person_slug(replace(cp.ref, '/officials/', ''))
                END AS person_slug
           FROM (SELECT DISTINCT ref, kind FROM company_politicians WHERE eik = $1) cp`,
          [eik],
        )
          .then((rows) => ({ r: rows }))
          .catch(armMiss("pg-slug", APPLY_158)),
        dbRows(
          `SELECT payload FROM fund_payloads
          WHERE kind = 'political-by-eik' AND key = $1`,
          [eik],
        )
          .then((rows) => ({ r: rows }))
          .catch(armMiss("funds", "db:load:funds:pg (fund_payloads)")),
        // The funds shard's own identity resolution, same split and same reason. BOTH its arrays
        // need it: `officials[].slug` is an officials slug, and `mps[].mpId` mints `mp-N`, which
        // carries the identical retirement gap the PG arm's `mp` branch does.
        // `jsonb_object_agg` rejects a NULL key but accepts a NULL value, so an unresolvable slug
        // rides through as null rather than aborting the arm.
        dbRows(
          `SELECT COALESCE(
                  (SELECT jsonb_object_agg(k, v) FROM (
                     SELECT o.slug AS k, officials_person_slug(o.slug) AS v
                       FROM fund_payloads p,
                            jsonb_to_recordset(COALESCE(p.payload -> 'officials', '[]'::jsonb))
                              AS o(slug text)
                      WHERE p.kind = 'political-by-eik' AND p.key = $1 AND o.slug IS NOT NULL
                     UNION ALL
                     -- The record column is CASE-SENSITIVE: declared as "mpId", it must be
                     -- referenced as m."mpId" — bare m.mpId folds to mpid and 42703s.
                     SELECT 'mp-' || m."mpId",
                            COALESCE(person_slug_redirect('mp-' || m."mpId"),
                                     'mp-' || m."mpId")
                       FROM fund_payloads p,
                            jsonb_to_recordset(COALESCE(p.payload -> 'mps', '[]'::jsonb))
                              AS m("mpId" text)
                      WHERE p.kind = 'political-by-eik' AND p.key = $1
                        AND m."mpId" IS NOT NULL
                   ) q),
                  '{}'::jsonb) AS slug_map`,
          [eik],
        )
          .then((rows) => ({ r: rows }))
          .catch(armMiss("funds-slug", APPLY_158)),
        dbRows("SELECT company_political_links($1, $2) AS r", [eik, lim])
          .then((rows) => ({ r: rows[0]?.r ?? null }))
          .catch(armMiss("person-layer", APPLY_158)),
      ]);

    const pgRows = pgRes.r === UNAVAILABLE ? [] : pgRes.r;
    const fundsRow = fundsRes.r === UNAVAILABLE ? [] : fundsRes.r;
    const links = linkRes.r === UNAVAILABLE ? null : linkRes.r;

    const fundsEntry = fundsRow[0]?.payload ?? null;
    // Both slug maps degrade to {} rather than to UNAVAILABLE: a missing resolver costs dedup
    // quality, never rows (see the split note above).
    const pgSlugByRef = new Map(
      (pgSlugRes.r === UNAVAILABLE ? [] : pgSlugRes.r).map((r) => [
        r.ref,
        r.person_slug,
      ]),
    );
    const fundsSlugMap =
      (fundsSlugRes.r === UNAVAILABLE ? null : fundsSlugRes.r[0]?.slug_map) ??
      {};

    // Dedup key. The person slug when we have one; otherwise the arm's own ref, so two rows
    // we could NOT identify stay two rows rather than collapsing into one by accident.
    const byKey = new Map();
    const take = (key, row) => {
      if (!byKey.has(key)) byKey.set(key, row);
    };

    // Precedence PG > funds > person layer: the first two carry `total_eur` and the richer
    // relation labels 158 does not have, so where they overlap they are the better row. 158
    // contributes the people neither of them knows, which is the entire point of the change.
    for (const p of pgRows) {
      const slug = pgSlugByRef.get(p.ref) || null;
      take(slug || `pg:${p.ref}`, {
        arm: "pg",
        slug,
        href: p.ref,
        name: p.politician,
        kind: p.kind === "mp" ? "mp" : "official",
        role: p.role ?? null,
        relations: p.relations ?? null,
        totalEur: p.total_eur ?? null,
      });
    }

    if (fundsEntry) {
      for (const m of fundsEntry.mps ?? []) {
        const minted = m.mpId != null ? `mp-${m.mpId}` : null;
        // The resolved value when the map has one, so a retired `mp-N` keys the slug 158 emits.
        const slug = (minted && fundsSlugMap[minted]) || minted;
        take(slug || `funds-mp:${m.mpName}`, {
          arm: "funds",
          slug,
          href: `/candidate/mp-${m.mpId}`,
          name: m.mpName,
          kind: "mp",
          mpId: m.mpId,
          relations: m.relations ?? null,
        });
      }
      for (const o of fundsEntry.officials ?? []) {
        const slug = fundsSlugMap[o.slug] ?? null;
        take(slug || `funds-official:${o.slug}`, {
          arm: "funds",
          slug,
          href: `/officials/${o.slug}`,
          name: o.name,
          kind: "official",
          category: o.category ?? null,
          institution: o.institution ?? null,
          municipality: o.municipality ?? null,
          latestDeclarationYear: o.latestDeclarationYear ?? null,
          officialRoles: o.roles ?? null,
        });
      }
    }

    for (const d of links?.direct ?? []) {
      // 158 selects `slug` from `person`, so it should never be null — but the other two arms
      // both guard, and an unguarded null here would collapse EVERY slug-less row into one map
      // entry and render the survivor at `/person/null`.
      take(d.slug || `pl:${d.name}`, {
        arm: "person_layer",
        slug: d.slug ?? null,
        href: d.slug ? `/person/${d.slug}` : null,
        name: d.name,
        // 158 answers "who is in public office", not "MP or official" — `officeSource` and
        // `officeRole` carry the real answer and the tile labels them. `kind` here only picks
        // the avatar, and an `mp-N` slug is the one case where an MP photo exists.
        kind: /^mp-\d+$/.test(d.slug || "") ? "mp" : "official",
        officeSource: d.officeSource ?? null,
        officeRole: d.officeRole ?? null,
        trRoles: Array.isArray(d.roles) ? d.roles : [],
        linkBasis: d.linkBasis ?? null,
      });
    }

    const direct = [...byKey.values()];
    // See note 4: a person in the direct block must never reappear as a distant lead.
    const directSlugs = new Set(direct.map((d) => d.slug).filter(Boolean));
    const bridgedAll = links?.bridged ?? [];
    const bridged = bridgedAll.filter((b) => !directSlugs.has(b.slug));

    const state = (res, hasRows) =>
      res.r === UNAVAILABLE ? "unavailable" : hasRows ? "ok" : "absent";

    return {
      body: {
        eik,
        name: links?.name ?? null,
        direct,
        bridged,
        // 158's true totals ride through so the tile can say how much of the answer it is
        // showing. `directCount` is 158's own count and NOT `direct.length` — the union is
        // wider than 158 — so the tile reports the union's length beside it.
        directCount: links?.directCount ?? null,
        bridgedCount: links?.bridgedCount ?? null,
        directTruncated: links?.directTruncated ?? false,
        // 158's flag is about ITS array; a row we dropped as a duplicate is not truncation.
        bridgedTruncated: links?.bridgedTruncated ?? false,
        // ⚠️ WITHIN THE RETURNED WINDOW ONLY. `bridgedCount` is 158's total over the whole
        // answer while this counts duplicates inside the `lim`-row array, so when
        // `bridgedTruncated` is true the two are not on the same base — a tile computing
        // "showing N of M" from them would overstate the remainder. Do not present a subtraction
        // of these two as exact.
        bridgedSuppressedAsDirect: bridgedAll.length - bridged.length,
        bridgeMaxCompanies: links?.bridgeMaxCompanies ?? null,
        bridgeFoldsSuppressed: links?.bridgeFoldsSuppressed ?? null,
        // ⚠️ `absent` means THIS ARM CONTRIBUTED NOTHING for this EIK — never "this company is
        // clean". Only `unavailable` licenses the tile to say the check could not run.
        // ⚠️ ALL THREE TEST CONTRIBUTION, NOT MERE EXISTENCE, or the tri-state does not mean what
        // the line above says. `company_political_links` builds its result with
        // `jsonb_build_object` over CTEs and no outer FROM, so it returns a NON-NULL object for
        // every input — `!!links` is true for an EIK that is not in the corpus at all, which
        // would make `personLayer: "absent"` unreachable dead state. Likewise a funds shard row
        // can exist with both arrays empty. One vocabulary, three arms.
        arms: {
          pg: state(pgRes, pgRows.length > 0),
          funds: state(
            fundsRes,
            !!(fundsEntry?.mps?.length || fundsEntry?.officials?.length),
          ),
          personLayer: state(
            linkRes,
            (links?.direct?.length ?? 0) + (links?.bridged?.length ?? 0) > 0,
          ),
        },
      },
    };
  },
  // Contractor name search for the procurement dashboard tile — any firm that
  // signed a public contract, deduped to one row per eik (best-matching name).
  "company-search": async (dbRows, q) => {
    const term = s(q, "q");
    if (!term) return { status: 400, body: { error: "missing q" } };
    const companies = await dbRows(
      `WITH s AS (SELECT * FROM search_contractors($1, 60))
       SELECT eik, name, contracts, contracts_eur AS "contractsEur"
       FROM (
         SELECT DISTINCT ON (eik) eik, name, contracts, contracts_eur, sim
         FROM s ORDER BY eik, sim DESC, length(name)
       ) d
       ORDER BY sim DESC, length(name), eik
       LIMIT 20`,
      [term],
    );
    return { body: { companies } };
  },
  // Combined procurement search — one query, grouped results: contractors,
  // buyers (deduped to one row per eik — corpus rows carry name aliases),
  // contract subjects and tender subjects. Persons are merged client-side from
  // person_procurement_index.json (bilingual token matching lives there).
  //
  // DEPLOY COUPLING: needs schema pg/035_procurement_search.sql applied and
  // awarder_search / contracts.title_fold rebuilt before this route is live —
  // see docs/plans/procurement-dashboard-redesign-v1.md for the checklist. The
  // ЕВРОФОНДОВЕ group additionally needs pg/086_search_fund_projects.sql (applied
  // by load_funds_pg); until then its query degrades to [] via the allSettled.
  //
  // allSettled, not all: a failing group (e.g. search_tender_subjects on a DB
  // where tenders isn't loaded yet) degrades that group to [] instead of
  // blanking every entity type in the search box.
  "procurement-search": async (dbRows, q) => {
    const term = s(q, "q");
    if (!term) return { status: 400, body: { error: "missing q" } };
    const lim = clampInt(q.limit, 6, 1, 20);
    const dedupByEik = (fn) => `
      WITH s AS (SELECT * FROM ${fn}($1, 60))
      SELECT eik, name, contracts, contracts_eur AS "contractsEur"
      FROM (
        SELECT DISTINCT ON (eik) eik, name, contracts, contracts_eur, sim
        FROM s ORDER BY eik, sim DESC, length(name)
      ) d
      ORDER BY sim DESC, length(name), eik
      LIMIT $2`;
    // Every group as a function of the needle, so the shliokavitsa rewrite can re-run the
    // SAME six without a second copy of the SQL drifting from the first.
    const groupQueries = (needle) => [
      dbRows(dedupByEik("search_contractors"), [needle, lim]),
      dbRows(dedupByEik("search_awarders"), [needle, lim]),
      dbRows(
        `SELECT key, title, date, awarder_name AS "awarderName",
                contractor_name AS "contractorName", amount_eur AS "amountEur"
         FROM search_contract_titles($1, $2)`,
        [needle, lim],
      ),
      dbRows(
        `SELECT unp, subject, publication_date AS "publicationDate",
                buyer_name AS "buyerName",
                estimated_value_eur AS "estimatedValueEur"
         FROM search_tender_subjects($1, $2)`,
        [needle, lim],
      ),
      // ЕВРОФОНДОВЕ · ИСУН projects (§4.1) — degrades to [] on a DB predating
      // migration 086 via the allSettled below. Only the tile-consumed columns
      // (the dossier's ИСУН block fetches full fund rows by contract_number).
      dbRows(
        `SELECT contract_number AS "contractNumber", title,
                beneficiary_eik AS "beneficiaryEik",
                beneficiary_name AS "beneficiaryName",
                program_name AS "programName",
                total_eur AS "totalEur"
         FROM search_fund_projects($1, $2)`,
        [needle, lim],
      ),
      // INTERREG — its OWN group, not folded into the ИСУН one above. The two
      // are different corpora with different keys: a fund project is keyed by
      // contract_number, an Interreg operation only by its keep.eu id (its
      // operation_id is NULL for every 2014-2020 row). Merging them would force
      // a NULL key on one side. Degrades to [] on a database predating 138 via
      // the allSettled below.
      dbRows(
        `SELECT keep_id AS "keepId", title, programme_bg AS "programmeBg",
                period, bg_budget_eur AS "bgBudgetEur",
                partner_hit AS "partnerHit"
         FROM search_interreg_operations($1, $2)`,
        [needle, lim],
      ),
    ];
    // The rewrite resolves CONCURRENTLY with the six groups, so it costs nothing on a query
    // that has no rewrite — which is nearly all of them, and then no second batch runs.
    const [settled, alt] = await Promise.all([
      Promise.allSettled(groupQueries(term)),
      shlyoAlt(dbRows, term),
    ]);
    const groups = settled.map((r) =>
      r.status === "fulfilled" ? r.value : [],
    );
    if (alt) {
      // Same six groups, same order, so the merge below can pair them by index. Each group
      // keeps every row it already had; the rewrite only extends the tail.
      const settled2 = await Promise.allSettled(groupQueries(alt));
      const KEYS = [
        (r) => r.eik,
        (r) => r.eik,
        (r) => r.key,
        (r) => r.unp,
        (r) => r.contractNumber,
        (r) => r.keepId,
      ];
      settled2.forEach((r, i) => {
        if (r.status === "fulfilled")
          groups[i] = mergeAlt(groups[i], r.value, KEYS[i], lim);
      });
    }
    const [companies, awarders, contracts, tenders, funds, interreg] = groups;
    // Total matches per "see all" group, so the dropdown can show "6 of N" and
    // the preview cap reads as a preview, not the whole result. Only paid when
    // the preview is actually capped (length === lim ⇒ there may be more), and
    // bounded to 100 so a very common word ("ремонт", ~35k hits) stays cheap —
    // the UI renders 100 as "99+". Mirrors the search fns' predicate (title/
    // subject FTS prefix-AND OR trigram fallback over the fold).
    // COUNTS THE SAME NEEDLE THE ROWS CAME FROM. When the shliokavitsa rewrite fired, the
    // preview can be filled entirely by rows the plain needle never matched — measured on
    // q=6umen, where contracts merged to 6 while a plain-needle count returned 1 (the true
    // total for "shumen" is 100) and tenders went 0 rows to 6 with a total of 0. The UI then
    // renders no "N of M" at all rather than a wrong one, so it fails invisibly.
    //
    // $2 is the alternate or the plain needle again, so the predicate is a union of the two
    // whenever a rewrite exists and a harmless duplicate of itself when it does not.
    const boundedTotal = async (table, foldCol, extra, shown) => {
      if (shown < lim) return shown; // preview wasn't capped → we have them all
      const rows = await dbRows(
        `SELECT count(*)::int AS n FROM (
           SELECT 1 FROM ${table}
           WHERE ${extra}
             AND (to_tsvector('simple', ${foldCol}) @@ fold_prefix_tsquery($1)
                  OR ${foldCol} %> translit_bg_latin($1)
                  OR to_tsvector('simple', ${foldCol}) @@ fold_prefix_tsquery($2)
                  OR ${foldCol} %> translit_bg_latin($2))
           LIMIT 100) x`,
        [term, alt || term],
      );
      return Number(rows[0]?.n ?? shown);
    };
    const [contractsTotal, tendersTotal] = await Promise.all([
      boundedTotal(
        "contracts",
        "title_fold",
        "tag = 'contract' AND title IS NOT NULL AND title <> ''",
        contracts.length,
      ),
      boundedTotal(
        "tenders",
        "subject_fold",
        "subject IS NOT NULL AND subject <> ''",
        tenders.length,
      ),
    ]);
    return {
      body: {
        companies,
        awarders,
        contracts,
        tenders,
        funds,
        interreg,
        contractsTotal,
        tendersTotal,
        // The needle the extra rows came from, or null. A "see all" link MUST use it: the
        // browse tables it lands on run their own search and do not carry this rewrite, so
        // a link built from what the reader typed advertises 6 rows and delivers 1.
        altQuery: alt || null,
      },
    };
  },
  // openTenders corpus path (topic / free-keyword / bare-year) → matched top-N
  // rows + full-set aggregates (count, Σ estimate, cancelled, biggest). Topic
  // match = subject/CPV-description regex OR exact-CPV membership, mirroring
  // @/lib/tenderTopics.tenderMatchesTopic. `cpv` is a comma-joined code list and
  // `buyerTokens` a comma-joined token list (both optional); `pattern`/`keyword`
  // are bound VALUES (never spliced), and the READ ONLY tx + statement_timeout
  // bound any regex cost. Degrades to an empty payload on a tenders-less DB.
  "tender-corpus-search": async (dbRows, q) => {
    const year = Number.isFinite(Number(q.year))
      ? Math.trunc(Number(q.year))
      : null;
    const cpv = s(q, "cpv") ? s(q, "cpv").split(",").filter(Boolean) : [];
    const tokens = s(q, "buyerTokens")
      ? s(q, "buyerTokens").split(",").filter(Boolean)
      : [];
    const limit = clampInt(q.limit, 12, 1, 50);
    const rows = await dbRows(
      "SELECT tender_corpus_search($1, $2, $3, $4, $5, $6) AS r",
      [year, cpv, orNull(q, "pattern"), orNull(q, "keyword"), tokens, limit],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // procurementAppeals corpus rollup — totals + per-year + top-25 buyers (port of
  // build_kzk_summary.ts). Empty payload on a DB without the migration/kzk table.
  "kzk-appeals-summary": async (dbRows) => {
    // Load-time cache matview (044): the live function LEFT JOINs kzk_appeals →
    // tenders (126k) and has spiked to 113s on Cloud SQL under a bad plan / cold
    // cache. Serve the precomputed row; fall through to the live function only
    // when the matview is absent (older DB).
    try {
      const c = await dbRows("SELECT r FROM kzk_appeals_summary_cache", []);
      if (c[0]?.r) return { body: c[0].r };
    } catch {
      // matview absent — fall through to the live computation
    }
    const rows = await dbRows("SELECT kzk_appeals_summary() AS r", []).catch(
      missingMigrationEmpty,
    );
    return { body: rows[0]?.r ?? null };
  },
  // АОП debarred-suppliers register — the still-active debarments (open-ended or
  // not yet lapsed), newest expiry first, + the historical total. now() under the
  // READ ONLY tx dates the "active" cut. Serves procurementDebarred + the
  // active_debarred count on procurementRedFlags.
  async debarred(dbRows) {
    const activePred =
      "(debarred_until IS NULL OR debarred_until = '' OR debarred_until >= to_char(now(), 'YYYY-MM-DD'))";
    const [entries, totals] = await Promise.all([
      dbRows(
        `SELECT name, published_at AS "publishedAt",
                debarred_until AS "debarredUntil", details_url AS "detailsUrl"
         FROM debarred WHERE ${activePred}
         ORDER BY debarred_until DESC NULLS LAST, name`,
        [],
      ).catch(missingMigrationEmpty),
      dbRows(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE ${activePred})::int AS active
         FROM debarred`,
        [],
      ).catch(() => [{ total: 0, active: 0 }]),
    ]);
    return {
      body: {
        entries,
        total: totals[0]?.total ?? 0,
        active: totals[0]?.active ?? 0,
      },
    };
  },
  async recent(dbRows, q) {
    return {
      body: {
        rows: await dbRows("SELECT * FROM recent_updates($1, $2)", [
          clampInt(q.days, 1, 1, 3650),
          clampInt(q.limit, 200, 1, 1000),
        ]),
      },
    };
  },

  // ── ИСУН EU-funds serving (mirrors the retired data/funds/ GCS JSON) ─────────
  // Every precomputed funds page payload is stored verbatim in fund_payloads
  // keyed by (kind, key); a fetch is one PK seek returning the jsonb (or null
  // when the place/programme/entity has no funds activity — the hooks render a
  // nothing-friendly empty state, same as the old 404 → null behaviour).
  "fund-payload": async (dbRows, q) => {
    const kind = s(q, "kind");
    if (!kind) return { status: 400, body: { error: "missing kind" } };
    const key = s(q, "key"); // '' for singletons
    const rows = await dbRows(
      "SELECT payload FROM fund_payloads WHERE kind = $1 AND key = $2",
      [kind, key],
    );
    return { body: rows[0]?.payload ?? null };
  },
  // Per-beneficiary rollup → FundsBeneficiary (was beneficiaries-by-eik/{eik}).
  "fund-beneficiary": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const rows = await dbRows("SELECT fund_beneficiary_detail($1) AS r", [eik]);
    return { body: rows[0]?.r ?? null };
  },
  // Single project detail → FundsProjectsContractFile (was by-contract/{key}).
  "fund-contract": async (dbRows, q) => {
    const key = s(q, "key");
    if (!key) return { status: 400, body: { error: "missing key" } };
    const rows = await dbRows("SELECT fund_contract_detail($1) AS r", [key]);
    return { body: rows[0]?.r ?? null };
  },

  // ── ДФ „Земеделие" subsidies serving (agri_payloads, migration 046) ──────────
  // Every precomputed /subsidies page payload is stored verbatim keyed by
  // (kind, key): 'overview' (key '' | 'all' | '<financial year>') = the national
  // dashboard for one scope; 'recipient' (key = eik) = a per-legal-entity
  // rollup. One PK seek → the jsonb.
  //
  // A missing row means two different things, so it gets two different statuses:
  //
  //   'recipient' → 200 with null. "This EIK received no subsidies" is a
  //     CORRECT, permanent answer about a real entity; /farm/:eik and the
  //     /company/:eik tile render it as an empty state. Same contract as
  //     fund-beneficiary above.
  //   'overview'  → 404. The key is a SCOPE, not an entity: a scope either was
  //     precomputed or does not exist. Serving null there let the client sit on
  //     a success-with-no-data forever (the /subsidies skeleton never resolved),
  //     and — as with procurement-geo — /api/db responses are CDN-cached for an
  //     hour with 24 h stale-while-revalidate, so a null served while the loader
  //     had not yet run would be pinned at the edge long after the data landed.
  //
  // The client maps this 404 back to `null` (fetchAgriPayload) and renders the
  // no-data state; anything else still throws.
  "agri-payload": async (dbRows, q) => {
    const kind = s(q, "kind");
    if (!kind) return { status: 400, body: { error: "missing kind" } };
    const key = s(q, "key"); // '' for the default-scope overview
    const rows = await dbRows(
      "SELECT payload FROM agri_payloads WHERE kind = $1 AND key = $2",
      [kind, key],
    ).catch(missingMigrationEmpty);
    const payload = rows[0]?.payload ?? null;
    if (payload === null && kind === "overview")
      return { status: 404, body: { error: "unknown or unbuilt scope" } };
    return { body: payload };
  },
  // The /subsidies hub's ONE stat call (migration 162). Every tile figure for one
  // scope, from a matview seek — 541 buffers, 1.5 ms — so the hub does not fetch
  // the module's artifacts to draw preview numbers.
  //
  // `scope` is the agri_payloads overview key ('' | <year> | 'all'), the same value
  // agriScopeToKey resolves for the page. An UNKNOWN scope returns null rather than
  // 404: unlike agri-payload, whose key is the page's whole content, a hub with no
  // figures is a hub that still renders — its tiles simply carry no metric, which is
  // the honest state for a scope this corpus does not cover. A `0` would be a claim.
  //
  // DEGRADES on the narrow set that means „not built yet", never on anything else:
  //   42883 undefined_function      — 162 never applied
  //   42P01 undefined_table         — the matview is absent
  //   55000 object_not_in_prerequisite_state — created WITH NO DATA, i.e. every
  //                                   first cloud deploy; reading it RAISES rather
  //                                   than returning zero rows
  //   55P03 lock_not_available      — a REFRESH holds AccessExclusive right now
  // NOT 57014: that is the pool's own statement_timeout, so the budget is already
  // spent and degrading turns one slow failure into two. NOT 42501 either — a
  // missing GRANT is PERMANENT, not a refresh artifact, so it must stay loud rather
  // than serve a figure-less hub for ever.
  "agri-hub-stats": async (dbRows, q) => {
    const scope = s(q, "scope") || "";
    const rows = await dbRows("SELECT agri_hub_stats($1) AS r", [scope]).catch(
      (e) => {
        if (!["42883", "42P01", "55000", "55P03"].includes(e?.code))
          return Promise.reject(e);
        logMissOnce(
          `ahs:not-built:${e.code}`,
          `agri-hub-stats: read failed (${e.code}) — the /subsidies hub will render ` +
            `without its figures. Run npm run db:load:agri:pg (applies + refreshes 162).`,
        );
        return [{ r: null }];
      },
    );
    return { body: rows[0]?.r ?? null };
  },
  // ── Schools / education serving (school_payloads, migration 055) ─────────────
  // The 'directory' blob (key '') is the whole /education dataset with the SES +
  // value-added verdicts precomputed in the loader — one PK seek, ~150 KB, vs the
  // 1.25 MB raw index the client used to fetch and regress itself.
  "education-payload": async (dbRows, q) => {
    const kind = s(q, "kind") || "directory";
    const key = s(q, "key"); // '' for the directory singleton
    const rows = await dbRows(
      "SELECT payload FROM school_payloads WHERE kind = $1 AND key = $2",
      [kind, key],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.payload ?? null };
  },
  // A school's own /company/:eik (or /awarder/:eik) page → its report card. Reads
  // the RELATIONAL schools table via idx_schools_eik — the entity-graph join
  // (schools.eik = awarder EIK), not the directory blob — so the company page can
  // surface "this EIK is a school" and link to /school/:id. One EIK can carry
  // several НЕИСПУО units (stages sharing a legal entity); pick the most-populous
  // latest cohort. null when the EIK isn't a matched school.
  "school-by-eik": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { body: null };
    const rows = await dbRows(
      `SELECT id, name, obshtina, oblast, latest_year AS "latestYear",
              latest_bel AS "latestBel", latest_n AS "latestN"
         FROM schools
        WHERE eik = $1
        ORDER BY latest_n DESC NULLS LAST, id
        LIMIT 1`,
      [eik],
    ).catch(missingMigrationRows);
    return { body: rows[0] ?? null };
  },
  // Schools in one município ranked by their latest score in a subject — the
  // `schoolScores` AI tool. Reads the RELATIONAL school_scores fact table (which
  // carries every subject: dzi_bel/dzi_math/nvo_bel/nvo_math per year), so it
  // supports subject selection the БЕЛ-centric directory blob can't, and drops
  // the tool's old 1.25 MB /schools/index.json fetch. LATERAL picks each school's
  // latest year for the chosen subject.
  "education-muni-scores": async (dbRows, q) => {
    const obshtina = s(q, "obshtina");
    const subject = s(q, "subject") || "dzi_bel";
    if (!obshtina) return { body: [] };
    const rows = await dbRows(
      `SELECT sc.name, sc.address, f.year, f.value, f.n
         FROM schools sc
         JOIN LATERAL (
           SELECT year, value, n FROM school_scores
            WHERE school_id = sc.id AND subject = $2
            ORDER BY year DESC LIMIT 1
         ) f ON true
        WHERE sc.obshtina = $1
        ORDER BY f.value DESC, sc.name`,
      [obshtina, subject],
    ).catch(missingMigrationRows);
    return { body: rows };
  },
  // ── КЗП „Колко струва" prices (migration 048) ───────────────────────────────
  // Every dashboard payload the old data/prices/*.json tree served, keyed by
  // (kind, key): 'index'|'ranking'|'chains'|'dict' (key ''), 'place' (key =
  // ekatte), 'chains-muni' (key = obshtina). One PK seek → the jsonb.
  "price-payload": async (dbRows, q) => {
    const kind = s(q, "kind");
    if (!kind) return { status: 400, body: { error: "missing kind" } };
    const key = s(q, "key");
    const rows = await dbRows(
      "SELECT payload FROM price_payloads WHERE kind = $1 AND key = $2",
      [kind, key],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.payload ?? null };
  },

  // Free-text search over the ~80k-product catalogue (trigram index).
  // Retired products (chain_count = 0) keep their slug so old URLs resolve, but
  // must never surface in search.
  "price-search": async (dbRows, q) => {
    const term = s(q, "q");
    if (term.length < 2) return { body: [] };
    // Every шльокавица reading of the term, plus the term itself — see
    // shlyoCandidates. ORed rather than chosen between, so an ambiguous rule
    // ("ia" is я in мляко and иа in италиа) can only ADD matches.
    const cands = shlyoCandidates(term);
    // Escape LIKE metacharacters (%, _, \) so a stray `%` doesn't match
    // everything — the ILIKE is a prefilter, not a wildcard search. Backslash is
    // LIKE's default escape character, so no ESCAPE clause is needed.
    const esc = (t) => "%" + t.replace(/[\\%_]/g, "\\$&") + "%";
    // An explicit OR chain, NOT `ILIKE ANY($n::text[])`. Each arm is a separate
    // indexable predicate the planner can fold into a BitmapOr over
    // idx_price_products_title_trgm; an ANY() over an array is one opaque
    // ScalarArrayOp that the GIN index cannot serve, which turns the prefilter
    // into a seq scan of the whole catalogue. Same lesson as the tender-search
    // arm in CLAUDE.md (an EXISTS there cost 37 ms → 6,617 ms). Bounded at 5
    // candidates by shlyoCandidates, so the chain cannot grow with input.
    const likes = cands.map((_, i) => `title ILIKE $${i + 1}`).join(" OR ");
    const simil = cands
      .map((_, i) => `similarity(title, $${cands.length + i + 1})`)
      .join(", ");
    const rows = await dbRows(
      // Blend match quality with popularity: a term like "лаваца" matches a
      // one-chain "КАФЕ ЛАВАЦА КГ" and the 7-chain "КАФЕ ЛАВАЦА 1КГ КУАЛИТА
      // РОСА ЗЪРНА" equally on trigram similarity, but the shopper means the
      // latter. Weighting similarity by ln(chain_count) surfaces the product
      // people actually buy without letting a loose match on a popular product
      // jump a tight one.
      //
      // The score is the BEST candidate's similarity, so a spelling only the
      // шльокавица pass reached ranks on its own merit rather than being
      // penalised for the raw term missing.
      `SELECT slug, title, pid, brand, net_qty, net_unit, chain_count,
              current_min_eur, pct_since_euro
         FROM price_products
        WHERE chain_count > 0
          AND (${likes})
        ORDER BY GREATEST(${simil}) * ln(chain_count + 2) DESC,
                 chain_count DESC, slug COLLATE "C"
        LIMIT 20`,
      [...cands.map(esc), ...cands],
    ).catch(missingMigrationRows);
    return { body: rows };
  },

  // One product: the cross-chain ladder, cheapest first.
  // Current prices come from price_current — NEVER from price_facts, whose open
  // runs include every delisted SKU (36% phantom over-count). Design §3.2.
  "price-product": async (dbRows, q) => {
    const slug = s(q, "slug");
    if (!slug) return { status: 400, body: { error: "missing slug" } };
    const ekatte = s(q, "ekatte"); // optional: narrow the ladder to one place
    // Unit-outlier guard (mirrors build_product_days.ts): for a per-kg product,
    // drop store-facts below half its cross-store median before ranking chains,
    // so a per-piece listing (a single banana at €0.76) is not shown as the
    // cheapest chain. Packaged goods keep every row. The median is over the whole
    // (place-scoped) store panel, not the per-chain mins, so one small chain
    // cannot move the floor. Ranking-only: it never hides a chain's real per-kg
    // price, only spurious per-piece values.
    const rows = await dbRows(
      `WITH p AS (SELECT * FROM price_products WHERE slug = $1),
            panel AS (
              SELECT k.eik, ch.name AS chain, pc.price_eur, pc.promo_eur,
                     pc.store_id, st.label AS store, st.settlement, p.unit_priced
                FROM p
                JOIN price_skus    k  ON k.product_id = p.product_id
                JOIN price_current pc ON pc.sku_id = k.sku_id
                JOIN price_stores  st ON st.store_id = pc.store_id
                JOIN price_chains  ch ON ch.eik = k.eik
               WHERE ($2 = '' OR st.ekatte = $2)
            ),
            med AS (
              SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY price_eur) AS m
                FROM panel
            )
       SELECT jsonb_build_object(
         'product', (SELECT to_jsonb(p) FROM p),
         'chains', COALESCE((
            SELECT jsonb_agg(to_jsonb(x)
                     ORDER BY COALESCE(x.promo_eur, x.price_eur), x.eik COLLATE "C")
              FROM (SELECT panel.eik,
                           MIN(panel.chain COLLATE "C") AS chain,
                           -- ONE store per chain — the cheapest by EFFECTIVE
                           -- price (promo wins) — and every field of the row
                           -- comes from that same store: regular, promo, label,
                           -- settlement. Taking MIN(price_eur) and
                           -- MIN(promo_eur) independently paired a promo from
                           -- one store with a regular from another, so the UI's
                           -- €/kg and "+X €" gap described no real shelf.
                           (array_agg(panel.price_eur
                              ORDER BY COALESCE(panel.promo_eur, panel.price_eur),
                                       panel.store_id))[1] AS price_eur,
                           (array_agg(panel.promo_eur
                              ORDER BY COALESCE(panel.promo_eur, panel.price_eur),
                                       panel.store_id))[1] AS promo_eur,
                           COUNT(DISTINCT panel.store_id) AS stores,
                           (array_agg(panel.store COLLATE "C"
                              ORDER BY COALESCE(panel.promo_eur, panel.price_eur),
                                       panel.store_id))[1] AS store,
                           (array_agg(panel.settlement COLLATE "C"
                              ORDER BY COALESCE(panel.promo_eur, panel.price_eur),
                                       panel.store_id))[1] AS settlement
                      FROM panel CROSS JOIN med
                     WHERE NOT panel.unit_priced OR panel.price_eur >= 0.5 * med.m
                     GROUP BY panel.eik) x), '[]'::jsonb)
       ) AS r`,
      [slug, ekatte],
    ).catch(missingMigrationEmpty);
    const r = rows[0]?.r;
    return { body: r?.product ? r : null };
  },

  // Per-product daily minimum since euro day.
  //
  // Two masks, both load-bearing. (1) A run only counts on days the SKU was
  // actually listed: `day BETWEEN k.first_seen AND k.last_seen`. Without it a
  // delisted SKU's open run drags its last price forward forever. (2) A day only
  // counts when the chain actually reported (price_chain_days) — a reporting gap
  // is a gap, never a flat line.
  "price-history": async (dbRows, q) => {
    const slug = s(q, "slug");
    if (!slug) return { status: 400, body: { error: "missing slug" } };

    // Fast path: the prerendered head is materialized by `prices:product-days`.
    const hot = await dbRows(
      `SELECT d.day::text AS day, d.min_eur, d.min_promo_eur, d.chains
         FROM price_product_days d
         JOIN price_products p ON p.product_id = d.product_id
        WHERE p.slug = $1
        ORDER BY d.day`,
      [slug],
    ).catch(missingMigrationRows);
    if (hot.length) return { body: hot };

    // Long tail: expand the step function live. Cheap here — these products have
    // one or two SKUs. (The head would cost ~190k row-days and ~370ms, which is
    // exactly why it is precomputed.)
    //
    // st.eik is always k.eik — a SKU belongs to exactly one chain, verified zero
    // cross-chain facts — so no price_stores join is needed for the mask.
    // Unit-outlier guard mirrors build_product_days.ts: per-kg products drop
    // store-facts below half the day's cross-store median so a single per-piece
    // price cannot pin the min; packaged goods keep the raw min. (For a 1–2 SKU
    // tail product the half-median floor never bites — there is no panel.)
    const rows = await dbRows(
      `WITH p AS (SELECT product_id, unit_priced FROM price_products WHERE slug = $1),
            span AS (SELECT min(day) AS d0, max(day) AS d1 FROM price_grid_days),
            pd AS (
              SELECT d.day::date AS day, k.eik, f.price_eur, f.promo_eur,
                     (SELECT unit_priced FROM p) AS unit_priced
                FROM span
                CROSS JOIN generate_series(span.d0, span.d1, interval '1 day') AS d(day)
                JOIN price_skus  k ON k.product_id = (SELECT product_id FROM p)
                                  AND d.day::date BETWEEN k.first_seen AND k.last_seen
                JOIN price_facts f ON f.sku_id = k.sku_id
                                  AND f.valid_from <= d.day::date
                                  AND (f.valid_to IS NULL OR f.valid_to >= d.day::date)
                JOIN price_chain_days cd ON cd.day = d.day::date AND cd.eik = k.eik
            ),
            med AS (
              SELECT day, percentile_cont(0.5) WITHIN GROUP (ORDER BY price_eur) AS m
                FROM pd GROUP BY day
            )
       SELECT pd.day::text AS day,
              MIN(pd.price_eur)      AS min_eur,
              MIN(LEAST(pd.price_eur, COALESCE(pd.promo_eur, pd.price_eur))) AS min_promo_eur,
              COUNT(DISTINCT pd.eik) AS chains
         FROM pd JOIN med USING (day)
        WHERE NOT pd.unit_priced OR pd.price_eur >= 0.5 * med.m
        GROUP BY pd.day
        ORDER BY pd.day`,
      [slug],
    ).catch(missingMigrationRows);
    return { body: rows };
  },

  // "Did the euro raise prices?" — Croatia's Kretanje-cijena classification
  // against euro day, plus the FIFTH bucket the audit demanded: `no_baseline`
  // are products with no observation on the baseline day. Dropping them
  // understates the denominator; calling them unchanged fabricates a result.
  "price-verdict": async (dbRows) => {
    // Precomputed by build_payloads (kind='verdict') — an index-only PK seek,
    // not the full-table Parallel Seq Scan the live aggregate would run on
    // every /consumption/overview load. Falls back to the live aggregate if the
    // payload hasn't been built yet (e.g. between a schema change and a reload).
    const cached = await dbRows(
      `SELECT payload FROM price_payloads WHERE kind = 'verdict' AND key = ''`,
    ).catch(missingMigrationRows);
    if (cached[0]?.payload) return { body: cached[0].payload };
    const rows = await dbRows(
      `SELECT count(*) FILTER (WHERE pct_since_euro < -0.1)      AS cheaper,
              count(*) FILTER (WHERE pct_since_euro >  0.1)      AS dearer,
              count(*) FILTER (WHERE abs(pct_since_euro) <= 0.1) AS unchanged,
              count(*) FILTER (WHERE pct_since_euro IS NULL)     AS no_baseline,
              count(*)                                           AS total
         FROM price_products WHERE chain_count > 0`,
    ).catch(missingMigrationRows);
    return { body: rows[0] ?? null };
  },

  // Biggest movers since euro day, at product grain. Only cross-chain products,
  // so a single chain's private-label reprice cannot top the leaderboard.
  "price-movers": async (dbRows, q) => {
    const dir = s(q, "dir") === "down" ? "ASC" : "DESC";
    const rows = await dbRows(
      `SELECT slug, title, pid, chain_count, current_min_eur, pct_since_euro
         FROM price_products
        WHERE chain_count > 1 AND pct_since_euro IS NOT NULL
        ORDER BY pct_since_euro ${dir}, chain_count DESC, slug COLLATE "C"
        LIMIT 20`,
    ).catch(missingMigrationRows);
    return { body: rows };
  },

  // НЗОК per-hospital БМП payments — latest-period snapshot for the health-pack
  // tile (was data/budget/nzok/hospital_payments.json). No param. Degrades to
  // null (not 500) until migration 045 reaches this DB.
  "nzok-hospital-payments": async (dbRows) => {
    const rows = await dbRows(
      "SELECT nzok_hospital_payments_latest() AS r",
      [],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // НЗОК reimbursement for one company (its ЛЗ facilities summed) → the
  // reimbursement tile on /company/:eik. null when the EIK has no matched НЗОК
  // payments (or migration 045 not yet applied).
  "nzok-hospital-by-eik": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const rows = await dbRows(
      "SELECT nzok_hospital_reimbursement_by_eik($1) AS r",
      [eik],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // НЗОК hospital-payment momentum — national monthly series + latest-YTD vs
  // same-month-prior-year, per facility. The time dimension for the "Динамика"
  // tile. No param. null until migration 045+047 reach this DB.
  "nzok-hospital-trends": async (dbRows) => {
    const rows = await dbRows(
      "SELECT nzok_hospital_payments_trends() AS r",
      [],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // One company's spend-growth percentile among all hospitals → the percentile
  // badge on /company/:eik. null when the EIK isn't a matched hospital, lacks a
  // prior-year figure, or sits below the ranking base floor (or migration 047 not
  // yet applied).
  "nzok-hospital-momentum-by-eik": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const rows = await dbRows("SELECT nzok_hospital_momentum_by_eik($1) AS r", [
      eik,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },

  // ЕЕОФ quarterly hospital financial + capacity indicators (МЗ, Наредба № 5 от
  // 2019), 2019-Q2 →. Latest quarter's national aggregates + the largest
  // hospitals. null until migration 051 reaches this DB.
  "nzok-hospital-financials": async (dbRows) => {
    const rows = await dbRows(
      "SELECT nzok_hospital_financials_latest() AS r",
      [],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // One hospital's quarterly financial SERIES (debt, overdue debt, cost per
  // patient, occupancy, length of stay) → the financial-health strip on
  // /company/:eik. null when the EIK isn't a matched hospital.
  "nzok-financials-by-eik": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const rows = await dbRows(
      "SELECT nzok_hospital_financials_by_eik($1) AS r",
      [eik],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },

  // Per-hospital drug UNIT PRICES (НЗОК Наредба 10 „Справка 5" / ПЛС2). Overview:
  // latest period, the volume floor, and the biggest overpay-vs-median rows.
  // Comparison is at PACK identity (Национален №), never at INN — pack size and
  // dosage form would otherwise drive the ratio. null until migration 052 lands.
  "nzok-drug-unit-prices": async (dbRows) => {
    const rows = await dbRows(
      "SELECT nzok_drug_unit_prices_overview() AS r",
      [],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // The monthly median/p25/p75 series for ONE pack — "is the gap widening or
  // closing?", the question a single-year corpus structurally cannot answer.
  // The slim pack index behind the medicines group of the /sector/health search
  // box. Separate from the overview because that one's `topPacks` is LIMIT 20 —
  // a search group built on it would be a top-20. Requested only when the reader
  // focuses the box, so it costs a non-searching reader nothing.
  // The slim procedure index behind the clinical-pathway group of the
  // /sector/health search box — the SERVABLE code set. Separate from the
  // activities overview for the same reason as the pack index: bolting 571 rows
  // onto a payload every reader of two pages fetches, to serve one group that
  // only needs it after arm, is the pattern this pair exists to avoid.
  // One judicial body's page (/court/:bodyCode). Covers all 283 bodies — the
  // ~97 prosecution/investigation ones return load: null, which the page NAMES
  // rather than rendering an empty chart.
  court: async (dbRows, q) => {
    const code = s(q, "code");
    if (!code) return { status: 400, body: { error: "missing code" } };
    const rows = await dbRows("SELECT judicial_body_detail($1) AS r", [
      code,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // The slim judicial-body index behind the /judiciary search group — all 283,
  // requested on arm like the two НЗОК indexes.
  "judicial-body-index": async (dbRows) => {
    const rows = await dbRows("SELECT judicial_body_index() AS r", []).catch(
      missingMigrationEmpty,
    );
    return { body: rows[0]?.r ?? null };
  },
  // Beneficiary typeahead for /subsidies. The ONLY per-keystroke query in the
  // search feature — 16,702 distinct EIKs is past the point where a client
  // index is free. Reads the agri_beneficiary rollup, not agri_subsidies: the
  // GROUP-BY form measured 2,152 ms.
  "agri-search": async (dbRows, q) => {
    const term = s(q, "q");
    if (!term) return { status: 400, body: { error: "missing q" } };
    const lim = clampInt(q.limit, 8, 1, 20);
    const rows = await dbRows("SELECT agri_beneficiary_search($1, $2) AS r", [
      term,
      lim,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? [] };
  },
  "nzok-procedure-index": async (dbRows) => {
    const rows = await dbRows("SELECT nzok_procedure_index() AS r", []).catch(
      missingMigrationEmpty,
    );
    return { body: rows[0]?.r ?? null };
  },
  "nzok-drug-pack-index": async (dbRows) => {
    const rows = await dbRows("SELECT nzok_drug_pack_index() AS r", []).catch(
      missingMigrationEmpty,
    );
    return { body: rows[0]?.r ?? null };
  },
  "nzok-drug-pack-trend": async (dbRows, q) => {
    const nationalNo = s(q, "nationalNo");
    const nzokCode = s(q, "nzokCode");
    if (!nationalNo && !nzokCode)
      return { status: 400, body: { error: "missing nationalNo or nzokCode" } };
    const rows = await dbRows("SELECT nzok_drug_pack_trend($1, $2) AS r", [
      nationalNo,
      nzokCode,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // One hospital's overpay-vs-median rows → the drug-price strip on /company/:eik.
  // Dispersion is NOT wrongdoing: volume discounts, delivery period and contract
  // terms all move a unit price. These are pointers for a closer look, and the
  // defensible claim is persistent dispersion over months, not one month's ratio.
  "nzok-drug-overpay-by-eik": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const rows = await dbRows("SELECT nzok_drug_overpay_by_eik($1) AS r", [
      eik,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // НЗОК CLINICAL-ACTIVITY overview → the activity tile: national headline
  // (total cases, procedures, facilities), the monthly cases trend, the top
  // procedures by volume, and the pathway-internal cases-per-bed outlier
  // leaderboard. The outlier is a signpost, not a verdict (see 053_*.sql). No
  // param. Degrades to null when migration 053 is absent.
  "nzok-activities": async (dbRows) => {
    const rows = await dbRows(
      "SELECT nzok_activities_overview() AS r",
      [],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // One hospital's case-mix → the case-mix strip on /company/:eik: its top
  // procedures by cases and its share of the national volume for each. This is
  // the DENOMINATOR that makes any per-patient figure interpretable.
  "nzok-activities-by-eik": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const rows = await dbRows("SELECT nzok_activities_by_eik($1) AS r", [
      eik,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // Top hospitals by a transparent multi-signal risk index (drug overpay +
  // cases-per-bed outliers + overdue debt) → the "Риск по болници" tile on the
  // НЗОК health pack. Each row's components stay visible; rows link to /company.
  "nzok-hospital-risk": async (dbRows) => {
    const rows = await dbRows(
      "SELECT nzok_hospital_risk_ranking() AS r",
      [],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // Risk by drug (INN headline, packs nested) → the "Риск по лекарства" tile.
  "nzok-drug-risk": async (dbRows) => {
    const rows = await dbRows("SELECT nzok_drug_risk_by_inn() AS r", []).catch(
      missingMigrationEmpty,
    );
    return { body: rows[0]?.r ?? null };
  },
  // Drug-savings leaderboard (migration 055): national avoidable-overpay headline
  // + per-hospital ranking, framed as recoverable euros. A signpost, not a verdict.
  "nzok-drug-savings": async (dbRows) => {
    const rows = await dbRows(
      "SELECT nzok_drug_savings_overview() AS r",
      [],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // Per-INN QUARTERLY reimbursement trend (migration 066): national curve + the
  // top molecules' quarterly series — the multi-period drug view a one-year
  // corpus can't draw. No param.
  "nzok-drug-quarterly": async (dbRows) => {
    const rows = await dbRows(
      "SELECT nzok_drug_quarterly_overview() AS r",
      [],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // One molecule's full quarterly series — the searchable picker drill-down.
  "nzok-drug-quarterly-by-inn": async (dbRows, q) => {
    const inn = s(q, "inn");
    if (!inn) return { status: 400, body: { error: "missing inn" } };
    const rows = await dbRows("SELECT nzok_drug_quarterly_by_inn($1) AS r", [
      inn,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // One hospital's financial "report card" (migration 056): each ratio measure
  // vs the national median + the p40/p60 "around the median" band + percentile.
  "nzok-financials-measures-by-eik": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const rows = await dbRows(
      "SELECT nzok_financials_measures_by_eik($1) AS r",
      [eik],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // One measure's decile fan over time (migration 056): p10..p90 bands + median
  // per quarter, with the selected hospital's own value threaded through.
  "nzok-financials-measure-fan": async (dbRows, q) => {
    const measure = s(q, "measure");
    const eik = s(q, "eik");
    if (!measure) return { status: 400, body: { error: "missing measure" } };
    const rows = await dbRows(
      "SELECT nzok_financials_measure_fan($1, $2) AS r",
      [measure, eik ?? ""],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // One hospital's ЕЕОФ reporting coverage (migration 058): which quarters are
  // present vs missing, so a reporting gap isn't misread as a spend drop.
  "nzok-financials-coverage-by-eik": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const rows = await dbRows(
      "SELECT nzok_financials_coverage_by_eik($1) AS r",
      [eik],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // Pathway navigation WITH spend (migration 059): the by-procedure hospital list
  // plus the НРД list-price tariff and implied spend (cases × tariff) when tariffs
  // are loaded; priceEur/spendEur are null (volume-only) until then.
  "nzok-activity-by-procedure-spend": async (dbRows, q) => {
    const procedure = s(q, "procedure");
    if (!procedure)
      return { status: 400, body: { error: "missing procedure" } };
    const rows = await dbRows(
      "SELECT nzok_activity_by_procedure_spend($1) AS r",
      [procedure],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // Case-mix expected-vs-actual for one hospital (migration 059): expected Σ(list
  // tariff × cases) vs actual БМП paid, with tariff coverage. NULL until tariffs
  // are loaded (BG-egress ingest) — the STAR-PU / MSPB signal.
  "nzok-casemix-by-eik": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const rows = await dbRows(
      "SELECT nzok_casemix_expected_vs_actual($1) AS r",
      [eik],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // One molecule's (INN) full detail → the /molecule/:inn page: headline, its
  // packs, and every hospital that paid above the year median for those packs.
  // Comparison stays at pack identity; a gap is a signpost, not a verdict.
  "nzok-drug-molecule": async (dbRows, q) => {
    const inn = s(q, "inn");
    if (!inn) return { status: 400, body: { error: "missing inn" } };
    const rows = await dbRows("SELECT nzok_drug_molecule_detail($1) AS r", [
      inn,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // One pack's full detail → the /molecule/:inn/pack page: latest dispersion
  // band, the whole monthly median/p25/p75 trend, and the above-median
  // facilities. Pack identity is (nationalNo, nzokCode); one may be blank.
  "nzok-drug-pack": async (dbRows, q) => {
    const nationalNo = s(q, "nationalNo");
    const nzokCode = s(q, "nzokCode");
    if (!nationalNo && !nzokCode)
      return { status: 400, body: { error: "missing nationalNo or nzokCode" } };
    const rows = await dbRows("SELECT nzok_drug_pack_detail($1, $2) AS r", [
      nationalNo,
      nzokCode,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // Per-court натовареност for one year → the /judiciary court-load map (schema
  // 069). Fetched per year so the map never ships the 531 KB all-years JSON.
  "court-load": async (dbRows, q) => {
    const year = clampInt(q.year, 0, 2000, 2100);
    const rows = await dbRows("SELECT court_load_year($1) AS r", [year]).catch(
      missingMigrationEmpty,
    );
    return { body: rows[0]?.r ?? { year, courts: [] } };
  },
  "court-load-years": async (dbRows) => {
    const rows = await dbRows("SELECT court_load_years() AS r", []).catch(
      missingMigrationEmpty,
    );
    return { body: rows[0]?.r ?? [] };
  },
  // Geolocated ВиК operators + windowed single-bid metric → the /water operator map
  // (schema 073). One marker per operator HQ city, coloured by single-bid share.
  // Windowed [from, to) with sargable COALESCE bounds, same basis as
  // awarder-group-model. Degrades to an empty map on a DB predating the migration.
  "water-operator-map": async (dbRows, q) => {
    const eiks = s(q, "eiks")
      .split(",")
      .map((e) => e.trim())
      .filter((e) => /^\d{9,13}$/.test(e))
      .slice(0, 300);
    if (!eiks.length) return { body: { operators: [] } };
    const rows = await dbRows("SELECT water_operator_map($1, $2, $3) AS r", [
      eiks,
      orNull(q, "from"),
      orNull(q, "to"),
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? { operators: [] } };
  },
  // Geolocated МВР structures (spend + single-bid share per directorate, windowed)
  // → the /sector/security (Полиция / МВР) marker map. Folds the live contracts
  // corpus onto the static mvr_directorate_geo crosswalk server-side (schema 074),
  // so the client fetches ONE scope-aware blob instead of geocoding in the browser.
  // Windowed [from, to) with sargable COALESCE bounds, like awarder-group-model.
  "mvr-directorate-map": async (dbRows, q) => {
    const eiks = s(q, "eiks")
      .split(",")
      .map((e) => e.trim())
      .filter((e) => /^\d{9,13}$/.test(e))
      .slice(0, 300);
    if (!eiks.length) return { status: 400, body: { error: "missing eiks" } };
    const rows = await dbRows("SELECT mvr_directorate_map($1, $2, $3) AS r", [
      eiks,
      orNull(q, "from"),
      orNull(q, "to"),
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? { directorates: [] } };
  },
  "transport-project-map": async (dbRows, q) => {
    const eiks = s(q, "eiks")
      .split(",")
      .map((e) => e.trim())
      .filter((e) => /^\d{9,13}$/.test(e))
      .slice(0, 300);
    if (!eiks.length) return { status: 400, body: { error: "missing eiks" } };
    const rows = await dbRows("SELECT transport_project_map($1, $2, $3) AS r", [
      eiks,
      orNull(q, "from"),
      orNull(q, "to"),
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? { segments: [], points: [] } };
  },
  // Geolocated МТС-group entities (spend + single-bid share, windowed) → the
  // /sector/transport marker map. Folds the live contracts corpus onto the
  // static transport_facility_geo crosswalk server-side (schema 132) — same
  // shape as mvr-directorate-map.
  "transport-facility-map": async (dbRows, q) => {
    const eiks = s(q, "eiks")
      .split(",")
      .map((e) => e.trim())
      .filter((e) => /^\d{9,13}$/.test(e))
      .slice(0, 300);
    if (!eiks.length) return { status: 400, body: { error: "missing eiks" } };
    const rows = await dbRows(
      "SELECT transport_facility_map($1, $2, $3) AS r",
      [eiks, orNull(q, "from"), orNull(q, "to")],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? { facilities: [] } };
  },
  // Per-município quarterly fiscal indicators (ЗПФ чл. 130г ал. 2, schema 149) →
  // the governance tile. Takes ?obshtina= and an optional ?year=; without a year
  // it serves the newest quarter that município filed.
  //
  // Sofia is the synthetic SOF00. place_dim DOES carry the city — as
  // `code = 'SFO_CITY'` with `governance_code = 'SOF00'` — which is why the
  // function joins on COALESCE(governance_code, code): the caller passes SOF00
  // like any other code and gets „Столична община" back.
  // ── /budget — the state and municipal budget serving layer (migration 155) ──
  //
  // Eleven routes over one file. All of them degrade rather than 500, because
  // 152/153's only FILLER (db:load:budget:pg) is in REFRESH_EXCLUSIONS: a
  // database can legitimately have the tables and no rows, and — until
  // db:load:budget-muni:pg has run there — no tables at all.
  //
  // The degrade set is the skill's: 42P01 (table absent), 42883 (function
  // absent — a body change shipped before deploy:db), 55000, 55P03, 42501.
  // 57014 is DELIBERATELY ABSENT: that is the pool's own statement_timeout, so
  // the probe has already burned the budget and a fallback cannot finish
  // either. Degrading is only correct when it beats failing.
  //
  // Every miss LOGS once per process under `bh:` — that log, not latency, is
  // how an operator learns the cloud loader never ran. A zero-shaped budget
  // payload is indistinguishable from a real answer, which is the whole reason
  // the line has to exist.
  ...budgetRoutes(),
  "municipal-fiscal": async (dbRows, q) => {
    const obshtina = s(q, "obshtina").trim().toUpperCase();
    if (!/^[A-Z0-9_]{3,10}$/.test(obshtina))
      return { status: 400, body: { error: "missing or malformed obshtina" } };
    // clampInt, not orNull: a raw string bound to an ::int arg raises 22P02 and
    // the catch below rethrows it as a 500. `?year=abc`, `?year=2024.5` and a
    // duplicated `?year=` (which stringifies to "2024,2025") all take that path.
    const year =
      q.year == null || s(q, "year") === ""
        ? null
        : clampInt(q.year, 0, 2000, 2100) || null;
    const rows = await dbRows(
      "SELECT municipal_fiscal_by_obshtina($1, $2::int) AS r",
      [obshtina, year],
    ).catch((e) => {
      // Degrade rather than 500: the tile self-suppresses on a null payload, so
      // a database that has not run db:load:municipal-fiscal:pg shows no tile
      // instead of an error. The log line is the signal — latency cannot be,
      // because an absent corpus is FAST.
      if (e?.code === "42883" || e?.code === "42P01") {
        logMissOnce(
          "mf:not-built",
          "municipal_fiscal is absent — serving an empty tile. Run db:load:municipal-fiscal:pg:cloud (place_dim first).",
        );
        return [{ r: null }];
      }
      return Promise.reject(e);
    });
    return { body: rows[0]?.r ?? null };
  },
  // The national aggregate → the /indicators/fiscal tile and the governance
  // overview card. Every money total arrives WITH the count of municipalities
  // behind it, and the three threshold counts (met / below / unknown) arrive
  // separately — a suppressed column must be legible as unknown rather than as
  // a collapse to zero.
  "municipal-fiscal-national": async (dbRows, q) => {
    const year =
      q.year == null || s(q, "year") === ""
        ? null
        : clampInt(q.year, 0, 2000, 2100) || null;
    // An out-of-range quarter must 400, not serve a 200 whose met/below/unknown
    // are all 0 — that is the composed claim („no município meets the чл. 130а
    // threshold") that migration 149 splits those three counts precisely to
    // prevent, and it would be indistinguishable from a real answer.
    const rawQuarter = s(q, "quarter");
    if (rawQuarter !== "" && !/^[1-4]$/.test(rawQuarter))
      return { status: 400, body: { error: "quarter must be 1-4" } };
    const quarter = rawQuarter === "" ? null : Number(rawQuarter);
    const rows = await dbRows(
      "SELECT municipal_fiscal_national($1::int, $2::smallint) AS r",
      [year, quarter],
    ).catch((e) => {
      if (e?.code === "42883" || e?.code === "42P01") {
        logMissOnce(
          "mf:not-built:national",
          "municipal_fiscal is absent — serving no national aggregate. Run db:load:municipal-fiscal:pg:cloud.",
        );
        return [{ r: null }];
      }
      return Promise.reject(e);
    });
    return { body: rows[0]?.r ?? null };
  },
  // Year-end ranking for the national browse. Ordered by the чл. 130а т. 3 ratio
  // — commitments against the município's OWN four-year average expenditure —
  // which is why it is preferred over a per-resident sort: it normalises by
  // fiscal capacity rather than by population, so a small município mid-project
  // does not read as reckless purely because its denominator is small.
  // The YEAR-ENDS the corpus actually covers, newest first — the year picker's
  // option list. Derived rather than hard-coded because it grows with every
  // backfill and every new МФ release, and a hard-coded list offers a year that
  // serves an empty page (the `?pscope=y:<new year>` failure documented for the
  // procurement scopes).
  //
  // Q4 only: an interim quarter is not a year-end, and the чл. 130а ratios it
  // carries are measured against a different denominator.
  "municipal-fiscal-years": async (dbRows) => {
    const rows = await dbRows(
      `SELECT DISTINCT fiscal_year FROM municipal_fiscal
        WHERE quarter = 4 ORDER BY fiscal_year DESC`,
      [],
    ).catch((e) => {
      if (e?.code === "42883" || e?.code === "42P01") {
        logMissOnce(
          "mf:not-built:years",
          "municipal_fiscal is absent — serving no year list. Run db:load:municipal-fiscal:pg:cloud.",
        );
        return [];
      }
      return Promise.reject(e);
    });
    return { body: rows.map((r) => Number(r.fiscal_year)) };
  },
  "municipal-fiscal-ranking": async (dbRows, q) => {
    // `Number(...) || 300` sent ?limit=0 to 300 rather than to the floor of 1,
    // and ?limit=12.5 straight to a 22P02.
    const limit = clampInt(q.limit, 300, 1, 1000);
    const year =
      q.year == null || s(q, "year") === ""
        ? null
        : clampInt(q.year, 0, 2000, 2100) || null;
    const rows = await dbRows(
      "SELECT * FROM municipal_fiscal_ranking($1::int, $2::int)",
      [year, limit],
    ).catch((e) => {
      // Logged like its two siblings. An empty browse degrading in silence is
      // the one of the three most likely to be read as "no municipalities
      // qualify" rather than as "the loader never ran here".
      if (e?.code === "42883" || e?.code === "42P01") {
        logMissOnce(
          "mf:not-built:ranking",
          "municipal_fiscal is absent — serving an empty ranking. Run db:load:municipal-fiscal:pg:cloud.",
        );
        return [];
      }
      return Promise.reject(e);
    });
    return { body: rows };
  },
  // Companies REGISTERED at a place → the "фирми, регистрирани тук" tile on the
  // settlement / municipality governance pages (schema 133). Takes exactly one
  // of ?ekatte= (settlement) or ?obshtina= (municipality code); passing both
  // would OR them inside the function, which is a place nobody asked about.
  //
  // The officers it returns are registry NAMES, not resolved identities — the
  // tile renders them as such. That distinction is the whole point of the
  // route: its predecessor showed a place's companies only when an MP name
  // matched one, which published 319 namesake companies as one MP's.
  // Interreg money attributed to ONE place, served live from the two fact
  // tables (137) — never from fund_payloads, which the next db:load:funds:pg
  // would silently erase.
  //
  // Every € here is a sum of PARTNER budgets. The operation total travels as a
  // per-operation scalar for context and is never aggregated: on BSB00963 it is
  // €1,419,207.76 against Малко Търново's €357,183.12.
  "interreg-place": async (dbRows, q) => {
    const ekatte = s(q, "ekatte");
    const obshtina = s(q, "obshtina");
    const empty = {
      partnerCount: 0,
      operationCount: 0,
      budgetEur: 0,
      unpublishedPartnerCount: 0,
      linkedCount: 0,
      operations: [],
    };
    // Every obshtina code shape place_dim actually carries, enumerated rather
    // than guessed: BGS12 / SFO26 (3 letters + 2 digits, 264 of them), S2401
    // (Sofia's 24 районы, 1 letter + 4 digits), and SFO_CITY — Столична
    // община, which alone holds 272 of the 1,469 placed Bulgarian partner
    // rows, so a `[A-Z]{2,3}\d{2}`-only check 400s the single largest place in
    // the corpus while every other municipality answers fine. The 6 two-letter
    // abroad pseudo-obshtini (EU, NA, AF…) are deliberately NOT admitted: no
    // Interreg partner is placed there.
    if (
      !/^\d{5}$/.test(ekatte) &&
      !/^([A-Z]{3}\d{2}|S\d{4}|SFO_CITY)$/.test(obshtina)
    )
      return { status: 400, body: { error: "missing ekatte or obshtina" } };
    const rows = await dbRows(
      "SELECT interreg_by_place($1, $2, $3) AS r",
      // ekatte wins when both are sent, so the answer is always one place.
      [
        /^\d{5}$/.test(ekatte) ? ekatte : null,
        /^\d{5}$/.test(ekatte) ? null : obshtina,
        clampInt(q.limit, 20, 1, 100),
      ],
    ).catch(
      missingMigrationLogged(
        "interreg-place",
        empty,
        "db:load:interreg:pg:cloud (and apply 138)",
      ),
    );
    return { body: rows[0]?.r ?? empty };
  },
  // Interreg money for ONE company or institution, by EIK.
  //
  // TIER L ONLY, and the caller must say so: keep.eu's national-id field exists
  // only in the 2021-2027 template (0 of 1,080 Bulgarian 2014-2020 rows carry
  // one), so an empty answer here is "we cannot link it", NOT "no money".
  //
  // A NON-empty answer needs the same warning and that is the easier one to miss:
  // an organisation active in both periods gets its 2021-2027 half back and
  // nothing else. Община Гоце Делчев returns €712,599.55 while 7 further rows
  // worth €1,665,237.72 sit under the identical partner_name with a NULL eik.
  // `periods` is what lets a caption say WHICH window the figure covers instead
  // of presenting a partial as a total.
  "interreg-company": async (dbRows, q) => {
    const eik = s(q, "eik");
    const empty = {
      partnerCount: 0,
      operationCount: 0,
      budgetEur: 0,
      unpublishedPartnerCount: 0,
      periods: {},
      operations: [],
    };
    if (!/^\d{9}$/.test(eik))
      return { status: 400, body: { error: "missing or malformed eik" } };
    const rows = await dbRows("SELECT interreg_by_eik($1, $2) AS r", [
      eik,
      clampInt(q.limit, 50, 1, 200),
    ]).catch(
      missingMigrationLogged(
        "interreg-company",
        empty,
        "db:load:interreg:pg:cloud (and apply 138)",
      ),
    );
    return { body: rows[0]?.r ?? empty };
  },
  // The national Interreg picture for the /funds hub (138).
  //
  // Live over the fact tables, NOT via fund_payloads: an interreg-* kind written
  // there would be silently deleted by the next db:load:funds:pg, whose stage
  // merge runs an unscoped anti-join DELETE and whose parity guard would pass.
  "interreg-overview": async (dbRows, q) => {
    const empty = {
      budgetEur: 0,
      partnerCount: 0,
      operationCount: 0,
      programmeCount: 0,
      placedCount: 0,
      unpublishedPartnerCount: 0,
      periods: {},
      programmes: [],
    };
    const rows = await dbRows("SELECT interreg_overview($1) AS r", [
      clampInt(q.limit, 12, 1, 40),
    ]).catch(
      missingMigrationLogged(
        "interreg-overview",
        empty,
        "db:load:interreg:pg:cloud (and apply 138)",
      ),
    );
    return { body: rows[0]?.r ?? empty };
  },
  // One Interreg operation with its FULL partnership — /funds/interreg/:keepId.
  //
  // 200 + null for an unknown id (the funds convention this sits beside), so a
  // deleted or mistyped keepId renders the page's not-found branch rather than
  // surfacing as a fetch error.
  "interreg-operation": async (dbRows, q) => {
    const raw = s(q, "keepId");
    // keep.eu ids are sparse but bounded (max 34,025 today at 32,702 projects),
    // so a plain positive-integer gate is the right shape — a range check would
    // have to be revised on every upstream import.
    if (!/^[1-9]\d{0,8}$/.test(raw))
      return { status: 400, body: { error: "missing or malformed keepId" } };
    const rows = await dbRows("SELECT interreg_operation($1) AS r", [
      Number(raw),
    ]).catch(
      missingMigrationLogged(
        "interreg-operation",
        null,
        "db:load:interreg:pg:cloud (and apply 138)",
      ),
    );
    return { body: rows[0]?.r ?? null };
  },
  // The per-capita municipal EU-money ranking, WITH the Interreg arm (139).
  //
  // The ranking the site published before this was ИСУН-only, and ИСУН holds no
  // Interreg project at all — a system boundary (Jems vs ИСУН), not a filter.
  // Interreg is cross-border by definition, so the missing money landed on
  // exactly the border municipalities: 213 of the 256 ranked общини change rank
  // once it is counted, Генерал Тошево by 43 places.
  //
  // NULL, not a zero-shaped payload, for a municipality outside the ranked
  // cohort — Столична община among them, on both arms, because ГРАО carries no
  // Sofia city EKATTE. "Not ranked" and "no money" are different answers, and a
  // €0 would read as the second while meaning the first.
  //
  // Served as 200 + null rather than a 404, matching the funds convention this
  // sits beside (fetchFundPayload.ts: "a route returns the payload jsonb or null
  // — HTTP 200, never 404"). Its shared getJson THROWS on any non-ok status, so
  // a 404 here would surface as a query error on every Sofia dashboard instead
  // of the empty state it actually is.
  "funds-muni-combined": async (dbRows, q) => {
    const obshtina = s(q, "obshtina");
    // Every key shape fund_payloads' `muni-summary` actually carries, which is
    // NOT the same set as place_dim's: AAA99 (264), S#### (8) — and S22, the
    // Sofia city rollup, which is the ONE key MyAreaProjectsMapTile sends for
    // all ~25 Sofia rayon dashboards. The first draft copied the interreg-place
    // regex, which has no S## alternative, so every one of those pages 400'd —
    // four times over, since the hook throws on !ok and React Query retries.
    // The rendered number was unaffected (S22 has no published rank either way),
    // which is exactly why it would have gone unnoticed.
    if (!/^([A-Z]{3}\d{2}|S\d{2,4}|SFO_CITY)$/.test(obshtina))
      return { status: 400, body: { error: "missing or malformed obshtina" } };
    const rows = await dbRows("SELECT funds_muni_combined($1) AS r", [
      obshtina,
    ]).catch(
      missingMigrationLogged(
        "funds-muni-combined",
        null,
        "db:load:interreg:pg:cloud (and apply 139)",
      ),
    );
    return { body: rows[0]?.r ?? null };
  },
  // The leaderboard itself, plus what it does NOT cover — `excluded` carries the
  // €88.7m of Столична община's Interreg money and the 24 honestly-unplaced
  // rows, so a caption can never imply the ranking covers the whole country.
  "funds-muni-rank": async (dbRows, q) => {
    const empty = {
      cohortSize: 0,
      movedCount: 0,
      withInterregCount: 0,
      excluded: {},
      munis: [],
    };
    const rows = await dbRows("SELECT funds_muni_combined_rank($1) AS r", [
      clampInt(q.limit, 25, 1, 300),
    ]).catch(
      missingMigrationLogged(
        "funds-muni-rank",
        empty,
        "db:load:interreg:pg:cloud (and apply 139)",
      ),
    );
    return { body: rows[0]?.r ?? empty };
  },
  "place-companies": async (dbRows, q) => {
    const ekatte = s(q, "ekatte");
    const obshtina = s(q, "obshtina");
    const empty = { count: 0, moneyCount: 0, politicalCount: 0, companies: [] };
    // Same code shapes as interreg-place above — Столична община's SFO_CITY and
    // Sofia's 24 S#### районы were 400ing here, so the "фирми, регистрирани тук"
    // tile could never load for the capital while every other municipality
    // answered fine. The Interreg route was copied from this one and fixed; the
    // original was not.
    if (
      !/^\d{5}$/.test(ekatte) &&
      !/^([A-Z]{3}\d{2}|S\d{4}|SFO_CITY)$/.test(obshtina)
    )
      return { status: 400, body: { error: "missing ekatte or obshtina" } };
    const rows = await dbRows(
      "SELECT place_companies($1, $2, $3) AS r",
      // ekatte wins when both are sent, so the answer is always one place.
      [
        /^\d{5}$/.test(ekatte) ? ekatte : null,
        /^\d{5}$/.test(ekatte) ? null : obshtina,
        clampInt(q.limit, 5, 1, 50),
      ],
    ).catch(missingMigration(empty));
    return { body: rows[0]?.r ?? empty };
  },
  // Geolocated active excise warehouses → the /customs/warehouses count map
  // (schema 072). One point per warehouse; the client groups them per city.
  "excise-warehouses": async (dbRows) => {
    const rows = await dbRows("SELECT excise_warehouses_map() AS r", []).catch(
      missingMigrationEmpty,
    );
    return { body: rows[0]?.r ?? { warehouses: [] } };
  },
  // Geolocated НЗОК hospitals + live spend metrics → the health-pack hospital map
  // at the top of /awarder/121858220 (schema 075). One blob (no params); the browser
  // never geocodes.
  "nzok-hospital-map": async (dbRows) => {
    const rows = await dbRows("SELECT nzok_hospital_map() AS r", []).catch(
      missingMigrationEmpty,
    );
    return { body: rows[0]?.r ?? { total: 0, geocoded: 0, hospitals: [] } };
  },
  // Magistrate declared-companies + informational financials (schema 070).
  // One magistrate by normalized name → the /person tile (was the 123 KB file).
  "magistrate-by-name": async (dbRows, q) => {
    const norm = s(q, "norm");
    if (!norm) return { body: null };
    const rows = await dbRows("SELECT magistrate_by_name($1) AS r", [
      norm,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // Magistrates who declared a company by EIK → the /company/:eik tile.
  "magistrate-by-company": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { body: [] };
    const rows = await dbRows("SELECT magistrate_by_company($1) AS r", [
      eik,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? [] };
  },
  // `magistrate-search` (the slim roster for the procurement combined search) was RETIRED
  // here — see the tombstone in 070_magistrates.sql for why, and for why retiring it does
  // not cost a departed magistrate their findability. Its replacement is `person-search`.
  // Top-N (by declared-company count) + stats → the /judiciary tile.
  "magistrate-overview": async (dbRows, q) => {
    const limit = clampInt(q.limit, 8, 1, 5000);
    const rows = await dbRows("SELECT magistrate_overview($1) AS r", [
      limit,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? { magistrates: [], stats: {} } };
  },
  // The "richer bridge": politicians reachable from a magistrate's DECLARED
  // companies over the TR officer graph (schema 071). Empty for almost every
  // magistrate — the /person magistrate tile only renders it on a match.
  "magistrate-politician-links": async (dbRows, q) => {
    const norm = s(q, "norm");
    if (!norm) return { body: [] };
    const depth = clampInt(q.depth, 2, 1, 3);
    const rows = await dbRows(
      "SELECT magistrate_politician_links($1, $2) AS r",
      [norm, depth],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? [] };
  },

  // The ИВСС magistrate-declaration register index (kind='declarations', key=''),
  // served verbatim from judiciary_payloads (schema 109) — replaces the static
  // data/judiciary/declarations.json. missingMigrationEmpty degrades a DB predating
  // 109 to a null body, and both consumers (useJudiciaryDeclarations, the
  // judiciaryDeclarations AI tool) render their own empty state on null.
  // (persons-pg-retirement-v1 T2.6)
  "judiciary-declarations": async (dbRows) => {
    const rows = await dbRows(
      "SELECT payload FROM judiciary_payloads WHERE kind = 'declarations' AND key = ''",
      [],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.payload ?? null };
  },

  // Unified person identity (migration 082, resolved by scripts/person/resolve_persons.ts).
  // Distinct from the legacy name-keyed `person`/`person-search` above (the tr_officer
  // graph): these serve the new person_id layer by stable slug + a folded name search.
  //
  // One person's unified cross-source profile → /person/{slug}. Only active + public-safe
  // roles (person_by_slug enforces it); returns null for an unknown or review-status slug.
  "person-profile": async (dbRows, q) => {
    const key = s(q, "slug") || s(q, "name");
    if (!key) return { body: null };
    // Try the stable slug first; fall back to a UNIQUE folded-name match so the legacy
    // /person/{name} links resolve to the unified profile too (person_by_name returns null
    // on a 0- or >1-match name, and the caller then shows the legacy portfolio).
    let rows = await dbRows("SELECT person_by_slug($1) AS r", [key]).catch(
      missingMigrationEmpty,
    );
    if (!rows[0]?.r)
      rows = await dbRows("SELECT person_by_name($1) AS r", [key]).catch(
        missingMigrationEmpty,
      );
    return { body: rows[0]?.r ?? null };
  },
  // Folded name search over the resolved person table → the personSearch AI tool /
  // arbitrary-person lookup. Latin queries match Cyrillic (one normalizer).
  "person-lookup": async (dbRows, q) => {
    const term = s(q, "q");
    if (!term) return { body: [] };
    const lim = clampInt(q.limit, 20, 1, 100);
    const rows = await dbRows("SELECT person_search($1, $2) AS r", [
      term,
      lim,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? [] };
  },
  // One plenary day: every item with its title, slug, topic and tally (134 vote_item).
  //
  // Replaces the day-level half of useRollcallSession, which fetches the whole session file
  // — 482 KB on an average day and 4.97 MB on 2025-06-19 — because that file carries every
  // MP's vote on every item. This returns the agenda and the tallies; the per-MP matrix is
  // a separate call, made only for the item a reader actually opens.
  //
  // Includes the superseded re-votes, unlike every aggregate: an item put to the floor
  // twice IS a fact about the day, and this route is the day's record rather than a
  // statistic over it. `superseded_by` is returned so the page can say so.
  session: async (dbRows, q) => {
    const date = s(q, "date");
    // Shape AND validity. The regex alone admits 2026-13-45, which Postgres rejects with
    // 22007 — a 500 on a malformed query string rather than an empty day.
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { body: null };
    const parsed = new Date(`${date}T00:00:00Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date
    ) {
      return { body: null };
    }
    const rows = await dbRows(
      `SELECT item_id, item_no, slug, title, topic, reading, superseded_by,
              yes, no, abstain, absent, ns
         FROM vote_item
        WHERE date = $1
        -- ns in the sort key because UNIQUE (ns, date, item_no) PERMITS one date to carry
        -- two parliaments' items. It never has (a dissolution and a first sitting have not
        -- fallen on the same day), but item_no alone would interleave them if it ever did,
        -- and the ns reported below would then depend on sort order.
        ORDER BY ns, item_no`,
      [date],
    ).catch(tableRows("vote_item", "db:load:rollcall:pg"));
    if (!rows.length) return { body: null };
    const nsSet = [...new Set(rows.map((r) => r.ns))];
    return {
      body: {
        date,
        ns: nsSet[0],
        // Named rather than silently dropped: a day spanning two parliaments is a real
        // event this corpus has not yet seen, and the caller should know rather than be
        // handed the first one as if it were the whole story.
        ...(nsSet.length > 1 ? { spansNs: nsSet } : {}),
        items: rows,
      },
    };
  },
  // The per-MP votes for ONE item — the hemicycle, fetched when a reader expands a row.
  //
  // Driven from an explicit item id rather than a join on date, because the planner gets
  // this shape wrong at the default random_page_cost: a seq scan over the 4M-row fact table
  // costs 21,904 buffers against 1,023 for the nested loop, and prod is a db-g1-small with
  // a 10 s statement_timeout. One item is a PK range scan and cannot be planned any other
  // way.
  "session-item": async (dbRows, q) => {
    // Parsed before clamping, not after: clampInt(q.item, 0, 1, …) returns 1 for `0`, for a
    // negative and for junk, so `?item=0` served item 1's per-MP votes under someone else's
    // heading.
    const raw = Number(s(q, "item"));
    if (!Number.isInteger(raw) || raw < 1 || raw > 100000000)
      return { body: [] };
    const itemId = raw;
    const rows = await dbRows(
      `SELECT c.mp_id, c.vote, s.name, p.short AS party
         FROM vote_cast c
         LEFT JOIN mp_seat s ON s.ns = c.ns AND s.mp_id = c.mp_id
         LEFT JOIN party_dim p ON p.party_id = c.party_id
        WHERE c.item_id = $1
        ORDER BY c.mp_id`,
      [itemId],
    ).catch(tableRows("vote_cast", "db:load:rollcall:pg"));
    return { body: rows };
  },
  // Per-day topic + outcome summary for one parliament — the /votes table's two derived
  // columns (plan §7, P5).
  //
  // Replaces `topic_index.json`, an 8 MB whole-corpus artifact that /votes and the
  // contested-votes tile both fetched in full to render, between them, a topic chip set and
  // a four-segment bar. This is ~39 rows for the 52nd, served off idx_vote_item_ns_date.
  //
  // FILTERS superseded_by, unlike the `session` route above. Its consumer is a STATISTIC
  // over the day — how many items of each outcome — and the derived artifact it replaces was
  // computed after dedupeRevotes. Counting the 1,645 re-voted items again would inflate
  // every bar by up to 9.8% and disagree with the item count beside it.
  //
  // The outcome buckets replicate outcomeFor() in scripts/parliament/derived/important_votes.ts,
  // which is the only place that classification is defined. Two clauses are easy to get
  // wrong and both are load-bearing: a zero-cast item is `contested` rather than a division
  // by zero, and `abstain == cast` is UNANIMOUS (a chamber that abstained as one), not
  // rejected.
  "vote-day-summary": async (dbRows, q) => {
    const ns = clampInt(q.ns, 0, 40, 60);
    if (!ns) return { body: [] };
    const rows = await dbRows(
      `WITH standing AS (
         SELECT date, topic,
                (yes + no + abstain) AS cast_votes,
                yes, no, abstain
           FROM vote_item
          WHERE ns = $1 AND superseded_by IS NULL
       ),
       bucketed AS (
         SELECT date, topic,
                CASE
                  WHEN cast_votes = 0                     THEN 'contested'
                  WHEN yes     = cast_votes                THEN 'unanimous'
                  WHEN no      = cast_votes                THEN 'unanimous'
                  WHEN abstain = cast_votes                THEN 'unanimous'
                  WHEN yes > no + abstain                  THEN 'passed'
                  WHEN no + abstain > yes                  THEN 'rejected'
                  ELSE 'contested'
                END AS bucket
           FROM standing
       )
       SELECT date::text AS date,
              array_agg(DISTINCT topic)                            AS topics,
              count(*) FILTER (WHERE bucket = 'unanimous')::int    AS unanimous,
              count(*) FILTER (WHERE bucket = 'passed')::int       AS passed,
              count(*) FILTER (WHERE bucket = 'rejected')::int     AS rejected,
              count(*) FILTER (WHERE bucket = 'contested')::int    AS contested
         FROM bucketed
        GROUP BY date
        ORDER BY date DESC`,
      [ns],
    ).catch(tableRows("vote_item", "db:load:rollcall:pg"));
    return { body: rows };
  },
  // The most-contested votes of a parliament — the tile on /votes.
  //
  // Returns BOTH tiers in one response rather than making the caller choose. The tile's rule
  // is "the trailing window, falling back to all-time when the window is thin", and the
  // window is anchored on the corpus's newest sitting rather than on wall-clock today —
  // otherwise the tile empties during every recess, which is 11-32% of a term. Splitting
  // that across two round trips, or re-deriving the anchor client-side, is how the rule ends
  // up meaning two different things.
  //
  // contest = min(yes, no + abstain) / cast — how close the vote was, NOT the discrete
  // `contested` outcome, which fires only on an exact tie and is vanishingly rare.
  "contested-votes": async (dbRows, q) => {
    const ns = clampInt(q.ns, 0, 40, 60);
    if (!ns) return { body: { anchor: null, recent: [], allTime: [] } };
    const windowDays = clampInt(q.windowDays, 7, 1, 365);
    const lim = clampInt(q.limit, 5, 1, 50);
    const rows = await dbRows(
      `WITH scored AS (
         SELECT date::text AS date, item_no, slug, title, topic,
                yes, no, abstain,
                CASE WHEN yes + no + abstain = 0 THEN 0
                     ELSE least(yes, no + abstain)::float8 / (yes + no + abstain)
                END AS contest,
                -- The SIX-valued outcome, not the four-way bucket the day summary uses:
                -- the tile prints this one as a word and colours the row by it, so
                -- collapsing it here would lose "unanimous" — and omitting it, as the
                -- first draft did, rendered votes_outcome_undefined on every row.
                -- Mirrors outcomeFor(); vote_day_summary's gate covers the shared clauses.
                CASE
                  WHEN yes + no + abstain = 0    THEN 'contested'
                  WHEN yes     = yes+no+abstain  THEN 'passed_unanimous'
                  WHEN no      = yes+no+abstain  THEN 'rejected_unanimous'
                  WHEN abstain = yes+no+abstain  THEN 'abstain_unanimous'
                  WHEN yes > no + abstain        THEN 'passed'
                  WHEN no + abstain > yes        THEN 'rejected'
                  ELSE 'contested'
                END AS outcome
           FROM vote_item
          WHERE ns = $1 AND superseded_by IS NULL AND title IS NOT NULL
       ),
       anchored AS (SELECT max(date) AS anchor FROM scored),
       -- The 0.05 floor is the tile's own: below it a "split" vote is procedural noise.
       pool AS (
         SELECT s.*, a.anchor,
                (s.date >= (a.anchor::date - ($2::int))::text) AS in_window
           FROM scored s CROSS JOIN anchored a
          WHERE s.contest >= 0.05
       )
       -- EACH TIER IS RANKED AND LIMITED ON ITS OWN, and that is the whole shape of this
       -- query. Ranking once and windowing the result afterwards looks equivalent and is
       -- not: measured on the 51st, ZERO of the trailing week's votes appear in the global
       -- top 200, so the window would come back empty on every large parliament and the
       -- tile would show the all-time ranking for ever while claiming to show the week.
       (SELECT 'recent' AS tier, p.* FROM pool p
         WHERE p.in_window ORDER BY p.contest DESC, p.date DESC LIMIT $3)
       UNION ALL
       (SELECT 'all' AS tier, p.* FROM pool p
         ORDER BY p.contest DESC, p.date DESC LIMIT $3)`,
      [ns, windowDays, lim],
    ).catch(tableRows("vote_item", "db:load:rollcall:pg"));
    const anchor = rows[0]?.anchor ?? null;
    const strip = (r) => ({
      date: r.date,
      item: r.item_no,
      slug: r.slug,
      title: r.title,
      topic: r.topic,
      contestScore: r.contest,
      outcome: r.outcome,
      tally: { yes: r.yes, no: r.no, abstain: r.abstain },
    });
    return {
      body: {
        anchor,
        recent: rows.filter((r) => r.tier === "recent").map(strip),
        allTime: rows.filter((r) => r.tier === "all").map(strip),
      },
    };
  },
  // Attendance for one parliament (135 mp_attendance) — the /parliament/attendance table.
  // Replaces a 500 KB whole-corpus fetch with one indexed scan of ~270 rows.
  "mp-attendance": async (dbRows, q) => {
    const ns = clampInt(q.ns, 0, 40, 60);
    if (!ns) return { body: [] };
    const rows = await dbRows(
      `SELECT a.mp_id, a.items, a.present, a.absent, s.name, p.short AS party
         FROM mp_attendance a
         LEFT JOIN mp_seat s ON s.ns = a.ns AND s.mp_id = a.mp_id
         LEFT JOIN party_dim p ON p.party_id = s.party_id
        WHERE a.ns = $1
        ORDER BY a.present::numeric / NULLIF(a.items, 0) DESC NULLS LAST`,
      [ns],
    ).catch(matviewRows("mp_attendance"));
    return { body: rows };
  },
  // Group cohesion per sitting (135 party_cohesion) — the /parliament/cohesion trend.
  //
  // Filters the unaffiliated buckets HERE rather than in the matview, because the matview
  // is the record and they are real rows in it: НЕЗ and НЕЧЛ В ПГ are members without a
  // group, so their "cohesion" is a number about individuals. Charting them alongside the
  // groups is what made the 50th read 0.94 against a real-group 0.973.
  "party-cohesion": async (dbRows, q) => {
    const ns = clampInt(q.ns, 0, 40, 60);
    if (!ns) return { body: [] };
    // FOLD THE SPELLING VARIANTS. The source renames a group mid-term — the 51st carries
    // both `ГЕРБ - СДС` (3,698 items) and `ГЕРБ-СДС` (177), under different party_id rows —
    // so grouping by party_id returns 13 series for 11 groups, with two lines stopping on
    // 2024-12-20 and two more starting on 2025-01-08 and no overlapping dates between them.
    // A reader sees a group vanish and a near-identical one appear.
    const rows = await dbRows(
      `SELECT c.date,
              sum(c.items)                                          AS items,
              sum(c.cohesion * c.items) / NULLIF(sum(c.items), 0)   AS cohesion,
              min(p.short)                                          AS party
         FROM party_cohesion c
         JOIN party_dim p ON p.party_id = c.party_id
        WHERE c.ns = $1
          AND btrim(p.short) !~* '^(НЕЗ|НЕЧЛ)'
        GROUP BY c.date, upper(replace(btrim(p.short), ' ', ''))
        ORDER BY c.date, 4`,
      [ns],
    ).catch(matviewRows("party_cohesion"));
    return { body: rows };
  },
  // One MP's votes against their own group's plurality (135 mp_dissent), for the dissents
  // section on a candidate page. Replaces useMpDissents' read of dissents.json — a 31 MB
  // artifact that page downloads WHOLE whenever the per-MP shard is missing, which it is
  // for 36 members today.
  //
  // Keyed (ns, mp_id) and never mp_id alone: parliament.bg recycles member ids across
  // parliaments, and 26 of them name two genuinely different people.
  "mp-dissents": async (dbRows, q) => {
    const ns = clampInt(q.ns, 0, 40, 60);
    const mpId = clampInt(q.mp, 0, 1, 100000);
    if (!ns || !mpId) return { body: [] };
    const lim = clampInt(q.limit, 200, 1, 1000);
    // The COUNT is not `rows.length`: a member can have 621 dissents and the row list is
    // capped, so returning the page length as the total would under-report 46 seats.
    // totalCast comes from mp_attendance because a dissent-only view has no denominator —
    // without it the client renders "31 / 0".
    const rows = await dbRows(
      `WITH d AS (
         SELECT * FROM mp_dissent WHERE ns = $1 AND mp_id = $2
       )
       SELECT (SELECT count(*) FROM d)                                  AS dissent_count,
              (SELECT present FROM mp_attendance
                WHERE ns = $1 AND mp_id = $2)                           AS total_cast,
              COALESCE((
                SELECT json_agg(r ORDER BY r.date DESC, r.item_no)
                  FROM (
                    SELECT i.date, i.item_no, i.slug, i.title, i.topic,
                           d.vote, d.party_vote, d.party_members,
                           p.short AS party
                      FROM d
                      JOIN vote_item i ON i.item_id = d.item_id
                      LEFT JOIN party_dim p ON p.party_id = d.party_id
                     ORDER BY i.date DESC, i.item_no
                     LIMIT $3
                  ) r
              ), '[]'::json)                                            AS rows`,
      [ns, mpId, lim],
    ).catch(matviewRows("mp_dissent"));
    return { body: rows[0] ?? null };
  },
  // One MP's closest voting matches (135 mp_similarity). Replaces useMpSimilarity's read of
  // similarity.json (11.7 MB).
  //
  // The matview stores each pair ONCE with a_mp < b_mp, so a member appears on either side
  // depending on the other's id — hence the UNION rather than a single WHERE. Reading only
  // one side would silently return half of anyone's neighbours, weighted by whether their
  // id happens to be low.
  "mp-similarity": async (dbRows, q) => {
    const ns = clampInt(q.ns, 0, 40, 60);
    const mpId = clampInt(q.mp, 0, 1, 100000);
    if (!ns || !mpId) return { body: [] };
    const lim = clampInt(q.limit, 20, 1, 300);
    const minShared = clampInt(q.minShared, 20, 1, 100000);
    // score = dot / (norm(a) * norm(b)) — the same cosine similarity.ts computes, not an
    // agree/shared rate. similarityClass.ts calibrates its "voting twin" thresholds on this
    // scale, so a rate here would have relabelled twins on every page that shows them.
    const rows = await dbRows(
      `WITH me AS (
         SELECT sqrt(norm_sq::numeric) AS n FROM mp_vote_norm WHERE ns = $1 AND mp_id = $2
       ), pairs AS (
         SELECT b_mp AS other, overlap, dot FROM mp_similarity
          WHERE ns = $1 AND a_mp = $2
         UNION ALL
         SELECT a_mp AS other, overlap, dot FROM mp_similarity
          WHERE ns = $1 AND b_mp = $2
       )
       , scored AS (
         SELECT x.other AS mp_id,
              x.overlap,
              x.dot::numeric / NULLIF(me.n * sqrt(o.norm_sq::numeric), 0) AS score,
              s.name,
              p.short AS party
         FROM pairs x
         CROSS JOIN me
         JOIN mp_vote_norm o ON o.ns = $1 AND o.mp_id = x.other
         LEFT JOIN mp_seat s ON s.ns = $1 AND s.mp_id = x.other
         LEFT JOIN party_dim p ON p.party_id = s.party_id
        WHERE x.overlap >= $3
          -- A member who only ever abstained has a zero norm and no defined cosine.
          -- Dropping them beats serving a NULL the client would render as 0%.
          AND me.n > 0 AND o.norm_sq > 0
      )
       SELECT json_build_object(
         'top', COALESCE((SELECT json_agg(t) FROM (
                  SELECT * FROM scored ORDER BY score DESC, overlap DESC LIMIT $4) t), '[]'::json),
         -- The OTHER END of the same ranking. Taking the tail of a top-N page instead
         -- yields peers ranked N-9..N out of ~240 and labels them "most different", which
         -- is a claim about two named members that the data does not make.
         'bottom', COALESCE((SELECT json_agg(b) FROM (
                  SELECT * FROM scored ORDER BY score ASC, overlap DESC LIMIT $4) b), '[]'::json)
       ) AS r`,
      [ns, mpId, minShared, lim],
    ).catch(matviewRows("mp_similarity"));
    return { body: rows[0]?.r ?? { top: [], bottom: [] } };
  },
  // Companies at a place held by a public figure → /settlement/:id/companies and
  // /sofia/companies (migration 151). Replaces the `parliament/companies-by-ekatte/` +
  // `companies-by-obshtina/` shard families — 646 bucket files across 307 places, against
  // 1,332 settlements and 260 municipalities here.
  //
  // ONE route for what was two payload shapes: the shards shipped `{id}-summary.json`
  // (top-5 + counts) and `{id}-page-NNN.json` (50 rows), which is two fetches and two chances
  // to disagree about `count`. `pageSize` is the only difference, so the tile asks for 5 and
  // the page for 50, and the counts come from the same predicate as the rows either way.
  //
  // Accepts the same place codes as `place-companies` — Sofia's SFO_CITY and the 24 S#### rayon
  // codes included, since those 400'd on the sibling route for months.
  // ── Council ────────────────────────────────────────────────────────────────
  // Migration 161 over the 160 corpus. All four degrade a missing migration
  // rather than 500ing, so `deploy:db` can land before the loader reaches the
  // serving database — but a premature deploy then reads as "no councils are
  // covered" indefinitely, with nothing in the logs. Apply 160+161 first
  // (db:load:council:pg:cloud), per CLAUDE.md's ordering rule.
  "council-overview": async (dbRows) => {
    const empty = {
      councilsCovered: 0,
      councilsTotal: 265,
      councilsWithNamedVotes: 0,
      resolutions: 0,
      namedVotes: 0,
      attributedVotes: 0,
      newestDecidedOn: null,
      councils: [],
    };
    const rows = await dbRows("SELECT council_overview() AS r").catch(
      missingMigrationLogged(
        "council-overview",
        "cc:not-built",
        "db:load:council:pg",
      ),
    );
    return { body: rows[0]?.r ?? empty };
  },
  "council-muni": async (dbRows, q) => {
    // Accepts a FRONTEND obshtina code (BGS04, S2414, SFO_CITY…) or the
    // council's own key (BGS01, SOF). The bridge is many-to-one — Sofia is 27
    // codes -> SOF — so resolving it here is what keeps the mapping in one
    // place instead of the four copies it had before.
    const code = s(q, "code");
    if (!/^[A-Za-z0-9_]{3,12}$/.test(code))
      return { status: 400, body: { error: "missing or malformed code" } };
    const rows = await dbRows("SELECT council_muni_detail($1, $2, $3) AS r", [
      code,
      clampInt(q.limit, 20, 1, 200),
      clampInt(q.offset, 0, 0, 100_000),
    ]).catch(
      missingMigrationLogged(
        "council-muni",
        "cc:not-built",
        "db:load:council:pg",
      ),
    );
    // null = this place has no council coverage, which the tile renders as
    // "not covered" — distinct from "covered but publishes no named votes".
    // That is also why the degrade is LOGGED: both states answer null, so an
    // unbuilt migration is otherwise indistinguishable from an uncovered place
    // and would read as "no councils are covered" for ever.
    return { body: rows[0]?.r ?? null };
  },
  "council-resolution": async (dbRows, q) => {
    const id = s(q, "id");
    if (!id || id.length > 128)
      return { status: 400, body: { error: "missing id" } };
    const rows = await dbRows("SELECT council_resolution_detail($1) AS r", [
      id,
    ]).catch(
      missingMigrationLogged(
        "council-resolution",
        "cc:not-built",
        "db:load:council:pg",
      ),
    );
    return { body: rows[0]?.r ?? null };
  },
  "council-councillor": async (dbRows, q) => {
    // lo = 0 so the guard below is reachable: with lo = 1 a missing or
    // malformed personId clamps UP to 1 and silently queries person 1.
    const personId = clampInt(q.personId, 0, 0, 100_000_000);
    if (!personId) return { status: 400, body: { error: "missing personId" } };
    const rows = await dbRows("SELECT council_councillor($1) AS r", [
      personId,
    ]).catch(
      missingMigrationLogged(
        "council-councillor",
        "cc:not-built",
        "db:load:council:pg",
      ),
    );
    return { body: rows[0]?.r ?? null };
  },
  "place-mp-companies": async (dbRows, q) => {
    const ekatte = s(q, "ekatte");
    const obshtina = s(q, "obshtina");
    const empty = {
      count: 0,
      personCount: 0,
      page: 1,
      pageSize: 0,
      totalPages: 1,
      companies: [],
    };
    if (
      !/^\d{5}$/.test(ekatte) &&
      !/^([A-Z]{3}\d{2}|S\d{4}|SFO_CITY)$/.test(obshtina)
    )
      return { status: 400, body: { error: "missing ekatte or obshtina" } };
    const rows = await dbRows(
      "SELECT place_mp_companies($1, $2, $3, $4) AS r",
      // ekatte wins when both are sent, so the answer is always one place.
      [
        /^\d{5}$/.test(ekatte) ? ekatte : null,
        /^\d{5}$/.test(ekatte) ? null : obshtina,
        clampInt(q.page, 1, 1, 10_000),
        clampInt(q.pageSize, 50, 1, 200),
      ],
    ).catch(missingMigration(empty));
    return { body: rows[0]?.r ?? empty };
  },
  // An MP's Commerce-Registry management roles → the „Управленски роли" block on
  // /candidate/:id and /person/:slug (migration 150). Replaces the static
  // parliament/mp-management/{mpId}.json shard family, which was bucket-served.
  //
  // The role SET is not computed here — it is the same gated person_role tr/ngo set the
  // profile reads, so the blocks on one page cannot disagree about one named person. Note
  // 082 SPLITS that set in two (`companies` for source tr, `ngos` for source ngo) while this
  // returns it whole, because the shard it replaces listed читалище trusteeships beside
  // company directorships. Same set, different partition. Companies whose name fold the
  // Commerce Registry says is shared by more than one human, or has never been observed, are
  // refused upstream by resolve_persons.
  //
  // TWO empty answers, and they are not the same thing. `null` = no such servable person (an
  // unknown mp_id, or one flipped out of status='active'); `{…, roles: []}` = a real MP who
  // holds nothing the guard will publish — the COMMON case, 1,367 of 2,122 MPs today. The
  // static shard 404'd for both; both consumers render nothing on either.
  //
  // ⚠️ THE REPOINT IS NOT A URL SWAP. This payload deliberately drops `generatedAt`,
  // `confidence` and `confidenceReason` from the shard's `MpManagementFile` type (150's header
  // says why the confidence model is gone) and adds `linkBasis`. `MpManagementRoles` reads
  // `confidence`/`confidenceReason` for its badge and would render `undefined`, so that badge
  // has to move onto `linkBasis` BEFORE `useMpManagement` stops fetching the bucket file.
  "mp-management": async (dbRows, q) => {
    // parliament.bg profile ids are 5 digits today; the ceiling only exists so a junk param
    // is a null body rather than a 22P02 on the int bind.
    const mpId = clampInt(q.mp, 0, 1, 9_999_999);
    if (!mpId) return { body: null };
    const rows = await dbRows("SELECT mp_tr_roles($1) AS r", [mpId]).catch(
      missingMigration(null),
    );
    return { body: rows[0]?.r ?? null };
  },
  // Person↔person edges (shared company, association-noise-guarded) → the Connections
  // component (§8) + the future personConnections AI tool. Reads the unified graph (128/084).
  // Public-safe endpoints only by default; ?private=1 opts into the Tier-V verified-owner view
  // (relaxes endpoint eligibility to identity_confidence='verified', guard unchanged). The
  // payload carries its own "лид, не доказателство" disclaimer.
  "person-connections": async (dbRows, q) => {
    const slug = s(q, "slug");
    if (!slug) return { body: null };
    const includePrivate = s(q, "private") === "1";
    const rows = await dbRows("SELECT person_connections($1, $2) AS r", [
      slug,
      includePrivate,
    ]).catch(missingMigration(null));
    return { body: rows[0]?.r ?? null };
  },
  // One person's immediate neighbourhood as company nodes + typed (co-ownership + procurement)
  // edges with money — the graph-ego view (128/084 person_graph_ego). Same eligibility + Tier-V
  // toggle as person-connections.
  "graph-ego": async (dbRows, q) => {
    const slug = s(q, "slug");
    if (!slug) return { body: null };
    const includePrivate = s(q, "private") === "1";
    const rows = await dbRows("SELECT person_graph_ego($1, $2) AS r", [
      slug,
      includePrivate,
    ]).catch(missingMigration(null));
    return { body: rows[0]?.r ?? null };
  },
  // The down-sampled public-figure bridge graph for the /connections OVERVIEW — top-N bridge
  // companies by public money + their public figures + edges + the facet×facet matrix (129).
  // One precomputed blob; degrades to empty (not 500) if the graph loader has not run.
  "graph-global": async (dbRows) => {
    const rows = await dbRows(
      "SELECT payload FROM graph_payloads WHERE scope = 'global'",
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.payload ?? null };
  },
  // Global municipal-officials name index → useMunicipalOfficialsByName (ChmiFeedScreen's
  // name → /officials link resolver). Replaces the static municipal/search_index.json
  // (persons-pg-retirement-v1 T1.5). One compact row per roster listing; the client builds
  // its own name maps and matches locally, so this is a single cached fetch (staleTime
  // Infinity), not a per-name round trip. Shape mirrors the retired file: {entries:[…]}.
  "municipal-officials-name-index": async (dbRows) => {
    const rows = await dbRows(
      // municipality is COALESCEd to '' — the matview leaves institution NULL for a listing
      // with no filing, and the consumer's name-map build would otherwise carry a null.
      // ORDER BY puts role priority ahead of the slug tiebreak so the client's first-wins
      // byName map resolves a namesake collision to the mayor (then chair/deputy), matching
      // the retired role-sorted search_index.json.
      // role and district are NOT in the payload: nothing reads them. The only
      // consumer is ChmiFeedScreen, via findOfficialByName, and it uses .slug —
      // name and municipality are the map keys. role still drives the ORDER BY
      // below (server-side, unaffected); district was populated on 64 of 6,391
      // rows.
      `SELECT COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'slug', official_slug,
                    'name', name,
                    'municipality', COALESCE(municipality, '')
                  ) ORDER BY name,
                           CASE role
                             WHEN 'mayor' THEN 0
                             WHEN 'council_chair' THEN 1
                             WHEN 'deputy_mayor' THEN 2
                             WHEN 'councillor' THEN 3
                             ELSE 4
                           END,
                           official_slug
                ),
                '[]'::jsonb
              ) AS r
         FROM municipal_officials_table`,
    ).catch(missingMigrationEmpty);
    return { body: { entries: rows[0]?.r ?? [] } };
  },
  // Global header-search index of municipal officials → useSearchItems (the Fuse index).
  // Replaces the static municipal/search_index.json (persons-pg-retirement-v1 T1.5),
  // reproducing build_municipal_search.ts: resolve each name to EXACTLY ONE active public
  // person by folded name (namesake-safe), DROP rows whose person is also a candidate/mp
  // (the header already lists them as a candidate — avoids a duplicate), and stamp the
  // survivors with `personSlug` so the row links to /person. Role-priority sort, then name.
  // The `fold` CTE aggregates person once (0.9ms) rather than a per-row correlated count.
  "municipal-officials-search-index": async (dbRows) => {
    const rows = await dbRows(
      `WITH fold AS (
         SELECT p.name_fold,
                count(*) AS n,
                min(p.slug) AS slug,
                bool_or(EXISTS(
                  SELECT 1 FROM person_role r
                   WHERE r.person_id = p.person_id
                     AND r.source IN ('candidate','mp'))) AS is_candidate
         FROM person p
         WHERE p.status = 'active' AND p.is_public_figure
         GROUP BY p.name_fold
       ),
       matched AS (
         -- The join fences to exactly-one folded matches (f.n = 1), the namesake-safe rule
         -- from build_municipal_search: a joined fold row is therefore always the single
         -- trusted person, and f is NULL for a no-match OR an ambiguous name — both kept,
         -- unlinked (person_slug NULL, is_candidate false), surviving the dedup filter.
         -- m.role stays: it feeds the ORDER BY below, not the payload.
         SELECT m.official_slug, m.name, m.role, m.municipality,
                f.slug AS person_slug,
                COALESCE(f.is_candidate, false) AS is_candidate
         FROM municipal_officials_table m
         LEFT JOIN fold f
           ON f.name_fold = translit_bg_latin(m.name) AND f.n = 1
       )
       SELECT COALESCE(
                jsonb_agg(
                  -- No role / district: useSearchItems maps each entry to a
                  -- search item using slug, name, municipality and personSlug, and
                  -- reads neither. role still orders the rows below (server-side,
                  -- unaffected); district was populated on 45 of 4,955 rows.
                  jsonb_strip_nulls(jsonb_build_object(
                    'slug', official_slug,
                    'name', name,
                    'municipality', COALESCE(municipality, ''),
                    'personSlug', person_slug
                  )) ORDER BY
                    CASE role
                      WHEN 'mayor' THEN 0
                      WHEN 'council_chair' THEN 1
                      WHEN 'deputy_mayor' THEN 2
                      WHEN 'councillor' THEN 3
                      WHEN 'chief_architect' THEN 4
                      ELSE 5
                    END,
                    name
                ) FILTER (WHERE NOT is_candidate),
                '[]'::jsonb
              ) AS r
       FROM matched`,
    ).catch(missingMigrationEmpty);
    return { body: { entries: rows[0]?.r ?? [] } };
  },
  // Every election's re-keyed electoral summary for one person (newest first) → the electoral
  // block on the merged person dashboard (person-candidate-merge-v1). The caller runs the
  // existing candidate reducer over each cycle's raw `regions` + preferences_stats fields.
  "person-elections": async (dbRows, q) => {
    const slug = s(q, "slug");
    if (!slug) return { body: [] };
    const rows = await dbRows("SELECT person_elections($1) AS r", [slug]).catch(
      missingMigrationEmpty,
    );
    return { body: rows[0]?.r ?? [] };
  },
  // Declared-wealth trajectory: one point per year (assets/debts/net/income +
  // category breakdown) plus entry/vacate markers → the wealth chart (audit T3.1).
  // Off person_by_slug's hot path, lazily loaded. Public-safe (person_wealth_series
  // enforces the §6 gate); empty for an unknown / private slug.
  "person-wealth": async (dbRows, q) => {
    const slug = s(q, "slug");
    if (!slug) return { body: null };
    const rows = await dbRows("SELECT person_wealth_series($1) AS r", [
      slug,
    ]).catch(missingMigrationEmpty);
    // missingMigrationEmpty degrades to `[{ r: [] }]`; this payload is an object,
    // so an array means "no migration" → null, not a shape the client can read.
    const r = rows[0]?.r;
    return { body: Array.isArray(r) ? null : (r ?? null) };
  },
  // Every declaration this person filed, newest first, with per-filing totals →
  // the unified declaration block (audit T3.3). One payload replaces the three
  // divergent per-tier JSON trees.
  // The „Пари в чужбина" headline (migration 169). A separate route from the
  // abroad_holdings registry resource because the register can only aggregate what it
  // CONTAINS — and the number this page turns on is a RATIO whose denominator is the
  // domestic money the register deliberately excludes.
  //
  // ⚠️ Never render eurAbroad as a share of anything this payload does not carry. The same
  // numerator is 5.9% of bank+investment money (eurInScope, what this returns) and 2.3% of
  // all declared holdings; a consumer picking a denominator by accident is the failure the
  // shape prevents. See 169's header.
  //
  // Degrades to null on a database without 169 so a first deploy in either order renders
  // the page without the headline rather than 500ing it.
  "person-abroad-overview": async (dbRows) => {
    const rows = await dbRows("SELECT person_abroad_overview() AS r").catch(
      missingMigrationEmpty,
    );
    // ⚠️ missingMigrationEmpty degrades to `[{ r: [] }]` — the ARRAY sentinel. This payload
    // is an object, and `[] ?? null` is `[]`, not null: without this guard a database
    // without 169 hands the client a truthy empty array, the card renders on its presence,
    // and the page publishes „— % от " with no number and no denominator. Four sibling
    // object-shaped routes carry the same line; db_routes.person.test.js documents the rule.
    const r = rows[0]?.r;
    return { body: Array.isArray(r) ? null : (r ?? null) };
  },
  "person-declarations": async (dbRows, q) => {
    const slug = s(q, "slug");
    if (!slug) return { body: [] };
    const rows = await dbRows("SELECT person_declarations($1) AS r", [
      slug,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? [] };
  },
  // One filing in full (every asset/income/stake/event row) → the declaration
  // drill-down. Reachable only via the slug-gated lists above, so the opaque id
  // needs no separate gate.
  "declaration-detail": async (dbRows, q) => {
    const id = clampInt(q.id, null, 1, Number.MAX_SAFE_INTEGER);
    if (id == null) return { body: null };
    const rows = await dbRows("SELECT declaration_detail($1) AS r", [id]).catch(
      missingMigrationEmpty,
    );
    return { body: rows[0]?.r ?? null };
  },
  // The accumulation gap (audit T3.2): Δ declared net worth vs declared income over the
  // span. GATED — person_accumulation_gap returns NULL for anyone outside the senior
  // accountability cohort (091) and for a person with fewer than two asset-bearing years,
  // so a councillor or a one-filing official gets nothing to render. Object-shaped, so a
  // missing-migration array degrades to null rather than a shape the client can't read.
  "person-accumulation-gap": async (dbRows, q) => {
    const slug = s(q, "slug");
    if (!slug) return { body: null };
    const rows = await dbRows("SELECT person_accumulation_gap($1) AS r", [
      slug,
    ]).catch(missingMigrationEmpty);
    const r = rows[0]?.r;
    return { body: Array.isArray(r) ? null : (r ?? null) };
  },
  // New-filing feed (audit T3.10). Site-wide and IDENTICAL FOR EVERY READER: the watchlist
  // is applied in the browser, never sent here. An earlier revision passed the follow list
  // as ?slugs=..., which put the reader's political interests into the access log and — via
  // the blanket `Cache-Control: public, s-maxage=3600` in index.js — into a shared CDN cache
  // key. The body is public data; the REQUEST was the profile. firstSeen is when a filing
  // entered our data, not when it was filed.
  "new-filings": async (dbRows, q) => {
    const lim = clampInt(q.limit, 50, 1, 200);
    const rows = await dbRows("SELECT declaration_new_filings($1) AS r", [
      lim,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? [] };
  },
  // Declared wealth against peers in the same office, same year (audit T3.9). Object-shaped,
  // so a missing-migration array degrades to null rather than a shape the client can't read.
  // `percentile` is null below a 20-peer floor — 097 enforces it, not the client.
  "person-cohort-benchmark": async (dbRows, q) => {
    const slug = s(q, "slug");
    if (!slug) return { body: null };
    const rows = await dbRows("SELECT person_cohort_benchmark($1) AS r", [
      slug,
    ]).catch(missingMigrationEmpty);
    const r = rows[0]?.r;
    return { body: Array.isArray(r) ? null : (r ?? null) };
  },
  // Declared company stakes whose company holds public contracts (audit T3.8). The
  // declaration form carries no EIK, so every row here is a RESOLVED link that passed
  // all three of 096's gates — the declared name bears on a trading company that the TR
  // independently records THE DECLARED HOLDER at, exactly one such company survives, and
  // that holder's folded name identifies exactly one active person. Unconfirmed,
  // ambiguous and namesake-risky matches are absent, not flagged.
  //
  // The person's OWN stakes only: 096 also resolves holdings a filing attributes to a
  // spouse or a child, and this payload is money attributed to the subject.
  "person-stake-procurement": async (dbRows, q) => {
    const slug = s(q, "slug");
    if (!slug) return { body: [] };
    const rows = await dbRows("SELECT person_stake_procurement($1) AS r", [
      slug,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? [] };
  },
  // The other 84% — declared stakes that did NOT resolve, each with the register's reason:
  // `absent` (nothing bears the name), `ambiguous` (several trading companies do — their
  // EIKs ride along), `unconfirmed` (one does, but the register does not record the declared
  // holder there) or `namesake` (it does, and that name is shared, so 096 will not name a
  // person). Nothing here is a link; the profile has always shown these as one
  // undifferentiated list, which reads as a single failure when it is four different facts.
  "person-declared-stake-status": async (dbRows, q) => {
    const slug = s(q, "slug");
    if (!slug) return { body: [] };
    const rows = await dbRows("SELECT person_declared_stake_status($1) AS r", [
      slug,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? [] };
  },
  // Disposals + third-party expenses for one person (audit T3.4): what they transferred
  // in the year before a filing, and what someone else paid for. Register facts about a
  // filing, so public-figure gated but NOT cohort-gated like the accumulation gap.
  "person-declaration-events": async (dbRows, q) => {
    const slug = s(q, "slug");
    if (!slug) return { body: [] };
    const rows = await dbRows("SELECT person_declaration_events($1) AS r", [
      slug,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? [] };
  },
  // The site-wide feed, biggest declared value first. `kind` filters to one event kind.
  // Every row resolves to a named public person — an unattributed filing never surfaces.
  "declaration-events-feed": async (dbRows, q) => {
    const kind = s(q, "kind") || null;
    const lim = clampInt(q.limit, 50, 1, 200);
    const rows = await dbRows("SELECT declaration_events_feed($1, $2) AS r", [
      kind,
      lim,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? [] };
  },
  // OUR coverage of the register (audit T3.5): how much of what list.xml publishes we
  // actually hold, per year. A gap is our ingest's problem, never a statement about a
  // declarant — the register's `Sent` flag turned out NOT to mean filed/not-filed (a
  // Sent=False row fetches a complete declaration), so no compliance metric is served.
  "register-coverage": async (dbRows) => {
    const rows = await dbRows(
      "SELECT register_coverage_by_year() AS r",
      [],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? [] };
  },
  // The person's public-contract take bucketed by cabinet tenure (the "money vs power"
  // timeline) → lazily loaded by the money section, kept off person_by_slug's hot path
  // (person-candidate-merge-v1). EIK-exact.
  "person-money": async (dbRows, q) => {
    const slug = s(q, "slug");
    if (!slug) return { body: [] };
    const rows = await dbRows("SELECT person_money($1) AS r", [slug]).catch(
      missingMigrationEmpty,
    );
    return { body: rows[0]?.r ?? [] };
  },
  // The two portfolio cuts for a RESOLVED person (slug), off PersonDashboard's hot path like
  // person-money — the slug siblings of the name-keyed pair on /api/db/person. EIK set from
  // person_role (082 basis), so they reconcile with person_by_slug's procuredEur. Degrade to []
  // if migration 125 has not reached this DB yet (42883), same as person-money.
  "person-breakdowns": async (dbRows, q) => {
    const slug = s(q, "slug");
    if (!slug) return { body: { byCompany: [], bySettlement: [] } };
    const [byCompany, bySettlement] = await Promise.all([
      dbRows("SELECT person_procurement_by_company_slug($1) AS r", [
        slug,
      ]).catch(missingMigrationEmpty),
      dbRows("SELECT person_procurement_by_settlement_slug($1) AS r", [
        slug,
      ]).catch(missingMigrationEmpty),
    ]);
    return {
      body: {
        byCompany: byCompany[0]?.r ?? [],
        bySettlement: bySettlement[0]?.r ?? [],
      },
    };
  },
  // One MP's roster entry (migration 105) → replaces the by-id/<id>.json shard. Keyed
  // EITHER by parliament.bg's mp id (`id`) or by person slug (`slug`): the id is what a
  // caller holding a photo URL has, the slug is what PersonDashboard has, and neither
  // surface should have to learn the other's key space. Returns null for an unknown id;
  // a slug lookup additionally requires the person to be active + public.
  "mp-entry": async (dbRows, q) => {
    // MAX_SAFE_INTEGER, like the sibling declaration-detail route, and NOT a tight upper
    // bound: clampInt clamps rather than rejects, so a ceiling of 1_000_000 answered
    // `?id=99999999` with MP 1000000 — a different entity than the one asked for, where
    // the route promises null for an unknown id. `lo` of 0 keeps `?id=0` / `?id=` (both
    // trunc to 0) from being lifted onto MP 1; the fn returns NULL for them instead.
    const id =
      q.id != null ? clampInt(q.id, null, 0, Number.MAX_SAFE_INTEGER) : null;
    // `s()` yields "" for an absent param, and mp_entry branches on `p_slug IS NOT NULL`
    // — an empty string is not null, so pass a real NULL rather than a value the fn
    // would go looking for in the slug space.
    const slug = s(q, "slug") || null;
    if (id == null && !slug) return { body: null };
    const rows = await dbRows("SELECT mp_entry($1, $2) AS r", [id, slug]).catch(
      missingMigrationEmpty,
    );
    const r = rows[0]?.r;
    return { body: Array.isArray(r) ? null : (r ?? null) };
  },
  // Every filing this person made, in full (assets/income/stakes/events), newest first
  // → the declarations timeline. ONE query per person, which is the point: the client's
  // mergeDeclarationTimelines() existed only because the JSON tree split one human's
  // filings across a file per officials slug. Not restricted to the mp tier — an MP who
  // also served as a minister filed under both, and hiding half their history would be
  // an artifact of our ingest, not a fact about them.
  //
  // Payload vocabulary is declaration_detail()'s, arrayed. Heavier than
  // `person-declarations` (which returns per-filing totals only), so call that one when
  // the nested tables are not being rendered.
  "mp-declarations": async (dbRows, q) => {
    const slug = await mpSlugFromQuery(dbRows, q);
    if (!slug) return { body: [] };
    const rows = await dbRows("SELECT mp_declarations($1) AS r", [slug]).catch(
      missingMigrationEmpty,
    );
    return { body: rows[0]?.r ?? [] };
  },
  // The wealth rollup for one person's latest filing (migration 105) → replaces the
  // mp-assets/<id>.json shard. Answers for non-MPs too (a minister on PersonDashboard):
  // mpId is simply null and the wealth is still there. Figures come from
  // person_wealth_year, so this can never disagree with the wealth chart or the
  // leaderboard — and, for the same reason, does not reproduce the JSON's totals, which
  // folded company shares in. Object-shaped, so a missing-migration array degrades to
  // null rather than a shape the client can't read.
  "mp-assets": async (dbRows, q) => {
    const slug = await mpSlugFromQuery(dbRows, q);
    if (!slug) return { body: null };
    const rows = await dbRows("SELECT mp_assets($1) AS r", [slug]).catch(
      missingMigrationEmpty,
    );
    const r = rows[0]?.r;
    return { body: Array.isArray(r) ? null : (r ?? null) };
  },
  // The MP-scorecard net-worth metric's rank cohort: the MP's rank + cohort size + median
  // within one parliament's assets slice (mp_assets_rankings_table, ns bucket) — replaces the
  // client rankIn/median over the chamber-wide assets-rankings.json byNs slice
  // (persons-pg-retirement-v1 T2.2). median is a person_wealth_year numeric (the same series
  // the wealth chart + /officials/assets show). rank is NULL for an mp not in that ns slice;
  // the caller takes the MP's own net-worth VALUE from its wealth rollup (same series), so
  // this route need only return the cohort context. Gated caller-side on hasNetWorth &&
  // servedInSelectedNs, so it only fires when there is a rank to show.
  "mp-networth-rank": async (dbRows, q) => {
    const mpId = clampInt(q.mpId, null, 0, Number.MAX_SAFE_INTEGER);
    const ns = s(q, "ns");
    if (mpId == null || !ns) return { body: null };
    const rows = await dbRows(
      `WITH slice AS (
         SELECT mp_id, net_worth_eur
         FROM mp_assets_rankings_table
         WHERE ns = $2 AND net_worth_eur IS NOT NULL
       ),
       me AS (SELECT net_worth_eur AS v FROM slice WHERE mp_id = $1)
       SELECT jsonb_build_object(
         'rank', CASE WHEN (SELECT v FROM me) IS NULL THEN NULL
                      ELSE (SELECT count(*) FROM slice
                             WHERE net_worth_eur > (SELECT v FROM me)) + 1 END,
         'cohortSize', (SELECT count(*) FROM slice),
         'median', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY net_worth_eur)
                    FROM slice)
       ) AS r`,
      [mpId, ns],
    ).catch(missingMigrationEmpty);
    const r = rows[0]?.r;
    return { body: Array.isArray(r) ? null : (r ?? null) };
  },
  // The slim MP-avatar index (photo availability + party-group ring + any external photo URL,
  // keyed by mp id) → useMpAvatars / <MpAvatar> (persons-pg-retirement-v1 T2.3). Rebuilds the
  // retired data/parliament/avatars.json shape from mp_profile (migration 104), so a face +
  // party ring renders on connection pages WITHOUT the ~970 KB parliament/index.json. The
  // actual .webp images STAY on the bucket (Decision 3) — this is metadata only, and the
  // client still builds /parliament/photos/{id}.webp for the default case. `noPhoto` = the MPs
  // whose scrape found no image (photo_url NULL/''); `extra` = the rare external portrait URL.
  "mp-avatars": async (dbRows) => {
    const rows = await dbRows(
      `SELECT jsonb_build_object(
         'scrapedAt', max(scraped_at)::text,
         'total', count(*),
         'groups', coalesce(
           jsonb_object_agg(mp_id::text, current_party_group_short), '{}'::jsonb),
         'noPhoto', coalesce(
           jsonb_agg(mp_id) FILTER (WHERE photo_url IS NULL OR photo_url = ''),
           '[]'::jsonb),
         -- extra = any non-empty photo_url that is NOT the canonical default
         -- /parliament/photos/<id>.webp (an external portrait, or any custom relative path).
         -- Matches build_avatars.ts's rule exactly, not just http, so a future non-canonical
         -- relative URL can't be silently replaced by the default photo.
         'extra', coalesce(
           jsonb_object_agg(mp_id::text, photo_url) FILTER (
             WHERE photo_url IS NOT NULL AND photo_url <> ''
               AND photo_url <> '/parliament/photos/' || mp_id || '.webp'),
           '{}'::jsonb)
       ) AS r
       FROM mp_profile`,
    ).catch(missingMigrationEmpty);
    const r = rows[0]?.r;
    return { body: Array.isArray(r) ? null : (r ?? null) };
  },
  // One MP's full bio profile blob (mp_profile_detail, migration 110), served verbatim so
  // useMpProfile stops downloading data/parliament/profiles/{id}.json from the bucket
  // (persons-pg-retirement-v1 T2.3b). Returns the raw parliament.bg A_ns_* shape the hook's
  // toProfile() maps; a null body (unknown id, or a DB predating 110) → the hook's undefined.
  "mp-profile": async (dbRows, q) => {
    // Same clamp idiom as mp-entry above: default null + lo 0 (NOT 1), so junk (`?id=abc`)
    // and `?id=0`/`?id=` resolve to null / mp_id 0 — never lifted onto MP 1. clampInt clamps
    // rather than rejects, so a lo of 1 would answer `?id=abc` with mp_id 1's profile.
    // hi = int4 max because mp_id is `integer`: an id past it would otherwise be bound to the
    // int4 comparison and raise 22003 (out of range) — a 500, not the promised null body.
    const id = q.id != null ? clampInt(q.id, null, 0, 2147483647) : null;
    if (id == null) return { body: null };
    const rows = await dbRows(
      "SELECT payload FROM mp_profile_detail WHERE mp_id = $1",
      [id],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.payload ?? null };
  },
  // The full MP roster IndexFile — mp_profile rows + the mp_roster_meta header — so useMps and
  // the partyMps AI tool stop downloading the ~950 KB parliament/index.json (persons-pg-
  // retirement-v1 T2.4). photoUrl is RELATIVE (the hook resolves it through dataUrl); birthDate
  // is the date as text; nsFolders is the text[] as a JSON array. A DB predating 111 → the
  // missingMigrationEmpty sentinel ([]), which the Array.isArray guard maps to a null body →
  // the hook's undefined.
  "mp-roster": async (dbRows) => {
    const rows = await dbRows(
      `SELECT jsonb_build_object(
         'scrapedAt', m.scraped_at,
         'currentNs', m.current_ns,
         'total', m.total,
         'mps', (
           SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', mp_id,
             'name', name,
             'name_en', name_en,
             'normalizedName', normalized_name,
             'normalizedName_en', normalized_name_en,
             'photoUrl', coalesce(photo_url, ''),
             'currentRegion', CASE WHEN current_region_code IS NOT NULL
                THEN jsonb_build_object('code', current_region_code, 'name', current_region_name)
                ELSE NULL END,
             'currentPartyGroup', current_party_group,
             'currentPartyGroupShort', current_party_group_short,
             'position', position_title,
             'birthDate', birth_date::text,
             'nsFolders', to_jsonb(ns_folders),
             'isCurrent', is_current
           ) ORDER BY mp_id), '[]'::jsonb)
           FROM mp_profile
         )
       ) AS r
       FROM mp_roster_meta m`,
      [],
    ).catch(missingMigrationEmpty);
    const r = rows[0]?.r;
    return { body: Array.isArray(r) ? null : (r ?? null) };
  },
  // Declared wealth folded to one row per parliamentary group → the AssetsByGroup chart on
  // /mp-assets (the assets twin of AttendanceByGroup). Reads the same matview slice the table
  // beneath it pages through (mp_assets_rankings_table, ns bucket + the optional region/party
  // mp-id set), so the bars and the rows reconcile.
  //
  // IT REFUSES TO ATTRIBUTE RATHER THAN DEGRADE, and that is the whole design. The matview's
  // party column is mp_profile.current_party_group_short — the group the MP sits in TODAY, the
  // only group parliament.bg's roster carries. In the current parliament's bucket that is the
  // right label for every row (measured: 240/240 grouped at ns 52). In ANY OTHER bucket it is
  // either absent (1,882 of the 2,122 'all' rows) or, worse, present and WRONG — 88 of the
  // 51st's 90 rows carry a group, because those MPs were re-elected, so a 51st-parliament
  // chart would file their wealth under the party they joined afterwards. Coverage cannot tell
  // those two apart, so the gate is identity: `applicable` is true only for the roster's own
  // current_ns, and the groups array is EMPTY otherwise — a consumer cannot render a
  // misattributed chart by ignoring a flag.
  //
  // mp_seat (134) does carry a per-ns party and is deliberately NOT joined here: its mp_id is
  // the roll-call CSV's id, which agrees with the roster's only for the current parliament
  // (ns 51: 90 of 309 seats match on name). A per-ns party split is a corpus change, not a
  // route change.
  //
  // Money is summed over the MP's LATEST filing, the same figure the table's row shows;
  // `declared` is the count that actually carries one, so a group's median has a denominator
  // the caption can state.
  "mp-assets-by-party": async (dbRows, q) => {
    const ns = s(q, "ns");
    const empty = { ns, applicable: false, groups: [], ungrouped: null };
    if (!ns) return { body: empty };
    const raw = s(q, "mpIds");
    // null = unscoped (the whole ns); [] = a scope was asked for and is empty → zero groups.
    const mpIds = raw
      ? raw
          .split(",")
          .map((x) => parseInt(x, 10))
          .filter(Number.isFinite)
      : null;
    if (mpIds && mpIds.length === 0) return { body: empty };
    const rows = await dbRows(
      `WITH scope AS (
         SELECT party_group_short AS party, net_worth_eur,
                total_assets_eur, total_debts_eur
         FROM mp_assets_rankings_table
         WHERE ns = $1 AND ($2::int[] IS NULL OR mp_id = ANY($2))
       ),
       app AS (
         -- current_ns is the display label ("52-ро Народно събрание"); the matview's bucket
         -- is the bare folder code, so compare on the leading digits.
         SELECT EXISTS (
           SELECT 1 FROM mp_roster_meta
           WHERE substring(current_ns from '^[0-9]+') = $1
         ) AS ok
       ),
       g AS (
         SELECT party,
                count(*)::int              AS mps,
                count(net_worth_eur)::int  AS declared,
                round(COALESCE(sum(net_worth_eur), 0))    AS total_net,
                round(COALESCE(sum(total_assets_eur), 0)) AS total_assets,
                round(COALESCE(sum(total_debts_eur), 0))  AS total_debts,
                -- Median, not the mean, is what the chart's per-MP mode shows: one MP at
                -- €10.07m is 46% of his group's total here, so a mean describes him rather
                -- than the group. Both ship; the caption names which is which.
                round(percentile_cont(0.5) WITHIN GROUP (ORDER BY net_worth_eur)) AS median_net,
                round(avg(net_worth_eur))  AS mean_net
         FROM scope WHERE party IS NOT NULL GROUP BY party
       ),
       u AS (
         SELECT count(*)::int AS mps, count(net_worth_eur)::int AS declared,
                round(COALESCE(sum(net_worth_eur), 0)) AS total_net
         FROM scope WHERE party IS NULL
       )
       SELECT jsonb_build_object(
         'ns', $1::text,
         'applicable', (SELECT ok FROM app),
         'groups', CASE WHEN (SELECT ok FROM app) THEN (
             SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'party', party,
               'mps', mps,
               'declared', declared,
               'totalNetEur', total_net,
               'totalAssetsEur', total_assets,
               'totalDebtsEur', total_debts,
               'medianNetEur', median_net,
               'meanNetEur', mean_net
             ) ORDER BY total_net DESC, party), '[]'::jsonb) FROM g)
           ELSE '[]'::jsonb END,
         'ungrouped', (SELECT jsonb_build_object(
             'mps', mps, 'declared', declared, 'totalNetEur', total_net) FROM u)
       ) AS r`,
      [ns, mpIds],
    ).catch(missingMigrationEmpty);
    const r = rows[0]?.r;
    return { body: Array.isArray(r) || !r ? empty : r };
  },
  // "Top car makes" — distinct MPs per make within one parliament's car slice (mp_cars_table,
  // ns bucket), optionally restricted to a region/party mp-id set → CarMakesTile /
  // PartyCarMakesTile (persons-pg-retirement-v1 T2.2). Deliberately NOT a plain facet: the
  // tile counts DISTINCT MPs per make, not car rows (three VWs in one garage = one MP). Reads
  // ns + optional `mpIds` (comma-separated); a scoped-but-empty id set returns [] rather than
  // the whole ns. Rebuilds the retired car-makes.json CarMakeEntry shape.
  "car-makes": async (dbRows, q) => {
    const ns = s(q, "ns");
    if (!ns) return { body: [] };
    const raw = s(q, "mpIds");
    // null = unscoped (whole ns); [] = a scope was asked for but is empty → zero makes.
    const mpIds = raw
      ? raw
          .split(",")
          .map((x) => parseInt(x, 10))
          .filter(Number.isFinite)
      : null;
    if (mpIds && mpIds.length === 0) return { body: [] };
    const rows = await dbRows(
      `SELECT COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'make', make,
                    'mpCount', mp_count,
                    'vehicleCount', vehicle_count,
                    'sampleMpIds', sample_ids
                  ) ORDER BY mp_count DESC, vehicle_count DESC, make
                ),
                '[]'::jsonb
              ) AS r
       FROM (
         SELECT make,
                count(DISTINCT mp_id) AS mp_count,
                count(*) AS vehicle_count,
                (array_agg(DISTINCT mp_id ORDER BY mp_id))[1:6] AS sample_ids
         FROM mp_cars_table
         WHERE ns = $1 AND make IS NOT NULL
           AND ($2::int[] IS NULL OR mp_id = ANY($2))
         GROUP BY make
       ) g`,
      [ns, mpIds],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? [] };
  },
  // Resolve a candidate URL to its owning person's slug so /candidate/{id} can render the
  // shared person dashboard. `slug` = a candidate slug (c-{party}-… | mp-{id}); or `name`
  // (+ optional `party`) for the legacy bare-name candidate URLs. Returns null for an
  // unknown / private / >1-namesake match, and the caller falls through to the legacy render.
  "candidate-person": async (dbRows, q) => {
    const slug = s(q, "slug");
    if (slug) {
      const rows = await dbRows("SELECT candidate_person_slug($1) AS r", [
        slug,
      ]).catch(missingMigrationEmpty);
      return { body: { personSlug: rows[0]?.r ?? null } };
    }
    const name = s(q, "name");
    if (!name) return { body: { personSlug: null } };
    const party = q.party != null ? clampInt(q.party, null, 1, 99) : null;
    const rows = await dbRows("SELECT candidate_person_by_name($1, $2) AS r", [
      name,
      party,
    ]).catch(missingMigrationEmpty);
    return { body: { personSlug: rows[0]?.r ?? null } };
  },
  // Resolve an /officials/<slug> to the /person slug that replaced it (T1.3), for the
  // CLIENT-side redirect. The bare /officials/<slug> hosting rewrite issues a real 301 at
  // the HTTP layer (functions/index.js), but an in-app <Link to="/officials/x"> is handled
  // entirely by React Router with no server round-trip, so the SPA needs this JSON lookup
  // to Navigate correctly. Same officials_person_slug() the 301 uses — current refs and
  // re-slug-retired ones both resolve, so the 10.4% of slugs that no longer match their
  // person slug (the trap a naive `/person/${slug}` rewrite would fall into) are handled.
  "officials-person": async (dbRows, q) => {
    const slug = s(q, "slug");
    if (!slug) return { body: { personSlug: null } };
    const rows = await dbRows("SELECT officials_person_slug($1) AS r", [
      slug,
    ]).catch(missingMigrationEmpty);
    return { body: { personSlug: rows[0]?.r ?? null } };
  },
};

module.exports = {
  DB_ROUTES,
  __resetMissLog,
  OBLAST_CODES,
  // Exported for db_routes.shlyo.test.js — the шльокавица readings are the one
  // part of price-search that can be checked without a database.
  shlyoCandidates,
};
