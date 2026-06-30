// AI-chat ↔ engine PARITY test. The chat tool (ai/tools/taxPolicy.ts) mirrors
// the simulator's scenario composition; this asserts, for EVERY lever, that
//   (1) detectTaxChange() parses the natural-language question to the right kind,
//   (2) scoreScenario()'s static headline equals an INDEPENDENT single-lever
//       recomputation from the raw engine functions over the live baseline.
// A wiring bug in the chat tool (wrong param map, missed feedback netting, sign
// flip, an un-surfaced lever) fails here. It locks the "every simulator lever is
// surfaced in chat" guarantee.
//
// Usage: npx tsx scripts/budget/__test_ai_parity.ts   (or: npm run budget:test)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  VAT_REDUCED_RATE,
  computeVatRevenue,
  scoreAdminCut,
  scoreCapitalChange,
  scoreCorporate,
  scoreDefenseTarget,
  scoreDividend,
  scoreHealthContribution,
  scoreMaternityMonths,
  scoreMinWageFreeze,
  scoreMpPayFreeze,
  scorePartySubsidy,
  scorePensionFloorRaise,
  scorePensionIndexation,
  scorePitSchedule,
  scoreRoadComponentUplift,
  scoreSoeSubsidyCut,
  scoreSscSelfPaid,
  SOE_SUBSIDY_BASE_EUR,
  scoreSpendingChange,
  SOCIAL_BENEFITS_BASE_EUR,
  INTEREST_BASE_EUR,
  SUBSIDIES_BASE_EUR,
  scoreTeachersPeg,
  scoreWageIndexation,
  PENSION_POLICY_CURRENT,
  type PitBracket,
  type VatBaseSlice,
  type VatPolicy,
} from "../../src/lib/bgTaxPolicy";
import { VAT_STANDARD_RATE, PIT_RATE } from "../../src/lib/bgTax";
import { NOMINAL_GDP_2026_EUR } from "../../src/lib/bgFiscalProjection";
import {
  detectTaxChange,
  scoreDynamicScenario,
  scoreScenario,
  type TaxChange,
} from "../../ai/tools/taxPolicy";
import type { PolicyBaselineFile } from "../../src/data/budget/types";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), "../..");
const baseline = JSON.parse(
  fs.readFileSync(
    path.join(PROJECT_ROOT, "data/budget/derived/policy_baseline.json"),
    "utf-8",
  ),
) as PolicyBaselineFile;

let failures = 0;
const check = (name: string, ok: boolean): void => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
};
const M = (v: number): string => `€${(v / 1e6).toFixed(1)}M`;

const exp = baseline.expenditure;
const rev = baseline.revenue;
const earn = baseline.earnings;

// VAT golden — re-run the household model at the new standard rate.
const vatGolden = (stdPct: number): number => {
  const cur: VatPolicy = {
    standardRate: VAT_STANDARD_RATE,
    reducedRate: VAT_REDUCED_RATE,
    regimes: {},
  };
  const next: VatPolicy = {
    standardRate: stdPct / 100,
    reducedRate: VAT_REDUCED_RATE,
    regimes: {},
  };
  const slices = baseline.vat.slices as VatBaseSlice[];
  return (
    (computeVatRevenue(slices, next).modeledEur -
      computeVatRevenue(slices, cur).modeledEur) *
    baseline.vat.factor
  );
};
const pitGolden = (pct: number): number => {
  const brackets: PitBracket[] = [{ fromEur: 0, rate: pct / 100 }];
  const emp = scorePitSchedule(earn.bands, earn.capEur, brackets, earn.kappa);
  const nonEmp =
    rev.pitEur * rev.pitNonEmploymentShare * (pct / 100 / PIT_RATE - 1);
  return emp + nonEmp;
};

