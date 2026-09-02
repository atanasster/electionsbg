// Build the /data/map manifest: validate the curated model against the
// watcher registry, inject freshness from state/watch, run the ELK layered
// layout offline (the ~1.4 MB engine never ships to the client) and write
// the positioned graph to data/data_map.json.
//
//   npm run data:map
//
// The manifest lives under data/ (not public/) so it is served from the GCS
// data bucket like every other dataset — a data refresh ships it via
// `bucket:sync` without redeploying the whole site. It is regenerated in two
// places: as part of `prebuild` (so a watcher source missing from the map
// FAILS the build — the extensibility contract that new sources must be
// placed on the map), and as a derived post-step of the /process-watch-report
// ingestion flow (so the baked freshness tracks newly-ingested data).
//
// The write is churn-free: if the only difference from the existing file is
// the `generatedAt` timestamp, the file is left untouched so a no-op rebuild
// produces no git diff and no needless bucket re-upload.

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode } from "elkjs/lib/elk-api";
import { SOURCES } from "../watch/sources/index";
import { ALL_QUERIES } from "../../src/screens/dev/sqlLibrary";
import { isExcluded } from "../bucket_sync_paths";
import type { Cadence } from "../watch/types";
import {
  AI_PATH_RULES,
  DATASETS,
  type DatasetDef,
  type DatasetServing,
  UNCLAIMED,
  LINKS,
  type LinkDef,
  EDGES,
  FEATURES,
  SOURCE_GROUPS,
  TIERS,
  WATCH_ONLY_SOURCES,
  TOURS,
  VIEWS,
  type Lang,
  type Origin,
  type SourceIssue,
} from "./model";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const STATE_DIR = path.join(ROOT, "state/watch");
const OUT_FILE = path.join(ROOT, "data/data_map.json");

const NODE_W = 240;
const NODE_H = 62;
const TIER_PAD = 28;
const TIER_HEAD = 40;

type Kind = "source" | "dataset" | "feature";

export interface ManifestSourceRef {
  id: string;
  label: string;
  url: string;
  cadence?: Cadence;
  freshness?: string;
}

export interface ManifestNode {
  id: string;
  kind: Kind;
  label: Lang;
  detail: Lang;
  desc: Lang;
  tags: string[];
  url?: string;
  route?: string;
  origin?: Origin;
  cadence?: Cadence;
  freshness?: string;
  path?: string;
  /** What a reader fetches: "bucket" | "pg" | "both". */
  serving?: DatasetServing;
  /** Postgres relations this dataset owns (pg/both only). */
  tables?: string[];
  skills?: string[];
  sources?: ManifestSourceRef[];
  /** A known operational caveat about a source node — see SourceGroupDef.issue. */
  issue?: SourceIssue;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ManifestTier {
  kind: Kind;
  label: Lang;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ManifestLayout {
  /** Members of the view, at their positions IN that view's layout. */
  nodes: { id: string; x: number; y: number }[];
  /** Frames for the kinds the view actually contains — see §4 of the plan. */
  tiers: ManifestTier[];
}

export interface ManifestLink {
  id: string;
  /** Both `ds:*`, sorted — the pair is undirected. */
  a: string;
  b: string;
  /** Absent on a boundary link, which has no shared key by construction. */
  key?: string;
  kind: "join" | "boundary";
  label: Lang;
  /** Distinct keys present on BOTH sides; absent when not measurable. */
  overlap?: number;
  /** What the overlap is a share OF, when the key is sparse. */
  of?: Lang;
  /**
   * A /db library query that walks this link, if one exists — resolved HERE
   * rather than in the panel so the 20 KB of SQL never reaches the /data
   * bundle just to look up nine ids.
   */
  query?: string;
}

export interface DataMapManifest {
  version: number;
  generatedAt: string;
  nodes: ManifestNode[];
  edges: { id: string; from: string; to: string }[];
  views: { id: string; label: Lang; tag: string | null }[];
  tiers: ManifestTier[];
  /**
   * One baked layout per view id, `all` included — see
   * docs/plans/data-map-view-layouts-v1.md. The `?view=` filter used to DIM
   * the other 88 nodes and leave the graph at full size; with these it reflows,
   * which takes `elections` from 986x3584 to 952x624 at the same 1.15x zoom.
   *
   * Baked rather than computed client-side because ELK is ~1.4 MB and never
   * ships to the browser. The cost is one {id, x, y} per (view, member) pair.
   */
  layouts: Record<string, ManifestLayout>;
  /** Lateral dataset↔dataset links. NEVER an ELK input — see §1.1. */
  links: ManifestLink[];
  tours: { id: string; title: Lang; steps: { node: string; text: Lang }[] }[];
}

const fail = (msg: string): never => {
  console.error(`\ndata_map: ${msg}\n`);
  process.exit(1);
};

const readFreshness = (sourceId: string): string | undefined => {
  const file = path.join(STATE_DIR, `${sourceId}.json`);
  if (!fs.existsSync(file)) return undefined;
  try {
    const state = JSON.parse(fs.readFileSync(file, "utf-8")) as {
      lastChanged?: string;
    };
    return state.lastChanged;
  } catch {
    return undefined;
  }
};

const CADENCE_RANK: Record<Cadence, number> = {
  hourly: 0,
  daily: 1,
  weekly: 2,
  monthly: 3,
};

// ---------------------------------------------------------------------------
// Derived AI edges: scan ai/ for every data-path-shaped literal and map the
// paths to dataset nodes via AI_PATH_RULES. The `ds:* → f:ai` edges are
// therefore a faithful projection of what the assistant's tools actually
// read — a tool touching a new dataset surfaces on the map automatically
// (or fails the build until a rule places it).
//
// Deliberately literal-based rather than fetchData()-call-based: paths also
// flow through local wrappers (`grab(p)`, `fetchData<T>(path)`) and arrays
// (staticGeoMap sources), and call-anchored regexes silently miss nested
// generics like fetchData<DerivedFile<X>>(…). Matching any `/…*.json` or
// `.geojson` literal over-captures at worst a commented path — which maps to
// a dataset the assistant already reads — while never under-reporting.

const AI_DIR = path.join(ROOT, "ai");
const AI_SKIP = /(\.harness\.ts$|\.d\.ts$|\/tests\/|\/m0\/)/;
const PATH_RE = /(["'`])(\/[^"'`\s]+?\.(?:geo)?json)\1/g;

const walkTs = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") walkTs(full, out);
    } else if (entry.name.endsWith(".ts") && !AI_SKIP.test(full)) {
      out.push(full);
    }
  }
  return out;
};

const deriveAiEdges = (): { edges: [string, string][]; paths: number } => {
  const datasetIds = new Set(DATASETS.map((d) => d.id));
  const found = new Map<string, string[]>(); // normalised path -> files
  for (const file of walkTs(AI_DIR)) {
    const content = fs.readFileSync(file, "utf-8");
    for (const m of content.matchAll(PATH_RE)) {
      // `${expr}` → `{expr}` so rules can distinguish /{election}/ vs /{cycle}/.
      const norm = m[2].replace(/\$\{([^}]*)\}/g, "{$1}");
      found.set(norm, [...(found.get(norm) ?? []), path.relative(ROOT, file)]);
    }
  }

