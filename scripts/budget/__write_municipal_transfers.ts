// One-off: parse the cached budget-law HTML for every year in LAW_DV_MATERIALS
// and write the data/budget/municipal_transfers/ artifacts. Useful for testing
// the drilldown without running the full ingest pipeline (which can take
// several minutes). Production builds use scripts/budget/ingest.ts.
//
// Writes to data/budget/ only — Vite's dev middleware (see vite.config.ts)
// mounts data/ at the dev-server root, so the files are served at the same
// /budget/... paths the React Query hooks fetch.
//
//   tsx scripts/budget/__write_municipal_transfers.ts

import fs from "fs";
import zlib from "zlib";
import path from "path";
import { fileURLToPath } from "url";
import {
  parseMunicipalTransfers,
  buildTotalsFile,
  buildByOblastFile,
  buildOblastShards,
  type MunicipalTransfersIndexFile,
  type ParsedMunicipalTransfers,
} from "./municipal_transfers";
import { LAW_DV_MATERIALS } from "./fetch_sources";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_BUDGET_DIR = path.resolve(
  __dirname,
  "../../data/budget/municipal_transfers",
);

const writeJson = (file: string, obj: unknown): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
};

const cachedHtml = (year: number): string => {
  const file = path.resolve(
    __dirname,
    "../../raw_data/budget",
    `law-${year}.html.gz`,
  );
  return zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
};

const main = (): void => {
  const indexYears: MunicipalTransfersIndexFile["years"] = [];
  const parsedByYear = new Map<number, ParsedMunicipalTransfers>();
  const asOfByYear = new Map<number, string>();
  const sourceByYear = new Map<number, { documentId: string; url: string }>();

  for (const [yearStr, idMat] of Object.entries(LAW_DV_MATERIALS)) {
    const year = parseInt(yearStr, 10);
    let html: string;
    try {
      html = cachedHtml(year);
    } catch {
      console.log(`  • ${year}: no cached HTML, skipping`);
      continue;
    }
    let parsed;
    try {
      parsed = parseMunicipalTransfers(html, year);
    } catch (e) {
      console.log(`  • ${year}: parse failed — ${(e as Error).message}`);
      continue;
    }
    const source = {
      documentId: `law-${year}`,
      url: `https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=${idMat}`,
    };
    const asOf = `${year}-01-01`;
    const totals = buildTotalsFile(parsed, asOf, source);
    const oblast = buildByOblastFile(parsed, asOf, source);

    const dir = path.join(DATA_BUDGET_DIR, String(year));
    writeJson(path.join(dir, "totals.json"), totals);
    writeJson(path.join(dir, "by_oblast.json"), oblast);

    parsedByYear.set(year, parsed);
    asOfByYear.set(year, asOf);
    sourceByYear.set(year, source);
    indexYears.push({
      fiscalYear: year,
      municipalityCount: parsed.municipalities.length,
      grandTotalEur: parsed.rowSum.total.amountEur,
    });
    console.log(
      `  • ${year}: ${parsed.municipalities.length} общини, total €${(parsed.rowSum.total.amountEur / 1_000_000).toFixed(0)}M`,
    );
  }

  // Per-oblast shards — one file per oblast with all years × munis. The unit
  // region/municipality dashboards fetch.
  const shards = buildOblastShards(parsedByYear, asOfByYear, sourceByYear);
  for (const shard of shards) {
    writeJson(
      path.join(DATA_BUDGET_DIR, "oblasts", `${shard.oblastCode}.json`),
      shard,
    );
  }
  console.log(`  → ${shards.length} per-oblast shards`);

  const indexFile: MunicipalTransfersIndexFile = {
    generatedAt: new Date().toISOString(),
    years: indexYears.sort((a, b) => a.fiscalYear - b.fiscalYear),
  };
  writeJson(path.join(DATA_BUDGET_DIR, "index.json"), indexFile);
  console.log(
    `\n→ wrote ${indexYears.length * 3 + shards.length + 1} files under ${DATA_BUDGET_DIR}`,
  );
};

main();
