// contractRiskMask — decoding the server's two ints back into chips.
//
// The invariants worth pinning are the ones that would silently mis-render a
// contract rather than throw: the bit ORDER (a renumbering re-maps every historic
// mask), and NULL meaning unknown rather than clean.

import { describe, expect, it } from "vitest";
import {
  contractRiskFromMasks,
  RISK_MASK_BITS,
  type RiskMaskRow,
} from "./contractRiskMask";

/** Build a mask from check names, so the tests read in names not numbers. */
const maskOf = (...keys: string[]): number =>
  keys.reduce((m, k) => {
    const i = RISK_MASK_BITS.indexOf(k as (typeof RISK_MASK_BITS)[number]);
    if (i < 0) throw new Error(`unknown check ${k}`);
    return m | (1 << i);
  }, 0);

const row = (over: Partial<RiskMaskRow> = {}): RiskMaskRow => ({
  riskFiredMask: 0,
  riskAvailableMask: maskOf(...RISK_MASK_BITS),
  ...over,
});

describe("bit order matches 112_contract_risk_cache.sql", () => {
  // Renumbering this list silently re-maps every mask already in the table, so
  // pin the literal order rather than trusting the array's own contents.
  it("is the documented 13-check order", () => {
    expect([...RISK_MASK_BITS]).toEqual([
      "debarred",
      "mpConnected",
      "pepConnected",
      "awarderConcentration",
      "amendment",
      "annexGrowth",
      "newFirmWinner",
      "splitPurchase",
      "appealUpheld",
      "weakCompetition",
      "directAward",
      "shortTenderPeriod",
      "nkidMismatch",
    ]);
  });

  it("decodes a real row from contract_risk_cache", () => {
    // The worst row in the corpus, taken verbatim from the table (pre-nkid vintage):
    //   fired=6 available=11 cri=55 fired_mask=1582 available_mask=2047
    // available_mask 2047 = 0b0111111111111 — every check except shortTenderPeriod
    // (bit 11, 0% populated) AND nkidMismatch (bit 12, absent from this old mask), so
    // availableCount stays 11 across the 13-check widening.
    const r = contractRiskFromMasks(
      row({ riskFiredMask: 1582, riskAvailableMask: 2047 }),
    );
    expect(r).not.toBeNull();

    const fired = r!.components.filter((c) => c.fired).map((c) => c.key);
    expect(fired.sort()).toEqual(
      [
        "mpConnected",
        "pepConnected",
        "awarderConcentration",
        "annexGrowth",
        "weakCompetition",
        "directAward",
      ].sort(),
    );
    expect(r!.components.filter((c) => !c.available).map((c) => c.key)).toEqual(
      ["shortTenderPeriod", "nkidMismatch"],
    );

    // The counts and cri the server stored for this row, reproduced exactly.
    expect(r!.firedCount).toBe(6);
    expect(r!.availableCount).toBe(11);
    expect(r!.cri).toBe(55);
  });

  // A fired bit outside the available set is not representable by 112 (every
  // f_* is ANDed with its a_*), so the decoder should never be handed one. Pin
  // that the counts stay independent rather than silently reconciling.
  it("keeps firedCount consistent with components", () => {
    const r = contractRiskFromMasks(
      row({ riskFiredMask: 1582, riskAvailableMask: 2047 }),
    )!;
    expect(r.firedCount).toBe(r.components.filter((c) => c.fired).length);
    expect(r.availableCount).toBe(
      r.components.filter((c) => c.available).length,
    );
  });
});

describe("NULL masks mean UNKNOWN, never clean", () => {
  // contracts_list LEFT JOINs the cache and emits NULL for an unscored contract.
  // Decoding that to 0 would render a flagged row as "—", which is the exact bug
  // the mask work exists to remove.
  it.each([
    ["both null", { riskFiredMask: null, riskAvailableMask: null }],
    ["fired null", { riskFiredMask: null, riskAvailableMask: 2015 }],
    ["available null", { riskFiredMask: 0, riskAvailableMask: null }],
    [
      "both undefined",
      { riskFiredMask: undefined, riskAvailableMask: undefined },
    ],
  ])("returns null when %s", (_label, over) => {
    expect(contractRiskFromMasks(row(over))).toBeNull();
  });

  it("distinguishes unknown from a genuinely clean contract", () => {
    const clean = contractRiskFromMasks(
      row({ riskFiredMask: 0, riskAvailableMask: 2015 }),
    );
    expect(clean).not.toBeNull();
    expect(clean!.hasFlag).toBe(false);
    expect(clean!.firedCount).toBe(0);
  });
});

describe("counts and cri", () => {
  it("derives counts from the masks when the row omits them", () => {
    const r = contractRiskFromMasks({
      riskFiredMask: maskOf("debarred", "directAward"),
      riskAvailableMask: maskOf(
        "debarred",
        "directAward",
        "mpConnected",
        "amendment",
      ),
    })!;
    expect(r.firedCount).toBe(2);
    expect(r.availableCount).toBe(4);
    expect(r.cri).toBe(50);
    expect(r.hasFlag).toBe(true);
  });

  it("rounds cri the way 112 does", () => {
    // round(100 * fired / available) — 1 of 3 is 33, not 33.33 and not 34.
    const r = contractRiskFromMasks({
      riskFiredMask: maskOf("debarred"),
      riskAvailableMask: maskOf("debarred", "mpConnected", "amendment"),
    })!;
    expect(r.cri).toBe(33);
  });

  it("reports cri 0 rather than NaN when nothing is checkable", () => {
    const r = contractRiskFromMasks({
      riskFiredMask: 0,
      riskAvailableMask: 0,
    })!;
    expect(r.cri).toBe(0);
    expect(r.hasFlag).toBe(false);
  });
});

describe("magnitudes recovered from the row", () => {
  it("computes annexGrowthPct from signed vs current", () => {
    const r = contractRiskFromMasks(
      row({ signingAmountEur: 1000, amountEur: 1600 }),
    )!;
    expect(r.flags.annexGrowthPct).toBeCloseTo(0.6);
  });

  it("leaves annexGrowthPct null when there is no signing value", () => {
    const r = contractRiskFromMasks(row({ amountEur: 1600 }))!;
    expect(r.flags.annexGrowthPct).toBeNull();
  });

  it("carries the bid count and tender window", () => {
    const r = contractRiskFromMasks(
      row({
        numberOfTenderers: 1,
        tenderPeriodStartDate: "2024-01-01",
        tenderPeriodEndDate: "2024-01-08",
      }),
    )!;
    expect(r.flags.bidCount).toBe(1);
    expect(r.flags.tenderPeriodDays).toBe(7);
  });
});

describe("detail-bearing flags stay null rather than being faked", () => {
  // debarred / awarderConcentration / splitPurchase are object-valued because the
  // tooltip renders their contents. A truthy placeholder would be a lie the UI
  // then displays, so the fired state lives in `components` until the
  // per-contract detail fetch exists.
  it("reports them fired in components but null in flags", () => {
    const r = contractRiskFromMasks(
      row({
        riskFiredMask: maskOf(
          "debarred",
          "awarderConcentration",
          "splitPurchase",
        ),
      }),
    )!;
    expect(r.flags.debarred).toBeNull();
    expect(r.flags.awarderConcentration).toBeNull();
    expect(r.flags.splitPurchase).toBeNull();
    for (const k of ["debarred", "awarderConcentration", "splitPurchase"])
      expect(r.components.find((c) => c.key === k)?.fired).toBe(true);
    expect(r.firedCount).toBe(3);
  });
});
