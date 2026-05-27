// Download the ИСУН 2020 public "Проекти" XLSX export.
//
// Sibling of ./fetch.ts (which pulls the Beneficiary rollup). Both endpoints
// return the current state of the register on every call, so we always fetch
// fresh and stash a snapshot in data/_cache/funds/ (gitignored) for offline
// re-ingest via `--file`.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The "Excel" export button on the public Project listing posts to this
// stable endpoint. GET-only — POST returns 405. Without query parameters it
// returns the full corpus.
export const PROJECTS_EXPORT_URL =
  "https://2020.eufunds.bg/bg/0/0/Project/ExportToExcel";

const SNAPSHOT_DIR = path.resolve(__dirname, "../../data/_cache/funds");
const SNAPSHOT_FILE = path.join(SNAPSHOT_DIR, "projects.xlsx");
const UA = "electionsbg.com data pipeline (eu-funds-projects)";

export const fetchProjectsExport = async (): Promise<Buffer> => {
  const res = await fetch(PROJECTS_EXPORT_URL, {
    headers: {
      "User-Agent": UA,
      Accept:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
  if (!res.ok) {
    throw new Error(
      `GET ${PROJECTS_EXPORT_URL} → ${res.status} ${res.statusText}`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  try {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(SNAPSHOT_FILE, buf);
  } catch (e) {
    console.warn(`  snapshot write failed: ${(e as Error).message}`);
  }
  return buf;
};
