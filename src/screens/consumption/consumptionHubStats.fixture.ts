// The /consumption hub-stats blob as the live corpus holds it, for tests on the head.
//
// TESTS ONLY. Measured on local Postgres 2026-08-25 via
// `SELECT payload FROM price_payloads WHERE kind='hub-stats'`, plus the PLI scalar the
// head reads from macro_peers.json (Eurostat prc_ppp_ind_1, EU27=100).
//
// ⚠️ The two headline rates are DELIBERATELY the real ones: −0.5% against +3.8%. They look
// like a contradiction and are not, which is the whole reason the band's captions exist —
// see `consumptionHubFigures.ts`. A fixture that smoothed them would test nothing.

import type { HubStats } from "@/data/prices/usePrices";

export const CONSUMPTION_STATS_FIXTURE = {
  chains: 94,
  products: 48427,
  dearerPct: 21,
  cheaperPct: 21,
  categories: 14,
  settlements: 170,
  biggestDealPct: 55,
  basketChangePct: -0.5,
  basketFrom: "2026-01-02",
  basketAsOf: "2026-08-24",
  // ⚠️ SEVENTEEN calendar days for a „7-day" mean — 2026-08-09…08-18 were withheld for
  // incomplete chain coverage and the window reaches back past them. Real, and the reason
  // the caption may not read as a point measurement: 24 August alone is −0.8%.
  basketWindowFrom: "2026-08-08",
  basketWindowDays: 7,
  foodInflationPct: 3.8,
  foodInflationPeriod: "2026-Q2",
  foodInflationYear: 2026,
  foodInflationQuarter: 2,
  euPriceLevel: 60,
  euPriceLevelYear: 2025,
  fuelGapPct: -23.5,
  electricityGapPct: -53.2,
  gasGapPct: -47.2,
} as unknown as HubStats;
