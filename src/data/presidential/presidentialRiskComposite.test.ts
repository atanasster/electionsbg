import { describe, expect, it } from "vitest";
import { computePresidentialRiskComposite } from "./presidentialRiskComposite";
import type { PresidentialRiskScore } from "./useRiskScore";
import type { PresidentialSuspicious } from "./useSuspiciousSettlements";
import type { PresidentialFlashDiff } from "./useFlashDiff";

const risk = (round: 1 | 2 = 1): PresidentialRiskScore => ({
  cycle: "2021_11_14_pvr",
  round,
  basis: "b",
  basisEn: "b",
  signals: {
    used: [],
    unavailable: [],
    swingAgainst: null,
    concentratedFloor: 80,
  },
  coverage: {
    sections: 10,
    scored: 10,
    totalActualVoters: 10000,
    allSectionsActualVoters: 20000,
  },
  cuts: { elevated: 20, high: 40, critical: 60 },
  counts: { low: 7, elevated: 1, high: 1, critical: 1 },
  // 100 + 0.5*100 + 0.2*100 = 170 weighted of 10,000 = 1.7% → 34 of the 5% cap.
  votesByBand: { low: 9700, elevated: 100, high: 100, critical: 100 },
  elevatedShare: 0.3,
  top: [],
});

const flag = (votesAffected: number, discriminating: boolean) => ({
  count: 1,
  threshold: 80,
  nationalPct: 1,
  measurableSettlements: 1,
  flaggedShare: 0.01,
  discriminating,
  top: [],
  votesAffected,
});

const suspicious = (concentratedDiscriminates: boolean) =>
  ({
    concentrated: flag(200, concentratedDiscriminates),
    invalidBallots: flag(100, true),
    additionalVoters: flag(100, false),
  }) as unknown as PresidentialSuspicious;

const byId = (c: ReturnType<typeof computePresidentialRiskComposite>) =>
  Object.fromEntries((c?.components ?? []).map((x) => [x.id, x]));

describe("computePresidentialRiskComposite", () => {
  it("leaves the machine components out of the average when no flash records exist", () => {
    const c = computePresidentialRiskComposite({
      risk: risk(),
      flash: null,
      suspicious: suspicious(true),
      pollMaes: [],
    });
    const m = byId(c);
    expect(m.sections.value).toBeCloseTo(34, 5);
    expect(m.machine.available).toBe(false);
    expect(m.missingFlash.available).toBe(false);
    // concentration 200/20,000 = 1% → 50; procedural counts only the discriminating flag:
    // 100/20,000 = 0.5% → 25. Mean of the three available = (34 + 50 + 25) / 3.
    expect(m.concentration.value).toBeCloseTo(50, 5);
    expect(m.procedural.value).toBeCloseTo(25, 5);
    expect(c?.score).toBeCloseTo((34 + 50 + 25) / 3, 5);
    expect(c?.integrityAvailableCount).toBe(3);
  });

  it("drops a settlement flag the producer marks non-discriminating", () => {
    const m = byId(
      computePresidentialRiskComposite({
        risk: risk(),
        flash: null,
        suspicious: suspicious(false),
        pollMaes: [],
      }),
    );
    expect(m.concentration.available).toBe(false);
  });

  it("scores the flash gap and the unreached machine votes when flash exists", () => {
    const flash: PresidentialFlashDiff = {
      cycle: "2021_11_14_pvr",
      round: 1,
      coverage: {
        protocolSections: 1,
        comparedSections: 1,
        uncomparedMachineVotes: 10,
      },
      tickets: [
        { number: 1, machineVotes: 9000, flashVotes: 8991 },
        { number: 2, machineVotes: 1000, flashVotes: 1000 },
      ],
    };
    const m = byId(
      computePresidentialRiskComposite({
        risk: risk(),
        flash,
        suspicious: null,
        pollMaes: [],
      }),
    );
    // 9 / 10,000 = 0.09% of a 0.2% cap → 45; 10 / 10,010 ≈ 0.0999% of a 1% cap → ≈ 10.
    expect(m.machine.value).toBeCloseTo(45, 5);
    expect(m.missingFlash.value).toBeCloseTo(9.99, 1);
  });

  it("puts the poll error in the context track, round one only, never in the headline", () => {
    const one = computePresidentialRiskComposite({
      risk: risk(1),
      flash: null,
      suspicious: null,
      pollMaes: [2, 3],
    });
    expect(byId(one).polls.available).toBe(true);
    expect(one?.score).toBeCloseTo(34, 5);
    const two = computePresidentialRiskComposite({
      risk: risk(2),
      flash: null,
      suspicious: null,
      pollMaes: [2, 3],
    });
    expect(byId(two).polls.available).toBe(false);
  });
});