  const datasets = new Set<string>();
  const unmatched: string[] = [];
  for (const [p, files] of found) {
    const rule = AI_PATH_RULES.find((r) => r.pattern.test(p));
    if (!rule) {
      unmatched.push(`${p}  (${[...new Set(files)].join(", ")})`);
      continue;
    }
    if (rule.dataset === null) continue;
    if (!datasetIds.has(rule.dataset))
      fail(`AI_PATH_RULES maps "${p}" to unknown dataset "${rule.dataset}"`);
    datasets.add(rule.dataset);
  }
  if (unmatched.length)
    fail(
      `AI tool data path(s) with no AI_PATH_RULES entry:\n  ${unmatched.join("\n  ")}\n` +
        `Add a rule in scripts/data_map/model.ts so the dataset → AI edge is mapped.`,
    );

  return {
    edges: [...datasets].sort().map((d) => [`ds:${d}`, "f:ai"]),
    paths: found.size,
  };
};

/**
 * Rules 1-4 of the `serving` contract (plan §1b.2). Rule 5 — every non-noise
 * relation claimed by exactly one node — needs a live database and lands
 * separately.
 *
 * The point of rule 2 in particular: before `serving` existed, `path` meant
 * "where the JSON lives" OR "a load source nothing publishes" OR nothing at
 * all, and three nodes (ds:procurement, ds:funds, ds:opencalls) advertised
 * `data/` trees that `isExcluded` refuses to upload. A reader was told the data
 * was somewhere it is deliberately never served from.
 */
/**
 * A declared `path` must be a tree the bucket actually publishes. Applies to
 * BOTH "bucket" and "both" — this check originally ran only on "both", of which
 * there were no instances, so the invariant that motivated the whole `serving`
 * field was enforced nowhere it could fire.
 *
 * public/ paths are build outputs rather than synced data/ trees (and
 * `public/*.geojson` is a glob, not a sync-relative path), so they are exempt
 * rather than silently handed to isExcluded().
 */
