// Repair: pull a newly-listed GUID's filings OUT of the shard they were merged
// into. The exact inverse of ./remerge_collision_slugs.ts, and the step that
// adding a GUID to ./_slug_collisions.json does not perform on its own.
//
// Adding a GUID changes only what the INGEST mints from that point on
// (index.ts: `officialSlug(name, listed ? `${institution}|${guid}` : institution)`).
// The shards already on disk keep whatever they were written with, and re-running
// the ingest does not move them, for a reason that is easy to miss: a run only
// rewrites the slugs IT produced. Иван Стоянов Стоянов is the worked example —
// A0555741… (окръжен прокурор, Хасково) filed in the 2019 and 2020 folders,
// D1245F3F… (командир на дивизион, ВФ 26720) in 2025 alone. Re-running `--year
// 2025` mints D1245F3F's new shard, but `ivan-stoyanov-stoyanov-5d97ce` has no
// 2025 filing of its own any more, never enters that run's `declsBySlug`, and so
// keeps the 2025 rows it was already holding. The filing would then publish on
// BOTH profiles — strictly worse than the collision it was meant to fix.
//
// So: this script moves them, from the corpus, with no fetch.
//
// A filing is MISPLACED when its shard's slug is not the slug its own person-GUID
// implies today:
//     officialSlug(<the shard's index name>, `${institution}|${GUID}`) !== <shard slug>
// for a GUID that IS listed. That is the same expression index.ts:287 mints with,
// evaluated against the index row's name — which is the register LISTING name the
// slug was hashed from, not the name inside the XML (they differ; see
// ./shared.ts). Using the shard's own index row is what keeps this honest: it is
// the only name provably in the hash.
//
// Deliberately NARROWER than "reconcile every filing onto the slug it should
// have". The reverse direction (a filing whose GUID is no longer listed) is
// ./remerge_collision_slugs.ts's job, and folding two shards together on the
// strength of an ALIAS needs the listing name of the OTHER shard, which this
// script cannot see. Splitting only ever separates, so it cannot merge two
// people by accident — the failure mode that put 67 bad entries in the
// collisions table.
//
// Manual by design, like every one-off repair here — not wired into `npm run
// data`. Dry by default:
//   tsx scripts/officials/split_collision_slugs.ts            # report only
//   tsx scripts/officials/split_collision_slugs.ts --apply    # move them
//
// index.json and assets-rankings*.json are rebuilt in place. The PG side is NOT:
// re-run the declarations loader and the person chain afterwards — the script
// prints the commands.

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
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
import { officialSlug, ROOT, writeJson } from "./shared";
import { personGuidFromSourceUrl } from "./slug_identity";

const INDEX_FILE = path.join(OUT_DIR, "index.json");

export const listedGuids = (
  file = path.join(ROOT, "scripts/officials/_slug_collisions.json"),
): Set<string> =>
  new Set(
    (JSON.parse(fs.readFileSync(file, "utf-8")) as { guids: string[] }).guids.map(
      (g) => g.toUpperCase(),
    ),
  );

export type Split = {
  /** The shard the filings are leaving. */
  from: string;
  /** The slug they belong on — officialSlug(name, `${institution}|${guid}`). */
  to: string;
  guid: string;
  entry: OfficialIndexEntry;
  moving: OfficialDeclaration[];
  staying: OfficialDeclaration[];
};

/** Every misplaced group in the corpus. Pure: the caller supplies the shards, so
 *  the test can drive it without a data tree. */
export const findSplits = (
  entries: readonly OfficialIndexEntry[],
  shardOf: (slug: string) => OfficialDeclaration[],
  listed: ReadonlySet<string>,
): Split[] => {
  const out: Split[] = [];
  for (const entry of entries) {
    const decls = shardOf(entry.slug);
    if (decls.length === 0) continue;
    // Group by person-GUID once. A filing whose name carries a per-DOCUMENT guid
    // yields null and is never moved: it proves no identity, so the name and
    // institution that put it here are the only evidence there is.
    const byGuid = new Map<string, OfficialDeclaration[]>();
    for (const d of decls) {
      const guid = personGuidFromSourceUrl(d.sourceUrl);
      if (!guid || !listed.has(guid)) continue;
      byGuid.set(guid, [...(byGuid.get(guid) ?? []), d]);
    }
    for (const [guid, moving] of byGuid) {
      const to = officialSlug(entry.name, `${entry.institution}|${guid}`);
      if (to === entry.slug) continue; // already on its own slug
      const movingUrls = new Set(moving.map((d) => d.sourceUrl));
      out.push({
        from: entry.slug,
        to,
        guid,
        entry,
        moving,
        staying: decls.filter((d) => !movingUrls.has(d.sourceUrl)),
      });
    }
  }
  return out.sort((a, b) => a.from.localeCompare(b.from) || a.guid.localeCompare(b.guid));
};

const latestYear = (decls: readonly OfficialDeclaration[]): number =>
  decls.reduce((mx, d) => Math.max(mx, d.declarationYear), 0);

