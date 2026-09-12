import { afterEach, expect, it, vi } from "vitest";
import { fundingQuery, fundingQuestion, fundingScope } from "./funding";
import { clearDataCache, setDbFetcher } from "./dataClient";
import { validateFundingQuery } from "../../src/lib/fundingQuery";
afterEach(clearDataCache);
const ctx = { lang: "en" as const, election: "1990" };
it("rejects a server that drops scope", async () => {
  setDbFetcher(async () => ({
    status: "success",
    query: { corpus: "agriPayments" },
    totals: { amount: 100 },
  }));
  const e = await fundingQuery(
    { corpus: "agriPayments", financialYears: ["2025"] },
    ctx,
  );
  expect(e.facts.status).toBe("unavailable");
  expect(e.funding?.query.financialYears).toEqual(["2025"]);
  expect(e.funding?.result.status).toBe("unavailable");
});
it("retains unavailable scope and never fabricates zero", async () => {
  setDbFetcher(async (_r, p) => ({
    status: "unavailable",
    reason: "financial_year_unavailable",
    query: JSON.parse(String(p.query)),
  }));
  const e = await fundingQuery(
    { corpus: "agriPayments", financialYears: ["2019"] },
    ctx,
  );
  expect(e.funding?.query.financialYears).toEqual(["2019"]);
  expect(e.facts.answer).toBe("financial_year_unavailable");
  expect(e.facts.amount).toBe("unknown");
});
it("clarifies unsupported dates without fetching unrelated source catalogs", async () => {
  const fetcher = vi.fn();
  setDbFetcher(fetcher);
  const e = await fundingQuestion({ question: "ISUN signed in 2026" }, ctx);
  expect(e.facts.status).toBe("unsupported");
  expect(fetcher).not.toHaveBeenCalled();
});
it("restores ambiguous company options with money constraints", async () => {
  setDbFetcher(async (route) =>
    route === "funding-catalog"
      ? {}
      : [
          { eik: "111111111", name: "Same" },
          { eik: "222222222", name: "Same" },
        ],
  );
  const e = await fundingQuestion(
    { question: 'ISUN company "Same" grant above 100 EUR' },
    ctx,
  );
  expect(e.clarify?.options).toHaveLength(2);
  for (const o of e.clarify!.options) {
    expect(o.args.amountMin).toBe(100);
    expect(validateFundingQuery(o.args).ok).toBe(true);
  }
});
it("retains both scopes when a bundle has a transport failure", async () => {
  setDbFetcher(async (_r, p) => {
    const q = JSON.parse(String(p.query));
    if (q.financialYears[0] === "2025") throw Error("offline");
    return { status: "success", query: q, totals: { amount: 200 } };
  });
  const e = await fundingQuestion(
    {
      question:
        "How much farm subsidies in 2025? How much farm subsidies in 2026?",
    },
    ctx,
  );
  expect(e.fundingBundle).toHaveLength(2);
  expect(e.fundingBundle?.map((x) => x.query.financialYears)).toEqual([
    ["2025"],
    ["2026"],
  ]);
  expect(e.fundingBundle?.[0].result.status).toBe("unavailable");
});
it("narrates both comparison periods and full material scope", async () => {
  setDbFetcher(async (_r, p) => ({
    status: "success",
    query: JSON.parse(String(p.query)),
    totals: { records: 10, amount: 100, known_amount: 10 },
    comparisons: [
      { cohort_window: "current", amount: 100 },
      { cohort_window: "comparison", amount: 200 },
    ],
  }));
  const e = await fundingQuery(
    {
      corpus: "agriPayments",
      operation: "compare",
      metric: "amount",
      financialYears: ["2025"],
      compareFinancialYears: ["2026"],
      entityClass: "legal",
      amountMin: 10,
      amountMinRelation: "gt",
    },
    ctx,
  );
  expect(e.facts.answer).toContain("100 EUR");
  expect(e.facts.answer).toContain("200 EUR");
  expect(e.subtitle).toContain("2026");
  expect(e.subtitle).toContain("legal entities");
  expect(e.subtitle).toContain("> 10 EUR");
});
it("renders signal numerator, denominator and evidence coverage", async () => {
  setDbFetcher(async (_r, p) => ({
    status: "partial",
    query: JSON.parse(String(p.query)),
    totals: {
      records: 10,
      evaluable: 8,
      numerator_records: 2,
      share: 25,
      known_amount: 9,
    },
  }));
  const e = await fundingQuery(
    {
      corpus: "isunProjects",
      operation: "share",
      numeratorPredicates: ["political"],
      denominator: "evaluable",
    },
    ctx,
  );
  expect(e.facts.coverage_note).toContain("2 / 8");
  expect(e.facts.coverage_note).toContain("8/10");
  expect(fundingScope(e.funding!.query, ctx)).toContain(
    "records with known evidence",
  );
});
