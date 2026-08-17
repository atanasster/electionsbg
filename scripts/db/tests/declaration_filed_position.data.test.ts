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
import { allRows, end, withClient } from "../lib/pg";

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

test.skipIf(skip)(
  "all three feed functions carry the filed job (093 x2, 098)",
  async () => {
    // 093 has TWO call sites — the per-person events block and the site-wide feed — and 098
    // one. Each is asserted against declared_label separately, because a shared helper does
    // not make one call site evidence for another: a review caught declaration_events_feed
    // repointed but untested, where reverting it passed every other assertion in the repo.
    //
    // Each arm also asserts its own NON-VACUOUSNESS first: that the rows it checks actually
    // contain a case where filed and listing disagree. Without that, a corpus that converged
    // (or a fixture that stopped filing) would leave the arm green while checking nothing.
    const [events] = await allRows<{
      bad: string;
      n: string;
      diverging: string;
    }>(
      `SELECT count(*) FILTER (
                WHERE e->>'positionTitle' IS DISTINCT FROM
                      declared_label(d.filed_position, d.position_title)
                   OR e->>'institution' IS DISTINCT FROM
                      declared_label(d.filed_institution, d.institution)) AS bad,
              count(*) AS n,
              count(*) FILTER (
                WHERE btrim(coalesce(d.filed_position, '')) <> ''
                  AND d.filed_position IS DISTINCT FROM d.position_title) AS diverging
         FROM person p
         CROSS JOIN LATERAL jsonb_array_elements(person_declaration_events(p.slug)) e
         JOIN declaration d ON d.source_url = e->>'sourceUrl'
        WHERE p.slug = 'mp-1588'`,
    );
    assert.ok(Number(events.n) > 0, "fixture person has no declaration events");
    assert.ok(
      Number(events.diverging) > 0,
      "mp-1588's events no longer disagree with the listing label — pick another fixture",
    );
    assert.equal(Number(events.bad), 0);

    // The site-wide feed. NULL kind = every kind; 500 rows is well past the page size any
    // caller asks for, so this walks a real cross-section rather than the first screen.
    const [feed] = await allRows<{ bad: string; n: string; diverging: string }>(
      `SELECT count(*) FILTER (
                WHERE e->>'positionTitle' IS DISTINCT FROM
                      declared_label(d.filed_position, d.position_title)
                   OR e->>'institution' IS DISTINCT FROM
                      declared_label(d.filed_institution, d.institution)) AS bad,
              count(*) AS n,
              count(*) FILTER (
                WHERE btrim(coalesce(d.filed_position, '')) <> ''
                  AND d.filed_position IS DISTINCT FROM d.position_title) AS diverging
         FROM jsonb_array_elements(declaration_events_feed(NULL, 500)) e
         JOIN declaration d ON d.source_url = e->>'sourceUrl'`,
    );
    assert.ok(Number(feed.n) > 0, "declaration_events_feed is empty");
    assert.ok(
      Number(feed.diverging) > 0,
      "no row in the events feed disagrees with its listing label — gate is vacuous",
    );
    assert.equal(Number(feed.bad), 0);

    const [filings] = await allRows<{
      bad: string;
      n: string;
      diverging: string;
    }>(
      `SELECT count(*) FILTER (
                WHERE e->>'positionTitle' IS DISTINCT FROM
                      declared_label(d.filed_position, d.position_title)
                   OR e->>'institution' IS DISTINCT FROM
                      declared_label(d.filed_institution, d.institution)) AS bad,
              count(*) AS n,
              count(*) FILTER (
                WHERE btrim(coalesce(d.filed_position, '')) <> ''
                  AND d.filed_position IS DISTINCT FROM d.position_title) AS diverging
         FROM jsonb_array_elements(declaration_new_filings(200)) e
         JOIN declaration d ON d.source_url = e->>'sourceUrl'`,
    );
    assert.ok(Number(filings.n) > 0, "new-filings feed is empty");
    assert.ok(
      Number(filings.diverging) > 0,
      "no row in the new-filings feed disagrees with its listing label — gate is vacuous",
    );
    assert.equal(Number(filings.bad), 0);
  },
);

// ---------------------------------------------------------------------------
// The exhaustiveness sweep: no serving object may read the listing columns raw.
//
// Every per-surface assertion above names an object someone remembered to test, and the
// review that produced this file caught exactly that gap once — declaration_events_feed was
// repointed and untested, and reverting it passed everything else in the repo. So the last
// gate is not another assertion about a known surface: it enumerates every function, view
// and matview whose definition reads `declaration` and mentions these columns, and requires
// each one to be CLASSIFIED. A new surface — or an old one someone repoints — fails here
// until it is either routed through declared_label or written down as an exception.
// ---------------------------------------------------------------------------

/** Objects that legitimately serve the register's LISTING label instead of the filing's own.
 *  Each needs a reason, because "it looked fine" is what this gate exists to refuse. */
