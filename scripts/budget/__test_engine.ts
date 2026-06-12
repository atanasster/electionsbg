// Comprehensive engine UNIT tests for the budget policy simulator's pure
// scoring functions (src/lib/bgTaxPolicy.ts + src/lib/bgBehavioral.ts). Unlike
// the __smoke_* scripts (which validate the live policy_baseline.json), this
// file pins the MATH itself with SYNTHETIC inputs and hand-derived golden
// values — so a refactor that changes any calculation is caught regardless of
// the baseline data. Every golden carries its derivation in a comment.
//
// Usage: npx tsx scripts/budget/__test_engine.ts   (or: npm run budget:test)

import {
  CORP_TAX_RATE,
  DIVIDEND_TAX_RATE,
  PIT_RATE,
  SSC_EMPLOYEE_RATE,
} from "../../src/lib/bgTax";
import {
  EMPLOYER_SSC_RATE,
  HEALTH_EMPLOYEE_SHARE,
  SSC_COMBINED_BUDGET_RATE,
  giniOnBands,
  labourTaxFeedbackOnCost,
  labourTaxFeedbackOnSalary,
  pensionIndexationRate,
  pitMonthlyUnderBrackets,
  pitRevenueOnBands,
  scoreAdminCut,
  scoreCapitalChange,
  scoreCorporate,
  scoreDefenseTarget,
  scoreDividend,
  scoreHealthContribution,
  scoreMaternityMonths,
  scoreMinWageFreeze,
  scoreModCap,
  scoreModCapBands,
  scoreMpPayFreeze,
  scorePartySubsidy,
  scorePensionFloorRaise,
  scorePensionIndexation,
  scorePitFlat,
  scorePitSchedule,
  scoreSscSelfPaid,
  scoreTeachersPeg,
  scoreWageIndexation,
  type EarningsBand,
  type ModIdentity,
} from "../../src/lib/bgTaxPolicy";
import {
  centralDraw,
  computeMacroFeedback,
  corpBehavioralOffset,
  dividendBehavioralOffset,
  dividendShiftRecaptureEur,
  healthBehavioralOffset,
  marginalRateAt,
  maternityReturnOffset,
  modBehavioralOffset,
  mulberry32,
  pitFlatBehavioralOffset,
  sampleTriangular,
  vatBehavioralOffset,
  zeroDraw,
} from "../../src/lib/bgBehavioral";

let failures = 0;
const check = (name: string, ok: boolean): void => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
};
// Golden equality with an absolute tolerance (default 1 EUR / 1e-9 for rates).
const near = (a: number, b: number, tol = 1): boolean => Math.abs(a - b) <= tol;
const eq = (name: string, a: number, b: number, tol = 1): void =>
  check(`${name}: ${a} ≈ ${b}`, near(a, b, tol));

console.log("=== closed-form revenue scorers ===");
// scorePitFlat = rev × share × (new/PIT_RATE − 1). 1e9 × 0.5 × (0.12/0.10−1).
eq("scorePitFlat(1e9, 0.5, 0.12)", scorePitFlat(1e9, 0.5, 0.12), 1e8);
eq("scorePitFlat current-rate no-op", scorePitFlat(1e9, 0.5, PIT_RATE), 0);
// scoreCorporate = rev × (new/CORP_TAX_RATE − 1). 1e9 × (0.11/0.10 − 1).
eq("scoreCorporate(1e9, 0.11)", scoreCorporate(1e9, 0.11), 1e8);
eq("scoreCorporate no-op", scoreCorporate(1e9, CORP_TAX_RATE), 0);
// scoreDividend = rev × (new/DIVIDEND_TAX_RATE − 1). 1e8 × (0.10/0.05 − 1).
eq("scoreDividend(1e8, 0.10)", scoreDividend(1e8, 0.1), 1e8);
eq("scoreDividend no-op", scoreDividend(1e8, DIVIDEND_TAX_RATE), 0);

