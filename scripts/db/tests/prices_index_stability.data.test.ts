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
import {
  trailingChainMedian,
  clearsCoverageFloor,
} from "../../prices/lib/coverage";

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
  // The coverage fields are OPTIONAL here on purpose: a payload built before
  // the coverage work has none of them, and telling that state apart from a
  // real drift is half of what these tests do. Declaring them required would
  // make the guards below statically dead while they are still doing work.
  coverage: {
    settlements: number;
    chains: number;
    chainsTrailingMedian?: number | null;
    chainsComplete?: boolean;
    headlineDate?: string;
    incompleteDates?: string[];
  };
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

// ── the published coverage must still describe the corpus ───────────────────
// The three tests above gate the SERIES. These gate the COVERAGE BLOCK the
// series is qualified by, which is the half a row count cannot see: the corpus
// can gain six thin days while the payload keeps saying the latest one is fine.
//
// ⚠️ These re-derive the expectation with the SAME functions the publisher uses
// (scripts/prices/lib/coverage.ts), so they gate the payload's VINTAGE, not the
// rule — an inverted rule would move both sides together and pass. That split
// is deliberate and only sound because two sibling files pin the other half:
// `scripts/prices/lib/coverage.test.ts` pins the rule against literal fixtures,
// and `scripts/prices/build_index.test.ts` pins the wiring that applies it. If
// either is deleted or weakened, this file quietly stops testing anything about
// correctness.

/** Reporter count per loaded day, chronological — the corpus side of every
 *  comparison below. Also used by the first test in this file. */
const chainsByDay = async () => {
  const rows = await allRows<{ day: string; chains: string }>(
    `SELECT day::text AS day, count(*)::text AS chains
       FROM price_chain_days GROUP BY day ORDER BY day`,
  );
  return rows.map((r) => ({ day: r.day, chains: Number(r.chains) }));
};

/** trailingChainMedian needs 3 prior readings before it judges anything, so a
 *  corpus shorter than that has no derivable coverage to compare against. */
const MIN_DAYS_TO_JUDGE = 4;

test.skipIf(!RUN)(
  "the published coverage still matches the corpus it describes",
  async () => {
    const idx = await readIndex();
    if (!idx) return;
    const days = await chainsByDay();
    if (days.length < MIN_DAYS_TO_JUDGE) return;

    const c = idx.coverage;
    assert.ok(
      typeof c.chainsComplete === "boolean" && "headlineDate" in c,
      "coverage block predates the completeness fields — re-run " +
        "`npm run prices:payloads`.",
    );

    // The payload's own latest day, not max(price_chain_days): a payload built
    // before the newest ingest is stale, and that is what this catches.
    assert.ok(idx.national.index.length, "index series is empty");
    const latest = idx.national.index.at(-1)!.d;
    const upTo = days.filter((d) => d.day <= latest);
    assert.equal(
      upTo.at(-1)?.day,
      latest,
      `index.json's latest day (${latest}) is not in price_chain_days — the ` +
        `payload and the corpus are different vintages.`,
    );
    assert.equal(
      c.chains,
      upTo.at(-1)!.chains,
      "coverage.chains disagrees with price_chain_days for the same day — " +
        "re-run `npm run prices:payloads`.",
    );

    // Re-derive the rule from the corpus and compare, so a change to the
    // published block that is not a change to the rule fails here.
    const counts = upTo.map((d) => d.chains);
    const expectMedian = trailingChainMedian(counts, counts.length - 1);
    assert.equal(
      c.chainsTrailingMedian,
      expectMedian,
      "coverage.chainsTrailingMedian is not what the corpus yields",
    );
    assert.equal(
      c.chainsComplete,
      clearsCoverageFloor(counts.at(-1)!, expectMedian),
      "coverage.chainsComplete is not what the corpus yields",
    );

    const complete = upTo.map((_, i) =>
      clearsCoverageFloor(counts[i], trailingChainMedian(counts, i)),
    );
    const expectIncomplete = upTo
      .filter((_, i) => !complete[i])
      .map((d) => d.day);
    assert.deepEqual(
      c.incompleteDates,
      expectIncomplete,
      "coverage.incompleteDates has drifted from the corpus",
    );

    // …and headlineDate ITSELF. Without this it is the one coverage value
    // nothing re-derives: measured, setting it seven months stale (2026-01-02)
    // passes every other assertion in this file, because they only check that
    // it names a real, non-withheld day and 219 of 225 days satisfy that. A
    // stale headline is precisely the degradation build_index.ts warns about,
    // and it is the one dimension only a data test can see — a derivation
    // regression that never gets a `prices:payloads` re-run leaves every
    // corpus-derived field matching while the old headline stays plausible.
    const judged = upTo.map(
      (_, i) => trailingChainMedian(counts, i) != null && complete[i],
    );
    const idxOf = judged.includes(true)
      ? judged.lastIndexOf(true)
      : complete.lastIndexOf(true);
    assert.equal(
      c.headlineDate,
      upTo[idxOf].day,
      "coverage.headlineDate is not the day the corpus yields — the payload " +
        "is stale, or the derivation changed without a rebuild",
    );
  },
);

test.skipIf(!RUN)(
  "the headline day is servable, and is never one of the withheld days",
  async () => {
    const idx = await readIndex();
    if (!idx) return;
    const c = idx.coverage;
    // NOT a silent return: an absent headlineDate is the stale-payload state
    // this file exists to fail on, and letting it pass here would leave only
    // the previous test guarding it.
    assert.ok(
      c.headlineDate,
      "coverage.headlineDate is absent — price_payloads predates the " +
        "publish-side gate. Re-run `npm run prices:payloads`.",
    );

    const series = idx.national.index;
    assert.ok(series.length, "index series is empty");
    const point = series.find((p) => p.d === c.headlineDate);
    assert.ok(
      point,
      `coverage.headlineDate (${c.headlineDate}) names a day the series does ` +
        `not carry — every consumer that follows it would fall back to the ` +
        `last point, which is the day the gate exists to avoid.`,
    );
    assert.ok(
      !c.incompleteDates?.includes(c.headlineDate),
      "the headline day is itself withheld",
    );
    // `n` absent is a payload older than the chain-matched basis — a different
    // failure from `n === 0`, and reporting it as one would send whoever reads
    // this looking for a data defect instead of running the builder.
    assert.ok(
      typeof point!.n === "number",
      "the headline point carries no `n` — price_payloads predates the " +
        "chain-matched basis. Re-run `npm run prices:payloads`.",
    );
    assert.ok(
      point!.n! > 0,
      `the headline day rests on zero matched products — its value is the ` +
        `builder's 100 fallback, not a measurement`,
    );
  },
);
