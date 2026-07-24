// One-off repair: rename every officials shard on disk to the slug it would get
// today, now that both ingests hash the CANONICAL declarant name (./shared.ts)
// with the person-GUID alias table folded in (./declarant_aliases.ts).
//
// The register re-spelled declarants between folder years — ALL-CAPS through the
// 2023 folder, Title Case from 2024, hyphen spacing that came and went, an
// occasional "д-р" — and the OLD slug hashed the raw string, so each spelling
// forked one person into a fresh profile. steps 1 and 2 fixed the ingest, but an
// ingest run only rewrites the folder year it targets: the ~20,800 shards already
// on disk, and their rows in index.json, keep the old slugs until something moves
// them. This does.
//
// For every shard, the NEW slug is recomputed with exactly the ingest's logic —
// aliasedDeclarantName(guid) → officialSlug(name, disambiguator), with the same
// `${institution}|${guid}` fold the executive ingest applies to a listed
// collision GUID. Shards whose new slug collides are UNION-merged
// (mergeDeclarations dedupes by sourceUrl), so a person forked across two files
// becomes one. The index row is rebuilt from the merged shard's newest filing so
// the published name matches the slug.
//
// SAFETY. The rename must only ever FOLD one person's spellings together, never
// bring two people onto one slug. Before writing anything the script proves that:
// for every target slug, the union of the source shards' person-GUIDs must be a
// set the OLD layout already had on a single slug — i.e. no target introduces a
// person-GUID pair that was previously apart. It aborts loud if one would.
//
// Keys the old→new map on the whole slug, never on a shared body: dropping a
// title shortens the body too (d-r-asya-… → asya-…), so a body-keyed match would
// miss exactly the 13 profiles the title rule exists to merge.
//
// Manual by design, like every one-off backfill here. Dry by default:
//   tsx scripts/officials/migrate_slug_normalisation.ts            # report only
//   tsx scripts/officials/migrate_slug_normalisation.ts --apply    # rename them
//   tsx scripts/officials/migrate_slug_normalisation.ts --apply --redirects out.json
//
// AFTER --apply, the derived artifacts still name the old slugs. The script
// prints the commands that rebuild them.

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { command, run, flag, boolean, option, optional, string } from "cmd-ts";
import type {
  MunicipalIndexEntry,
  MunicipalIndexFile,
  OfficialDeclaration,
  OfficialIndexEntry,
  OfficialIndexFile,
} from "../../src/data/dataTypes";
import { mergeDeclarations } from "./merge";
import { emitShards } from "./build_municipal_shards";
import { buildRankingEntries, writeRankings } from "./rankings";
import { aliasedDeclarantName } from "./declarant_aliases";
import { personGuidFromSourceUrl } from "./slug_identity";
import {
  canonicalDeclarantName,
  officialSlug,
  ROOT,
  slugify,
  writeJson,
} from "./shared";

// Normally data/officials; OFFICIALS_MIGRATE_DIR points it at an isolated copy
// so the apply path can be exercised end-to-end without touching the real corpus
// (see migrate_slug_normalisation.apply.test.ts).
const OFFICIALS_DIR =
  process.env.OFFICIALS_MIGRATE_DIR ?? path.join(ROOT, "data", "officials");

const SLUG_COLLISION_GUIDS = new Set(
  (
    JSON.parse(
      fs.readFileSync(
        path.join(ROOT, "scripts/officials/_slug_collisions.json"),
        "utf-8",
      ),
    ) as { guids: string[] }
  ).guids.map((g) => g.toUpperCase()),
);

/** One tree's on-disk layout and the ingest rule that mints its slugs. */
type Tree = {
  label: string;
  declDir: string;
  indexFile: string;
  /** The plain (non-GUID-folded) disambiguator for an index row. */
  disambiguator: (row: IndexRow) => string;
  /** Whether this tree folds a listed collision GUID into the disambiguator. */
  foldsCollisionGuid: boolean;
};

type IndexRow = OfficialIndexEntry & MunicipalIndexEntry;

const TREES: Tree[] = [
  {
    label: "executive",
    declDir: path.join(OFFICIALS_DIR, "declarations"),
    indexFile: path.join(OFFICIALS_DIR, "index.json"),
    disambiguator: (r) => r.institution,
    foldsCollisionGuid: true,
  },
  {
    label: "municipal",
    declDir: path.join(OFFICIALS_DIR, "municipal", "declarations"),
    indexFile: path.join(OFFICIALS_DIR, "municipal", "index.json"),
    disambiguator: (r) => `${r.municipality}|${r.role}`,
    foldsCollisionGuid: false,
  },
];

