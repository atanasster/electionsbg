// Smoke test for the June-2026 consolidation-debate scorers in
// src/lib/bgTaxPolicy.ts (maternity second year, MP pay freeze, party
// subsidy): locks in the zero-at-current-law identities and the sign/scale
// conventions before future edits.
//
// Usage:
//   npx tsx scripts/budget/__smoke_debate_levers.ts

import {
  MATERNITY_Y2_MONTHS,
  MATERNITY_Y2_SPEND_EUR,
  MP_PAY_MASS_EUR,
  PARTY_SUBSIDY_RATE_EUR,
  PARTY_SUBSIDY_VOTES,
  scoreMaternityMonths,
  scoreMpPayFreeze,
  scorePartySubsidy,
} from "../../src/lib/bgTaxPolicy";

let failures = 0;
const check = (name: string, ok: boolean): void => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures++;
};
const close = (a: number, b: number, tolEur = 1): boolean =>
  Math.abs(a - b) <= tolEur;

// Maternity: Δ spending, negative = saving, linear in months cut.
check(
  "maternity: 0 at current law (12 months kept)",
  scoreMaternityMonths(MATERNITY_Y2_MONTHS) === 0,
);
check(
  "maternity: full second-year spend saved at 0 months",
  close(scoreMaternityMonths(0), -MATERNITY_Y2_SPEND_EUR),
);
check(
  "maternity: half the spend at 6 months",
  close(scoreMaternityMonths(6), -MATERNITY_Y2_SPEND_EUR / 2),
);

// MP pay freeze: one year of foregone growth on the pay mass.
check(
  "mp freeze: saving scales with the wage-growth input",
  close(scoreMpPayFreeze(10), -MP_PAY_MASS_EUR * 0.1),
);
check("mp freeze: zero growth saves nothing", scoreMpPayFreeze(0) === 0);

// Party subsidy: Δ spending vs the current-law €3.00/vote.
check(
  "subsidy: 0 at the current-law rate",
  scorePartySubsidy(PARTY_SUBSIDY_RATE_EUR) === 0,
);
check(
  "subsidy: zeroing saves rate × votes",
  close(scorePartySubsidy(0), -PARTY_SUBSIDY_RATE_EUR * PARTY_SUBSIDY_VOTES),
);
check(
  "subsidy: restoring the old €4.09 costs ~€3.1M",
  close(scorePartySubsidy(4.09), 1.09 * PARTY_SUBSIDY_VOTES, 1e4),
);

if (failures > 0) {
  throw new Error(`${failures} debate-lever invariant(s) failed`);
}
console.log("\nAll debate-lever invariants hold.");
