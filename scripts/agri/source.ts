// Source layer for the ДФ „Земеделие" (State Fund Agriculture) subsidy corpus.
//
// The CAP paying agency publishes one "Данни за изплатени субсидии за финансова
// година" CSV per financial year on data.egov.bg (organisation 56), reachable
// via the same POST JSON API the budget/procurement ingests already speak
// (scripts/budget/lib/egov_api.ts). Each row is one beneficiary × scheme payment
// with the beneficiary EIK (legal entities only — individuals carry name+oblast).
//
// A financial year runs 16 Oct (prev) → 15 Oct. Amounts are BGN in the source;
// the ingest converts to EUR at the locked changeover rate (see [[feedback_bg_uses_eur]]).
//
// getResourceData returns the whole sheet as a 2D row array (header row first),
// identical to the budget capital-programme feed. We cache the raw array under
// raw_data/agri/<year>.json so re-ingests don't re-pull ~300k rows/year over the
// network. The current two financial years (2024/2025) live only behind the SEU
// APEX register (a rolling window) — folded in later; egov is the deep backbone.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { getResourceData } from "../budget/lib/egov_api";

// Financial year → data.egov.bg resource uri (org 56, "Данни за изплатени
// субсидии"). 2014/2018/2019 are absent from the portal, and the 2020 resource
// exists but serves 0 rows (never populated). 2013 is a legacy benefit-list
// dataset with an unlabeled object-per-row shape (no EIK/amount columns) — not
// the modern 12-column sheet — so it is excluded; the corpus is the consistent
// 2015+ schema.
export const AGRI_YEAR_RESOURCES: Record<number, string> = {
  2015: "af68bcf4-872e-45ad-9cfb-9bad448283b5",
  2016: "f86ef30e-2dc5-4142-a082-28f402bd3d4a",
  2017: "02a21ae5-4fec-4f4c-abc4-400adf348e9e",
  2021: "75d24a08-969f-481a-b18f-458075535a8c",
  2022: "6143ad6c-5339-42fd-9e16-813267496980",
  2023: "d1031bc1-7cdf-4a27-8716-899a4877ad76",
};

export const AGRI_YEARS: number[] = Object.keys(AGRI_YEAR_RESOURCES)
  .map(Number)
  .sort((a, b) => a - b);

const CACHE_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "raw_data",
  "agri",
);

/** The raw 2D sheet for one financial year, from the on-disk cache when present,
 *  else fetched from data.egov.bg and cached. */
export const loadYearSheet = async (year: number): Promise<unknown[][]> => {
  const uri = AGRI_YEAR_RESOURCES[year];
  if (!uri) throw new Error(`No egov resource for financial year ${year}`);
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = path.join(CACHE_DIR, `${year}.json`);
  if (existsSync(cacheFile)) {
    return JSON.parse(readFileSync(cacheFile, "utf8")) as unknown[][];
  }
  const rows = await getResourceData(uri);
  // Don't cache a transient empty/failed pull — a 0-byte cache would masquerade
  // as "no data" on every later run.
  if (rows.length > 0) writeFileSync(cacheFile, JSON.stringify(rows));
  return rows;
};
