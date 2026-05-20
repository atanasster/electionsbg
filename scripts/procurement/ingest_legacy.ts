// CLI: ingest one or more pre-OCDS annual CSV dumps from АОП.
//
//   tsx scripts/procurement/ingest_legacy.ts              # all years
//   tsx scripts/procurement/ingest_legacy.ts --year 2023
//   tsx scripts/procurement/ingest_legacy.ts --dry-run
//
// Writes Contract[] rows into data/procurement/contracts/<YYYY>/<YYYY-MM>.json
// using the same month-shard merge logic the OCDS ingest uses. Caches the raw
// CSV under raw_data/procurement/legacy/<year>.csv.gz so re-runs are cheap.

import fs from "fs";
import zlib from "zlib";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, optional, option, string, flag, boolean } from "cmd-ts";
import {
  LEGACY_DATASETS,
  parseLegacyCsv,
  fetchLegacyCsv,
  discoverLegacyDatasets,
  type LegacyDataset,
} from "./legacy_csv";
import { canonicalJson, validateContract } from "./validate";
import type { Contract } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROCUREMENT_DIR = path.resolve(__dirname, "../../data/procurement");
const CONTRACTS_DIR = path.join(PROCUREMENT_DIR, "contracts");
const CACHE_DIR = path.resolve(__dirname, "../../raw_data/procurement/legacy");

const cachePath = (year: string): string =>
  path.join(CACHE_DIR, `${year}.csv.gz`);

const loadCsv = async (
  ds: { year: string; datasetUuid: string; system: "CE" | "RL" | "OLDER" },
  opts: { refresh: boolean },
): Promise<string> => {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cache = cachePath(ds.year);
  if (!opts.refresh && fs.existsSync(cache)) {
    return zlib.gunzipSync(fs.readFileSync(cache)).toString("utf8");
  }
  console.log(`  • fetching ${ds.year} (${ds.system}) from data.egov.bg`);
  const text = await fetchLegacyCsv(ds);
  try {
    fs.writeFileSync(cache, zlib.gzipSync(text, { level: 9 }));
  } catch (e) {
    console.warn(`    cache write failed: ${(e as Error).message}`);
  }
  return text;
};

const rowKey = (r: Contract): string =>
  `${r.releaseId}::${r.contractId ?? ""}::${r.contractorEik}::${r.tag}`;

const rowSort = (a: Contract, b: Contract): number => {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  if (a.ocid !== b.ocid) return a.ocid.localeCompare(b.ocid);
  return rowKey(a).localeCompare(rowKey(b));
};

