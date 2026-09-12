import { expect, it } from "vitest";
import { understandFunding } from "./fundingUnderstanding";
import { route } from "./router";
import { parseModelRoute } from "./routeScope";
const ctx = { lang: "bg" as const, election: "1990" };
const cases: [string, Record<string, unknown>][] = [
  [
    "Колко проекта по ИСУН има по програми 2021–2027?",
    {
      corpus: "isunProjects",
      programmingPeriods: ["2021-2027"],
      operation: "count",
    },
  ],
  [
    "How many ISUN projects are in 2021–2027 programmes?",
    {
      corpus: "isunProjects",
      programmingPeriods: ["2021-2027"],
      operation: "count",
    },
  ],
  [
    "Show ISUN road projects with project cost above 1 million EUR",
    {
      corpus: "isunProjects",
      themeIds: ["roads"],
      amountMin: 1000000,
      amountMinRelation: "gt",
      amountBasis: "projectCost",
      operation: "list",
    },
  ],
  [
    "Какъв е размерът на безвъзмездната помощ за проекти за здравеопазване по ИСУН?",
    {
      corpus: "isunProjects",
      themeIds: ["health"],
      amountBasis: "grant",
      operation: "sum",
    },
  ],
  [
    "Which ISUN beneficiaries have the largest grants?",
    {
      corpus: "isunProjects",
      operation: "rank",
      groupBy: "entity",
      metric: "amount",
    },
  ],
  [
    "Какъв е делът на изплатеното спрямо безвъзмездната помощ по програми в ИСУН?",
    {
      corpus: "isunProjects",
      operation: "share",
      metric: "paidRatio",
      groupBy: "programme",
      amountBasis: "grant",
    },
  ],
  [
    "How much in farm subsidies was paid for financial year 2025?",
    {
      corpus: "agriPayments",
      financialYears: ["2025"],
      operation: "sum",
      amountBasis: "paid",
    },
  ],
  [
    "Земеделски субсидии за ЕИК 111111111 за 2025",
    {
      corpus: "agriPayments",
      financialYears: ["2025"],
      entityIds: ["111111111"],
    },
  ],
  [
    "Compare farm subsidies 2025 versus 2026",
    {
      corpus: "agriPayments",
      operation: "compare",
      financialYears: ["2025"],
      compareFinancialYears: ["2026"],
    },
  ],
  [
    "Farm subsidies for 2021-2025",
    {
      corpus: "agriPayments",
      financialYears: ["2021", "2022", "2023", "2024", "2025"],
    },
  ],
  [
    "Interreg operations active from 04/2025 to 01/2026",
    {
      corpus: "interregOperations",
      dateBasis: "overlap",
      from: "2025-04-01",
      toExclusive: "2026-02-01",
    },
  ],
  [
    "Show Bulgarian partners in Interreg for 2021-2027",
    {
      corpus: "interregPartners",
      basePredicates: ["bulgarian"],
      programmingPeriods: ["2021-2027"],
      operation: "list",
    },
  ],
  [
    "Show Interreg partners with unpublished budgets",
    {
      corpus: "interregPartners",
      basePredicates: ["unpublishedBudget"],
      operation: "list",
    },
  ],
  [
    "Interreg operations starting in 2026",
    {
      corpus: "interregOperations",
      dateBasis: "start",
      from: "2026-01-01",
      toExclusive: "2027-01-01",
    },
  ],
  [
    "Interreg operations ending in 2026",
    {
      corpus: "interregOperations",
      dateBasis: "end",
      from: "2026-01-01",
      toExclusive: "2027-01-01",
    },
  ],
  [
    "ISUN projects first observed in 2026",
    {
      corpus: "isunProjects",
      dateBasis: "observed",
      from: "2026-01-01",
      toExclusive: "2027-01-01",
    },
  ],
];
it.each(cases)("captures %s", (text, expected) => {
  const r = understandFunding(text);
  expect(r.kind).toBe("query");
  if (r.kind === "query") expect(r.query).toMatchObject(expected);
});
it.each([
  "Колко договора по ИСУН са подписани през 2026?",
  "Farm subsidies from 04/2025 to 01/2026",
  "Interreg in 2026",
  "Interreg signed in 2026",
  "Farm subsidies in calendar 2025",
  "Risky ISUN projects",
  "Subsidies in 2025",
  "ISUN healthcare and road projects",
])("clarifies unsupported or ambiguous scope: %s", (q) =>
  expect(understandFunding(q).kind).toBe("clarification"),
);
it.each([
  "Film subsidies in 2025",
  "Municipal transfers 2025",
  "Open calls for EU funding I can apply for",
  "Procurement with EU funding in 2026",
  "Pensions in 2025",
])("preserves another domain: %s", (q) =>
  expect(understandFunding(q).kind).toBe("none"),
);
it("uses actual clock rather than election for financial years", () => {
  const r = understandFunding("farm subsidies last year", {
    now: new Date("2026-09-12T12:00:00Z"),
  });
  expect(r.kind === "query" && r.query.financialYears).toEqual(["2025"]);
});
it("retains year, scheme and amount while resolving duplicate names", () => {
  const r = understandFunding('ISUN company "Same" grant above 100 EUR', {
    catalog: {
      entities: [
        { eik: "111111111", name: "Same" },
        { eik: "222222222", name: "Same" },
      ],
    },
  });
  expect(r.kind).toBe("clarification");
  if (r.kind === "clarification")
    expect(r.options?.map((o) => o.query.amountMin)).toEqual([100, 100]);
});
it("overrides a model-selected national aggregate with captured constraints", () => {
  const question =
    "Show ISUN road projects with project cost above 1 million EUR";
  const expected = route(question, ctx);
  expect(
    parseModelRoute(
      JSON.stringify({ tool: "fundsOverview", args: {} }),
      question,
    ),
  ).toEqual(expected);
  expect(expected?.tool).toBe("fundingQuery");
});
it("no unsupported date can fall back to a national aggregate", () =>
  expect(
    parseModelRoute(
      JSON.stringify({ tool: "fundsOverview", args: {} }),
      "ISUN signed in 2026",
    )?.tool,
  ).toBe("fundingQuestion"));
