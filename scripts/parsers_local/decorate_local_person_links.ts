// Stamp `personSlug` onto every elected local office holder in
// data/<cycle>/municipalities/<obshtinaCode>.json, so the SPA links mayors / councillors /
// village mayors / район mayors straight to their unified /person/<slug> profile with NO runtime
// lookup (docs/plans/local-person-links-v1.md, Phase 2a).
//
// SOURCE OF TRUTH is Postgres: db:resolve:persons materializes each elected local candidacy as a
// `person_role` (source='local') and assigns the person a stable slug. This step reads that
// mapping back — `person_role.ref` → `person.slug`, §6-gated to active + public — and stamps it
// onto the JSON record the same walk minted the ref from. The ref keys + the winner resolution
// come from the SHARED ./localPersonRefs module that resolve_persons also uses, so the two walks
// cannot address different rows.
//
// Runs AFTER db:resolve:persons (it reads the persons it wrote). Re-runnable and idempotent: it
// updates a changed slug and removes a personSlug whose person no longer resolves (retired /
// merged away / went private). Only ELECTED winners are stamped — losing candidates get no page.
//
//   npx tsx scripts/parsers_local/decorate_local_person_links.ts [--dry-run]
//   DATABASE_URL=… npx tsx scripts/parsers_local/decorate_local_person_links.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";
import { command, run, flag, boolean } from "cmd-ts";
import { allRows, end } from "../db/lib/pg";
import type { LocalMunicipalityBundle } from "./types";
import {
  type LocalMayorMention,
  pickLocalWinner,
  mayorRef,
  councillorRef,
  kmetstvoRef,
  districtRef,
  districtsAreShardedElsewhere,
  councilShardReplicatesSofia,
} from "./localPersonRefs";

/** Any candidate row that can carry a stamped slug (LocalMayorResult / LocalCouncilCandidate). */
type Stampable = { personSlug?: string };

/** Two mayor-contest rows are the same contestant when BOTH name and party match. Matching on
 *  name alone would give a losing candidate who happens to share the winner's exact name the
 *  winner's /person link; the winner keeps its party across rounds, a same-named loser does not. */
const sameContestant = (
  row: LocalMayorMention,
  winner: LocalMayorMention,
): boolean =>
  row.candidateName === winner.candidateName &&
  row.localPartyNum === winner.localPartyNum;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const DATA_ROOT = path.join(ROOT, "data");

/** `person_role.ref` (source='local') → the winner's current, servable person slug. */
const loadSlugByRef = async (): Promise<Map<string, string>> => {
  const rows = await allRows<{ ref: string; slug: string }>(
    `SELECT r.ref, p.slug
       FROM person_role r
       JOIN person p ON p.person_id = r.person_id
      WHERE r.source = 'local'
        AND p.status = 'active' AND p.is_public_figure AND p.slug IS NOT NULL`,
  );
  // Each local ref resolves to exactly one person (local_person_roles.data.test.ts pins this),
  // so a plain last-wins map is faithful.
  const m = new Map<string, string>();
  for (const { ref, slug } of rows) m.set(ref, slug);
  return m;
};

type Stats = { stamped: number; cleared: number; considered: number };

/** Set/refresh/remove `personSlug` on one candidate row; report whether it changed. */
export const applySlug = (
  row: Stampable,
  slug: string | undefined,
  stats: Stats,
): boolean => {
  stats.considered++;
  if (slug) {
    if (row.personSlug === slug) return false;
    row.personSlug = slug;
    stats.stamped++;
    return true;
  }
  if (row.personSlug != null) {
    delete row.personSlug;
    stats.cleared++;
    return true;
  }
  return false;
};

