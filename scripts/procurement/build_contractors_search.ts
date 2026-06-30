// Slim company-search index for procurement contractors. Built by walking the
// per-EIK rollup shards in data/procurement/contractors/*.json and projecting
// each down to {eik, name} so the procurement dashboard's company-search tile
// (CompanySearchTile) can offer all ~26k contractors without pulling any heavy
// per-company file. Kept OFF the global header search on purpose — at ~475 KB
// gz it's too heavy for the election-first audience that mounts every page.
//
// Output: data/procurement/derived/contractors_search.json (~1.8 MB raw,
// ~475 KB gz, ~26k entries). useContractorsIndex() (src/data/procurement/
// useContractorsSearch.tsx) lazy-fetches it on first focus of the procurement
// dashboard's CompanySearchTile and runs a token-AND substring filter over a
// bilingual (Cyrillic + transliterated) haystack — clicking routes to
// /company/<eik>. NOT wired into the global header / Fuse index (see above).
//
// Mirror of scripts/officials/build_municipal_search.ts. Entries are ordered by
// total euro value desc so the highest-volume company wins a match tie before
// the result cap. Run standalone (`tsx scripts/procurement/build_contractors_search.ts`)
// or via writeDerived() in the procurement derived pipeline, which calls
// writeContractorsSearch after it rewrites top_contractors.json.

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { command, run, flag, boolean } from "cmd-ts";

type SlimEntry = { eik: string; name: string };

type ContractorsSearchFile = {
  generatedAt: string;
  total: number;
  entries: SlimEntry[];
};

/** Project every contractor shard down to {eik, name}, value-ranked. Shared by
 *  the standalone CLI and the derived pipeline. Returns null when the shard dir
 *  is missing (a fresh clone before any procurement ingest). */
export const buildContractorsSearch = (
  contractorsDir: string,
): ContractorsSearchFile | null => {
  if (!fs.existsSync(contractorsDir)) return null;
  const rows: Array<{ eik: string; name: string; totalEur: number }> = [];
  for (const file of fs.readdirSync(contractorsDir)) {
    if (!file.endsWith(".json")) continue;
    const c = JSON.parse(
      fs.readFileSync(path.join(contractorsDir, file), "utf8"),
    ) as { eik?: string; name?: string; totalEur?: number };
    if (!c.eik || !c.name) continue;
    rows.push({ eik: c.eik, name: c.name, totalEur: c.totalEur ?? 0 });
  }
  rows.sort((a, b) => b.totalEur - a.totalEur);
  return {
    generatedAt: new Date().toISOString(),
    total: rows.length,
    entries: rows.map(({ eik, name }) => ({ eik, name })),
  };
};

/** Build + write the slim contractors search index next to the other derived
 *  artifacts. No-op (with a warning) when the shard dir is empty. */
export const writeContractorsSearch = (
  derivedDir: string,
  contractorsDir: string,
): void => {
  const out = buildContractorsSearch(contractorsDir);
  if (!out) {
    console.warn(
      `[contractors-search] ${contractorsDir} not found — skipping search index`,
    );
    return;
  }
  const json = JSON.stringify(out);
  fs.mkdirSync(derivedDir, { recursive: true });
  fs.writeFileSync(
    path.join(derivedDir, "contractors_search.json"),
    json + "\n",
    "utf8",
  );
  console.log(
    `[contractors-search] ${out.total} entries — ${(
      Buffer.byteLength(json, "utf8") / 1024
    ).toFixed(0)} KB raw → ${path.join(derivedDir, "contractors_search.json")}`,
  );
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const CONTRACTORS_DIR = path.join(ROOT, "data", "procurement", "contractors");
const DERIVED_DIR = path.join(ROOT, "data", "procurement", "derived");

const cli = command({
  name: "build-contractors-search",
  description:
    "Project data/procurement/contractors/*.json down to a slim {eik,name} search index for the procurement dashboard's company search. Output: data/procurement/derived/contractors_search.json.",
  args: {
    dryRun: flag({
      type: boolean,
      long: "dry-run",
      description: "Report size without writing the file.",
    }),
  },
  handler: ({ dryRun }) => {
    if (dryRun) {
      const out = buildContractorsSearch(CONTRACTORS_DIR);
      console.log(
        `[contractors-search] dry-run: ${out?.total ?? 0} entries (not writing)`,
      );
      return;
    }
    writeContractorsSearch(DERIVED_DIR, CONTRACTORS_DIR);
  },
});

// Only run the CLI when invoked directly — derived.ts imports
// writeContractorsSearch from this module and must not trigger a build.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run(cli, process.argv.slice(2));
}
