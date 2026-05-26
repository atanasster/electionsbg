// One-off: parse the cached investment-annex PDF and write
// data/budget/investment_program/{year}.json + index.json.
//
//   tsx scripts/budget/investment_program/__write_program.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseInvestmentAnnex } from "./parse_annex_pdf";
import { buildInvestmentProgramFile } from "./build_artifact";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RAW_DIR = path.resolve(
  __dirname,
  "../../../raw_data/budget/investment_program",
);
const OUT_DIR = path.resolve(
  __dirname,
  "../../../data/budget/investment_program",
);

// Hand-curated source URLs per fiscal year. Add entries as new annexes ship.
const SOURCES: Record<number, { url: string }> = {
  2025: {
    url: "https://dv.parliament.bg/DVPics/2025/26_25/1619.pdf",
  },
};

const main = async (): Promise<void> => {
  const indexEntries: Array<{
    fiscalYear: number;
    projectCount: number;
    grandTotalEur: number;
  }> = [];

  for (const [yearStr, source] of Object.entries(SOURCES)) {
    const year = parseInt(yearStr, 10);
    const pdfPath = path.join(RAW_DIR, `${year}-annex-iii.pdf`);
    if (!fs.existsSync(pdfPath)) {
      console.log(`  • ${year}: missing ${pdfPath}, skipping`);
      continue;
    }
    const bytes = new Uint8Array(fs.readFileSync(pdfPath));
    const parsed = await parseInvestmentAnnex(bytes, year);
    const file = buildInvestmentProgramFile(parsed, {
      documentId: `investment-program-${year}`,
      url: source.url,
    });
    const outPath = path.join(OUT_DIR, `${year}.json`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(file, null, 2), "utf8");
    indexEntries.push({
      fiscalYear: year,
      projectCount: file.projectCount,
      grandTotalEur: file.grandTotal.amountEur,
    });
    console.log(
      `  • ${year}: ${file.projectCount} projects, €${(file.grandTotal.amountEur / 1e6).toFixed(0)}M, ${file.byOblast.length} oblasts, ${file.byCategory.length} categories`,
    );
  }

  if (indexEntries.length > 0) {
    const indexPath = path.join(OUT_DIR, "index.json");
    fs.writeFileSync(
      indexPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          years: indexEntries.sort((a, b) => a.fiscalYear - b.fiscalYear),
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log(`\n→ wrote ${indexEntries.length + 1} files under ${OUT_DIR}`);
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