const LISTING_LABEL_EXCEPTIONS: Record<string, string> = {
  // 102: both columns are renamed into contracts the filed values do not satisfy —
  // `ld.institution AS municipality` (listing = „Ямбол", filing = „Община Ямбол" / a
  // council) and `ld.position_title AS role_raw` (listing = 5 clean roles, filing = 563
  // free-text spellings, sometimes naming the body instead of the role). See 102's header.
  municipal_officials_table:
    "columns are renamed to municipality / role_raw (102 header)",
  // 120: `institution` is a FACET KEY, not a job description — db_table.js exposes it as
  // filter:"in" and the picker facets the same column. The listing is a 1,013-value
  // controlled vocabulary; the filed value is free text and takes the column to 12,626
  // distinct values, which stops it being a picker. See 120's header.
  person_browse_table: "institution is an exact-match facet key (120 header)",
};

test.skipIf(skip)(
  "every declaration-serving object either routes through declared_label or is a named exception",
  async () => {
    const rows = await allRows<{ obj: string; kind: string; routes: boolean }>(
      `WITH defs AS (
         SELECT c.relname AS obj, c.relkind::text AS kind, pg_get_viewdef(c.oid) AS src
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('m', 'v')
         UNION ALL
         SELECT p.proname, 'f', pg_get_functiondef(p.oid)
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.prokind = 'f'
       ), clean AS (
         -- Comments are stored verbatim in a function body, and several of these files
         -- mention the raw columns in prose precisely to warn against them. Strip comments
         -- before deciding, or the warning trips the gate it was written to support.
         SELECT obj, kind, regexp_replace(src, '--[^\n]*', '', 'g') AS s FROM defs
       )
       SELECT obj, kind, (s ~ 'declared_label') AS routes
         FROM clean
        WHERE s ~ 'declaration'
          AND s ~ '(position_title|filed_position|\\minstitution\\M)'
        ORDER BY obj`,
    );
    assert.ok(
      rows.length > 5,
      `only ${rows.length} serving objects found — migrations applied?`,
    );

    const unrouted = rows
      .filter((r) => !r.routes && !(r.obj in LISTING_LABEL_EXCEPTIONS))
      .map((r) => `${r.obj} (${r.kind})`);
    assert.deepEqual(
      unrouted,
      [],
      `these read the register's listing label raw — route them through declared_label() ` +
        `or add them to LISTING_LABEL_EXCEPTIONS with a reason: ${unrouted.join(", ")}`,
    );

    // The exception list must not outlive its entries: an exception for an object that no
    // longer exists, or that has since been routed, is stale config that hides the next one.
    const seen = new Set(rows.map((r) => r.obj));
    for (const [obj, why] of Object.entries(LISTING_LABEL_EXCEPTIONS)) {
      assert.ok(
        seen.has(obj),
        `stale exception '${obj}' (${why}) — object no longer qualifies`,
      );
      assert.equal(
        rows.find((r) => r.obj === obj)?.routes,
        false,
        `'${obj}' now routes through declared_label — drop its exception`,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// The mutation check, shipped rather than run by hand.
//
// Every assertion above compares a serving payload against declared_label(). That makes
// them satisfiable by ANY implementation the two sides happen to share — including an
// inverted one, where each surface faithfully republishes the listing label and the gate
// agrees with it. So the gate has to prove it discriminates: redefine declared_label to
// prefer the LISTING value inside a transaction, confirm the surfaces flip with it, and
// roll back. Same technique as person_connections.data.test.ts restoring an old function
// body to prove its buffer ceiling still bites.
// ---------------------------------------------------------------------------

test.skipIf(skip)(
  "the gate discriminates: inverting declared_label flips what the surfaces serve",
  async () => {
    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        // A filing where the two labels genuinely differ, chosen live so the check cannot
        // go vacuous if this particular person's filings change.
        const { rows: fx } = await c.query<{
          slug: string;
          id: string;
          filed: string;
          listed: string;
        }>(
          `SELECT p.slug, d.declaration_id AS id, d.filed_position AS filed,
                  d.position_title AS listed
             FROM declaration d JOIN person p ON p.person_id = d.person_id
            WHERE btrim(coalesce(d.filed_position, '')) <> ''
              AND d.position_title IS NOT NULL
              AND btrim(d.filed_position) <> d.position_title
            ORDER BY d.declaration_id
            LIMIT 1`,
        );
        assert.ok(
          fx[0],
          "no filing disagrees with its listing label — gate is vacuous",
        );
        const { id, filed, listed } = fx[0];

        const served = async () => {
          const { rows } = await c.query<{ v: string | null }>(
            "SELECT declaration_detail($1)->>'positionTitle' AS v",
            [id],
          );
          return rows[0].v;
        };

        // Baseline: the real definition serves the filing's own job.
        assert.equal(await served(), filed.trim());

        await c.query(`
          CREATE OR REPLACE FUNCTION declared_label(p_filed text, p_listed text)
          RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $x$
            SELECT COALESCE(nullif(btrim(p_listed), ''), p_filed)
          $x$`);

        // If this still returned the filed value, declaration_detail would not be reading
        // declared_label at all and every assertion above would be proving nothing.
        assert.equal(
          await served(),
          listed.trim(),
          "declaration_detail did not follow declared_label — it is not routed through it",
        );
      } finally {
        await c.query("ROLLBACK").catch(() => {});
      }
    });

    // The rollback must have restored the real definition for every later test.
    const [check] = await allRows<{ v: string }>(
      "SELECT declared_label('филед', 'листед') AS v",
    );
    assert.equal(check.v, "филед", "ROLLBACK did not restore declared_label");
  },
);
