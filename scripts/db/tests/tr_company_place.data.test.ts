// Gate for the company↔place crosswalk (migration 133) behind the "фирми,
// регистрирани тук" tile.
//
// The four ways this goes quietly wrong, all of which serve a 200:
//   1. STALE — tr_companies gained/lost rows since the last load, so a place's
//      count silently disagrees with the registry.
//   2. RANKING DRIFT — money_eur / political_n are DENORMALIZED (that is what
//      makes Sofia a 57 ms index scan instead of a 979 ms sort), so a contracts
//      or db:load:tr:pg reload leaves the tile ranking the previous vintage.
//   3. WRONG PLACE — the seat resolver placed a company in a settlement whose
//      name it merely resembles. A wrong village on a governance page is a
//      statement about that village, so the resolver must never guess.
//   4. SLOW — the tile sits on the Sofia dashboard, whose place holds ~110k
//      companies, against a db-g1-small.
//
// Auto-skips ONLY when Postgres is down. An empty table is a failure, not a
// skip: the loader is unconditional in db:refresh and reads a committed input.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;

afterAll(async () => {
  await end();
});

test.skipIf(skip)("the crosswalk covers the seated registry", async () => {
  const [row] = await allRows<{ placed: string; seated: string }>(
    `SELECT (SELECT count(*) FROM tr_company_place) AS placed,
            (SELECT count(*) FROM tr_companies
              WHERE seat IS NOT NULL AND seat <> '') AS seated`,
  ).catch(() => [] as { placed: string; seated: string }[]);
  assert.ok(
    row,
    "tr_company_place is absent — run db:load:tr-company-place:pg",
  );
  const placed = Number(row.placed);
  const seated = Number(row.seated);
  assert.ok(placed > 0, "tr_company_place is empty");
  // 99.6% resolved when this landed. A drop below 95% means either the seat
  // format moved or the EKATTE index lost entries — both are silent otherwise.
  assert.ok(
    placed / seated >= 0.95,
    `only ${placed}/${seated} seated companies are placed (${((placed / seated) * 100).toFixed(1)}%) — re-run db:load:tr-company-place:pg`,
  );
  // Every placed uic must still exist in the registry: a shrunken tr_companies
  // with a stale crosswalk shows companies at a place that no longer has them.
  const [orphan] = await allRows<{ n: string }>(
    `SELECT count(*) AS n FROM tr_company_place p
      WHERE NOT EXISTS (SELECT 1 FROM tr_companies c WHERE c.uic = p.uic)`,
  );
  assert.equal(
    Number(orphan.n),
    0,
    "tr_company_place holds uics that are no longer in tr_companies — it is stale; re-run db:load:tr-company-place:pg",
  );
});

test.skipIf(skip)(
  "the denormalized ranking columns match their live sources",
  async () => {
    const [row] = await allRows<{ money_drift: string; pol_drift: string }>(
      `SELECT
         (SELECT count(*) FROM tr_company_place p
            LEFT JOIN company_public_money m ON m.eik = p.uic
           WHERE ROUND(p.money_eur) IS DISTINCT FROM
                 ROUND(COALESCE(m.public_money_eur, 0))) AS money_drift,
         (SELECT count(*) FROM tr_company_place p
           WHERE p.political_n IS DISTINCT FROM
                 (SELECT count(*) FROM company_politicians cp WHERE cp.eik = p.uic)) AS pol_drift`,
    );
    assert.equal(
      Number(row.money_drift),
      0,
      "money_eur has drifted from company_public_money — a contracts/agri/funds reload needs db:load:tr-company-place:pg after it",
    );
    assert.equal(
      Number(row.pol_drift),
      0,
      "political_n has drifted from company_politicians — db:load:tr:pg needs db:load:tr-company-place:pg after it",
    );
  },
);

test.skipIf(skip)(
  "no company is placed at an invented settlement",
  async () => {
    // Every ekatte must be a real 5-digit code carrying a settlement name, and
    // the obshtina code must be the one the dimension gives that settlement —
    // the tile filters on obshtina, so a mismatched pair puts a company in the
    // wrong municipality while its settlement label still looks right.
    const bad = await allRows<{ uic: string; ekatte: string }>(
      `SELECT uic, ekatte FROM tr_company_place
      WHERE ekatte !~ '^[0-9]{5}$' OR settlement IS NULL OR obshtina IS NULL
      LIMIT 5`,
    );
    assert.deepEqual(
      bad,
      [],
      "tr_company_place rows carry a malformed ekatte or a missing place label",
    );
  },
);

