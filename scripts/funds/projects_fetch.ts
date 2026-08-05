// Download the ИСУН 2020 public "Проекти" XLSX export.
//
// Sibling of ./fetch.ts (which pulls the Beneficiary rollup). Both endpoints
// return the current state of the register on every call, so we always fetch
// fresh and stash a snapshot in data/_cache/funds/ (gitignored) for offline
// re-ingest via `--file`.
//
// The session warm-up, WAF retry and not-an-XLSX guard live in ./isun_download,
// shared with the Бенефициенти sibling — see the header there for why they exist.

import path from "path";
import { fileURLToPath } from "url";
import { downloadIsunExport } from "./isun_download";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The "Excel" export button on the public Project listing posts to this
// stable endpoint. GET-only — POST returns 405. Without query parameters it
// returns the full corpus.
export const PROJECTS_EXPORT_URL =
  "https://2020.eufunds.bg/bg/0/0/Project/ExportToExcel";

const SNAPSHOT_FILE = path.resolve(
  __dirname,
  "../../data/_cache/funds/projects.xlsx",
);

export const fetchProjectsExport = (): Promise<Buffer> =>
  downloadIsunExport(PROJECTS_EXPORT_URL, SNAPSHOT_FILE);
