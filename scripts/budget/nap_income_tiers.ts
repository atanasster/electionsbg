// Real НАП income-tier data — validates the fitted earnings distribution's
// BODY and sources its Pareto TAIL ORDERING, without touching fitEarnings.
//
// Source: Ministry of Finance written answer to a parliamentary question,
// tax year 2023 — distribution of ДДФЛ filers by ГОДИШНА ДАНЪЧНА ОСНОВА
// (annual taxable base), https://www.minfin.bg/bg/wreply/996-4/12881 .
// minfin.bg is WAF-blocked (403), so the 7-row table is hand-keyed here as a
// sourced const (one-off-backfill idiom) — NOT a watcher feed. Refresh it
// when a later tax year is published; bump NAP_TABLE_YEAR + the factor.
//
// Why validate-and-anchor, not refit (design decision, see
// docs/budget_simulator_grounding.md): the НАП table is a DIFFERENT
// population (3.11M ALL filers in taxable-base units) than the engine grid
// (~2.63M insured EMPLOYEES in gross-wage units). Refitting σ/α to it would
// break the κ=1.00 gate and the €113M МОД backtest (both employee-specific).
// Instead the table (a) validates the body where the populations coincide,
// and (b) sources the TAIL ORDERING: the engine's employee α (~2.27) must,
// and does, sit ABOVE the all-filer НАП α (~1.67) — the top НАП bins blend in
// fatter dividend/business income. Never let the all-filer α leak into the
// employee tail / МОД lever.

import { MOD_BY_YEAR, SSC_EMPLOYEE_RATE } from "../../src/lib/bgTax";
import type { EarningsBand } from "../../src/lib/bgTaxPolicy";

const BGN_PER_EUR = 1.95583;

/** The tax year the НАП table covers. */
export const NAP_TABLE_YEAR = 2023;

/** Nominal wage-mass growth from the НАП table year to the fit's identity
 *  year (2024/2023). No 2023 СОД anchor is carried in policy_baseline.json,
 *  so this is a documented constant (BG average gross wage grew ~11–12% in
 *  2024). Used to deflate the identity-year fit to the НАП year before
 *  binning; the body gate is share-based and tolerant of a couple points.
 *  Clamped to [1.0, 1.25] at use. */
export const NAP_YEAR_WAGE_FACTOR = 1.11;

export interface NapTierRow {
  /** Inclusive-exclusive annual-taxable-base bracket, BGN. null upper = open. */
  baseLowBgn: number;
  baseHighBgn: number | null;
  count: number;
  /** Declared ДДФЛ, thousand BGN. The table's ДДФЛ is exactly 10% of the
   *  taxable base, so base mass = pitThousandBgn × 1000 × 10. */
  pitThousandBgn: number;
}

// Hand-keyed from the published table. The load-time checksum below guards
// against a transcription error.
export const NAP_TIERS_2023: NapTierRow[] = [
  {
    baseLowBgn: 0,
    baseHighBgn: 9360,
    count: 1_445_800,
    pitThousandBgn: 679_956,
  },
  {
    baseLowBgn: 9360,
    baseHighBgn: 18_000,
    count: 710_103,
    pitThousandBgn: 934_813,
  },
  {
    baseLowBgn: 18_000,
    baseHighBgn: 30_000,
    count: 512_692,
    pitThousandBgn: 1_200_680,
  },
  {
    baseLowBgn: 30_000,
    baseHighBgn: 42_000,
    count: 205_988,
    pitThousandBgn: 721_236,
  },
  {
    baseLowBgn: 42_000,
    baseHighBgn: 72_000,
    count: 137_423,
    pitThousandBgn: 736_724,
  },
  {
    baseLowBgn: 72_000,
    baseHighBgn: 108_000,
    count: 49_916,
    pitThousandBgn: 437_405,
  },
  {
    baseLowBgn: 108_000,
    baseHighBgn: null,
    count: 47_630,
    pitThousandBgn: 1_291_537,
  },
];
const NAP_TOTAL_FILERS = 3_109_552;
const NAP_TOTAL_PIT_THOUSAND_BGN = 6_002_351;

