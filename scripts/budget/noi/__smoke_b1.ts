// Smoke test for the NOI B1 XLS parser. Parses each cached fund file for the
// pinned fiscal year and prints a one-screen summary.
//   tsx scripts/budget/noi/__smoke_b1.ts

import path from "path";
import { fileURLToPath } from "url";
import { parseB1XlsFile, type NoiFundCode } from "./parse_b1_xls";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fmt = (eur: number): string =>
  new Intl.NumberFormat("en", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(eur);

const main = (): void => {
  const year = Number(process.argv[2] ?? 2024);
  const funds: NoiFundCode[] = ["5500", "5591", "5592"];

  for (const fund of funds) {
    const filePath = path.resolve(
      __dirname,
      "../../../raw_data/budget/noi",
      `B1_${year}_12_${fund}.xls`,
    );
    console.log(`\n=== Fund ${fund} / FY ${year} ===\n`);
    const snap = parseB1XlsFile(filePath, fund, year);
    console.log(`  ${snap.fundLabelEn} — as of ${snap.asOf}`);
    console.log(
      `  Revenue:      ${snap.revenue ? fmt(snap.revenue.amountEur) : "—"}`,
    );
    console.log(
      `  Expenditure:  ${snap.expenditure ? fmt(snap.expenditure.amountEur) : "—"}`,
    );
    console.log(
      `  Balance:      ${snap.balance ? fmt(snap.balance.amountEur) : "—"}`,
    );
    console.log(`  Expense lines:`);
    for (const line of snap.expenseLines) {
      const v = line.executed?.amountEur ?? 0;
      console.log(
        `    ${line.id.padEnd(20)}  ${fmt(v).padStart(14)}  ${line.labelBg.slice(0, 60)}`,
      );
    }
    if (snap.pensionsBgn != null) {
      console.log(
        `  Pension detail: §4100 ${fmt(Math.round(snap.pensionsBgn / 1.95583))} · §4200 ${fmt(Math.round((snap.shortTermBenefitsBgn ?? 0) / 1.95583))}`,
      );
    }
  }
};

main();