const readShard = (dir: string, slug: string): OfficialDeclaration[] => {
  const file = path.join(dir, `${slug}.json`);
  // An index row whose shard is absent is a corrupt corpus, not a rename input —
  // name it rather than throwing an opaque ENOENT mid-plan.
  if (!fs.existsSync(file))
    throw new Error(`index.json names ${slug} but ${file} is missing`);
  return JSON.parse(fs.readFileSync(file, "utf-8")) as OfficialDeclaration[];
};

export const guidsOf = (decls: OfficialDeclaration[]): Set<string> => {
  const out = new Set<string>();
  for (const d of decls) {
    const g = personGuidFromSourceUrl(d.sourceUrl);
    if (g) out.add(g);
  }
  return out;
};

/** The disambiguator a row's CURRENT slug was minted with. Recovered by
 *  reproducing the slug — first plain, then GUID-folded for the executive
 *  collision list. The migration must group by the SAME disambiguator the old
 *  slug used, or a re-mint would silently move a profile between institutions.
 *
 *  Tries BOTH mint functions: RAW slugify for a pre-migration shard, and
 *  officialSlug for one an ingest run has already re-minted since step 1. That
 *  makes the migration idempotent (a second run reproduces every slug and moves
 *  nothing) and robust to a corpus that is half-migrated because the ingest ran
 *  in between. */
const oldDisambiguator = (row: IndexRow, tree: Tree): string | null => {
  const candidates = [tree.disambiguator(row)];
  if (tree.foldsCollisionGuid) {
    for (const guid of SLUG_COLLISION_GUIDS)
      candidates.push(`${row.institution}|${guid}`);
  }
  for (const dis of candidates)
    if (
      slugify(row.name, dis) === row.slug ||
      officialSlug(row.name, dis) === row.slug
    )
      return dis;
  return null;
};

/** The new slug for a shard: alias the declarant by the person-GUID its filings
 *  carry, then hash the canonical name against the same disambiguator. */
export const newSlugFor = (
  row: IndexRow,
  disambiguator: string,
  decls: OfficialDeclaration[],
): { slug: string; name: string } => {
  // A shard's filings all belong to one register person, so any aliased GUID on
  // it names this declarant. Take the first that the table knows.
  let name = row.name;
  for (const g of guidsOf(decls)) {
    const aliased = aliasedDeclarantName(g, row.name);
    if (aliased !== row.name) {
      name = aliased;
      break;
    }
  }
  // The GUID fold in the disambiguator carries over verbatim — it was recovered
  // from the OLD slug, so re-hashing it keeps a listed collision separated.
  return { slug: officialSlug(name, disambiguator), name };
};

export type Move = {
  oldSlug: string;
  newSlug: string;
  row: IndexRow;
  decls: OfficialDeclaration[];
  disambiguator: string;
  newName: string;
};

type Plan = {
  tree: Tree;
  moves: Move[];
  /** newSlug → the moves that land on it (>1 ⟹ a fold). */
  byTarget: Map<string, Move[]>;
  unreproducible: string[];
};

const planTree = (tree: Tree): Plan => {
  const index = JSON.parse(fs.readFileSync(tree.indexFile, "utf-8")) as {
    entries: IndexRow[];
  };
  const moves: Move[] = [];
  const unreproducible: string[] = [];
  for (const row of index.entries) {
    const disambiguator = oldDisambiguator(row, tree);
    if (disambiguator === null) {
      unreproducible.push(row.slug);
      continue;
    }
    const decls = readShard(tree.declDir, row.slug);
    const { slug: newSlug, name: newName } = newSlugFor(
      row,
      disambiguator,
      decls,
    );
    moves.push({
      oldSlug: row.slug,
      newSlug,
      row,
      decls,
      disambiguator,
      newName,
    });
  }
  const byTarget = new Map<string, Move[]>();
  for (const m of moves)
    byTarget.set(m.newSlug, [...(byTarget.get(m.newSlug) ?? []), m]);
  return { tree, moves, byTarget, unreproducible };
};

/** Prove the rename only folds within one person. A target that unites two
 *  register person-GUIDs which no chain of shared shards connects is a
 *  two-people merge — the exact defect the whole change exists to avoid — so
 *  refuse the run.
 *
 *  The GUID-bearing shards must form ONE connected component: two GUIDs may sit
 *  on a target only if a shard carries both (a re-issued id, the Николай
 *  Стефанов Петров shape) or a chain of such bridges links them. Computed as a
 *  union-find over the shards' GUID sets, so it does not depend on which shard
 *  happens to come first — an order-dependent "intersect the head" check would
 *  falsely reject a valid fold whose bridge shard was not first. A shard with no
 *  GUID proves no identity and is ignored: it neither joins nor splits a
 *  component, so it can never mask a genuine collision behind it. */
