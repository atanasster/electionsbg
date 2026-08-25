// The /subsidies hub-stats blob for two scopes, for tests on the head.
//
// TESTS ONLY. Pasted VERBATIM from `SELECT agri_hub_stats('')` and `agri_hub_stats('all')`
// on local Postgres, 2026-08-26 — a fixture whose header claims a measurement should be one,
// so a future reader never has to ask whether a round-looking value was convenient.
//
// ⚠️ The two scopes differ by 7× on the headline (€1.59bn against €11.04bn) and by 2× on the
// recipients. That is the point, not a quirk of the fixture: `/subsidies`' default scope is
// ONE financial year, so a caption lagging its figure is not a nicety here.

import type { AgriHubStats } from "@/data/agri/useAgriHubStats";

/** The DEFAULT scope — `ns`, which for subsidies resolves to the latest financial year. */
export const AGRI_STATS_FIXTURE = {
  scopeKey: "",
  scopeYear: 2025,
  paymentRows: 230214,
  totalEur: 1586940416.44,
  entityCountExPayer: 8396,
  entityEurExPayer: 804166977.11,
  noEikEur: 782773439.33,
  noEikBeneficiaries: 24727,
  noEikRows: 171916,
  noEikCompanyShapedEurFloor: 196423242.74,
  noEikPctOfTotalEur: 49.3,
  schemeCount: 281,
  topScheme: "I.А.1-1 oсновно подпомагане на доходите за устойчивост",
  topSchemeEur: 382668993.14,
  oblastCount: 28,
  topOblast: "София (столица)",
  topOblastEur: 127930399.74,
  top100PctOfEntityEur: 14.82,
  top1000PctOfEntityEur: 56.29,
  politicalEiks: 240,
  politicalEur: 22062216.03,
  politicalPeople: 261,
  politicalBasisBuilt: true,
  isunEiks: 2278,
  contractEiks: 373,
  crossStream: {
    muniTransferEur: null,
    muniTransferYear: null,
    muniCount: null,
  },
} satisfies AgriHubStats;

/** The `all` scope — EIGHT financial years, not eleven: ДФЗ published nothing for
 *  2018-2020, which is why the band's window caption counts years before naming a span. */
export const AGRI_STATS_ALL_FIXTURE = {
  ...AGRI_STATS_FIXTURE,
  scopeKey: "all",
  scopeYear: null,
  totalEur: 11037181927.17,
  entityCountExPayer: 16701,
  noEikPctOfTotalEur: 39.8,
  top100PctOfEntityEur: 12.62,
  politicalEiks: 570,
  isunEiks: 3910,
} satisfies AgriHubStats;