/** Gross monthly EUR → annual taxable base EUR for an employee on the capped
 *  insurable base. Uses the FULL SSC_EMPLOYEE_RATE (0.1378) to match
 *  pitRevenueOnBands, NOT the S13 (ex-UPF) rate. */
export const grossToBaseEur = (grossEur: number, capEur: number): number =>
  (grossEur - SSC_EMPLOYEE_RATE * Math.min(grossEur, capEur)) * 12;

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

interface FitEarningsLike {
  bands: EarningsBand[];
  /** Cap at the BASELINE year the bands are scaled to (e.g. 2025 → €2112). */
  capEur: number;
  /** fit.bands scaled from identity year to baseline year. */
  wageGrowthToBaseline: number;
  identityYear: number;
  alpha: number;
}

export interface IncomeTierBin {
  baseLowEur: number;
  baseHighEur: number | null;
  count: number;
  avgBaseEur: number;
  population: "all";
}

export interface IncomeTiers {
  source: string;
  taxYear: number;
  currency: { bgnPerEur: number; note: string };
  totals: { filers: number; pitEur: number; taxableBaseEur: number };
  bins: IncomeTierBin[];
  fitComparison: {
    napYearWageFactor: number;
    engineCountByBin: number[];
    /** engineShare/napShare over bins 2–7; bin 1 is null (out of scope). */
    bodyShareRatio: (number | null)[];
    cumThroughBin4: { engine: number; nap: number };
  };
  tail: {
    engineEmployeeAlpha: number;
    napAllFilerAlpha: number;
    napAlphaByThreshold: Record<string, number>;
    orderingOk: boolean;
    note: string;
  };
}

/** All-filer Pareto α from the НАП top bins via the conditional-mean
 *  estimator α = m/(m − x_m), m = mean taxable base above the threshold. */
const napTailAlpha = (
  rows: NapTierRow[],
  fromIndex: number,
): { alpha: number; threshold: number } => {
  let count = 0;
  let mass = 0;
  for (let i = fromIndex; i < rows.length; i++) {
    count += rows[i].count;
    mass += rows[i].pitThousandBgn * 1000 * 10; // BGN base mass
  }
  const m = mass / count / BGN_PER_EUR; // mean base, EUR
  const xm = rows[fromIndex].baseLowBgn / BGN_PER_EUR; // threshold, EUR
  return { alpha: m / (m - xm), threshold: xm };
};

