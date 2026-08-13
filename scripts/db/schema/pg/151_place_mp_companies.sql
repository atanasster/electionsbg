-- Companies registered at a place that a PUBLIC FIGURE holds a registry role in — the
-- replacement for the `parliament/companies-by-ekatte/` + `companies-by-obshtina/` shard
-- families (646 bucket-served files across 176 + 131 places).
-- Plan: docs/plans/mp-tr-edges-pg-v1.md §4 Tier 2, revised by
--       docs/plans/data-hub-lateral-edges-v1.md §11.10.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- WHY THIS IS NOT A PORT OF THE SHARD BUILDERS.
--
-- The shards were built from companies-index.json — an MP-NAME match over TR officers, with
-- no people-per-name guard. They covered 176 settlements and 2,159 companies. The same
-- question asked of the gated person layer covers 1,332 settlements (260 municipalities) and
-- 10,202 companies: 7.6x the places and 4.7x the companies, measured 2026-08-12 against the
-- loaded table — NOT the 1,548/13,567 an earlier draft of this header quoted, which was taken
-- before the seat-resolution filter. Porting the builder would have moved a worse answer into
-- a faster store.
--
-- ⚠️ AND 23 OF THE 176 SHARD PLACES CORRECTLY LOSE THEIR PAGE — their shard entries rested
-- entirely on name matches the registry says belong to more than one human (21 of the 23 still
-- have companies placed there, just none held by anyone in public life). That is the migration
-- working, not a coverage regression, and the test asserts the SHARE that survives rather than
-- demanding all of them do.
--
-- ⚠️ AND IT IS NOT `place_companies()` EITHER — the two answer different questions and both
-- are wanted. `place_companies` (133) asks "what is registered here", ranks politically-linked
-- first, and its `politicalCount` reads `political_n`, which is derived from
-- company_politicians and therefore MONEY-restricted: 113 companies at 43 places. This asks
-- "which companies here does a person in public life hold a role in", filters on
-- `person_link_n`, and is the one that fills a page rather than a tile.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- ONE FUNCTION FOR THE SUMMARY AND THE PAGE.
--
-- The shard family shipped two payload shapes — `{ekatte}-summary.json` (top-5 + counts) and
-- `{ekatte}-page-NNN.json` (50 rows) — which is two files, two fetches and two chances to
-- disagree about `count`. They differ only in page size, so this is one function with a
-- `p_page_size` and the counts always computed over the same predicate as the rows.
--
-- Applied, never loaded (CLAUDE.md). 133 owns `person_link_n` and its two partial indexes, so
-- a database whose 133 predates them serves an empty page rather than a wrong one — the
-- column defaults to 0. Ship a body change with:
--   npx tsx scripts/db/apply_functions.ts 151_place_mp_companies.sql
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- COST, MEASURED, AND WHERE THE CEILING IS.
--
-- Local, one page of 50: **28,257 buffers / ~48 ms for Sofia (ekatte 68134, 3,153 qualifying
-- companies)**, 29,607 for Столична община, 5,651 for a mid-size settlement, and a few hundred
-- for a village. Two restructures got Sofia there from 46,608 — the gated-subset index below,
-- and deduping person_ids before joining `person` (see personCount).
--
-- That is ABOVE the ~2,000-buffer budget the dashboard-hub rule sets, and deliberately so: this
-- is a page a reader navigates to, not a tile every dashboard view fetches. The two tile calls
-- on that path (`place_companies`, 133) are unchanged and stay cheap.
--
-- ⚠️ Sofia is the outlier by an order of magnitude and prod is a db-g1-small, so if
-- /settlement/68134/companies shows up slow there, the escape hatch is a per-place precompute
-- on the 123/124 pattern — NOT widening the index, which is already index-only for its scan.
-- The dominant remaining term is `personCount` scanning all 3,153 companies' roles, which no
-- index removes because the question is "how many DISTINCT people across the whole place".

-- ⚠️ REQUIRED, and it is what makes the place page servable. `idx_person_role_ref` covers
-- `ref` alone, so resolving "which public figures hold a role at these companies" over a whole
-- place made the planner give up on it and hash-join the WHOLE 192k-row gated set: measured on
-- Sofia, a Parallel Seq Scan on person_role inside 46,608 buffers / 79.8 ms for one page.
--
-- This carries the gated predicate IN THE INDEX and `person_id` as a payload column, so the
-- per-company lookup is index-only and the `person` probes collapse with it. The predicate is
-- the same triple the function and 082 use; if that set ever widens, this index must widen with
-- it or the plan silently reverts to the seq scan.
CREATE INDEX IF NOT EXISTS idx_person_role_tr_ref_person
  ON person_role (ref, person_id)
  WHERE source IN ('tr', 'ngo')
    AND confidence IN ('exact_id', 'high', 'manual');

