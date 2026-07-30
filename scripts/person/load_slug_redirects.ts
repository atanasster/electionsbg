// Load an officials-slug rename map into person_slug_retired (migration 103), so a
// /person URL minted under an old officials slug 301s instead of 404ing.
//
// Plan: docs/plans/persons-pg-retirement-v1.md — the T1.4 blocker found in T1.4a's review.
//
// ---------------------------------------------------------------------------
// WHY THE RESOLVER CANNOT DO THIS ON ITS OWN.
//
// db:resolve:persons computes retirements by diffing the slug LOCK (099), keyed on
// mention_id. An officials mention id IS `official:<slug>` — so when the slug changes, the
// old lock row is not diffed, it is ORPHANED: a new row appears under the new mention id
// and the old one is never revisited. Measured on this corpus, 20,057 lock slugs had no
// live person and no redirect, essentially all of them from the 2026-07-24 canonical-slug
// migration. The resolver has no way to pair them up: at resolve time the old mention no
// longer exists, and nothing in `declaration`, `declaration_subject_alias` or
// `person_role` remembers the old ref (verified: 0 of 20,057 appear in any of them).
//
// The thing that DOES know both sides is whatever renamed the shards —
// scripts/officials/migrate_slug_normalisation.ts, whose `--redirects <file>` flag emits
// exactly this map. This loader is the other half of that flag: run the migration with
// --redirects, then load the map here. resolve_persons.ts reports any orphaned dead slug
// that is still unmapped, so the gap is loud instead of silent.
//
// ---------------------------------------------------------------------------
// WHAT IT WRITES. The input maps OLD officials slug -> NEW officials slug. What
// person_slug_retired needs is OLD /person slug -> LIVE /person slug, and the two are not
// the same mapping:
//
//   * The NEW officials slug is resolved through person_role -> person, so the target is
//     the person that ref belongs to TODAY, following any merge that happened since. That
//     person's slug may be an `mp-<id>` (616 rows here), because an officials mention only
//     wins the person slug when nothing higher-priority is in the cluster (mp id >
//     officials ref > name+hash). Writing those is deliberate and safe for the reason 103's
//     header gives at length: person_slug_redirect() only answers for a slug that resolves
//     to NOBODY, so a wider seed can never shadow a live page.
//   * The §6 privacy gate applies: a target person who is not active + public is not a
//     redirect destination — 301ing to a page we refuse to serve is a 404 with extra steps.
//
// Idempotent (ON CONFLICT DO UPDATE) and safe to re-run. A row whose old slug is currently
// LIVE is never written: person_slug_redirect() already refuses to answer for a live slug,
// but writing one would leave a landmine for the day that person is merged away.
//
// WIRED INTO db:refresh, unlike a true one-off backfill. The distinction that matters is
// not "does it run once" but "is it reproducible without an operator": the map is a
// committed artifact, the load is idempotent, and it takes ~1.3 s. Leaving it manual meant
// a from-scratch database (fresh clone, `docker compose down -v`, a rebuilt Cloud SQL) came
// up with 20,767 redirects missing and the only signal was a test failing at the very end
// of the pipeline. Deploys need it too — see the checklist in the plan.
//
//   npm run person:slug-redirects -- raw_data/person/officials_reslug_2026_07_24.json
//
// To rebuild the map itself (an operator step, after a future officials re-slug):
//
//   git archive <pre-rename-commit>^ data/officials | tar -x -C /tmp/prerename
//   OFFICIALS_MIGRATE_DIR=/tmp/prerename/data/officials \
//     tsx scripts/officials/migrate_slug_normalisation.ts --redirects map.json

import { readFileSync } from "node:fs";
import path from "node:path";
import { allRows, exec, withTx, end } from "../db/lib/pg";
import { collapseSlugRedirectChainsVerbose } from "./collapse_slug_chains";
// One JS definition of officialSlug()'s mint format, shared with the Cloud Function's
// /officials URL parser. (103 keeps its own copy for the SQL side — a different language,
// and its backfill runs with no JS in the picture.)
import { OFFICIALS_SLUG } from "../../functions/officials_redirect.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCHEMA = path.join(
  ROOT,
  "scripts/db/schema/pg/103_person_slug_retired.sql",
);

