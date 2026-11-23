// Dry run for the national ↔ local merge tier (cluster.ts `unionNationalLocal`,
// docs/plans/person-national-local-merge-v1.md §5 step 3). READ-ONLY.
//
// Builds the resolver's mentions through the SAME code path it uses
// (`buildMentionBlocks`), clusters every block twice — with and without the tier — and
// reports each join the tier adds: the two sides, the key it joined on, and the guards'
// inputs. Nothing is written to the database; the report goes to a TSV.
//
//   pnpm exec tsx scripts/person/measure_national_local.ts [--out <file.tsv>]
//
// Today's person slugs come from `person_role` on the target database, so the report names
// the two /person pages each join would collapse. Human overrides are NOT applied (they
// run after clustering in the resolver); a fold with an override row is flagged instead,
// because an override can veto the join.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { allRows, end } from "../db/lib/pg";
import { clusterBlock } from "./cluster";
import { buildMentionBlocks, type M } from "./resolve_persons";

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const NATIONAL = new Set(["mp", "candidate"]);

const componentsOf = (
  block: M[],
  groups: { memberIds: string[] }[],
): Map<string, number> => {
  const at = new Map<string, number>();
  groups.forEach((g, i) => g.memberIds.forEach((id) => at.set(id, i)));
  let next = groups.length;
  for (const m of block) if (!at.has(m.id)) at.set(m.id, next++);
  return at;
};

async function main(): Promise<void> {
  // Default OUTSIDE the repo: the report names real people beside a proposed merge, and
  // no tree it could land in is gitignored.
  const out =
    arg("--out") ?? path.join(os.tmpdir(), "national_local_dry_run.tsv");
  const { blocks } = await buildMentionBlocks();

  const slugRows = await allRows<{ source: string; ref: string; slug: string }>(
    `SELECT pr.source, pr.ref, p.slug
       FROM person_role pr JOIN person p USING (person_id)
      WHERE pr.source IN ('mp','candidate','local')`,
  );
  const slugOf = new Map(
    slugRows.map((r) => [`${r.source}\t${r.ref}`, r.slug]),
  );
  const overrideFolds = new Set(
    (
      await allRows<{ f: string | null }>(
        `SELECT fold_a AS f FROM person_link_override
          UNION SELECT fold_b FROM person_link_override`,
      )
    ).flatMap((r) => (r.f ? [r.f] : [])),
  );

  const rows: string[][] = [];
  let mpJoins = 0;
  for (const block of blocks.values()) {
    if (!block.some((m) => NATIONAL.has(m.source))) continue;
    if (!block.some((m) => m.source === "local")) continue;
    const before = clusterBlock(block, { nationalLocal: false });
    const after = clusterBlock(block);
    const cb = componentsOf(block, before.merges);
    const byId = new Map(block.map((m) => [m.id, m]));
    for (const g of after.merges) {
      const comps = new Set(g.memberIds.map((id) => cb.get(id)!));
      if (comps.size < 2) continue;
      const members = g.memberIds.map((id) => byId.get(id)!);
      const nat = members.filter((m) => NATIONAL.has(m.source));
      const loc = members.filter((m) => m.source === "local");
      const keys = (ms: M[]) =>
        [
          ...new Set(
            ms.map(
              (m) => `${m.corroborants.party}/${m.corroborants.oblastKey}`,
            ),
          ),
        ].join(" ");
      const slugs = (ms: M[]) =>
        [
          ...new Set(
            ms.flatMap((m) => {
              const s = slugOf.get(`${m.source}\t${m.raw.ref}`);
              return s ? [s] : [];
            }),
          ),
        ].join(" ");
      const isMp = members.some((m) => m.source === "mp");
      if (isMp) mpJoins++;
      const m0 = members[0];
      rows.push([
        m0.raw.display,
        isMp ? "mp" : "candidate",
        slugs(nat),
        slugs(loc),
        keys(nat),
        keys(loc),
        loc.map((m) => `${m.raw.role}:${m.raw.ref}`).join(" "),
        String(m0.namesakeRisk),
        String(m0.registerPeople ?? 0),
        overrideFolds.has(m0.nameFold) ? "override" : "",
      ]);
    }
  }

  rows.sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  const header = [
    "name",
    "kind",
    "national_slugs",
    "local_slugs",
    "national_keys",
    "local_keys",
    "local_terms",
    "namesake_risk",
    "register_people",
    "override",
  ];
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    [header, ...rows].map((r) => r.join("\t")).join("\n") + "\n",
  );
  console.log(
    `national↔local tier: ${rows.length} new join(s), ${mpJoins} involving an MP, ` +
      `${rows.filter((r) => r[9]).length} on a fold with an override → ${out}`,
  );
  await end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
