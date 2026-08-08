// Per-component tests for computeProcurementRisk.
//
// The existing coverage tested mergeContractRisk and the NGO disclosure; the
// harness covers weakCompetition / directAward / annexGrowth / newFirmWinner /
// splitPurchase. This file closes the rest, and concentrates on the thing this
// scorer gets wrong most easily: AVAILABILITY. A check that is unavailable is
// excluded from the CRI denominator; a check that is available-and-not-fired
// counts against it. Confusing the two silently changes every score on the page,
// which is exactly the class of bug that shipped in the foundedByEik payload
// bound (30.2% of the corpus carried a different CRI on the two sides).

import { describe, expect, it } from "vitest";
import {
  computeProcurementRisk,
  type RiskScoreArgs,
} from "./computeProcurementRisk";
import type { ProcurementContract } from "@/data/dataTypes";

const baseArgs = (over: Partial<RiskScoreArgs> = {}): RiskScoreArgs => ({
  debarredByName: new Map(),
  concentrationByPair: new Map(),
  mpConnectedEiks: new Map(),
  normalizeName: (s) => s.trim().toLowerCase(),
  ...over,
});

const contract = (
  over: Partial<ProcurementContract> = {},
): ProcurementContract =>
  ({
    tag: "contract",
    awarderEik: "111",
    contractorEik: "222",
    contractorName: "Фирма",
    amountEur: 1000,
    ...over,
  }) as ProcurementContract;

const comp = (r: ReturnType<typeof computeProcurementRisk>, key: string) =>
  r.components.find((c) => c.key === key);

describe("pepConnected — availability gating", () => {
  it("is UNAVAILABLE when the index has not loaded (map absent)", () => {
    // The map being undefined means "we don't know yet", NOT "not connected".
    // Scoring it 0 would quietly dilute every CRI while the payload is in flight.
    const r = computeProcurementRisk(contract(), baseArgs());
    expect(comp(r, "pepConnected")).toMatchObject({
      available: false,
      fired: false,
    });
  });

  it("is available-and-not-fired when the index loaded without this EIK", () => {
    const r = computeProcurementRisk(
      contract(),
      baseArgs({ pepConnectedEiks: new Set(["999"]) }),
    );
    expect(comp(r, "pepConnected")).toMatchObject({
      available: true,
      fired: false,
    });
  });

  it("fires when the loaded index contains the contractor", () => {
    const r = computeProcurementRisk(
      contract(),
      baseArgs({ pepConnectedEiks: new Set(["222"]) }),
    );
    expect(comp(r, "pepConnected")).toMatchObject({
      available: true,
      fired: true,
    });
  });

  it("an EMPTY loaded set is still available (empty ≠ absent)", () => {
    const r = computeProcurementRisk(
      contract(),
      baseArgs({ pepConnectedEiks: new Set() }),
    );
    expect(comp(r, "pepConnected")?.available).toBe(true);
  });
});

describe("appealUpheld — tri-state", () => {
  it("undefined ⇒ unavailable (the appeal join was not selected)", () => {
    const r = computeProcurementRisk(contract(), baseArgs());
    expect(comp(r, "appealUpheld")).toMatchObject({
      available: false,
      fired: false,
    });
  });

  it("false ⇒ available and clean (no KNOWN upheld appeal)", () => {
    const r = computeProcurementRisk(
      contract({ appealUpheld: false }),
      baseArgs(),
    );
    expect(comp(r, "appealUpheld")).toMatchObject({
      available: true,
      fired: false,
    });
  });

  it("true ⇒ fires", () => {
    const r = computeProcurementRisk(
      contract({ appealUpheld: true }),
      baseArgs(),
    );
    expect(comp(r, "appealUpheld")).toMatchObject({
      available: true,
      fired: true,
    });
  });
});

describe("shortTenderPeriod — boundaries", () => {
  const window = (start: string, end: string) =>
    computeProcurementRisk(
      contract({ tenderPeriodStartDate: start, tenderPeriodEndDate: end }),
      baseArgs(),
    );

  it("fires below the 14-day EU reference minimum", () => {
    const r = window("2024-01-01", "2024-01-10"); // 9 days
    expect(comp(r, "shortTenderPeriod")).toMatchObject({
      available: true,
      fired: true,
    });
    expect(r.flags.tenderPeriodDays).toBe(9);
  });

  it("does NOT fire exactly at 14 days (the boundary is <, not <=)", () => {
    const r = window("2024-01-01", "2024-01-15");
    expect(comp(r, "shortTenderPeriod")).toMatchObject({
      available: true,
      fired: false,
    });
    expect(r.flags.tenderPeriodDays).toBe(14);
  });

  it("fires at 13 days", () => {
    expect(
      comp(window("2024-01-01", "2024-01-14"), "shortTenderPeriod")?.fired,
    ).toBe(true);
  });

  it("is unavailable when an endpoint is missing, reversed, or unparseable", () => {
    for (const r of [
      computeProcurementRisk(
        contract({ tenderPeriodStartDate: "2024-01-01" }),
        baseArgs(),
      ),
      window("2024-02-01", "2024-01-01"), // end before start
      window("not-a-date", "2024-01-10"),
    ])
      expect(comp(r, "shortTenderPeriod")).toMatchObject({
        available: false,
        fired: false,
      });
  });
});

