import { describe, it, expect } from "vitest";
import { interregForOblast, type InterregOverviewLite } from "./interregArm";

// No database and no network: interregForOblast is the fold between two oblast
// vocabularies, and a fold is exactly the kind of thing that is right until
// somebody adds a code. `interreg_partners.oblast` carries the 27 three-letter
// codes plus the literal SOFIA_CITY, while aggregateRegionalOblasts keys its
// rows through oblastToCanon — which maps S22/S23/S24/S25 → SOFIA_CITY and
// PDV-00 → PDV. Getting it wrong does not throw; it drops an oblast's Interreg
// money to zero while the ИСУН figure keeps rendering.
const overview = (oblasts: Record<string, number>): InterregOverviewLite => ({
  budgetEur: 0,
  partnerCount: 0,
  operationCount: 0,
  programmeCount: 0,
  periods: {},
  oblasts: Object.fromEntries(
    Object.entries(oblasts).map(([k, v]) => [
      k,
      { budgetEur: v, partnerCount: 1, operationCount: 1 },
    ]),
  ),
});

describe("interregForOblast", () => {
  it("matches a plain three-letter oblast code", () => {
    const o = overview({ VID: 1_000_000, MON: 500_000 });
    expect(interregForOblast(o, "VID")).toBe(1_000_000);
    expect(interregForOblast(o, "MON")).toBe(500_000);
  });

  it("returns 0 for an oblast with no Interreg money", () => {
    // 0, not null: every caller adds this to an ИСУН figure unconditionally.
    expect(interregForOblast(overview({ VID: 1 }), "PAZ")).toBe(0);
  });

  it("folds the Sofia-city codes onto one canon key", () => {
    // The corpus writes SOFIA_CITY; oblastToCanon also folds S22/S23/S24/S25
    // there, so both spellings must land on the same bucket and be SUMMED
    // rather than one overwriting the other.
    const o = overview({ SOFIA_CITY: 88_655_624, S23: 1_000 });
    expect(interregForOblast(o, "SOFIA_CITY")).toBe(88_656_624);
  });

  it("folds PDV-00 onto PDV, the shard-code alias", () => {
    const o = overview({ "PDV-00": 200, PDV: 300 });
    expect(interregForOblast(o, "PDV")).toBe(500);
  });

  it("is safe when the arm is unavailable", () => {
    // A database before migration 138 returns null from tryInterregOverview,
    // and every caller must keep answering from ИСУН alone.
    expect(interregForOblast(null, "VID")).toBe(0);
    expect(
      interregForOblast(
        { ...overview({}), oblasts: undefined as never },
        "VID",
      ),
    ).toBe(0);
  });
});
