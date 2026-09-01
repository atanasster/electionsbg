// The committed `data/home/price_events.json` — the price adapter's input.
//
// Unlike its two siblings this artifact is an INTERMEDIATE: nothing in the browser fetches
// it, and its only consumer is `gen_home/events/adapters.ts`. What it is FOR is that the
// retail corpus lives only in Postgres while the feed must build on a fresh clone, so this
// file is where the measurement stops being a database query and becomes a committed fact.
//
// The clauses below are therefore about the two things that would make it lie quietly: a
// measurement taken over a moving cohort, and a threshold that has drifted away from the
// replay that accepted it.

import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "../../lib/strip_comments";
import {
  BASKET_MOVE_PCT,
  BASKET_PIDS,
  MIN_COHORT_CELLS,
  MIN_COHORT_SHARE,
  PROMO_LEVEL_TOLERANCE,
  PROMO_MAX_DISCOUNT_PCT,
  PROMO_MIN_DISCOUNT_PCT,
  PROMO_START_WINDOW_DAYS,
  THRESHOLDS,
  collapseRuns,
  type BasketPoint,
} from "../gen_home/price_events";
import {
  MAX_DISC,
  MIN_DISC,
  MIN_PROMO_CHAINS,
  MIN_PROMO_STORES,
} from "../../prices/promoGate";
import type { PriceEventsV1 } from "../gen_home/events/priceSource";

const REPO = path.resolve(__dirname, "../../..");
const ARTIFACT = path.join(REPO, "data/home/price_events.json");
// ⚠️ READ CONDITIONALLY. Parsing at module scope throws during COLLECTION when the artifact is
// absent, so the `expect(existsSync(...))` clause below never runs and vitest reports a suite
// error instead of the message that names the fix. This generator legitimately skips on a
// database with no price corpus, so „absent" is a state a contributor will hit.
const present = existsSync(ARTIFACT);
const src = present
  ? (JSON.parse(readFileSync(ARTIFACT, "utf-8")) as PriceEventsV1)
  : ({ basketMoves: [], promotions: [] } as unknown as PriceEventsV1);

const point = (day: string, pctChange: number): BasketPoint => ({
  day,
  pctChange,
  costEur: 16,
  prevCostEur: 16,
  cohortCells: 2000,
  cohortShare: 0.9,
});

