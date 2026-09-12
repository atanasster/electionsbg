import { beforeEach, expect, it, vi } from "vitest";
const fetchDb = vi.hoisted(() => vi.fn());
vi.mock("./dataClient", () => ({ fetchDb }));
import { procurementQuery, procurementQuestion } from "./procurement";
const ctx = { lang: "en" as const, election: "2024_06_09" };
beforeEach(() => fetchDb.mockReset());
it("renders the scoped numerator and denominator", async () => {
  fetchDb.mockResolvedValue({
    status: "success",
    totals: { records: 6, numerator: 3, positive_known: 4, evaluable: 4 },
  });
  const env = await procurementQuery(
    {
      corpus: "contracts",
      operation: "share",
      metric: "oneBid",
      from: "2026-01-01",
      toExclusive: "2027-01-01",
      denominator: "positiveKnown",
    },
    ctx,
  );
  expect(env.value).toBe(75);
  expect(env.facts).toMatchObject({ numerator: 3, denominator: 4 });
  expect(JSON.parse(fetchDb.mock.calls[0][1].query)).toMatchObject({
    from: "2026-01-01",
    denominator: "positiveKnown",
  });
});
it("does not turn all-unknown risk observations into zero percent", async () => {
  fetchDb.mockResolvedValue({
    status: "partial",
    totals: { records: 6, numerator: 0, evaluable: 0 },
  });
  const env = await procurementQuery(
    {
      corpus: "contracts",
      operation: "share",
      metric: "risk",
      numeratorPredicates: ["risk:weakCompetition"],
    },
    ctx,
  );
  expect(env.value).toBeUndefined();
  expect(env.facts?.answer).toContain("Insufficient");
});
it("clarification and invalid saved scope do not query the database", async () => {
  const env = await procurementQuestion(
    { question: "Contracts in healthcare in 2026" },
    ctx,
  );
  expect(env.clarify?.options).toHaveLength(2);
  const invalid = await procurementQuestion(
    { question: "And 2025?", previous: "broken" },
    ctx,
  );
  expect(invalid.facts?.answer).toContain("cannot be restored");
  expect(fetchDb).not.toHaveBeenCalled();
});

it.each([
  ["value", { value_eur: 200 }, { value_eur: 350 }, 200, 350],
  [
    "oneBid",
    { numerator: 2, records: 4 },
    { numerator: 3, records: 4 },
    50,
    75,
  ],
  ["cri", { mean_cri: 25 }, { mean_cri: 40 }, 25, 40],
  ["riskCount", { mean_risk_count: 2 }, { mean_risk_count: 3 }, 2, 3],
] as const)(
  "comparison renders coherent %s values",
  async (metric, left, right, a, b) => {
    fetchDb.mockResolvedValue({
      status: "success",
      totals: { records: 4, numerator: 0, ...left },
      comparison: { records: 4, numerator: 0, ...right },
    });
    const env = await procurementQuery(
      {
        corpus: "contracts",
        operation: "compare",
        metric,
        from: "2025-01-01",
        toExclusive: "2026-01-01",
        compareFrom: "2026-01-01",
        compareToExclusive: "2027-01-01",
      },
      ctx,
    );
    expect(env.rows?.map((r) => r.value)).toEqual([a, b]);
    expect(env.value).toBe(a);
  },
);
it("methodology retains its canonical scope without fetching", async () => {
  const env = await procurementQuery(
    {
      corpus: "contracts",
      operation: "methodology",
      metric: "oneBid",
      from: "2026-01-01",
    },
    ctx,
  );
  expect(env.procurement?.query.from).toBe("2026-01-01");
  expect(fetchDb).not.toHaveBeenCalled();
});
it("implicit monthly trend projects its selected ratio", async () => {
  fetchDb.mockResolvedValue({
    status: "success",
    totals: { records: 4, numerator: 2 },
    groups: [
      { group_key: "2026-01", records: 4, numerator: 2, positive_known: 3 },
    ],
  });
  const env = await procurementQuery(
    {
      corpus: "contracts",
      operation: "trend",
      metric: "oneBid",
      denominator: "positiveKnown",
    },
    ctx,
  );
  expect(env.rows?.[0].measure).toBeCloseTo(200 / 3);
  expect(env.rows?.[0].denominator).toBe(3);
});
it("empty groups stay empty even with raw rows", async () => {
  fetchDb.mockResolvedValue({
    status: "success",
    totals: { records: 4, numerator: 2 },
    groups: [],
    rows: [{ key: "raw" }],
  });
  const env = await procurementQuery(
    { corpus: "contracts", operation: "rank", groupBy: "buyer" },
    ctx,
  );
  expect(env.rows).toEqual([]);
});
it("G10 executes two bounded queries with distinct scope and status", async () => {
  fetchDb
    .mockResolvedValueOnce({
      status: "success",
      totals: { records: 6, numerator: 6 },
    })
    .mockResolvedValueOnce({ status: "unavailable" });
  const env = await procurementQuestion(
    { question: "Колко договори през 2025? Колко жалби по ЗОП през 2026?" },
    ctx,
  );
  expect(env.procurementBundle?.map((p) => p.query.corpus)).toEqual([
    "contracts",
    "appeals",
  ]);
  expect(env.procurementBundle?.map((p) => p.result.status)).toEqual([
    "success",
    "unavailable",
  ]);
  expect(fetchDb).toHaveBeenCalledTimes(2);
});

it("negated recorded outcome never executes its positive filter", async () => {
  await procurementQuestion(
    { question: "Покажи жалби по ЗОП без отказан изход през 2026" },
    ctx,
  );
  expect(fetchDb).not.toHaveBeenCalled();
});