it.each([
  "ISUN projects above 100 BGN",
  "ISUN projects above 100",
  "ISUN Q1 2026",
  "Farm subsidies last 12 months",
  "ISUN company Unknown grant above 100 EUR",
  "ISUN programme Unknown",
  "ISUN MP-linked grants",
])("never drops an unsupported explicit modifier: %s", (q) =>
  expect(understandFunding(q).kind).toBe("clarification"),
);
it("a bounded two-source bundle cannot recurse on alternative source aliases", () =>
  expect(understandFunding("ISUN and CAP payments").kind).toBe("bundle"));
it("captures current status and legal population", () => {
  const r = understandFunding(
    "Show completed ISUN projects for legal entities",
  );
  expect(r.kind === "query" && r.query).toMatchObject({
    statusIds: ["completed"],
    entityClass: "legal",
  });
});
it.each([
  [
    "What share of ISUN projects are unpaid among projects without political links?",
    { basePredicates: ["!political"], numeratorPredicates: ["zeroPaid"] },
  ],
  [
    "Show completed or terminated ISUN projects",
    { statusIds: ["completed", "terminated"] },
  ],
  [
    "ISUN grant above EUR 1 000 and below 2 000 EUR",
    {
      amountMin: 1000,
      amountMax: 2000,
      amountMinRelation: "gt",
      amountMaxRelation: "lt",
    },
  ],
  [
    "ISUN first observed in 2025 and 2026",
    { from: "2025-01-01", toExclusive: "2027-01-01" },
  ],
  ["Farm subsidies not 2025 but 2026", { financialYears: ["2026"] }],
  ["Земеделски субсидии не 2025, а 2026", { financialYears: ["2026"] }],
])("preserves compound scope: %s", (text, expected) => {
  const r = understandFunding(text);
  expect(r.kind).toBe("query");
  if (r.kind === "query") expect(r.query).toMatchObject(expected);
});
it.each([
  "Show not completed ISUN projects",
  "ISUN grant above 100 EUR and below 500 BGN",
  "ISUN first observed in 2023 and 2026",
  "Interreg active from 00/2025 to 01/2026",
  "Interreg healthcare and road projects",
  "ISUN healthcare beneficiaries",
  "How many ISUN projects and how much farm subsidies in 2025?",
])("does not simplify compound ambiguity: %s", (text) =>
  expect(understandFunding(text).kind).toBe("clarification"),
);
it("separates questions even for the same source and enforces two-query cap", () => {
  const first = "How many farm subsidy records in 2025?";
  const second = "How much farm subsidies in 2026?";
  const r = understandFunding(`${first} ${second}`);
  expect(r.kind).toBe("bundle");
  if (r.kind === "bundle")
    expect(r.queries).toMatchObject([
      { operation: "count", financialYears: ["2025"] },
      { operation: "sum", financialYears: ["2026"] },
    ]);
  expect(understandFunding(`${first} ${second} ${first}`)).toMatchObject({
    kind: "clarification",
    reason: "bundle_limit",
  });
});
it("captures filters after an ambiguous name in every executable choice", () => {
  const r = understandFunding(
    'Show completed ISUN company "Same" in municipality Burgas for legal entities grant above 100 EUR',
    {
      catalog: {
        entities: [
          { eik: "111111111", name: "Same" },
          { eik: "222222222", name: "Same" },
        ],
        places: [
          {
            id: "BGS04",
            name: "Бургас",
            name_en: "Burgas",
            level: "municipality",
          },
        ],
      },
    },
  );
  expect(r.kind).toBe("clarification");
  if (r.kind === "clarification") {
    expect(r.options).toHaveLength(2);
    for (const o of r.options!)
      expect(o.query).toMatchObject({
        placeIds: ["BGS04"],
        entityClass: "legal",
        statusIds: ["completed"],
        amountMin: 100,
      });
  }
});
it("resets dependent metrics when the user changes the question", () => {
  const first = understandFunding("ISUN paid grant ratio");
  if (first.kind !== "query") throw Error("query expected");
  const r = understandFunding("grant value only", { previous: first.query });
  expect(r.kind === "query" && r.query).toMatchObject({
    operation: "sum",
    metric: "amount",
    amountBasis: "grant",
  });
  const count = understandFunding("How many ISUN projects?");
  if (count.kind !== "query") throw Error("query expected");
  expect(
    understandFunding("largest grants", { previous: count.query }),
  ).toMatchObject({
    kind: "query",
    query: { operation: "rank", metric: "amount" },
  });
});