const assertServedPath = (
  d: DatasetDef,
  onFail: (msg: string) => never,
): void => {
  if (!d.path) return;
  if (!d.path.startsWith("data/"))
    onFail(
      `dataset "${d.id}": path ${d.path} is not under data/. Both prior exceptions ` +
        `(public/{election}/ and public/*.geojson) named trees that do not exist — ` +
        `the served copies are data/{election}/ and data/maps/.`,
    );
  // A {template} segment is a real path shape (one tree per election/cycle), so
  // check the part above it rather than skipping the node entirely.
  const rel = d.path
    .replace(/^data\//, "")
    .replace(/\{[^}]*\}.*$/, "")
    .replace(/\/$/, "");
  if (!rel) return;
  const why = isExcluded(rel);
  if (why)
    onFail(
      `dataset "${d.id}": serving "${d.serving}" names path ${d.path}, but bucket sync ` +
        `excludes it (${why}). Nothing published means nothing a reader can fetch — ` +
        `either name a served subtree, or use serving "pg" and drop the path.`,
    );
};

/**
 * Rule 5 — coverage. Every relation in `public` is claimed by exactly one
 * dataset node, or named in UNCLAIMED with a reason. This is the extensibility
 * contract: a corpus that lands in Postgres without anyone deciding which
 * dataset it belongs to fails the build on the commit that adds it, rather
 * than being found by an audit weeks later (which is how ds:interreg and
 * ds:health were both found).
 *
 * Postgres-OPTIONAL by design: `npm run prebuild` runs on machines and in CI
 * with no database, and a coverage gate that cannot see the catalogue must
 * skip rather than fail — a false red on every no-DB build would get the gate
 * deleted. It logs the skip so the difference between "checked, clean" and
 * "could not check" stays visible.
 */
const validateRelationCoverage = async (): Promise<void> => {
  const { getPool, dbReachable, pinLocalDatabase } =
    await import("../db/lib/pg");
  // Always the LOCAL database: an ambient DATABASE_URL (a shell left pointing at
  // the Cloud SQL proxy) would otherwise validate the map against production.
  pinLocalDatabase();
  if (!(await dbReachable())) {
    console.warn(
      "data_map: relation-coverage gate SKIPPED — no reachable Postgres. " +
        "A new corpus can land unmapped until this runs against a database.",
    );
    return;
  }
  // Past this point a query failure is a REAL error and must surface. Catching
  // it here as "no database" is indistinguishable from the CI skip above.
  const pool = getPool();
  const { rows } = await pool.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'm') AND n.nspname = 'public'`,
  );

  const claimed = new Map<string, string>();
  for (const d of DATASETS)
    for (const t of d.tables ?? []) claimed.set(t, d.id);

  const live = new Set(rows.map((r) => r.relname));
  const unmapped = [...live]
    .filter((r) => !claimed.has(r) && !(r in UNCLAIMED))
    .sort();
  if (unmapped.length)
    fail(
      `${unmapped.length} Postgres relation(s) belong to no dataset node:\n  ` +
        unmapped.join("\n  ") +
        `\n\nAdd each to the owning DatasetDef's tables[] in model.ts — or, if it is ` +
        `scratch, ingest plumbing or an operator override, to UNCLAIMED with the reason. ` +
        `A whole corpus with no node is a MISSING DATASET, not an UNCLAIMED entry.`,
    );

  // ── The ABSENT direction only WARNS, and that asymmetry is load-bearing ────
  // "A live relation nobody claims" is monotone: the relation exists, so
  // somebody created it and owes it a home. "A claimed relation that is absent"
  // is not — six loaders are REFRESH_EXCLUSIONS members (db:load:tr:pg,
  // db:load:tender-dossier:pg, db:load:budget:pg, db:load:cr-*, company-founded),
  // so a machine that ran the documented `db:refresh` in full legitimately has
  // no tr_companies, tender_dossier or budget_* at all. Failing on that would
  // red-build a correctly set-up fresh clone — and against an EMPTY database it
  // would instruct the operator to delete all 20 correct UNCLAIMED entries.
  const ghosts = Object.keys(UNCLAIMED)
    .filter((r) => !live.has(r))
    .sort();
  const claimedGhosts = [...claimed.entries()]
    .filter(([r]) => !live.has(r))
    .map(([r, d]) => `${r} (ds:${d})`)
    .sort();
  if (ghosts.length || claimedGhosts.length)
    console.warn(
      `data_map: ${ghosts.length + claimedGhosts.length} declared relation(s) are ` +
        `absent from this database — expected when a REFRESH_EXCLUSIONS loader has ` +
        `not run here, a defect only if they are gone for good:\n  ` +
        [...ghosts.map((g) => `${g} (UNCLAIMED)`), ...claimedGhosts].join(
          "\n  ",
        ),
    );

  console.log(
    `data_map: relation coverage OK — ${claimed.size} claimed, ` +
      `${Object.keys(UNCLAIMED).length} explicitly unclaimed, ${live.size} live.`,
  );
  // NOT pool.end() here: measureLinks() runs after this and would find the
  // pool closed, then report "no reachable Postgres" — a skip indistinguishable
  // from the CI one. main() closes it once, after the last consumer.
};