describe("splitPurchase — key construction", () => {
  const entry = { awarderEik: "111", contractorEik: "222" } as never;

  it("fires on an exact buyer|supplier|cpvDiv|year key", () => {
    const r = computeProcurementRisk(
      contract({ cpv: "45000000", date: "2024-03-02" }),
      baseArgs({ splitPurchaseByKey: new Map([["111|222|45|2024", entry]]) }),
    );
    expect(comp(r, "splitPurchase")).toMatchObject({
      available: true,
      fired: true,
    });
  });

  it("cannot fire when cpv or date is missing — but stays AVAILABLE", () => {
    // The empty key must not accidentally match a map entry keyed "".
    for (const c of [
      contract({ date: "2024-03-02" }), // no cpv
      contract({ cpv: "45000000" }), // no date
    ]) {
      const r = computeProcurementRisk(
        c,
        baseArgs({
          splitPurchaseByKey: new Map([
            ["", entry],
            ["111|222|45|2024", entry],
          ]),
        }),
      );
      expect(comp(r, "splitPurchase")).toMatchObject({
        available: true,
        fired: false,
      });
    }
  });
});

describe("debarred / concentration / amendment", () => {
  it("debarred matches through the caller's name fold", () => {
    const r = computeProcurementRisk(
      contract({ contractorName: "  ФИРМА  " }),
      baseArgs({
        debarredByName: new Map([["фирма", { name: "Фирма" } as never]]),
      }),
    );
    expect(comp(r, "debarred")?.fired).toBe(true);
    expect(r.flags.debarred).not.toBeNull();
  });

  it("awarderConcentration keys on the awarder|contractor pair", () => {
    const args = baseArgs({
      concentrationByPair: new Map([["111|222", { sharePct: 0.9 } as never]]),
    });
    expect(
      comp(computeProcurementRisk(contract(), args), "awarderConcentration")
        ?.fired,
    ).toBe(true);
    // A different buyer with the same supplier must not match.
    expect(
      comp(
        computeProcurementRisk(contract({ awarderEik: "333" }), args),
        "awarderConcentration",
      )?.fired,
    ).toBe(false);
  });

  it("amendment fires only for tag=contractAmendment", () => {
    expect(
      comp(
        computeProcurementRisk(
          contract({ tag: "contractAmendment" }),
          baseArgs(),
        ),
        "amendment",
      )?.fired,
    ).toBe(true);
    expect(
      comp(computeProcurementRisk(contract(), baseArgs()), "amendment")?.fired,
    ).toBe(false);
  });
});

describe("weakCompetition — the omitted-threshold default", () => {
  it("uses 0.8 as the structural share when the arg is omitted", () => {
    // division share 0.85 >= the default 0.8 ⇒ structurally single-bid ⇒ suppressed
    const suppressed = computeProcurementRisk(
      contract({ cpv: "45000000", numberOfTenderers: 1 }),
      baseArgs({ cpvSingleBidShare: new Map([["45", 0.85]]) }),
    );
    expect(comp(suppressed, "weakCompetition")?.fired).toBe(false);

    const fires = computeProcurementRisk(
      contract({ cpv: "45000000", numberOfTenderers: 1 }),
      baseArgs({ cpvSingleBidShare: new Map([["45", 0.5]]) }),
    );
    expect(comp(fires, "weakCompetition")?.fired).toBe(true);
  });

  it("suppresses the statutory sole-source CPV 22112 regardless of share", () => {
    const r = computeProcurementRisk(
      contract({ cpv: "22112000", numberOfTenderers: 1 }),
      baseArgs(),
    );
    expect(comp(r, "weakCompetition")).toMatchObject({
      available: true,
      fired: false,
    });
  });
});

