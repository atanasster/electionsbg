// Real НАП income-tier data — the distribution of ДДФЛ filers by ГОДИШНА
// ДАНЪЧНА ОСНОВА (annual taxable base), one table per tax year. Three jobs:
//
//   1. VALIDATE the fitted employee earnings distribution's BODY against the
//      ANCHOR year (never refit — see below);
//   2. SOURCE its Pareto TAIL ORDERING (employee α must sit above all-filer α);
//   3. SCORE the non-employment slice of ДДФЛ under a bracket schedule, via
//      `allFilerGrid` (a discretized all-filer distribution of the anchor
//      table, scaled to the baseline year). Before this, the non-employment
//      slice only ever scaled with the base rate, so a second bracket raised
//      nothing on freelance / rental / other annual-base income.
//
// Sources (hand-keyed as sourced consts — one-off-backfill idiom, NOT a
// watcher feed; each table carries a checksum against its printed total):
//   2023 — МФ written answer to a parliamentary question,
//          https://www.minfin.bg/bg/wreply/996-4/12881 (minfin.bg is
//          WAF-blocked, so the table could not be fetched).
//   2020, 2022, 2024 — НАП answer to our ЗДОИ request, рег. № ЕО-22-30-853 #3
//          от 14.09.2026 (the request was forwarded by МФ по компетентност;
//          МФ's own decision № 43 / 01.09.2026 covers 2019, 2021, 2023).
//          Data from Декларация образец 1 + ГДД по чл. 50 ЗДДФЛ; each table is
//          a snapshot at its own `asOf` date and is NOT comparable with the
//          cash execution of the ДДФЛ line for the same year (НАП's own note).
// Bracket edges differ every year, so years are never compared bin by bin.
//
// Why validate-and-anchor, not refit (design decision, see
// docs/budget_simulator_grounding.md): the НАП table is a DIFFERENT
// population (~3.1M ALL filers in taxable-base units) than the engine grid
// (~2.63M insured EMPLOYEES in gross-wage units). Refitting σ/α to it would
// break the κ=1.00 gate and the €113M МОД backtest (both employee-specific).
// The all-filer tail is fatter because the top НАП bins blend in business /
// self-employed income. Never let the all-filer α leak into the employee
// tail / МОД lever — `allFilerGrid` scores ONLY the non-employment slice.

import { MOD_BY_YEAR, SSC_EMPLOYEE_RATE } from "../../src/lib/bgTax";
import type { AllFilerPoint, EarningsBand } from "../../src/lib/bgTaxPolicy";

const BGN_PER_EUR = 1.95583;

export interface NapTierRow {
  /** Exclusive-lower / inclusive-upper annual-taxable-base bracket, BGN
   *  (the tables print „>lo и <=hi"). null upper = open top bracket. */
  baseLowBgn: number;
  baseHighBgn: number | null;
  count: number;
  /** Declared ДДФЛ, thousand BGN. The ДДФЛ is exactly 10% of the taxable
   *  base, so base mass = pitThousandBgn × 1000 × 10. */
  pitThousandBgn: number;
}

export interface NapTierTable {
  taxYear: number;
  source: string;
  /** The date НАП states the data was current at (null = not stated). */
  asOf: string | null;
  rows: NapTierRow[];
  /** Printed totals — the checksum a transcription error must fail. */
  totalFilers: number;
  totalPitThousandBgn: number;
}

const SRC_ZDOI =
  "НАП, отговор по ЗДОИ рег. № ЕО-22-30-853 от 14.09.2026 (препратено от МФ)";
const SRC_2023 = "МФ, писмен отговор — minfin.bg/bg/wreply/996-4/12881";