export /**
 * Lateral links: validate the shape, then MEASURE each join's overlap against
 * Postgres. Postgres-optional — with no database the committed manifest's
 * existing overlaps are carried forward (a build that stripped them on every
 * no-DB machine would churn the file), and only a NEW link with no prior value
 * is an error.
 */
/** Closes the shared pg pool if this build ever opened one. */
const closePoolIfOpen = async (): Promise<void> => {
  try {
    const { getPool } = await import("../db/lib/pg");
    await getPool().end();
  } catch {
    /* never opened, or already closed — nothing to do */
  }
};

export /**
 * The /db library query that walks a given link, matched on the `walks` tag.
 * Undirected, like the link itself.
 */
const queryForLink = (a: string, b: string, key: string): string | undefined =>
  ALL_QUERIES.find(
    (q) =>
      q.walks &&
      q.walks.key === key &&
      ((q.walks.a === a && q.walks.b === b) ||
        (q.walks.a === b && q.walks.b === a)),
  )?.id;

export const validateLinks = (
  links: LinkDef[] = LINKS,
  onFail: (msg: string) => never = fail,
): void => {
  const ids = new Set(DATASETS.map((d) => d.id));
  const seen = new Set<string>();
  for (const l of links) {
    const where = `link ${l.a} ↔ ${l.b}`;
    for (const side of [l.a, l.b])
      if (!ids.has(side)) onFail(`${where}: unknown dataset "${side}"`);
    if (l.a === l.b) onFail(`${where}: self-link`);
    if (l.a >= l.b)
      onFail(
        `${where}: endpoints must be sorted (a < b) so a pair cannot be declared twice ` +
          `in both directions`,
      );
    const pair = `${l.a}|${l.b}|${l.key ?? l.kind ?? "join"}`;
    if (seen.has(pair)) onFail(`${where}: duplicate link for key ${l.key}`);
    seen.add(pair);

    if (l.kind === "boundary") {
      // The whole point of a boundary is that there is no key. Giving it one —
      // or an overlap of 0 — says the opposite of what it means.
      if (l.key) onFail(`${where}: a boundary link must not declare a key`);
      if (l.measure) onFail(`${where}: a boundary link must not be measured`);
    } else if (!l.key) {
      onFail(`${where}: a join link needs a key`);
    }
  }
};

