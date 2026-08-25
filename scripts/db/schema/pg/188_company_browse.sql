-- 188_company_browse.sql — the general company registry browse behind /companies.
--
-- One row per tr_companies.uic — the FULL Commerce Registry corpus (~1.02M rows as of
-- 2026-08), not a subset. Supersedes official_companies (178): "linked to a person in
-- public life" becomes ONE boolean column here (is_official_linked) instead of the whole
-- population of a separate matview and a separate page. See the DROP below and
-- docs/plans/company-browse-dashboard-v1.md.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- `has_signal` IS A DEFAULT-VIEW FLOOR, NOT A POPULATION CUT.
--
-- Every one of the ~1.02M companies gets a row here, so an exact name or EIK search always
-- finds a match — the whole point of widening past 178's officials-linked-only population.
-- What narrows is the DEFAULT filter the client applies: the `companies` resource in
-- db_table.js sets `defaultFilters: [{col:"has_signal", val:true}]`, the same shape
-- person_browse_table's `tier='P'` floor uses (120) — overridable client-side (a `?scope=all`
-- control), never baked into which rows exist in the matview itself.
--
--   has_signal := public money > 0 OR linked to a public figure OR won a contract OR is an NGO.
--
-- A company with none of those is still IN this table with has_signal=false — it just does
-- not surface in the unfiltered default listing or count toward the default aggregate.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- WHY THE MONEY COMES THROUGH A plpgsql WRAPPER AND NOT A DIRECT READ — same escape 178 used.
--
-- company_public_money (127) is DROPped and rebuilt by db:load:graph:pg — a DIFFERENT loader
-- from the ones that apply this file. A direct matview read of it (or a LANGUAGE sql / PG14+
-- BEGIN ATOMIC wrapper — both PARSED at CREATE) records a real pg_depend edge, so every graph
-- reload would CASCADE company_browse_table out of existence and exit 0: nothing in the
-- output, no row count moving, /companies empty at a 200 until the next declarations resolve
-- happened to run. A plpgsql body is opaque to the dependency parser and records no edge.
-- migration_drop_dependents.data.test.ts fails if this goes back to a direct read.
--
-- Redefined here rather than left solely in 178: 178 is tombstoned (its matview DROPped, its
-- own copy of this function kept — see that file's header for why) and this file no longer
-- has a guaranteed apply-order relationship to 178 on every database. Whichever of the two
-- applies last wins; the body is identical either way, so that is harmless.
CREATE OR REPLACE FUNCTION company_public_money_rows()
RETURNS TABLE (eik text, public_money_eur double precision)
LANGUAGE plpgsql STABLE PARALLEL SAFE ROWS 1100000 AS $fn$
BEGIN
  RETURN QUERY SELECT m.eik, m.public_money_eur FROM company_public_money m;
END
$fn$;

-- Same escape, same reason, for a SECOND matview this file reads: contractor_rank (122) is
-- DROPped and recreated by db:load:pg (the contracts loader) — again a DIFFERENT loader from
-- the ones that apply this file. Measured before this wrapper existed:
-- migration_drop_dependents.data.test.ts caught `122_contractor_rank.sql DROPs contractor_rank,
-- which company_browse_table reads` as a live offence — a direct read would let every
-- contracts publish CASCADE company_browse_table out of existence and exit 0.
CREATE OR REPLACE FUNCTION contractor_rank_all_rows()
RETURNS TABLE (
  eik text,
  contractor_total_eur double precision,
  contract_count integer,
  award_count integer,
  is_mp_tied boolean
)
LANGUAGE plpgsql STABLE PARALLEL SAFE ROWS 30000 AS $fn$
BEGIN
  RETURN QUERY
    SELECT r.eik, r.total_eur, r.contract_count, r.award_count, r.is_mp_tied
      FROM contractor_rank r
     WHERE r.scope_key = 'all' AND r.division = 'ALL';
END
$fn$;

-- Retires 178's matview. No CASCADE: nothing reads official_companies in a stored SQL query
-- (only functions/db_table.js's JS-side registry did) — confirmed by grep before writing
-- this file. 178 itself carries the same DROP as a tombstone for a database that applies
-- 178 without ever reaching this file; this DROP is what actually matters going forward,
-- since 188 (not 178) is now in the routine loader chain.
DROP MATERIALIZED VIEW IF EXISTS official_companies;

DROP MATERIALIZED VIEW IF EXISTS company_browse_table;
CREATE MATERIALIZED VIEW company_browse_table AS
WITH linked AS (
  -- The registry arm — same CTE 178 used, unchanged: person_role at source tr/ngo, bridged
  -- through Bridge A/B, refused on an unmeasured or multi-person name fold (148's
  -- tr_name_fold_people gate). NOT restricted to a subset of companies — every
  -- tr_person_roles row participates; the LEFT JOIN at the bottom of this query is what
  -- keeps a company with no such row in the table at all, at has_registry_link=false.
  SELECT ptr.ref AS uic,
         pe.person_id,
         -- Whether ANY of this person's roles at this company is still open (a withdrawn
         -- filing is not a present-tense fact — see has_current_role below).
         bool_or(t.erased_at IS NULL) AS any_current
    FROM person_role ptr
    JOIN person pe
      ON pe.person_id = ptr.person_id
     AND pe.status = 'active'
     AND pe.is_public_figure
    JOIN tr_person_roles t
      ON t.uic = ptr.ref AND t.name_fold = pe.name_fold
    LEFT JOIN tr_name_fold_people f ON f.name_fold = pe.name_fold
   WHERE ptr.source IN ('tr', 'ngo')
     AND ptr.confidence IN ('exact_id', 'high', 'manual')
     -- NULL = the fold has not been measured. 148's rule is that an UNMEASURED fold is
     -- REFUSED, never admitted — absence of evidence is not evidence of uniqueness.
     AND f.people_n = 1
   GROUP BY 1, 2
),
staked AS (
  -- The declaration arm — 096's gated resolution, same privacy gate.
  SELECT DISTINCT sc.uic, sc.person_id
    FROM declaration_stake_company sc
    JOIN person pe
      ON pe.person_id = sc.person_id
     AND pe.status = 'active'
     AND pe.is_public_figure
),
arms AS (
  SELECT uic, person_id, true AS via_registry, false AS via_stake, any_current FROM linked
  UNION ALL
  SELECT uic, person_id, false, true, NULL::boolean FROM staked
),
political AS (
  SELECT uic,
         -- DISTINCT over the union: a person reached by BOTH arms is one person.
         count(DISTINCT person_id)::int AS person_count,
         bool_or(via_registry) AS has_registry_link,
         bool_or(via_stake) AS has_declared_stake,
         COALESCE(bool_or(via_registry AND any_current), false) AS has_current_role
    FROM arms
   GROUP BY uic
),
contractor AS (
  -- The corpus-wide (all scopes, all CPV divisions) row from contractor_rank (122), via the
  -- plpgsql wrapper above — one row per eik, per that matview's own unique index (scope_key,
  -- division, eik). NOT a per-scope figure: this browse has no ?pscope control, so "won a
  -- contract, ever" is the only question it can answer.
  SELECT * FROM contractor_rank_all_rows()
)
SELECT c.uic,
       c.name,
       c.name_fold,
       c.legal_form,
       c.seat,
       c.status,
       c.entity_class,
       c.funds_amount,
       c.funds_currency,
       p.settlement,
       p.obshtina AS obshtina_code,
       -- NAME, not a code — tr_company_place (133) has no oblast CODE source (see 178's
       -- original note on this same column). Facets/filters this the `?court` way: the
       -- picker and the filter read one NAME column, so the counts are exact and no
       -- code→name dictionary is needed. NULL for the ~68% of the corpus with no resolved
       -- seat — this column may narrow a view and must never define one.
       p.oblast AS oblast_name,
       COALESCE(m.public_money_eur, 0)::double precision AS public_money_eur,
       ctr.contractor_total_eur,
       COALESCE(ctr.contract_count, 0)::int AS contract_count,
       COALESCE(ctr.award_count, 0)::int AS award_count,
       COALESCE(ctr.is_mp_tied, false) AS is_mp_tied,
       COALESCE(pol.person_count, 0)::int AS person_count,
       COALESCE(pol.has_registry_link, false) AS has_registry_link,
       COALESCE(pol.has_declared_stake, false) AS has_declared_stake,
       COALESCE(pol.has_current_role, false) AS has_current_role,
       -- The whole of 178's old population, as one filter target: official_companies used to
       -- BE this set; now it is a `?political=1` toggle on the wider browse.
       COALESCE(pol.has_registry_link OR pol.has_declared_stake, false) AS is_official_linked,
       (
         COALESCE(m.public_money_eur, 0) > 0
         OR COALESCE(pol.has_registry_link, false)
         OR COALESCE(pol.has_declared_stake, false)
         OR COALESCE(ctr.contract_count, 0) > 0
         OR c.entity_class IN ('ngo_assoc', 'ngo_found', 'chitalishte')
       ) AS has_signal
  FROM tr_companies c
  LEFT JOIN tr_company_place p ON p.uic = c.uic
  LEFT JOIN company_public_money_rows() m ON m.eik = c.uic
  LEFT JOIN contractor ctr ON ctr.eik = c.uic
  LEFT JOIN political pol ON pol.uic = c.uic;