console.log("\n=== PIT brackets over a synthetic grid ===");
// Untaxed minimum then 10%: 0.10 × (2000 − 500).
eq(
  "pitMonthlyUnderBrackets nm+flat",
  pitMonthlyUnderBrackets(2000, [
    { fromEur: 0, rate: 0 },
    { fromEur: 500, rate: 0.1 },
  ]),
  150,
);
eq(
  "pitMonthlyUnderBrackets flat",
  pitMonthlyUnderBrackets(2000, [{ fromEur: 0, rate: 0.1 }]),
  200,
);
// One band: base = 2000 − 0.1378×2000 = 1724.4; tax@10% = 172.44; ×1000×12.
const BAND1: EarningsBand[] = [{ grossEur: 2000, workers: 1000 }];
eq(
  "pitRevenueOnBands one band @10%",
  pitRevenueOnBands(BAND1, 2000, [{ fromEur: 0, rate: 0.1 }]),
  172.44 * 1000 * 12,
  1,
);
// Δ(12% vs 10%) on the same grid, κ=1: base×0.02×1000×12.
eq(
  "scorePitSchedule +2pp flat",
  scorePitSchedule(BAND1, 2000, [{ fromEur: 0, rate: 0.12 }], 1),
  1724.4 * 0.02 * 1000 * 12,
  1,
);
eq(
  "scorePitSchedule κ scales linearly",
  scorePitSchedule(BAND1, 2000, [{ fromEur: 0, rate: 0.12 }], 2),
  2 * 1724.4 * 0.02 * 1000 * 12,
  1,
);

console.log("\n=== Gini over a synthetic grid ===");
// Two equal-weight bands at 1000 & 3000 (amount = gross): Σ|xi−xj|w / (2W²μ).
eq(
  "giniOnBands {1000,3000}",
  giniOnBands(
    [
      { grossEur: 1000, workers: 1 },
      { grossEur: 3000, workers: 1 },
    ],
    (g) => g,
  ),
  0.25,
  1e-9,
);
eq(
  "giniOnBands identical → 0",
  giniOnBands(
    [
      { grossEur: 2000, workers: 5 },
      { grossEur: 2000, workers: 5 },
    ],
    (g) => g,
  ),
  0,
  1e-9,
);

console.log("\n=== МОД cap (band grid + closed form) ===");
// Raise 2000→2500 over a band at 3000: ΔBase = 1000×(2500−2000)×12 = 6e6.
const modBands: EarningsBand[] = [{ grossEur: 3000, workers: 1000 }];
const modR = scoreModCapBands(modBands, 2000, 2500, PIT_RATE);
eq("scoreModCapBands ΔBase", modR.deltaBaseEur, 6e6);
eq("scoreModCapBands sscEur", modR.sscEur, 6e6 * SSC_COMBINED_BUDGET_RATE);
eq(
  "scoreModCapBands pitOffset",
  modR.pitOffsetEur,
  -6e6 * SSC_EMPLOYEE_RATE * PIT_RATE,
);
eq("scoreModCapBands total", modR.totalEur, modR.sscEur + modR.pitOffsetEur);
// Closed form: a raise yields > 0, and the α ordering flips (heavier tail =
// lower α parks more mass far above any finite cap → LESS from a finite raise).
const modId: ModIdentity = {
  aboveCapMassEur: 1e9,
  capEur: 2000,
  alphaLow: 2.0,
  alphaCentral: 2.4,
  alphaHigh: 2.8,
};
const cap = scoreModCap(modId, 2500, 2000);
check("scoreModCap raise > 0", cap.centralEur > 0);
check(
  "scoreModCap α order flips (low yields less than high)",
  cap.lowEur < cap.highEur,
);
check(
  "scoreModCap no-op (same cap) = 0",
  scoreModCap(modId, 2000, 2000).centralEur === 0,
);

