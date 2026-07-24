// The G13 load-order gate for load_declarations_pg.ts. The two failure modes it
// pins are both silent — an unresolved declaration is "never an error" by design,
// so nothing else would catch either:
//
//   1. tier→person_role.source drift. The phase-2 UPDATE joins subject_ref = ref
//      scoped by a tier→source SET. If that set stops matching how the resolver
//      keys a source (e.g. someone "fixes" tier to equal source), every exec/muni
//      declaration silently keeps person_id = NULL — the exact bug G13 exists for.
//   2. A duplicate source_url slipping past the loader's dedup, which would double
//      every asset/income/stake into the wealth math.
//
// Auto-skips when Postgres is down OR the declarations were not loaded+resolved —
// so CI (no container) skips it, like the other *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.declaration') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    // Needs a RESOLVED corpus (phase 2 ran): a table that exists but is empty, or
    // loaded-but-not-resolved, is not what these assertions are about.
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM declaration WHERE person_id IS NOT NULL",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb
  ? false
  : "Postgres unreachable / declarations not resolved";

afterAll(async () => {
  await end();
});

// Every executive and municipal declaration must resolve. This is stricter than
// the corpus-wide floor below, and it is sound by construction: the SAME ingest
// that writes these declarations feeds official_roster, which the resolver reads
// to build a person_role for every official slug — so the exec/muni subject set
// is a subset of what the resolver places. A NULL here therefore means the
// tier→source join drifted, never a legitimately-absent subject. (If a future
// tier is added that the resolver does NOT fully place, relax this to a floor.)
test.skipIf(skip)(
  "exec and municipal declarations resolve to a person_id",
  async () => {
    const rows = await allRows<{ tier: string; total: string; nulls: string }>(
      `SELECT tier, count(*) total,
              count(*) FILTER (WHERE person_id IS NULL) nulls
         FROM declaration WHERE tier IN ('exec','muni') GROUP BY tier`,
    );
    for (const r of rows) {
      assert.equal(
        Number(r.nulls),
        0,
        `${r.nulls}/${r.total} ${r.tier} declarations are unresolved — the ` +
          `tier→person_role.source join has drifted (G13)`,
      );
    }
  },
);

// The corpus-wide resolution rate. A handful of former MPs are absent from the
// person layer entirely (not in parliament nor any tracked candidacy) and stay
// NULL honestly; anything above a small floor is a mapping regression.
test.skipIf(skip)("the corpus resolves almost completely", async () => {
  const [{ total, nulls }] = await allRows<{ total: string; nulls: string }>(
    `SELECT count(*) total, count(*) FILTER (WHERE person_id IS NULL) nulls
       FROM declaration`,
  );
  const rate = 1 - Number(nulls) / Number(total);
  assert.ok(
    rate > 0.999,
    `resolution rate ${(rate * 100).toFixed(3)}% — ${nulls}/${total} unresolved`,
  );
});

// source_url is the natural key and is UNIQUE in the schema; the loader also
// de-dupes an official's filing written under two slugs. Both together mean each
// register filing appears exactly once — or its assets are double-counted.
test.skipIf(skip)("no register filing is loaded twice", async () => {
  const dups = await allRows<{ source_url: string; n: string }>(
    `SELECT source_url, count(*) n FROM declaration
      GROUP BY source_url HAVING count(*) > 1 LIMIT 5`,
  );
  assert.equal(
    dups.length,
    0,
    `duplicate source_url(s): ${JSON.stringify(dups)}`,
  );
});

// A resolved declaration's person_id must point at a real person row (the FK
// guarantees it, but a stale matview or a bad manual load could violate it).
test.skipIf(skip)(
  "every resolved person_id references a real person",
  async () => {
    const [{ n }] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM declaration d
      WHERE d.person_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM person p WHERE p.person_id = d.person_id)`,
    );
    assert.equal(Number(n), 0);
  },
);

// The parent-table gates above would all pass even if a child COPY silently
// dropped — so check the children loaded, and that seq is the 0-based contiguous
// sequence the loader's forEach index produces (an off-by-one or a partial COPY
// shows up as a gap).
test.skipIf(skip)(
  "child rows loaded and seq is 0-based contiguous",
  async () => {
    const [{ assets }] = await allRows<{ assets: string }>(
      "SELECT count(*) assets FROM declaration_asset",
    );
    assert.ok(Number(assets) > 0, "no asset rows loaded");
    for (const t of [
      "declaration_asset",
      "declaration_income",
      "declaration_stake",
      "declaration_event",
    ]) {
      const gaps = await allRows(
        `SELECT declaration_id FROM ${t}
        GROUP BY declaration_id
       HAVING max(seq) <> count(*) - 1 OR min(seq) <> 0 LIMIT 5`,
      );
      assert.equal(
        gaps.length,
        0,
        `${t}: non-contiguous seq ${JSON.stringify(gaps)}`,
      );
    }
  },
);
