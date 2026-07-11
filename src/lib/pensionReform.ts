// The pension reform sandbox engine — a CRFB-"Reformer"-style model for the ДОО
// pension deficit. Pure and deterministic: given a baseline and a set of lever
// positions, it returns the deficit after the reform, the share of the deficit
// closed, and a per-lever breakdown. The UI (PensionReformTile) is a thin shell
// over this.
//
// Every lever reuses a scorer that already exists and is validated in
// scripts/budget/run_policy_baseline.ts, so the sandbox cannot silently diverge
// from the tax simulator:
//   - contribution rate   → Δrevenue on the insurable wage base
//   - Swiss-rule indexation → scorePensionIndexation
//   - minimum pension     → scorePensionFloorRaise
//   - pension cap (таван)  → savings above the cap, from the size distribution
//
// The deficit is ДОО's state-budget transfer (section III of the B1 report — the
// money that is NOT covered by contributions). "% closed" = how much of that
// transfer the reform package removes. Retirement age is intentionally omitted
// (it needs an actuarial cohort model, not a static elasticity).

import {
  scorePensionIndexation,
  scorePensionFloorRaise,
  PENSION_POLICY_CURRENT,
  type PensionBaseline,
  type PensionFloorBand,
} from "./bgTaxPolicy";
import { BGN_PER_EUR } from "./currency";

export interface PensionReformBaseline {
  /** ДОО state-budget transfer = the deficit to close, EUR/yr. */
  deficitEur: number;
  /** Nominal GDP, EUR, for the "% of GDP" readout. */
  gdpEur: number;
  /** Total ДОО pension expenditure, EUR/yr (for context). */
  pensionMassEur: number;
  pension: PensionBaseline;
  floorBands: PensionFloorBand[];
  currentMinEur: number;
  /** Insurable wage base, EUR/yr = Σ min(gross, cap) × workers × 12. */
  insurableBaseEur: number;
  /** Current pension cap (таван), EUR/mo. */
  currentCapEur: number;
  /** Pension size distribution (from pensions.json) for the cap lever and the
   *  distributional readout — bracket edges in EUR/mo + head counts. */
  distribution: { loEur: number | null; hiEur: number | null; count: number }[];
}

export interface PensionReformLevers {
  /** Percentage points added to the pension contribution rate (0 = today). */
  contributionRateDeltaPp: number;
  /** Swiss-rule CPI weight (current law 0.5; lower = leans to wage growth). */
  cpiWeight: number;
  /** New minimum pension, EUR/mo (default = current). */
  minPensionEur: number;
  /** New pension cap, EUR/mo (default = current; lower = savings). */
  capEur: number;
}

export interface LeverEffect {
  id: "contributions" | "indexation" | "minPension" | "cap";
  /** Δ to the deficit, EUR/yr. Negative = the deficit SHRINKS (good). */
  deficitDeltaEur: number;
  /** True when this lever spends money / needs more transfer. */
  costsMoney: boolean;
}

export interface PensionReformResult {
  deficitAfterEur: number;
  /** Fraction of the baseline deficit removed (can be negative if widened). */
  pctClosed: number;
  deficitPctGdpBefore: number;
  deficitPctGdpAfter: number;
  levers: LeverEffect[];
  /** Human-checkable warnings (constraint violations). */
  warnings: { id: string; bg: string; en: string }[];
}

export const defaultLevers = (
  b: PensionReformBaseline,
): PensionReformLevers => ({
  contributionRateDeltaPp: 0,
  cpiWeight: PENSION_POLICY_CURRENT.cpiWeight,
  minPensionEur: b.currentMinEur,
  capEur: b.currentCapEur,
});

/** Savings from lowering the pension cap to `newCapEur`: pensioners whose
 *  pension exceeds the new cap are trimmed to it. Bracket-midpoint grain from
 *  the size distribution; 0 when the cap is not lowered. EUR/yr, positive. */
