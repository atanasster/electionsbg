// PG-backed gate for `declared_label()` (089_declarations.sql) and the serving surfaces that
// read it.
//
// WHY THIS TEST. `declaration.institution` / `position_title` come from the Сметна палата
// register's LISTING page and are GROUP labels, not job titles: the bucket „Служебен
// министър-председател и министър" held two men and described neither — both were a DEPUTY PM
// plus a minister — and it reached a published card on 2026-08-16. The per-filing
// `filed_institution` / `filed_position` are the declarant's own institution and job, out of
// each filing's <Personal><Work> / <Personal><Position>.
//
// `declared_label(filed, listed)` is the ONE definition of which of the two a reader sees, and
// the rule it encodes has two halves that fail in opposite directions:
//
//   - prefer the FILED value, or a surface republishes a label that is wrong about a named
//     person (and on the mp tier, where position_title is NULL on all 6,296 rows, publishes
//     nothing at all);
//   - fall back to the LISTING label, or every caller blanks on a database with no backfill —
//     which is Cloud SQL, a fresh clone, and any filing ingested since the last crawl.
//
// This file covers the function itself AND the per-surface assertions — that each serving
// payload and matview actually routes through it rather than reading the raw columns. A
// caller that quietly kept `d.position_title` would pass every test above and still publish
// the wrong label, so the two halves are not redundant.
//
// Auto-skips when Postgres is down or 089 has not been applied, like the other *.data.test.ts
// gates, so CI (no container) skips it.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [r] = await allRows<{ ok: boolean }>(
      `SELECT to_regproc('public.declared_label') IS NOT NULL
          AND to_regclass('public.declaration') IS NOT NULL AS ok`,
    );
    return Boolean(r?.ok);
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb
  ? false
  : "Postgres unreachable / declared_label absent (089 not applied)";

afterAll(async () => {
  await end();
});

const label = async (filed: string | null, listed: string | null) => {
  const [r] = await allRows<{ v: string | null }>(
    "SELECT declared_label($1, $2) AS v",
    [filed, listed],
  );
  return r.v;
};

test.skipIf(skip)("the filed value wins, and is returned trimmed", async () => {
  assert.equal(
    await label("министър", "Служебен министър-председател и министър"),
    "министър",
  );
  // Trimmed rather than passed through: these values are rendered, and they back equality
  // filters on three matview columns, where a stray edge space is an invisible miss.
  assert.equal(await label("  министър  ", "Директор"), "министър");
});

test.skipIf(skip)(
  "falls back to the listing label when the filing states nothing",
  async () => {
    // The half that keeps every caller safe on a database with no backfill. Losing it would
    // blank the label everywhere filed_* is NULL rather than degrade to a coarser truth.
    assert.equal(await label(null, "Кмет"), "Кмет");
    assert.equal(await label("", "Кмет"), "Кмет");
    assert.equal(await label("   ", "Кмет"), "Кмет");
  },
);

test.skipIf(skip)(
  "returns NULL only when neither side has a value",
  async () => {
    assert.equal(await label(null, null), null);
    assert.equal(await label("", null), null);
  },
);

test.skipIf(skip)(
  "is NOT STRICT — a NULL filed value must not null the whole call",
  async () => {
    // Marking the function STRICT would short-circuit to NULL whenever p_filed IS NULL, which
    // is precisely the case the fallback exists to serve. Asserted directly against the
    // catalogue so a future edit cannot reintroduce it and still pass the cases above by luck.
    const [r] = await allRows<{
      strict: boolean;
      volatile: string;
      parallel: string;
    }>(
      `SELECT proisstrict AS strict, provolatile AS volatile, proparallel AS parallel
       FROM pg_proc WHERE proname = 'declared_label'`,
    );
    assert.equal(r.strict, false, "declared_label must not be STRICT");
    assert.equal(r.volatile, "i", "declared_label must be IMMUTABLE");
    assert.equal(r.parallel, "s", "declared_label must be PARALLEL SAFE");
  },
);

test.skipIf(skip)(
  "over the real corpus it prefers filed_position wherever one exists",
  async () => {
    // Corpus-wide rather than a fixture: the rule is about every filing, and a hand-picked
    // pair could agree by accident. Measured 2026-08-17, 55,444 rows carry both and 21,906
    // of them disagree once folded — so this would fail loudly on an inverted COALESCE.
    const [r] = await allRows<{ wrong: string; checked: string }>(
      `SELECT count(*) FILTER (
                WHERE declared_label(filed_position, position_title)
                      IS DISTINCT FROM btrim(filed_position)) AS wrong,
              count(*) AS checked
         FROM declaration
        WHERE filed_position IS NOT NULL AND btrim(filed_position) <> ''`,
    );
    assert.ok(
      Number(r.checked) > 0,
      "no filings carry a filed_position — corpus not loaded?",
    );
    assert.equal(Number(r.wrong), 0);
  },
);

