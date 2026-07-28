// The per-scope by-settlement precomputes (migration 119).
//
// WHAT THESE PIN. procurement_settlement_rank and procurement_geo_payloads replace a
// 196 KB blob the browser re-aggregated itself, and they are DERIVED data: every failure
// mode is a number that is merely wrong, never an error. A scope missing its rows reads as
// "this parliament awarded nothing"; a stale refresh reads as last month's corpus; a broken
// place_dim join silently drops the English names the page now depends on.
//
// The reconciliation tests are the important ones — they assert the precompute still agrees
// with procurement_by_settlement(), which is the function 030 defines and the retired
// offline generator was verified byte-identical against. That chain is what lets the static
// JSON be deleted.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM procurement_settlement_rank",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};
const ok = await reachable();

afterAll(async () => {
  await end();
});

test.skipIf(!ok)("every scope has a geo payload", async () => {
  // The maps + the KPI header read this by scope_key. A scope in procurement_scopes with
  // no payload row renders an empty map rather than an error.
  const rows = await allRows<{ scope_key: string }>(`
    SELECT s.scope_key FROM procurement_scopes s
     WHERE NOT EXISTS (SELECT 1 FROM procurement_geo_payloads g
                        WHERE g.scope_key = s.scope_key)
     ORDER BY 1`);
  assert.deepEqual(
    rows.map((r) => r.scope_key),
    [],
  );
});

test.skipIf(!ok)(
  "every scope with settlements has ranking rows, and vice versa",
  async () => {
    // A scope legitimately has NO rows when its window predates the corpus (the 2005
    // election is nine years before the first contract), so this is checked against the
    // payload's own settlementCount rather than against the scope list.
    const rows = await allRows<{ scope_key: string; declared: string }>(`
      SELECT g.scope_key, (g.payload->'summary'->>'settlementCount') AS declared
        FROM procurement_geo_payloads g
       WHERE (g.payload->'summary'->>'settlementCount')::int > 0
         AND NOT EXISTS (SELECT 1 FROM procurement_settlement_rank r
                          WHERE r.scope_key = g.scope_key)
       ORDER BY 1`);
    assert.deepEqual(
      rows.map((r) => `${r.scope_key} (declares ${r.declared})`),
      [],
    );
  },
);

test.skipIf(!ok)(
  "the ranking row count matches the payload's settlementCount, per scope",
  async () => {
    // The STRUCTURAL reconciliation: both derive from the same
    // procurement_by_settlement() call, so a divergence means one of them is stale.
    const rows = await allRows<{
      scope_key: string;
      n: string;
      declared: string;
    }>(`
      SELECT g.scope_key,
             (SELECT count(*) FROM procurement_settlement_rank r
               WHERE r.scope_key = g.scope_key)::text AS n,
             (g.payload->'summary'->>'settlementCount') AS declared
        FROM procurement_geo_payloads g`);
    const bad = rows.filter((r) => r.n !== r.declared);
    assert.deepEqual(
      bad.map((r) => `${r.scope_key}: ${r.n} rows vs ${r.declared} declared`),
      [],
    );
  },
);

test.skipIf(!ok)(
  "the ranking sums back to the payload total, within rounding",
  async () => {
    // NOT an exact equality, deliberately. Each settlement's totalEur is ROUNDed
    // individually by procurement_by_settlement, while the header rounds the raw sum — so
    // Σ(rounded) differs from rounded(Σ) by at most half a euro per settlement. The
    // tolerance is the settlement count; anything beyond that is a real divergence, not
    // rounding.
    const rows = await allRows<{
      scope_key: string;
      delta: string;
      n: string;
    }>(`
      SELECT g.scope_key,
             ABS(COALESCE((SELECT ROUND(SUM(r.total_eur)) FROM procurement_settlement_rank r
                            WHERE r.scope_key = g.scope_key), 0)
                 - (g.payload->'summary'->>'totalEur')::numeric)::text AS delta,
             (g.payload->'summary'->>'settlementCount') AS n
        FROM procurement_geo_payloads g`);
    // Guard against a VACUOUS pass: Number(null) is 0, so a missing summary.totalEur or
    // settlementCount would satisfy the tolerance below rather than fail.
    const missing = rows.filter((r) => r.delta === null || r.n === null);
    assert.deepEqual(
      missing.map((r) => r.scope_key),
      [],
      "scope(s) whose payload summary lost totalEur/settlementCount",
    );
    const bad = rows.filter((r) => Number(r.delta) > Math.max(1, Number(r.n)));
    assert.deepEqual(
      bad.map(
        (r) => `${r.scope_key}: off by €${r.delta} over ${r.n} settlements`,
      ),
      [],
    );
  },
);

