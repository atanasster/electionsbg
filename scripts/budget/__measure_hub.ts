// Prints the /budget hub's figure ledger — every number a hub tile may show,
// with its denominator and the answers that were also true.
//
//   npx tsx scripts/budget/__measure_hub.ts            # the default fiscal year
//   npx tsx scripts/budget/__measure_hub.ts 2024       # one year
//   npx tsx scripts/budget/__measure_hub.ts --all      # every year the corpus covers
//
// The derivation lives in hub_ledger.ts so `budget_hub_stats.data.test.ts` can
// import it; this file is only the human view. Plan: docs/plans/budget-hub-v1.md T0.2.

import {
  loadBudgetCorpus,
  measureHubLedger,
  defaultFiscalYear,
  ledgerYears,
  type LedgerFigure,
} from "./hub_ledger";

/** Keys whose value is an IDENTIFIER rather than a quantity — a fiscal year is
 *  2026, never 2,026. Plan §10 already carries a rule about a year label
 *  disagreeing with the ?fy= it names; a thousands separator is the same class,
 *  one step earlier. */
const YEARLIKE = /^fiscalYear$/;

const fmt = (v: number | string | boolean | null): string => {
  if (v === null) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return v;
  // Money is the common case and reads badly unrounded; counts are small
  // enough that the same formatter is fine for both.
  return Math.abs(v) >= 1_000_000
    ? new Intl.NumberFormat("en", {
        maximumFractionDigits: 0,
      }).format(Math.round(v))
    : new Intl.NumberFormat("en").format(v);
};

const printYear = (fy: number, rows: LedgerFigure[]): void => {
  console.log(`\n${"═".repeat(78)}\nFISCAL YEAR ${fy}\n${"═".repeat(78)}`);
  for (const r of rows) {
    const shown = YEARLIKE.test(r.key) ? String(r.value) : fmt(r.value);
    console.log(`\n  ${r.key} = ${shown}`);
    console.log(`      basis: ${r.basis}`);
    for (const alt of r.rejected ?? []) {
      console.log(`      also true: ${fmt(alt.value)} — ${alt.why}`);
    }
    if (r.caution) console.log(`      ⚠ ${r.caution}`);
  }
};

const main = (): void => {
  const corpus = loadBudgetCorpus();
  if (!corpus.index) {
    console.error(
      "data/budget/index.json is missing — run `npm run data -- --all` first.",
    );
    process.exitCode = 1;
    return;
  }

  const args = process.argv.slice(2);
  let years: Array<number | null>;
  if (args.includes("--all")) {
    years = ledgerYears(corpus);
  } else if (args[0] === undefined) {
    years = [defaultFiscalYear(corpus)];
  } else if (/^\d{4}$/.test(args[0])) {
    years = [Number(args[0])];
  } else {
    // A silent fallback to the default year would answer a question nobody
    // asked — and `0` and `banana` would both get there through `Number(x) ||`.
    console.error(
      `Unrecognised argument "${args[0]}".\n` +
        "  usage: npx tsx scripts/budget/__measure_hub.ts [<4-digit year> | --all]",
    );
    process.exitCode = 1;
    return;
  }

  for (const fy of years) {
    if (fy == null) continue;
    printYear(fy, measureHubLedger(fy, corpus));
  }

  console.log(
    `\n${"─".repeat(78)}\n` +
      "Every figure above carries its denominator. A hub tile that renders one of\n" +
      "these WITHOUT the basis in its caption is the defect this ledger exists to\n" +
      "catch — see docs/plans/budget-hub-v1.md §2.\n",
  );
};

main();