console.log("\n=== expenditure scorers (synthetic) ===");
// Swiss-rule rate: (0.5×3 + 0.5×5)/100.
eq(
  "pensionIndexationRate blend",
  pensionIndexationRate(
    { massEur: 0, supplementMassEur: 0, cpiPct: 3, wageGrowthPct: 5 },
    0.5,
  ),
  0.04,
  1e-9,
);
// CPI-only (weight 1) vs current (0.5): with CPI 3 < wages 5, CPI-only spends LESS.
const penB = {
  massEur: 1e10,
  supplementMassEur: 1e9,
  cpiPct: 3,
  wageGrowthPct: 5,
};
check(
  "scorePensionIndexation CPI-only saves vs current law",
  scorePensionIndexation(penB, {
    cpiWeight: 1,
    indexSupplement: true,
    horizonYears: 1,
  }) < 0,
);
// Admin: a 10% cut fully absorbed by 20% vacancies → saves nothing.
const admB = {
  positionsTotal: 100000,
  positionsVacant: 20000,
  payrollEur: 1e9,
  coveredHeadcount: 80000,
};
const adm10 = scoreAdminCut(admB, 0.1);
eq("scoreAdminCut vacancies absorb 10% cut → net 0", adm10.netEur, 0);
eq("scoreAdminCut vacantAbsorbedShare = 1", adm10.vacantAbsorbedShare, 1, 1e-9);
const adm30 = scoreAdminCut(admB, 0.3);
// realLayoffs = 30000−20000 = 10000; cost/FTE = 1e9/80000 = 12500; gross 1.25e8.
eq("scoreAdminCut(30%) gross", adm30.grossEur, 1.25e8);
eq(
  "scoreAdminCut(30%) feedback = labourTaxFeedbackOnCost(gross)",
  adm30.revenueFeedbackEur,
  labourTaxFeedbackOnCost(1.25e8),
);
check(
  "scoreAdminCut net saving < gross",
  Math.abs(adm30.netEur) < adm30.grossEur,
);
// МРЗ freeze: a band below the formula floor forgoes SSC+PIT (negative).
check(
  "scoreMinWageFreeze forgoes revenue (< 0)",
  scoreMinWageFreeze([{ grossEur: 500, workers: 1000 }], {
    currentEur: 500,
    formulaEur: 600,
  }) < 0,
);
// Defense: (3.0−2.2)/100 × 1e11.
eq("scoreDefenseTarget 2.2→3.0", scoreDefenseTarget(1e11, 2.2, 3.0), 8e8, 1);
// Capital: 1e9 × −10% × 0.7 execution.
eq("scoreCapitalChange −10% @70%", scoreCapitalChange(1e9, 0.7, -10), -7e7, 1);
// SSC self-paid: −(wageBill × SSC_EMPLOYEE_RATE × (1−PIT_RATE)); grossUp → 0.
eq(
  "scoreSscSelfPaid",
  scoreSscSelfPaid(80000, 1500, false),
  -(80000 * 1500 * 12 * SSC_EMPLOYEE_RATE * (1 - PIT_RATE)),
  1,
);
eq("scoreSscSelfPaid grossUp = 0", scoreSscSelfPaid(80000, 1500, true), 0);

