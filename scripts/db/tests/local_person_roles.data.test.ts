// Village-mayor (кмет на кметство) + район-mayor person roles materialized by
// resolve_persons' local walk (docs/plans/local-person-links-v1.md, Phase 1).
//
// WHY. Before this, resolve_persons read only `mayor.elected` + elected councillors from each
// município bundle, so a village mayor whose only public identity is their kmetstvo win had NO
// person_id and therefore NO servable /person page. The Phase 1 walk adds the elected winner of
// each `kmetstva[]` and `districts[]` contest as source='local' roles. Because `local` is
// public_default=true
// (081_person_identity.sql), those people become active, public, slugged persons automatically —
// which is exactly what the settlement page links to.
//
// Auto-skips when Postgres is down/unloaded, like the other *.data.test.ts gates. The invariant
// (every such role resolves to an active public person with a slug) runs whenever ANY village/
// район role is present; the existence check additionally skips until db:resolve:persons has been
// re-run with the Phase 1 walk (the operator step in the plan's verification section), so this
// gate is green on a DB resolved before Phase 1 and turns into a real assertion after.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const LOCAL_MAYOR_ROLES = ["village_mayor", "rayon_mayor"];

const reachable = async (): Promise<boolean> => {
  try {
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person WHERE is_public_figure",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const roleCount = async (): Promise<number> => {
  try {
    const [c] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM person_role
        WHERE source = 'local' AND role = ANY($1::text[])`,
      [LOCAL_MAYOR_ROLES],
    );
    return Number(c.n);
  } catch {
    return 0;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / person layer unloaded";
const nLocalMayors = haveDb ? await roleCount() : 0;
// Skips on a DB resolved BEFORE Phase 1 (no such roles yet) — the plan's verification re-runs
// db:resolve:persons, after which this becomes a live existence assertion.
const skipExistence =
  skip ||
  (nLocalMayors === 0
    ? "no village/район-mayor roles yet (resolve not re-run)"
    : false);

afterAll(async () => {
  await end();
});

// The invariant that makes the /person link safe: a materialized village/район mayor must be an
// active, public, slugged person — otherwise the settlement page would bake a personSlug that
// resolves to nothing.
test.skipIf(skipExistence)(
  "every village/район-mayor role resolves to an active public person with a slug",
  async () => {
    const rows = await allRows<{ ref: string }>(
      `SELECT r.ref
         FROM person_role r
         JOIN person p ON p.person_id = r.person_id
        WHERE r.source = 'local' AND r.role = ANY($1::text[])
          AND NOT (p.status = 'active' AND p.is_public_figure AND p.slug IS NOT NULL)`,
      [LOCAL_MAYOR_ROLES],
    );
    assert.deepEqual(
      rows.slice(0, 5).map((r) => r.ref),
      [],
      `${rows.length} village/район-mayor role(s) do not resolve to an active public slugged person`,
    );
  },
);

// The mention ref is the join key the Phase 2 personSlug bake reads out of person_slug_lock, so
// it must follow the `<cycle>:<obshtinaCode>:(kmetstvo|district):<key>` shape the decorate step
// recomputes. A drift here silently breaks the bake (the stamp finds no slug for the record).
test.skipIf(skipExistence)(
  "village/район-mayor refs follow the kmetstvo/district mention shape",
  async () => {
    const rows = await allRows<{ ref: string }>(
      `SELECT ref FROM person_role
        WHERE source = 'local' AND role = ANY($1::text[])`,
      [LOCAL_MAYOR_ROLES],
    );
    const bad = rows
      .map((r) => r.ref)
      .filter((ref) => !/:(kmetstvo|district):/.test(ref));
    assert.deepEqual(
      bad.slice(0, 5),
      [],
      `${bad.length} ref(s) are not keyed :kmetstvo:/:district: — the Phase 2 bake join would miss them`,
    );
  },
);

// The defect this walk had to solve: `ekatte` is empty and `kmetstvoName` repeats within a
// município, so a name-keyed ref collided two different winners onto one mention id — which
// collides person_slug_lock and mis-links the Phase 2 bake. The index-keyed ref must make each
// (source='local', ref) resolve to exactly ONE person.
test.skipIf(skipExistence)(
  "each village/район-mayor ref maps to exactly one person",
  async () => {
    const rows = await allRows<{ ref: string; n: string }>(
      `SELECT ref, count(DISTINCT person_id) AS n
         FROM person_role
        WHERE source = 'local' AND role = ANY($1::text[])
        GROUP BY ref HAVING count(DISTINCT person_id) > 1
        LIMIT 5`,
      [LOCAL_MAYOR_ROLES],
    );
    assert.deepEqual(
      rows.map((r) => r.ref),
      [],
      `${rows.length}+ ref(s) map to >1 person — the kmetstvo/район mention key is not unique`,
    );
  },
);
