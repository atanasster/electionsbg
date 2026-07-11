// Култура ingest — the НФЦ (National Film Center) Единен публичен регистър
// sources: the per-year .xls registers of financed films/series. Single source
// shared by the ingest parser AND the watcher (scripts/watch/sources/
// nfc_film_register.ts), so the download list can't drift. See plan §5, §8.
//
// The files live under one wp-content/uploads path; filenames are NOT uniform
// per year (the register was re-uploaded piecemeal), so the map is explicit.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const NFC_REGISTER_PAGE =
  "https://www.nfc.bg/статистика-публичен-регистър/единен-публичен-регистър/";

// nfc.bg / ncf.bg WAF-block self-identifying bot User-Agents (the watcher's
// default "electionsbg-watch/1.0" gets a persistent HTTP 403), but serve a
// real-browser UA fine. Shared by the ingests AND the watchers so neither drifts.
export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const BASE = "https://www.nfc.bg/wp-content/uploads/2022/07";

/** year → source .xls filename (relative to BASE). */
export const NFC_FILES: Record<number, string> = {
  2014: "Registar-filmi-2014.xls",
  2015: "Registar-filmi-2015.xls",
  2016: "Registar-filmi-2016.xls",
  2017: "Registar-filmi-2017.xls",
  2018: "Registar-filmi-2018.xls",
  2019: "Registar-filmi-2019.xls",
  2020: "Registar-filmi-2020.xls",
  2021: "Registar-filmi-NFC-2021-1.xls",
  2022: "Finansirane-na-proizvodstvo-2022.xls",
  2023: "Finansirane-na-proizvodstvo-na-filmi-2023-2.xls",
  2024: "Registar-filmi-i-seriali-2024-15072025.xls",
  2025: "Registar-finansirani-filmi-i-seriali-2025.xls",
};

export const NFC_YEARS = Object.keys(NFC_FILES)
  .map(Number)
  .sort((a, b) => a - b);

export const nfcFileUrl = (year: number): string =>
  `${BASE}/${NFC_FILES[year]}`;

/** Cached raw dir (gitignored). Re-downloads only what's missing. */
export const RAW_DIR = path.resolve(__dirname, "../../raw_data/culture/nfc");

/** Fetch one year's .xls into the cache (skips if present) and return its bytes. */
export const fetchNfcYear = async (
  year: number,
  { force = false }: { force?: boolean } = {},
): Promise<Buffer> => {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const dest = path.join(RAW_DIR, `${year}.xls`);
  if (!force && fs.existsSync(dest)) return fs.readFileSync(dest);
  const res = await fetch(nfcFileUrl(year), {
    headers: { "User-Agent": BROWSER_UA },
  });
  if (!res.ok) throw new Error(`НФЦ ${year}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf;
};