describe("home price events — the artifact", () => {
  it("exists, declares its version, and stays small", () => {
    expect(
      present,
      `${ARTIFACT} is committed — run npm run db:gen-home-price-events`,
    ).toBe(true);
    expect(src.schemaVersion).toBe(1);
    // Measurements, not a corpus. Anything approaching the feed's own 64 KiB ceiling would
    // mean a threshold stopped discriminating.
    expect(statSync(ARTIFACT).size).toBeLessThan(16 * 1024);
  });

  it("records EVERY threshold it was measured under, not a subset", () => {
    // ⚠️ `toEqual` ON THE WHOLE OBJECT, not `toMatchObject` on a hand-listed subset. The first
    // cut enumerated ten of fourteen rules — omitting the level tolerance, the promotion cap
    // and the two inherited gate constants — while the type and the audit both promised
    // completeness. A subset check cannot see an omission, which is the only failure this
    // clause exists for.
    expect(src.thresholds).toEqual(
      JSON.parse(JSON.stringify(THRESHOLDS)) as typeof src.thresholds,
    );
  });

  it("every stored move actually clears the thresholds it declares", () => {
    for (const m of src.basketMoves) {
      expect(Math.abs(m.pctChange), m.peakDay).toBeGreaterThanOrEqual(
        BASKET_MOVE_PCT,
      );
      expect(m.cohortCells, m.peakDay).toBeGreaterThanOrEqual(MIN_COHORT_CELLS);
      expect(m.cohortShare, m.peakDay).toBeGreaterThanOrEqual(MIN_COHORT_SHARE);
      // The peak is inside its own run, and the run is a real interval.
      expect(m.startDay <= m.peakDay, m.peakDay).toBe(true);
      expect(m.peakDay <= m.endDay, m.peakDay).toBe(true);
      expect(m.endDay <= src.computedAt, m.peakDay).toBe(true);
    }
  });

  it("no two moves describe the same episode", () => {
    // The collapse exists so a trend crossing on six consecutive days is ONE row. Overlapping
    // intervals would mean it stopped working and the feed is about to say the same thing
    // several times.
    const sorted = [...src.basketMoves].sort((a, b) =>
      a.startDay.localeCompare(b.startDay),
    );
    for (let i = 1; i < sorted.length; i++)
      expect(
        sorted[i].startDay > sorted[i - 1].endDay,
        `${sorted[i - 1].peakDay} and ${sorted[i].peakDay} overlap`,
      ).toBe(true);
  });

  it("every stored promotion clears the deals board's own gate", () => {
    for (const p of src.promotions) {
      expect(p.discountPct, p.slug).toBeGreaterThanOrEqual(
        PROMO_MIN_DISCOUNT_PCT,
      );
      // ⚠️ Above the ceiling it is empirically a source error, not a promotion.
      expect(p.discountPct, p.slug).toBeLessThanOrEqual(PROMO_MAX_DISCOUNT_PCT);
      expect(p.stores, p.slug).toBeGreaterThanOrEqual(MIN_PROMO_STORES);
      expect(p.chains, p.slug).toBeGreaterThanOrEqual(MIN_PROMO_CHAINS);
      expect(p.promoEur, p.slug).toBeLessThan(p.regularEur);
      // The level appeared inside the window, or it is not „what changed".
      const floor = new Date(
        Date.parse(src.computedAt) - PROMO_START_WINDOW_DAYS * 86_400_000,
      )
        .toISOString()
        .slice(0, 10);
      expect(
        p.atOrBelowSince >= floor,
        `${p.slug} at this level since ${p.atOrBelowSince}`,
      ).toBe(true);
      expect(p.atOrBelowSince <= src.computedAt, p.slug).toBe(true);
    }
  });

  it("the day a promotion is dated from describes the price it publishes", async () => {
    // ⚠️ THE CLAUSE THAT CLOSES THE ONE DEFECT THIS ARM SHIPPED. The published price passes
    // the deals board's outlier floor; `price_product_days.min_promo_eur` does not. Anchored on
    // the raw minimum the walk-back followed an EXCLUDED listing's run, and `limoni` published
    // „€1.28, since 31 August" for a level live since 21 August — on recency bought by a price
    // we refused to quote. Re-derived here from the history: on every day of the run the
    // cheapest promo must be at or below what we publish, and on the day BEFORE it must not.
    if (!present || src.promotions.length === 0) return;
    const { allRows, end, pinLocalDatabase } = await import("../lib/pg");
    pinLocalDatabase();
    try {
      for (const p of src.promotions) {
        const rows = await allRows<{ day: string; min_promo_eur: number }>(
          `SELECT h.day::text AS day, h.min_promo_eur
             FROM price_product_days h
             JOIN price_products pp ON pp.product_id = h.product_id
            WHERE pp.slug = $1 AND h.day BETWEEN $2::date - 1 AND $3::date
              AND h.min_promo_eur IS NOT NULL
            ORDER BY h.day`,
          [p.slug, p.atOrBelowSince, src.computedAt],
        );
        if (rows.length === 0) continue;
        const ceiling = p.promoEur * (1 + PROMO_LEVEL_TOLERANCE);
        const inRun = rows.filter((r) => r.day >= p.atOrBelowSince);
        for (const r of inRun)
          expect(
            r.min_promo_eur <= ceiling,
            `${p.slug}: ${r.day} min ${r.min_promo_eur} is above the published ${p.promoEur}`,
          ).toBe(true);
        // …and the run really is maximal: the day before it either has no promo at all or a
        // dearer one. Without this the clause passes on a run truncated to one day.
        const before = rows.find((r) => r.day < p.atOrBelowSince);
        if (before)
          expect(
            before.min_promo_eur > ceiling,
            `${p.slug}: the run should have started before ${p.atOrBelowSince}`,
          ).toBe(true);
      }
    } finally {
      await end();
    }
  });

  it("stores no now-relative field", () => {
    // Same rule as the feed: „ends in 3 days" frozen into a file is false the day after.
    const body = readFileSync(ARTIFACT, "utf-8");
    for (const bad of ["daysLeft", "daysAgo", "isOpen", "isLive", "endsIn"])
      expect(body, bad).not.toContain(`"${bad}"`);
  });
});

