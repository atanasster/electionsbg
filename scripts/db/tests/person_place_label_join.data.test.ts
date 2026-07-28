// The person-label JOIN (082_person_api.sql × place_dim 117 × judicial_body 116).
//
// WHY THIS FILE EXISTS. 082 resolves each role's place label by JOIN instead of reading a
// materialised person_role.place_label / place_label_en. The parity tests that gated that
// switch compared the two against each other; both columns are now dropped, so those tests
// have been removed rather than left permanently skipped against columns that cannot return.
// The evidence they produced is in the commit that dropped the columns: 590/590 distinct
// (kind, code, label, label_en) tuples byte-identical before and after.
//
// What remains is the permanent DRIFT GUARD, and it is load-bearing precisely because
// materialisation used to make these failures impossible by construction. Now a place_code
// the dictionary does not carry renders as a silent blank rather than an error, so
// resolve_persons writing a new МИР, a new judicial body or a new obshtina would quietly
// degrade a named person's public profile with nothing failing anywhere.
//
// The checks run at the FUNCTION level wherever they can. A row-level comparison would pass
// even if the jsonb the page consumes were wired up wrong (wrong COALESCE order, a fan-out
// from a duplicate dimension row, an EN label leaking onto a judicial role);
// person_by_slug() is what /person actually renders, so that is what gets asserted on.
//
// Auto-skips when Postgres is down or the person layer has never been resolved — the probe
// is TOP-LEVEL and feeds test.skipIf (docs/testing-standards.md), because an early `return`
// inside a body would score as a PASS and report the gate green while asserting nothing.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person_role WHERE place_code IS NOT NULL",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};
const ok = await reachable();

afterAll(async () => {
  await end();
});

test.skipIf(!ok)(
  "every place_code resolves in place_dim or judicial_body",
  async () => {
    // The invariant the materialised label used to enforce for free. A code that resolves
    // nowhere is not an error anywhere in the stack — it is a blank badge on a named
    // person's public profile, so it fails HERE instead.
    const rows = await allRows<{ place_kind: string; place_code: string }>(`
      SELECT DISTINCT r.place_kind, r.place_code
        FROM person_role r
        LEFT JOIN place_dim pd
          ON pd.kind = r.place_kind AND pd.code = r.place_code
        LEFT JOIN judicial_body jb
          ON r.place_kind = 'judicial' AND jb.body_code = r.place_code
       WHERE r.place_code IS NOT NULL
         AND pd.code IS NULL AND jb.body_code IS NULL
       ORDER BY 1, 2`);
    assert.deepEqual(
      rows.map((r) => `${r.place_kind}:${r.place_code}`),
      [],
    );
  },
);

test.skipIf(!ok)("the join cannot fan a role out into duplicates", async () => {
  // Both joins hit a primary key today ((kind,code) and body_code). If a future migration
  // relaxed either one, a person would silently grow duplicate role rows on their profile.
  //
  // Measured as base row count vs joined row count — NOT as "duplicate (person, role,
  // place) tuples", which person_role legitimately contains: the same candidate role in two
  // different elections is two rows differing only by `ref` (12k of them), and counting
  // those would flag the data rather than the join.
  const [r] = await allRows<{ base: string; joined: string }>(`
    SELECT
      (SELECT count(*) FROM person_role WHERE place_code IS NOT NULL) AS base,
      (SELECT count(*) FROM person_role r
         LEFT JOIN place_dim pd
           ON pd.kind = r.place_kind AND pd.code = r.place_code
         LEFT JOIN judicial_body jb
           ON r.place_kind = 'judicial' AND jb.body_code = r.place_code
        WHERE r.place_code IS NOT NULL) AS joined`);
  assert.equal(r.joined, r.base);
});

