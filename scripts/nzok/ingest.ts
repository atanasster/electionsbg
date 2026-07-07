// НЗОК health-pack ingest runner — refreshes the four committed data files under
// data/budget/nzok/ that power the health sector pack on /awarder/121858220.
// Run: `npm run data:nzok` (all) or with flags for a subset.
//
//   --budget    rewrite budget.json from the hard-keyed ЗБНЗОК law figures
//   --hospitals fetch the latest monthly per-hospital БМП payments (joins the
//               committed Рег.№→EIK crosswalk onto each row)
//   --drugs     fetch the latest annual gross drug-reimbursement by INN
//   --execution fetch the latest monthly B1 cash-execution snapshot
//   (no flag)   all four of the above (the default set — no Postgres needed)
//
//   --crosswalk OPT-IN ONLY: rebuild the Рег.№ ЛЗ → EIK crosswalk (hospital_eik
//               .json) + re-join it into the payments file. Needs the LOCAL
//               Postgres (tr_companies/tr_officers) and is near-static, so it is
//               NOT part of the default set / the watcher. See write_hospital_eik.
//
// The default-set fetches hit nhif.bg over plain HTTPS (no Cloudflare); see the
// individual scripts for the source URLs. After a refresh, PROD needs a
// bucket:sync of data/budget/nzok/ (served from the GCS bucket in production).

import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Default set — pure nhif.bg fetches, run by `npm run data:nzok` (no flag) and
// the watcher. NONE need Postgres.
const STEPS: { flag: string; scripts: string[]; label: string }[] = [
  { flag: "--budget", scripts: ["__write_budget.ts"], label: "budget law" },
  {
    flag: "--hospitals",
    scripts: ["write_hospital_payments.ts"],
    label: "hospital payments",
  },
  {
    flag: "--drugs",
    scripts: ["write_drug_reimbursement.ts"],
    label: "drug reimbursement",
  },
  {
    flag: "--execution",
    scripts: ["write_execution.ts"],
    label: "B1 execution",
  },
];

// Opt-in ONLY (never in the no-flag default): the Рег.№→EIK crosswalk. It needs
// the local Postgres (tr_companies/tr_officers), which the watcher/CI don't have,
// and the mapping is near-static — so it's refreshed manually. Rebuilds the
// crosswalk, then re-runs the hospital-payments join so eik + the by-EIK index
// pick up the fresh mapping in one command.
const OPT_IN: { flag: string; scripts: string[]; label: string }[] = [
  {
    flag: "--crosswalk",
    scripts: ["write_hospital_eik.ts", "write_hospital_payments.ts"],
    label: "Рег.№→EIK crosswalk",
  },
];

const args = process.argv.slice(2);
const optIn = OPT_IN.filter((s) => args.includes(s.flag));
const selected = STEPS.filter((s) => args.includes(s.flag));
// No default-set flag AND no opt-in flag → run the whole default set. An opt-in
// flag alone runs only that (keeps the PG dependency off the default path).
const toRun = selected.length || optIn.length ? [...selected, ...optIn] : STEPS;

let failed = 0;
for (const step of toRun) {
  console.log(`\n=== НЗОК: ${step.label} (${step.scripts.join(" + ")}) ===`);
  for (const script of step.scripts) {
    const scriptPath =
      script === "__write_budget.ts"
        ? path.resolve(__dirname, "../budget/nzok/__write_budget.ts")
        : path.resolve(__dirname, script);
    const res = spawnSync("npx", ["tsx", scriptPath], { stdio: "inherit" });
    if (res.status !== 0) {
      failed++;
      console.error(`  ! ${step.label} (${script}) failed`);
      break;
    }
  }
}

console.log(
  `\nНЗОК ingest done — ${toRun.length - failed}/${toRun.length} steps ok.` +
    (failed ? "" : " Remember: bucket:sync data/budget/nzok/ for prod."),
);
process.exit(failed ? 1 : 0);
