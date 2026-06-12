// Standalone injector: compute the `incomeTiers` block from the EXISTING
// committed policy_baseline.json (its `earnings` block) and write it back —
// without re-running the full run_policy_baseline.ts fetch/fit pipeline, so
// the validated earnings/revenue blocks stay byte-identical. The same
// buildIncomeTiers + gates are also wired into run_policy_baseline.ts for
// future full regenerations.
//
// Usage:
//   npx tsx scripts/budget/run_income_tiers.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { buildAndGateIncomeTiers } from "./nap_income_tiers";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), "../..");
const BASELINE = path.join(
  PROJECT_ROOT,
  "data/budget/derived/policy_baseline.json",
);

const main = (): void => {
  const raw = fs.readFileSync(BASELINE, "utf-8");
  const baseline = JSON.parse(raw);
  const e = baseline.earnings;
  if (!e?.bands)
    throw new Error(
      "policy_baseline.json has no earnings.bands — run run_policy_baseline.ts first",
    );

  const tiers = buildAndGateIncomeTiers({
    bands: e.bands,
    capEur: e.capEur,
    wageGrowthToBaseline: e.wageGrowthToBaseline,
    identityYear: e.identityYear,
    alpha: e.alpha,
  });

  // Insert `incomeTiers` right after `earnings`, preserving key order, and
  // re-serialize with the file's existing 2-space style.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(baseline)) {
    if (k === "incomeTiers") continue; // drop any prior copy
    out[k] = v;
    if (k === "earnings") out.incomeTiers = tiers;
  }
  if (!("incomeTiers" in out)) out.incomeTiers = tiers; // earnings missing → append

  fs.writeFileSync(BASELINE, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `\nwrote incomeTiers — НАП ${tiers.taxYear}: ${tiers.totals.filers.toLocaleString()} filers, ` +
      `engine α ${tiers.tail.engineEmployeeAlpha} > all-filer ${tiers.tail.napAllFilerAlpha}, ` +
      `body cum thru bin4 ${tiers.fitComparison.cumThroughBin4.engine} vs ${tiers.fitComparison.cumThroughBin4.nap}`,
  );
};

main();