test.skipIf(!ok)(
  "the oblast rollup sums back to the header, within rounding",
  async () => {
    // The three choropleths colour from `oblasti`; if it did not add up to the headline
    // KPI on the same page, the map and the tile above it would contradict each other.
    const rows = await allRows<{
      scope_key: string;
      delta: string;
      n: string;
    }>(`
      SELECT scope_key,
             ABS(COALESCE((SELECT SUM((o->>'totalEur')::numeric)
                             FROM jsonb_array_elements(payload->'oblasti') o), 0)
                 - (payload->'summary'->>'totalEur')::numeric)::text AS delta,
             (payload->'summary'->>'settlementCount') AS n
        FROM procurement_geo_payloads`);
    const missing = rows.filter((r) => r.delta === null || r.n === null);
    assert.deepEqual(
      missing.map((r) => r.scope_key),
      [],
      "scope(s) whose payload summary lost totalEur/settlementCount",
    );
    const bad = rows.filter((r) => Number(r.delta) > Math.max(1, Number(r.n)));
    assert.deepEqual(
      bad.map((r) => `${r.scope_key}: off by €${r.delta}`),
      [],
    );
  },
);

test.skipIf(!ok)(
  "matches the live function for the full corpus, row for row",
  async () => {
    // The end-to-end check against the ACTUAL source of truth: unnest
    // procurement_by_settlement(NULL, NULL) and diff it against the 'all' scope rows.
    // Everything else here is internal consistency; this is correctness.
    const [r] = await allRows<{ n: string }>(`
      WITH live AS (
        SELECT e->>'ekatte' AS ekatte, e->>'name' AS name,
               (e->>'totalEur')::numeric AS total_eur,
               (e->>'contractCount')::int AS contract_count
          FROM jsonb_array_elements(
                 procurement_by_settlement(NULL, NULL) -> 'settlements') e
      ),
      -- Narrowed to the scope in its OWN cte, not in the FULL OUTER JOIN's ON clause: a
      -- predicate there does not filter the right-hand side, it only fails to match, so
      -- every other scope's rows would surface as spurious "missing from live".
      cached AS (
        SELECT ekatte, name, total_eur, contract_count
          FROM procurement_settlement_rank WHERE scope_key = 'all'
      )
      SELECT count(*) n
        FROM live FULL OUTER JOIN cached USING (ekatte)
       WHERE live.ekatte IS NULL OR cached.ekatte IS NULL
          OR cached.name           IS DISTINCT FROM live.name
          OR cached.contract_count IS DISTINCT FROM live.contract_count
          -- total_eur is compared with a 1 EUR tolerance, NOT exactly. contracts.amount_eur
          -- is double precision, so the raw SUM depends on aggregation order; where a
          -- settlement's total straddles a .5 boundary its ROUNDed value flips by one euro
          -- between the matview's snapshot and a fresh evaluation. Observed on Панагюрище
          -- (73,405,633 vs 73,405,634) under parallel test load. Anything larger is a real
          -- divergence — the settlement SET and the contract COUNTS above are integer-exact
          -- and carry no tolerance at all.
          OR ABS(COALESCE(cached.total_eur, 0) - COALESCE(live.total_eur, 0)) > 1`);
    assert.equal(r.n, "0");
  },
);