const capSavingsEur = (
  distribution: PensionReformBaseline["distribution"],
  currentCapEur: number,
  newCapEur: number,
): number => {
  if (newCapEur >= currentCapEur) return 0;
  let monthly = 0;
  for (const brk of distribution) {
    // Representative pension for the bracket = its midpoint (open top bracket
    // uses its lower edge — conservative, understates the saving).
    const mid =
      brk.hiEur != null && brk.loEur != null
        ? (brk.loEur + brk.hiEur) / 2
        : (brk.loEur ?? brk.hiEur ?? 0);
    if (mid > newCapEur) monthly += brk.count * (mid - newCapEur);
  }
  return monthly * 12;
};

export const runPensionReform = (
  b: PensionReformBaseline,
  levers: PensionReformLevers,
): PensionReformResult => {
  // Revenue lever — extra contribution points on the insurable base.
  const revenueDelta =
    (levers.contributionRateDeltaPp / 100) * b.insurableBaseEur;

  // Expenditure levers.
  const indexationDelta = scorePensionIndexation(b.pension, {
    cpiWeight: levers.cpiWeight,
    indexSupplement: PENSION_POLICY_CURRENT.indexSupplement,
    horizonYears: 1,
  });
  const floorDelta = scorePensionFloorRaise(
    b.floorBands,
    b.currentMinEur,
    levers.minPensionEur,
  );
  const capDelta = -capSavingsEur(
    b.distribution,
    b.currentCapEur,
    levers.capEur,
  );

  const levEffects: LeverEffect[] = [
    { id: "contributions", deficitDeltaEur: -revenueDelta, costsMoney: false },
    {
      id: "indexation",
      deficitDeltaEur: indexationDelta,
      costsMoney: indexationDelta > 0,
    },
    {
      id: "minPension",
      deficitDeltaEur: floorDelta,
      costsMoney: floorDelta > 0,
    },
    { id: "cap", deficitDeltaEur: capDelta, costsMoney: false },
  ];

  const totalDelta = levEffects.reduce((s, l) => s + l.deficitDeltaEur, 0);
  const deficitAfterEur = b.deficitEur + totalDelta;
  const pctClosed = b.deficitEur > 0 ? -totalDelta / b.deficitEur : 0;

  const warnings: PensionReformResult["warnings"] = [];
  if (levers.minPensionEur > levers.capEur)
    warnings.push({
      id: "min-above-cap",
      bg: "Минималната пенсия е над тавана — невъзможна комбинация.",
      en: "The minimum pension exceeds the cap — an impossible combination.",
    });
  if (levers.contributionRateDeltaPp > 10)
    warnings.push({
      id: "contrib-extreme",
      bg: "Увеличение над 10 пр.п. в осигуровките е извън реалистичния диапазон.",
      en: "A contribution rise above 10pp is outside the realistic range.",
    });
  if (deficitAfterEur < 0)
    warnings.push({
      id: "surplus",
      bg: "Пакетът извежда ДОО на излишък — вероятно надценява ефекта.",
      en: "The package pushes ДОО into surplus — it likely overstates the effect.",
    });

  return {
    deficitAfterEur,
    pctClosed,
    deficitPctGdpBefore: b.gdpEur > 0 ? b.deficitEur / b.gdpEur : 0,
    deficitPctGdpAfter: b.gdpEur > 0 ? deficitAfterEur / b.gdpEur : 0,
    levers: levEffects,
    warnings,
  };
};

/** Build the insurable wage base from the fitted earnings bands (monthly gross
 *  × workers, capped at the МОД ceiling), annualised. */
export const insurableBaseFromEarnings = (
  bands: { grossEur: number; workers: number }[],
  capEur: number,
): number => {
  let monthly = 0;
  for (const bnd of bands)
    monthly += Math.min(bnd.grossEur, capEur) * bnd.workers;
  return monthly * 12;
};

/** лв → EUR, for converting pensions.json distribution edges (which are in лв). */
export const levToEur = (lev: number | null): number | null =>
  lev == null ? null : lev / BGN_PER_EUR;