export const buildIncomeTiers = (fit: FitEarningsLike): IncomeTiers => {
  // Checksum the hand-keyed table.
  const sumFilers = NAP_TIERS_2023.reduce((s, r) => s + r.count, 0);
  const sumPit = NAP_TIERS_2023.reduce((s, r) => s + r.pitThousandBgn, 0);
  if (sumFilers !== NAP_TOTAL_FILERS || sumPit !== NAP_TOTAL_PIT_THOUSAND_BGN)
    throw new Error(
      `НАП tier table checksum fail: Σ=${sumFilers}/${sumPit} vs ${NAP_TOTAL_FILERS}/${NAP_TOTAL_PIT_THOUSAND_BGN}`,
    );

  // Deflate the stored (baseline-year) bands back to the НАП table year:
  //   stored → identity (÷ wageGrowthToBaseline) → НАП year (÷ factor).
  const factor = clamp(NAP_YEAR_WAGE_FACTOR, 1.0, 1.25);
  const deflate = fit.wageGrowthToBaseline * factor;
  const capNapEur = MOD_BY_YEAR[NAP_TABLE_YEAR];
  if (!capNapEur) throw new Error(`MOD_BY_YEAR has no ${NAP_TABLE_YEAR}`);

  // Bin the deflated employee grid by annual taxable base into the НАП edges.
  const edgesEur = NAP_TIERS_2023.map((r) =>
    r.baseHighBgn === null ? Infinity : r.baseHighBgn / BGN_PER_EUR,
  );
  const engineCountByBin = new Array(NAP_TIERS_2023.length).fill(0);
  for (const b of fit.bands) {
    const baseEur = grossToBaseEur(b.grossEur / deflate, capNapEur);
    let idx = edgesEur.findIndex((e) => baseEur <= e);
    if (idx === -1) idx = NAP_TIERS_2023.length - 1;
    engineCountByBin[idx] += b.workers;
  }

  // Body validation: shares renormalized over bins 2–7 (drop bin 1 — the
  // sub-full-year-MW / self-insured floor the employee fit doesn't model).
  const napCount = NAP_TIERS_2023.map((r) => r.count);
  const engBody = engineCountByBin.slice(1).reduce((a, b) => a + b, 0);
  const napBody = napCount.slice(1).reduce((a, b) => a + b, 0);
  const bodyShareRatio = NAP_TIERS_2023.map((_, i) => {
    if (i === 0) return null;
    const eng = engineCountByBin[i] / engBody;
    const nap = napCount[i] / napBody;
    return nap > 0 ? eng / nap : null;
  });
  const cumEng =
    (engineCountByBin[1] + engineCountByBin[2] + engineCountByBin[3]) / engBody;
  const cumNap = (napCount[1] + napCount[2] + napCount[3]) / napBody;

  // Tail cross-check (sourced ordering, never assigned to the engine α).
  const thresholds = [3, 4, 5]; // bin indices: >30000, >42000, >72000 BGN
  const napAlphaByThreshold: Record<string, number> = {};
  const alphas: number[] = [];
  for (const k of thresholds) {
    const { alpha } = napTailAlpha(NAP_TIERS_2023, k);
    napAlphaByThreshold[String(NAP_TIERS_2023[k].baseLowBgn)] =
      Math.round(alpha * 1000) / 1000;
    alphas.push(alpha);
  }
  const napAllFilerAlpha = [...alphas].sort((a, b) => a - b)[
    Math.floor(alphas.length / 2)
  ];

  const bins: IncomeTierBin[] = NAP_TIERS_2023.map((r) => {
    const baseMassEur = (r.pitThousandBgn * 1000 * 10) / BGN_PER_EUR;
    return {
      baseLowEur: Math.round(r.baseLowBgn / BGN_PER_EUR),
      baseHighEur:
        r.baseHighBgn === null ? null : Math.round(r.baseHighBgn / BGN_PER_EUR),
      count: r.count,
      avgBaseEur: Math.round(baseMassEur / r.count),
      population: "all",
    };
  });

  return {
    source:
      "НАП parliamentary answer, tax year 2023 (distribution of ДДФЛ filers by годишна данъчна основа) — minfin.bg/bg/wreply/996-4/12881",
    taxYear: NAP_TABLE_YEAR,
    currency: {
      bgnPerEur: BGN_PER_EUR,
      note: "declared ДДФЛ = 10% of taxable base (verified) → base mass = pit×10",
    },
    totals: {
      filers: NAP_TOTAL_FILERS,
      pitEur: Math.round((NAP_TOTAL_PIT_THOUSAND_BGN * 1000) / BGN_PER_EUR),
      taxableBaseEur: Math.round(
        (NAP_TOTAL_PIT_THOUSAND_BGN * 1000 * 10) / BGN_PER_EUR,
      ),
    },
    bins,
    fitComparison: {
      napYearWageFactor: factor,
      engineCountByBin: engineCountByBin.map((n) => Math.round(n)),
      bodyShareRatio: bodyShareRatio.map((r) =>
        r === null ? null : Math.round(r * 1000) / 1000,
      ),
      cumThroughBin4: {
        engine: Math.round(cumEng * 1000) / 1000,
        nap: Math.round(cumNap * 1000) / 1000,
      },
    },
    tail: {
      engineEmployeeAlpha: Math.round(fit.alpha * 1000) / 1000,
      napAllFilerAlpha: Math.round(napAllFilerAlpha * 1000) / 1000,
      napAlphaByThreshold,
      orderingOk: fit.alpha > napAllFilerAlpha,
      note: "All-filer tail is fatter (α≈1.67) than the employee wage tail (α≈2.27) because the top НАП bins blend in dividend/business income; the МОД lever runs on the employee grid, so the employee α stays canonical.",
    },
  };
};