const measureLinks = async (): Promise<Record<string, { overlap: number }>> => {
  const linkId = (l: LinkDef) => `${l.a}|${l.b}|${l.key ?? "boundary"}`;

  // Carry forward what the COMMITTED manifest already measured. An empty map
  // would emit every link with no overlap, the churn-free guard would see a
  // real diff, and the file would be rewritten with all 17 values stripped —
  // on every no-DB machine, including CI's `prebuild`, and then published by
  // bucket:sync. The docstring used to claim this behaviour without doing it.
  const prior: Record<string, { overlap: number }> = {};
  try {
    const committed = JSON.parse(fs.readFileSync(OUT_FILE, "utf8")) as {
      links?: { id: string; overlap?: number }[];
    };
    for (const l of committed.links ?? [])
      if (typeof l.overlap === "number") prior[l.id] = { overlap: l.overlap };
  } catch {
    /* first build, or no committed manifest yet */
  }

  const { getPool, dbReachable, pinLocalDatabase } =
    await import("../db/lib/pg");
  pinLocalDatabase();
  if (!(await dbReachable())) {
    const unmeasured = LINKS.filter((l) => l.measure && !prior[linkId(l)]).map(
      (l) => `${l.a} ↔ ${l.b} (${l.key})`,
    );
    if (unmeasured.length)
      fail(
        `no reachable Postgres, and these link(s) have no previously measured ` +
          `overlap to carry forward:\n  ${unmeasured.join("\n  ")}\n` +
          `Run the build once against a database before committing a new link.`,
      );
    console.warn(
      `data_map: link overlaps NOT measured — no reachable Postgres; carrying ` +
        `forward ${Object.keys(prior).length} value(s) from the committed manifest.`,
    );
    return prior;
  }
  const pool = getPool();
  const col = (ref: string, normalise?: string) => {
    const [tbl, c] = ref.split(".");
    // replaceAll: a normaliser mentioning $1 twice otherwise leaves the second
    // as a live PG bind placeholder.
    const expr = normalise ? normalise.split("$1").join(`"${c}"`) : `"${c}"`;
    return { tbl, expr };
  };
  const live = new Set(
    (
      await pool.query<{ relname: string }>(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r','m') AND n.nspname = 'public'`,
      )
    ).rows.map((r) => r.relname),
  );
  const out: Record<string, { overlap: number }> = {};
  const skipped: string[] = [];
  for (const l of LINKS) {
    if (!l.measure) continue;
    const L = col(l.measure.left, l.measure.normalise);
    const R = col(l.measure.right, l.measure.normalise);
    // ⚠️ SKIP, never fail, on an absent relation. Eight of these links land on
    // tr_companies, whose only loader is a REFRESH_EXCLUSIONS member — so a
    // machine that ran the documented `db:refresh` in full legitimately has no
    // such table, and failing would red-build a correctly set-up clone. Worse,
    // an EMPTY table would route to the DEAD arm below and tell the operator to
    // delete a correct link. This is the same asymmetry validateRelationCoverage
    // settles: only "a live relation nobody claims" is monotone.
    if (!live.has(L.tbl) || !live.has(R.tbl)) {
      skipped.push(
        `${l.a} ↔ ${l.b} (${l.key}): ${!live.has(L.tbl) ? L.tbl : R.tbl} not present`,
      );
      continue;
    }
    const lw = l.measure.leftWhere ? ` AND (${l.measure.leftWhere})` : "";
    const rw = l.measure.rightWhere ? ` AND (${l.measure.rightWhere})` : "";
    const sql = `
      WITH a AS (SELECT DISTINCT ${L.expr} AS k FROM "${L.tbl}" WHERE ${L.expr} IS NOT NULL${lw}),
           b AS (SELECT DISTINCT ${R.expr} AS k FROM "${R.tbl}" WHERE ${R.expr} IS NOT NULL${rw})
      SELECT (SELECT count(*) FROM a) AS a_n,
             (SELECT count(*) FROM b) AS b_n,
             (SELECT count(*) FROM a JOIN b USING (k)) AS both_n`;
    let r;
    try {
      r = await pool.query<{ a_n: string; b_n: string; both_n: string }>(sql);
    } catch (e) {
      fail(
        `link ${l.a} ↔ ${l.b} (${l.key}): measuring ${l.measure.left} against ` +
          `${l.measure.right} failed — ${(e as Error).message}`,
      );
    }
    const aN = Number(r!.rows[0].a_n);
    const bN = Number(r!.rows[0].b_n);
    const overlap = Number(r!.rows[0].both_n);

    // ── The two zeroes ────────────────────────────────────────────────────
    // Both fail, with DIFFERENT messages, because the fixes are opposite. A
    // key that is absent or all-NULL is a DEAD link: remove it, or fix the
    // ingest (declaration_asset.ekatte is 100% NULL across 258,723 rows, and a
    // curated list with no measurement would have shipped it as a confident
    // claim). Two populated sides that do not intersect is a NORMALISATION
    // GAP: open_calls.programme_code measures 0 of 14 against
    // fund_projects.program_code only because ИСУН prefixes the 4-digit
    // period — 12 of 14 once stripped. A blanket "fail on 0" would have
    // rejected that real link and taught the next author to delete it.
    if (overlap === 0) {
      if (aN === 0 || bN === 0)
        fail(
          `link ${l.a} ↔ ${l.b} (${l.key}): DEAD — ` +
            `${aN === 0 ? l.measure.left : l.measure.right} has no non-NULL values at all. ` +
            `Remove the link, or fix the ingest that should be filling it.`,
        );
      const sample = async (ref: string, normalise?: string) => {
        const c = col(ref, normalise);
        const q = await pool.query<{ k: string }>(
          `SELECT DISTINCT ${c.expr} AS k FROM "${c.tbl}" WHERE ${c.expr} IS NOT NULL LIMIT 3`,
        );
        return q.rows.map((x) => x.k).join(", ");
      };
      fail(
        `link ${l.a} ↔ ${l.b} (${l.key}): NORMALISATION GAP — both sides are populated ` +
          `(${aN} and ${bN} distinct values) but they do not intersect.\n` +
          `  ${l.measure.left}: ${await sample(l.measure.left, l.measure.normalise)}\n` +
          `  ${l.measure.right}: ${await sample(l.measure.right, l.measure.normalise)}\n` +
          `Declare a measure.normalise expression that brings the two encodings together, ` +
          `or drop the link if they genuinely name different things.`,
      );
    }
    out[linkId(l)] = { overlap };
  }
  if (skipped.length)
    console.warn(
      `data_map: ${skipped.length} link(s) not measured — corpus absent here:\n  ` +
        skipped.join("\n  "),
    );
  const measured = Object.keys(out).length;
  console.log(
    `data_map: measured ${measured} lateral link overlap(s) — ` +
      Object.entries(out)
        .sort((x, y) => y[1].overlap - x[1].overlap)
        .slice(0, 4)
        .map(
          ([k, v]) =>
            `${k.split("|").slice(0, 2).join("↔")} ${v.overlap.toLocaleString()}`,
        )
        .join(", "),
  );
  return out;
};