// Each case: a NL question, the kind it must parse to, and the INDEPENDENT
// single-lever golden for scoreScenario().central (positive = balance improves;
// expenditure spend deltas enter the balance negated, like the simulator).
const cases: {
  q: string;
  kind: TaxChange["kind"];
  golden: number;
  tol?: number;
}[] = [
  {
    q: "какво става ако ддс стане 22%",
    kind: "vatStandard",
    golden: vatGolden(22),
  },
  {
    q: "what if income tax goes to 12%",
    kind: "pitFlat",
    golden: pitGolden(12),
  },
  {
    q: "корпоративният данък на 11%",
    kind: "corporate",
    golden: scoreCorporate(rev.corporateEur, 0.11),
  },
  {
    q: "данък дивидент на 10%",
    kind: "dividend",
    golden: scoreDividend(rev.dividendEur, 0.1),
  },
  {
    // "винетки" → the vignette slice only (≈€53M), not the whole base.
    q: "вдигане на винетките с 30%",
    kind: "roadCharges",
    golden: scoreRoadComponentUplift("vignette", 0.3),
  },
  {
    // "тол" → the тол slice only.
    q: "вдигане на тол таксите с 20%",
    kind: "roadCharges",
    golden: scoreRoadComponentUplift("toll", 0.2),
  },
  {
    // SOE-subsidy cut (balance convention: a cut improves the balance).
    q: "срязване на субсидиите за БДЖ с 50%",
    kind: "soeCut",
    golden: scoreSoeSubsidyCut(0.5 * SOE_SUBSIDY_BASE_EUR, 1),
  },
  {
    q: "съкращаване на администрацията с 10%",
    kind: "adminCut",
    golden: -scoreAdminCut(exp!.administration, 0.1).netEur,
  },
  // Pension indexation: "само по инфлация" pins CPI weight to 1.0 (current law
  // blends 50/50), keeping the supplement indexed and the current horizon. The
  // spend delta is NEGATIVE (less indexation) → balance improves, so the
  // contribution is its negation. Drives the formerly-frozen `/\+470/` literal.
  {
    q: "Какво става, ако пенсиите се индексират само по инфлация?",
    kind: "pensionIndexation",
    golden: -scorePensionIndexation(exp!.pensions, {
      cpiWeight: 1,
      indexSupplement: true,
      horizonYears: PENSION_POLICY_CURRENT.horizonYears,
    }),
  },
  // COVID supplement: keep the current blend weight, but stop indexing the
  // supplement slice (the only thing this lever changes). Formerly `/\+55/`.
  {
    q: "Ковид добавката да не се индексира",
    kind: "pensionSupplement",
    golden: -scorePensionIndexation(exp!.pensions, {
      cpiWeight: PENSION_POLICY_CURRENT.cpiWeight,
      indexSupplement: false,
      horizonYears: PENSION_POLICY_CURRENT.horizonYears,
    }),
  },
  // МРЗ freeze: scoreMinWageFreeze.netEur already carries the balance sign
  // (forgone private SSC/PIT minus avoided public payroll = net cost), so it
  // enters the balance as-is, NOT negated. Formerly `/−€115M/`.
  {
    q: "Freeze the minimum wage",
    kind: "minWageFreeze",
    golden: scoreMinWageFreeze(earn.bands, exp!.minWage).netEur,
  },
  // Defense %-of-GDP target — priced against the EC-consistent 2026 nominal GDP
  // (same base the tool uses, NOT gdpNextEur). More spend → balance worsens.
  {
    q: "Какво става, ако отбраната стане 3% от БВП?",
    kind: "defenseTarget",
    golden: -scoreDefenseTarget(
      NOMINAL_GDP_2026_EUR,
      exp!.defense.natoPctGdp,
      3.0,
    ),
  },
  // Capital plan −10%, scaled by the historical execution rate (cash effect).
  {
    q: "Капиталовите разходи -10%",
    kind: "capitalChange",
    golden: -scoreCapitalChange(
      exp!.capital.planEur,
      exp!.capital.executionRate,
      -10,
    ),
  },
  // Budget-paid categories take over the standard employee SSC share (no
  // gross-up compensation in the bare phrasing → grossUp:false).
  {
    q: "Държавните служители да си плащат осигуровките",
    kind: "sscSelfPaid",
    golden: -scoreSscSelfPaid(
      exp!.sscSelfPaid.count,
      exp!.sscSelfPaid.avgWageEur,
      false,
    ),
  },
  {
    q: "заплатите в публичния сектор +5%",
    kind: "wageIndexation",
    golden: -scoreWageIndexation(
      exp!.personnel.massEur,
      exp!.personnel.exemptShare,
      5,
      true,
    ),
  },
  {
    q: "здравната вноска +1 пункт",
    kind: "healthContribution",
    golden: scoreHealthContribution(exp!.health.baseEur, 1),
  },
  // June-2026 debate levers (the parity these tests primarily guard):
  {
    q: "съкращаване на майчинството до 1 година",
    kind: "maternity",
    golden: -scoreMaternityMonths(0),
  },
  {
    q: "учителските заплати на 125% от средната",
    kind: "teachersPeg",
    golden: -scoreTeachersPeg(
      exp!.teachers!.count,
      exp!.teachers!.economyWageEur,
      exp!.teachers!.currentRatio,
      125,
    ),
  },
  {
    q: "минималната пенсия на 400 €",
    kind: "pensionFloor",
    golden: -scorePensionFloorRaise(
      exp!.pensionFloor!.bands,
      exp!.pensionFloor!.minimumEur,
      400,
    ),
  },
  {
    q: "замразяване на депутатските заплати",
    kind: "mpPayFreeze",
    golden: -scoreMpPayFreeze(exp!.pensions.wageGrowthPct),
  },
  {
    q: "премахване на партийните субсидии",
    kind: "partySubsidy",
    golden: -scorePartySubsidy(0),
  },
  // Spending-expansion levers (raise = more spending = worse balance, so the
  // balance contribution is negative). Bases prefer the live policy_baseline
  // figures, fall back to the constants — same resolution as both UI + AI.
  {
    q: "социалните разходи +10%",
    kind: "spendingChange",
    golden: -scoreSpendingChange(
      exp?.socialBenefits?.baseEur ?? SOCIAL_BENEFITS_BASE_EUR,
      10,
    ),
  },
  {
    q: "лихвите по дълга +10%",
    kind: "spendingChange",
    golden: -scoreSpendingChange(
      exp?.interest?.baseEur ?? INTEREST_BASE_EUR,
      10,
    ),
  },
  {
    q: "субсидиите +20%",
    kind: "spendingChange",
    golden: -scoreSpendingChange(
      exp?.subsidies?.baseEur ?? SUBSIDIES_BASE_EUR,
      20,
    ),
  },
];

