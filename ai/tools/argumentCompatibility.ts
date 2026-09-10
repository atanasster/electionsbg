// Reviewed legacy spellings used by heuristic routes. These are not extra form
// controls: the public field on the right already accepts the same input.
export const ARGUMENT_ALIASES: Record<string, Record<string, string>> = {
  municipalFiscalRanking: { n: "count" },
  municipalityBreakdown: { place: "oblast" },
  municipalityWinners: { place: "oblast" },
  regionResults: { place: "oblast" },
  regionResultsTrend: { place: "oblast" },
  judiciaryCourtLoad: { query: "court" },
  nzokHospitalScorecard: { name: "hospital" },
  nzokPathwayHospitals: { pathway: "procedure", name: "procedure" },
  nzokPrivateHospitals: { mode: "filter" },
  contractSearch: { eik: "company" },
  awarderProcurement: { place: "org" },
  procurementNormalcy: { contract: "key", id: "key" },
  openTenders: {
    place: "org",
    subject: "query",
    metric: "query",
    unp: "query",
  },
  tenderLookup: { query: "unp", subject: "unp", metric: "unp" },
  openCalls: { metric: "query" },
  subsidiesForEntity: { person: "company", eik: "company" },
  filmSubsidyForProducer: { metric: "company" },
  revenueBreakdown: { metric: "category" },
  exciseRegister: { metric: "category" },
  exciseWarehouses: { metric: "category" },
  budgetExecution: { indicator: "series" },
  ministryBudget: { place: "ministry" },
  personProfile: { person: "name" },
  personConnections: { person: "name" },
  personWealth: { person: "name" },
  companyConnections: { eik: "company" },
  macroByCategory: { indicator: "category" },
  euComparison: { metric: "indicator" },
  schoolMatura: { place: "school", query: "school" },
  procurementByOblast: { place: "oblast" },
  schoolScores: { indicator: "subject" },
};

// Only accepted from a tool-produced clarification, not ordinary user input.
export const INTERNAL_ARGUMENTS: Record<string, readonly string[]> = {
  candidateResult: ["partyNum"],
};

// The shared budget closure accesses year only when its spec declares a year.
export const CONDITIONAL_ARGUMENTS: Record<string, readonly string[]> = {
  budgetPersonnel: ["year"],
  budgetInvestmentPayments: ["year"],
};