export const validateDatasetServing = (
  datasets: DatasetDef[] = DATASETS,
  onFail: (msg: string) => never = fail,
): void => {
  const claimed = new Map<string, string>();
  for (const d of datasets) {
    const where = `dataset "${d.id}"`;
    if (d.serving === "bucket") {
      if (!d.path)
        onFail(
          `${where}: serving "bucket" requires a path (what readers fetch)`,
        );
      if (d.tables?.length)
        onFail(
          `${where}: serving "bucket" must not declare tables — use "both" if it owns relations`,
        );
      assertServedPath(d, onFail);
    } else {
      if (!d.tables?.length)
        onFail(
          `${where}: serving "${d.serving}" requires tables[] naming the relations it owns`,
        );
      if (d.serving === "pg" && d.path)
        onFail(
          `${where}: serving "pg" must not carry a path — ${d.path} is a load source, ` +
            `not something a reader fetches. Use "both" only if a served JSON tree also exists.`,
        );
      if (d.serving === "both") {
        if (!d.path) onFail(`${where}: serving "both" requires a path`);
        assertServedPath(d, onFail);
      }
    }
    for (const t of d.tables ?? []) {
      const prev = claimed.get(t);
      if (prev)
        onFail(
          `relation "${t}" is claimed by two datasets ("${prev}" and "${d.id}") — ` +
            `exactly one node may own it`,
        );
      claimed.set(t, d.id);
    }
  }
};

const validate = (edges: [string, string][]): void => {
  const registryIds = new Set(SOURCES.map((s) => s.id));
  const placed = new Map<string, string>();
  for (const g of SOURCE_GROUPS) {
    for (const m of g.members) {
      if (!registryIds.has(m))
        fail(
          `group "${g.id}" references unknown watcher source "${m}" — check scripts/watch/sources`,
        );
      if (placed.has(m))
        fail(
          `watcher source "${m}" appears in groups "${placed.get(m)}" and "${g.id}"`,
        );
      placed.set(m, g.id);
    }
  }
  // A watch-only source may not ALSO be placed: the exemption and a group
  // membership are two different claims about the same source, and the map
  // should never carry both.
  for (const id of Object.keys(WATCH_ONLY_SOURCES)) {
    if (!registryIds.has(id))
      fail(
        `WATCH_ONLY_SOURCES lists "${id}", which is not a watcher source — check scripts/watch/sources`,
      );
    if (placed.has(id))
      fail(
        `watcher source "${id}" is in WATCH_ONLY_SOURCES but also placed in group ` +
          `"${placed.get(id)}". It now feeds something, so delete the ` +
          `WATCH_ONLY_SOURCES entry.`,
      );
  }
  const missing = [...registryIds].filter(
    (id) => !placed.has(id) && !(id in WATCH_ONLY_SOURCES),
  );
  if (missing.length)
    fail(
      `watcher source(s) not placed on the data map: ${missing.join(", ")}.\n` +
        `Add them to a source group in scripts/data_map/model.ts (or create a new group + edges).\n` +
        `If the source ingests NOTHING and has no downstream, add it to ` +
        `WATCH_ONLY_SOURCES in model.ts with the reason instead — do not invent a dataset for it.`,
    );

  const nodeIds = new Set<string>([
    ...SOURCE_GROUPS.map((g) => `src:${g.id}`),
    ...DATASETS.map((d) => `ds:${d.id}`),
    ...FEATURES.map((f) => `f:${f.id}`),
  ]);
  if (nodeIds.size !== SOURCE_GROUPS.length + DATASETS.length + FEATURES.length)
    fail("duplicate node ids in model.ts");

  const connected = new Set<string>();
  for (const [from, to] of edges) {
    if (!nodeIds.has(from)) fail(`edge references unknown node "${from}"`);
    if (!nodeIds.has(to)) fail(`edge references unknown node "${to}"`);
    const tierOk =
      (from.startsWith("src:") && to.startsWith("ds:")) ||
      (from.startsWith("ds:") && to.startsWith("f:"));
    if (!tierOk)
      fail(`edge ${from} → ${to} must go source→dataset or dataset→feature`);
    connected.add(from);
    connected.add(to);
  }
  const orphans = [...nodeIds].filter((id) => !connected.has(id));
  if (orphans.length) fail(`node(s) with no edges: ${orphans.join(", ")}`);

  validateDatasetServing();
  validateLinks();

  const viewTags = new Set(VIEWS.map((v) => v.tag).filter(Boolean) as string[]);
  for (const n of [...SOURCE_GROUPS, ...DATASETS, ...FEATURES]) {
    for (const t of n.tags)
      if (!viewTags.has(t))
        fail(`node "${n.id}" carries tag "${t}" with no matching view`);
  }

  for (const tour of TOURS) {
    if (!tour.steps.length) fail(`tour "${tour.id}" has no steps`);
    for (const s of tour.steps)
      if (!nodeIds.has(s.node))
        fail(`tour "${tour.id}" step references unknown node "${s.node}"`);
  }
};

