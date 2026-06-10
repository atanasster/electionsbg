// Smoke test for the fitted earnings distribution behind the bracket
// scoring and МОД incidence on /budget/simulator. Reads the emitted
// policy_baseline.json and exercises the SAME engine the client uses.
//
// What to look for:
//   κ (identity year)  ≈ 1.00 — the grid at the flat 10% reproduces the
//                      НАП employment-PIT line (the validation gate;
//                      run_policy_baseline.ts refuses to write outside ±8%)
//   share above cap    vs the ~6% of insured persons at/above the maximum
//                      that НОИ/МФ figures circulate
//   2025 cap raise     the fitted-α backtest of the legislated 3 750→4 130
//                      BGN raise vs МФ's own ~€128M estimate
//
// Usage:
//   npx tsx scripts/budget/run_policy_baseline.ts   # refresh inputs first
//   npx tsx scripts/budget/__smoke_earnings.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { MOD_BY_YEAR } from "../../src/lib/bgTax";
import {
  pitRevenueOnBands,
  scoreModCap,
  scoreModCapBands,
  scorePitSchedule,
  type EarningsBand,
  type ModIdentity,
  type PitBracket,
} from "../../src/lib/bgTaxPolicy";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");

interface BaselineFile {
  baselineYear: number;
  revenue: {
    pitEur: number;
    pitEmploymentShare: number;
    pitNonEmploymentShare: number;
  };
  earnings: {
    identityYear: number;
    sesWave: number;
    sigmaLower: number;
    sigmaUpper: number;
    medianEur: number;
    nEmployees: number;
    alpha: number;
    shareAboveCap: number;
    wageGrowthToBaseline: number;
    kappaIdentityYear: number;
    kappa: number;
    capEur: number;
    bands: EarningsBand[];
  };
  modIdentity: ModIdentity & { year: number };
}

const M = (v: number): string => `€${(v / 1e6).toFixed(0)}M`;

const main = (): void => {
  const b = JSON.parse(
    fs.readFileSync(
      path.join(PROJECT_ROOT, "data/budget/derived/policy_baseline.json"),
      "utf-8",
    ),
  ) as BaselineFile;
  const e = b.earnings;

  console.log(`Earnings fit (identity year ${e.identityYear}):`);
  console.log(
    `  σ_lower ${e.sigmaLower.toFixed(3)} / σ_upper ${e.sigmaUpper.toFixed(3)} (SES ${e.sesWave}) · ` +
      `median €${e.medianEur.toFixed(0)} (baseline-year level) · N ${(e.nEmployees / 1e6).toFixed(2)}M`,
  );
  console.log(
    `  Pareto α ${e.alpha.toFixed(2)} · ${(e.shareAboveCap * 100).toFixed(1)}% above cap ` +
      `(${Math.round((e.nEmployees * e.shareAboveCap) / 1000)}k people; published figures say ~6%)`,
  );
  console.log(
    `  κ identity-year ${e.kappaIdentityYear.toFixed(3)} (gate ±8%) · κ baseline-year ${e.kappa.toFixed(3)}`,
  );

  // Backtest: the legislated 2025 raise, scored with the FITTED α via the
  // closed form at the identity-year cap (МФ's own estimate ~€128M).
  const raise = scoreModCap(b.modIdentity, MOD_BY_YEAR[2025]);
  console.log(
    `\n2025 cap raise backtest (fitted α): ${M(raise.centralEur)} central, ` +
      `${M(raise.lowEur)}…${M(raise.highEur)} (МФ scored ~€128M)`,
  );

  // Scenario spot-checks through the band engine at the baseline year.
  const flatBase = pitRevenueOnBands(e.bands, e.capEur, [
    { fromEur: 0, rate: 0.1 },
  ]);
  console.log(
    `\nBand grid at flat 10% → €${(flatBase / 1e9).toFixed(2)}B ` +
      `(κ-scaled €${((flatBase * e.kappa) / 1e9).toFixed(2)}B vs employment portion €${((b.revenue.pitEur * b.revenue.pitEmploymentShare) / 1e9).toFixed(2)}B)`,
  );

  const score = (label: string, brackets: PitBracket[]): void => {
    const delta = scorePitSchedule(e.bands, e.capEur, brackets, e.kappa);
    console.log(
      `  ${label}: ${delta >= 0 ? "+" : "−"}${M(Math.abs(delta))}/yr`,
    );
  };
  console.log(`\nBracket scenarios (employment portion only):`);
  score("необлагаем минимум €620 (минималната заплата)", [
    { fromEur: 0, rate: 0 },
    { fromEur: 620, rate: 0.1 },
  ]);
  score("втора ставка 15% над €3000", [
    { fromEur: 0, rate: 0.1 },
    { fromEur: 3000, rate: 0.15 },
  ]);
  score("20% над €2000, 10% отдолу", [
    { fromEur: 0, rate: 0.1 },
    { fromEur: 2000, rate: 0.2 },
  ]);

  console.log(`\nМОД scenarios over the bands (cap now €${e.capEur}):`);
  for (const [label, to] of [
    ["вдигане на тавана до €2500", 2500],
    ["премахване на тавана", Infinity],
    ["сваляне на тавана до €1800", 1800],
  ] as const) {
    const r = scoreModCapBands(e.bands, e.capEur, to);
    console.log(
      `  ${label}: ${r.totalEur >= 0 ? "+" : "−"}${M(Math.abs(r.totalEur))}/yr ` +
        `(осигуровки ${M(r.sscEur)}, ДДФЛ ефект ${M(r.pitOffsetEur)})`,
    );
  }
};

main();
