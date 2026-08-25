// Gate for the `hub-stats` blob — the ONE payload the /consumption head reads.
//
// Every field here is a BASIS, not a figure: the windows that stop the head's first two
// cells reading as a contradiction (−0.5% basket against +3.8% food inflation), plus the
// EU price level folded in so the band is one query rather than two.
//
// ⚠️ The builder had none of this under test before: the fixture beside the screen is a
// hand-copy of the blob, and `prices_index_stability` covers `basketChangePct`'s VALUE and
// nothing about its window. A caption is only as true as the field it interpolates.

import { test, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

type Blob = Record<string, unknown>;

const haveDb = await dbReachable();
const rows = haveDb
  ? await allRows<{ hub: Blob | null; idx: Blob | null }>(
      `SELECT (SELECT payload FROM price_payloads WHERE kind = 'hub-stats' LIMIT 1) AS hub,
              (SELECT payload FROM price_payloads WHERE kind = 'index'     LIMIT 1) AS idx`,
    )
  : [];
const hub = rows[0]?.hub ?? null;
const idx = rows[0]?.idx ?? null;

type Row = { eik: string; basket: number; comparable: boolean };
const chainRows = haveDb
  ? await allRows<{ b: Blob | null }>(
      "SELECT payload AS b FROM price_payloads WHERE kind = 'chains' LIMIT 1",
    )
  : [];
const idx0 = chainRows[0]?.b ?? null;

const skip = !haveDb
  ? "Postgres unreachable"
  : !hub
    ? "no hub-stats blob — run npm run prices:payloads"
    : false;
reportSkip(import.meta.url, skip);
afterAll(async () => {
  await end();
});

const num = (v: unknown) => (v == null ? null : Number(v));

test.skipIf(skip)(
  "the basket's window is the HEADLINE window, not the corpus",
  () => {
    const cov = (idx?.coverage ?? {}) as {
      headlineDate?: string;
      incompleteDates?: string[];
    };
    const series = ((idx?.national as { index?: { d: string }[] })?.index ??
      []) as {
      d: string;
    }[];
    assert.ok(series.length, "the index blob carries no national series");

    // ⚠️ `basketAsOf` IS THE PUBLISHER'S HEADLINE DAY, never `series[last].d`. The КЗП feed's
    // reporter set collapses periodically; on the 2026-08 collapse the newest day read −1.3%
    // while the last COMPLETE day read +1.4%, which is why `headlineIndex` exists at all.
    assert.equal(
      hub!.basketAsOf,
      cov.headlineDate,
      "basketAsOf is not the coverage headline day — the caption would date the figure wrong",
    );

    // ⚠️ AND THE WINDOW IS WIDER THAN `days` SUGGESTS. Withheld days are reached back PAST,
    // so the span is not `asOf` minus `days`. Measured 2026-08-25: 7 usable days over 17
    // calendar days, and one pre-collapse day supplied 0.3 of the 0.5 printed points. The
    // caption may therefore not read as a point measurement — this asserts the fields it
    // needs are present and coherent, not that the span is small.
    const from = String(hub!.basketWindowFrom ?? "");
    const asOf = String(hub!.basketAsOf ?? "");
    const days = num(hub!.basketWindowDays);
    assert.ok(
      from && asOf && days,
      "the basket window is not fully on the wire",
    );
    assert.ok(from <= asOf, `window start ${from} is after its end ${asOf}`);
    assert.ok(days! >= 1 && days! <= 7, `implausible window of ${days} days`);
    assert.ok(
      series.some((p) => p.d === from) && series.some((p) => p.d === asOf),
      "the window's ends are not days the index actually carries",
    );
    // Non-vacuity: the window must not be a single day, or the „mean" the caption promises
    // is a reading and the distinction this file exists for has quietly gone away.
    assert.ok(days! > 1, "the headline window collapsed to one day");

    // The base is where the series is 100 — euro adoption, not an arbitrary start.
    assert.equal(hub!.basketFrom, series[0].d);

    // ⚠️ AND THE SOURCE, AT THE DEFINITION LEVEL — because the rows cannot tell. On the
    // current corpus `coverage.headlineDate` happens to BE the series' last day, so a
    // builder re-pointed at `natIndex[natIndex.length - 1]` produces an identical blob
    // and every assertion above stays green. It would start lying only on the next
    // reporter collapse, months later, on a file nobody was editing. Measured: that exact
    // mutation passed this test until this clause was added.
    const src = readFileSync("scripts/prices/build_payloads.ts", "utf8");
    assert.match(
      src,
      /basketAsOf:\s*basketHeadline\?\.d/,
      "basketAsOf no longer comes from headlineIndex — it would silently become the " +
        "corpus's newest day, which is not the day the publisher stands behind",
    );
    assert.match(
      src,
      /basketWindowFrom:\s*basketHeadline\?\.from/,
      "basketWindowFrom no longer comes from headlineIndex",
    );
    // Non-vacuity: a typo in either pattern would make both pass by matching nothing.
    assert.ok(
      src.includes("headlineIndex("),
      "the builder no longer calls headlineIndex — this clause is matching nothing",
    );
  },
);

test.skipIf(skip)(
  "the food-CPI period matches macro.json's own last point",
  () => {
    const macro = readFileSync("data/macro.json", "utf8");
    const pts = (
      JSON.parse(macro) as {
        series?: {
          inflationFood?: {
            value: number;
            period: string;
            year: number;
            quarter: number;
          }[];
        };
      }
    ).series?.inflationFood;
    assert.ok(pts?.length, "macro.json carries no inflationFood series");
    const last = pts![pts!.length - 1];

    assert.equal(num(hub!.foodInflationPct), last.value);
    assert.equal(hub!.foodInflationPeriod, last.period);
    assert.equal(num(hub!.foodInflationYear), last.year);
    assert.equal(num(hub!.foodInflationQuarter), last.quarter);

    // ⚠️ The parts must AGREE with the token, because the caption renders the parts while
    // the token is what a reader would paste into Eurostat.
    assert.equal(`${last.year}-Q${last.quarter}`, last.period);
  },
);

test.skipIf(skip)(
  "the EU price level is the OVERALL one, folded in for a single query",
  () => {
    // ⚠️ A01 is „Потребление (общо)". A0101 is the food division and reads differently — and
    // the band captions this as the overall level, so picking the wrong code makes the
    // caption false rather than merely narrow.
    const peers = JSON.parse(readFileSync("data/macro_peers.json", "utf8")) as {
      pricePli?: { year?: number; values?: { BG?: Record<string, number> } };
    };
    assert.ok(peers.pricePli, "macro_peers.json carries no pricePli block");

    assert.equal(num(hub!.euPriceLevel), peers.pricePli!.values!.BG!.A01);
    assert.equal(num(hub!.euPriceLevelYear), peers.pricePli!.year);
    // The food division must NOT be what shipped.
    const food = peers.pricePli!.values!.BG!.A0101;
    if (food != null && food !== peers.pricePli!.values!.BG!.A01)
      assert.notEqual(num(hub!.euPriceLevel), food);
  },
);

test.skipIf(skip)(
  "the cheapest-chains aside ranks COMPARABLE chains only",
  () => {
    // ⚠️⚠️ THE DEFECT THIS FILTER EXISTS FOR. `chains.national` is sorted ascending by
    // `basket`, which is a SUM over whatever subset of the common basket each chain
    // actually priced — so its cheapest rows are the chains that priced the FEWEST items.
    // The blob says so in its own `note`: „a partial basket is a smaller number, not a
    // cheaper shop." Measured 2026-08-25: the raw leader is АНЕТ 4 at €8.85 on 7 of 12
    // products, 39% under ЖИЗЕЛ's €14.54 over the whole basket. Publishing the raw order
    // names a real company as Bulgaria's cheapest on the strength of what it did not price.
    const chains = (idx0 as { national?: Row[] } | null)?.national ?? [];
    assert.ok(chains.length, "the chains blob carries no national rows");

    const comparable = chains.filter((c) => c.comparable);
    const shown = (hub!.cheapestChains ?? []) as {
      eik: string;
      basket: number;
    }[];
    assert.ok(shown.length, "the aside carries no rows");

    const expected = [...comparable]
      .sort((a, b) => a.basket - b.basket || (a.eik < b.eik ? -1 : 1))
      .slice(0, shown.length);
    assert.deepEqual(
      shown.map((c) => c.eik),
      expected.map((c) => c.eik),
      "the aside is not the cheapest COMPARABLE chains",
    );

    // Every published row priced the whole basket.
    const byEik = new Map(chains.map((c) => [c.eik, c]));
    for (const r of shown)
      assert.equal(
        byEik.get(r.eik)?.comparable,
        true,
        `${r.eik} is published as cheapest without pricing the whole basket`,
      );

    // The denominators the caption states must be the real ones.
    assert.equal(num(hub!.comparableChainCount), comparable.length);

    // ⚠️ THE REPORTING SET, NOT `chains.length`. `chains.national` is already filtered by
    // build_index to chains pricing half the basket — 57 of the 94 that filed — so
    // captioning „28 of 57" understates the exclusion by more than half and contradicts
    // the `chains` tile on the same page, which publishes 94.
    const reported = num(
      (idx?.coverage as { chains?: number } | undefined)?.chains,
    );
    assert.equal(num(hub!.rankedChainCount), reported);
    assert.ok(
      reported! > chains.length,
      "the reporting set is not wider than the scored list — this distinction has gone away",
    );

    // The other two interpolated values, which nothing else asserted: a builder taking the
    // basket size from `categories` (14) or the day from `coverage.headlineDate` would
    // otherwise ship a caption nobody checked.
    assert.equal(
      num(hub!.commonBasketSize),
      num((idx0 as { commonBasketSize?: number } | null)?.commonBasketSize),
    );
    assert.equal(
      hub!.basketPricedOn,
      (idx0 as { latestDate?: string } | null)?.latestDate,
    );

    // ⚠️ THE MUTATION CHECK: the filter must actually CHANGE the answer on this corpus,
    // or the assertions above are satisfied by an implementation that never filtered.
    const unfiltered = [...chains]
      .sort((a, b) => a.basket - b.basket || (a.eik < b.eik ? -1 : 1))
      .slice(0, shown.length);
    assert.notDeepEqual(
      shown.map((c) => c.eik),
      unfiltered.map((c) => c.eik),
      "filtering on `comparable` changes nothing here — this gate cannot discriminate",
    );
    assert.ok(
      comparable.length < chains.length,
      "every chain is comparable — this gate cannot discriminate",
    );
  },
);