const buildNodes = (): ManifestNode[] => {
  const byId = new Map(SOURCES.map((s) => [s.id, s]));
  const nodes: ManifestNode[] = [];

  for (const g of SOURCE_GROUPS) {
    const members = g.members.map((id) => {
      const src = byId.get(id)!;
      return {
        id,
        label: src.label,
        url: src.url,
        cadence: src.cadence,
        freshness: readFreshness(id),
      } satisfies ManifestSourceRef;
    });
    const extras = (g.extras ?? []).map((e) => ({
      id: `static:${e.url}`,
      label:
        e.label.bg === e.label.en
          ? e.label.bg
          : `${e.label.bg} · ${e.label.en}`,
      url: e.url,
    }));
    const freshness = members
      .map((m) => m.freshness)
      .filter(Boolean)
      .sort()
      .pop();
    const cadence = members.length
      ? members
          .map((m) => m.cadence!)
          .sort((a, b) => CADENCE_RANK[a] - CADENCE_RANK[b])[0]
      : undefined;
    nodes.push({
      id: `src:${g.id}`,
      kind: "source",
      label: g.label,
      detail: g.detail,
      desc: g.desc,
      tags: g.tags,
      url: g.url,
      origin: g.origin,
      cadence,
      freshness,
      skills: g.skills,
      sources: [...members, ...extras],
      issue: g.issue,
      x: 0,
      y: 0,
      w: NODE_W,
      h: NODE_H,
    });
  }

  for (const d of DATASETS) {
    nodes.push({
      id: `ds:${d.id}`,
      kind: "dataset",
      label: d.label,
      detail: d.detail,
      desc: d.desc,
      tags: d.tags,
      path: d.path,
      serving: d.serving,
      ...(d.tables?.length ? { tables: d.tables } : {}),
      x: 0,
      y: 0,
      w: NODE_W,
      h: NODE_H,
    });
  }

  for (const f of FEATURES) {
    nodes.push({
      id: `f:${f.id}`,
      kind: "feature",
      label: f.label,
      detail: f.detail,
      desc: f.desc,
      tags: f.tags,
      route: f.route,
      url: f.href,
      x: 0,
      y: 0,
      w: NODE_W,
      h: NODE_H,
    });
  }

  return nodes;
};

const PARTITION: Record<Kind, number> = { source: 0, dataset: 1, feature: 2 };

const layout = async (
  nodes: ManifestNode[],
  edges: [string, string][],
): Promise<void> => {
  const elk = new ELK();
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.partitioning.activate": "true",
      "elk.layered.spacing.nodeNodeBetweenLayers": "110",
      "elk.spacing.nodeNode": "16",
      // React Flow draws its own bezier edges — ELK's per-edge routing
      // channels between layers only waste horizontal space.
      "elk.layered.spacing.edgeEdgeBetweenLayers": "2",
      "elk.layered.spacing.edgeNodeBetweenLayers": "8",
      "elk.spacing.edgeNode": "8",
      "elk.spacing.edgeEdge": "2",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.thoroughness": "30",
    },
    children: nodes.map((n) => ({
      id: n.id,
      width: n.w,
      height: n.h,
      layoutOptions: {
        "elk.partitioning.partition": String(PARTITION[n.kind]),
      },
    })),
    edges: edges.map(([from, to], i) => ({
      id: `e${i}`,
      sources: [from],
      targets: [to],
    })),
  };

  const res = await elk.layout(graph);
  const pos = new Map((res.children ?? []).map((c) => [c.id, c]));
  for (const n of nodes) {
    const p = pos.get(n.id);
    if (!p || p.x === undefined || p.y === undefined)
      fail(`ELK returned no position for ${n.id}`);
    n.x = Math.round(p!.x!);
    n.y = Math.round(p!.y!);
  }

  // Normalise to a small top-left origin.
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  for (const n of nodes) {
    n.x -= minX - TIER_PAD;
    n.y -= minY - (TIER_PAD + TIER_HEAD);
  }
};

// A tier with no members is OMITTED, not emitted empty: `Math.min()` over an
// empty array is Infinity, so a per-view layout for a view that contains no
// features would otherwise carry a frame at (Infinity, Infinity).
const buildTiers = (nodes: ManifestNode[]): ManifestTier[] =>
  TIERS.flatMap((t) => {
    const members = nodes.filter((n) => n.kind === t.kind);
    if (!members.length) return [];
    const x0 = Math.min(...members.map((n) => n.x));
    const y0 = Math.min(...members.map((n) => n.y));
    const x1 = Math.max(...members.map((n) => n.x + n.w));
    const y1 = Math.max(...members.map((n) => n.y + n.h));
    return [
      {
        kind: t.kind,
        label: t.label,
        x: x0 - TIER_PAD,
        y: y0 - TIER_PAD - TIER_HEAD,
        w: x1 - x0 + TIER_PAD * 2,
        h: y1 - y0 + TIER_PAD * 2 + TIER_HEAD,
      },
    ];
  });

