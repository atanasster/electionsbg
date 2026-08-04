// Phase-2a name-frequency guard (integrate.ts). The rule it locks: for a name
// that is common in the Commerce Registry, an MP↔company link survives only on
// its OWN corroboration — a seat/region overlap, a self-declared stake, or a
// same-party witness.
//
// The regression it exists for: the guard used to be all-or-nothing per MP —
// it dropped the medium set only when NOT ONE role was corroborated. So a
// single high-confidence hit certified every namesake behind it. Measured on
// mpId 5113 ("Георги Иванов Георгиев", 320 TR roles, exactly 1 high): 319
// unrelated companies country-wide were published as his, including
// Агроинвест-24 in с. Динково, which he never declared.

import { describe, it, expect } from "vitest";
import { applyNameFrequencyGuard, COMMON_NAME_TR_ROWS } from "./integrate";

const role = (uic: string, confidence: "high" | "medium") => ({
  uic,
  confidence,
});

describe("applyNameFrequencyGuard", () => {
  it("leaves a rare name untouched — medium rows are its normal output", () => {
    const roles = [role("1", "medium"), role("2", "medium")];
    expect(applyNameFrequencyGuard(roles, COMMON_NAME_TR_ROWS - 1)).toEqual(
      roles,
    );
  });

  it("keeps ONLY corroborated rows for a common name", () => {
    const roles = [
      role("declared", "high"),
      role("namesake-a", "medium"),
      role("namesake-b", "medium"),
    ];
    expect(applyNameFrequencyGuard(roles, 320)).toEqual([
      role("declared", "high"),
    ]);
  });

  it("one corroborated row does NOT certify the namesakes behind it", () => {
    // The exact mpId-5113 shape: 1 high + 319 medium.
    const roles = [
      role("high-1", "high"),
      ...Array.from({ length: 319 }, (_, i) => role(`m-${i}`, "medium")),
    ];
    expect(applyNameFrequencyGuard(roles, 320)).toHaveLength(1);
  });

  it("drops everything when a common name has no corroborated row at all", () => {
    const roles = [role("a", "medium"), role("b", "medium")];
    expect(applyNameFrequencyGuard(roles, COMMON_NAME_TR_ROWS)).toEqual([]);
  });

  it("fires exactly AT the threshold, not one row later", () => {
    const roles = [role("a", "medium")];
    expect(applyNameFrequencyGuard(roles, COMMON_NAME_TR_ROWS)).toEqual([]);
    expect(applyNameFrequencyGuard(roles, COMMON_NAME_TR_ROWS - 1)).toEqual(
      roles,
    );
  });
});