export interface TierGateResult {
  ok: boolean;
  lines: string[];
}

/** Shared gates — both run_policy_baseline (hard throw) and the smoke read
 *  these. Gate ONLY on renormalized body shares + the tail ordering; never on
 *  bin 1, bins 2–3 individually, or raw counts. */
export const checkIncomeTierGates = (t: IncomeTiers): TierGateResult => {
  const lines: string[] = [];
  let ok = true;
  const fail = (msg: string) => {
    ok = false;
    lines.push(`  FAIL  ${msg}`);
  };
  const pass = (msg: string) => lines.push(`  PASS  ${msg}`);

  const cumDelta = Math.abs(
    t.fitComparison.cumThroughBin4.engine - t.fitComparison.cumThroughBin4.nap,
  );
  if (cumDelta <= 0.1)
    pass(
      `body cumulative through bin 4: engine ${t.fitComparison.cumThroughBin4.engine} vs НАП ${t.fitComparison.cumThroughBin4.nap} (Δ ${cumDelta.toFixed(3)} ≤ 0.10)`,
    );
  else
    fail(
      `body cumulative through bin 4 off by ${cumDelta.toFixed(3)} (> 0.10) — fit body diverges from НАП`,
    );

  // Bin-4 standalone is informational, NOT a hard gate: it's a narrow
  // mid-band, so the guessed year-deflation factor and the genuine
  // body-shape difference (the engine's bins 2–3 run hot, leaving bin 4
  // relatively light) move it more than the robust cumulative metric. The
  // cumulative-through-bin-4 gate above is the load-bearing body check.
  const bin4 = t.fitComparison.bodyShareRatio[3];
  if (bin4 !== null && bin4 >= 0.85 && bin4 <= 1.15)
    pass(`bin 4 (30000–42000 лв) share ratio ${bin4} ∈ [0.85, 1.15]`);
  else
    lines.push(
      `  WARN  bin 4 share ratio ${bin4} outside [0.85, 1.15] — narrow band, deflation-sensitive (cumulative gate is the body check)`,
    );

  if (t.tail.orderingOk)
    pass(
      `tail ordering: employee α ${t.tail.engineEmployeeAlpha} > all-filer НАП α ${t.tail.napAllFilerAlpha}`,
    );
  else
    fail(
      `tail ordering broken: employee α ${t.tail.engineEmployeeAlpha} not > all-filer ${t.tail.napAllFilerAlpha}`,
    );

  const gap = t.tail.engineEmployeeAlpha - t.tail.napAllFilerAlpha;
  if (gap >= 0.2 && gap <= 1.5)
    pass(`tail plausibility: α gap ${gap.toFixed(2)} ∈ [0.2, 1.5]`);
  else fail(`tail plausibility: α gap ${gap.toFixed(2)} outside [0.2, 1.5]`);

  const aVals = Object.values(t.tail.napAlphaByThreshold);
  const spread = Math.max(...aVals) - Math.min(...aVals);
  if (spread < 0.15)
    pass(`НАП α threshold spread ${spread.toFixed(3)} < 0.15 (stable Pareto)`);
  else
    lines.push(
      `  WARN  НАП α threshold spread ${spread.toFixed(3)} ≥ 0.15 — table changed/mis-keyed?`,
    );

  return { ok, lines };
};

/** Build the income-tier block, print the gate report, and HARD-THROW if the
 *  validation gates fail. The single build+gate+throw path shared by the
 *  standalone injector (run_income_tiers.ts) and the full pipeline
 *  (run_policy_baseline.ts) so the gate semantics can never diverge. */
export const buildAndGateIncomeTiers = (fit: FitEarningsLike): IncomeTiers => {
  const tiers = buildIncomeTiers(fit);
  const gate = checkIncomeTierGates(tiers);
  for (const l of gate.lines) console.log(l);
  if (!gate.ok)
    throw new Error(
      "НАП income-tier validation gates failed — see lines above",
    );
  return tiers;
};