/**
 * The layout for one view: ELK over that view's members and the edges BETWEEN
 * them, on copies, so the `all` positions already on `nodes` are untouched.
 *
 * Running the real layout per view rather than reusing the `all` positions is
 * the whole point — a subset of a 3584px-tall column is still 3584px tall, and
 * what collapses the page is re-solving the column for 20 nodes instead of 108.
 */
const buildViewLayout = async (
  nodes: ManifestNode[],
  edges: [string, string][],
  tag: string | null,
): Promise<ManifestLayout> => {
  const members = tag ? nodes.filter((n) => n.tags.includes(tag)) : nodes;
  const ids = new Set(members.map((n) => n.id));
  const copies = members.map((n) => ({ ...n }));
  await layout(
    copies,
    edges.filter(([from, to]) => ids.has(from) && ids.has(to)),
  );
  return {
    nodes: copies.map((n) => ({ id: n.id, x: n.x, y: n.y })),
    tiers: buildTiers(copies),
  };
};

const main = async (): Promise<void> => {
  const ai = deriveAiEdges();
  const edges: [string, string][] = [...EDGES, ...ai.edges];
  validate(edges);
  // Rule 5 needs a database, so it sits here rather than inside the sync
  // validate(); it skips (loudly) when Postgres is unreachable.
  await validateRelationCoverage();
  const linkOverlaps = await measureLinks();
  // One close, after the last consumer: a pooled connection otherwise keeps the
  // process alive ~9.4s past the final write.
  await closePoolIfOpen();
  const nodes = buildNodes();
  await layout(nodes, edges);
  const tiers = buildTiers(nodes);

  // One ELK run per view (~200ms each), offline. `all` is included so the
  // client resolver has no special case for it.
  const layouts: Record<string, ManifestLayout> = {};
  for (const v of VIEWS)
    layouts[v.id] = await buildViewLayout(nodes, edges, v.tag);

  const manifest: DataMapManifest = {
    // v3: adds `layouts`, one baked ELK layout per view. Older cached copies
    // have no such field; dataMapView() falls back to the full graph plus the
    // pre-existing dimming, so a stale manifest still renders.
    // v2 added the lateral `links` array (step 4), which useDataMap coerces
    // to [] when absent.
    version: 3,
    generatedAt: new Date().toISOString(),
    nodes,
    edges: edges.map(([from, to], i) => ({ id: `e${i}`, from, to })),
    views: VIEWS,
    tiers,
    layouts,
    tours: TOURS,
    // NOT in `edges`: these never reach ELK (§1.1 — 15 of them shatter the
    // dataset tier into five columns and double the graph width).
    links: LINKS.map((l) => {
      const id = `${l.a}|${l.b}|${l.key ?? "boundary"}`;
      const o = linkOverlaps[id];
      return {
        id,
        a: `ds:${l.a}`,
        b: `ds:${l.b}`,
        ...(l.key ? { key: l.key } : {}),
        kind: l.kind ?? "join",
        label: l.note,
        ...(o ? { overlap: o.overlap } : {}),
        ...(l.measure?.of ? { of: l.measure.of } : {}),
        ...(queryForLink(l.a, l.b, l.key ?? "boundary")
          ? { query: queryForLink(l.a, l.b, l.key ?? "boundary") }
          : {}),
      };
    }),
  };

  // Churn-free write: keep the existing file (and its `generatedAt`) when the
  // only thing that would change is the timestamp — a no-op rebuild then leaves
  // no git diff and triggers no bucket re-upload.
  const next = `${JSON.stringify(manifest, null, 2)}\n`;
  const sansStamp = (s: string): string =>
    s.replace(/^\s*"generatedAt":\s*"[^"]*",\n/m, "");
  const unchanged =
    fs.existsSync(OUT_FILE) &&
    sansStamp(fs.readFileSync(OUT_FILE, "utf-8")) === sansStamp(next);
  if (unchanged) {
    console.log(
      `data_map: unchanged — kept ${path.relative(ROOT, OUT_FILE)} (no rewrite)`,
    );
    return;
  }
  fs.writeFileSync(OUT_FILE, next);
  const fresh = nodes.filter((n) => n.freshness).length;
  console.log(
    `data_map: wrote ${path.relative(ROOT, OUT_FILE)} — ${nodes.length} nodes ` +
      `(${SOURCE_GROUPS.length} source groups covering ${SOURCES.length} watched sources), ` +
      `${edges.length} edges (${ai.edges.length} dataset→AI derived from ` +
      `${ai.paths} data-path literals in ai/), freshness on ${fresh} nodes`,
  );
};

// Only build when RUN as a script. Without this guard, importing anything from
// this module (model.test.ts imports validateDatasetServing) starts main(),
// which lays the graph out and writes data/data_map.json — so `npm run
// test:unit` silently repaired a stale committed manifest mid-run, turning the
// drift test into "fail once, green on re-run" with the artifact quietly
// modified. Measured: a manifest doctored to 174 edges came back as 178.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
