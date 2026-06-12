// Smoke for the НАП income-tier validation (scripts/budget/nap_income_tiers.ts):
// reads the `incomeTiers` block from policy_baseline.json and asserts the
// gates. It does NOT re-run the fit — run_income_tiers.ts / run_policy_baseline.ts
// produce the block; this is the human-readable view + a regression guard.
//
// Which bins are reliable: the BODY (30000–42000 лв cleanest; 9360–30000 via
// the cumulative) is where the employee grid and the all-filer table coincide.
// NOISY/out-of-scope: the ≤9360 лв bottom bin (part-year / self-insured floor
// the full-year employee fit doesn't model) and the 42000+ tail (self-employed
// / dividend blend). So we gate on RENORMALIZED BODY SHARES + the TAIL
// ORDERING only — never bin 1, bins 2–3 individually, or raw counts.
//
// Usage: npx tsx scripts/budget/__smoke_income_tiers.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { checkIncomeTierGates, type IncomeTiers } from "./nap_income_tiers";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), "../..");

const main = (): void => {
  const baseline = JSON.parse(
    fs.readFileSync(
      path.join(PROJECT_ROOT, "data/budget/derived/policy_baseline.json"),
      "utf-8",
    ),
  );
  const t = baseline.incomeTiers as IncomeTiers | undefined;
  if (!t)
    throw new Error(
      "policy_baseline.json has no incomeTiers — run scripts/budget/run_income_tiers.ts",
    );

  console.log(`НАП income tiers — tax year ${t.taxYear} (${t.source}):`);
  console.log(
    `  ${t.totals.filers.toLocaleString()} filers · €${(t.totals.pitEur / 1e9).toFixed(2)}B ДДФЛ · €${(t.totals.taxableBaseEur / 1e9).toFixed(1)}B taxable base`,
  );
  console.log(
    "\n  base bracket (EUR)      filers     avg base   eng/НАП body share",
  );
  t.bins.forEach((b, i) => {
    const hi = b.baseHighEur === null ? "+      " : `–${b.baseHighEur}`;
    const ratio = t.fitComparison.bodyShareRatio[i];
    console.log(
      `  ${String(b.baseLowEur).padStart(6)}${hi.padEnd(8)} ${String(b.count).padStart(10)}  €${String(b.avgBaseEur).padStart(7)}   ${ratio === null ? "(out of scope)" : ratio.toFixed(3)}`,
    );
  });
  console.log(
    `\n  tail: employee α ${t.tail.engineEmployeeAlpha} (canonical, drives МОД) vs all-filer НАП α ${t.tail.napAllFilerAlpha} — ${t.tail.orderingOk ? "ordering OK" : "ORDERING BROKEN"}`,
  );

  console.log("\nGates:");
  const gate = checkIncomeTierGates(t);
  for (const l of gate.lines) console.log(l);
  if (!gate.ok) throw new Error("income-tier gates failed");
  console.log("\nAll income-tier invariants hold.");
};

main();
