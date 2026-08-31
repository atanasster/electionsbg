// The `hub-stats` blob, verbatim from /api/db/price-payload?kind=hub-stats, read 2026-08-31
// (corpus day 2026-08-30).
//
// ⚠️ ONE FIXTURE, TWO GATES, and that is the repo's convention for exactly this shape —
// `subsidiesHubStats.fixture.ts` and the budget one are both imported into
// `hubHead.gates.test.ts` from their own hub's directory. It was briefly two literals, each
// headed „verbatim from the live blob" and neither the same object as the other: the builder
// gate's four-cell band and the cross-hub gate's would then have been built from different
// numbers, with both files claiming the same provenance.

import type { HubStats } from "@/data/prices/usePrices";

export const PRICES_STATS_FIXTURE = {
  products: 46682,
  dearerPct: 21,
  cheaperPct: 22,
  chains: 85,
  settlements: 169,
  categories: 14,
  basketChangePct: -1,
  biggestDealPct: 54,
  fuelGapPct: -23.5,
  electricityGapPct: null,
  gasGapPct: -47.2,
  foodInflationPct: 3.8,
  basketFrom: "2026-01-02",
  basketAsOf: "2026-08-30",
  basketWindowFrom: "2026-08-24",
  basketWindowDays: 7,
  foodInflationPeriod: "2026-Q2",
  euPriceLevel: 60,
  cheapestChains: [
    { eik: "111017831", chain: "ЖИЗЕЛ", basket: 14.56 },
    { eik: "131071587", chain: "Лидл България", basket: 15.09 },
  ],
  comparableChainCount: 28,
  rankedChainCount: 85,
  commonBasketSize: 12,
  basketPricedOn: "2026-08-30",
  // ⚠️ `satisfies`, NOT `as unknown as`. Every field above is declared on `HubStats` and all
  // the required ones are present, so the double cast bought nothing and cost the check: a
  // mistyped optional key would have become „field absent" rather than a compile error.
} satisfies HubStats;

/** The DEALS payload's own build day — a SECOND blob, which is why the band takes it as a
 *  parameter rather than reading it off the one above. */
export const PRICES_DEALS_AS_OF = "2026-08-30";