test.skipIf(!ok)("carries an English name for every settlement", async () => {
  // The whole reason the browser stopped downloading the 940 KB EKATTE master. NULL is
  // impossible (the column COALESCEs), so the real failure is name_en falling back to the
  // Bulgarian for rows place_dim does not cover.
  const rows = await allRows<{ ekatte: string; name: string }>(`
    SELECT DISTINCT r.ekatte, r.name
      FROM procurement_settlement_rank r
      LEFT JOIN place_dim pd ON pd.kind = 'settlement' AND pd.code = r.ekatte
     WHERE pd.code IS NULL
     ORDER BY 1 LIMIT 20`);
  assert.deepEqual(
    rows.map((r) => `${r.ekatte}:${r.name}`),
    [],
    "settlement(s) missing from place_dim — their English name falls back to Bulgarian",
  );

  // …and the STORED column actually carries the dimension's English name, not a copy of
  // the Bulgarian one. The join above passing does not prove the value landed.
  const [sofia] = await allRows<{ name: string; name_en: string }>(`
    SELECT name, name_en FROM procurement_settlement_rank
     WHERE scope_key = 'all' AND ekatte = '68134'`);
  assert.equal(sofia?.name, "София");
  assert.equal(sofia?.name_en, "Sofia");
});

test.skipIf(!ok)(
  "the search fold matches Latin input against Cyrillic names",
  async () => {
    // Shliokavica: the server-side replacement for the in-memory latinSkeleton filter the
    // page used to run. Folded at write time here and at query time in the table engine,
    // both through translit_bg_latin — which is also what makes the gin_trgm index usable.
    const rows = await allRows<{ name: string }>(`
      SELECT name FROM procurement_settlement_rank
       WHERE scope_key = 'all'
         AND name_fold LIKE '%' || translit_bg_latin('veliko tarnovo') || '%'
       ORDER BY total_eur DESC LIMIT 1`);
    assert.equal(rows[0]?.name, "Велико Търново");

    // The fold also covers the obshtina and oblast, matching what the client searched.
    const [p] = await allRows<{ n: string }>(`
      SELECT count(*) n FROM procurement_settlement_rank
       WHERE scope_key = 'all'
         AND name_fold LIKE '%' || translit_bg_latin('Пловдив') || '%'`);
    assert.ok(Number(p.n) > 1, "oblast/obshtina terms are not in the fold");
  },
);

test.skipIf(!ok)("orders deterministically, with a tiebreak", async () => {
  // Equal-valued rows must not swap between pages mid-scroll. total_eur alone is not a
  // total order — several settlements share a value.
  // Two consecutive pages must not overlap or skip a row. Taken as OFFSET 0/50/100 slices
  // under the exact ORDER BY the browser sends, which is where a non-total order shows up.
  const paged = await allRows<{ ekatte: string }>(`
    SELECT ekatte FROM procurement_settlement_rank
     WHERE scope_key = 'all' ORDER BY total_eur DESC, ekatte LIMIT 150`);
  const slices = await Promise.all(
    [0, 50, 100].map((off) =>
      allRows<{ ekatte: string }>(
        `SELECT ekatte FROM procurement_settlement_rank
          WHERE scope_key = 'all' ORDER BY total_eur DESC, ekatte LIMIT 50 OFFSET ${off}`,
      ),
    ),
  );
  assert.deepEqual(
    slices.flat().map((r) => r.ekatte),
    paged.map((r) => r.ekatte),
    "paginating the ranking drops or repeats rows — the sort is not a total order",
  );
  // The index that serves the default sort carries the tiebreak.
  const [i] = await allRows<{ def: string }>(`
    SELECT indexdef AS def FROM pg_indexes WHERE indexname = 'idx_psr_scope_total'`);
  assert.match(i.def, /total_eur DESC, ekatte/);
});
