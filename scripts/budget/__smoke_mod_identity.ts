// Smoke test for the МОД-cap (максимален осигурителен доход) revenue model:
// can the above-cap wage mass be recovered from aggregates already on disk /
// in Eurostat, without an earnings distribution?
//
// Identity: the PIT base is UNCAPPED (10% applies to the whole post-SSC
// salary) while the insurable base is CAPPED at МОД — so the wedge between
// the two, after adding back employee SSC, is the wage mass above the cap:
//
//   PIT_base   = W − ssc_e·B          (НАП employment PIT ÷ 10%)
//   B          = D613CE ÷ ssc_e_s13   (Eurostat: employee contributions
//                                      received by government — i.e. the
//                                      statutory 13.78% MINUS the 2.2pp
//                                      second-pillar slice routed to private
//                                      funds)
//   ⇒ E = W − B = PIT_base + ssc_e·B − B
//
// A cap raise C→C′ then collects employer+employee contributions on the part
// of E sitting between C and C′, bounded by two tail shapes (everyone just
// above C vs a Pareto tail). The 2025 raise (3 750→4 130 BGN) is scored as a
// backtest — МФ's own estimate was ~250M BGN ≈ €128M.
//
// Usage:
//   npx tsx scripts/budget/__smoke_mod_identity.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { SSC_EMPLOYEE_RATE, PIT_RATE, MOD_BY_YEAR } from "../../src/lib/bgTax";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");

const YEAR = 2024;

// Statutory employee rate net of the second-pillar (УПФ) 2.2pp that bypasses
// the government sector — D613CE measures only what S13 receives.
const SSC_EMPLOYEE_S13 = SSC_EMPLOYEE_RATE - 0.022;
// Combined employer+employee rate net of the 5pp second pillar — what a cap
// raise actually yields for the consolidated budget.
const COMBINED_RATE_S13 = 0.328 - 0.05;

// Eurostat gov_10a_taxag, BG, 2024 (already euro-denominated post-changeover;
// fetched 2026-06-10 — small enough to pin here for a smoke test).
const D613CE_EUR_M = 3143.1; // compulsory employees' actual contributions
const D613CS_EUR_M = 445.6; // self-employed contributions

const main = (): void => {
  const pit = JSON.parse(
    fs.readFileSync(
      path.join(PROJECT_ROOT, `data/budget/revenue_breakdown/pit/${YEAR}.json`),
      "utf-8",
    ),
  ) as { lines: { id: string; amountEur: number }[] };

  const pitEmployment = pit.lines.find(
    (l) => l.id === "pit_employment_net",
  )?.amountEur;
  if (!pitEmployment) throw new Error("pit_employment_net missing");

  // Child relief is refunded out of the same line — add a coarse allowance
  // back so the base isn't understated (≈ €60M revenue ≈ €0.6B base).
  const CHILD_RELIEF_REVENUE_EUR = 60e6;
  const pitBase = (pitEmployment + CHILD_RELIEF_REVENUE_EUR) / PIT_RATE;

  // Capped insurable base, employees only.
  const bAll = (D613CE_EUR_M * 1e6) / SSC_EMPLOYEE_S13;
  const bSelf = (D613CS_EUR_M * 1e6) / (0.278 - 0.05);
  const bEmployees = bAll; // D613CE is employees-only; self-employed are D613CS
  void bSelf;

  const grossWageMass = pitBase + SSC_EMPLOYEE_RATE * bEmployees;
  const aboveCapMass = grossWageMass - bEmployees;

  const mod = MOD_BY_YEAR[YEAR];
  console.log(`МОД-cap identity, ${YEAR} (cap €${mod}/mo):`);
  console.log(
    `  PIT base (uncapped, post-SSC)  €${(pitBase / 1e9).toFixed(1)}B`,
  );
  console.log(
    `  insurable base B (capped)      €${(bEmployees / 1e9).toFixed(1)}B`,
  );
  console.log(
    `  gross wage mass W              €${(grossWageMass / 1e9).toFixed(1)}B`,
  );
  console.log(
    `  above-cap mass E = W − B       €${(aboveCapMass / 1e9).toFixed(1)}B  (${((aboveCapMass / grossWageMass) * 100).toFixed(1)}% of W)`,
  );

  // Backtest: the legislated 2025 raise, 3 750 → 4 130 BGN (€1 917 → €2 112).
  const c0 = MOD_BY_YEAR[2024];
  const c1 = MOD_BY_YEAR[2025];
  // Pareto tail: counts above x fall as (c0/x)^alpha. The mass between c0
  // and c1 out of the total excess mass E is 1 − (c0/c1)^(alpha−1) only for
  // the *count*; for the revenue we integrate min(w,c1)−c0 over the tail:
  //   ΔB(alpha) = E · (alpha−1)/alpha · (1 − (c0/c1)^(alpha−1)) · …
  // Keep it simple with the closed form for the truncated Pareto excess:
  const dRevenue = (alpha: number): number => {
    // Excess-mass share captured when the cap moves c0→c1 under Pareto(alpha):
    // share = 1 − (c0/c1)^(alpha−1)  (fraction of E that lies below c1's
    // marginal contribution) — exact for the expected min(w,c1)−c0 integral.
    const share = 1 - Math.pow(c0 / c1, alpha - 1);
    return aboveCapMass * share * COMBINED_RATE_S13;
  };
  // Degenerate bound: every above-cap earner sits far above c1, so the whole
  // span c0→c1 is collected per person. Needs a head count: derive it from
  // the Pareto mean instead of assuming one — report the alpha band only.
  console.log(`\nBacktest — 2025 raise €${c0} → €${c1} (МФ scored ~€128M):`);
  for (const alpha of [1.8, 2.2, 2.6, 3.0]) {
    console.log(
      `  Pareto α=${alpha.toFixed(1)} → +€${(dRevenue(alpha) / 1e6).toFixed(0)}M/yr`,
    );
  }
  const impliedHeadcount = (alpha: number): number =>
    // E = n · mean excess; Pareto mean excess above c0 = c0/(alpha−1).
    aboveCapMass / 12 / (c0 / (alpha - 1));
  console.log(`\nImplied earners above the cap:`);
  for (const alpha of [1.8, 2.2, 2.6, 3.0]) {
    console.log(
      `  α=${alpha.toFixed(1)} → ${Math.round(impliedHeadcount(alpha) / 1000)}k people`,
    );
  }
};

main();
