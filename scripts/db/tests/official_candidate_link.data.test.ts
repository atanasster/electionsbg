// The candidateLink decoration (108_official_candidate_link.sql + load_official_candidate_
// links_pg.ts) that municipal_officials_table LEFT JOINs so the PG municipal roster carries
// the party / ballot / MP-photo enrichment the by_obshtina JSON shards used to.
// Plan: docs/plans/persons-pg-retirement-v1.md (Tier 1.5).
//
// These pin the invariants the loader's synthetic MP-only fallback and the matview join rely
// on — a regression in either would quietly strip party colours / avatars off the My-Area
// council tiles, the exact symptom the JSON path already suffered once.
//
// Auto-skips when Postgres is down or unloaded — like the other *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

// Gated on the table EXISTING, not on rows (a silently-empty load must FAIL, not skip green).
const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.official_candidate_link') IS NOT NULL AS ok",
    );
    return Boolean(t?.ok);
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / table absent";

afterAll(async () => {
  await end();
});

// An empty link table means the loader silently produced nothing — assert, never skip.
test.skipIf(skip)("the link table is populated", async () => {
  const [c] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM official_candidate_link",
  );
  assert.ok(
    Number(c.n) > 5_000,
    `official_candidate_link has ${c.n} rows — the loader produced (almost) nothing`,
  );
});

// The synthetic MP-only fallback: a row with no slate party carries no ballot data (listPos
// 0) but MUST carry an mp_id — that is the only reason it exists. A party-less, mp-less row
// would be a link that decorates nothing.
test.skipIf(skip)(
  "party-less links are MP-only: empty party ⇒ list_pos 0 AND an mp_id",
  async () => {
    const [bad] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM official_candidate_link
        WHERE party_name = ''
          AND (list_pos <> 0 OR party_canonical_id IS NOT NULL OR mp_id IS NULL)`,
    );
    assert.equal(
      Number(bad.n),
      0,
      `${bad.n} party-less link(s) are not clean MP-only fallbacks`,
    );
  },
);

// Every photo comes from the parliament join, which also sets the id — a photo without an
// mp_id is impossible in resolveCandidateLink and would break the avatar's link target.
test.skipIf(skip)("every photo_url has an mp_id", async () => {
  const [bad] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM official_candidate_link WHERE photo_url IS NOT NULL AND mp_id IS NULL",
  );
  assert.equal(Number(bad.n), 0, `${bad.n} photo(s) lack an mp_id`);
});

// The matview must surface the decoration: every link whose listing survives the roster's
// §6 gate shows a non-NULL candidate_cycle, and the decorated count is substantial. A join
// that silently dropped the columns is the failure this guards.
test.skipIf(skip)("the matview surfaces the links it joins", async () => {
  const [c] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM municipal_officials_table WHERE candidate_cycle IS NOT NULL",
  );
  assert.ok(
    Number(c.n) > 5_000,
    `only ${c.n} roster listings carry a candidateLink — the LEFT JOIN may be broken`,
  );
  // No link ever attaches to a role the loader does not decorate (chief_architect / other).
  const [leak] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM municipal_officials_table
        WHERE candidate_cycle IS NOT NULL
          AND role NOT IN ('mayor','deputy_mayor','council_chair','councillor')`,
  );
  assert.equal(
    Number(leak.n),
    0,
    `${leak.n} candidateLink(s) attached to a non-decorated role`,
  );
});

// official_slug is the PK, so it is unique by construction — assert it survives a reload
// (a duplicate would mean the LEFT JOIN fans out the roster and double-counts councillors).
test.skipIf(skip)("official_slug is unique (no roster fan-out)", async () => {
  const [dupe] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM (
       SELECT official_slug FROM official_candidate_link
        GROUP BY official_slug HAVING count(*) > 1) x`,
  );
  assert.equal(Number(dupe.n), 0, `${dupe.n} duplicate official_slug(s)`);
});