// Hand-keyed from the published tables (ДДФЛ printed in млн. лв with one
// decimal → ×1000 for thousand BGN; 2023 was printed in thousand BGN).
export const NAP_TIER_TABLES: NapTierTable[] = [
  {
    taxYear: 2020,
    source: SRC_ZDOI,
    asOf: "2021-12-22",
    rows: [
      {
        baseLowBgn: 0,
        baseHighBgn: 7320,
        count: 1_533_243,
        pitThousandBgn: 566_300,
      },
      {
        baseLowBgn: 7320,
        baseHighBgn: 12_000,
        count: 555_788,
        pitThousandBgn: 526_000,
      },
      {
        baseLowBgn: 12_000,
        baseHighBgn: 36_000,
        count: 801_645,
        pitThousandBgn: 1_548_200,
      },
      {
        baseLowBgn: 36_000,
        baseHighBgn: 60_000,
        count: 84_699,
        pitThousandBgn: 386_600,
      },
      {
        baseLowBgn: 60_000,
        baseHighBgn: 120_000,
        count: 45_671,
        pitThousandBgn: 369_200,
      },
      {
        baseLowBgn: 120_000,
        baseHighBgn: null,
        count: 18_018,
        pitThousandBgn: 586_800,
      },
    ],
    totalFilers: 3_039_064,
    totalPitThousandBgn: 3_983_100,
  },
  {
    taxYear: 2022,
    source: SRC_ZDOI,
    asOf: "2024-08-23",
    rows: [
      {
        baseLowBgn: 0,
        baseHighBgn: 8520,
        count: 1_468_529,
        pitThousandBgn: 628_900,
      },
      {
        baseLowBgn: 8520,
        baseHighBgn: 12_000,
        count: 382_537,
        pitThousandBgn: 388_600,
      },
      {
        baseLowBgn: 12_000,
        baseHighBgn: 24_000,
        count: 719_724,
        pitThousandBgn: 1_240_600,
      },
      {
        baseLowBgn: 24_000,
        baseHighBgn: 36_000,
        count: 262_599,
        pitThousandBgn: 758_100,
      },
      {
        baseLowBgn: 36_000,
        baseHighBgn: 60_000,
        count: 133_526,
        pitThousandBgn: 605_700,
      },
      {
        baseLowBgn: 60_000,
        baseHighBgn: 120_000,
        count: 71_542,
        pitThousandBgn: 586_600,
      },
      {
        baseLowBgn: 120_000,
        baseHighBgn: null,
        count: 30_038,
        pitThousandBgn: 1_002_100,
      },
    ],
    totalFilers: 3_068_495,
    totalPitThousandBgn: 5_210_600,
  },
  {
    taxYear: 2023,
    source: SRC_2023,
    asOf: null,
    rows: [
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
    ],
    totalFilers: 3_109_552,
    totalPitThousandBgn: 6_002_351,
  },
  {
    taxYear: 2024,
    source: SRC_ZDOI,
    asOf: "2025-07-28",
    rows: [
      {
        baseLowBgn: 0,
        baseHighBgn: 12_000,
        count: 1_590_689,
        pitThousandBgn: 952_000,
      },
      {
        baseLowBgn: 12_000,
        baseHighBgn: 24_000,
        count: 761_226,
        pitThousandBgn: 1_316_100,
      },
      {
        baseLowBgn: 24_000,
        baseHighBgn: 36_000,
        count: 408_467,
        pitThousandBgn: 1_197_100,
      },
      {
        baseLowBgn: 36_000,
        baseHighBgn: 48_000,
        count: 164_048,
        pitThousandBgn: 675_900,
      },
      {
        baseLowBgn: 48_000,
        baseHighBgn: 60_000,
        count: 73_562,
        pitThousandBgn: 394_000,
      },
      {
        baseLowBgn: 60_000,
        baseHighBgn: 72_000,
        count: 41_558,
        pitThousandBgn: 273_900,
      },
      {
        baseLowBgn: 72_000,
        baseHighBgn: 84_000,
        count: 27_070,
        pitThousandBgn: 211_200,
      },
      {
        baseLowBgn: 84_000,
        baseHighBgn: 96_000,
        count: 19_246,
        pitThousandBgn: 173_800,
      },
      {
        baseLowBgn: 96_000,
        baseHighBgn: null,
        count: 74_758,
        pitThousandBgn: 1_779_000,
      },
    ],
    totalFilers: 3_160_624,
    // The printed total is 6 972,9 while the rows sum to 6 973,0 — rounding
    // of the per-row млн. лв figures; the checksum tolerates exactly that.
    totalPitThousandBgn: 6_972_900,
  },
];

/** The table the fit is validated against and `allFilerGrid` is built from:
 *  the latest year, which is also the fit's identity year (no deflation). */
export const NAP_ANCHOR_YEAR = 2024;

