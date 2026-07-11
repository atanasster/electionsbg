// Builds data/budget/noi/pensions.json from the cached НОИ yearbook ZIPs under
// raw_data/budget/noi/yearbooks/Yearbook_Pensions_{YYYY}.zip.
//
// Unlike the B1 files (which 302-redirect on GET, so they are a manual drop),
// the yearbook ZIP GETs cleanly from nssi.bg — so this ingest can be fully
// automated. It is kept as a __write_ runner for parity with __write_funds.ts;
// the update-noi skill wires the fetch.
//
//   tsx scripts/budget/noi/__write_pensions.ts
//
// Vite mounts data/ at the dev-server root, so the file serves at
// /budget/noi/pensions.json.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  parseYearbookZip,
  buildNoiPensionsFile,
  isZip,
  type ParsedYearbook,
} from "./parse_yearbook_xlsx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const YEARBOOK_DIR = path.resolve(
  __dirname,
  "../../../raw_data/budget/noi/yearbooks",
);
const OUT_FILE = path.resolve(
  __dirname,
  "../../../data/budget/noi/pensions.json",
);

// Clean XLSX yearbooks exist for 2022+; earlier years are PDF-only.
const TRY_YEARS = [2022, 2023, 2024, 2025];

const main = async (): Promise<void> => {
  const parsed: ParsedYearbook[] = [];
  for (const year of TRY_YEARS) {
    const zipPath = path.join(YEARBOOK_DIR, `Yearbook_Pensions_${year}.zip`);
    if (!fs.existsSync(zipPath)) continue;
    const bytes = new Uint8Array(fs.readFileSync(zipPath));
    if (!isZip(bytes)) {
      console.log(`  • ${year}: not a ZIP (soft-404 HTML?) — skipped`);
      continue;
    }
    const p = parseYearbookZip(bytes, year);
    parsed.push(p);
    const dist = p.distribution;
    console.log(
      `  • ${year}: ${p.oblasts.length} oblasts, ` +
        `${dist ? dist.brackets.length + " brackets (Σ=" + dist.total + ")" : "no distribution"}, ` +
        `${p.national.length} national years`,
    );
  }

  if (parsed.length === 0) {
    console.log(
      "\nNo yearbook ZIPs under raw_data/budget/noi/yearbooks/. Fetch e.g.:" +
        "\n  curl -sSL -o raw_data/budget/noi/yearbooks/Yearbook_Pensions_2024.zip \\" +
        '\n    "https://www.nssi.bg/wp-content/uploads/Yearbook_Pensions_2024.zip"',
    );
    process.exit(1);
  }

  const file = await buildNoiPensionsFile(parsed);
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(file, null, 2), "utf8");
  const pov = file.distribution
    .map((d) => `${d.year}:${d.povertyLineBgn ?? "—"}`)
    .join(" ");
  console.log(
    `\n→ wrote ${OUT_FILE} — latest ${file.latestYear}, ` +
      `years [${file.years.join(", ")}], ` +
      `${Object.keys(file.oblasts).length} oblast-year(s), ` +
      `${file.distribution.length} distribution-year(s), poverty line ${pov}`,
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
