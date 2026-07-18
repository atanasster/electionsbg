// Phase-3 gate: the payloads served from Postgres must reproduce what
// build_index.ts produces from the legacy _cache grids.
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
// Requires DB_VERIFY=1, a fully backfilled local Postgres, and the _cache tree.
// Delete this test when data/prices/_cache/ is deleted.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import { allRows, end } from "../lib/pg";
import { buildPriceIndex, type Emit } from "../../prices/build_index";

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

test.skipIf(!RUN || !HAVE_CACHE)(
  "price_payloads reproduces the cache-built artifacts",
  async () => {
    const cache = new Map<string, unknown>();
    const emit: Emit = (kind, key, obj) => cache.set(`${kind}|${key}`, obj);
    buildPriceIndex({ emit }); // source: the legacy _cache grids

    const rows = await allRows<{ kind: string; key: string; payload: unknown }>(
      "SELECT kind, key, payload FROM price_payloads",
    );
    assert.ok(rows.length > 0, "no payloads — run `npm run prices` first");
    assert.equal(rows.length, cache.size, "payload count");

    const unexplained: string[] = [];
    for (const r of rows) {
      const c = cache.get(`${r.kind}|${r.key}`);
      assert.ok(
        c !== undefined,
        `payload ${r.kind}/${r.key} has no cache twin`,
      );
      if (JSON.stringify(sortKeys(c)) === JSON.stringify(sortKeys(r.payload)))
        continue;
      const structurallyEqual =
        JSON.stringify(stripKnown(c)) === JSON.stringify(stripKnown(r.payload));
      if (!structurallyEqual || !avgWithinTolerance(c, r.payload))
        unexplained.push(`${r.kind}/${r.key}`);
    }
    assert.deepEqual(unexplained.slice(0, 10), [], "unexplained payload diffs");
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
      // Sorted by discPct desc, slug asc as a tiebreak — the build's ORDER BY.
      const sorted = [...r.payload.deals].sort(
        (a, b) => b.discPct - a.discPct || (a.slug < b.slug ? -1 : 1),
      );
      assert.deepEqual(
        r.payload.deals.map((d) => d.slug),
        sorted.map((d) => d.slug),
        `deals-muni/${r.key} not deterministically ordered`,
      );
    }
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