describe("home price events — the basket is the one the site already ranks on", () => {
  it("uses exactly build_payloads' COMMON_BASKET", () => {
    // ⚠️ THE POINT OF THIS CLAUSE. A home-page sentence about „the basket" measured over a
    // different twelve products than the município ranking and the cheapest-chain map would
    // contradict the page it links to, and nothing else in the repo compares the two lists.
    // ⚠️ COMMENTS STRIPPED FIRST. A commented-out `const COMMON_BASKET = […]` would be
    // matched in preference to the live one, and this repo has two gates burned by a naive
    // strip already — read `scripts/lib/strip_comments.ts`'s header before touching it.
    const other = stripComments(
      readFileSync(
        path.join(REPO, "scripts/prices/build_payloads.ts"),
        "utf-8",
      ),
    );
    const m = /const COMMON_BASKET = \[([^\]]+)\]/.exec(other);
    expect(m, "COMMON_BASKET not found in build_payloads.ts").toBeTruthy();
    const theirs = m![1]
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
    expect([...BASKET_PIDS].sort((a, b) => a - b)).toEqual(
      theirs.sort((a, b) => a - b),
    );
  });

  it("inherits the deals board's corroboration gate rather than copying it", () => {
    // ⚠️ THIS USED TO READ THREE CONSTANTS BACK OUT OF `build_payloads.ts` BY REGEX, and the
    // fourth — `PROMO_OUTLIER_FLOOR` — was restated here with nothing comparing it. That is
    // exactly the constant where the promotion's PRICE and its DATE were found to be measured
    // over different populations. Both files are Node, so there is now one definition and the
    // assertion is identity rather than a comparison of copies.
    expect(THRESHOLDS.promoMinStores).toBe(MIN_PROMO_STORES);
    expect(THRESHOLDS.promoMinChains).toBe(MIN_PROMO_CHAINS);
    expect(THRESHOLDS.promoMaxDiscountPct).toBe(MAX_DISC * 100);
    // ⚠️ Deliberately STRICTER, not equal: 15% off is a deal (there are hundreds live) and
    // 30% off is news. The inequality is the assertion.
    expect(PROMO_MIN_DISCOUNT_PCT).toBeGreaterThan(MIN_DISC * 100);
  });
});

describe("collapseRuns — one episode, one row", () => {
  it("collapses consecutive same-sign crossings into a single move at the peak", () => {
    const moves = collapseRuns(
      [
        point("2026-08-14", 1.6),
        point("2026-08-15", 2.4),
        point("2026-08-16", 3.2),
        point("2026-08-17", 1.9),
      ],
      1.5,
    );
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      startDay: "2026-08-14",
      peakDay: "2026-08-16",
      endDay: "2026-08-17",
      pctChange: 3.2,
    });
  });

  it("splits when the sign flips, because those are two different claims", () => {
    const moves = collapseRuns(
      [point("2026-08-14", 2), point("2026-08-15", -2)],
      1.5,
    );
    expect(moves.map((m) => m.pctChange)).toEqual([2, -2]);
  });

  it("splits when a day drops below the threshold in between", () => {
    const moves = collapseRuns(
      [
        point("2026-08-14", 2),
        point("2026-08-15", 0.1),
        point("2026-08-16", 2),
      ],
      1.5,
    );
    expect(moves).toHaveLength(2);
  });

  it("does NOT split on a day the corpus never filed", () => {
    // ⚠️ „Consecutive" is measured on the SERIES, not on the calendar. A missing day is
    // absent from the input entirely, and treating the gap as the end of a run would report
    // one episode twice — the exact failure the collapse exists to prevent.
    const moves = collapseRuns(
      [point("2026-08-14", 2), point("2026-08-17", 2.5)],
      1.5,
    );
    expect(moves).toHaveLength(1);
    expect(moves[0].peakDay).toBe("2026-08-17");
  });

  it("refuses a move measured over a thin or shrinking cohort", () => {
    // The coverage guard. A large move over 40 surviving cells is a statement about a
    // handful of shops, and one over a cohort that is a third of what was priced is a
    // statement about the remnant.
    const thin = { ...point("2026-08-14", 3), cohortCells: 100 };
    const biased = { ...point("2026-08-15", 3), cohortShare: 0.2 };
    expect(collapseRuns([thin, biased], 1.5)).toEqual([]);
    // …and the mutation check: with the cohort healthy the same numbers DO produce moves,
    // so the clause above cannot pass on a collapse that rejects everything.
    expect(
      collapseRuns([point("2026-08-14", 3), point("2026-08-16", 3)], 1.5),
    ).toHaveLength(1);
  });

  it("emits nothing when no day crosses", () => {
    expect(collapseRuns([point("2026-08-14", 1.4)], 1.5)).toEqual([]);
  });
});
