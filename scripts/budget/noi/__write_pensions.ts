// Builds data/budget/noi/pensions.json from the cached НОИ yearbook ZIPs under
// raw_data/budget/noi/yearbooks/Yearbook_Pensions_{YYYY}.zip.
//
// Unlike the B1 files (which 302-redirect on GET, so they are a manual drop),
// the yearbook ZIP GETs cleanly from nssi.bg — so this ingest can be fully
// automated. It is kept as a __write_ runner for parity with __write_funds.ts;
// the update-noi skill wires the fetch.
//
//   tsx scripts/budget/noi/__write_pensions.ts [--fetch]
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

// Clean XLSX yearbooks exist for 2022+; earlier years are PDF-only. The
// range runs to the current year so a newly published yearbook is picked up
// without editing this file.
const FIRST_YEAR = 2022;
const TRY_YEARS = Array.from(
  { length: new Date().getFullYear() - FIRST_YEAR + 1 },
  (_, i) => FIRST_YEAR + i,
);
const yearbookUrl = (year: number): string =>
  `https://www.nssi.bg/wp-content/uploads/Yearbook_Pensions_${year}.zip`;

/** `--fetch`: refresh the cached yearbook ZIPs from nssi.bg before parsing.
 *  A missing year answers 302 (to a soft-404 page), so redirects are NOT
 *  followed and anything that is not a real ZIP is ignored — a cached copy is
 *  never overwritten with an error page. Returns false when no request
 *  succeeded at all, so an outage is not mistaken for "nothing published". */
const fetchYearbooks = async (): Promise<boolean> => {
  fs.mkdirSync(YEARBOOK_DIR, { recursive: true });
  let answered = 0;
  for (const year of TRY_YEARS) {
    const url = yearbookUrl(year);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      console.log(`  • ${year}: fetch failed (${(e as Error).message})`);
      continue;
    }
    answered++;
    if (res.status !== 200) {
      console.log(`  • ${year}: not published (HTTP ${res.status})`);
      continue;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!isZip(bytes)) {
      console.log(`  • ${year}: response is not a ZIP — kept cached copy`);
      continue;
    }
    const dest = path.join(YEARBOOK_DIR, `Yearbook_Pensions_${year}.zip`);
    const prev = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
    if (prev && Buffer.compare(prev, Buffer.from(bytes)) === 0) {
      console.log(`  • ${year}: unchanged (${bytes.length} bytes)`);
      continue;
    }
    fs.writeFileSync(dest, bytes);
    console.log(
      `  • ${year}: ${prev ? "updated" : "new"} (${bytes.length} bytes)`,
    );
  }
  return answered > 0;
};

const main = async (): Promise<void> => {
  if (process.argv.includes("--fetch")) {
    console.log("→ fetching yearbooks from nssi.bg");
    if (!(await fetchYearbooks())) {
      console.error("✗ nssi.bg did not answer for any year");
      process.exit(1);
    }
  }
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
        '\n    "https://www.nssi.bg/wp-content/uploads/Yearbook_Pensions_2024.zip"' +
        "\n  (or run with --fetch)",
    );
    process.exit(1);
  }

  const file = await buildNoiPensionsFile(parsed);
  // A re-run over unchanged yearbooks must not move the file: only
  // `generatedAt` would differ, and the pipeline reads any diff under data/
  // as a data change worth a public changelog row.
  const withoutStamp = (o: object): string =>
    JSON.stringify({ ...o, generatedAt: null });
  if (
    fs.existsSync(OUT_FILE) &&
    withoutStamp(JSON.parse(fs.readFileSync(OUT_FILE, "utf8"))) ===
      withoutStamp(file)
  ) {
    console.log(`\n→ ${OUT_FILE} unchanged — not rewritten`);
    return;
  }
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
