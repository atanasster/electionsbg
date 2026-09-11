import type { Seed } from "./corpus";

// One executed call per workflow: the public chat currently selects one tool.
// These are scope specifications, not questions copied from the evaluation set.
export const SEEDS: Seed[] = [
  {
    id: "election-turnout",
    domain: "elections",
    tool: "turnout",
    args: { election: "2023_04_02" },
    requiredFacts: ["election", "turnout", "voters"],
    scope:
      "National voter turnout in the 2 April 2023 parliamentary election; not a rolling trend.",
  },
  {
    id: "election-machine",
    domain: "elections",
    tool: "machineVoteShare",
    args: { election: "2023_04_02" },
    requiredFacts: ["election", "machine_share"],
    scope:
      "Machine-voting share in the 2 April 2023 parliamentary election; not turnout.",
  },
  {
    id: "election-national",
    domain: "elections",
    tool: "nationalResults",
    args: { election: "2024_10_27" },
    requiredFacts: ["election", "parties_over_threshold"],
    scope:
      "National party results in the 27 October 2024 parliamentary election, not the June ballot.",
  },
  {
    id: "election-party",
    domain: "elections",
    tool: "partyResult",
    args: { party: "ГЕРБ", election: "2023_04_02" },
    requiredFacts: ["party", "votes", "election"],
    scope:
      "GERB's result in the 2 April 2023 parliamentary election; preserve party and ballot.",
  },
  {
    id: "election-compare",
    domain: "elections",
    tool: "compareElections",
    args: { a: "2022_10_02", b: "2024_10_27" },
    requiredFacts: ["a", "b", "turnout_a", "turnout_b"],
    scope:
      "Compare the 2 October 2022 and 27 October 2024 parliamentary elections in that order.",
  },
  {
    id: "election-municipality",
    domain: "elections",
    tool: "municipalityResults",
    args: { place: "Пловдив", election: "2023_04_02" },
    requiredFacts: ["municipality", "election", "total_votes"],
    scope:
      "All-party parliamentary results in Plovdiv municipality on 2 April 2023; not mayoral results.",
  },
  {
    id: "procurement-total",
    domain: "procurement",
    tool: "procurementTotals",
    args: {},
    requiredFacts: ["contracts"],
    scope:
      "Overall AOP procurement corpus totals. Contracted value is not proof of disbursement; no unsupported time filter.",
  },
  {
    id: "procurement-contractors",
    domain: "procurement",
    tool: "topContractors",
    args: { count: 5 },
    requiredFacts: ["top_contractor", "top_value"],
    scope:
      "Top five contractors by total public-contract value across the corpus, not buyers or a single year.",
  },
  {
    id: "procurement-appeals",
    domain: "procurement",
    tool: "procurementAppeals",
    args: { count: 5 },
    requiredFacts: ["total_complaints"],
    scope:
      "Procurement appeals and five most-appealed buyers. Upheld means the buyer decision was annulled, not proven corruption.",
  },
  {
    id: "procurement-flags",
    domain: "procurement",
    tool: "procurementRedFlags",
    args: {},
    requiredFacts: ["active_debarred", "top_share"],
    scope:
      "Procurement screening signals and concentration; signals do not establish corruption.",
  },
  {
    id: "procurement-single-bid",
    domain: "procurement",
    tool: "procurementSingleBidSectors",
    args: {},
    requiredFacts: ["suppressed_divisions", "total_divisions"],
    scope:
      "CPV sectors where a single bidder is the market norm; not a list of criminal conduct.",
  },
  {
    id: "procurement-buyer",
    domain: "procurement",
    tool: "awarderProcurement",
    args: { org: "000695324" },
    requiredFacts: ["buyer", "eik"],
    scope:
      "Procurement of the institution with EIK 000695324; preserve this identifier, no invented year restriction.",
  },
  {
    id: "people-profile",
    domain: "people",
    tool: "personProfile",
    args: { name: "Бойко Методиев Борисов" },
    requiredFacts: ["name|име"],
    scope:
      "Unified public profile of Boyko Metodiev Borisov, not just wealth or a corruption verdict.",
  },
  {
    id: "people-connections",
    domain: "people",
    tool: "personConnections",
    args: { name: "Бойко Методиев Борисов" },
    requiredFacts: ["name|име"],
    scope:
      "Other public figures connected to Boyko Metodiev Borisov through registry company roles. A name-match lead is not proof.",
  },
  {
    id: "people-wealth",
    domain: "people",
    tool: "personWealth",
    args: { name: "Бойко Методиев Борисов" },
    requiredFacts: ["name|име"],
    scope:
      "Boyko Metodiev Borisov's declared wealth over time. Declared assets and liabilities, not audited or market-valued wealth; no single-year filter.",
  },
  {
    id: "people-assets-top",
    domain: "people",
    tool: "mpAssetsTop",
    args: {},
    requiredFacts: ["richest"],
    scope:
      "Richest MPs: the tool ranks by declared net worth and displays declared assets. Do not claim the displayed assets column is the ordering key; not audited wealth or salary.",
  },
  {
    id: "people-attendance",
    domain: "people",
    tool: "mpAttendance",
    args: { ns: 51 },
    requiredFacts: ["ns", "best_attendance", "worst_attendance"],
    scope:
      "Attendance at roll-call votes in the 51st National Assembly, not all parliamentary work.",
  },
  {
    id: "people-loyalty",
    domain: "people",
    tool: "mpLoyalty",
    args: { ns: 51 },
    requiredFacts: ["ns", "most_loyal", "least_loyal"],
    scope:
      "Voting with one's parliamentary group in the 51st National Assembly, not attendance.",
  },
  {
    id: "municipal-mayor",
    domain: "municipal",
    tool: "localMunicipality",
    args: { place: "Пловдив", cycle: "2023_10_29_mi" },
    requiredFacts: ["mayor", "cycle_id"],
    scope:
      "Mayor elected in Plovdiv in the 2023 local elections; not a claim about who holds office today.",
  },
  {
    id: "municipal-council",
    domain: "municipal",
    tool: "localCouncil",
    args: { place: "Варна", cycle: "2023_10_29_mi" },
    requiredFacts: ["total_seats", "cycle_id"],
    scope:
      "Varna municipal council seats from the 2023 local election; not parliamentary seats.",
  },
  {
    id: "municipal-tax",
    domain: "municipal",
    tool: "localTaxes",
    args: { place: "Русе" },
    requiredFacts: ["place", "indicators"],
    scope:
      "Published local tax rates for Ruse versus the national average; not personal tax advice or a payment action.",
  },
  {
    id: "municipal-transfers",
    domain: "municipal",
    tool: "municipalTransfers",
    args: { year: 2025 },
    requiredFacts: ["year", "total", "municipalities"],
    scope:
      "State transfers to municipalities by category in 2025, not municipal tax revenues.",
  },
  {
    id: "municipal-arrears",
    domain: "municipal",
    tool: "municipalFiscalRanking",
    args: { year: 2024, count: 5, metric: "arrears" },
    requiredFacts: ["period|период"],
    scope:
      "Five municipalities with largest year-end 2024 overdue liabilities (arrears), not commitments or total debt. Missing is not zero.",
  },
  {
    id: "municipal-profile",
    domain: "municipal",
    tool: "governanceProfile",
    args: { place: "Габрово" },
    requiredFacts: ["place", "population"],
    scope:
      "Composite governance profile of Gabrovo using latest available observations; different metrics can have different dates.",
  },
];
