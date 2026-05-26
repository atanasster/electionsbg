// One-off: parse the cached NOI B1 XLS files (raw_data/budget/noi/) and
// write data/budget/noi/funds.json. Used for testing the drilldown without
// running the full ingest pipeline.
//
// Auto-download from nssi.bg is unreliable (302 redirect to homepage on
// most GET requests despite 200 on HEAD), so the operator runs:
//
//   1. Manual fetch any missing B1_{YYYY}_{MM}_{FUND}.xls into raw_data/budget/noi/
//   2. tsx scripts/budget/noi/__write_funds.ts
//
// Vite's dev middleware mounts data/ at the dev-server root, so the file is
// served at /budget/noi/funds.json.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  parseB1XlsFile,
  buildNoiFundsFile,
  type NoiFundCode,
  type NoiFundSnapshot,
  type NoiPensionTypeBreakdown,
} from "./parse_b1_xls";
import {
  parsePensionYearbook,
  aggregatePensionTypes,
} from "./parse_pension_yearbook";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RAW_DIR = path.resolve(__dirname, "../../../raw_data/budget/noi");
const OUT_FILE = path.resolve(__dirname, "../../../data/budget/noi/funds.json");

const FUNDS: NoiFundCode[] = ["5500", "5591", "5592"];
const TRY_YEARS = [2020, 2021, 2022, 2023, 2024, 2025];

const YEARBOOK_DIR = path.resolve(
  __dirname,
  "../../../raw_data/budget/noi/yearbooks",
);

const main = async (): Promise<void> => {
  const snapshotsByYear = new Map<number, NoiFundSnapshot[]>();
  const pensionTypesByYear = new Map<number, NoiPensionTypeBreakdown>();

  for (const year of TRY_YEARS) {
    const funds: NoiFundSnapshot[] = [];
    for (const fund of FUNDS) {
      // Convention: end-of-year file is "_12_" (full-year cumulative). The
      // skill operator may also drop quarterly/monthly files here for
      // mid-year coverage; the parser is happy with any month — it reflects
      // the cut-off in `asOf`.
      const filePath = path.join(RAW_DIR, `B1_${year}_12_${fund}.xls`);
      if (!fs.existsSync(filePath)) continue;
      try {
        const snap = parseB1XlsFile(filePath, fund, year);
        funds.push(snap);
        console.log(
          `  • ${year}/${fund}: rev €${(snap.revenue?.amountEur ?? 0 / 1e6).toFixed(0)}M, exp €${((snap.expenditure?.amountEur ?? 0) / 1e6).toFixed(0)}M`,
        );
      } catch (e) {
        console.log(
          `  • ${year}/${fund}: parse failed — ${(e as Error).message}`,
        );
      }
    }
    if (funds.length > 0) snapshotsByYear.set(year, funds);

    // Pension yearbook (Table 6.3) — drives the depth-3 pension-type
    // breakdown. Optional; absence just leaves pensionTypes null in the
    // artifact, the UI gracefully degrades.
    const yearbookPath = path.join(
      YEARBOOK_DIR,
      `Yearbook_Pensions_${year}.pdf`,
    );
    if (fs.existsSync(yearbookPath)) {
      try {
        const bytes = new Uint8Array(fs.readFileSync(yearbookPath));
        const parsed = await parsePensionYearbook(bytes, year);
        const buckets = aggregatePensionTypes(parsed);
        pensionTypesByYear.set(year, buckets);
        console.log(
          `  • ${year}/yearbook: old-age €${(buckets.oldAge.amountEur / 1e9).toFixed(2)}B + disability €${(buckets.disability.amountEur / 1e9).toFixed(2)}B + ${(buckets.social.amountEur / 1e6).toFixed(0)}M social`,
        );
      } catch (e) {
        console.log(
          `  • ${year}/yearbook: parse failed — ${(e as Error).message}`,
        );
      }
    }
  }

  if (snapshotsByYear.size === 0) {
    console.log(
      "\nNo B1 XLS files found under raw_data/budget/noi/. Manual fetch:" +
        "\n  curl -sSL -o raw_data/budget/noi/B1_2024_12_5500.xls \\" +
        '\n    "https://www.nssi.bg/wp-content/uploads/B1_2024_12_5500.xls"',
    );
    process.exit(1);
  }

  const file = buildNoiFundsFile(snapshotsByYear, pensionTypesByYear);
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(file, null, 2), "utf8");
  console.log(
    `\n→ wrote ${OUT_FILE} (${file.years.length} year(s), ${pensionTypesByYear.size} with pension-type detail)`,
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
