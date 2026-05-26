// Smoke test for the investment-annex PDF parser.
//   tsx scripts/budget/investment_program/__smoke_annex.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseInvestmentAnnex } from "./parse_annex_pdf";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const main = async (): Promise<void> => {
  const year = Number(process.argv[2] ?? 2025);
  const file = path.resolve(
    __dirname,
    "../../../raw_data/budget/investment_program",
    `${year}-annex-iii.pdf`,
  );
  const bytes = new Uint8Array(fs.readFileSync(file));
  const result = await parseInvestmentAnnex(bytes, year);

  console.log(`\n=== Investment Annex / FY ${year} ===\n`);
  console.log(`Projects parsed:        ${result.projects.length}`);
  console.log(`Unparsed institutions:  ${result.unparsedInstitutions.length}`);
  if (result.unparsedInstitutions.length > 0) {
    console.log(`   →`, result.unparsedInstitutions.slice(0, 5).join(" | "));
  }

  const totalEur = result.projects.reduce((s, p) => s + p.cost.amountEur, 0);
  const totalThou = result.projects.reduce((s, p) => s + p.costThousandsBgn, 0);
  console.log(
    `Grand total:            ${(totalThou / 1000).toFixed(1)}M лв = €${(totalEur / 1e6).toFixed(0)}M`,
  );

  console.log(`\nSample projects:`);
  for (const p of result.projects.slice(0, 5)) {
    console.log(
      `  ${p.projectId}  €${(p.cost.amountEur / 1000).toFixed(0)}k  ${p.municipalityName ?? "—"} / ${p.oblastName ?? "—"}  ${p.name.slice(0, 40)}…`,
    );
  }

  console.log(`\nTop 5 by cost:`);
  const sorted = [...result.projects].sort(
    (a, b) => b.cost.amountEur - a.cost.amountEur,
  );
  for (const p of sorted.slice(0, 5)) {
    console.log(
      `  ${p.projectId}  €${(p.cost.amountEur / 1e6).toFixed(2)}M  ${p.municipalityName ?? "—"}/${p.oblastName ?? "—"}  ${p.name.slice(0, 50)}`,
    );
  }

  // Top 5 oblasts by total
  const byOblast = new Map<string, number>();
  for (const p of result.projects) {
    const k = p.oblastName ?? "(unparsed)";
    byOblast.set(k, (byOblast.get(k) ?? 0) + p.cost.amountEur);
  }
  console.log(`\nTop 5 oblasts:`);
  [...byOblast.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([o, eur]) =>
      console.log(`  ${o.padEnd(20)} €${(eur / 1e6).toFixed(0)}M`),
    );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
