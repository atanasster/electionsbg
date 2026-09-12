import { describe, expect, it } from "vitest";
import {
  FUNDING_CORPORA,
  FUNDING_CAPABILITIES,
  validateFundingQuery,
  encodeFundingQuery,
  decodeFundingQuery,
} from "./fundingQuery";
const valid = (args: object) => {
  const r = validateFundingQuery(args);
  expect(r.ok).toBe(true);
  if (!r.ok) throw Error(JSON.stringify(r.errors));
  return r.query;
};
describe("funding closed query contract", () => {
  it.each(FUNDING_CORPORA)(
    "%s has an explicit money and date basis",
    (corpus) => {
      const q = valid({ corpus });
      expect(q.amountBasis).toBe(FUNDING_CAPABILITIES[corpus].defaultAmount);
      expect(decodeFundingQuery(encodeFundingQuery(q))).toEqual({
        ok: true,
        query: q,
      });
    },
  );
  it.each([
    { corpus: "isunProjects", from: "2026-01-01" },
    { corpus: "isunProjects", dateBasis: "signed" },
    { corpus: "agriPayments", from: "2026-01-01" },
    { corpus: "interregPartners", amountBasis: "operationBudget" },
    { corpus: "interregOperations", amountBasis: "partnerBudget" },
    { corpus: "agriPayments", financialYears: ["2025-01"] },
    { corpus: "isunProjects", financialYears: ["2025"] },
    { corpus: "agriPayments", programmingPeriods: ["2021-2027"] },
    { corpus: "agriPayments", entityIds: ["1234567890"] },
    { corpus: "isunProjects", numeratorPredicates: ["oneBid"] },
    { corpus: "isunProjects", evil: "DROP TABLE" },
    { corpus: "isunProjects", amountMin: 100, amountMax: 99 },
    {
      corpus: "isunProjects",
      amountMin: 100,
      amountMax: 100,
      amountMaxRelation: "lt",
    },
    { corpus: "isunProjects", amountMinRelation: "gt" },
    { corpus: "isunProjects", amountMin: NaN },
    { corpus: "isunProjects", limit: Infinity },
    { corpus: "isunProjects", limit: 1.5 },
    { corpus: "isunProjects", entityIds: [] },
    { corpus: "isunProjects", keyword: "\ud800" },
    { corpus: "isunProjects", placeIds: ["SFO_CITY"] },
    { corpus: "isunProjects", placeIds: ["SFO_CITY"], placeBasis: "recipient" },
    { corpus: "isunProjects", operation: "rank" },
    { corpus: "isunProjects", operation: "share" },
    { corpus: "isunProjects", operation: "trend" },
    { corpus: "interregOperations", metric: "hhi" },
    { corpus: "interregOperations", metric: "organisations" },
    { corpus: "interregPartners", metric: "paidRatio" },
    {
      corpus: "isunProjects",
      metric: "paidRatio",
      amountBasis: "ownCofinance",
    },
    { corpus: "agriPayments", operation: "compare", financialYears: ["2025"] },
    { corpus: "interregOperations", dateBasis: "start", from: "2026-02-30" },
    { corpus: "interregOperations", dateBasis: "overlap", from: "2026-01-01" },
    { corpus: "isunProjects", version: "future" },
    {
      corpus: "isunProjects",
      entityIds: Array.from({ length: 201 }, () => "123456789"),
    },
  ])("rejects unsupported or malformed scope %j", (args) =>
    expect(validateFundingQuery(args).ok).toBe(false),
  );
  it("keeps programming and event periods independent", () => {
    const q = valid({
      corpus: "interregOperations",
      programmingPeriods: ["2021-2027"],
      dateBasis: "start",
      from: "2026-01-01",
      toExclusive: "2027-01-01",
    });
    expect(q.programmingPeriods).toEqual(["2021-2027"]);
    expect(q.from).toBe("2026-01-01");
  });
  it("canonicalizes sets, explicit ratios and financial-year comparisons", () => {
    const q = valid({
      corpus: "agriPayments",
      operation: "compare",
      financialYears: ["2025", "2024", "2025"],
      compareFinancialYears: ["2023"],
    });
    expect(q.financialYears).toEqual(["2024", "2025"]);
    expect(
      valid({
        corpus: "isunProjects",
        operation: "share",
        metric: "paidRatio",
        amountBasis: "grant",
      }).amountBasis,
    ).toBe("grant");
  });
  it("preserves separate Boolean denominator and numerator clauses", () => {
    const q = valid({
      corpus: "isunProjects",
      operation: "share",
      basePredicates: ["!political"],
      numeratorPredicates: ["zeroPaid", "debarredName"],
      numeratorMode: "any",
    });
    expect(q.basePredicates).toEqual(["!political"]);
    expect(q.numeratorMode).toBe("any");
  });
  it("bounds parent queries and never turns malformed parents into all records", () => {
    const parent = valid({
      corpus: "interregOperations",
      programmingPeriods: ["2021-2027"],
      limit: 1,
    });
    const child = valid({
      corpus: "interregPartners",
      relationship: "operationsToPartners",
      parentQuery: encodeFundingQuery(parent),
    });
    expect(decodeFundingQuery(child.parentQuery!)).toEqual({
      ok: true,
      query: parent,
    });
    expect(validateFundingQuery({ ...child, parentQuery: "broken" }).ok).toBe(
      false,
    );
    expect(
      validateFundingQuery({
        ...parent,
        relationship: "partnersToOperations",
        parentQuery: encodeFundingQuery(child),
      }).ok,
    ).toBe(false);
    expect(
      validateFundingQuery({ ...child, parentQuery: "x".repeat(8001) }).ok,
    ).toBe(false);
  });
  it("rejects hostile keys and invalid encodings", () => {
    expect(
      validateFundingQuery(
        JSON.parse('{"corpus":"isunProjects","__proto__":{"x":1}}'),
      ).ok,
    ).toBe(false);
    expect(decodeFundingQuery("%E0%A4%A").ok).toBe(false);
    expect(decodeFundingQuery("x".repeat(16001)).ok).toBe(false);
  });
});
it("canonical parent expansion cannot break an accepted child's round-trip", () => {
  for (let n = 95; n <= 120; n++) {
    const rawParent = {
      corpus: "interregOperations",
      programmeIds: Array.from({ length: n }, (_, i) => "x".repeat(55) + i),
    };
    const child = validateFundingQuery({
      corpus: "interregPartners",
      relationship: "operationsToPartners",
      parentQuery: encodeURIComponent(JSON.stringify(rawParent)),
    });
    if (child.ok)
      expect(decodeFundingQuery(encodeFundingQuery(child.query))).toEqual(
        child,
      );
  }
});
it.each(["entity", "scheme", "place"])(
  "trend rejects non-time axis %s",
  (groupBy) => {
    expect(
      validateFundingQuery({
        corpus: "agriPayments",
        operation: "trend",
        groupBy,
      }).ok,
    ).toBe(false);
  },
);
it("operation-aware defaults and explicit metric compatibility", () => {
  expect(valid({ corpus: "isunProjects", operation: "sum" }).metric).toBe(
    "amount",
  );
  for (const metric of ["paidRatio", "hhi", "amount"])
    expect(
      validateFundingQuery({
        corpus: "isunProjects",
        operation: "count",
        metric,
      }).ok,
    ).toBe(false);
  expect(
    valid({
      corpus: "agriPayments",
      operation: "trend",
      groupBy: "financialYear",
    }).groupBy,
  ).toBe("financialYear");
  expect(
    valid({
      corpus: "interregOperations",
      operation: "trend",
      dateBasis: "start",
      groupBy: "year",
    }).groupBy,
  ).toBe("year");
  expect(
    validateFundingQuery({
      corpus: "isunProjects",
      operation: "list",
      metric: "hhi",
    }).ok,
  ).toBe(false);
});
it("status filters use the actual corpus vocabulary", () => {
  expect(
    validateFundingQuery({ corpus: "agriPayments", statusIds: ["completed"] })
      .ok,
  ).toBe(false);
  expect(
    validateFundingQuery({
      corpus: "interregOperations",
      statusIds: ["completed"],
    }).ok,
  ).toBe(false);
  expect(
    validateFundingQuery({ corpus: "isunProjects", statusIds: ["bogus"] }).ok,
  ).toBe(false);
  expect(
    valid({ corpus: "isunProjects", statusIds: ["in-progress", "unknown"] })
      .statusIds,
  ).toEqual(["in-progress", "unknown"]);
});
