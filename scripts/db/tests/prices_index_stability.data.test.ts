// Regression gate for the PUBLISHED price index (plan T0.6,
// docs/plans/prices-hub-v1.md).
//
// The defect class this exists for is invisible to every row count: the corpus
// is complete and internally consistent, and only its COMPOSITION moves. On
// 2026-08-09 the КЗП reporter set fell 203 → 140 chains (203 → 98 over six
// days) and the national index dropped 4.19 points in 24 hours with nothing
// about prices having changed. `/prices` headlined it, and production and
// localhost — one day apart on the same corpus — disagreed by 2.3 points.
//
// It gates `price_payloads`, i.e. what readers actually get, not a rebuild in
// memory. A stale table therefore fails here, which is the intended signal:
// build_index.ts changes reach readers only when `npm run prices:payloads` is
// re-run against the target database.
//
// Requires DB_VERIFY=1 and a loaded local Postgres.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

afterAll(async () => {
  await end();
});

const RUN = process.env.DB_VERIFY === "1";

/** A single-day move larger than this must be explained by a coverage move. */
const MAX_UNEXPLAINED_MOVE = 1.5; // index points
/** …and "explained" means the day's chain count moved at least this much. */
const COVERAGE_MOVE_PCT = 0.05;
/** Mirrors MIN_INDEX_PRODUCTS in scripts/prices/build_index.ts. */
const MIN_INDEX_PRODUCTS = 10;

/**
 * Moves that exceed the threshold on a STABLE reporter set and have been
 * examined and found real. A big move is not by itself a defect — the point of
 * the gate is that nobody ships one without looking, so clearing one means
 * writing down how it was cleared.
 *
 * The list is checked in BOTH directions: an entry that no longer corresponds
 * to an over-threshold move fails too, so it cannot quietly rot into a
 * permanent exemption for a range that has since changed meaning.
 */
const EXAMINED_MOVES: Record<string, string> = {
  "2026-04-08→2026-04-09":
    "+2.3 points on 208→207 chains. Measured by holding the settlement " +
    "cross-section to places contributing on both days: the move is +2.33, " +
    "i.e. composition accounts for 0.04 of it. A real market event.",
};

interface Point {
  d: string;
  v: number;
  n?: number;
}
interface IndexPayload {
  national: { index: Point[] };
  coverage: { settlements: number; chains: number };
}
interface RankPlace {
  code: string;
  name: string;
  indexN?: number;
  indexSinceEuro: number;
  rankChange: { national?: number | null };
}

const readIndex = async (): Promise<IndexPayload | null> => {
  const rows = await allRows<{ payload: IndexPayload }>(
    "SELECT payload FROM price_payloads WHERE kind = 'index' AND key = ''",
  );
  return rows[0]?.payload ?? null;
};

test.skipIf(!RUN)(
  "no single-day index move is unexplained by a coverage move",
  async () => {
    const idx = await readIndex();
    if (!idx) return; // corpus not built on this machine
    const series = idx.national.index;
    assert.ok(series.length > 2, "index series is too short to gate");

    const chainRows = await allRows<{ day: string; chains: string }>(
      `SELECT day::text AS day, count(*)::text AS chains
         FROM price_chain_days GROUP BY day ORDER BY day`,
    );
    const chainsOn = new Map(
      chainRows.map((r) => [r.day, Number(r.chains)] as const),
    );

    const offenders: string[] = [];
    const seen = new Set<string>();
    for (let i = 1; i < series.length; i++) {
      const move = Math.abs(series[i].v - series[i - 1].v);
      if (move <= MAX_UNEXPLAINED_MOVE) continue;
      const a = chainsOn.get(series[i - 1].d);
      const b = chainsOn.get(series[i].d);
      // No chain-count data for the pair → cannot clear it, so report it.
      const covMove =
        a && b && a > 0 ? Math.abs(b - a) / a : Number.POSITIVE_INFINITY;
      if (covMove >= COVERAGE_MOVE_PCT) continue;
      const key = `${series[i - 1].d}→${series[i].d}`;
      seen.add(key);
      if (EXAMINED_MOVES[key]) continue;
      offenders.push(
        `${key}: ${move.toFixed(2)} points ` +
          `on ${a}→${b} chains (${(covMove * 100).toFixed(1)}% coverage move)`,
      );
    }
    assert.equal(
      offenders.length,
      0,
      `national index moved more than ${MAX_UNEXPLAINED_MOVE} points in a day ` +
        `with a stable reporter set — that is a real price event or a basis ` +
        `regression, and either way it must not ship unexamined. Investigate, ` +
        `then add it to EXAMINED_MOVES with the measurement that cleared it:\n  ` +
        offenders.join("\n  "),
    );

    const stale = Object.keys(EXAMINED_MOVES).filter((k) => !seen.has(k));
    assert.equal(
      stale.length,
      0,
      `EXAMINED_MOVES entries no longer correspond to an over-threshold move ` +
        `on a stable reporter set — the series changed underneath them, so the ` +
        `exemption is unexamined again. Re-verify and remove: ${stale.join(", ")}`,
    );
  },
);

test.skipIf(!RUN)(
  "no published index point is a fabricated 100 with nothing matched",
  async () => {
    const idx = await readIndex();
    if (!idx) return;
    const series = idx.national.index;
    // `n` is absent on payloads built before the chain-matching change — that
    // is a stale table, not a pass.
    assert.ok(
      series.every((p) => typeof p.n === "number"),
      "index points carry no `n` — price_payloads predates the chain-matched " +
        "basis. Re-run `npm run prices:payloads`.",
    );
    const fabricated = series.filter((p) => p.n === 0);
    assert.equal(
      fabricated.length,
      0,
      `${fabricated.length} index points rest on zero matched products and are ` +
        `published as a value anyway. On a 100-based index that reads as ` +
        `"exactly where it was on euro day", which is the most plausible-looking ` +
        `number this series can fabricate: ${fabricated
          .slice(0, 5)
          .map((p) => p.d)
          .join(", ")}`,
    );
  },
);

test.skipIf(!RUN)(
  "no place is ranked on the since-euro board on too few matched products",
  async () => {
    const rows = await allRows<{ payload: { places: RankPlace[] } }>(
      "SELECT payload FROM price_payloads WHERE kind = 'ranking' AND key = ''",
    );
    const places = rows[0]?.payload?.places;
    if (!places?.length) return;

    assert.ok(
      places.some((p) => typeof p.indexN === "number"),
      "ranking places carry no `indexN` — price_payloads predates the " +
        "chain-matched basis. Re-run `npm run prices:payloads`.",
    );
    // The matched basis is far narrower than the pooled one it replaced and
    // varies enormously by place: some settlements rest on ONE chain over FOUR
    // of 101 products. Those keep their own page and their own number; what
    // they must not do is sit on a board beside places measured 25× more
    // thoroughly, which is what the reader compares.
    const thin = places.filter(
      (p) =>
        p.rankChange?.national != null && (p.indexN ?? 0) < MIN_INDEX_PRODUCTS,
    );
    assert.equal(
      thin.length,
      0,
      `${thin.length} places are ranked on the since-euro board with fewer ` +
        `than ${MIN_INDEX_PRODUCTS} matched products: ${thin
          .slice(0, 8)
          .map((p) => `${p.name} (n=${p.indexN ?? 0})`)
          .join(", ")}`,
    );
  },
);
