import { describe, test, expect } from "vitest";
import { classifyDetails, selectIds, ID_FLOOR } from "./eop_tender_class";

describe("classifyDetails", () => {
  test("an empty body is an unpublished / draft id", () => {
    // GetPublishedTenderDetails answers 200 with an empty body for these, which the
    // client surfaces as `body: null` — an ANSWER, not a failure.
    expect(classifyDetails(null)).toBe("empty");
  });

  test("a published procedure needs a УНП AND a publication", () => {
    expect(
      classifyDetails({
        SpecialNumber: "00728-2026-0018",
        TenderPublicationDetails: [{}],
      }),
    ).toBe("procedure");
  });

  // ⚠️ The trap the whole walk turns on: a LOT answers 200 with a real body, so
  // "did I get a 200?" is not a completeness test. Lots are ~50% of the id space;
  // counting them as procedures would inflate the corpus ~2.4x.
  test("a lot stub is not a procedure, however real its body looks", () => {
    expect(
      classifyDetails({ SpecialNumber: null, TenderPublicationDetails: [] }),
    ).toBe("lot");
    // Verbatim shape of tenderId 587157, a lot of 00728-2026-0018.
    expect(classifyDetails({ SpecialNumber: null })).toBe("lot");
  });

  test("either half alone is not enough", () => {
    // A УНП with no publications…
    expect(
      classifyDetails({
        SpecialNumber: "00728-2026-0018",
        TenderPublicationDetails: [],
      }),
    ).toBe("lot");
    // …and publications with no УНП. The second case is the 248 synthetic-`T` rows,
    // for which the register returns "" — they reconcile by tenderId, not by УНП.
    expect(
      classifyDetails({ SpecialNumber: "", TenderPublicationDetails: [{}] }),
    ).toBe("lot");
  });

  test("an absent publications array is treated as none, not as a crash", () => {
    expect(classifyDetails({ SpecialNumber: "00728-2026-0018" })).toBe("lot");
  });
});

describe("ID_FLOOR", () => {
  test("matches the probed start of the ЦАИС era", () => {
    // ids 1000…56504 all answered empty when probed 2026-08-03; walking below this
    // spends calls on ids the register never minted.
    expect(ID_FLOOR).toBe(56505);
  });
});

describe("selectIds", () => {
  // CRITICAL regression. The first version defaulted the ceiling to the corpus's own
  // max id, which makes a gap at the TOP of the id space — the newest procedures,
  // i.e. the §11 recency-hole shape — structurally undetectable. Walking past the
  // register's real maximum cannot produce false positives: an unminted id answers
  // empty and classifies as `empty`, never as missing.
  test("the default ceiling reaches PAST what the corpus already holds", () => {
    const ids = selectIds({ maxHave: 600_000, full: false, sample: "10" });
    expect(ids[ids.length - 1]).toBeGreaterThan(600_000);
  });

  test("an explicit range is honoured exactly", () => {
    const ids = selectIds({ maxHave: 9, from: "100", to: "109", full: true });
    expect(ids).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
  });

  // CRITICAL regression. `abc`, `0`, `-5` each walked ZERO ids and printed a clean
  // "✓ complete" at exit 0 — the silently-empty-work-set class.
  test("an unusable --sample throws instead of walking nothing", () => {
    for (const bad of ["abc", "0", "-5", "", " ", "1.5"])
      expect(() => selectIds({ maxHave: 600_000, sample: bad })).toThrow();
  });

  test("`1e3` is rejected rather than silently read as 1", () => {
    // Bare parseInt("1e3") === 1, which would walk a single id and report success.
    expect(() => selectIds({ maxHave: 600_000, sample: "1e3" })).toThrow(
      /whole number/,
    );
  });

  test("a reversed range throws", () => {
    expect(() => selectIds({ maxHave: 0, from: "500", to: "100" })).toThrow(
      /empty range/,
    );
  });

  test("sampling is deterministic, evenly spread, and hits BOTH endpoints", () => {
    const a = selectIds({ maxHave: 0, from: "0", to: "999", sample: "10" });
    const b = selectIds({ maxHave: 0, from: "0", to: "999", sample: "10" });
    expect(a).toEqual(b); // re-probeable
    expect(a).toHaveLength(10);
    expect(a[0]).toBe(0);
    // The ceiling must be sampled: it is the newest id, and the top of the range is
    // exactly where a recency gap would sit.
    expect(a[a.length - 1]).toBe(999);
    expect(new Set(a).size).toBe(10); // no duplicates burning calls
  });

  test("a single-id sample probes the ceiling, not the floor", () => {
    expect(
      selectIds({ maxHave: 0, from: "10", to: "99", sample: "1" }),
    ).toEqual([99]);
  });

  test("a sample larger than the range degrades to a full walk, not to duplicates", () => {
    const ids = selectIds({ maxHave: 0, from: "10", to: "14", sample: "500" });
    expect(ids).toEqual([10, 11, 12, 13, 14]);
  });

  test("--full ignores the sample size", () => {
    const ids = selectIds({
      maxHave: 0,
      from: "1",
      to: "5",
      sample: "2",
      full: true,
    });
    expect(ids).toHaveLength(5);
  });

  test("--probe defaults to a smaller sample than a normal run", () => {
    const probe = selectIds({ maxHave: 600_000, probe: true });
    const normal = selectIds({ maxHave: 600_000 });
    expect(probe.length).toBeLessThan(normal.length);
  });
});