export const stampBundle = (
  b: LocalMunicipalityBundle,
  slugByRef: Map<string, string>,
  stats: Stats,
): boolean => {
  let changed = false;
  const stamp = (row: Stampable, slug: string | undefined): void => {
    if (applySlug(row, slug, stats)) changed = true;
  };

  // Mayor: the `:mayor` ref resolves to the elected mayor. Stamp `elected` and every round-1/2
  // row that IS the winner (the /mayor table + runoff bar render those rows), matched on
  // name+party so a same-named loser never inherits the link.
  const mSlug = slugByRef.get(mayorRef(b.cycle, b.obshtinaCode));
  const mayorWinner = b.mayor?.elected;
  if (mayorWinner) stamp(mayorWinner, mSlug);
  if (mayorWinner)
    for (const row of [...(b.mayor?.round1 ?? []), ...(b.mayor?.round2 ?? [])])
      if (sameContestant(row, mayorWinner)) stamp(row, mSlug);

  // Elected councillors — one ref per (party, listPos). Skip Sofia район council replicas, which
  // the resolver never keys (so their refs are never minted) — mirror that here.
  if (!councilShardReplicatesSofia(b.obshtinaCode))
    for (const party of b.council ?? [])
      for (const c of party.candidates ?? [])
        if (c.isElected)
          stamp(
            c,
            slugByRef.get(
              councillorRef(
                b.cycle,
                b.obshtinaCode,
                party.localPartyNum,
                c.listPos,
              ),
            ),
          );

  // Village mayors — the winner of each kmetstvo contest, keyed by array index (see
  // localPersonRefs). Stamp the winning row(s) in both the round-1 and round-2 tables.
  (b.kmetstva ?? []).forEach((k, i) => {
    const w = pickLocalWinner(k.candidates, k.round2);
    if (!w?.candidateName) return;
    const slug = slugByRef.get(
      kmetstvoRef(b.cycle, b.obshtinaCode, k.ekatte, i),
    );
    for (const row of [...(k.candidates ?? []), ...(k.round2 ?? [])])
      if (sameContestant(row, w)) stamp(row, slug);
  });

  // Район mayors — skip the Sofia parent (its районни are stamped via the S2*** shards' mayor).
  if (!districtsAreShardedElsewhere(b.obshtinaCode))
    (b.districts ?? []).forEach((dist, i) => {
      const w = pickLocalWinner(dist.candidates, dist.round2);
      if (!w?.candidateName) return;
      const slug = slugByRef.get(
        districtRef(b.cycle, b.obshtinaCode, dist.districtCode, i),
      );
      for (const row of [...(dist.candidates ?? []), ...(dist.round2 ?? [])])
        if (sameContestant(row, w)) stamp(row, slug);
    });

  return changed;
};

const localCycleDirs = (): string[] =>
  fs
    .readdirSync(DATA_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /_(mi|chmi|chmi_nov)$/.test(e.name))
    .map((e) => e.name)
    .sort();

const main = async (dryRun: boolean): Promise<void> => {
  const slugByRef = await loadSlugByRef();
  console.log(
    `[decorate-local-person] loaded ${slugByRef.size} local ref→slug mapping(s) from Postgres`,
  );
  if (slugByRef.size === 0)
    console.warn(
      "[decorate-local-person] NO local person roles — has db:resolve:persons run with the Phase 1 walk?",
    );

  const totals: Stats = { stamped: 0, cleared: 0, considered: 0 };
  let bundles = 0;
  let written = 0;
  for (const cycle of localCycleDirs()) {
    const dir = path.join(DATA_ROOT, cycle, "municipalities");
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".json"))) {
      const file = path.join(dir, f);
      const bundle = JSON.parse(
        fs.readFileSync(file, "utf8"),
      ) as LocalMunicipalityBundle;
      bundles++;
      const changed = stampBundle(bundle, slugByRef, totals);
      if (changed && !dryRun) {
        fs.writeFileSync(file, JSON.stringify(bundle, null, 2) + "\n", "utf8");
        written++;
      } else if (changed) {
        written++;
      }
    }
  }
  console.log(
    `[decorate-local-person] ${dryRun ? "dry-run " : ""}done — ${bundles} bundle(s), ` +
      `${totals.stamped} stamped, ${totals.cleared} cleared of ${totals.considered} elected row(s); ` +
      `${written} bundle(s) ${dryRun ? "would change" : "rewritten"}`,
  );
  await end();
};

const cli = command({
  name: "decorate-local-person-links",
  description:
    "Stamp personSlug on every elected local office holder across data/<cycle>/municipalities/*.json from person_role (source='local'). Drives the /person/:slug links on the local dashboards. Run after db:resolve:persons.",
  args: {
    dryRun: flag({
      type: boolean,
      long: "dry-run",
      description: "Report would-stamp changes without rewriting the bundles.",
    }),
  },
  handler: ({ dryRun }) => main(dryRun),
});

// Direct-run only — importing this module (e.g. from the unit test) must NOT open a DB
// connection or walk the data tree.
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  run(cli, process.argv.slice(2));
}
