// НЗОК health-pack ingest runner — refreshes the four committed data files under
// data/budget/nzok/ that power the health sector pack on /awarder/121858220.
// Run: `npm run data:nzok` (all) or with flags for a subset.
//
//   --budget    rewrite budget.json from the hard-keyed ЗБНЗОК law figures
//   --hospitals fetch the latest monthly per-hospital БМП payments (joins the
//               committed Рег.№→EIK crosswalk onto each row)
//   --drugs     fetch the latest annual gross drug-reimbursement by INN
//   --execution fetch the latest monthly B1 cash-execution snapshot
//   --drug-prices per-hospital drug UNIT PRICES from the Справка 5 monthlies
//               (nzok/medicine/5) — pack-identity peer medians + overpay ranking
//   --eeof      quarterly hospital FINANCIALS (revenue, expense, debt, beds,
//               occupancy, cost/patient) from МЗ's ~2-dozen ЕЕОФ XLSX workbooks
//   --activities clinical-activity corpus (cases + ЗОЛ per КП/АПр/КПр per hospital)
//               from the nhif.bg monthly activity files — the case-mix denominator
//   (no flag)   all of the above (the default set — no Postgres needed)
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
    flag: "--drug-quarterly",
    scripts: ["write_drug_quarterly.ts"],
    label: "per-INN quarterly drug trend",
  },
  {
    flag: "--execution",
    scripts: ["write_execution.ts"],
    label: "B1 execution",
  },
  {
    flag: "--drug-prices",
    scripts: ["write_drug_unit_prices.ts"],
    label: "drug unit prices (Справка 5)",
  },
  {
    flag: "--eeof",
    scripts: ["write_eeof.ts"],
    label: "ЕЕОФ financials",
  },
  {
    flag: "--activities",
    scripts: ["write_activities.ts"],
    label: "clinical activity corpus",
  },
  {
    flag: "--procedure-names",
    scripts: ["write_procedure_names.ts"],
    label: "procedure code→name nomenclature (НРД)",
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
    scripts: [
      "write_hospital_eik.ts",
      "write_hospital_payments.ts",
      "write_hospital_ownership.ts",
    ],
    label: "Рег.№→EIK crosswalk + ownership",
  },
  // Ownership (state|municipal|private) map on its own. Needs the local Postgres
  // (nzok_hospital_payments + nzok_hospital_financials loaded) + the ЕЕОФ
  // financials file (--eeof). Near-static; rebuilds hospital_ownership.json.
  {
    flag: "--ownership",
    scripts: ["write_hospital_ownership.ts"],
    label: "state/municipal/private ownership map",
  },
  // Clinical-pathway tariffs (НРД) — the price factor behind the pathway spend
  // tree + case-mix expected-vs-actual (migration 059). Opt-in because it fetches
  // nhif.bg (BG-egress only) and the annex layout needs parser iteration; run
  // with --page/--annex/--nrd-year (see the script header), or --from-dump to
  // iterate offline against a prior --dump.
  {
    flag: "--pathway-tariffs",
    scripts: ["write_pathway_tariffs.ts"],
    label: "clinical-pathway tariffs (НРД)",
  },
  // Private-hospital annual revenue from filed ГФО (Търговски регистър). Opt-in:
  // needs GEMINI_API_KEY (Vision OCR of each ОПР) + the local Postgres (the
  // same-year НЗОК sanity gate) + curl (the registry WAF blocks node fetch).
  // Resumable — a re-run only fills cells still empty (FY2023/24 keep landing as
  // hospitals file late). Direct invocation supports --limit N / --refresh.
  {
    flag: "--revenue",
    scripts: ["write_hospital_revenue.ts"],
    label: "private-hospital ГФО revenue",
  },
];

const args = process.argv.slice(2);
// Non-selector flags forwarded verbatim to every child script (e.g. --dump makes
// write_procedure_names.ts also save the raw appendix text for debugging).
const PASSTHROUGH = new Set(["--dump", "--from-dump", "--bgn"]);
const passArgs = args.filter((a) => PASSTHROUGH.has(a));
// A typo (`--hospital`, `--drug`) matches no step, which would otherwise fall
// back to the full default set — four fetches the operator didn't ask for. Fail
// loudly on any unrecognized `--flag` instead.
const KNOWN = new Set([...STEPS, ...OPT_IN].map((s) => s.flag));
const unknown = args.filter(
  (a) => a.startsWith("--") && !KNOWN.has(a) && !PASSTHROUGH.has(a),
);
if (unknown.length) {
  console.error(
    `unknown flag(s): ${unknown.join(" ")} — expected one of ${[...KNOWN].join(" ")}`,
  );
  process.exit(1);
}
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
    const res = spawnSync("npx", ["tsx", scriptPath, ...passArgs], {
      stdio: "inherit",
    });
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