export const unsafeFold = (guidSets: ReadonlySet<string>[]): boolean => {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const union = (a: string, b: string): void => {
    parent.set(find(a), find(b));
  };
  for (const set of guidSets) {
    const guids = [...set];
    for (const g of guids) if (!parent.has(g)) parent.set(g, g);
    // Every GUID sharing a shard joins one component.
    for (let i = 1; i < guids.length; i++) union(guids[0], guids[i]);
  }
  const roots = new Set([...parent.keys()].map(find));
  return roots.size > 1;
};

const unsafeFolds = (plan: Plan): string[] => {
  const problems: string[] = [];
  for (const [target, group] of plan.byTarget) {
    if (group.length < 2) continue;
    if (unsafeFold(group.map((m) => guidsOf(m.decls)))) {
      problems.push(
        `${target} ← ${group.map((m) => `${m.oldSlug} {${[...guidsOf(m.decls)].join(",") || "—"}}`).join(" + ")}`,
      );
    }
  }
  return problems;
};

/** Rebuild an index row for a (possibly merged) target shard: carry the
 *  descriptors from the source whose newest filing is latest, but stamp the new
 *  slug and the canonical name. */
export const rebuildRow = (target: string, group: Move[]): IndexRow => {
  const winner = [...group].sort(
    (a, b) => b.row.latestDeclarationYear - a.row.latestDeclarationYear,
  )[0];
  return {
    ...winner.row,
    slug: target,
    name: winner.newName,
    normalizedName: canonicalDeclarantName(winner.newName),
  };
};

/** Union every source shard for a target, restamp the moved rows' slug. */
const mergeTarget = (target: string, group: Move[]): OfficialDeclaration[] => {
  let merged: OfficialDeclaration[] = [];
  for (const m of group) {
    const restamped = m.decls.map((d) => ({ ...d, slug: target }));
    merged = mergeDeclarations(merged, restamped, []);
  }
  return merged;
};

const applyTree = (plan: Plan): { renamed: number; folded: number } => {
  const { tree } = plan;
  // Write every target to a temp name first, then swap, so a target that shares
  // a name with an untouched source is never half-written. Simpler here: build
  // all target contents in memory (the corpus is ~40 MB), then rewrite the
  // whole declarations dir.
  const targets = new Map<
    string,
    { decls: OfficialDeclaration[]; row: IndexRow }
  >();
  for (const [target, group] of plan.byTarget) {
    targets.set(target, {
      decls: mergeTarget(target, group),
      row: rebuildRow(target, group),
    });
  }

  // Remove every old shard, then write the targets. Old and new slug sets
  // overlap heavily (a case-only re-spell keeps the body), so delete-then-write
  // in that order is required.
  for (const m of plan.moves)
    fs.rmSync(path.join(tree.declDir, `${m.oldSlug}.json`), { force: true });
  for (const [target, { decls }] of targets)
    writeJson(path.join(tree.declDir, `${target}.json`), decls);

  // Rewrite index.json from the rebuilt rows, sorted the way each ingest sorts.
  const raw = JSON.parse(fs.readFileSync(tree.indexFile, "utf-8")) as
    | OfficialIndexFile
    | MunicipalIndexFile;
  const entries = [...targets.values()].map((t) => t.row);
  const folded = plan.moves.length - targets.size;

  if (tree.label === "municipal") {
    const sorted = (entries as MunicipalIndexEntry[]).sort((a, b) =>
      a.name.localeCompare(b.name, "bg"),
    );
    const byRole = sorted.reduce(
      (acc, e) => ((acc[e.role] = (acc[e.role] ?? 0) + 1), acc),
      {} as Record<string, number>,
    );
    const out: MunicipalIndexFile = {
      ...(raw as MunicipalIndexFile),
      generatedAt: new Date().toISOString(),
      total: sorted.length,
      byRole: byRole as MunicipalIndexFile["byRole"],
      entries: sorted,
    };
    writeJson(tree.indexFile, out);
    // The per-obshtina shards are a projection of the roster — rebuild them from
    // the renamed entries, into THIS tree's by_obshtina (the override, when set),
    // never the production one. (search_index.json needs PG, so it is left to the
    // STILL STALE step below rather than rebuilt here.)
    emitShards(
      sorted,
      { generatedAt: out.generatedAt, years: out.years },
      { shardDir: path.join(path.dirname(tree.indexFile), "by_obshtina") },
    );
  } else {
    const sorted = (entries as OfficialIndexEntry[]).sort((a, b) =>
      a.name.localeCompare(b.name, "bg"),
    );
    const out: OfficialIndexFile = {
      ...(raw as OfficialIndexFile),
      generatedAt: new Date().toISOString(),
      total: sorted.length,
      entries: sorted,
    };
    writeJson(tree.indexFile, out);
    // assets-rankings*.json read every shard on disk keyed on the index slug —
    // rebuild them from THIS tree's declarations so the leaderboard names the new
    // slugs, and write them into THIS tree (the override, when set), never the
    // production one.
    writeRankings(
      buildRankingEntries(sorted, tree.declDir),
      out.years,
      path.dirname(tree.indexFile),
    );
  }
  return {
    renamed: plan.moves.filter((m) => m.oldSlug !== m.newSlug).length,
    folded,
  };
};

