// Download the ИСУН 2020 public "Бенефициенти" XLSX export.
//
// The export is a single mutable URL — Beneficiary/ExportToExcel returns the
// current state of the register on every call — so it is always fetched
// fresh. A path-keyed cache (as procurement uses for its immutable per-UUID
// bundles) would silently serve stale data here. The downloaded file is still
// written to data/_cache/funds/ (gitignored) so an operator can re-ingest
// that exact snapshot offline via `--file`.
//
// The session warm-up, WAF retry and not-an-XLSX guard live in ./isun_download,
// shared with the Проекти sibling — see the header there for why they exist.

import path from "path";
import { fileURLToPath } from "url";
import { downloadIsunExport } from "./isun_download";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The "Excel" export button on the public Beneficiary listing posts to this
// stable endpoint. Without query parameters it returns the full corpus; the
// page's filters (Програма, dates, ЕИК) accept the same query string for
// ad-hoc scoped exports.
export const EXPORT_URL =
  "https://2020.eufunds.bg/bg/0/0/Beneficiary/ExportToExcel";

const SNAPSHOT_FILE = path.resolve(
  __dirname,
  "../../data/_cache/funds/beneficiaries.xlsx",
);

export const fetchBeneficiariesExport = (): Promise<Buffer> =>
  downloadIsunExport(EXPORT_URL, SNAPSHOT_FILE);