console.log("\n=== labour-tax feedback + the netted levers ===");
// salary feedback rate = SSC_COMBINED_BUDGET_RATE + (1−SSC_emp)×PIT.
const FB_RATE = SSC_COMBINED_BUDGET_RATE + (1 - SSC_EMPLOYEE_RATE) * PIT_RATE;
eq(
  "labourTaxFeedbackOnSalary(1000)",
  labourTaxFeedbackOnSalary(1000),
  1000 * FB_RATE,
  1e-6,
);
eq(
  "labourTaxFeedbackOnCost(cost) = OnSalary(cost/(1+employer))",
  labourTaxFeedbackOnCost(1e6),
  labourTaxFeedbackOnSalary(1e6 / (1 + EMPLOYER_SSC_RATE)),
  1e-6,
);
// Wage indexation: net = gross − OnCost(gross); ratio ≈ 0.694.
const wiNet = scoreWageIndexation(1e9, 0, 5, false);
eq(
  "scoreWageIndexation(+5%) net",
  wiNet,
  5e7 - labourTaxFeedbackOnCost(5e7),
  1,
);
check("scoreWageIndexation net/gross ≈ 0.694", near(wiNet / 5e7, 0.694, 0.002));
// Teachers' peg: net of the same feedback; at the current ratio → 0.
const tpNet = scoreTeachersPeg(100000, 1200, 1.0, 125);
const tpGross = 100000 * 1200 * 0.25 * (1 + EMPLOYER_SSC_RATE);
eq(
  "scoreTeachersPeg net = gross − OnCost",
  tpNet,
  tpGross - labourTaxFeedbackOnCost(tpGross),
  1,
);
eq(
  "scoreTeachersPeg at current ratio = 0",
  scoreTeachersPeg(100000, 1200, 1.0, 100),
  0,
);
// Health: net of the employee-share PIT deductibility; ratio ≈ 0.96.
eq(
  "scoreHealthContribution(+1pp) net",
  scoreHealthContribution(1e9, 1),
  1e7 - 1e7 * HEALTH_EMPLOYEE_SHARE * PIT_RATE,
  1,
);
check(
  "scoreHealthContribution net/gross ≈ 0.96",
  near(scoreHealthContribution(1e9, 1) / 1e7, 0.96, 1e-6),
);

console.log("\n=== pension floor / debate levers ===");
// Floor 300→400 over a band at mid 250 (effective = max(250,300)=300): 1e5×100×12.
eq(
  "scorePensionFloorRaise 300→400",
  scorePensionFloorRaise(
    [{ upToEur: 300, count: 100000, midEur: 250 }],
    300,
    400,
  ),
  100000 * 100 * 12,
  1,
);
eq(
  "scorePensionFloorRaise lower/equal = 0",
  scorePensionFloorRaise(
    [{ upToEur: 300, count: 100000, midEur: 250 }],
    300,
    300,
  ),
  0,
);
// Maternity: full 2nd-year cut = −€154.2M; half = −€77.1M; keep all = 0.
eq("scoreMaternityMonths(0) full cut", scoreMaternityMonths(0), -154_200_000);
eq("scoreMaternityMonths(6) half", scoreMaternityMonths(6), -77_100_000);
eq("scoreMaternityMonths(12) no change", scoreMaternityMonths(12), 0);
// MP pay freeze: −€18.9M × growth%/100.
eq("scoreMpPayFreeze(5%)", scoreMpPayFreeze(5), -945_000, 1);
eq("scoreMpPayFreeze(0%) = 0", scoreMpPayFreeze(0), 0);
// Party subsidy: (rate − €3.00) × 2.861M votes.
eq("scorePartySubsidy(0) abolish", scorePartySubsidy(0), -8_583_000, 1);
eq("scorePartySubsidy(3.0) no-op", scorePartySubsidy(3.0), 0);
eq(
  "scorePartySubsidy(4.09) restore old",
  scorePartySubsidy(4.09),
  1.09 * 2_861_000,
  1,
);

console.log("\n=== Tier-1 behavioral adapters (synthetic) ===");
eq(
  "marginalRateAt above threshold",
  marginalRateAt(700, [
    { fromEur: 0, rate: 0 },
    { fromEur: 620, rate: 0.1 },
  ]),
  0.1,
  1e-9,
);
eq(
  "marginalRateAt below threshold",
  marginalRateAt(500, [
    { fromEur: 0, rate: 0 },
    { fromEur: 620, rate: 0.1 },
  ]),
  0,
  1e-9,
);
// Corp/div offsets oppose a hike (negative) and are 0 at no change.
check(
  "corpBehavioralOffset hike < 0",
  corpBehavioralOffset(1e9, 0.1, 0.11, 0.8) < 0,
);
eq("corpBehavioralOffset no-op", corpBehavioralOffset(1e9, 0.1, 0.1, 0.8), 0);
check(
  "dividendBehavioralOffset hike < 0",
  dividendBehavioralOffset(1e8, 0.05, 0.1, 4.5) < 0,
);
// VAT: −staticΔ × g.
eq("vatBehavioralOffset", vatBehavioralOffset(1e9, 0.1), -1e8);
// МОД avoidance: a raise haircut; lowering carries none.
eq(
  "modBehavioralOffset raise",
  modBehavioralOffset(1e8, true, false, 0.1),
  -1e7,
);
eq(
  "modBehavioralOffset lowering = 0",
  modBehavioralOffset(-1e8, false, false, 0.1),
  0,
);
eq("healthBehavioralOffset", healthBehavioralOffset(1e7, 0.05), -5e5);
// Flat-rate PIT slice offset opposes a hike.
check(
  "pitFlatBehavioralOffset hike < 0",
  pitFlatBehavioralOffset(1e8, 0.1, 0.12, 0.5) < 0,
);