test.skipIf(!ok)(
  "judicial roles carry a Bulgarian label and no English one",
  async () => {
    // judicial_body has no English name column, and place_label_en was already NULL for
    // 100% of judicial roles — so this pins the pre-existing contract, not a regression.
    // PersonProfileScreen.placeText() falls back to the Bulgarian label.
    const [r] = await allRows<{ missing_bg: string; has_en: string }>(`
      SELECT
        count(*) FILTER (WHERE e->>'placeLabel' IS NULL)   AS missing_bg,
        count(*) FILTER (WHERE e->>'placeLabelEn' IS NOT NULL) AS has_en
      FROM (
        SELECT p.slug FROM person p JOIN person_role r ON r.person_id = p.person_id
         WHERE r.place_kind = 'judicial' GROUP BY p.slug ORDER BY p.slug LIMIT 100
      ) t,
      LATERAL jsonb_array_elements(person_by_slug(t.slug)->'roles') e
      WHERE e->>'placeKind' = 'judicial'`);
    assert.equal(r.missing_bg, "0");
    assert.equal(r.has_en, "0");
  },
);

test.skipIf(!ok)(
  "an unresolvable declared place still renders the source's own words",
  async () => {
    // place_raw is the deliberate carve-out to the label retirement. The ИВСС declaration
    // form is free text, so ~43 magistrate courts are typos ("Роайонен съд - Пловдив") or
    // ambiguous between two real bodies ("Върховна прокуратура" — ВКП or ПРБ). The
    // dictionary refuses to guess a body, and that text exists NOWHERE else — so dropping
    // it would blank a badge rather than de-duplicate a label. Pinned because the natural
    // "finish the migration" instinct is to delete the last arm of the COALESCE.
    const [r] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person_role WHERE place_raw IS NOT NULL",
    );
    const n = Number(r.n);
    assert.ok(
      n > 0,
      "no place_raw rows — the unresolved-declaration fallback has been lost",
    );
    // A CEILING as well as a floor. The fallback is a safety net for a few dozen typos; if
    // judicial_body_alias is empty — the documented cloud failure where
    // db:load:judicial-bodies:pg:cloud was skipped — then ~2,700 magistrates stop resolving
    // and pour down this branch instead. Without a bound every assertion in this file goes
    // green on exactly that state, and this one would go green *harder*.
    assert.ok(
      n < 200,
      `${n} roles fell back to raw declaration text (expected a few dozen) — the judicial dictionary is probably unpopulated`,
    );

    // …and it reaches the page: kind/code stay NULL, but the label is served.
    const served = await allRows<{
      label: string | null;
      code: string | null;
    }>(`
      SELECT e->>'placeLabel' AS label, e->>'placeCode' AS code
        FROM (
          SELECT p.slug FROM person p JOIN person_role r ON r.person_id = p.person_id
           WHERE r.place_raw IS NOT NULL ORDER BY p.slug LIMIT 5
        ) t,
        LATERAL jsonb_array_elements(person_by_slug(t.slug)->'roles') e
       WHERE e->>'placeCode' IS NULL AND e->>'placeLabel' IS NOT NULL`);
    assert.ok(
      served.length > 0,
      "place_raw is stored but never served — the COALESCE fallback arm is missing",
    );
  },
);

test.skipIf(!ok)(
  "a place that DOES resolve never carries raw fallback text",
  async () => {
    // Otherwise place_raw could silently mask a dictionary miss: the badge would render
    // from stale source text while the join quietly returned nothing.
    const [r] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person_role WHERE place_code IS NOT NULL AND place_raw IS NOT NULL",
    );
    assert.equal(r.n, "0");
  },
);

test.skipIf(!ok)(
  "the capital's synthetic obshtina still resolves to a label",
  async () => {
    // SFO_CITY is the one code of 295 that data/municipalities.json cannot label, and it
    // carries ~263 roles. It is the likeliest thing to silently vanish from the dimension.
    const [r] = await allRows<{
      label: string | null;
      label_en: string | null;
    }>(`
      SELECT e->>'placeLabel' AS label, e->>'placeLabelEn' AS label_en
        FROM (
          SELECT p.slug FROM person p JOIN person_role r ON r.person_id = p.person_id
           WHERE r.place_code = 'SFO_CITY' ORDER BY p.slug LIMIT 1
        ) t,
        LATERAL jsonb_array_elements(person_by_slug(t.slug)->'roles') e
       WHERE e->>'placeCode' = 'SFO_CITY' LIMIT 1`);
    assert.equal(r?.label, "Столична община");
    assert.equal(r?.label_en, "Sofia (capital municipality)");
  },
);
