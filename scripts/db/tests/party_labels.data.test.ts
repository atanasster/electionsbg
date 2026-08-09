// Gate 5.8 (mp-party-affiliation-v1 §0g) — every value the ПАРТИЯ column can
// hold must have a Bulgarian label.
//
// WHY. `/persons` renders the column as
// `displayNameForId(p.partyPrimary) || p.partyPrimary`
// (PersonsBrowserScreen.tsx), and `displayNameForId` is a plain `byId` lookup
// over canonical_parties.json (useCanonicalParties.tsx). An id that is not in
// that file therefore does not fail — it falls through and prints ITSELF. The
// facet dropdown does the same: `partyOptions` is built from the live
// `party_primary` facet with `label: displayNameForId(o.value) || o.value`.
//
// So the failure mode is a latin token sitting in a Bulgarian UI, with no
// colour dot (colorFor misses the same way), offered as a filter option — at a
// 200, with every row count reconciling. Measured before this gate existed:
// `independent` on 484 people and `vmro` on 395.
//
// This is a DATA test rather than a unit test because neither half is a
// constant: `party_primary` is whatever the resolver last wrote, and the
// canonical table is generated. Only comparing the two as they actually stand
// can catch a new id arriving from a source that has never been in this file —
// which is precisely what mp-party-affiliation-v1 does when it starts writing
// parliamentary-group ids onto MP roles (§1b will route НЕЗ / НЕЧЛ В ПГ /
// НЕЧЛ ПГ to `independent`, at role_prominence 100, where it outranks
// everything — not implemented yet, T1/T2 of that plan).
//
// Auto-skips when Postgres is down or the browse matview is absent.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { allRows, dbReachable, end } from "../lib/pg";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const haveDb = await dbReachable();

const tableExists = async (name: string) =>
  haveDb &&
  Number(
    (
      await allRows<{ n: string }>(
        `SELECT count(*) n FROM pg_class WHERE relname = $1`,
        [name],
      )
    )[0]?.n,
  ) > 0;

const browseReady = await tableExists("person_browse_table");

afterAll(async () => {
  await end();
});

const canonicalIds = (): Set<string> => {
  const file = path.join(REPO_ROOT, "data/canonical_parties.json");
  const j = JSON.parse(fs.readFileSync(file, "utf-8")) as {
    parties: { id: string }[];
  };
  return new Set(j.parties.map((p) => p.id));
};

test("every party_primary on /persons resolves to a canonical label", async (t) => {
  if (!haveDb || !browseReady) return t.skip();

  const ids = canonicalIds();
  // Floor first: an empty canonical set would make the assertion below fail for
  // the wrong reason, and an empty matview would make it pass vacuously.
  assert.ok(ids.size > 100, `only ${ids.size} canonical parties loaded`);

  const rows = await allRows<{ party_primary: string; n: string }>(
    `SELECT party_primary, count(*)::text AS n
       FROM person_browse_table
      WHERE party_primary IS NOT NULL
      GROUP BY 1 ORDER BY count(*) DESC`,
  );
  assert.ok(rows.length > 0, "no party_primary values — matview not populated");

  const unlabelled = rows.filter((r) => !ids.has(r.party_primary));
  assert.deepEqual(
    unlabelled.map((r) => `${r.party_primary} (${r.n} people)`),
    [],
    "party ids with no entry in canonical_parties.json — these render as a raw " +
      "latin token with no colour dot in the ПАРТИЯ column AND in the facet dropdown",
  );
});

test("party_codes carries no id the canonical table cannot label", async (t) => {
  if (!haveDb || !browseReady) return t.skip();

  const ids = canonicalIds();
  // party_codes is the FILTER target (`?party=` matches it), so an id that only
  // ever appears here is still user-visible: it is selectable in the dropdown
  // even when it is nobody's representative party. Checking party_primary alone
  // would miss it.
  const rows = await allRows<{ code: string; n: string }>(
    `SELECT code, count(*)::text AS n
       FROM person_browse_table b,
            LATERAL unnest(string_to_array(btrim(b.party_codes), ' ')) AS code
      WHERE b.party_codes IS NOT NULL AND code <> ''
      GROUP BY 1`,
  );
  assert.ok(rows.length > 0, "no party_codes values — matview not populated");

  const unlabelled = rows.filter((r) => !ids.has(r.code));
  assert.deepEqual(
    unlabelled.map((r) => `${r.code} (${r.n} people)`),
    [],
    "party ids in party_codes with no canonical entry",
  );
});

// The sentinel's own shape (label + empty history) is asserted in
// scripts/parsers/manualCanonicals.test.ts — deliberately NOT here. It reads
// two files and no database, so behind this file's Postgres skip it would never
// run in CI, which provisions none.

test("official_candidate_link names no party the canonical table cannot label", async (t) => {
  if (!haveDb || !(await tableExists("official_candidate_link")))
    return t.skip();

  // The surface that was actually broken. `person_browse_table` is rebuilt from
  // `person_role` by a resolve, so fixing the ingest rule cleans it on the next
  // pass — but `official_candidate_link` is loaded independently
  // (db:load:official-candidate-links:pg) and keeps whatever id it was given
  // until THAT loader re-runs. Measured before this gate: 27 rows still carried
  // the invented "vmro" while person_browse_table was already clean, so a gate
  // on the browse matview alone was guarding a door that had already shut.
  //
  // It feeds the party colour and councillor avatars on the governance and
  // My-Area tiles, so a dangling id there is a colourless chip, not an error.
  const ids = canonicalIds();
  assert.ok(ids.size > 100, `only ${ids.size} canonical parties loaded`);

  const rows = await allRows<{ party_canonical_id: string; n: string }>(
    `SELECT party_canonical_id, count(*)::text AS n
       FROM official_candidate_link
      WHERE party_canonical_id IS NOT NULL
      GROUP BY 1`,
  );
  if (rows.length === 0) return t.skip(); // table present but not loaded

  const unlabelled = rows.filter((r) => !ids.has(r.party_canonical_id));
  assert.deepEqual(
    unlabelled.map((r) => `${r.party_canonical_id} (${r.n} rows)`),
    [],
    "party ids in official_candidate_link with no canonical entry — re-run db:load:official-candidate-links:pg after an override fix",
  );
});
