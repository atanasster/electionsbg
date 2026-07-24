// Corpus gate on the officials slug rule, over the real data/officials trees.
//
// ./official_slug.test.ts pins the rule on hand-picked pairs. This file pins the
// two properties that only the whole corpus can show:
//
//   1. NO DESTRUCTIVE MERGE — the direction that cannot be undone. Two register
//      person-GUIDs landing on one slug publish one official's property under
//      another's name, and nothing downstream can tell the rows apart again.
//   2. THE FORK ONLY SHRINKS — canonicalisation is supposed to heal splits, so
//      the count of person-GUIDs spread over several slugs must not grow. The
//      step-1 residual is pinned so the alias table can only improve on it.
//
// Reads data/ rather than fixtures, like the other *.data.test.ts gates, and
// skips cleanly when the corpus is absent (fresh clone, CI without data).

import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { officialSlug, ROOT, slugify } from "./shared";
import { aliasedDeclarantName } from "./declarant_aliases";
import { personGuidFromSourceUrl } from "./slug_identity";

type Tree = {
  label: string;
  indexFile: string;
  declDir: string;
  /** The slug's second ingredient, per that tree's ingest. */
  disambiguator: (row: Row) => string;
};
type Row = {
  slug: string;
  name: string;
  institution?: string;
  municipality?: string;
  role?: string;
};

const COLLISIONS_FILE = path.join(
  ROOT,
  "scripts/officials/_slug_collisions.json",
);

const TREES: Tree[] = [
  {
    label: "executive",
    indexFile: path.join(ROOT, "data/officials/index.json"),
    declDir: path.join(ROOT, "data/officials/declarations"),
    disambiguator: (r) => r.institution ?? "",
  },
  {
    label: "municipal",
    indexFile: path.join(ROOT, "data/officials/municipal/index.json"),
    declDir: path.join(ROOT, "data/officials/municipal/declarations"),
    disambiguator: (r) => `${r.municipality}|${r.role}`,
  },
];

const collisionGuids = (): Set<string> =>
  new Set(
    (
      JSON.parse(fs.readFileSync(COLLISIONS_FILE, "utf-8")) as {
        guids: string[];
      }
    ).guids.map((g) => g.toUpperCase()),
  );

/** The disambiguator a row's CURRENT slug was minted with — which is the plain
 *  one unless the executive ingest folded a listed GUID into it. Recovered by
 *  reproducing the slug, because the index row does not record which branch ran. */
const mintedWith = (
  row: Row,
  tree: Tree,
  listed: Set<string>,
  mint: (name: string, dis: string) => string,
): string | null => {
  const plain = tree.disambiguator(row);
  if (mint(row.name, plain) === row.slug) return plain;
  for (const guid of listed) {
    const folded = `${row.institution}|${guid}`;
    if (mint(row.name, folded) === row.slug) return folded;
  }
  return null;
};

const guidsOfShard = (declDir: string, slug: string): Set<string> => {
  const file = path.join(declDir, `${slug}.json`);
  const out = new Set<string>();
  if (!fs.existsSync(file)) return out;
  for (const decl of JSON.parse(fs.readFileSync(file, "utf-8")) as {
    sourceUrl: string;
  }[]) {
    const guid = personGuidFromSourceUrl(decl.sourceUrl);
    if (guid) out.add(guid);
  }
  return out;
};

/** person-GUIDs that a slugging scheme spreads over more than one slug. */
const forkedGuids = (
  rows: Row[],
  guidsOf: (slug: string) => Set<string>,
  slugOf: (row: Row) => string,
): Set<string> => {
  const slugsPerGuid = new Map<string, Set<string>>();
  for (const row of rows) {
    const target = slugOf(row);
    for (const guid of guidsOf(row.slug)) {
      const set = slugsPerGuid.get(guid) ?? new Set<string>();
      set.add(target);
      slugsPerGuid.set(guid, set);
    }
  }
  return new Set(
    [...slugsPerGuid].filter(([, s]) => s.size > 1).map(([g]) => g),
  );
};

