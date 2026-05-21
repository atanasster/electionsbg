// Download the ИСУН 2020 public "Бенефициенти" XLSX export.
//
// The export is a single mutable URL — Beneficiary/ExportToExcel returns the
// current state of the register on every call — so it is always fetched
// fresh. A path-keyed cache (as procurement uses for its immutable per-UUID
// bundles) would silently serve stale data here. The downloaded file is still
// written to data/_cache/funds/ (gitignored) so an operator can re-ingest
// that exact snapshot offline via `--file`.

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

const SNAPSHOT_DIR = path.resolve(__dirname, "../../data/_cache/funds");
const SNAPSHOT_FILE = path.join(SNAPSHOT_DIR, "beneficiaries.xlsx");
const UA = "electionsbg.com data pipeline (eu-funds)";

export const fetchBeneficiariesExport = async (): Promise<Buffer> => {
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
  // Persist a snapshot so this run can be reproduced offline via `--file`.
  // Fire-and-forget — a failed write only loses that convenience.
  try {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(SNAPSHOT_FILE, buf);
  } catch (e) {
    console.warn(`  snapshot write failed: ${(e as Error).message}`);
  }
  return buf;
};
