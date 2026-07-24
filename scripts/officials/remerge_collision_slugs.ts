// One-off repair: fold back the profiles that a false-positive entry in
// ./_slug_collisions.json split apart.
//
// A GUID listed in that file is re-slugged as slugify(name, `${institution}|
// ${guid}`), which pulls its filings out of the profile the bare
// slugify(name, institution) would have given them. That is right for a genuine
// same-name pair and wrong for everything else — and 67 of the 72 GUIDs the file
// once held were not second people at all (see the `_whatBelongsHere` note
// there). The damage is already on disk: 74 shards whose slug encodes a GUID
// that is no longer listed, among them three quarters of Диана Ковачева's
// filings and five sixths of Петко Салчев's.
//
// Removing the entries does not undo that by itself. An ingest run only rewrites
// the folder year it targets, so the orphan shards, and their rows in
// index.json, would simply persist. This script moves them.
//
// A shard is an orphan when one of its filings' filename heads H satisfies
//   slugify(name, `${institution}|${H}`) === <its own slug>
// for the name and institution its index row carries, and H is NOT in the
// current _slug_collisions.json. Its target is slugify(name, institution) — the
// slug it would get today. H is taken verbatim from the filename rather than via
// personGuid(): most of these heads are per-DOCUMENT guids, which is exactly why
// they were mistaken for second people.
//
// Manual by design, like every one-off backfill here — it is not wired into
// `npm run data`. Dry by default:
//   tsx scripts/officials/remerge_collision_slugs.ts            # report only
//   tsx scripts/officials/remerge_collision_slugs.ts --apply    # move them
//
// index.json and assets-rankings*.json are rebuilt in place — no network, no
// ingest run. The officials→company cross-reference and the connections graph
// still name the old slugs afterwards; the script prints the two commands.

import fs from "fs";
import path from "path";
import { command, run, flag, boolean } from "cmd-ts";
import type {
  OfficialDeclaration,
  OfficialIndexEntry,
  OfficialIndexFile,
} from "../../src/data/dataTypes";
import { mergeDeclarations } from "./merge";
import {
  buildRankingEntries,
  DECL_DIR,
  OUT_DIR,
  writeRankings,
} from "./rankings";
import { ROOT, slugify, writeJson } from "./shared";

const INDEX_FILE = path.join(OUT_DIR, "index.json");

const listedGuids = (): Set<string> =>
  new Set(
    (
      JSON.parse(
        fs.readFileSync(
          path.join(ROOT, "scripts/officials/_slug_collisions.json"),
          "utf-8",
        ),
      ) as { guids: string[] }
    ).guids.map((g) => g.toUpperCase()),
  );

/** The 36-character head of a declaration filename, whatever it turns out to
 *  mean — a person id, or the per-document id that caused all this. */
const filenameHead = (sourceUrl: string): string =>
  (sourceUrl.split("/").pop() ?? "").slice(0, 36);