CREATE OR REPLACE FUNCTION place_mp_companies(
  p_ekatte    text DEFAULT NULL,
  p_obshtina  text DEFAULT NULL,
  p_page      int  DEFAULT 1,
  p_page_size int  DEFAULT 50
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH args AS (
    SELECT GREATEST(COALESCE(p_page, 1), 1)                    AS pg,
           LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 200)  AS sz
  ),
  -- The place's qualifying companies. `person_link_n > 0` is the partial-index predicate, so
  -- this is a scan of the ANSWER rather than of the place — Sofia is 3,152 rows here against
  -- 110,474 in the place.
  hits AS (
    SELECT p.uic, p.name, p.money_eur
      FROM tr_company_place p
     WHERE p.person_link_n > 0
       AND ((p_ekatte IS NOT NULL AND p.ekatte = p_ekatte)
         OR (p_obshtina IS NOT NULL AND p.obshtina = p_obshtina))
  ),
  total AS (SELECT count(*)::int AS n FROM hits),
  page AS (
    SELECT h.* FROM hits h, args
     -- Money first (the reader's ordering question is "who here got the most"), then name so
     -- the long tail is not in registration-number order, then uic to close the sort — the
     -- byte-determinism rule 133's ranking indexes carry.
     ORDER BY h.money_eur DESC, h.name, h.uic
     OFFSET (SELECT (pg - 1) * sz FROM args) LIMIT (SELECT sz FROM args)
  )
  SELECT jsonb_build_object(
    'count',      (SELECT n FROM total),
    -- DISTINCT people across the whole place, not just this page — the heading says "N people"
    -- and a per-page count would change as the reader paged.
    --
    -- ⚠️ DEDUPE BEFORE JOINING `person`, not after. The natural spelling joins person inside
    -- the role scan and then counts DISTINCT, which probes person_pkey once per ROLE: measured
    -- on Sofia, 7,336 probes and 29,346 of the call's buffers, for ~1,900 distinct people. The
    -- inner DISTINCT collapses the probe count to the answer's size before a single heap fetch.
    'personCount', (
      SELECT count(*)::int
        FROM (SELECT DISTINCT r.person_id
                FROM hits h
                JOIN person_role r ON r.ref = h.uic AND r.source IN ('tr','ngo')
                 AND r.confidence IN ('exact_id','high','manual')) x
        JOIN person pe ON pe.person_id = x.person_id
         AND pe.status = 'active' AND pe.is_public_figure),
    'page',       (SELECT pg FROM args),
    'pageSize',   (SELECT sz FROM args),
    'totalPages', (SELECT GREATEST(1, (n + sz - 1) / sz) FROM total, args),
    'companies', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'uic',       pgc.uic,
        'name',      pgc.name,
        'legalForm', c.legal_form,
        'status',    c.status,
        'moneyEur',  ROUND(pgc.money_eur)::double precision,
        -- The people, with their SLUGS. The shards linked /mp/:id off a name match; these are
        -- resolved person rows, so the row can link /person/:slug and the reader lands on the
        -- profile whose own company list contains this company (150's invariant).
        -- `role` rides along because the page it replaces states each person's CAPACITY
        -- ("управител", "съдружник"), and a name printed beside a company with no stated
        -- capacity is a weaker and vaguer claim than the shard made. Aggregated per person
        -- so two roles at one company read as one line, not two people.
        -- ONE ENTRY PER PERSON with their roles collected, not one per (person, role).
        -- `jsonb_agg(DISTINCT …)` over the triple looked right and was not: 53.1% of
        -- (company, person) pairs here hold more than one role, so it emitted the same human
        -- twice and any client dedupe by slug then SILENTLY DROPPED a capacity. Grouping in
        -- SQL is the only place that can keep both.
        'people', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
                   'slug', p2.slug, 'name', p2.display_name, 'roles', p2.roles)
                 ORDER BY p2.display_name, p2.slug)
            FROM (SELECT pe.slug, pe.display_name,
                         jsonb_agg(DISTINCT r.role ORDER BY r.role) AS roles
                    FROM person_role r
                    JOIN person pe ON pe.person_id = r.person_id
                   WHERE r.ref = pgc.uic AND r.source IN ('tr','ngo')
                     AND r.confidence IN ('exact_id','high','manual')
                     AND pe.status = 'active' AND pe.is_public_figure
                   GROUP BY pe.slug, pe.display_name) p2), '[]'::jsonb)
      ) ORDER BY pgc.money_eur DESC, pgc.name, pgc.uic)
      FROM page pgc
      LEFT JOIN tr_companies c ON c.uic = pgc.uic), '[]'::jsonb)
  );
$$;

COMMENT ON FUNCTION place_mp_companies(text, text, int, int) IS
  'Companies at a place held by a public figure, from the gated person layer. Wider and '
  'person-linked, unlike the retired companies-by-{ekatte,obshtina} name-match shards.';

-- Role-guarded — see 150's note. roles_readonly.sql is a one-time manual step on Cloud SQL,
-- and exec() sends a migration as one transaction, so a bare GRANT would roll the whole file
-- back on a database that never ran it.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION place_mp_companies(text, text, int, int) TO app_readonly;
  END IF;
END $$;
