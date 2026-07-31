// Phase-3 gate: the grids in Postgres must reproduce what build_index.ts
// produces from the legacy _cache grids.
//
// The chain this closes:
//   price_grid_days  reproduces DailyGrid   (prices_grid_parity.data.test.ts)
//   build_index.ts   is the ONE implementation (same code, pluggable source+sink)
//   price_payloads   therefore reproduces the shipped artifacts
//
// Comparing against a live cache build rather than the JSON on disk is
// deliberate: the on-disk tree was generated before two determinism fixes (see
// below) and is frozen at whatever order its ZIPs happened to have.
//
// WHY THIS COMPARES TWO BUILDS AND NOT THE LIVE `price_payloads` TABLE
//
// It used to read the table directly, and that could only work while the two
// sides covered the same days. They no longer can. `parse.ts` — the only writer
// of data/prices/_cache/daily/ — was retired by the Postgres migration, so the
// tree is FROZEN (189 days, ending 2026-07-09) while the corpus grows daily
// (210 days as of 2026-07-30). A build over more days legitimately yields more
// settlement/município shards and different index series, so `count(*)` on the
// table diverges from the cache build a little further every morning.
//
// Two smaller things made the direct read wrong quite apart from the day span:
// `price_payloads` carries seven kinds build_index never emits (deals,
// deals-muni, verdict, hub-stats, chain-products, chain-map, unit-prices —
// build_payloads.ts computes those straight from SQL), and each of those has no
// cache twin to compare against at all.
//
// So both sides are now built HERE, over the exact day span the cache holds,
// through the same buildPriceIndex() the daily job calls — which is the property
// that was ever really under test: the grids Postgres hands build_index are the
// grids the _cache tree used to. Whether the live table was actually rebuilt
// from today's grids is a different question, gated separately below by
// `price_payloads is built from the latest loaded day`.
//
// TWO DOCUMENTED, INTENTIONAL DIFFERENCES
//
// 1. cheapestEik / cheapestChain / cheapestStore. Many settlements have several
//    stores tied at the minimum price. parse.ts broke the tie by ZIP row order;
//    price_grid_days breaks it by (price, eik COLLATE "C"), which is stable and
//    required by reference_pg_payload_determinism. Both answers are correct — so
//    this test ignores the field, and prices_grid_parity asserts the stronger
//    property: our chosen chain actually attains the settlement minimum, in all
//    17,344 cells.
//
// 2. avg. Postgres sums `double precision` in a different order than JS, so the
//    mean can land on the other side of a 2-decimal rounding boundary. Bounded
//    at one cent, and `avg` feeds display only — the index uses min and median.
//
// Requires DB_VERIFY=1 and a fully backfilled local Postgres. Only the first
// test needs the _cache tree, and it skips without it — so when
// data/prices/_cache/ is finally deleted (docs/plans/consumption-pg-v1.md §11,
// which also retires prices_grid_parity.data.test.ts's single-day fixture),
// delete that test and keep the rest of this file: the determinism and
// staleness gates below are about `price_payloads` itself and outlive the
// migration they were written alongside.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import { allRows, end } from "../lib/pg";
import { buildPriceIndex, type Emit } from "../../prices/build_index";
import { loadGridsFromPg } from "../../prices/lib/grids_pg";

// Close the singleton pool so the db:verify runner doesn't hang (FINDING-008).
afterAll(async () => {
  await end();
});

const RUN = process.env.DB_VERIFY === "1";
const CACHE = "data/prices/_cache/daily";
const HAVE_CACHE = fs.existsSync(CACHE);

const TIE_BROKEN = new Set(["cheapestEik", "cheapestChain", "cheapestStore"]);
const AVG_TOLERANCE = 0.011; // one 2-decimal rounding step

/** Sort object keys recursively: jsonb does not preserve them. Array order is
 *  preserved — array order IS meaningful and must match. */
const sortKeys = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, sortKeys(o[k])]),
    );
  }
  return v;
};

/** Drop the fields whose difference is documented above. */
const stripKnown = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(stripKnown);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .filter((k) => !TIE_BROKEN.has(k) && k !== "avg")
        .map((k) => [k, stripKnown(o[k])]),
    );
  }
  return v;
};

const avgWithinTolerance = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b))
    return a.every((x, i) => avgWithinTolerance(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const x = a as Record<string, unknown>;
    const y = b as Record<string, unknown>;
    return Object.keys(x).every((k) =>
      k === "avg"
        ? Math.abs(Number(x[k]) - Number(y[k])) <= AVG_TOLERANCE
        : avgWithinTolerance(x[k], y[k]),
    );
  }
  return true;
};

/** The days the frozen cache tree holds — the window both sides can cover. */
const cacheDays = (): string[] =>
  fs
    .readdirSync(CACHE)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort();