console.log("\n=== second-order recaptures (synthetic) ===");
// Maternity return-to-work: positive, scales with months, 0 at no cut / no return.
const matFull = maternityReturnOffset(12, 0.45);
check(
  "maternityReturnOffset(12,0.45) ∈ [€55M,€72M]",
  matFull >= 55e6 && matFull <= 72e6,
);
eq(
  "maternityReturnOffset(6,0.45) ≈ half",
  maternityReturnOffset(6, 0.45),
  matFull / 2,
  1,
);
eq("maternityReturnOffset(0,_) = 0", maternityReturnOffset(0, 0.45), 0);
eq("maternityReturnOffset(_,0) = 0", maternityReturnOffset(12, 0), 0);
// Dividend↔salary: a raise gains, a cut loses, no change = 0.
check(
  "dividendShiftRecaptureEur raise > 0",
  dividendShiftRecaptureEur(1e8, 0.05, 0.1, 4.5, 0.008) > 0,
);
check(
  "dividendShiftRecaptureEur cut < 0",
  dividendShiftRecaptureEur(1e8, 0.05, 0.03, 4.5, 0.008) < 0,
);
eq(
  "dividendShiftRecaptureEur no-op",
  dividendShiftRecaptureEur(1e8, 0.05, 0.05, 4.5, 0.008),
  0,
);
eq(
  "dividendShiftRecaptureEur 0 coef = 0",
  dividendShiftRecaptureEur(1e8, 0.05, 0.1, 4.5, 0),
  0,
);

console.log("\n=== Tier-2 macro feedback + RNG ===");
// Zero draw → no feedback. Central draw → a €1B tax consolidation gives back ~13%.
const z = zeroDraw(2.4);
const fbZero = computeMacroFeedback(0, 1e9, 0, undefined, z);
check(
  "computeMacroFeedback zero-draw = 0",
  fbZero.feedbackByYearEur.every((v) => v === 0),
);
const fbCentral = computeMacroFeedback(0, 1e9, 0, undefined, centralDraw(2.4));
const ratio = fbCentral.feedbackByYearEur[0] / 1e9;
check(
  `Tier-2 €1B tax → ${(ratio * 100).toFixed(1)}% ∈ [−16%,−10%]`,
  ratio >= -0.16 && ratio <= -0.1,
);
// mulberry32 determinism + range.
const r1 = mulberry32(123);
const r2 = mulberry32(123);
check(
  "mulberry32 same seed → identical",
  [0, 0, 0].every(() => r1() === r2()),
);
const r3 = mulberry32(1);
check(
  "mulberry32 ∈ [0,1)",
  [0, 0, 0, 0, 0].every(() => {
    const v = r3();
    return v >= 0 && v < 1;
  }),
);
// Triangular: endpoints + monotone in u.
const band = { low: 2, central: 5, high: 9, source: "" };
eq("sampleTriangular(0) = low", sampleTriangular(0, band), 2, 1e-9);
eq("sampleTriangular(1) = high", sampleTriangular(1, band), 9, 1e-9);
check(
  "sampleTriangular monotone",
  sampleTriangular(0.3, band) < sampleTriangular(0.7, band),
);

if (failures > 0) throw new Error(`${failures} engine unit test(s) failed`);
console.log("\nAll engine unit tests pass.");
