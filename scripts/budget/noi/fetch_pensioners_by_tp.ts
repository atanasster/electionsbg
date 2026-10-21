// Fetch НОИ pensioners by territorial division (data.egov.bg dataset 10480) into
// data/budget/noi/pensioners_by_tp.json — served like the other data/budget/noi/ artifacts
// (Vite mounts data/ at the root, so /budget/noi/pensioners_by_tp.json). See
// pensioners_by_tp.ts for the crosswalk and what the counts mean.
//
//   npm run noi:pensioners-by-tp            # fetch + write
//   npm run noi:pensioners-by-tp -- --dry   # fetch, report, write nothing
//
// Updated about once a year (the 2025 column landed 2026-06-24).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getResourceTable, listDatasetsByIds } from "../lib/egov_api";
import {
  NOI_TP_DATASET_ID,
  NOI_TP_DATASET_URI,
  parsePensionersByTp,
  type PensionersByTp,
} from "./pensioners_by_tp";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const OUT = path.join(ROOT, "data/budget/noi/pensioners_by_tp.json");

const main = async (): Promise<void> => {
  const dry = process.argv.includes("--dry");
  const [ds] = await listDatasetsByIds([NOI_TP_DATASET_ID]);
  if (!ds || ds.uri !== NOI_TP_DATASET_URI)
    throw new Error(
      `dataset ${NOI_TP_DATASET_ID} not found (or its uri moved: ${ds?.uri})`,
    );
  if (ds.resources.length !== 1)
    throw new Error(
      `expected one resource, found ${ds.resources.length} — the layout changed`,
    );
  const [r] = ds.resources;
  const parsed = parsePensionersByTp(await getResourceTable(r.uri));
  const out: PensionersByTp = {
    source: {
      datasetId: NOI_TP_DATASET_ID,
      datasetUri: NOI_TP_DATASET_URI,
      resourceUri: r.uri,
      publishedAt: r.updated_at ?? r.created_at,
    },
    unit: "average monthly pensioners",
    ...parsed,
  };
  const last = parsed.years.at(-1)!;
  console.log(
    `НОИ by ТП: ${parsed.territories.length} ТП + international, ${parsed.years[0]}…${last}, ` +
      `${parsed.total[last].toLocaleString("en")} pensioners in ${last}`,
  );
  if (existsSync(OUT)) {
    const prev = JSON.parse(readFileSync(OUT, "utf8")) as PensionersByTp;
    const lost = prev.years.filter((y) => !parsed.years.includes(y));
    if (lost.length)
      throw new Error(`year(s) ${lost.join(", ")} disappeared — refusing`);
  }
  if (dry) {
    console.log("--dry: nothing written");
    return;
  }
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
