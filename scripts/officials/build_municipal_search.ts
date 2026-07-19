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
  /** The unified person slug this official resolves to (unified person layer,
   *  set only when the name maps to EXACTLY ONE public person). The search links
   *  such rows to /person/<personSlug> instead of /officials/<slug>. */
  personSlug?: string;
};

// Resolve each official name to the unified person layer, SAFELY: a name that maps to
// exactly one active public person (the same discipline as person_by_name — never a
// common namesake). Returns {slug, isCandidate} so the caller can (a) drop rows whose
// person ALSO appears in the header search as a candidate (the duplicate the user sees),
// and (b) link the survivors to /person. Degrades to an empty map if PG is unreachable
// (a fresh clone / CI without a database), so the build never depends on Postgres.
const resolvePersons = async (
  names: string[],
): Promise<Map<string, { slug: string; isCandidate: boolean }>> => {
  const map = new Map<string, { slug: string; isCandidate: boolean }>();
  try {
    const { allRows, end } = await import("../db/lib/pg");
    const rows = await allRows<{
      name: string;
      slug: string;
      is_cand: boolean;
    }>(
      `WITH q AS (SELECT DISTINCT n AS name FROM unnest($1::text[]) AS n)
       SELECT q.name, m.slug, m.is_cand
       FROM q
       JOIN LATERAL (
         SELECT p.slug,
                EXISTS(SELECT 1 FROM person_role r
                        WHERE r.person_id = p.person_id AND r.source IN ('candidate','mp')) AS is_cand
         FROM person p
         WHERE p.name_fold = translit_bg_latin(q.name)
           AND p.status = 'active' AND p.is_public_figure
       ) m ON true
       WHERE (SELECT count(*) FROM person p2
               WHERE p2.name_fold = translit_bg_latin(q.name)
                 AND p2.status = 'active' AND p2.is_public_figure) = 1`,
      [[...new Set(names)]],
    );
    for (const r of rows)
      map.set(r.name, { slug: r.slug, isCandidate: r.is_cand });
    await end();
    console.log(
      `[municipal-search] person layer: resolved ${map.size} of ${new Set(names).size} names`,
    );
  } catch (e) {
    console.log(
      `[municipal-search] person layer unreachable — skipping dedup/link (${String(e).slice(0, 60)})`,
    );
  }
  return map;
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

const main = async (dryRun: boolean) => {
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
  // Unify with the person layer: drop the rows whose person ALSO appears as a candidate
  // (the duplicate in the header search — keep the candidate row), and stamp the survivors
  // with their person slug so the search links them to the single /person profile.
  const resolved = await resolvePersons(sorted.map((e) => e.name));
  let dropped = 0;
  const entries: SlimEntry[] = [];
  for (const e of sorted) {
    const r = resolved.get(e.name);
    if (r?.isCandidate) {
      dropped++; // same person is a candidate → drop this duplicate official row
      continue;
    }
    entries.push({
      slug: e.slug,
      name: e.name,
      role: e.role,
      municipality: e.municipality,
      ...(e.district ? { district: e.district } : {}),
      ...(r ? { personSlug: r.slug } : {}),
    });
  }
  if (dropped)
    console.log(
      `[municipal-search] dropped ${dropped} candidate-duplicate row(s)`,
    );
  const out: SearchIndexFile = {
    generatedAt: new Date().toISOString(),
    total: entries.length,
    entries,
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
