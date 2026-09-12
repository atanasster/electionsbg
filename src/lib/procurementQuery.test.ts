import { describe, expect, it } from "vitest";
import {
  decodeProcurementQuery,
  encodeProcurementQuery,
  isProcurementDate,
  procurementQueryKey,
  validateProcurementQuery,
  PROCUREMENT_CORPORA,
  PROCUREMENT_RISKS,
} from "./procurementQuery";

describe("closed procurement query contract", () => {
  const metricOracle = {
    contracts: [
      "records",
      "value",
      "oneBid",
      "riskCount",
      "cri",
      "appealed",
      "upheld",
      "suspended",
      "risk",
    ],
    amendments: [
      "records",
      "value",
      "oneBid",
      "riskCount",
      "cri",
      "appealed",
      "upheld",
      "suspended",
      "risk",
    ],
    tenders: [
      "records",
      "value",
      "riskCount",
      "appealed",
      "upheld",
      "suspended",
      "risk",
    ],
    appeals: ["records", "appealed", "upheld", "suspended"],
    decisions: ["records", "upheld", "suspended"],
  };
  for (const corpus of PROCUREMENT_CORPORA)
    for (const metric of metricOracle.contracts) {
      it(`${corpus}/${metric} has explicitly specified support`, () => {
        const extra =
          metric === "risk"
            ? {
                numeratorPredicates: [
                  corpus === "tenders"
                    ? "risk:nonOpenProcedure"
                    : "risk:debarred",
                ],
              }
            : {};
        expect(validateProcurementQuery({ corpus, metric, ...extra }).ok).toBe(
          metricOracle[corpus].includes(metric),
        );
      });
    }
  it.each([
    "2026-02-30T12:00:00Z",
    "2026-04-31T12:00Z",
    "prefix2026-09-12T12:00Z",
    "2026-09-12T24:00Z",
    "2026-09-12T12:60Z",
    "2026-09-12T12:00:60Z",
    "2026-09-12T12:00stuffZ",
    "2026-09-12T12:00+14:01",
  ])("rejects normalized or malformed instant %s", (asOf) => {
    expect(
      validateProcurementQuery({ corpus: "tenders", status: "open", asOf }).ok,
    ).toBe(false);
  });
  it("canonicalizes valid offset instants including fractions", () => {
    const parsed = validateProcurementQuery({
      corpus: "tenders",
      status: "open",
      asOf: "2026-09-12T12:00:00.123+03:00",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.query.asOf).toBe("2026-09-12T09:00:00.123Z");
  });
  it("bounds accepted queries before encoding and round-trips the largest accepted ID list", () => {
    let previous: ReturnType<typeof validateProcurementQuery> | undefined;
    let rejected = false;
    for (let n = 1; n <= 200; n++) {
      const parsed = validateProcurementQuery({
        corpus: "contracts",
        buyerIds: Array.from(
          { length: n },
          (_, i) => "np-" + String(i).padStart(240, "0"),
        ),
      });
      if (!parsed.ok) {
        expect(parsed.errors.query).toBe("query too large");
        rejected = true;
        break;
      }
      expect(
        decodeProcurementQuery(encodeProcurementQuery(parsed.query)),
      ).toEqual(parsed);
      previous = parsed;
    }
    expect(previous?.ok).toBe(true);
    expect(rejected).toBe(true);
    expect(
      validateProcurementQuery({ corpus: "contracts", keyword: "\ud800" }).ok,
    ).toBe(false);
  });
  it("makes scalar and predicate appeal support agree for decisions", () => {
    expect(
      validateProcurementQuery({
        corpus: "decisions",
        operation: "share",
        metric: "appealed",
      }).ok,
    ).toBe(false);
    expect(
      validateProcurementQuery({
        corpus: "decisions",
        numeratorPredicates: ["appealed"],
      }).ok,
    ).toBe(false);
  });
  it("rejects prototype-shaped unknown keys and unregistered classifications", () => {
    expect(
      validateProcurementQuery(
        JSON.parse('{"corpus":"contracts","__proto__":"ignore"}'),
      ).ok,
    ).toBe(false);
    for (const extra of [
      { buyerSectors: ["bogus"] },
      { subjectSectors: ["bogus"] },
      { topic: "bogus" },
      { operation: "sum", metric: "records" },
      { operation: "share", metric: "value" },
      { minGroupCount: 20 },
    ])
      expect(
        validateProcurementQuery({ corpus: "contracts", ...extra }).ok,
      ).toBe(false);
  });
  it.each(PROCUREMENT_CORPORA)(
    "has a precise default date basis for %s",
    (corpus) => {
      const parsed = validateProcurementQuery({ corpus });
      expect(parsed.ok).toBe(true);
      if (parsed.ok)
        expect(parsed.query.version).toBe("procurement-records-v1");
    },
  );
  it.each([
    { year: 2026 },
    { sector: "health" },
    { sql: "select 1" },
    { from: "2025-02-29" },
    { from: "2026-01-01", toExclusive: "2025-01-01" },
    { bidderMin: 2, bidderMax: 1 },
    { limit: 101 },
    { limit: NaN },
    { limit: true },
    { basePredicates: ["corruption"] },
    { basePredicates: ["risk:rushedDeadline"] },
    { buyerIds: [";delete"] },
    { cpvPrefixes: ["45%"] },
    { operation: "compare" },
    { compareFrom: "2025-01-01" },
    { relatedFrom: "2026-01-01" },
    { relatedCorpus: "contracts" },
    { metric: "risk" },
    { numeratorPredicates: ["!!oneBid"] },
    { asOf: "2026-09-12" },
    { operation: "detail" },
    { operation: "rank" },
  ])("rejects rather than dropping unsupported input %j", (args) => {
    expect(validateProcurementQuery({ corpus: "contracts", ...args }).ok).toBe(
      false,
    );
  });
  it.each([
    { corpus: "tenders", metric: "oneBid" },
    { corpus: "decisions", metric: "value" },
    { corpus: "tenders", supplierIds: ["123456789"] },
    { corpus: "appeals", status: "cancelled" },
    { corpus: "contracts", dateBasis: "complaint" },
    { corpus: "contracts", valueBasis: "estimate" },
    { corpus: "tenders", denominator: "positiveKnown" },
    { corpus: "contracts", denominator: "merits" },
    { corpus: "tenders", status: "open" },
  ])("validates corpus-specific combinations %j", (args) =>
    expect(validateProcurementQuery(args).ok).toBe(false),
  );
  it("keeps independent primary and related periods", () => {
    const raw = {
      corpus: "contracts",
      from: "2025-01-01",
      toExclusive: "2026-01-01",
      relatedCorpus: "appeals",
      relatedFrom: "2026-01-01",
      relatedToExclusive: "2027-01-01",
    };
    const parsed = validateProcurementQuery(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok)
      expect(parsed.query).toMatchObject({
        ...raw,
        relatedDateBasis: "complaint",
      });
  });
  it("preserves numerator OR separately from the base population", () => {
    const parsed = validateProcurementQuery({
      corpus: "contracts",
      operation: "share",
      numeratorPredicates: ["oneBid", "upheld"],
      numeratorMode: "any",
      buyerIds: ["123456789"],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok)
      expect(parsed.query).toMatchObject({
        numeratorMode: "any",
        numeratorPredicates: ["oneBid", "upheld"],
        buyerIds: ["123456789"],
        denominator: "all",
      });
  });
  for (const corpus of PROCUREMENT_CORPORA)
    for (const risk of PROCUREMENT_RISKS[corpus]) {
      it(`${corpus} supports ${risk} and its negation`, () => {
        expect(
          validateProcurementQuery({ corpus, basePredicates: [`risk:${risk}`] })
            .ok,
        ).toBe(true);
        expect(
          validateProcurementQuery({
            corpus,
            basePredicates: [`!risk:${risk}`],
          }).ok,
        ).toBe(true);
      });
    }
  it("canonicalizes lists and round-trips dates, predicates, units and money", () => {
    const a = validateProcurementQuery({
      corpus: "contracts",
      from: "2026-01-01",
      cpvPrefixes: ["45", "33", "45"],
      numeratorPredicates: ["!risk:pepConnected"],
      amountMin: 1.5,
    });
    const b = validateProcurementQuery({
      amountMin: 1.5,
      numeratorPredicates: ["!risk:pepConnected"],
      cpvPrefixes: ["33", "45"],
      from: "2026-01-01",
      corpus: "contracts",
    });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(procurementQueryKey(a.query)).toBe(procurementQueryKey(b.query));
      expect(decodeProcurementQuery(encodeProcurementQuery(a.query))).toEqual(
        a,
      );
    }
  });
  it.each(["2025-02-29", "2026-04-31", "2026-00-01", "not a date"])(
    "rejects invalid date %s",
    (value) => expect(isProcurementDate(value)).toBe(false),
  );
  it("accepts leap days and rejects broken/oversized encodings", () => {
    expect(isProcurementDate("2024-02-29")).toBe(true);
    expect(decodeProcurementQuery("%zz").ok).toBe(false);
    expect(decodeProcurementQuery("x".repeat(16001)).ok).toBe(false);
  });
});