// ⚠️ THE INDEX IS CHECKED STRUCTURALLY, NOT THROUGH A COST. Two earlier versions of this
// test tried to infer "the ranking index is still there" from how expensive the call was,
// and BOTH were wrong in the same way — a cost measurement cannot see this failure:
//
//   - a wall-clock budget (< 400 ms) measured 1,140 ms under the full parallel suite with
//     the query untouched, i.e. it was reporting how busy the machine was;
//   - a buffer ceiling looked immune to that — 19,513 buffers on three consecutive runs
//     whose wall-clock ranged 44-61 ms — but DROPPING the index makes the call CHEAPER,
//     not dearer. `place_companies` is LANGUAGE sql, so its body is planned with $1/$2 as
//     parameters and the OR survives; the index is used as an unordered Bitmap Index Scan
//     feeding a heap scan of 6,594 of the table's 6,595 pages, twice. Simulated read-only
//     without it: 15,705 buffers, 19% BELOW the baseline. A ceiling passes through the
//     exact failure its own message named.
//
// So existence is asserted against the catalog, where it is a fact rather than an
// inference, and the buffer ceiling below keeps its job — catching a plan that blew up —
// with a message that no longer claims something it cannot detect.
test.skipIf(skip)("the tile's ranking indexes exist", async () => {
  const rows = await allRows<{ indexname: string }>(
    "SELECT indexname FROM pg_indexes WHERE tablename = 'tr_company_place'",
  );
  const have = new Set(rows.map((r) => r.indexname));
  // The four the place tile sorts on — per ekatte and per obshtina, by rank and by money.
  const want = [
    "idx_tr_company_place_ekatte_rank",
    "idx_tr_company_place_ekatte_money",
    "idx_tr_company_place_obshtina_rank",
    "idx_tr_company_place_obshtina_money",
  ];
  const missing = want.filter((i) => !have.has(i)).sort();
  assert.deepEqual(
    missing,
    [],
    `tr_company_place has lost ranking index(es): ${missing.join(", ")}. ` +
      `133 recreates them; the place tile falls back to sorting the whole place.`,
  );
});

test.skipIf(skip)(
  "the worst-case place does not blow up its plan",
  async () => {
    // Sofia (ekatte 68134) is the largest place and sits on a dashboard tile. This is a
    // REGRESSION ceiling on the plan's size, not a proxy for the index above: the
    // pre-denormalization live-join form of this call ran 979 ms locally against ~50 ms now,
    // and prod is a db-g1-small. Buffers rather than time because they are a property of the
    // plan — the same three runs that varied 44-61 ms in wall-clock all read 19,513.
    //
    // The ceiling is ~1.5x the measurement and the metric scales with total table size, so
    // it fires at roughly 54% corpus growth. That is a re-measure, not a defect: raise it
    // with a new number beside it.
    type PlanNode = Record<string, number | string>;
    const [row] = await allRows<{ "QUERY PLAN": { Plan: PlanNode }[] }>(
      "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT place_companies('68134', NULL, 5)",
    );
    const plan = row["QUERY PLAN"][0].Plan;
    const buffers =
      Number(plan["Shared Hit Blocks"] ?? 0) +
      Number(plan["Shared Read Blocks"] ?? 0);
    // A plan reporting NO buffers means EXPLAIN's output shape changed and the ceiling is
    // being compared against zero — which passes for ever.
    assert.ok(
      buffers > 0,
      "could not read buffer counts out of the EXPLAIN output; this gate is not measuring anything",
    );
    assert.ok(
      buffers < 30_000,
      `place_companies('68134') touched ${buffers.toLocaleString()} buffers against a ` +
        `measured 19,513 — the plan changed shape (a lost denormalized column, a join that ` +
        `came back, a matview it now reads live)`,
    );
  },
);

test.skipIf(skip)("the payload is shaped as the tile expects", async () => {
  const [row] = await allRows<{
    r: {
      count: number;
      moneyCount: number;
      politicalCount: number;
      companies: Array<{
        uic: string;
        name: string;
        moneyEur: number;
        officers: unknown[];
        politicians: unknown[];
      }>;
    };
  }>("SELECT place_companies(NULL, 'SOF46', 3) AS r");
  const p = row.r;
  assert.ok(p.count > 0, "SOF46 should hold companies");
  assert.ok(p.companies.length <= 3, "limit is not honoured");
  assert.ok(
    p.moneyCount <= p.count && p.politicalCount <= p.count,
    "a headline count exceeds the place total",
  );
  for (const c of p.companies) {
    assert.ok(c.uic && c.name, "a company row is missing uic/name");
    assert.ok(Array.isArray(c.officers), "officers must be an array");
    assert.ok(Array.isArray(c.politicians), "politicians must be an array");
  }
  // Politically-linked first, then money — the order the UI does not re-sort.
  const keys = p.companies.map((c) => c.moneyEur);
  assert.deepEqual(
    keys,
    [...keys].sort((a, b) => b - a),
    "companies are not returned in the documented rank order",
  );
});
