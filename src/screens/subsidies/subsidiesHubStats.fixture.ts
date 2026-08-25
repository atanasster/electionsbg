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
import type { AgriTopRecipient } from "@/data/agri/types";

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

/** `topRecipients` from the same measurement, default scope — the head's evidence aside.
 *
 *  ⚠️ `totalEur` FOLLOWS THE SCOPE AND THE YEAR FIELDS DO NOT. Златия Агро is €7.9m here
 *  and €38.57m on the `all` payload, while all three year fields read 2015-2025 / 8 in
 *  BOTH. A row rendering the money beside the span therefore says „€7.9m over eight years",
 *  wrong by ~5×, which is why the aside publishes the money alone. */
export const AGRI_TOP_RECIPIENTS_FIXTURE = [
  {
    eik: "111560777",
    name: "Златия Агро ЕООД",
    oblast: "Монтана",
    totalEur: 7900934.51,
    firstYear: 2015,
    lastYear: 2025,
    yearCount: 8,
  },
  {
    eik: "104095064",
    name: "СОРТОВИ СЕМЕНА - ВАРДИМ АД",
    oblast: "Велико Търново",
    totalEur: 3339122.4,
    firstYear: 2015,
    lastYear: 2025,
    yearCount: 8,
  },
  {
    eik: "130339616",
    name: "НАЦИОНАЛНА СЛУЖБА ЗА СЪВЕТИ В ЗЕМЕДЕЛИЕТО",
    oblast: "София (столица)",
    totalEur: 2818440.11,
    firstYear: 2015,
    lastYear: 2025,
    yearCount: 8,
  },
  {
    eik: "815157442",
    name: "Магура АД",
    oblast: "Видин",
    totalEur: 2129887.02,
    firstYear: 2015,
    lastYear: 2025,
    yearCount: 8,
  },
  {
    eik: "000057250",
    name: "Община Сунгурларе",
    oblast: "Бургас",
    totalEur: 1897441.66,
    firstYear: 2015,
    lastYear: 2025,
    yearCount: 8,
  },
] satisfies AgriTopRecipient[];

/** The 2016 payload's real top five — ALL FIVE MUNICIPALITIES, verbatim from Postgres.
 *
 *  ⚠️⚠️ THIS IS THE SHAPE THE DEFAULT-SCOPE FIXTURE CANNOT SHOW. On `?pscope=y:2016` the
 *  aside's five loudest names are town halls (5/5; 4/5 on 2015, 3/5 on 2021, 2/5 on the
 *  default). The money is real — Rural Development Programme М07 „обновяване на селата" and
 *  М02 advisory — but under „Най-големи получатели", beneath a deck saying „кой получава
 *  публичните пари за ЗЕМЕДЕЛИЕ", it reads as „Община Сатовча получи €6,4 млн. земеделски
 *  субсидии", which is not what happened. The caption names them for that reason, and this
 *  fixture is what lets a gate see it: with only the default-scope rows, every assertion
 *  passes on the one scope where the list happens to look like farms.
 *
 *  Note the year fields drift from the scope here too — „firstYear 2016, yearCount 5" beside
 *  one year's money. */
export const AGRI_TOP_RECIPIENTS_2016_FIXTURE = [
  {
    eik: "000024962",
    name: "Община Сатовча",
    oblast: "Благоевград",
    totalEur: 6438360.37,
    firstYear: 2016,
    lastYear: 2025,
    yearCount: 5,
  },
  {
    eik: "000024688",
    name: "Община Белица",
    oblast: "Благоевград",
    totalEur: 5364842.99,
    firstYear: 2015,
    lastYear: 2025,
    yearCount: 6,
  },
  {
    eik: "000970464",
    name: "ОБЩИНА ТОПОЛОВГРАД",
    oblast: "Хасково",
    totalEur: 4990876.28,
    firstYear: 2016,
    lastYear: 2025,
    yearCount: 5,
  },
  {
    eik: "000471671",
    name: "Община Хисаря",
    oblast: "Пловдив",
    totalEur: 4339847.26,
    firstYear: 2015,
    lastYear: 2025,
    yearCount: 7,
  },
  {
    eik: "000093524",
    name: "Община Дългопол",
    oblast: "Варна",
    totalEur: 4289744.09,
    firstYear: 2015,
    lastYear: 2025,
    yearCount: 6,
  },
] satisfies AgriTopRecipient[];
