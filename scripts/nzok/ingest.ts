// НЗОК health-pack ingest runner — refreshes the four committed data files under
// data/budget/nzok/ that power the health sector pack on /awarder/121858220.
// Run: `npm run data:nzok` (all) or with flags for a subset.
//
//   --budget    rewrite budget.json from the hard-keyed ЗБНЗОК law figures
//   --hospitals fetch the latest monthly per-hospital БМП payments
//   --drugs     fetch the latest annual gross drug-reimbursement by INN
//   --execution fetch the latest monthly B1 cash-execution snapshot
//   (no flag)   all four
//
// All fetches hit nhif.bg over plain HTTPS (no Cloudflare); see the individual
// scripts for the source URLs. After a refresh, PROD needs a bucket:sync of
// data/budget/nzok/ (the files are served from the GCS bucket in production).
//
// KNOWN NEXT STEP (not yet built): the ИАМН рег.№→EIK crosswalk that would link
// each of the 381 hospitals in hospital_payments.json to its own /company page.
// It needs the authoritative facility register (data.egov.bg) — name-matching
// against the commerce register is unreliable (the payments use abbreviations
// like УМБАЛ; TR carries the full legal name) and would risk wrong links.

import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STEPS: { flag: string; script: string; label: string }[] = [
  { flag: "--budget", script: "__write_budget.ts", label: "budget law" },
  {
    flag: "--hospitals",
    script: "write_hospital_payments.ts",
    label: "hospital payments",
  },
  {
    flag: "--drugs",
    script: "write_drug_reimbursement.ts",
    label: "drug reimbursement",
  },
  { flag: "--execution", script: "write_execution.ts", label: "B1 execution" },
];

const args = process.argv.slice(2);
const selected = STEPS.filter((s) => args.includes(s.flag));
const toRun = selected.length ? selected : STEPS;

let failed = 0;
for (const step of toRun) {
  console.log(`\n=== НЗОК: ${step.label} (${step.script}) ===`);
  const scriptPath =
    step.script === "__write_budget.ts"
      ? path.resolve(__dirname, "../budget/nzok/__write_budget.ts")
      : path.resolve(__dirname, step.script);
  const res = spawnSync("npx", ["tsx", scriptPath], { stdio: "inherit" });
  if (res.status !== 0) {
    failed++;

    console.error(`  ! ${step.label} failed`);
  }
}

console.log(
  `\nНЗОК ingest done — ${toRun.length - failed}/${toRun.length} steps ok.` +
    (failed ? "" : " Remember: bucket:sync data/budget/nzok/ for prod."),
);
process.exit(failed ? 1 : 0);