/** Nominal wage growth from a table year to the fit's identity year, keyed
 *  "table->identity". Needed only when the two differ; a missing pair throws
 *  rather than guessing. 2023→2024: BG average gross wage grew ~11–12%. */
const WAGE_FACTOR_TO_IDENTITY: Record<string, number> = { "2023->2024": 1.11 };

/** Checksum: filers must match exactly; ДДФЛ within the rounding the printed
 *  one-decimal млн. лв figures allow (0.05 млн = 50 thousand per row). */
export const checkTableChecksum = (t: NapTierTable): void => {
  const filers = t.rows.reduce((s, r) => s + r.count, 0);
  const pit = t.rows.reduce((s, r) => s + r.pitThousandBgn, 0);
  const tol = 50 * t.rows.length;
  if (filers !== t.totalFilers || Math.abs(pit - t.totalPitThousandBgn) > tol)
    throw new Error(
      `НАП tier table ${t.taxYear} checksum fail: Σ=${filers}/${pit} vs ${t.totalFilers}/${t.totalPitThousandBgn}`,
    );
  for (let i = 1; i < t.rows.length; i++)
    if (t.rows[i].baseLowBgn !== t.rows[i - 1].baseHighBgn)
      throw new Error(
        `НАП tier table ${t.taxYear}: bracket edges not contiguous at row ${i + 1}`,
      );
};

export const napTierTable = (year: number): NapTierTable => {
  const t = NAP_TIER_TABLES.find((x) => x.taxYear === year);
  if (!t) throw new Error(`no НАП tier table for ${year}`);
  return t;
};

/** Gross monthly EUR → annual taxable base EUR for an employee on the capped
 *  insurable base. Uses the FULL SSC_EMPLOYEE_RATE (0.1378) to match
 *  pitRevenueOnBands, NOT the S13 (ex-UPF) rate. */
export const grossToBaseEur = (grossEur: number, capEur: number): number =>
  (grossEur - SSC_EMPLOYEE_RATE * Math.min(grossEur, capEur)) * 12;

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

export interface IncomeTierYear {
  taxYear: number;
  source: string;
  asOf: string | null;
  totals: { filers: number; pitEur: number; taxableBaseEur: number };
  /** Share of all ДДФЛ paid by the open top bracket, and its lower edge. */
  topBin: { baseLowEur: number; filersShare: number; pitShare: number };
  bins: IncomeTierBin[];
}

export interface IncomeTiers {
  source: string;
  taxYear: number;
  asOf: string | null;
  currency: { bgnPerEur: number; note: string };
  totals: { filers: number; pitEur: number; taxableBaseEur: number };
  bins: IncomeTierBin[];
  fitComparison: {
    napYearWageFactor: number;
    engineCountByBin: number[];
    /** engineShare/napShare over bins 2..n; bin 1 is null (out of scope). */
    bodyShareRatio: (number | null)[];
    /** Cumulative body share through bin 4 (= base ≤ `throughBaseEur`). */
    cumThroughBin4: { engine: number; nap: number; throughBaseEur: number };
  };
  tail: {
    engineEmployeeAlpha: number;
    napAllFilerAlpha: number;
    napAlphaByThreshold: Record<string, number>;
    orderingOk: boolean;
    note: string;
  };
  /** Discretized all-filer distribution of the anchor table at the BASELINE
   *  year, in MONTHLY taxable-base EUR — scores the non-employment slice of
   *  ДДФЛ under a bracket schedule (see scorePitNonEmployment). */
  allFilerGrid: AllFilerPoint[];
  /** Every table we hold, oldest first — the multi-year view. */
  history: IncomeTierYear[];
}

/** All-filer Pareto α from the НАП top bins via the conditional-mean
 *  estimator α = m/(m − x_m), m = mean taxable base above the threshold. */
const napTailAlpha = (rows: NapTierRow[], fromIndex: number): number => {
  let count = 0;
  let mass = 0;
  for (let i = fromIndex; i < rows.length; i++) {
    count += rows[i].count;
    mass += rows[i].pitThousandBgn * 1000 * 10;
  }
  const m = mass / count;
  const xm = rows[fromIndex].baseLowBgn;
  return m / (m - xm);
};

const baseMassBgn = (r: NapTierRow): number => r.pitThousandBgn * 1000 * 10;

