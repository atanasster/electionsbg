// `seatsFromBundles` must enumerate EXACTLY the refs `resolve_persons` mints for source='local'.
//
// This is the half of the flip tooling that can silently do harm. `diffSeats` decides which
// person_slug_lock rows to purge or rekey, and it addresses them by ref — so a walk that drifts
// from the resolver's (a missing guard, a different index, a skipped shard) does not fail, it
// purges somebody else's lock and hands a stranger's /person URL to whoever inherits the seat.
// The check is exact and cheap: the two sets must be identical.
//
// Auto-skips when Postgres is down or the person layer is unloaded, like the other *.data.test.ts
// gates. See docs/plans/village-mayor-attribution-v1.md §T1.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../db/lib/pg";
import { seatsFromBundles } from "./kmetstvo_flips";

const reachable = async (): Promise<boolean> => {
  try {
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person_role WHERE source = 'local'",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / local roles unloaded";

afterAll(async () => {
  await end();
});

// NOTE this compares the CURRENT bundles against the CURRENT person_role. It therefore holds
// only while the two are in step — which is exactly the window the tool is designed to run in
// (after a re-parse the sets legitimately differ until db:resolve:persons re-runs, and this
// gate is not what guards that; the flip file is). Between pipeline runs, they must agree.
test.skipIf(skip)(
  "seatsFromBundles enumerates the same refs as the resolver's local walk",
  async () => {
    const rows = await allRows<{ ref: string }>(
      "SELECT DISTINCT ref FROM person_role WHERE source = 'local'",
    );
    const inDb = new Set(rows.map((r) => r.ref));
    const onDisk = new Set(seatsFromBundles().map((s) => s.ref));
    const missing = [...inDb].filter((r) => !onDisk.has(r));
    const extra = [...onDisk].filter((r) => !inDb.has(r));
    assert.deepEqual(
      { missing: missing.slice(0, 5), extra: extra.slice(0, 5) },
      { missing: [], extra: [] },
      `${missing.length} ref(s) in person_role the walk does not produce, ` +
        `${extra.length} the walk produces that person_role does not have — ` +
        `the two walks have drifted, and every lock decision keyed on a ref is unsafe.`,
    );
  },
);

// A ref must name ONE person. `diffSeats` reads a single holder per ref to decide whether the
// seat changed hands; two holders would make that decision depend on row order. (The resolver
// has its own gate for this in local_person_roles.data.test.ts — this one covers the whole
// local source, not just village/район mayors.)
test.skipIf(skip)(
  "every local ref resolves to exactly one person",
  async () => {
    const rows = await allRows<{ ref: string; n: string }>(
      `SELECT ref, count(DISTINCT person_id) AS n
       FROM person_role WHERE source = 'local'
      GROUP BY ref HAVING count(DISTINCT person_id) > 1 LIMIT 5`,
    );
    assert.deepEqual(
      rows.map((r) => r.ref),
      [],
      `${rows.length}+ local ref(s) map to >1 person — the mention key is not unique`,
    );
  },
);

// The winner behind each ref must agree too. A matching ref SET with a different holder is the
// same drift wearing a disguise: the walk would report a "flip" that is really its own bug, and
// purge a lock that was never at risk. Compared through translit_bg_latin (the one normaliser)
// and the alias set, because the bundle carries CIK's spelling and the cluster carries the
// resolver's — see diffSeats' header.
test.skipIf(skip)(
  "the holder behind each ref agrees with the bundle's winner",
  async () => {
    const seats = seatsFromBundles();
    const rows = await allRows<{
      ref: string;
      name: string;
      matches: boolean;
    }>(
      `WITH seat(ref, winner) AS (SELECT * FROM unnest($1::text[], $2::text[]))
       SELECT s.ref, p.display_name AS name,
              (p.name_fold = translit_bg_latin(s.winner)
               OR EXISTS (
                 SELECT 1 FROM person_alias a
                  WHERE a.person_id = p.person_id
                    AND a.alias_fold = translit_bg_latin(s.winner)
               )) AS matches
         FROM seat s
         JOIN person_role r ON r.source = 'local' AND r.ref = s.ref
         JOIN person p USING (person_id)`,
      [seats.map((s) => s.ref), seats.map((s) => s.winner)],
    );
    const wrong = rows.filter((r) => !r.matches);
    assert.deepEqual(
      wrong.slice(0, 5).map((r) => r.ref),
      [],
      `${wrong.length} ref(s) whose person_role holder is not the bundle's winner`,
    );
  },
);
