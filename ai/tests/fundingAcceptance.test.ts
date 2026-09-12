import { expect, it } from "vitest";
import { understandFunding } from "../orchestrator/fundingUnderstanding";
import { validateFundingQuery } from "../../src/lib/fundingQuery";
import { fundingQuestion } from "../tools/funding";
import { setDbFetcher, clearDataCache } from "../tools/dataClient";
import { afterEach, vi } from "vitest";
afterEach(clearDataCache);
const ctx = { lang: "en" as const, election: "1990" };
it.each([
  ["A01", "ISUN agreements signed in 2026"],
  ["A05", "ISUN payments during 2026"],
  ["A07", "Farm subsidies from 04/2025 to 01/2026"],
  ["D03", "ISUN beneficiaries headquartered in Ruse municipality"],
  ["D10", "ISUN grant per capita"],
  ["E10", "ISUN projects with one bidder"],
])("%s unavailable basis never executes analytics", async (_id, question) => {
  const fetcher = vi.fn();
  setDbFetcher(fetcher);
  const e = await fundingQuestion({ question }, ctx);
  expect(e.facts.status).toBe("unsupported");
  expect(fetcher).not.toHaveBeenCalled();
});
it("A02 programming period AND explicit observation window stay independent", () => {
  const r = understandFunding(
    "ISUN programmes 2021–2027 first observed in 2026",
  );
  expect(r).toMatchObject({
    kind: "query",
    query: {
      programmingPeriods: ["2021-2027"],
      from: "2026-01-01",
      toExclusive: "2027-01-01",
      dateBasis: "observed",
    },
  });
});
it("A03 unresolved ISUN event basis retains the requested month boundaries", () => {
  expect(understandFunding("ISUN from 04/2025 to 01/2026")).toMatchObject({
    kind: "clarification",
    draft: { from: "2025-04-01", toExclusive: "2026-02-01" },
  });
});
it("A04 missing signing enrichment stays unadvertisable at schema boundary", () =>
  expect(
    validateFundingQuery({
      corpus: "isunProjects",
      dateBasis: "signed",
      from: "2026-01-01",
      toExclusive: "2027-01-01",
    }).ok,
  ).toBe(false));
it("A08 Interreg period clarification retains amount and full window in every choice", () => {
  const r = understandFunding("Interreg in 2026 above 100 EUR");
  expect(r.kind).toBe("clarification");
  if (r.kind === "clarification") {
    expect(r.options).toHaveLength(3);
    for (const o of r.options!)
      expect(o.query).toMatchObject({
        from: "2026-01-01",
        toExclusive: "2027-01-01",
        amountMin: 100,
      });
  }
});
it("A10 latest available financial year is pinned from coverage, not current clock", () => {
  expect(
    understandFunding("Farm subsidies latest available year", {
      catalog: { financialYears: ["2021", "2025"] },
      now: new Date("2030-01-01"),
    }),
  ).toMatchObject({ kind: "query", query: { financialYears: ["2025"] } });
});
it("B01 duplicate programme names retain place and amount in choices", () => {
  const r = understandFunding(
    'ISUN programme "Same" grant above 100 EUR in municipality Burgas',
    {
      catalog: {
        programmes: [
          {
            code: "P1",
            label_bg: "Same",
            period: "2014-2020",
            corpus: "isunProjects",
          },
          {
            code: "P2",
            label_bg: "Same",
            period: "2021-2027",
            corpus: "isunProjects",
          },
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
      expect(o.query).toMatchObject({ placeIds: ["BGS04"], amountMin: 100 });
  }
});
it("B03 ambiguous scheme aliases never merge or select a money-ranked winner", () => {
  const r = understandFunding('Farm subsidies scheme "Same" in 2025', {
    catalog: {
      schemes: [
        { code: "S1", label: "Same" },
        { code: "S2", label: "Same" },
      ],
    },
  });
  expect(r.kind).toBe("clarification");
  if (r.kind === "clarification")
    expect(r.options?.map((o) => o.query.schemeIds)).toEqual([["S1"], ["S2"]]);
});
it("B06 ten-digit personal identifiers cannot become EIK scope", () =>
  expect(
    validateFundingQuery({ corpus: "agriPayments", entityIds: ["1234567890"] })
      .ok,
  ).toBe(false));
it.each([
  [
    "B09",
    "Show ISUN programme P1 road projects with project cost above 1 million EUR",
    {
      programmeIds: ["P1"],
      themeIds: ["roads"],
      amountBasis: "projectCost",
      amountMin: 1000000,
      amountMinRelation: "gt",
    },
  ],
  ["B10", "ISUN RRP projects", { fundingMechanisms: ["RRP"] }],
  ["B10", "ISUN EEA Norway projects", { fundingMechanisms: ["EEA-Norway"] }],
  [
    "C07",
    "ISUN grant above 1\u00a0000 EUR",
    { amountMin: 1000, amountMinRelation: "gt" },
  ],
  [
    "C09",
    "What share of grant value in ISUN has political links?",
    {
      operation: "share",
      metric: "amount",
      denominator: "amount",
      numeratorPredicates: ["political"],
    },
  ],
])("%s preserves explicit dimensions: %s", (_id, text, expected) => {
  const r = understandFunding(text);
  expect(r.kind).toBe("query");
  if (r.kind === "query") expect(r.query).toMatchObject(expected);
});
it("I02 unknown fields and SQL payloads cannot select a different query structure", () => {
  for (const q of [
    { corpus: "isunProjects", sql: "DROP TABLE fund_projects" },
    { corpus: "isunProjects", schemeIds: ["S1"] },
    { corpus: "agriPayments", financialYears: ["2025 OR TRUE"] },
  ])
    expect(validateFundingQuery(q).ok).toBe(false);
});
it("I09 unknown client version is rejected before any broad fallback", () =>
  expect(
    validateFundingQuery({ corpus: "isunProjects", version: "future" }).ok,
  ).toBe(false));
it("E03 debarred evidence is labeled name overlap rather than verified identity", async () => {
  const { fundingScope } = await import("../tools/funding");
  const p = validateFundingQuery({
    corpus: "isunProjects",
    basePredicates: ["debarredName"],
  });
  if (!p.ok) throw Error();
  expect(fundingScope(p.query, ctx)).toContain("name overlap");
});