const toBins = (rows: NapTierRow[]): IncomeTierBin[] =>
  rows.map((r) => ({
    baseLowEur: Math.round(r.baseLowBgn / BGN_PER_EUR),
    baseHighEur:
      r.baseHighBgn === null ? null : Math.round(r.baseHighBgn / BGN_PER_EUR),
    count: r.count,
    avgBaseEur: Math.round(baseMassBgn(r) / BGN_PER_EUR / r.count),
    population: "all",
  }));

const yearSummary = (t: NapTierTable): IncomeTierYear => {
  const top = t.rows[t.rows.length - 1];
  const pitSum = t.rows.reduce((s, r) => s + r.pitThousandBgn, 0);
  return {
    taxYear: t.taxYear,
    source: t.source,
    asOf: t.asOf,
    totals: {
      filers: t.totalFilers,
      pitEur: Math.round((t.totalPitThousandBgn * 1000) / BGN_PER_EUR),
      taxableBaseEur: Math.round(
        (t.totalPitThousandBgn * 1000 * 10) / BGN_PER_EUR,
      ),
    },
    topBin: {
      baseLowEur: Math.round(top.baseLowBgn / BGN_PER_EUR),
      filersShare: Math.round((top.count / t.totalFilers) * 10000) / 10000,
      pitShare: Math.round((top.pitThousandBgn / pitSum) * 10000) / 10000,
    },
    bins: toBins(t.rows),
  };
};

/** Points per closed bracket / for the open top bracket. */
const SUB_POINTS = 12;
const TAIL_POINTS = 24;

/** Discretize one table into (annual base BGN, filers) points whose per-bin
 *  count AND mass match the table exactly. Closed bins: a linear density on
 *  [lo, hi] fitted to the bin mean (slope clamped to stay non-negative), then
 *  an affine pull toward `lo` so the mean is exact. Open top bin: Pareto
 *  quantile midpoints with α from the bin's own conditional mean, then the
 *  excess over x_m rescaled so the mean is exact (midpoints understate it). */
export const discretizeTable = (
  t: NapTierTable,
): { baseBgn: number; filers: number }[] => {
  const pts: { baseBgn: number; filers: number }[] = [];
  for (const r of t.rows) {
    const mean = baseMassBgn(r) / r.count;
    const lo = r.baseLowBgn;
    if (r.baseHighBgn === null) {
      const alpha = mean / (mean - lo);
      const xs: number[] = [];
      for (let k = 0; k < TAIL_POINTS; k++) {
        const u = (k + 0.5) / TAIL_POINTS;
        xs.push(lo * Math.pow(1 - u, -1 / alpha));
      }
      const xbar = xs.reduce((a, b) => a + b, 0) / xs.length;
      const s = (mean - lo) / (xbar - lo);
      for (const x of xs)
        pts.push({ baseBgn: lo + (x - lo) * s, filers: r.count / TAIL_POINTS });
      continue;
    }
    const w = r.baseHighBgn - lo;
    const tbar = (mean - lo) / w;
    const c = Math.max(-1, Math.min(1, 6 * (tbar - 0.5)));
    const xs: number[] = [];
    const ws: number[] = [];
    for (let k = 0; k < SUB_POINTS; k++) {
      const tk = (k + 0.5) / SUB_POINTS;
      xs.push(lo + tk * w);
      ws.push(1 + c * (2 * tk - 1));
    }
    const wsum = ws.reduce((a, b) => a + b, 0);
    const xbar = xs.reduce((a, x, i) => a + x * ws[i], 0) / wsum;
    const s = xbar > lo ? (mean - lo) / (xbar - lo) : 1;
    for (let i = 0; i < xs.length; i++)
      pts.push({
        baseBgn: lo + (xs[i] - lo) * s,
        filers: (r.count * ws[i]) / wsum,
      });
  }
  return pts;
};

