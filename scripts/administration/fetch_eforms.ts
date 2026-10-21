// Fetch МЕУ's еФорми request volumes (data.egov.bg dataset 20218) into the COMMITTED snapshot
// data/administration/eforms_requests.json — the input of db:load:admin-service-requests:pg.
// See eforms.ts for what the numbers are and are not.
//
//   npx tsx scripts/administration/fetch_eforms.ts                  # fetch + write
//   npx tsx scripts/administration/fetch_eforms.ts --dry            # fetch, report, write nothing
//   npx tsx scripts/administration/fetch_eforms.ts --allow-shrink   # a month really was withdrawn
//
// One listDatasets call plus one getResourceData per month (~23), serial.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getResourceData, listDatasetsByIds } from "../budget/lib/egov_api";
import {
  EFORMS_DATASET_ID,
  EFORMS_DATASET_URI,
  droppedPeriods,
  parseEformsSnapshot,
  parseEformsTable,
  periodOfResourceName,
  serialiseEforms,
  tableOf,
  type EformsMonth,
  type EformsSnapshot,
} from "./eforms";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const EFORMS_SNAPSHOT = path.join(
  ROOT,
  "data/administration/eforms_requests.json",
);

const main = async (): Promise<void> => {
  const dry = process.argv.includes("--dry");
  const allowShrink = process.argv.includes("--allow-shrink");
  const [ds] = await listDatasetsByIds([EFORMS_DATASET_ID]);
  if (!ds || ds.uri !== EFORMS_DATASET_URI)
    throw new Error(
      `dataset ${EFORMS_DATASET_ID} not found (or its uri moved: ${ds?.uri})`,
    );

  const months: EformsMonth[] = [];
  for (const r of ds.resources) {
    const period = periodOfResourceName(r.name);
    if (!period) throw new Error(`resource ${r.uri} names no month: ${r.name}`);
    if (months.some((m) => m.period === period))
      throw new Error(`two resources claim ${period} — refusing to pick one`);
    // The API hands back the {headers,rowN} object under `data`, not the typed 2D array.
    const rows = parseEformsTable(
      tableOf(await getResourceData(r.uri)),
      period,
    );
    months.push({
      period,
      resourceUri: r.uri,
      updatedAt: r.updated_at ?? r.created_at,
      rows,
    });
  }
  months.sort((a, b) => a.period.localeCompare(b.period));

  const total = months.reduce(
    (s, m) => s + m.rows.reduce((t, r) => t + r.requests, 0),
    0,
  );
  console.log(
    `еФорми: ${months.length} month(s) ${months[0]?.period}…${months.at(-1)?.period}, ` +
      `${total.toLocaleString("en")} requests`,
  );

  let unchanged = false;
  if (existsSync(EFORMS_SNAPSHOT)) {
    const prev = parseEformsSnapshot(readFileSync(EFORMS_SNAPSHOT, "utf8"));
    const lost = droppedPeriods(prev.months, months);
    if (lost.length && !allowShrink)
      throw new Error(
        `month(s) ${lost.join(", ")} were published before and are absent now — ` +
          `re-run, or pass --allow-shrink if МЕУ withdrew them`,
      );
    // A fresh `fetchedAt` alone is not a change worth a commit diff on a committed file.
    unchanged = JSON.stringify(prev.months) === JSON.stringify(months);
  }
  if (dry) {
    console.log("--dry: nothing written");
    return;
  }
  if (unchanged) {
    console.log("no month changed — snapshot left as is");
    return;
  }
  const snap: EformsSnapshot = {
    datasetId: EFORMS_DATASET_ID,
    datasetUri: EFORMS_DATASET_URI,
    fetchedAt: new Date().toISOString(),
    months,
  };
  writeFileSync(EFORMS_SNAPSHOT, serialiseEforms(snap));
  console.log(`wrote ${path.relative(ROOT, EFORMS_SNAPSHOT)}`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
