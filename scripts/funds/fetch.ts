// Download the ИСУН 2020 public "Бенефициенти" XLSX export and cache it
// locally. The export is ~2.5 MB — too large to commit but cheap to re-fetch
// — so it's cached under data/_cache/funds/ (gitignored, per the project's
// _cache convention for re-fetchable upstream XLSX/PDF artifacts).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The "Excel" export button on the public Beneficiary listing posts to this
// stable endpoint. Without query parameters it returns the full corpus; the
// page's filters (Програма, dates, ЕИК) accept the same query string for
// ad-hoc scoped exports.
export const EXPORT_URL =
  "https://2020.eufunds.bg/bg/0/0/Beneficiary/ExportToExcel";

const CACHE_DIR = path.resolve(__dirname, "../../data/_cache/funds");
const CACHE_FILE = path.join(CACHE_DIR, "beneficiaries.xlsx");
const UA = "electionsbg.com data pipeline (eu-funds)";

export const fetchBeneficiariesExport = async (
  opts: { refresh?: boolean } = {},
): Promise<Buffer> => {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (!opts.refresh && fs.existsSync(CACHE_FILE)) {
    return fs.readFileSync(CACHE_FILE);
  }
  const res = await fetch(EXPORT_URL, {
    headers: {
      "User-Agent": UA,
      Accept:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
  if (!res.ok) {
    throw new Error(`GET ${EXPORT_URL} → ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  try {
    fs.writeFileSync(CACHE_FILE, buf);
  } catch (e) {
    console.warn(`  cache write failed: ${(e as Error).message}`);
  }
  return buf;
};