const cmd = command({
  name: "migrate-slug-normalisation",
  description:
    "Rename every officials shard to its canonical slug (rule C + the person-GUID alias table), folding the profiles the register's re-spellings had split.",
  args: {
    apply: flag({
      type: boolean,
      long: "apply",
      description: "Write the renames (default: report only)",
    }),
    redirects: option({
      type: optional(string),
      long: "redirects",
      description:
        "Write the old→new slug map (changed slugs only) to this JSON file, for SPA/sitemap redirects",
    }),
  },
  handler: ({ apply, redirects }) => {
    const plans = TREES.filter((t) => fs.existsSync(t.indexFile)).map(planTree);

    // A slug the migration cannot reproduce means its disambiguator is unknown,
    // so re-minting it would guess — abort rather than mis-file it.
    const bad = plans.filter((p) => p.unreproducible.length);
    if (bad.length) {
      for (const p of bad)
        console.error(
          `  [${p.tree.label}] ${p.unreproducible.length} slug(s) not reproducible, e.g. ${p.unreproducible.slice(0, 5).join(", ")}`,
        );
      throw new Error(
        "refusing to migrate: some on-disk slugs do not reproduce under the known ingest rules",
      );
    }

    // Prove no two-people merge before touching disk.
    const unsafe = plans.flatMap((p) =>
      unsafeFolds(p).map((s) => `[${p.tree.label}] ${s}`),
    );
    if (unsafe.length) {
      for (const line of unsafe) console.error(`  UNSAFE ${line}`);
      throw new Error(
        `refusing to migrate: ${unsafe.length} target slug(s) would merge two register persons`,
      );
    }

    const renameMap: Record<string, string> = {};
    for (const p of plans)
      for (const m of p.moves)
        if (m.oldSlug !== m.newSlug) renameMap[m.oldSlug] = m.newSlug;

    for (const p of plans) {
      const changed = p.moves.filter((m) => m.oldSlug !== m.newSlug).length;
      const folds = [...p.byTarget.values()].filter((g) => g.length > 1);
      const foldedShards = folds.reduce((n, g) => n + g.length - 1, 0);
      console.log(
        `→ [${p.tree.label}] ${p.moves.length} shard(s): ${changed} renamed, ${folds.length} fold group(s) reuniting ${foldedShards} shard(s), ${p.byTarget.size} profile(s) after`,
      );
      for (const g of folds.slice(0, 8)) {
        console.log(
          `    ${g[0].newSlug} ⇐ ${g.map((m) => m.oldSlug).join(" + ")}  (${g[0].newName})`,
        );
      }
      if (folds.length > 8) console.log(`    …and ${folds.length - 8} more`);
    }

    // The redirect map is emitted in dry mode too, on purpose: it lets the
    // operator review exactly which URLs change before committing to the rename.
    if (redirects) {
      writeJson(path.resolve(redirects), renameMap);
      console.log(
        `→ wrote ${Object.keys(renameMap).length} redirect(s) to ${redirects}`,
      );
    }

    if (!apply) {
      console.log(
        `\n  --apply not set: nothing written. ${Object.keys(renameMap).length} slug(s) would change.`,
      );
      return;
    }

    let renamed = 0;
    let folded = 0;
    for (const p of plans) {
      const r = applyTree(p);
      renamed += r.renamed;
      folded += r.folded;
    }
    console.log(
      `\n  renamed ${renamed} shard(s); folded ${folded} duplicate profile(s) away.`,
    );
    console.log(
      "  STILL STALE — these read the old slugs and must be regenerated:\n" +
        "    tsx scripts/officials/build_municipal_search.ts  # municipal/search_index.json (needs PG for /person links)\n" +
        "    tsx scripts/run-officials-links-only.ts        # data/officials/derived/company_links.json\n" +
        "    tsx scripts/run-officials-connections-only.ts  # data/officials/derived/connections.json\n" +
        "    …then the connections graph (data/parliament/connections*.json, official-connections/)\n" +
        "    …and reload Postgres: npm run db:load:declarations (person_role.ref carries the slug)",
    );
  },
});

// Guarded so importing this module (the migration test does) never fires the
// CLI — which, with the wrong argv, would rename 20,000 shards on import.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run(cmd, process.argv.slice(2));
}