export const buildIncomeTiers = (fit: FitEarningsLike): IncomeTiers => {
  for (const t of NAP_TIER_TABLES) checkTableChecksum(t);
  const anchor = napTierTable(NAP_ANCHOR_YEAR);
  const rows = anchor.rows;

  // Deflate the stored (baseline-year) bands back to the anchor year:
  //   stored → identity (÷ wageGrowthToBaseline) → anchor year (÷ factor).
  let factor = 1;
  if (anchor.taxYear !== fit.identityYear) {
    const f = WAGE_FACTOR_TO_IDENTITY[`${anchor.taxYear}->${fit.identityYear}`];
    if (!f)
      throw new Error(
        `no wage factor ${anchor.taxYear}->${fit.identityYear} in WAGE_FACTOR_TO_IDENTITY — curate it or move NAP_ANCHOR_YEAR`,
      );
    factor = f;
  }
  const deflate = fit.wageGrowthToBaseline * factor;
  const capAnchorEur = MOD_BY_YEAR[anchor.taxYear];
  if (!capAnchorEur) throw new Error(`MOD_BY_YEAR has no ${anchor.taxYear}`);

  // Bin the deflated employee grid by annual taxable base into the НАП edges.
  const edgesEur = rows.map((r) =>
    r.baseHighBgn === null ? Infinity : r.baseHighBgn / BGN_PER_EUR,
  );
  const engineCountByBin = new Array(rows.length).fill(0);
  for (const b of fit.bands) {
    const baseEur = grossToBaseEur(b.grossEur / deflate, capAnchorEur);
    let idx = edgesEur.findIndex((e) => baseEur <= e);
    if (idx === -1) idx = rows.length - 1;
    engineCountByBin[idx] += b.workers;
  }

  // Body validation: shares renormalized over bins 2..n (drop bin 1 — the
  // part-year / self-insured floor the full-year employee fit doesn't model).
  const napCount = rows.map((r) => r.count);
  const engBody = engineCountByBin.slice(1).reduce((a, b) => a + b, 0);
  const napBody = napCount.slice(1).reduce((a, b) => a + b, 0);
  const bodyShareRatio = rows.map((_, i) => {
    if (i === 0) return null;
    const eng = engineCountByBin[i] / engBody;
    const nap = napCount[i] / napBody;
    return nap > 0 ? eng / nap : null;
  });
  const cumEng =
    (engineCountByBin[1] + engineCountByBin[2] + engineCountByBin[3]) / engBody;
  const cumNap = (napCount[1] + napCount[2] + napCount[3]) / napBody;

  // Tail cross-check (sourced ordering, never assigned to the engine α):
  // every bracket starting between 30 000 and 110 000 лв is a threshold.
  const napAlphaByThreshold: Record<string, number> = {};
  const alphas: number[] = [];
  rows.forEach((r, k) => {
    if (r.baseLowBgn < 30_000 || r.baseLowBgn > 110_000) return;
    const alpha = napTailAlpha(rows, k);
    napAlphaByThreshold[String(r.baseLowBgn)] = Math.round(alpha * 1000) / 1000;
    alphas.push(alpha);
  });
  const sorted = [...alphas].sort((a, b) => a - b);
  const napAllFilerAlpha = sorted[Math.floor(sorted.length / 2)];

  // All-filer grid at the BASELINE year, monthly taxable-base EUR. Scaled
  // anchor → identity (× factor) → baseline (× wageGrowthToBaseline), the
  // same growth the employee bands carry, so the two grids stay in step.
  const scale = factor * fit.wageGrowthToBaseline;
  const allFilerGrid: AllFilerPoint[] = discretizeTable(anchor).map((p) => ({
    baseEur: Math.round(((p.baseBgn * scale) / BGN_PER_EUR / 12) * 100) / 100,
    filers: Math.round(p.filers * 10) / 10,
  }));

  const summary = yearSummary(anchor);
  return {
    source: `${anchor.source} — distribution of ДДФЛ filers by годишна данъчна основа, tax year ${anchor.taxYear}`,
    taxYear: anchor.taxYear,
    asOf: anchor.asOf,
    currency: {
      bgnPerEur: BGN_PER_EUR,
      note: "declared ДДФЛ = 10% of taxable base → base mass = pit×10; tables are in лв, converted at the peg",
    },
    totals: summary.totals,
    bins: summary.bins,
    fitComparison: {
      napYearWageFactor: factor,
      engineCountByBin: engineCountByBin.map((n) => Math.round(n)),
      bodyShareRatio: bodyShareRatio.map((r) =>
        r === null ? null : Math.round(r * 1000) / 1000,
      ),
      cumThroughBin4: {
        engine: Math.round(cumEng * 1000) / 1000,
        nap: Math.round(cumNap * 1000) / 1000,
        throughBaseEur: Math.round((rows[3].baseHighBgn ?? 0) / BGN_PER_EUR),
      },
    },
    tail: {
      engineEmployeeAlpha: Math.round(fit.alpha * 1000) / 1000,
      napAllFilerAlpha: Math.round(napAllFilerAlpha * 1000) / 1000,
      napAlphaByThreshold,
      orderingOk: fit.alpha > napAllFilerAlpha,
      note: "The all-filer tail is fatter than the employee wage tail because the top НАП bins blend in business / self-employed income; the МОД lever runs on the employee grid, so the employee α stays canonical.",
    },
    allFilerGrid,
    history: NAP_TIER_TABLES.map(yearSummary),
  };
};

