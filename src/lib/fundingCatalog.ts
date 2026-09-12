// Pure capability definitions; no dates, money or signal definitions borrowed from procurement.
export const FUNDING_VERSION = "funding-records-v1";
export const FUNDING_CATALOG_VERSION = "1.0.0";
export const FUNDING_CORPORA = [
  "isunProjects",
  "agriPayments",
  "interregOperations",
  "interregPartners",
] as const;
export type FundingCorpus = (typeof FUNDING_CORPORA)[number];
export const FUNDING_OPERATIONS = [
  "summary",
  "count",
  "sum",
  "share",
  "list",
  "rank",
  "trend",
  "compare",
  "detail",
  "methodology",
] as const;
export const FUNDING_CAPABILITIES = {
  isunProjects: {
    dates: ["none", "observed"],
    amounts: ["grant", "projectCost", "ownCofinance", "paid"],
    groups: ["entity", "programme", "theme", "place", "month", "year"],
    predicates: [
      "political",
      "debarredName",
      "unidentified",
      "zeroPaid",
      "serialWinner",
      "otherFunding",
    ],
    defaultAmount: "grant",
  },
  agriPayments: {
    dates: ["financialYear"],
    amounts: ["paid", "direct", "market", "rural"],
    groups: ["entity", "scheme", "financialYear", "place"],
    predicates: ["political", "unidentified", "otherFunding"],
    defaultAmount: "paid",
  },
  interregOperations: {
    dates: ["none", "start", "end", "overlap"],
    amounts: ["operationBudget", "operationEu"],
    groups: ["programme", "month", "year"],
    predicates: ["unpublishedBudget", "reversedDates"],
    defaultAmount: "operationBudget",
  },
  interregPartners: {
    dates: ["none", "start", "end", "overlap"],
    amounts: ["partnerBudget", "partnerEu"],
    groups: ["entity", "programme", "place", "month", "year"],
    predicates: [
      "unpublishedBudget",
      "publishedZero",
      "unidentified",
      "unplaced",
      "lead",
      "bulgarian",
      "political",
      "otherFunding",
    ],
    defaultAmount: "partnerBudget",
  },
} satisfies Record<
  FundingCorpus,
  {
    dates: string[];
    amounts: string[];
    groups: string[];
    predicates: string[];
    defaultAmount: string;
  }
>;
export const FUNDING_LABELS = {
  isunProjects: { bg: "Проекти по ИСУН", en: "ISUN projects" },
  agriPayments: {
    bg: "Годишни записи за земеделски субсидии",
    en: "Annual farm-subsidy records",
  },
  interregOperations: { bg: "Операции по Interreg", en: "Interreg operations" },
  interregPartners: {
    bg: "Партньорства по Interreg",
    en: "Interreg partnerships",
  },
};
export const FUNDING_SIGNAL_LABELS: Record<string, { bg: string; en: string }> =
  {
    political: {
      bg: "установена връзка с публична фигура",
      en: "documented public-figure link",
    },
    debarredName: {
      bg: "съвпадение по име със списъка на отстранени доставчици",
      en: "debarred supplier name overlap",
    },
    unidentified: { bg: "без установен ЕИК", en: "without resolved EIK" },
    zeroPaid: {
      bg: "публикувана нулева изплатена сума",
      en: "published zero cumulative paid",
    },
    serialWinner: {
      bg: "бенефициент в повече от една програма",
      en: "beneficiary in multiple programmes",
    },
    otherFunding: {
      bg: "ЕИК присъства и в друг корпус за финансиране",
      en: "EIK present in another funding corpus",
    },
    unpublishedBudget: { bg: "непубликуван бюджет", en: "unpublished budget" },
    publishedZero: {
      bg: "публикуван нулев бюджет",
      en: "published zero budget",
    },
    unplaced: { bg: "неустановено местоположение", en: "unresolved location" },
    lead: { bg: "водещ партньор", en: "lead partner" },
    bulgarian: { bg: "български партньор", en: "Bulgarian partner" },
    reversedDates: {
      bg: "обърнат интервал на датите",
      en: "reversed date interval",
    },
  };

export const FUNDING_STATUSES: Record<FundingCorpus, readonly string[]> = {
  isunProjects: [
    "completed",
    "in-progress",
    "signed",
    "terminated",
    "other",
    "unknown",
  ],
  agriPayments: [],
  interregOperations: ["closed", "ongoing", "other", "unknown"],
  interregPartners: ["closed", "ongoing", "other", "unknown"],
};
export const FUNDING_OPERATION_METRICS: Record<string, readonly string[]> = {
  summary: [
    "records",
    "amount",
    "beneficiaries",
    "organisations",
    "paidRatio",
    "hhi",
    "topShare",
  ],
  count: ["records", "beneficiaries", "organisations"],
  sum: ["amount"],
  share: ["records", "amount", "paidRatio", "topShare"],
  list: ["records", "amount"],
  detail: ["records", "amount"],
  rank: [
    "records",
    "amount",
    "beneficiaries",
    "organisations",
    "paidRatio",
    "hhi",
    "topShare",
  ],
  trend: [
    "records",
    "amount",
    "beneficiaries",
    "organisations",
    "paidRatio",
    "hhi",
    "topShare",
  ],
  compare: [
    "records",
    "amount",
    "beneficiaries",
    "organisations",
    "paidRatio",
    "hhi",
    "topShare",
  ],
  methodology: [
    "records",
    "amount",
    "beneficiaries",
    "organisations",
    "paidRatio",
    "hhi",
    "topShare",
  ],
};
