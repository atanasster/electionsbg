import {
  encodeFundingQuery,
  validateFundingQuery,
  type FundingQuery,
  type FundingArgs,
} from "./fundingQuery";
export const FUNDING_FOLLOWUPS = [
  ["P01", "А само за здравеопазването?", "And healthcare only?"],
  ["P02", "Не 2025, а 2026.", "Not 2025, but 2026."],
  ["P03", "А по програми?", "And by programme?"],
  ["P04", "А по схеми?", "And by scheme?"],
  ["P05", "Само безвъзмездната помощ.", "Grant value only."],
  ["P06", "А реално изплатеното?", "And what has actually been paid?"],
  ["P07", "Покажи съответстващите записи.", "Show matching records."],
  [
    "P08",
    "Без установените политически връзки.",
    "Exclude documented political links.",
  ],
  ["P09", "Само българските партньори.", "Bulgarian partners only."],
  [
    "P10",
    "А общият бюджет на тези операции?",
    "And the whole budget of these operations?",
  ],
  [
    "P11",
    "Покажи обществените поръчки на тези бенефициенти.",
    "Show these beneficiaries' procurement contracts.",
  ],
  ["P12", "Само в община Русе.", "Ruse municipality only."],
  [
    "P13",
    "Сравни с предходната финансова година.",
    "Compare with the previous financial year.",
  ],
  [
    "P14",
    "Обясни знаменателя и липсващите данни.",
    "Explain the denominator and missing data.",
  ],
  [
    "P15",
    "Има ли отворен прием за такъв проект?",
    "Is there an open call for such a project?",
  ],
  [
    "P16",
    "Покажи отделно ИСУН и Interreg за същата община.",
    "Show ISUN and Interreg separately for the same municipality.",
  ],
] as const;
export function fundingContinuation(
  question: string,
  previous: FundingQuery,
): { query?: FundingQuery; reason?: string; id: string } | null {
  const norm = (s: string) => s.toLowerCase().replace(/[?.]/g, "").trim();
  const item = FUNDING_FOLLOWUPS.find(([, bg, en]) =>
    [bg, en].some((t) => norm(t) === norm(question)),
  );
  if (!item) return null;
  const id = item[0],
    q: FundingArgs = { ...previous, offset: 0 };
  delete q.expectedRevision;
  const error = (reason: string) => ({ id, reason });
  if (["P01", "P11", "P15", "P16"].includes(id)) return error(id);
  if (id === "P02") {
    if (q.corpus === "agriPayments") {
      q.financialYears = ["2026"];
      delete q.compareFinancialYears;
    } else if (q.from && q.toExclusive) {
      q.from = "2026-01-01";
      q.toExclusive = "2027-01-01";
      delete q.compareFrom;
      delete q.compareToExclusive;
    } else return error("period");
    if (q.operation === "compare") q.operation = "summary";
  }
  if (id === "P03" || id === "P04") {
    q.groupBy = id === "P03" ? "programme" : "scheme";
    q.operation = "rank";
  }
  if (id === "P05" || id === "P06") {
    q.amountBasis = id === "P05" ? "grant" : "paid";
    q.metric = "amount";
    q.operation = "sum";
    delete q.numeratorPredicates;
    delete q.numeratorMode;
    delete q.denominator;
  }
  if (id === "P07") {
    q.operation = "list";
    q.metric = "records";
    delete q.groupBy;
    delete q.compareFrom;
    delete q.compareToExclusive;
    delete q.compareFinancialYears;
  }
  if (id === "P08") {
    if (
      q.baseMode === "any" &&
      (q.basePredicates as string[] | undefined)?.length
    )
      return error("predicate_boolean");
    q.basePredicates = [
      ...((q.basePredicates as string[]) || []).filter(
        (p) => !["political", "!political"].includes(p),
      ),
      "!political",
    ];
    q.baseMode = "all";
  }
  if (id === "P09" || id === "P10") {
    if (
      previous.parentQuery ||
      previous.corpus !==
        (id === "P09" ? "interregOperations" : "interregPartners")
    )
      return error("relationship");
    const p = validateFundingQuery({
      corpus: id === "P09" ? "interregPartners" : "interregOperations",
      operation: id === "P09" ? "list" : "sum",
      metric: id === "P09" ? "records" : "amount",
      parentQuery: encodeFundingQuery(previous),
      relationship:
        id === "P09" ? "operationsToPartners" : "partnersToOperations",
      ...(id === "P09" ? { basePredicates: ["bulgarian"] } : {}),
    });
    return p.ok ? { id, query: p.query } : error("relationship");
  }
  if (id === "P12") {
    if (q.corpus === "agriPayments") return error("geography");
    q.placeIds = ["RSE27"];
    q.placeBasis = q.corpus === "isunProjects" ? "implementation" : "partner";
  }
  if (id === "P13") {
    if (
      q.corpus !== "agriPayments" ||
      (q.financialYears as string[] | undefined)?.length !== 1
    )
      return error("period");
    q.compareFinancialYears = [
      String(Number((q.financialYears as string[])[0]) - 1),
    ];
    q.operation = "compare";
  }
  if (id === "P14") q.operation = "methodology";
  const p = validateFundingQuery(q);
  return p.ok ? { id, query: p.query } : error("incompatible_scope");
}