const run = async (): Promise<void> => {
  const file = process.argv[2];
  if (!file) {
    throw new Error(
      "usage: tsx scripts/person/load_slug_redirects.ts <old-to-new-slug-map.json>",
    );
  }
  const map = JSON.parse(readFileSync(path.resolve(file), "utf8")) as Record<
    string,
    unknown
  >;
  const pairs = Object.entries(map);
  if (!pairs.length) throw new Error(`${file}: empty rename map`);

  // Shape guard BEFORE anything is written, against the shared OFFICIALS_SLUG pattern.
  // `slug` is the primary key of person_slug_retired, and 103's header records what
  // happened the one time non-slug keys reached it: 3,113 Cyrillic declarant names
  // ("Мария Венциславова Милушева") became redirect keys. The surviving defence has been a
  // post-hoc test — the bad rows land, then get found. This loader is the sanctioned way to
  // write the table from outside the resolver, so it carries the guard the schema
  // documents rather than relying on that. Also the only thing standing between a map with
  // null/array values and a silent "0 redirects written" success.
  const malformed = pairs.filter(
    ([o, n]) =>
      typeof n !== "string" ||
      !OFFICIALS_SLUG.test(o) ||
      !OFFICIALS_SLUG.test(n),
  );
  if (malformed.length) {
    throw new Error(
      `${file}: ${malformed.length} entr(ies) are not officials slugs on both sides ` +
        `(e.g. ${malformed
          .slice(0, 3)
          .map(([o]) => o)
          .join(
            ", ",
          )}). Migration 103's header records what happens when non-slug keys ` +
        `reach person_slug_retired.`,
    );
  }
  const renames = pairs as [string, string][];

  // Apply 103 in full. It is idempotent, but it is NOT only DDL: alongside
  // CREATE TABLE IF NOT EXISTS it (re)defines the person_slug_redirect() SERVING function
  // and re-runs its own ~2,347-row merge backfill. Worth knowing before running this
  // against Cloud SQL mid-day. Needed because this script may be the first thing to touch
  // a database that has never done a resolve.
  await exec(readFileSync(SCHEMA, "utf8"));

  // One round trip for the whole resolution rather than 20k: hand the map to Postgres as
  // two parallel arrays and let it do the joins.
  const resolved = await allRows<{
    old_slug: string;
    target_slug: string | null;
    old_is_live: boolean;
  }>(
    `WITH m(old_slug, new_slug) AS (
       SELECT * FROM unnest($1::text[], $2::text[])
     )
     SELECT m.old_slug,
            -- The person that the NEW officials ref belongs to today. LIMIT 1 by
            -- person_id: two person rows carrying one ref would be a resolver defect, and
            -- picking the lowest is at least deterministic while it is investigated.
            (SELECT p.slug
               FROM person_role r
               JOIN person p ON p.person_id = r.person_id
                            -- §6 privacy gate: never redirect to a page we will not serve.
                            AND p.status = 'active' AND p.is_public_figure
              WHERE r.ref = m.new_slug
                -- One definition of "a person_role.ref that is an officials slug", shared
                -- with 103's own backfill (DUP: the list was written out twice, and a
                -- seventh officials source added later would have to be found in both).
                AND r.source = ANY(person_officials_sources())
              ORDER BY p.person_id
              LIMIT 1)                                     AS target_slug,
            EXISTS (SELECT 1 FROM person p WHERE p.slug = m.old_slug) AS old_is_live
       FROM m`,
    [renames.map(([o]) => o), renames.map(([, n]) => n)],
  );

  const live = resolved.filter((r) => r.old_is_live);
  const unresolved = resolved.filter((r) => !r.old_is_live && !r.target_slug);
  const writable = resolved.filter(
    (r) => !r.old_is_live && r.target_slug && r.target_slug !== r.old_slug,
  );

  await withTx(async (c) => {
    await c.query(
      `INSERT INTO person_slug_retired (slug, target_slug)
         SELECT * FROM unnest($1::text[], $2::text[])
       ON CONFLICT (slug) DO UPDATE SET target_slug = EXCLUDED.target_slug`,
      [writable.map((r) => r.old_slug), writable.map((r) => r.target_slug)],
    );
  });

  console.log(
    `slug-redirects: ${renames.length} renames -> ${writable.length} redirect(s) written`,
  );

  // Rows THIS map wrote resolve their target through person_role, so they are
  // correct by construction. Rows an EARLIER map wrote are not: if this map retired
  // a slug that was already somebody's target, that older row now points at a dead
  // slug. Collapse after every load — the dated maps only truly compose with this.
  // (After the header line above, since its output is indented under it.)
  await collapseSlugRedirectChainsVerbose();
  if (live.length) {
    // NAMED, not just counted — this is the branch that signals a real problem. It means
    // the map wants to retire a slug a live person is currently served under, which is
    // either a genuine identity collision or a map built against the wrong corpus. (The one
    // row on the 2026-07-24 map is the former: denis-hyuseinov-shengov-c67235 is served by
    // Денислав Йосков Шенгов, who inherited it through the 099 lock, while the map wanted
    // to send it to a different human of a near-identical name.)
    console.log(
      `  ${live.length} skipped: the old slug is still a LIVE person, so a redirect would ` +
        `shadow a real page — check whether the two are actually the same human ` +
        `(${live
          .slice(0, 5)
          .map((r) => r.old_slug)
          .join(", ")})`,
    );
  }
  if (unresolved.length) {
    // Expected and benign for officials whose person slug came from elsewhere (an MP id,
    // or a name-hash lock) — their old officials slug was never a /person URL. A large
    // number here instead means the map was built against a different corpus.
    console.log(
      `  ${unresolved.length} skipped: the new ref resolves to no public person ` +
        `(e.g. ${unresolved
          .slice(0, 3)
          .map((r) => r.old_slug)
          .join(", ")})`,
    );
  }

  const [{ n }] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM person_slug_retired",
  );
  console.log(`  person_slug_retired now holds ${n} redirect(s)`);
  await end();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
