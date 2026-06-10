// Smoke test for the VAT policy model: prints the year-by-year calibration
// table (modeled household VAT vs actual КФП ДДС) and a couple of scored
// scenarios, all through the SAME engine the simulator uses
// (src/lib/bgTaxPolicy.ts) over data/budget/derived/policy_baseline.json.
//
// The calibration factor sits well above 1 by construction — households are
// only ~60-70% of the VAT base (government purchases, exempt sectors' input
// VAT, new dwellings), partially offset by the VAT gap. What gates the
// feasibility is the factor's year-over-year STABILITY, enforced by
// run_policy_baseline.ts (≤12% min-max spread) and eyeballed here.
//
// Usage:
//   npx tsx scripts/budget/run_policy_baseline.ts   # refresh inputs first
//   npx tsx scripts/budget/__smoke_vat_model.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  VAT_POLICY_CURRENT,
  computeVatRevenue,
  scoreModCap,
  scorePitFlat,
  type VatBaseSlice,
  type ModIdentity,
} from "../../src/lib/bgTaxPolicy";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");

interface BaselineFile {
  baselineYear: number;
  revenue: { pitEur: number; pitRateSensitiveShare: number };
  vat: {
    factor: number;
    calibration: {
      year: number;
      modeledEur: number;
      actualEur: number;
      factor: number;
    }[];
    slices: VatBaseSlice[];
  };
  modIdentity: ModIdentity & { year: number };
}

const main = (): void => {
  const baseline = JSON.parse(
    fs.readFileSync(
      path.join(PROJECT_ROOT, "data/budget/derived/policy_baseline.json"),
      "utf-8",
    ),
  ) as BaselineFile;

  console.log("VAT calibration (modeled household VAT vs actual КФП ДДС):\n");
  console.log("year | modeled | actual | factor");
  for (const c of baseline.vat.calibration) {
    console.log(
      `${c.year} | €${(c.modeledEur / 1e9).toFixed(2)}B | €${(c.actualEur / 1e9).toFixed(2)}B | ${c.factor.toFixed(3)}`,
    );
  }
  const factors = baseline.vat.calibration.map((c) => c.factor);
  const mean = factors.reduce((a, b) => a + b, 0) / factors.length;
  console.log(
    `factor mean ${mean.toFixed(3)}, min-max spread ${(((Math.max(...factors) - Math.min(...factors)) / mean) * 100).toFixed(1)}%`,
  );

  // Scenario spot-checks through the engine, calibrated like the simulator.
  const base = computeVatRevenue(baseline.vat.slices, VAT_POLICY_CURRENT);
  const score = (label: string, policy: typeof VAT_POLICY_CURRENT): void => {
    const s = computeVatRevenue(baseline.vat.slices, policy);
    const delta = (s.modeledEur - base.modeledEur) * baseline.vat.factor;
    console.log(
      `  ${label}: ${delta >= 0 ? "+" : "−"}€${Math.abs(delta / 1e6).toFixed(0)}M/yr`,
    );
  };
  console.log(`\nScored scenarios (baseline ${baseline.baselineYear}):`);
  score("ДДС 20% → 21%", { ...VAT_POLICY_CURRENT, standardRate: 0.21 });
  score("храните на 9%", {
    ...VAT_POLICY_CURRENT,
    regimes: { food: "reduced" },
  });
  score("ресторанти обратно на 9%", {
    ...VAT_POLICY_CURRENT,
    regimes: { restaurants: "reduced" },
  });
  const pitDelta = scorePitFlat(
    baseline.revenue.pitEur,
    baseline.revenue.pitRateSensitiveShare,
    0.12,
  );
  console.log(`  ДДФЛ 10% → 12%: +€${(pitDelta / 1e6).toFixed(0)}M/yr`);
  const mod = scoreModCap(baseline.modIdentity, 2500);
  console.log(
    `  МОД ${baseline.modIdentity.capEur} → 2500: +€${(mod.lowEur / 1e6).toFixed(0)}–${(mod.highEur / 1e6).toFixed(0)}M/yr (central €${(mod.centralEur / 1e6).toFixed(0)}M)`,
  );
};

main();