test.skipIf(!RUN || !HAVE_CACHE)(
  "price_grid_days rebuilds the cache-built artifacts over the shared day span",
  { timeout: 600_000 },
  async () => {
    const days = cacheDays();
    assert.ok(days.length > 0, "cache tree has no daily grids — vacuous");

    const cache = new Map<string, unknown>();
    buildPriceIndex({
      emit: (kind, key, obj) => cache.set(`${kind}|${key}`, obj),
    }); // source: the legacy _cache grids

    const grids = await loadGridsFromPg({ days });
    // A day on disk that Postgres does not hold is a real gap in the corpus,
    // not a windowing artefact — fail loudly rather than silently compare a
    // shorter series against a longer one, which is the failure mode that made
    // the old table-vs-cache count assert unreadable.
    assert.deepEqual(
      grids.map((g) => g.date),
      days,
      "price_grid_days is missing a day the _cache tree holds",
    );

    const pg = new Map<string, unknown>();
    const emit: Emit = (kind, key, obj) => pg.set(`${kind}|${key}`, obj);
    buildPriceIndex({ grids, emit }); // source: price_grid_days, same window

    assert.deepEqual(
      [...pg.keys()].sort(),
      [...cache.keys()].sort(),
      "artifact key set",
    );

    const unexplained: string[] = [];
    for (const [k, built] of pg) {
      const c = cache.get(k);
      if (JSON.stringify(sortKeys(c)) === JSON.stringify(sortKeys(built)))
        continue;
      const structurallyEqual =
        JSON.stringify(stripKnown(c)) === JSON.stringify(stripKnown(built));
      if (!structurallyEqual || !avgWithinTolerance(c, built))
        unexplained.push(k.replace("|", "/"));
    }
    assert.deepEqual(unexplained.slice(0, 10), [], "unexplained payload diffs");
  },
);

// What the old `count(*) === cache.size` assert was reaching for, stated
// directly: the served table must have been rebuilt from the grids currently
// loaded. Staleness is the real risk here and it is otherwise silent — every
// route keeps serving a previous vintage at a 200. Independent of the _cache
// tree, so this one survives its deletion.
test.skipIf(!RUN)(
  "price_payloads is built from the latest loaded day",
  async () => {
    const [{ latest }] = await allRows<{ latest: string | null }>(
      "SELECT max(day)::text AS latest FROM price_grid_days",
    );
    assert.ok(latest, "price_grid_days is empty — run the ingest first");
    const rows = await allRows<{
      kind: string;
      key: string;
      latest: string | null;
    }>(
      `SELECT kind, key, payload->>'latestDate' AS latest
         FROM price_payloads WHERE payload ? 'latestDate'`,
    );
    assert.ok(rows.length > 0, "no payload carries latestDate — vacuous");
    const stale = rows
      .filter((r) => r.latest !== latest)
      .map((r) => `${r.kind}/${r.key}=${r.latest}`);
    assert.deepEqual(
      stale.slice(0, 10),
      [],
      `payloads stale — price_grid_days is at ${latest}; run \`npm run prices\``,
    );
  },
);

test.skipIf(!RUN)(
  "ranking.places is ordered by code (determinism)",
  async () => {
    const [r] = await allRows<{ payload: { places: { code: string }[] } }>(
      "SELECT payload FROM price_payloads WHERE kind = 'ranking'",
    );
    const codes = r.payload.places.map((p) => p.code);
    assert.ok(codes.length > 0, "ranking has no places — vacuous"); // FINDING-015
    assert.deepEqual(codes, [...codes].sort(), "places must be code-sorted");
  },
);

// Both deal boards must be re-sortable from the fields they ship. This is
// NOT the same as "the SQL is deterministic" — it caught an ORDER BY on the raw
// `disc` under a payload that ships only `round(disc*100)`: every violation sat
// inside a tied discPct bucket (deals-muni/BGS04 had five), so the array encoded
// a distinction no reader of the payload could see, and the per-município top-24
// cut split those ties on a key it never published.
const assertDealOrder = (
  label: string,
  deals: { discPct: number; slug: string }[],
) => {
  const sorted = [...deals].sort(
    (a, b) => b.discPct - a.discPct || (a.slug < b.slug ? -1 : 1),
  );
  assert.deepEqual(
    deals.map((d) => d.slug),
    sorted.map((d) => d.slug),
    `${label} not deterministically ordered`,
  );
};

test.skipIf(!RUN)(
  "deals-muni payloads are discount-ordered and carry latestDate (determinism)",
  async () => {
    const rows = await allRows<{
      key: string;
      payload: {
        latestDate: string;
        deals: { discPct: number; slug: string }[];
      };
    }>("SELECT key, payload FROM price_payloads WHERE kind = 'deals-muni'");
    // Vacuous-safe: a DB with no promos in the latest day yields no rows.
    for (const r of rows) {
      assert.ok(r.key.length > 0, "deals-muni key must be an obshtina code");
      assert.ok(
        typeof r.payload.latestDate === "string",
        `deals-muni/${r.key} missing latestDate`,
      );
      assert.ok(r.payload.deals.length <= 24, `deals-muni/${r.key} over cap`);
      assertDealOrder(`deals-muni/${r.key}`, r.payload.deals);
    }
  },
);

test.skipIf(!RUN)(
  "the national deals board is discount-ordered (determinism)",
  async () => {
    const [r] = await allRows<{
      payload: { deals: { discPct: number; slug: string }[] };
    }>("SELECT payload FROM price_payloads WHERE kind = 'deals'");
    assert.ok(r, "no national deals payload — run `npm run prices` first");
    assert.ok(r.payload.deals.length > 0, "deals board is empty — vacuous");
    assert.ok(r.payload.deals.length <= 48, "deals board over cap");
    assertDealOrder("deals", r.payload.deals);
  },
);

test.skipIf(!RUN)("every covered settlement has a place payload", async () => {
  const [{ n }] = await allRows<{ n: string }>(
    "SELECT count(*) AS n FROM price_payloads WHERE kind = 'place'",
  );
  const [{ s }] = await allRows<{ s: string }>(
    `SELECT count(DISTINCT ekatte) AS s FROM price_grid_days
      WHERE day = (SELECT max(day) FROM price_grid_days)`,
  );
  assert.ok(Number(s) > 0, "no settlements loaded — vacuous"); // FINDING-015
  assert.equal(Number(n), Number(s));
});