const readShard = (slug: string): OfficialDeclaration[] => {
  const file = path.join(DECL_DIR, `${slug}.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf-8")) as OfficialDeclaration[];
};

type Orphan = {
  slug: string;
  target: string;
  guid: string;
  entry: OfficialIndexEntry;
  decls: OfficialDeclaration[];
};

const findOrphans = (
  index: OfficialIndexFile,
  listed: Set<string>,
): Orphan[] => {
  const out: Orphan[] = [];
  for (const entry of index.entries) {
    const decls = readShard(entry.slug);
    if (decls.length === 0) continue;
    for (const head of new Set(decls.map((d) => filenameHead(d.sourceUrl)))) {
      if (!head || listed.has(head.toUpperCase())) continue;
      // The slug was built from the UPPER-cased head, while 134 of the 138
      // bare-guid filenames arrive lower-case — so reproducing the slug means
      // trying both forms, not the one the URL happens to carry.
      const forms = [head.toUpperCase(), head];
      if (
        !forms.some(
          (h) =>
            slugify(entry.name, `${entry.institution}|${h}`) === entry.slug,
        )
      ) {
        continue;
      }
      out.push({
        slug: entry.slug,
        target: slugify(entry.name, entry.institution),
        guid: head,
        entry,
        decls,
      });
      break;
    }
  }
  return out;
};

const cmd = command({
  name: "remerge-collision-slugs",
  description:
    "Fold shards whose slug encodes a GUID no longer in _slug_collisions.json back into the profile they belong to.",
  args: {
    apply: flag({
      type: boolean,
      long: "apply",
      description: "Write the moves (default: report only)",
    }),
  },
  handler: ({ apply }) => {
    const index = JSON.parse(
      fs.readFileSync(INDEX_FILE, "utf-8"),
    ) as OfficialIndexFile;
    const listed = listedGuids();
    const orphans = findOrphans(index, listed);

    if (orphans.length === 0) {
      console.log("→ no orphaned collision slugs — nothing to do");
      return;
    }

    console.log(
      `→ ${orphans.length} shard(s) slugged under a GUID that is no longer listed:`,
    );
    const bySlug = new Map(index.entries.map((e) => [e.slug, e]));
    const moves: Orphan[] = [];
    for (const o of orphans) {
      // The target is slugify(name, institution) over the SAME name and
      // institution, so an existing shard there is the same declarant by
      // construction. Verify anyway — a 24-bit slug suffix can in principle
      // collide, and merging two people would be the very defect being undone.
      const targetEntry = bySlug.get(o.target);
      if (
        targetEntry &&
        (targetEntry.name !== o.entry.name ||
          targetEntry.institution !== o.entry.institution)
      ) {
        console.warn(
          `  [skip] ${o.slug} → ${o.target}: target holds a different declarant (${targetEntry.name} / ${targetEntry.institution})`,
        );
        continue;
      }
      const targetDecls = readShard(o.target);
      console.log(
        `  ${o.slug} (${o.decls.length} filing(s), guid ${o.guid}) → ${o.target}${
          targetDecls.length
            ? ` (+${targetDecls.length} already there)`
            : " [new]"
        }  — ${o.entry.name} / ${o.entry.institution}`,
      );
      moves.push(o);
    }

    if (!apply) {
      console.log(
        `\n  --apply not set: nothing written. ${moves.length} shard(s) would move.`,
      );
      return;
    }

    const keptEntries = new Map(index.entries.map((e) => [e.slug, e]));
    for (const o of moves) {
      // A pure union: no folder is authoritative here, so every row on both
      // sides survives and mergeDeclarations only dedupes by sourceUrl and
      // re-sorts. The moved rows carry the target slug from now on.
      const merged = mergeDeclarations(
        readShard(o.target),
        o.decls.map((d) => ({ ...d, slug: o.target })),
        [],
      );
      writeJson(path.join(DECL_DIR, `${o.target}.json`), merged);
      fs.rmSync(path.join(DECL_DIR, `${o.slug}.json`));
      keptEntries.delete(o.slug);
      // The target may never have had an index row of its own — every filing on
      // that name and institution could have been diverted. Carry the orphan's
      // descriptors over rather than dropping the declarant from the roster,
      // which `useOfficial` and the sitemap both read.
      if (!keptEntries.has(o.target)) {
        keptEntries.set(o.target, { ...o.entry, slug: o.target });
      }
    }

    const entries = [...keptEntries.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "bg"),
    );
    writeJson(INDEX_FILE, {
      ...index,
      generatedAt: new Date().toISOString(),
      total: entries.length,
      entries,
    } satisfies OfficialIndexFile);

    console.log(
      `\n  moved ${moves.length} shard(s); index.json now holds ${entries.length} official(s)`,
    );

    // assets-rankings.json is the roster `useOfficial` resolves a profile from
    // and the sitemap enumerates, so leaving it naming the slugs just deleted
    // would turn every moved official into a soft-404. Rebuilt here rather than
    // deferred to the next ingest, and from the same builder the ingest uses.
    const rankingEntries = buildRankingEntries(entries);
    writeRankings(rankingEntries, index.years);
    console.log(
      `  rebuilt assets-rankings.json (${rankingEntries.length} official(s))`,
    );

    console.log(
      "  STILL STALE — these name the old slugs and must be regenerated:\n" +
        "    tsx scripts/run-officials-links-only.ts   # data/officials/derived/company_links.json\n" +
        "    tsx scripts/run-connections-rebuild.ts    # officials bridge + data/parliament/connections*.json",
    );
  },
});

run(cmd, process.argv.slice(2));
