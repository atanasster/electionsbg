// Builds data/budget/kfn/funds.json from the cached КФН quarterly ZIP under
// raw_data/budget/kfn/statistics_{YYYY}_q{N}.zip.
//
// The КФН ZIP GETs cleanly from fsc.bg (Apache 200), so this ingest can be
// automated; kept as a __write_ runner for parity with the other budget ingests.
//
//   tsx scripts/budget/kfn/__write_funds.ts
//
// Served at /budget/kfn/funds.json.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseKfnZip, isZip } from "./parse_kfn";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RAW_DIR = path.resolve(__dirname, "../../../raw_data/budget/kfn");
const OUT_FILE = path.resolve(__dirname, "../../../data/budget/kfn/funds.json");

const main = (): void => {
  if (!fs.existsSync(RAW_DIR)) {
    console.log(`No ${RAW_DIR}. Fetch the latest КФН quarterly ZIP, e.g.:
  curl -sSL -o raw_data/budget/kfn/statistics_2025_q2.zip \\
    "https://www.fsc.bg/wp-content/uploads/2025/08/statistics_2025_q2-1.zip"`);
    process.exit(1);
  }
  // Newest ZIP by filename (statistics_YYYY_qN.zip sorts chronologically).
  const zips = fs
    .readdirSync(RAW_DIR)
    .filter((f) => /\.zip$/i.test(f))
    .sort();
  const latest = zips[zips.length - 1];
  if (!latest) {
    console.log(`No .zip under ${RAW_DIR}.`);
    process.exit(1);
  }
  const bytes = new Uint8Array(fs.readFileSync(path.join(RAW_DIR, latest)));
  if (!isZip(bytes)) {
    console.log(`${latest} is not a ZIP (soft-404 HTML?).`);
    process.exit(1);
  }
  const file = parseKfnZip(bytes);
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(file, null, 2), "utf8");

  const byPillar = new Map<string, number>();
  for (const f of file.funds)
    byPillar.set(f.pillar, (byPillar.get(f.pillar) ?? 0) + 1);
  console.log(
    `→ wrote ${OUT_FILE} — ${file.periodLabel} (${file.period}), ` +
      `${file.funds.length} funds [${[...byPillar]
        .map(([p, n]) => `${p}:${n}`)
        .join(" ")}]`,
  );
};

main();
