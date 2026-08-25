// The /budget hub-stats blob as the live corpus holds it, for tests that assert on the head.
//
// TESTS ONLY. Two fiscal years, because the band behaves differently on each and the
// difference is the whole point: a RUNNING year has no budget-law column published yet, so
// every money figure available is our own seasonal forecast; a CLOSED year has the law and
// no forecast at all (`kfp.ts` stops producing one once `complete`).
//
// Measured on local Postgres 2026-08-25 via `budget_hub_stats(NULL)` / `budget_hub_stats(2025)`.
// Only the fields the head reads are carried — the cast is what keeps this from becoming a
// second, drifting definition of the whole payload.

import type { BudgetHubStats } from "@/data/budget/useBudgetHubStats";

/** FY2026 — six months in. `expenditurePlannedEur` is NULL because МФ has not published the
 *  budget-law column for it, which is why the head shipped €29,58 млрд. of OUR forecast
 *  captioned „план по закона за бюджета" for one review cycle. */
export const BUDGET_STATS_FIXTURE = {
  fiscalYear: 2026,
  asOf: "2026-06-30",
  complete: false,
  latestKfpPeriod: "2026-06",
  gdpEur: 128155604775,
  revenueExecutedEur: 12796000000,
  revenuePlannedEur: null,
  revenueProjectedEur: 27292242746,
  expenditureExecutedEur: 14150000000,
  expenditurePlannedEur: null,
  expenditureProjectedEur: 29577990982,
  projectionBasisYear: 2025,
  expenditurePlannedPctGdp: null,
  expenditureProjectedPctGdp: 23.1,
  balanceExecutedEur: -1914000000,
  balanceProjectedEur: -3405447950,
  programCount: 76,
  // The head's evidence list, and its denominator. €13.25bn across 44 units against the
  // €29.58bn projected above — the gap is the point, not an error.
  adminTotalPlannedEur: 13252076100,
  adminUnitCount: 44,
  topSpendingUnits: [
    {
      nodeId: "admin-ministerstvo-na-otbranata",
      nameBg: "Министерство на отбраната",
      nameEn: "Ministry of Defence",
      eur: 2568607900,
    },
    {
      nodeId: "admin-ministerstvo-na-vatreshnite-raboti",
      nameBg: "Министерство на вътрешните работи",
      nameEn: "Ministry of the Interior",
      eur: 2115233200,
    },
    {
      nodeId: "admin-ministerstvo-na-truda-i-sotsialnata-politika",
      nameBg: "Министерство на труда и социалната политика",
      nameEn: "Ministry of Labour and Social Policy",
      eur: 2112455500,
    },
    {
      nodeId: "admin-ministerstvo-na-regionalnoto-razvitie-i-blagoustroystvoto",
      nameBg: "Министерство на регионалното развитие и благоустройството",
      nameEn: "Ministry of Regional Development and Public Works",
      eur: 1058603600,
    },
    {
      nodeId: "admin-sadebnata-vlast",
      nameBg: "съдебната власт",
      nameEn: "Judiciary",
      eur: 762033000,
    },
  ],
} as unknown as BudgetHubStats;

/** FY2025 — closed. The projection is gone; only the law survives. */
export const BUDGET_STATS_CLOSED_FIXTURE = {
  fiscalYear: 2025,
  asOf: "2025-12-31",
  complete: true,
  latestKfpPeriod: "2025-12",
  gdpEur: 116018300000,
  revenueExecutedEur: 26309000000,
  revenuePlannedEur: 28207145253,
  revenueProjectedEur: null,
  expenditureExecutedEur: 28381000000,
  expenditurePlannedEur: 30820923086,
  expenditureProjectedEur: null,
  projectionBasisYear: null,
  expenditurePlannedPctGdp: 26.6,
  expenditureProjectedPctGdp: null,
  balanceExecutedEur: -3113000000,
  balanceProjectedEur: null,
  programCount: 79,
} as unknown as BudgetHubStats;