console.log("=== AI tool ↔ engine parity (per lever) ===");
for (const c of cases) {
  const ch = detectTaxChange(c.q);
  check(`parse "${c.q}" → ${c.kind}`, !!ch && ch.kind === c.kind);
  if (!ch || ch.kind !== c.kind) continue;
  const central = scoreScenario(baseline, ch).central;
  check(
    `  central ${M(central)} ≈ engine golden ${M(c.golden)}`,
    Math.abs(central - c.golden) <= (c.tol ?? 1),
  );
}

console.log("\n=== dynamic surfacing of the second-order recaptures ===");
// Maternity: the chat's dynamic headline must EXCEED the static saving (the
// return-to-work PIT+SSC recapture is surfaced), bounded by the central band.
const matCh = detectTaxChange("съкращаване на майчинството до 1 година")!;
const matScore = scoreScenario(baseline, matCh);
const matDyn = scoreDynamicScenario(baseline, matCh, matScore);
check(
  `maternity: dynamic ${M(matDyn.headlineEur)} > static ${M(matScore.central)} by €30–80M (recapture surfaced)`,
  matDyn.headlineEur > matScore.central + 30e6 &&
    matDyn.headlineEur < matScore.central + 80e6,
);
// Dividend raise: the chat surfaces the behavioral correction (dynamic < static).
const divCh = detectTaxChange("данък дивидент на 10%")!;
const divScore = scoreScenario(baseline, divCh);
const divDyn = scoreDynamicScenario(baseline, divCh, divScore);
check(
  `dividend 5→10%: dynamic ${M(divDyn.headlineEur)} < static ${M(divScore.central)} (behavioral leakage surfaced)`,
  divDyn.headlineEur < divScore.central && divDyn.headlineEur > 0,
);

// Road charges are an UPLIFT-only lever (slider 0..100), so a cut phrasing must
// fall through (detect → undefined) rather than degenerate to a +0% no-op; the
// positive uplift still parses to a roadCharges change.
check(
  'road-charge cut "намаляване на винетките с 30%" falls through (not a +0% no-op)',
  detectTaxChange("намаляване на винетките с 30%") === undefined,
);
const roadUp = detectTaxChange("вдигане на винетките с 30%");
check(
  "road-charge uplift parses to roadCharges",
  !!roadUp && roadUp.kind === "roadCharges",
);

console.log(
  "\n=== road split: dynamic offset is per-component (FINDING-001) ===",
);
// The Tier-1 diversion offset runs on the тол slice only — a vignette-only
// change keeps ~all its static € dynamically (just the shared Tier-2 macro
// feedback), while a тол-only change of equal % loses MORE per € to diversion.
const vignCh: TaxChange = {
  kind: "roadCharges",
  pct: 30,
  component: "vignette",
};
const tollCh: TaxChange = { kind: "roadCharges", pct: 30, component: "toll" };
const vignSc = scoreScenario(baseline, vignCh);
const vignDyn = scoreDynamicScenario(baseline, vignCh, vignSc);
const tollSc = scoreScenario(baseline, tollCh);
const tollDyn = scoreDynamicScenario(baseline, tollCh, tollSc);
const vignKeep = vignDyn.headlineEur / vignSc.central; // fraction retained
const tollKeep = tollDyn.headlineEur / tollSc.central;
check(
  `vignette-only keeps ≥80% of static dynamically (no Tier-1 haircut; ${(vignKeep * 100).toFixed(1)}%)`,
  vignDyn.headlineEur > 0 && vignKeep >= 0.8,
);
check(
  `тол-only retains LESS than vignette (diversion haircut; тол ${(tollKeep * 100).toFixed(1)}% < vignette ${(vignKeep * 100).toFixed(1)}%)`,
  tollKeep < vignKeep,
);

console.log("\n=== soeCut graceful degradation (TEST-002) ===");
// soeDeltaSpend is gated on `exp && soe > 0`; with no expenditure baseline the
// SOE cut silently contributes €0 (consistent with mpf/psub) — no throw.
const noExpBaseline = {
  ...baseline,
  expenditure: undefined,
} as unknown as PolicyBaselineFile;
const soeNoExp = scoreScenario(noExpBaseline, { kind: "soeCut", sharePct: 50 });
check(
  "soeCut with no expenditure baseline → €0 (documented degradation)",
  soeNoExp.central === 0,
);

if (failures > 0) throw new Error(`${failures} AI-parity test(s) failed`);
console.log("\nAll AI ↔ engine parity tests pass.");