CREATE UNIQUE INDEX company_browse_table_pkey ON company_browse_table (uic);

-- The default page: has_signal=true (the client's defaultFilters floor) sorted by money desc,
-- name asc (the client's defaultSort). Lead with has_signal so that page is a single index
-- scan over the ~10-15% signal-bearing slice, not a scan-and-filter over the full ~1.02M —
-- same reasoning idx_person_browse_tier_default (120) documents for `tier`.
--
-- ⚠️ NULLS LAST is load-bearing, not decoration: db_table.js's buildOrder emits
-- `<col> DESC NULLS LAST` for every descending sort, while a plain DESC index is NULLS
-- FIRST — mismatched, the default arrival stops being an index walk and becomes a seq scan
-- plus a top-N heapsort. Gate: scripts/db/tests/db_table_sort_indexes.data.test.ts.
CREATE INDEX idx_company_browse_default
  ON company_browse_table (has_signal, public_money_eur DESC NULLS LAST, name, uic);
-- The `?scope=all` money sort (no has_signal floor) — public_money_eur is 0, not NULL, for
-- every zero-money row (COALESCEd above), so NULLS LAST only matters in principle here, but
-- the index is written to match buildOrder's emitted SQL exactly regardless.
CREATE INDEX idx_company_browse_money
  ON company_browse_table (public_money_eur DESC NULLS LAST, name, uic);
CREATE INDEX idx_company_browse_contractor_total
  ON company_browse_table (contractor_total_eur DESC NULLS LAST, name, uic);
CREATE INDEX idx_company_browse_person_count
  ON company_browse_table (person_count DESC NULLS LAST, name, uic);
CREATE INDEX idx_company_browse_entity_class ON company_browse_table (entity_class);
CREATE INDEX idx_company_browse_status ON company_browse_table (status);
-- Both reachable today via a deep link (?legal_form=/?obshtina_code=) and via the generic
-- /api/db/table surface the AI chat tools use, even though CompaniesBrowseDbScreen's own
-- toolbar does not expose either yet — an unindexed filter on a 1.02M-row matview, paired
-- with ORDER BY public_money_eur and a LIMIT, is a plausible seq-scan under the pool's 10s
-- statement_timeout.
CREATE INDEX idx_company_browse_legal_form ON company_browse_table (legal_form);
CREATE INDEX idx_company_browse_obshtina ON company_browse_table (obshtina_code);
CREATE INDEX idx_company_browse_oblast ON company_browse_table (oblast_name)
  WHERE oblast_name IS NOT NULL;
CREATE INDEX idx_company_browse_political ON company_browse_table (is_official_linked)
  WHERE is_official_linked;
-- Free-text search over both the Cyrillic name and its fold — the pair every other browse
-- resource in this repo indexes. uic itself needs no trigram index: a query shaped like an
-- EIK is routed to an equality lookup on the primary key index instead (searchEq/searchWhen
-- on the `companies` resource, the same mechanism contractor_rank already uses).
CREATE INDEX idx_company_browse_name_trgm
  ON company_browse_table USING gin (name gin_trgm_ops);
CREATE INDEX idx_company_browse_fold_trgm
  ON company_browse_table USING gin (name_fold gin_trgm_ops);

COMMENT ON MATERIALIZED VIEW company_browse_table IS
  'General company registry browse behind /companies — one row per tr_companies.uic, the '
  'full Commerce Registry corpus. has_signal is a default-VIEW floor (money/political-link/'
  'contractor/NGO), never a population cut: every company is in this table. Supersedes '
  'official_companies (178) — is_official_linked carries its old population as one filter.';

-- Role-guarded, per the 117/130 shape: roles_readonly.sql is a one-time manual step on Cloud
-- SQL, and exec() sends a migration as one transaction, so a bare GRANT would roll the whole
-- file back on a database that never ran it.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON company_browse_table TO app_readonly;
  END IF;
END $$;
