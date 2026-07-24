// Declaration coverage: what the register LISTS vs what we HOLD, per tier, per
// register folder.
//
// This exists because a whole tier can quietly hold half of what upstream
// publishes and nothing looks wrong. The MP ingest read only the FIRST
// Declaration node per person, so it took 246 of the 285 declarations the 2025
// folder lists — for years. Every file was present, every run reported success,
// and the only way to see it was to put the two numbers side by side.
//
// So the report is deliberately the comparison, not a count: a per-tier,
// per-folder table of listed vs held with the gap called out. Read-only —
// it fetches list.xml (one request per folder per tier) and reads the
// published JSON, and writes nothing.
//
//   npx tsx scripts/declarations/coverage.ts            # every folder on file
//   npx tsx scripts/declarations/coverage.ts --year 2025
//   npx tsx scripts/declarations/coverage.ts --offline  # skip the register, local counts only

import fs from "fs";
import path from "path";
import { Agent } from "undici";
import { command, run, optional, option, string, flag, boolean } from "cmd-ts";
import {
  REGISTER_BASE,
  extractDeclarationXmlFiles,
} from "../lib/cacbg_register";
import { categoriseRaw } from "../officials/categorise";
import { MP_CATEGORY_SUBSTRING } from "../watch/sources/cacbg_declarations";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);

// register.cacbg.bg serves an incomplete TLS chain; trust it only here.
const insecureDispatcher = new Agent({
  connect: { rejectUnauthorized: false },
});

const fetchListing = async (folder: string): Promise<string | null> => {
  try {
    const res = await fetch(`${REGISTER_BASE}/${folder}/list.xml`, {
      headers: { "User-Agent": "electionsbg.com coverage report" },
      // @ts-expect-error dispatcher is undici-only
      dispatcher: insecureDispatcher,
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
};

type Tier = {
  name: string;
  dir: string;
  /** Does this category belong to this tier's ingest? Must match the ingest's
   *  own filter exactly — that equality is what the report tests. */
  owns: (categoryName: string) => boolean;
};

const TIERS: Tier[] = [
  {
    name: "MPs",
    dir: "data/parliament/declarations",
    owns: (n) => n.includes(MP_CATEGORY_SUBSTRING),
  },
  {
    name: "executive",
    dir: "data/officials/declarations",
    owns: (n) => categoriseRaw(n) !== null,
  },
  {
    name: "municipal",
    dir: "data/officials/municipal/declarations",
    owns: (n) => n.includes("Кметове"),
  },
];

/** Declarations we hold, counted per register folder. */
const heldByFolder = (dir: string): Map<string, number> => {
  const out = new Map<string, number>();
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const f of fs.readdirSync(abs)) {
    if (!f.endsWith(".json")) continue;
    let rows: { sourceUrl: string }[];
    try {
      rows = JSON.parse(fs.readFileSync(path.join(abs, f), "utf-8"));
    } catch {
      continue;
    }
    for (const r of rows) {
      const m = /cacbg\.bg\/([^/]+)\//.exec(r.sourceUrl ?? "");
      if (!m) continue;
      out.set(m[1], (out.get(m[1]) ?? 0) + 1);
    }
  }
  return out;
};

const cmd = command({
  name: "coverage",
  description:
    "Compare declarations the register lists against the ones we hold, per tier and register folder.",
  args: {
    year: option({
      type: optional(string),
      long: "year",
      description: "Limit to one register folder (e.g. 2025, 2021_nc)",
    }),
    offline: flag({
      type: boolean,
      long: "offline",
      description: "Skip the register; report only what is held locally",
    }),
  },
  handler: async ({ year, offline }) => {
    let worstGap = 0;
    for (const tier of TIERS) {
      const held = heldByFolder(tier.dir);
      const folders = (year ? [year] : [...held.keys()]).sort();
      if (folders.length === 0) {
        console.log(`\n${tier.name}: nothing on file`);
        continue;
      }
      console.log(`\n${tier.name}  (${tier.dir})`);
      console.log(
        `  ${"folder".padEnd(10)}${"listed".padStart(8)}${"held".padStart(8)}${"gap".padStart(8)}`,
      );
      for (const folder of folders) {
        const have = held.get(folder) ?? 0;
        if (offline) {
          console.log(
            `  ${folder.padEnd(10)}${"-".padStart(8)}${String(have).padStart(8)}${"-".padStart(8)}`,
          );
          continue;
        }
        const xml = await fetchListing(folder);
        if (xml == null) {
          console.log(
            `  ${folder.padEnd(10)}${"n/a".padStart(8)}${String(have).padStart(8)}${"".padStart(8)}  (no list.xml upstream)`,
          );
          continue;
        }
        const listed = extractDeclarationXmlFiles(xml, tier.owns).length;
        const gap = listed - have;
        worstGap = Math.max(worstGap, gap);
        const flagged = gap > 0 ? `  ← ${gap} not held` : "";
        console.log(
          `  ${folder.padEnd(10)}${String(listed).padStart(8)}${String(have).padStart(8)}${String(gap).padStart(8)}${flagged}`,
        );
      }
    }
    if (!offline) {
      console.log(
        worstGap > 0
          ? `\nLargest gap: ${worstGap} declarations listed upstream but not held. A gap that is a large SHARE of a folder usually means the ingest is dropping rows (as .first() did for MPs), not that upstream rotted.`
          : `\nEvery listed declaration is held.`,
      );
    }
  },
});

run(cmd, process.argv.slice(2));