for (const tree of TREES) {
  const present = fs.existsSync(tree.indexFile) && fs.existsSync(tree.declDir);

  describe.skipIf(!present)(
    `officialSlug over data/officials — ${tree.label}`,
    () => {
      const rows = present
        ? (
            JSON.parse(fs.readFileSync(tree.indexFile, "utf-8")) as {
              entries: Row[];
            }
          ).entries
        : [];
      const listed = present ? collisionGuids() : new Set<string>();
      const guidCache = new Map<string, Set<string>>();
      const guidsOf = (slug: string): Set<string> => {
        let hit = guidCache.get(slug);
        if (!hit) guidCache.set(slug, (hit = guidsOfShard(tree.declDir, slug)));
        return hit;
      };

      // The name the ingest would slug today: the register's listing name unless
      // a person-GUID on this shard is aliased. A shard can carry two GUIDs (the
      // known _slug_collisions pairs), so prefer whichever one the table names.
      const nameOf = (row: Row): string => {
        for (const guid of guidsOf(row.slug)) {
          const aliased = aliasedDeclarantName(guid, row.name);
          if (aliased !== row.name) return aliased;
        }
        return row.name;
      };

      // The disambiguator is recovered against the RAW slugify, which is what the
      // on-disk slugs were minted with. After the step-3 rename migration they are
      // minted with officialSlug, so fall back to that rather than going blind.
      const disCache = new Map<string, string>();
      const disOf = (row: Row): string => {
        let hit = disCache.get(row.slug);
        if (hit === undefined) {
          hit =
            mintedWith(row, tree, listed, slugify) ??
            mintedWith(row, tree, listed, officialSlug) ??
            tree.disambiguator(row);
          disCache.set(row.slug, hit);
        }
        return hit;
      };

      it("reproduces every on-disk slug, so the comparison below is honest", () => {
        // Guards the gate itself: if the disambiguator could not be recovered we
        // would be comparing the new scheme against a guess.
        const unreproducible = rows.filter(
          (r) =>
            mintedWith(r, tree, listed, slugify) === null &&
            mintedWith(r, tree, listed, officialSlug) === null,
        );
        expect(unreproducible.map((r) => r.slug)).toEqual([]);
      });

      it("never merges two register person-GUIDs onto one slug", () => {
        // Grouped under the NEW scheme; a group whose shards' GUID sets are
        // disjoint is two different people sharing a profile.
        const byNewSlug = new Map<string, Row[]>();
        for (const row of rows) {
          const slug = officialSlug(nameOf(row), disOf(row));
          byNewSlug.set(slug, [...(byNewSlug.get(slug) ?? []), row]);
        }

        const wrongMerges: string[] = [];
        for (const [slug, group] of byNewSlug) {
          if (group.length < 2) continue;
          const guidSets = group
            .map((r) => guidsOf(r.slug))
            .filter((s) => s.size);
          if (guidSets.length < 2) continue;
          // Every member must share at least one person-GUID with the first —
          // i.e. the group is one person, not several.
          const [head, ...rest] = guidSets;
          if (rest.some((s) => ![...s].some((g) => head.has(g)))) {
            wrongMerges.push(
              `${slug}: ${group.map((r) => r.slug).join(" + ")}`,
            );
          }
        }
        expect(wrongMerges).toEqual([]);
      });

      it("only ever reduces the fork", () => {
        const before = forkedGuids(rows, guidsOf, (r) => r.slug);
        const after = forkedGuids(rows, guidsOf, (r) =>
          officialSlug(nameOf(r), disOf(r)),
        );
        expect(after.size).toBeLessThanOrEqual(before.size);
        for (const guid of after) expect(before.has(guid)).toBe(true);
      });

      it("pins the residual the alias table still has to close", () => {
        // A GUID forked ACROSS institutions is the by-design split — one profile
        // per office. The defect is a GUID forked WITHIN one disambiguator, and
        // that is what this counts.
        //
        // Everything left here differs by more than case, whitespace, hyphen or
        // title: a register typo (Руфат→Руфад, Кирашки→Кичашки) or a real name
        // change (Димитрова→Младенова). No textual rule reaches those, which is
        // why ./_declarant_guid_aliases.json exists. Pinned so that step 2 can
        // only drive it down, and so a future edit to the rule cannot raise it
        // unnoticed.
        const stillForked = new Set<string>();
        const guidsSeen = new Set<string>();
        for (const row of rows)
          for (const g of guidsOf(row.slug)) guidsSeen.add(g);

        for (const guid of guidsSeen) {
          const owners = rows.filter((r) => guidsOf(r.slug).has(guid));
          const perDis = new Map<string, Set<string>>();
          for (const row of owners) {
            const dis = disOf(row);
            const set = perDis.get(dis) ?? new Set<string>();
            set.add(officialSlug(nameOf(row), dis));
            perDis.set(dis, set);
          }
          if ([...perDis.values()].some((slugs) => slugs.size > 1))
            stillForked.add(guid);
        }

        const BASELINE: Record<string, number> = {
          // 270 before the rule. Canonicalisation closes 233; the alias table
          // closes 36 of the remaining 37. The one left is EDDF7B29… — folding
          // it would deepen a pre-existing two-people-on-one-slug collision
          // rather than heal a fork, so it is documented under `_notListed` in
          // ./_declarant_guid_aliases.json instead of aliased.
          executive: 1,
          municipal: 0,
        };
        expect(stillForked.size).toBeLessThanOrEqual(BASELINE[tree.label]);
      });
    },
  );
}