test.skipIf(skip)(
  "the two-man caretaker-PM bucket never reaches a reader who has a filed position",
  async () => {
    // The specific published defect this whole change exists to end. „Служебен
    // министър-председател и министър" is a listing bucket covering two people, neither of
    // whom was caretaker PM. Anyone in it whose filing states a job must serve that job.
    const rows = await allRows<{ declarant_name: string; served: string }>(
      `SELECT declarant_name, declared_label(filed_position, position_title) AS served
         FROM declaration
        WHERE position_title = 'Служебен министър-председател и министър'
          AND filed_position IS NOT NULL AND btrim(filed_position) <> ''`,
    );
    assert.ok(
      rows.length > 0,
      "fixture bucket is empty — has the register relabelled it?",
    );
    for (const r of rows) {
      assert.notEqual(
        r.served,
        "Служебен министър-председател и министър",
        `${r.declarant_name} is still served the listing bucket`,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Per-surface: the 090 payloads (/person profile) must route through declared_label.
//
// Asserted corpus-wide against the raw columns rather than on a fixture, so a caller that
// was missed shows up as a count instead of a lucky pass. Демерджиев is then named
// explicitly because his is the filing that reached a published card.
// ---------------------------------------------------------------------------

/** Every filing the profile block renders, joined to what the raw columns hold. */
const PROFILE_SQL = `
  SELECT d.declaration_id,
         d.filed_position, d.position_title,
         d.filed_institution, d.institution,
         r->>'positionTitle' AS served_position,
         r->>'institution'   AS served_institution
    FROM person p
    JOIN declaration d ON d.person_id = p.person_id
    CROSS JOIN LATERAL jsonb_array_elements(person_declarations(p.slug)) r
   WHERE p.slug = $1 AND (r->>'id')::bigint = d.declaration_id`;

type Served = {
  declaration_id: string;
  filed_position: string | null;
  position_title: string | null;
  filed_institution: string | null;
  institution: string | null;
  served_position: string | null;
  served_institution: string | null;
};

test.skipIf(skip)(
  "person_declarations() serves the filed job, not the listing bucket",
  async () => {
    // mp-5104 is Иван Демерджиев. His two 2023 filings are listed under „Служебен
    // министър-председател и министър" — a bucket covering two men, neither of whom was
    // caretaker PM — while the filings themselves say министър of МВР.
    const rows = await allRows<Served>(PROFILE_SQL, ["mp-5104"]);
    assert.ok(
      rows.length > 0,
      "fixture person has no filings — corpus not loaded?",
    );
    for (const r of rows) {
      if (r.filed_position && r.filed_position.trim()) {
        assert.equal(r.served_position, r.filed_position.trim());
      } else {
        // The degrade half: no filed value must yield the listing label, never a blank.
        assert.equal(r.served_position, r.position_title);
      }
      if (r.filed_institution && r.filed_institution.trim()) {
        assert.equal(r.served_institution, r.filed_institution.trim());
      } else {
        assert.equal(r.served_institution, r.institution);
      }
    }
    assert.ok(
      rows.some(
        (r) => r.position_title === "Служебен министър-председател и министър",
      ),
      "fixture no longer covers the caretaker-PM bucket — pick another person",
    );
    for (const r of rows) {
      assert.notEqual(
        r.served_position,
        "Служебен министър-председател и министър",
      );
    }
  },
);

test.skipIf(skip)(
  "declaration_detail() and the wealth-series markers agree with the profile block",
  async () => {
    // Three functions in 090 render the same filing's job — the row block, the expanded
    // detail, and the chart's Entry/Vacate markers. A reader who opens one and then the
    // other must not be told two different things, which is the failure a per-site COALESCE
    // invites and the reason declared_label exists.
    const rows = await allRows<{ mismatched: string; checked: string }>(
      `SELECT count(*) FILTER (
                WHERE declaration_detail(d.declaration_id)->>'positionTitle'
                      IS DISTINCT FROM declared_label(d.filed_position, d.position_title)
                   OR declaration_detail(d.declaration_id)->>'institution'
                      IS DISTINCT FROM declared_label(d.filed_institution, d.institution)
              ) AS mismatched,
              count(*) AS checked
         FROM declaration d
        WHERE d.person_id IS NOT NULL
        LIMIT 1`,
    );
    assert.ok(
      Number(rows[0].checked) > 0,
      "no resolved filings — corpus not loaded?",
    );
    assert.equal(Number(rows[0].mismatched), 0);

    const markers = await allRows<{ bad: string }>(
      `SELECT count(*) AS bad
         FROM person p
         CROSS JOIN LATERAL jsonb_array_elements(person_wealth_series(p.slug)->'markers') m
         JOIN declaration d ON d.person_id = p.person_id
          AND d.declaration_type IN ('Entry', 'Vacate')
          AND COALESCE(d.fiscal_year, d.declaration_year) = (m->>'year')::int
        WHERE p.slug = 'mp-5104'
          AND m->>'positionTitle'
              IS DISTINCT FROM declared_label(d.filed_position, d.position_title)`,
    );
    assert.equal(Number(markers[0].bad), 0);
  },
);
