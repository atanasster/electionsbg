// Smoke test for the expenditure-side levers (pension indexation,
// administration cuts, МРЗ freeze) over policy_baseline.json — exercises the
// SAME engine functions the simulator uses.
//
// Sanity targets:
//   CPI-only Swiss rule   ≈ −€450-500M/yr at 2025-26 input spreads
//   supplement excluded   ≈ −(supplement mass × blend rate) ≈ −€55-60M
//   admin −5%             ≈ €0 — vacancies absorb the whole cut (the honest
//                         gotcha a naive payroll×% slider hides)
//
// Usage:
//   npx tsx scripts/budget/__smoke_expenditure.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  pensionIndexationRate,
  scoreAdminCut,
  scoreMinWageFreeze,
  scorePensionIndexation,
  type EarningsBand,
} from "../../src/lib/bgTaxPolicy";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");

const b = JSON.parse(
  fs.readFileSync(
    path.join(PROJECT_ROOT, "data/budget/derived/policy_baseline.json"),
    "utf-8",
  ),
) as {
  earnings: { bands: EarningsBand[] };
  expenditure: {
    pensions: Parameters<typeof scorePensionIndexation>[0] & {
      pensionerCount: number;
    };
    administration: Parameters<typeof scoreAdminCut>[0] & {
      positionsVacant: number;
    };
    minWage: { currentEur: number; formulaEur: number };
  };
};
const e = b.expenditure;
const M = (v: number): string =>
  `${v >= 0 ? "+" : "−"}€${Math.abs(v / 1e6).toFixed(0)}M`;

const blend = pensionIndexationRate(e.pensions, 0.5) * 100;
console.log(
  `Pension mass €${(e.pensions.massEur / 1e9).toFixed(1)}B (${"year" in e.pensions ? (e.pensions as { year?: number }).year : ""}) · ` +
    `Swiss blend ${blend.toFixed(2)}% (CPI ${e.pensions.cpiPct.toFixed(2)} / wages ${e.pensions.wageGrowthPct.toFixed(2)})`,
);
for (const [label, policy] of [
  [
    "CPI-only (само инфлация)",
    { cpiWeight: 1, indexSupplement: true, horizonYears: 1 },
  ],
  [
    "income-only (само доходи)",
    { cpiWeight: 0, indexSupplement: true, horizonYears: 1 },
  ],
  [
    "ковид добавката НЕ се индексира",
    { cpiWeight: 0.5, indexSupplement: false, horizonYears: 1 },
  ],
  [
    "CPI-only, 3-годишен хоризонт",
    { cpiWeight: 1, indexSupplement: true, horizonYears: 3 },
  ],
] as const) {
  console.log(
    `  ${label}: ${M(scorePensionIndexation(e.pensions, policy))}/yr`,
  );
}

console.log(
  `\nAdministration: ${e.administration.positionsTotal} positions, ` +
    `${e.administration.positionsVacant} vacant, cost/FTE €${Math.round(e.administration.payrollEur / e.administration.coveredHeadcount)}`,
);
for (const share of [0.05, 0.1, 0.2]) {
  const r = scoreAdminCut(e.administration, share);
  console.log(
    `  −${share * 100}%: net ${M(r.netEur)}/yr (gross −€${(r.grossEur / 1e6).toFixed(0)}M, feedback €${(r.revenueFeedbackEur / 1e6).toFixed(0)}M, ` +
      `${(r.vacantAbsorbedShare * 100).toFixed(0)}% absorbed by vacancies)`,
  );
}

const mw = scoreMinWageFreeze(b.earnings.bands, e.minWage);
console.log(
  `\nМРЗ freeze at €${e.minWage.currentEur} vs formula €${e.minWage.formulaEur}: ${M(mw)}/yr revenue`,
);

// --- Phase-5 levers ---------------------------------------------------------
import {
  scoreCapitalChange,
  scoreDefenseTarget,
  scoreHealthContribution,
  scoreSscSelfPaid,
  scoreWageIndexation,
} from "../../src/lib/bgTaxPolicy";

const b2 = JSON.parse(
  fs.readFileSync(
    path.join(PROJECT_ROOT, "data/budget/derived/policy_baseline.json"),
    "utf-8",
  ),
) as {
  gdpNextEur: number;
  expenditure: {
    personnel: { massEur: number; exemptShare: number };
    defense: { natoPctGdp: number };
    capital: { planEur: number; executionRate: number };
    sscSelfPaid: { count: number; avgWageEur: number };
    health: { baseEur: number };
  };
};
const x = b2.expenditure;
// Wage indexation / teachers' peg / health now report NET of the mechanical
// labour-tax feedback (the budget collects ~30.6% of indexed pay back as
// PIT+SSC, and the employee's health-contribution share is PIT-deductible) —
// consistent with scoreAdminCut. Gross magnitudes are ~1.44× these.
console.log(`\nPhase-5 levers (balance convention, negative = costs):`);
console.log(
  `  отбрана 2.06 → 3.0% от БВП: ${M(-scoreDefenseTarget(b2.gdpNextEur, x.defense.natoPctGdp, 3.0))}/yr`,
);
console.log(
  `  заплати +5% (без изключени сектори): ${M(-scoreWageIndexation(x.personnel.massEur, x.personnel.exemptShare, 5, true))}/yr · всички: ${M(-scoreWageIndexation(x.personnel.massEur, x.personnel.exemptShare, 5, false))}/yr`,
);
console.log(
  `  капиталов план −10% (изпълнение ${Math.round(x.capital.executionRate * 100)}%): ${M(-scoreCapitalChange(x.capital.planEur, x.capital.executionRate, -10))}/yr`,
);
console.log(
  `  ДС плащат осигуровките си: ${M(-scoreSscSelfPaid(x.sscSelfPaid.count, x.sscSelfPaid.avgWageEur, false))}/yr · с компенсация: ${M(-scoreSscSelfPaid(x.sscSelfPaid.count, x.sscSelfPaid.avgWageEur, true))}/yr`,
);
console.log(
  `  здравна вноска +1 п.п.: ${M(scoreHealthContribution(x.health.baseEur, 1))}/yr`,
);

