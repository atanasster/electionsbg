// Slim global search index for municipal officials. Built from
// data/officials/municipal/index.json (the 2.2 MB master roster) by
// projecting each entry down to {slug, name, role, municipality, ...} so
// the global header search can include all 6,278 cacbg mayors / deputy-
// mayors / chairs / councillors / chief architects without pulling the
// 2.2 MB master onto every page load.
//
// Output: data/officials/municipal/search_index.json (~600 KB raw,
// ~150 KB gzipped). useSearchItems lazy-fetches this once and pushes
// each entry into the Fuse index with type "o" (official) — clicking
// routes to /officials/<slug>.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";
import { command, run, flag, boolean } from "cmd-ts";
import type {
  MunicipalIndexEntry,
  MunicipalIndexFile,
  MunicipalOfficialRole,
} from "../../src/data/dataTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const SRC_PATH = path.join(
  ROOT,
  "data",
  "officials",
  "municipal",
  "index.json",
);
const OUT_PATH = path.join(
  ROOT,
  "data",
  "officials",
  "municipal",
  "search_index.json",
);

// Compact wire shape — every byte counts since this ships on the global
// search fetch. We drop the role-raw label, normalised name, declaration
// year, etc. — Fuse keys on name only and the role bucket is enough for
// the search UI's group label.
type SlimEntry = {
  slug: string;
  name: string;
  role: MunicipalOfficialRole;
  municipality: string;
  /** Optional município code from candidateLink decoration when present —
   *  helps the search UI link back to the right MyArea council surface
   *  for high-priority hits (mayors / chairs). */
  district?: string;
};

type SearchIndexFile = {
  generatedAt: string;
  total: number;
  entries: SlimEntry[];
};

const ROLE_PRIORITY: Record<MunicipalOfficialRole, number> = {
  mayor: 0,
  council_chair: 1,
  deputy_mayor: 2,
  councillor: 3,
  chief_architect: 4,
  other: 5,
};

const main = (dryRun: boolean) => {
  const idx = JSON.parse(
    fs.readFileSync(SRC_PATH, "utf8"),
  ) as MunicipalIndexFile;
  // Sort by role priority then alpha so the search dropdown is
  // deterministic across rebuilds.
  const sorted = [...idx.entries].sort((a, b) => {
    const pa = ROLE_PRIORITY[a.role];
    const pb = ROLE_PRIORITY[b.role];
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name, "bg");
  });
  const out: SearchIndexFile = {
    generatedAt: new Date().toISOString(),
    total: sorted.length,
    entries: sorted.map(
      (e: MunicipalIndexEntry): SlimEntry => ({
        slug: e.slug,
        name: e.name,
        role: e.role,
        municipality: e.municipality,
        ...(e.district ? { district: e.district } : {}),
      }),
    ),
  };
  const json = JSON.stringify(out);
  const bytes = Buffer.byteLength(json, "utf8");
  console.log(
    `[municipal-search] ${out.total} entries — ${(bytes / 1024).toFixed(1)} KB raw`,
  );
  if (dryRun) {
    console.log("[municipal-search] dry-run: not writing");
    return;
  }
  fs.writeFileSync(OUT_PATH, json + "\n", "utf8");
  console.log(`[municipal-search] wrote ${OUT_PATH}`);
};

const cli = command({
  name: "build-municipal-search",
  description:
    "Project data/officials/municipal/index.json down to a slim search index for the global header. Output: data/officials/municipal/search_index.json.",
  args: {
    dryRun: flag({
      type: boolean,
      long: "dry-run",
      description: "Report size without writing the file.",
    }),
  },
  handler: ({ dryRun }) => main(dryRun),
});

run(cli, process.argv.slice(2));