// Group rows by YYYY-MM and merge each into its month-shard. Same logic as
// ingest.ts.writeMonthShards but kept local to avoid coupling the legacy CLI
// to the OCDS ingest internals.
const writeMonthShards = (
  rows: Contract[],
): { newFiles: number; modifiedFiles: number } => {
  if (rows.length === 0) return { newFiles: 0, modifiedFiles: 0 };
  const byMonth = new Map<string, Contract[]>();
  for (const r of rows) {
    const month = r.date.slice(0, 7);
    const arr = byMonth.get(month) ?? [];
    arr.push(r);
    byMonth.set(month, arr);
  }
  let newFiles = 0;
  let modifiedFiles = 0;
  for (const [month, freshRows] of byMonth) {
    const year = month.slice(0, 4);
    const dir = path.join(CONTRACTS_DIR, year);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${month}.json`);
    const existing: Contract[] = fs.existsSync(file)
      ? (JSON.parse(fs.readFileSync(file, "utf8")) as Contract[])
      : [];
    const byKey = new Map<string, Contract>();
    for (const r of existing) byKey.set(rowKey(r), r);
    for (const r of freshRows) byKey.set(rowKey(r), r);
    const merged = [...byKey.values()].sort(rowSort);
    const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    const next = canonicalJson(merged);
    if (next === prev) continue;
    fs.writeFileSync(file, next);
    if (prev == null) newFiles++;
    else modifiedFiles++;
  }
  return { newFiles, modifiedFiles };
};

const main = async (args: {
  year?: string;
  refresh: boolean;
  dryRun: boolean;
  discover: boolean;
}): Promise<void> => {
  let targets: LegacyDataset[];
  if (args.discover) {
    console.log(
      "→ discovering annual-CSV datasets from the data.egov.bg АОП listing",
    );
    targets = await discoverLegacyDatasets();
    if (targets.length === 0) {
      console.log(
        "  no un-ingested annual-CSV years found — LEGACY_DATASETS is current",
      );
      return;
    }
    console.log(
      `  ${targets.length} new dataset(s): ${targets
        .map((d) => `${d.year} (${d.datasetUuid})`)
        .join(", ")}`,
    );
  } else {
    targets = args.year
      ? LEGACY_DATASETS.filter((d) => d.year === args.year)
      : LEGACY_DATASETS;
    if (targets.length === 0) {
      throw new Error(
        `no legacy dataset known for year "${args.year}". Valid years: ${LEGACY_DATASETS.map((d) => d.year).join(", ")}`,
      );
    }
  }

  console.log(`→ ingesting ${targets.length} legacy CSV dump(s)`);
  let totalRows = 0;
  let totalNewFiles = 0;
  let totalModifiedFiles = 0;
  for (const ds of targets) {
    const csvText = await loadCsv(ds, { refresh: args.refresh });
    const { rows, stats } = parseLegacyCsv(csvText, ds);
    rows.forEach(validateContract);
    console.log(
      `    ${stats.rowsSeen} row(s) seen, ${stats.rowsEmitted} emitted ` +
        `(dropped: no-buyer=${stats.droppedNoBuyer} no-contractor=${stats.droppedNoContractor} no-amount=${stats.droppedNoAmount})`,
    );
    if (stats.unmappedHeaders.length > 0) {
      console.log(
        `    ⚠ unmapped header(s): ${stats.unmappedHeaders.slice(0, 6).join(" | ")}`,
      );
    }
    totalRows += rows.length;
    if (!args.dryRun) {
      const { newFiles, modifiedFiles } = writeMonthShards(rows);
      totalNewFiles += newFiles;
      totalModifiedFiles += modifiedFiles;
      console.log(
        `    → wrote ${newFiles} new + ${modifiedFiles} modified month-shard(s)`,
      );
    }
  }

  if (args.dryRun) {
    console.log(`✓ dry run: ${totalRows} row(s) total — not written`);
    return;
  }
  console.log(
    `✓ ingested ${totalRows} row(s) into ${totalNewFiles} new + ${totalModifiedFiles} modified month-shard(s)`,
  );
  console.log(
    `  next: run \`npm run procurement:ingest -- --since 2020-01-01\` to rebuild rollups + cross-reference + by-id from the expanded corpus.`,
  );
};

const cli = command({
  name: "ingest_legacy",
  args: {
    year: option({
      type: optional(string),
      long: "year",
      description:
        "Ingest one specific year (2016 / 2017 / 2019 / 2020 / 2021 / 2022 / 2023 / 2011-2015). Default: all.",
    }),
    refresh: flag({
      type: optional(boolean),
      long: "refresh-cache",
      description: "Re-download even if cached",
      defaultValue: () => false,
    }),
    dryRun: flag({
      type: optional(boolean),
      long: "dry-run",
      description: "Parse + validate but do not write month-shards",
      defaultValue: () => false,
    }),
    discover: flag({
      type: optional(boolean),
      long: "discover",
      description:
        "Walk the АОП listing and ingest annual-CSV years not yet in LEGACY_DATASETS (ignores --year)",
      defaultValue: () => false,
    }),
  },
  handler: (args) =>
    main({
      year: args.year,
      refresh: !!args.refresh,
      dryRun: !!args.dryRun,
      discover: !!args.discover,
    }),
});

run(cli, process.argv.slice(2));
