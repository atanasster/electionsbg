// The person-label JOIN (082_person_api.sql × place_dim 117 × judicial_body 116).
//
// WHY THIS FILE EXISTS, AND WHY NOW. 082 stopped reading person_role.place_label /
// place_label_en and now joins for them instead. The columns are still written, which makes
// this the ONE window in which the replacement can be checked against the thing it replaced.
// After the planned DROP COLUMN the reference disappears, so the assertion has to be written
// while it is still here — and it is what gates that drop.
//
// The check is at the FUNCTION level, not the table level. A row-level comparison of
// place_dim against person_role would pass even if the jsonb the page consumes were wired
// up wrong (wrong COALESCE order, a fan-out from a duplicate dimension row, an EN label
// leaking onto a judicial role). person_by_slug() is what /person actually renders, so that
// is what gets compared.
//
// Also the permanent DRIFT GUARD: once the labels are joined, a place_code the dimension
// does not carry renders as a silent blank rather than an error — resolve_persons writing a
// new МИР, a new judicial body or a new obshtina would degrade the page with nothing failing.
// The materialised columns used to make that impossible by construction; this test replaces
// that guarantee.
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

/** True while person_role still carries the materialised labels. The parity tests below
 *  compare against them, so they retire themselves the moment the columns drop rather than
 *  turning red on a change that is by then intended. */
const hasLegacyLabels = async (): Promise<boolean> => {
  try {
    const [c] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM information_schema.columns
        WHERE table_name = 'person_role' AND column_name = 'place_label'`,
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};
const legacy = ok && (await hasLegacyLabels());

afterAll(async () => {
  await end();
});

test.skipIf(!legacy)(
  "every role's joined label matches the materialised one, row for row",
  async () => {
    const [r] = await allRows<{ n: string }>(`
      SELECT count(*) n FROM person_role r
      LEFT JOIN place_dim pd
        ON pd.kind = r.place_kind AND pd.code = r.place_code
      LEFT JOIN judicial_body jb
        ON r.place_kind = 'judicial' AND jb.body_code = r.place_code
       WHERE r.place_code IS NOT NULL
         AND (COALESCE(pd.name_bg, jb.name) IS DISTINCT FROM r.place_label
           OR pd.name_en                    IS DISTINCT FROM r.place_label_en)`);
    assert.equal(r.n, "0");
  },
);

test.skipIf(!legacy)(
  "person_by_slug() serves the same labels the materialised columns hold",
  async () => {
    // The end-to-end check: unnest the jsonb the page consumes and diff it against
    // person_role. Covers the 200 people carrying the most placed roles, which is where a
    // fan-out or a mis-joined kind would show up first.
    const [r] = await allRows<{ n: string }>(`
      WITH top AS (
        SELECT p.slug, p.person_id
          FROM person p JOIN person_role r ON r.person_id = p.person_id
         WHERE r.place_code IS NOT NULL
         GROUP BY p.slug, p.person_id
         ORDER BY count(*) DESC, p.slug
         LIMIT 200
      ),
      served AS (
        SELECT t.person_id,
               e->>'placeCode'    AS place_code,
               e->>'placeKind'    AS place_kind,
               e->>'placeLabel'   AS label,
               e->>'placeLabelEn' AS label_en
          FROM top t,
               LATERAL jsonb_array_elements(person_by_slug(t.slug)->'roles') e
         WHERE e->>'placeCode' IS NOT NULL
      )
      SELECT count(*) n
        FROM served s
        JOIN person_role r
          ON r.person_id = s.person_id
         AND r.place_code = s.place_code
         AND r.place_kind = s.place_kind
       WHERE s.label    IS DISTINCT FROM r.place_label
          OR s.label_en IS DISTINCT FROM r.place_label_en`);
    assert.equal(r.n, "0");
  },
);

// ── The permanent guard: outlives the DROP COLUMN ────────────────────────────────────────

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
