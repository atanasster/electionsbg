// Smoke test for the pension yearbook PDF parser.
//   tsx scripts/budget/noi/__smoke_yearbook.ts [2024]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  parsePensionYearbook,
  aggregatePensionTypes,
} from "./parse_pension_yearbook";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fmt = (eur: number): string =>
  new Intl.NumberFormat("en", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(eur);

const main = async (): Promise<void> => {
  const year = Number(process.argv[2] ?? 2024);
  const file = path.resolve(
    __dirname,
    "../../../raw_data/budget/noi/yearbooks",
    `Yearbook_Pensions_${year}.pdf`,
  );
  const bytes = new Uint8Array(fs.readFileSync(file));
  const parsed = await parsePensionYearbook(bytes, year);

  console.log(`\n=== Pension Yearbook / FY ${year} ===\n`);
  console.log(`Rows parsed:           ${parsed.rows.length}`);
  console.log(`Fund subtotals (BGN):`);
  for (const [k, v] of Object.entries(parsed.fundSubtotals)) {
    console.log(
      `  ${k.padEnd(20)} ${v == null ? "—" : v.toLocaleString("bg-BG")}`,
    );
  }

  const buckets = aggregatePensionTypes(parsed);
  console.log(`\nCategory rollup (EUR):`);
  console.log(`  Old-age:           ${fmt(buckets.oldAge.amountEur)}`);
  console.log(`  Disability:        ${fmt(buckets.disability.amountEur)}`);
  console.log(`  Social:            ${fmt(buckets.social.amountEur)}`);
  console.log(`  Occupational:      ${fmt(buckets.occupational.amountEur)}`);
  console.log(`  Other:             ${fmt(buckets.other.amountEur)}`);
  console.log(`  Total:             ${fmt(buckets.total.amountEur)}`);

  // Reconciliation: bucket total vs grand-total from fund subtotals.
  const grand = parsed.fundSubtotals.grandTotal;
  if (grand != null) {
    const grandEur = Math.round(grand / 1.95583);
    const delta = buckets.total.amountEur - grandEur;
    console.log(
      `\nReconciliation: parsed grand-total ${fmt(grandEur)} vs sum-of-buckets ${fmt(buckets.total.amountEur)} = delta ${fmt(delta)}`,
    );
  }

  console.log(`\nFirst 10 rows for visual sanity:`);
  for (const r of parsed.rows.slice(0, 10)) {
    console.log(
      `  [${(r.category ?? "subtot").padEnd(11)}] ${r.label.slice(0, 60).padEnd(60)} ${(r.amountBgn / 1e9).toFixed(2)}B BGN`,
    );
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