describe("appealUpheld availability is a TRI-state", () => {
  // Mirrors 112_contract_risk_cache.sql, which sets `true AS a_appeal`
  // UNCONDITIONALLY and derives `f_appeal` from a possibly-empty view. So `false`
  // means AVAILABLE-not-fired and only `undefined` means UNAVAILABLE.
  //
  // scripts/procurement/risk_parity.harness.ts depends on exactly this split: when
  // upheld_ocids is absent it emits `false` (not NULL) so the two sides agree. A
  // tidy-up of the availability expression to `!!contract.appealUpheld`, or a
  // `?? undefined` slip in the harness, would flip availability across the whole
  // corpus — moving every CRI denominator — while looking harmless.
  it("false ⇒ available, not fired (matches SQL over an empty upheld set)", () => {
    const r = computeProcurementRisk(
      contract({ appealUpheld: false }),
      baseArgs(),
    );
    expect(comp(r, "appealUpheld")).toMatchObject({
      available: true,
      fired: false,
    });
  });

  it("true ⇒ available and fired", () => {
    const r = computeProcurementRisk(
      contract({ appealUpheld: true }),
      baseArgs(),
    );
    expect(comp(r, "appealUpheld")).toMatchObject({
      available: true,
      fired: true,
    });
  });

  it("undefined ⇒ UNAVAILABLE — excluded from the CRI denominator", () => {
    const withField = computeProcurementRisk(
      contract({ appealUpheld: false }),
      baseArgs(),
    );
    const without = computeProcurementRisk(contract(), baseArgs());
    expect(comp(without, "appealUpheld")).toMatchObject({
      available: false,
      fired: false,
    });
    // The denominator, not just the flag: an unavailable check must shrink it.
    expect(without.availableCount).toBe(withField.availableCount - 1);
  });
});

describe("score — the additive cap", () => {
  it("caps at 100 when the heaviest flags stack", () => {
    // debarred 80 + appeal 70 + mp 50 = 200 uncapped.
    const r = computeProcurementRisk(
      contract({ contractorName: "x", appealUpheld: true }),
      baseArgs({
        debarredByName: new Map([["x", { name: "x" } as never]]),
        mpConnectedEiks: new Map([["222", true]]),
      }),
    );
    expect(r.score).toBe(100);
    expect(r.firedCount).toBe(3);
  });

  it("cri is round(100 × fired / available) and excludes unavailable checks", () => {
    const r = computeProcurementRisk(contract(), baseArgs());
    expect(r.availableCount).toBeLessThan(r.components.length);
    expect(r.cri).toBe(Math.round((100 * r.firedCount) / r.availableCount));
  });
});

describe("nkidMismatch — declared-activity availability gating", () => {
  it("is UNAVAILABLE when the nkid map is absent (payload in flight)", () => {
    // Absent map = "we don't know the declared activity yet", NOT "matches".
    const r = computeProcurementRisk(contract({ cpv: "45000000" }), baseArgs());
    expect(comp(r, "nkidMismatch")).toMatchObject({
      available: false,
      fired: false,
    });
  });

  it("is UNAVAILABLE when the contractor is absent from a loaded map", () => {
    const r = computeProcurementRisk(
      contract({ cpv: "45000000" }),
      baseArgs({ nkidByEik: new Map([["999", "47"]]) }),
    );
    expect(comp(r, "nkidMismatch")?.available).toBe(false);
  });

  it("is UNAVAILABLE when the contract has no CPV, even with a known NACE", () => {
    const r = computeProcurementRisk(
      contract({ cpv: undefined }),
      baseArgs({ nkidByEik: new Map([["222", "47"]]) }),
    );
    expect(comp(r, "nkidMismatch")?.available).toBe(false);
  });

  it("is UNAVAILABLE for an unmapped NACE division (no opinion, never a flag)", () => {
    // "12" (tobacco) is absent from the crosswalk — no opinion, so unavailable
    // rather than a manufactured mismatch.
    const r = computeProcurementRisk(
      contract({ cpv: "45000000" }),
      baseArgs({ nkidByEik: new Map([["222", "12"]]) }),
    );
    expect(comp(r, "nkidMismatch")).toMatchObject({
      available: false,
      fired: false,
    });
  });

  it("FIRES: a retail firm (47) winning construction work (45)", () => {
    const r = computeProcurementRisk(
      contract({ cpv: "45000000" }),
      baseArgs({ nkidByEik: new Map([["222", "47"]]) }),
    );
    expect(comp(r, "nkidMismatch")).toMatchObject({
      available: true,
      fired: true,
    });
    expect(r.flags.nkidMismatch).toBe(true);
    expect(r.flags.nkidDivision).toBe("47");
  });

  it("available-and-not-fired: a construction firm (42) winning road work (45)", () => {
    const r = computeProcurementRisk(
      contract({ cpv: "45000000" }),
      baseArgs({ nkidByEik: new Map([["222", "42"]]) }),
    );
    expect(comp(r, "nkidMismatch")).toMatchObject({
      available: true,
      fired: false,
    });
    expect(r.flags.nkidDivision).toBe("42");
  });

  it("available-and-not-fired: any NACE winning a universal CPV (office supplies)", () => {
    const r = computeProcurementRisk(
      contract({ cpv: "30000000" }), // office & computing — universal
      baseArgs({ nkidByEik: new Map([["222", "47"]]) }),
    );
    expect(comp(r, "nkidMismatch")).toMatchObject({
      available: true,
      fired: false,
    });
  });

  it("nkidDivision is null when the check is unavailable", () => {
    const r = computeProcurementRisk(
      contract({ cpv: undefined }),
      baseArgs({ nkidByEik: new Map([["222", "47"]]) }),
    );
    expect(r.flags.nkidDivision).toBeNull();
  });
});