export interface TierGateResult {
  ok: boolean;
  lines: string[];
}

/** Shared gates — both run_policy_baseline (hard throw) and the smoke read
 *  these. Gate ONLY on renormalized body shares + the tail ordering; never on
 *  bin 1, individual narrow bins, or raw counts. */
export const checkIncomeTierGates = (t: IncomeTiers): TierGateResult => {
  const lines: string[] = [];
  let ok = true;
  const fail = (msg: string) => {
    ok = false;
    lines.push(`  FAIL  ${msg}`);
  };
  const pass = (msg: string) => lines.push(`  PASS  ${msg}`);

  const c = t.fitComparison.cumThroughBin4;
  const cumDelta = Math.abs(c.engine - c.nap);
  if (cumDelta <= 0.1)
    pass(
      `body cumulative through bin 4 (base ≤ €${c.throughBaseEur}/yr): engine ${c.engine} vs НАП ${c.nap} (Δ ${cumDelta.toFixed(3)} ≤ 0.10)`,
    );
  else
    fail(
      `body cumulative through bin 4 off by ${cumDelta.toFixed(3)} (> 0.10) — fit body diverges from НАП ${t.taxYear}`,
    );

  // Bin-4 standalone is informational, NOT a hard gate: a narrow mid-band
  // moves more with the body-shape difference than the cumulative does.
  const bin4 = t.fitComparison.bodyShareRatio[3];
  if (bin4 !== null && bin4 >= 0.85 && bin4 <= 1.15)
    pass(`bin 4 share ratio ${bin4} ∈ [0.85, 1.15]`);
  else
    lines.push(
      `  WARN  bin 4 share ratio ${bin4} outside [0.85, 1.15] — narrow band (cumulative gate is the body check)`,
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
  if (spread < 0.25)
    pass(`НАП α threshold spread ${spread.toFixed(3)} < 0.25 (stable Pareto)`);
  else
    lines.push(
      `  WARN  НАП α threshold spread ${spread.toFixed(3)} ≥ 0.25 — table changed/mis-keyed?`,
    );

  // The grid must reproduce the anchor table's filers and base mass (it is
  // what scores the non-employment slice, so a drift here is a wrong answer).
  const gFilers = t.allFilerGrid.reduce((s, p) => s + p.filers, 0);
  const gMassMonthly = t.allFilerGrid.reduce(
    (s, p) => s + p.filers * p.baseEur,
    0,
  );
  const filerErr = Math.abs(gFilers / t.totals.filers - 1);
  if (filerErr < 0.001)
    pass(
      `all-filer grid filers ${Math.round(gFilers)} ≈ table ${t.totals.filers}`,
    );
  else
    fail(
      `all-filer grid filers ${Math.round(gFilers)} vs table ${t.totals.filers}`,
    );
  if (gMassMonthly > 0)
    pass(
      `all-filer grid base mass €${((gMassMonthly * 12) / 1e9).toFixed(1)}B/yr at the baseline year`,
    );
  else fail("all-filer grid has no base mass");

  // Every held year must still pass its checksum (a mis-keyed row fails here).
  for (const y of t.history)
    if (y.bins.reduce((s, b) => s + b.count, 0) !== y.totals.filers)
      fail(`history ${y.taxYear}: bins do not sum to the printed filer total`);
  pass(`history holds ${t.history.map((y) => y.taxYear).join(", ")}`);

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
