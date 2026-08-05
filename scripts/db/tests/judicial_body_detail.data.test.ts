// /court/:bodyCode must serve all 284 judicial bodies, and must never confuse
// "this body publishes no workload" with "the data was not loaded".
//
// The second is the sharp one. `load: null` + `magistrates: 0` is the correct
// payload for a prosecution office AND the payload an unloaded
// judicial_body_source_name produces for every body — including Софийски
// районен съд. Shape-identical, so without `sourcesBuilt` the page would assert
// at a 200 that the ВСС publishes no workload for the busiest court in the
// country. Applying 116 with apply_functions.ts creates that table empty, which
// is the normal way a function change ships, so this is a live state and not a
// hypothetical.
//
// Auto-skips when Postgres is down or the dimension is absent.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end, withTx } from "../lib/pg";

const haveDb = await dbReachable();

const count = async (sql: string): Promise<number> =>
  Number(
    (await allRows<{ n: string }>(sql).catch(() => [{ n: "0" }]))[0]?.n ?? 0,
  );

const bodiesLoaded =
  haveDb && (await count("SELECT count(*) n FROM judicial_body")) > 0;

afterAll(async () => {
  if (haveDb) await end();
});

test("every judicial body resolves to a servable /court page", async (t) => {
  if (!bodiesLoaded) return t.skip();
  const [row] = await allRows<{ total: string; servable: string }>(`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE judicial_body_detail(body_code) IS NOT NULL)
             AS servable
    FROM judicial_body`);
  assert.equal(
    row.servable,
    row.total,
    `${Number(row.total) - Number(row.servable)} of ${row.total} bodies are unservable`,
  );
});

test("all three kinds are covered, not just the courts", async (t) => {
  if (!bodiesLoaded) return t.skip();
  // §9.4: prosecution offices and investigation services get pages too — they
  // are exactly what a reader types. A regression that quietly restricted this
  // to `kind = 'court'` would drop ~97 bodies and look like a tidy-up.
  const rows = await allRows<{ kind: string; n: string }>(
    "SELECT kind, count(*) AS n FROM judicial_body GROUP BY kind",
  );
  const kinds = new Set(rows.map((r) => r.kind));
  for (const k of ["court", "prosecution", "investigation"])
    assert.ok(kinds.has(k), `no ${k} bodies in the dimension`);
});

test("an unknown body code resolves to NULL", async (t) => {
  if (!bodiesLoaded) return t.skip();
  const [row] = await allRows<{ d: unknown }>(
    "SELECT judicial_body_detail('not-a-real-body') AS d",
  );
  assert.equal(row.d, null);
});

test("the source-name bridge covers every body", async (t) => {
  if (!bodiesLoaded) return t.skip();
  // The bridge is what lets SQL join court_load without re-implementing
  // foldJudicialName. A body with no source name can never show a workload.
  const [row] = await allRows<{ orphans: string }>(`
    SELECT count(*) AS orphans FROM judicial_body b
    WHERE NOT EXISTS (
      SELECT 1 FROM judicial_body_source_name s WHERE s.body_code = b.body_code)`);
  assert.equal(row.orphans, "0", "bodies with no source name in the bridge");
});

test("a body never reports two rows for one year", async (t) => {
  if (!bodiesLoaded) return t.skip();
  // 28 administrative courts fold two court_load spellings onto one body. Their
  // year ranges are disjoint today, so a duplicate is latent — one overlapping
  // year would double the series and collide on the React key.
  const [row] = await allRows<{ dupes: string }>(`
    SELECT count(*) AS dupes FROM (
      SELECT b.body_code, (y->>'year')::int AS yr, count(*) AS n
      FROM judicial_body b,
           -- CASE, not COALESCE: the load key is JSON null for the ~103 bodies
           -- with no series, and COALESCE only catches SQL NULL --
           -- jsonb_array_elements on a JSON scalar raises rather than
           -- yielding nothing.
           LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(judicial_body_detail(b.body_code)->'load')
                       = 'array'
                  THEN judicial_body_detail(b.body_code)->'load'
                  ELSE '[]'::jsonb END) y
      GROUP BY 1, 2 HAVING count(*) > 1) d`);
  assert.equal(row.dupes, "0", "a body reports the same year twice");
});

test("sourcesBuilt tells an unloaded bridge apart from a quiet body", async (t) => {
  if (!bodiesLoaded) return t.skip();
  // THE point of the flag. Emptying the bridge must flip it to false — if it
  // stayed true, every court page would assert "no published workload" about a
  // court, at a 200, indistinguishably from the truth.
  await withTx(async (c) => {
    const before = await c.query(
      "SELECT judicial_body_detail('as-plovdiv') AS d",
    );
    assert.equal(
      before.rows[0].d.sourcesBuilt,
      true,
      "sourcesBuilt is false on a loaded database",
    );
    await c.query("DELETE FROM judicial_body_source_name");
    const after = await c.query(
      "SELECT judicial_body_detail('as-plovdiv') AS d",
    );
    assert.equal(
      after.rows[0].d.sourcesBuilt,
      false,
      "an empty bridge still reports sourcesBuilt: true — every court page " +
        "would then claim the ВСС publishes no workload for it",
    );
    assert.equal(after.rows[0].d.load, null);
    throw new Error("rollback");
  }).catch((e: Error) => {
    if (e.message !== "rollback") throw e;
  });
});