const readShard = (slug: string): OfficialDeclaration[] => {
  const file = path.join(DECL_DIR, `${slug}.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf-8")) as OfficialDeclaration[];
};

const cmd = command({
  name: "split-collision-slugs",
  description:
    "Move a listed GUID's filings off the shard they were merged into, onto the slug the collisions table gives them.",
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
    const splits = findSplits(index.entries, readShard, listed);

    if (splits.length === 0) {
      console.log("→ every listed GUID is already on its own slug — nothing to do");
      return;
    }

    console.log(`→ ${splits.length} misplaced GUID group(s):`);
    const moves: Split[] = [];
    for (const s of splits) {
      // The target is a GUID-folded slug, so an existing shard there can only be
      // this same GUID's — unless the 24-bit suffix collided, which would merge
      // two people, the very defect being repaired. Refuse rather than warn:
      // there is no safe way to continue past it.
      const targetDecls = readShard(s.to);
      const foreign = targetDecls.filter(
        (d) => personGuidFromSourceUrl(d.sourceUrl) !== s.guid,
      );
      if (foreign.length > 0) {
        throw new Error(
          `${s.from} → ${s.to}: the target shard already holds ${foreign.length} filing(s) from a DIFFERENT person-GUID ` +
            `(${personGuidFromSourceUrl(foreign[0].sourceUrl)}). Moving into it would merge two people. Resolve by hand.`,
        );
      }
      // Emptying the source is legitimate on its own — every filing on it could
      // belong to the listed GUID — but then the split is a pure RENAME and the
      // GUID probably should not have been listed at all. Say so.
      if (s.staying.length === 0) {
        console.warn(
          `  [note] ${s.from} keeps NO filings — this renames the shard rather than splitting it. ` +
            `Check that ${s.guid} is really a second person and not the only one on that name.`,
        );
      }
      console.log(
        `  ${s.from} → ${s.to}  (${s.moving.length} filing(s) of ${s.guid}` +
          `, ${s.staying.length} staying)${targetDecls.length ? ` [+${targetDecls.length} already there]` : ""}` +
          `  — ${s.entry.name} / ${s.entry.institution}`,
      );
      moves.push(s);
    }

    if (!apply) {
      console.log(
        `\n  --apply not set: nothing written. ${moves.length} group(s) would move.`,
      );
      return;
    }

    const keptEntries = new Map(index.entries.map((e) => [e.slug, e]));
    for (const s of moves) {
      // A pure union on the target: no folder is authoritative in a repair, so
      // every row on both sides survives and mergeDeclarations only dedupes by
      // sourceUrl and re-sorts. The moved rows carry the target slug from now on.
      const merged = mergeDeclarations(
        readShard(s.to),
        s.moving.map((d) => ({ ...d, slug: s.to })),
        [],
      );
      writeJson(path.join(DECL_DIR, `${s.to}.json`), merged);

      if (s.staying.length > 0) {
        writeJson(path.join(DECL_DIR, `${s.from}.json`), s.staying);
      } else {
        fs.rmSync(path.join(DECL_DIR, `${s.from}.json`));
        keptEntries.delete(s.from);
      }

      // The index row for the new slug: the same declarant descriptors, because
      // by construction the two shards share a name and an institution. Only the
      // year has to be recomputed — it describes the shard, and both shards just
      // changed shape. Leaving the source's stale would let a profile advertise a
      // filing year it no longer holds.
      const prior = keptEntries.get(s.from);
      if (prior && s.staying.length > 0) {
        keptEntries.set(s.from, {
          ...prior,
          latestDeclarationYear: latestYear(s.staying),
        });
      }
      keptEntries.set(s.to, {
        ...s.entry,
        slug: s.to,
        latestDeclarationYear: latestYear(merged),
      });
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
      `\n  split ${moves.length} group(s); index.json now holds ${entries.length} official(s)`,
    );

    // assets-rankings.json is the roster `useOfficial` resolves a profile from
    // and the sitemap enumerates, so a new slug missing from it is a soft-404 and
    // a stale net worth on the source slug is the merged figure this repair
    // exists to undo. Rebuilt from the shards, no fetch.
    const rankingEntries = buildRankingEntries(entries);
    writeRankings(rankingEntries, index.years);
    console.log(`  rebuilt assets-rankings.json (${rankingEntries.length} row(s))`);

    console.log(
      [
        "",
        "  Postgres and the person layer still carry the merged profile. Re-run, in order:",
        "    npm run db:load:declarations:pg -- --resolve",
        "    npm run db:resolve:persons",
        "    npm run db:load:persons-browse:pg",
        "  and the :cloud equivalents to publish.",
      ].join("\n"),
    );
  },
});

// Same entry guard as ./migrate_slug_normalisation.ts: run() only when invoked
// as a CLI, so `findSplits` can be imported and tested.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run(cmd, process.argv.slice(2));
}