// --- pension floor + teachers' peg ------------------------------------------
import { BGN_PER_EUR } from "../../src/lib/currency";
import {
  scorePensionFloorRaise,
  scoreTeachersPeg,
  type PensionFloorBand,
} from "../../src/lib/bgTaxPolicy";

const b3 = JSON.parse(
  fs.readFileSync(
    path.join(PROJECT_ROOT, "data/budget/derived/policy_baseline.json"),
    "utf-8",
  ),
) as {
  expenditure: {
    pensionFloor: {
      asOf: string;
      minimumEur: number;
      totalPensioners: number;
      bands: PensionFloorBand[];
    };
    teachers: {
      count: number;
      economyWageEur: number;
      sectorWageEur: number;
      currentRatio: number;
    };
  };
};
const pf = b3.expenditure.pensionFloor;
console.log(
  `\nPension floor: minimum €${pf.minimumEur} (${pf.asOf}), ` +
    `${pf.totalPensioners} pensioners, ${pf.bands.length} bands ≤ €700`,
);
// НОИ validation printout — the band-grain model's implied CURRENT top-up
// cost vs НОИ's published ~131.6M лв/month (Yearbook 2024 table 5.8). The
// midpoint grain undershoots (pensions cluster AT the per-type minima on
// the band edges, and наследствени top up to 241.78, not 322.37) — the
// warn-level gate lives in run_policy_baseline.ts.
const impliedTopupEur = pf.bands.reduce(
  (a, b) => a + b.count * Math.max(0, pf.minimumEur - b.midEur),
  0,
);
const noiTopupEur = 131.6e6 / BGN_PER_EUR;
console.log(
  `  implied current top-up €${(impliedTopupEur / 1e6).toFixed(1)}M/mo vs НОИ ~€${(noiTopupEur / 1e6).toFixed(1)}M/mo (×${(impliedTopupEur / noiTopupEur).toFixed(2)})`,
);
for (const target of [400, 450]) {
  console.log(
    `  минимална пенсия ${pf.minimumEur} → €${target}: ${M(-scorePensionFloorRaise(pf.bands, pf.minimumEur, target))}/yr`,
  );
}

const tch = b3.expenditure.teachers;
console.log(
  `\nTeachers: ${tch.count} (ISCED 1-3), sector wage €${Math.round(tch.sectorWageEur)} vs economy €${Math.round(tch.economyWageEur)} → ratio ${(tch.currentRatio * 100).toFixed(1)}%`,
);
for (const target of [125, 135]) {
  console.log(
    `  учителски заплати → ${target}% от средната: ${M(-scoreTeachersPeg(tch.count, tch.economyWageEur, tch.currentRatio, target))}/yr`,
  );
}
const zero = scoreTeachersPeg(
  tch.count,
  tch.economyWageEur,
  tch.currentRatio,
  tch.currentRatio * 100,
);
console.log(
  `  → current ratio (${(tch.currentRatio * 100).toFixed(2)}%): €${zero} (must be exactly 0)`,
);
if (zero !== 0) throw new Error("teachers' peg at the current ratio must be 0");

// --- labour-tax feedback netting locks (added 2026-06-12) ------------------
// Wage indexation & the teachers' peg must net ~30.6% of the gross labour cost
// back as PIT+SSC; the health contribution nets ~4% (employee-share PIT
// deductibility). These lock the second-order refinement at the engine level
// (the AI parity/regression numbers downstream assume exactly these).
{
  const wgGross = x.personnel.massEur * 0.05;
  const wgRatio =
    scoreWageIndexation(
      x.personnel.massEur,
      x.personnel.exemptShare,
      5,
      false,
    ) / wgGross;
  const thGross =
    tch.count * tch.economyWageEur * (1.25 - tch.currentRatio) * 1.1902;
  const thRatio =
    scoreTeachersPeg(tch.count, tch.economyWageEur, tch.currentRatio, 125) /
    thGross;
  const hpRatio =
    scoreHealthContribution(x.health.baseEur, 1) / (x.health.baseEur * 0.01);
  console.log(
    `\nFeedback netting: wage +5% net/gross ${wgRatio.toFixed(3)}, teachers→125% ${thRatio.toFixed(3)} (both ~0.694), health +1пп ${hpRatio.toFixed(3)} (~0.96)`,
  );
  if (!(wgRatio > 0.69 && wgRatio < 0.7))
    throw new Error(
      `wage indexation must net the labour-tax feedback (got ${wgRatio})`,
    );
  if (!(thRatio > 0.69 && thRatio < 0.7))
    throw new Error(
      `teachers' peg must net the labour-tax feedback (got ${thRatio})`,
    );
  if (!(hpRatio > 0.955 && hpRatio < 0.965))
    throw new Error(
      `health contribution must net the PIT deductibility (got ${hpRatio})`,
    );
}
