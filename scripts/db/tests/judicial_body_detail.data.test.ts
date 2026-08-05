// /court/:bodyCode must serve all 279 judicial bodies, and must never confuse
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

// The dimension must hold one row per INSTITUTION, not one per spelling.
//
// Sofia's courts have adjectival names and therefore curated entries checked
// before the generic seated rules — but that defence only covered the
// spelled-out spelling, while court_load writes the abbreviated one. Five bodies
// existed twice as a result, each with its magistrates on one row and its
// workload on the other, so /court/as-sofia-grad asserted at a 200 that the ВСС
// publishes no workload for a court whose eight-year series sat under the twin.
//
// Detected structurally rather than by name-listing the five: a genuine pair of
// same-kind, same-tier bodies in one seat is what a duplicate looks like, and
// the five legitimate ones are named explicitly so a NEW collision fails.
//
// KEYED ON place_code, NOT on the display name. The loader resolves `София`,
// `София-град` and `София-област` all to SFO_CITY, whereas the NAMES differ by a
// qualifier — and the two `АдмС` twins carried `София` on one half and
// `София-град` on the other, so a name-derived key put the very pair this test
// exists for into two different groups and walked past it. Stripping the hyphen
// does not help: that maps `София-град` to `СОФИЯГРАД`, still not `СОФИЯ`.
const DUPLICATE_GROUPS_SQL = `
  SELECT kind || '/' || coalesce(tier, '') || '/' ||
         coalesce(place_code, upper(coalesce(place, ''))) AS pair,
         string_agg(body_code, '|' ORDER BY body_code) AS codes
  FROM judicial_body
  GROUP BY 1 HAVING count(*) > 1`;

/** Genuinely distinct institutions that share a (kind, tier, seat). */
const LEGITIMATE = new Set([
  "vas|vks", // the two Supreme Courts (codes sort alphabetically)
  "asns|sns", // appellate vs first-instance specialised criminal court
  "vaps-mil|vs-sofiya", // Военно-апелативен съд vs Военен съд — София
  "vap-mil|vop-sofiya", // the same pair on the prosecution side
  // Two separate administrative courts, one for the city and one for the
  // oblast. They share a SEAT (both sit in Sofia) but not a jurisdiction —
  // АССГ and АССО are different institutions, which is why the fold treats
  // the ГРАД / ОБЛАСТ token as meaningful rather than as a qualifier.
  "as-sofia-grad|as-sofia-oblast",
]);

test("no two bodies are the same institution written two ways", async (t) => {
  if (!bodiesLoaded) return t.skip();
  const rows = await allRows<{ pair: string; codes: string }>(
    DUPLICATE_GROUPS_SQL,
  );
  const unexpected = rows.filter((r) => !LEGITIMATE.has(r.codes));
  assert.deepEqual(
    unexpected.map((r) => `${r.codes} (${r.pair})`),
    [],
    "two bodies share a kind, tier and seat — one institution folded into two, splitting its magistrates from its workload",
  );
});

test("the duplicate gate fires on the shape it was written for", async (t) => {
  if (!bodiesLoaded) return t.skip();
  // Pinned the way sourcesBuilt is pinned above: restore the defect inside a
  // rolled-back transaction and assert the gate sees it. Without this the gate
  // passes vacuously the moment its key stops discriminating — which is how the
  // first version shipped, blind to the very pair its own header cites.
  await withTx(async (tx) => {
    // The twin the ВСС's abbreviated spelling used to mint: same kind, tier and
    // seat as as-sofia-grad, different code, and the qualified place NAME that
    // defeated the previous key.
    await tx.query(
      `INSERT INTO judicial_body (body_code, name, kind, tier, place, place_code)
       SELECT 'as-sofiya-grad', 'Административен съд — София-град', kind, tier,
              'София-град', place_code
         FROM judicial_body WHERE body_code = 'as-sofia-grad'`,
    );
    const { rows } = await tx.query<{ codes: string }>(DUPLICATE_GROUPS_SQL);
    assert.ok(
      rows
        .filter((r) => !LEGITIMATE.has(r.codes))
        .some((r) => r.codes.includes("as-sofiya-grad")),
      "the gate did not notice a re-introduced АдмС twin — its grouping key no longer discriminates",
    );
    // withTx COMMITS on a clean return, so the throw is what undoes the insert.
    // Same shape as the sourcesBuilt test above.
    throw new Error("rollback");
  }).catch((e: Error) => {
    if (e.message !== "rollback") throw e;
  });
});

test("the ВСС workload series attaches to the court that has the magistrates", async (t) => {
  if (!bodiesLoaded) return t.skip();
  // The symptom the fold bug produced: a court with magistrates and no workload
  // sitting next to a twin with the workload and no magistrates. Neither half is
  // wrong on its own — 69 prosecution offices legitimately have magistrates and
  // no workload — so this asserts the PAIRING is gone, not the shape.
  //
  // Same place_code key as the gate above, and for the same reason: on the
  // display name the two `АдмС` halves never met.
  const orphans = await allRows<{ body_code: string; name: string }>(`
    WITH stats AS (
      SELECT b.body_code, b.name, b.kind, b.tier, b.place_code,
             (SELECT count(*) FROM judicial_body_source_name s
                JOIN magistrate m ON m.court = s.source_name
               WHERE s.body_code = b.body_code) AS mags,
             (SELECT count(*) FROM judicial_body_source_name s
                JOIN court_load c ON c.name = s.source_name
               WHERE s.body_code = b.body_code) AS load
      FROM judicial_body b)
    SELECT a.body_code, a.name
    FROM stats a JOIN stats z
      ON a.kind = z.kind AND a.tier IS NOT DISTINCT FROM z.tier
     AND a.place_code IS NOT DISTINCT FROM z.place_code
     AND a.body_code <> z.body_code
    WHERE a.mags > 0 AND a.load = 0 AND z.mags = 0 AND z.load > 0`);
  assert.deepEqual(
    orphans.map((o) => `${o.body_code} (${o.name})`),
    [],
    "a court's magistrates and its workload are on two different bodies",
  );
});
