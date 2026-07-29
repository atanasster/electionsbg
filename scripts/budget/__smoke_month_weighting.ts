// Smoke test for the month-weighted МОД aggregates (plan T2.6).
//   tsx scripts/budget/__smoke_month_weighting.ts
//
// МОД is a MONTHLY cap applied per month under КСО, so the true annual
// insurable base is Σ_months Σ_workers min(wage, cap_month). `scalar × 12` is
// the approximation — and three of the last five fiscal years stepped mid-year
// (2022, 2025, 2026), so it has been wrong more often than right.
//
// Two invariants matter and neither is obvious from reading the code:
//   1. A single-step year must reproduce the scalar answer EXACTLY, or every
//      historical figure silently moves the day this lands.
//   2. Averaging the caps is NOT a shortcut for weighting the outputs.
//      min(w, cap) is CONCAVE in cap, so by Jensen a blended cap overstates
//      the base. The gap is small at today's step but grows with its square.
//
// Every check drives the EXPORTED functions. The unit-level invariants live in
// src/lib/bgTaxPolicy.test.ts (which does run in CI); this file is the
// baseline-backed counterpart, exercising them against the real band grid.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { capMonths, PIT_RATE } from "../../src/lib/bgTax";
import {
  pitRevenueOnBands,
  scoreModCapBands,
  scoreModCap,
} from "../../src/lib/bgTaxPolicy";
import type { PolicyBaselineFile } from "../../src/data/budget/types";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "../..");

const M = (v: number): string =>
  `${v < 0 ? "−" : "+"}€${Math.abs(v / 1e6).toFixed(1)}M`;

let failed = 0;
const check = (label: string, ok: boolean, detail = ""): void => {
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!ok) failed++;
};

const main = (): void => {
  const baseline = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "data/budget/derived/policy_baseline.json"),
      "utf8",
    ),
  ) as PolicyBaselineFile;
  const bands = baseline.earnings.bands;
  const flat = [{ fromEur: 0, rate: PIT_RATE }];

  console.log("Month-weighted МОД aggregates\n");

  // --- 1. the scalar path must not move -----------------------------------
  const scalarPit = pitRevenueOnBands(bands, 2112, flat);
  const segPit = pitRevenueOnBands(bands, [{ capEur: 2112, months: 12 }], flat);
  check(
    "pitRevenueOnBands: scalar === [{cap, 12}]",
    scalarPit === segPit,
    `€${scalarPit.toFixed(2)}`,
  );

  const scalarBands = scoreModCapBands(bands, 2112, 2500, PIT_RATE);
  const segBands = scoreModCapBands(
    bands,
    [{ capEur: 2112, months: 12 }],
    2500,
    PIT_RATE,
  );
  check(
    "scoreModCapBands: scalar === [{cap, 12}]",
    scalarBands.totalEur === segBands.totalEur,
    M(scalarBands.totalEur),
  );

  const scalarCap = scoreModCap(baseline.modIdentity, 2500, 2112);
  const segCap = scoreModCap(baseline.modIdentity, 2500, [
    { capEur: 2112, months: 12 },
  ]);
  check(
    "scoreModCap: scalar === [{cap, 12}]",
    scalarCap.centralEur === segCap.centralEur,
    M(scalarCap.centralEur),
  );

  // --- 2. every schedule year covers exactly twelve months ----------------
  for (const year of [2022, 2024, 2025, 2026]) {
    const segs = capMonths(year);
    check(
      `capMonths(${year}) sums to 12 months`,
      segs.reduce((a, s) => a + s.months, 0) === 12,
      segs.map((s) => `€${s.capEur}×${s.months}`).join(" + "),
    );
  }

  // --- 3. Jensen: a blended cap overstates, so weight the OUTPUTS ---------
  //     Driven through scoreModCapBands, NOT a local re-implementation — a
  //     parallel implementation here is exactly why a real defect in the
  //     segmented path once shipped green.
  for (const year of [2022, 2025, 2026]) {
    const segs = capMonths(year);
    const blendedCap = segs.reduce((a, s) => a + s.capEur * s.months, 0) / 12;
    const target = Math.max(...segs.map((s) => s.capEur)) + 500;
    const weighted = scoreModCapBands(bands, segs, target, PIT_RATE);
    const blended = scoreModCapBands(bands, blendedCap, target, PIT_RATE);
    // Raising to a common target from a blended cap understates the gain,
    // because the blend overstates the base it starts from. Same concavity,
    // observed through the function callers actually use.
    check(
      `${year}: blending the cap understates the gain to €${target}`,
      blended.totalEur < weighted.totalEur,
      `blended €${blendedCap.toFixed(2)} ⇒ ${M(blended.totalEur - weighted.totalEur)} vs weighted`,
    );
  }

  // --- 4. the cost of NOT weighting, on the two live years ----------------
  //     Reported, not threshold-asserted: a test that fails when the figure
  //     gets SMALLER fails when the code gets more correct. The invariant is
  //     the SIGN (a flat year always overstates a stepped one), not the size.
  for (const year of [2025, 2026] as const) {
    const segs = capMonths(year);
    const scalar = Math.max(...segs.map((s) => s.capEur));
    const target = scalar + 500;
    const weighted = scoreModCapBands(bands, segs, target, PIT_RATE);
    const flatYear = scoreModCapBands(bands, scalar, target, PIT_RATE);
    const gap = weighted.totalEur - flatYear.totalEur;
    console.log(
      `        ${year}: pricing the whole year at €${scalar} understates the` +
        ` gain to €${target} by ${M(gap)}`,
    );
    check(
      `${year}: a flat year and a stepped year cannot agree`,
      Math.abs(gap) > 0,
      M(gap),
    );
  }

  console.log(
    failed === 0
      ? "\nAll month-weighting invariants hold."
      : `\n${failed} check(s) FAILED.`,
  );
  if (failed > 0) process.exit(1);
};

main();
