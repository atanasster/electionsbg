// The /funds hub-stats blob, as measured, for the gates that need one.
//
// ONE copy, imported by all three. It was written out by hand in `FundsHubCaptions.test.tsx`,
// in `fundsHubCoverage.test.ts` and in `hubHead.gates.test.ts`, and three transcriptions of the
// same 22 fields is the drift shape this repo warns about everywhere else: the moment one is
// updated after a corpus reload and the others are not, two gates disagree about what the page
// shows and both stay green.
//
// Not a `*.test.ts` file, so vitest does not collect it, and nothing outside a test imports it —
// `fundsHubCoverage.test.ts`'s own dead-module clause is what keeps that true.

import type { FundsHubStats } from "@/data/funds/useFundsHubStats";
import type { FundsIndexFile } from "@/data/funds/types";

/** `funds_hub_stats()` against local Postgres, 2026-08-25.
 *
 *  ⚠ `satisfies`, NOT `as unknown as`. The cast silences the one check that makes a shared
 *  fixture safe: with it, renaming a field on `FundsHubStats` leaves all three gates green
 *  against an object that no longer matches the type they are testing against. Every field distinct, so a caption
 *  attached to the wrong figure shows up in an assertion rather than hiding behind two equal
 *  numbers — the reason `registerBeneficiaries` (53 122) and `beneficiaryCount` (47 617) are
 *  both here and must stay different. */
export const FUNDS_STATS_FIXTURE = {
  isun: {
    contractCount: 82162,
    beneficiaryCount: 47617,
    beneficiaryCountEikOnly: 46192,
    programmeCount: 47,
    contractedEur: 44015477336.12,
    grantEur: 33547016715.94,
    paidEur: 18576652667.17,
    absorptionPctOfGrant: 55.4,
    absorptionPctOfContracted: 42.2,
    placedContractedEur: 21991155879.58,
    placedMoneyPct: 50.0,
    oblastCount: 28,
    settlementCount: 3279,
  },
  tiles: {
    registerBeneficiaries: 53122,
    highConcentrationProgrammes: 18,
    politicalEiks: 279,
    focusDossiers: 5,
    dualCorpusCompanies: 5693,
  },
  rrf: {
    contractCount: 14180,
    contractedEur: 17572344268.62,
    absorptionPctOfGrant: 33.5,
  },
  /** The head's ranked list, as 145 emits it. Five DISTINCT programme codes, because the head
   *  links each row to its own page and „five rows, one destination" is the defect the sibling
   *  hub's band shipped — a fixture with a repeated code could not fail that clause. */
  topProgrammes: [
    {
      code: "2021BG-RRP",
      name: "Национален план за възстановяване и устойчивост",
      eur: 17572344268.62,
    },
    {
      code: "2014BG16M1OP001",
      name: "Транспорт и транспортна инфраструктура",
      eur: 3322166303.93,
    },
    {
      code: "2021BG16FFPR001",
      name: 'Програма "Транспортна свързаност" 2021-2027',
      eur: 2695196833.27,
    },
    {
      code: "2021BG16FFPR003",
      name: 'Програма "Развитие на регионите" 2021-2027',
      eur: 2504678005.93,
    },
    {
      code: "2014BG16RFOP002",
      name: "Иновации и конкурентоспособност",
      eur: 2229078481.2,
    },
  ],
  interreg: {
    operationCount: 1958,
    bgOperationCount: 1117,
    bgPartnerRowCount: 1494,
    bgPartnerOrgCount: 985,
    bgBudgetEur: 401768494.91,
  },
} satisfies FundsHubStats;

/** `fund_payloads` kind='index', same vintage. Its `paidEur` DELIBERATELY disagrees with
 *  `isun.paidEur` above by €367M — that is the real 2.0% gap between the two sources, and the
 *  reason the head's money cells read the hub-stats blob. Reconciling them here would delete
 *  the only fixture that can catch the band drifting back onto the index payload. */
export const FUNDS_INDEX_FIXTURE = {
  totals: {
    beneficiaries: 53122,
    withEik: 46231,
    contractCount: 82162,
    contractedEur: 44015477336.13,
    paidEur: 18209693782.83,
  },
  crossReference: {
    mpCount: 148,
    beneficiaryCount: 331,
    contractedEur: 1210000000,
  },
} as unknown as FundsIndexFile;
