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
