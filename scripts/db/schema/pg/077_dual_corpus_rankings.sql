-- Cross-corpus leaderboard: companies that appear in BOTH the procurement
-- (ЗОП/АОП `contracts`) corpus AND the EU-funds (ИСУН `fund_beneficiaries`)
-- corpus — the "фирми с договори и грантове" tile on /funds. One row per EIK,
-- ranked by combined public money (procurement contract EUR + funds contracted
-- EUR). The sell-side analogue of company_procurement × fund_beneficiaries that
-- the /company/:eik page already joins per-entity, lifted to a national list.
--
-- Join is EIK-exact by design (contracts.contractor_eik = fund_beneficiaries.eik
-- = tr_companies.uic — the schemas assert one key namespace). We guard the funds
-- side to a real 9–13-digit EIK shape so empty/synthetic contractor rows can't
-- pollute the intersection. Any leading-zero / 13-digit branch variants that
-- differ across the two corpora simply won't match (clean over complete — no
-- name-matching, no namesake false positives).
--
-- Money basis: procurement = Σ amount_eur FILTER (tag='contract') — the same
-- per-row EUR basis as procurement_rankings (031); funds are EUR-native lifetime
-- totals (NOT date-windowed), so this leaderboard is all-time only (no from/to).
-- Carries the MP-tie badge (mpTied/mpIds from company_politicians) like the two
-- source leaderboards. Depends on contracts (001), fund_beneficiaries (015),
-- company_politicians (008), tr_companies. EXECUTE → app_readonly.

SET check_function_bodies = off;

-- ══════════════════════════════════════════════════════════════════════════════
-- THIS FILE DROPS NOTHING, AND THAT IS LOAD-BEARING. It used to open with
--
--   DROP MATERIALIZED VIEW IF EXISTS dual_corpus_rankings_cache;
--   DROP FUNCTION IF EXISTS dual_corpus_rankings();
--
-- `load_pg.ts` applies this file on EVERY contracts load, and the first line is
-- unconditional and CASCADE-free — so the moment anything else read that cache in a
-- stored query, every `db:load:pg` died with
--
--   ERROR: cannot drop materialized view dual_corpus_rankings_cache because other
--          objects depend on it   (SQLSTATE 2BP01)
--
-- in the APPLY phase, BEFORE the COPY: `contracts` silently kept serving the previous
-- vintage while the ingest that produced the new shards reported success. Migration
-- 145's `funds_hub_stats_cache` did exactly that from 2026-08-09 (900e50dd4b) to
-- 2026-08-10, blocking every procurement publish in that window on prod as well as
-- locally, with nothing red anywhere.
--
-- CASCADE would have been the WRONG fix. `db:refresh` self-heals it (db:load:pg at
-- step 5, db:load:funds-fit:pg recreating the dependent at step 11) — but the
-- documented procurement publish path is a STANDALONE `db:load:pg:cloud`, which
-- would drop the dependent on prod with nothing there to recreate it, blanking the
-- /funds hub tiles until someone noticed.
--
-- Neither DROP was ever needed. The matview is a fixed ONE-COLUMN wrapper over the
-- function (`SELECT dual_corpus_rankings() AS r`), so its shape cannot change — all
-- the logic that evolves lives in the function body, which `CREATE OR REPLACE`
-- rewrites in place. The `DROP FUNCTION` existed only because a matview depends on
-- the function it selects, so it is refused while the cache stands; and the
-- `DROP MATERIALIZED VIEW` existed only to let that `DROP FUNCTION` run. A pair of
-- statements that existed solely to enable each other.
--
-- IF A REAL SHAPE CHANGE IS EVER NEEDED — i.e. `dual_corpus_rankings()` changes its
-- RETURN TYPE, the one edit `CREATE OR REPLACE FUNCTION` refuses — do it as an
-- explicit one-time step, never by restoring the DROPs here:
--   DROP MATERIALIZED VIEW dual_corpus_rankings_cache;   -- then apply this file,
--   -- then `npm run db:load:pg` (or `REFRESH MATERIALIZED VIEW`) to repopulate.
-- That is safe to do by hand because of the second half of the fix: the tail of this
-- file exposes `dual_corpus_company_count()`, and callers read the cache THROUGH it
-- rather than directly, so no stored query pins the matview. `db:refresh`'s
-- dual_corpus_dependents.data.test.ts gates both halves — zero stored-query
-- dependents, and this file applying cleanly where `funds_hub_stats_cache` exists.
-- ══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION dual_corpus_rankings()
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH fund AS (
  -- Funds side: one row per beneficiary EIK, real-EIK shape only.
  SELECT eik, name, org_type, contract_count, contracted_eur, paid_eur
  FROM fund_beneficiaries
  WHERE eik ~ '^[0-9]{9,13}$'
),
ctr AS (
  -- Procurement side, restricted to only the EIKs present on the funds side —
  -- the IN-list rides idx_contracts_contractor_tag_amt so we aggregate the
  -- intersection, not the whole contracts corpus.
  SELECT contractor_eik AS eik, MIN(contractor_name) AS name,
         COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract'), 0) AS eur,
         (COUNT(*) FILTER (WHERE tag = 'contract'))::int AS n
  FROM contracts
  WHERE tag = 'contract'
    AND contractor_eik IN (SELECT eik FROM fund)
  GROUP BY contractor_eik
  HAVING COUNT(*) FILTER (WHERE tag = 'contract') > 0
),
-- Inner join = the intersection: firms that both won ЗОП contracts and drew EU
-- grants. tr_companies gives the canonical legal name; fall back to the two
-- corpus names.
isect AS (
  SELECT c.eik,
         COALESCE(tc.name, f.name, c.name) AS name,
         f.org_type,
         ROUND(c.eur)                                    AS proc_eur,
         c.n                                             AS proc_n,
         ROUND(COALESCE(f.contracted_eur, 0))            AS funds_contracted_eur,
         ROUND(COALESCE(f.paid_eur, 0))                  AS funds_paid_eur,
         COALESCE(f.contract_count, 0)                   AS funds_projects,
         ROUND(c.eur + COALESCE(f.contracted_eur, 0))    AS combined_eur,
         (mp.mp_ids IS NOT NULL)                         AS mp_tied,
         COALESCE(to_jsonb(mp.mp_ids), '[]'::jsonb)      AS mp_ids
  FROM ctr c
  JOIN fund f ON f.eik = c.eik
  LEFT JOIN tr_companies tc ON tc.uic = c.eik
  LEFT JOIN (
    SELECT cp.eik,
           array_agg(DISTINCT NULLIF(regexp_replace(cp.ref, '^/candidate/mp-', ''), '')::int) AS mp_ids
    FROM company_politicians cp
    WHERE cp.kind = 'mp' AND cp.ref LIKE '/candidate/mp-%'
    GROUP BY cp.eik
  ) mp ON mp.eik = c.eik
)
SELECT jsonb_build_object(
  -- Headline aggregates over the full intersection (for the tile's KPI line).
  'companyCount',        (SELECT COUNT(*)::int             FROM isect),
  'combinedEur',         (SELECT COALESCE(SUM(combined_eur), 0)          FROM isect),
  'procurementEur',      (SELECT COALESCE(SUM(proc_eur), 0)             FROM isect),
  'fundsContractedEur',  (SELECT COALESCE(SUM(funds_contracted_eur), 0) FROM isect),
  'fundsPaidEur',        (SELECT COALESCE(SUM(funds_paid_eur), 0)       FROM isect),
  'mpTiedCount',         (SELECT COUNT(*) FILTER (WHERE mp_tied)::int   FROM isect),
  -- Top 1000 by combined public money. Rounded sort key + eik tiebreak so the
  -- LIMIT cut and row order are stable across scan plans (determinism rule).
  'rows', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'eik', eik,
      'name', name,
      'orgType', org_type,
      'procurementEur', proc_eur,
      'procurementCount', proc_n,
      'fundsContractedEur', funds_contracted_eur,
      'fundsPaidEur', funds_paid_eur,
      'fundsProjects', funds_projects,
      'combinedEur', combined_eur,
      'mpTied', mp_tied,
      'mpIds', mp_ids
    ) ORDER BY combined_eur DESC, eik), '[]'::jsonb)
    FROM (SELECT * FROM isect ORDER BY combined_eur DESC, eik LIMIT 1000) x
  )
);
$$;

-- Full-corpus cache. The intersection aggregate is small (~tens of ms once the
-- IN-list restricts the contracts scan) but cached anyway to match the rankings
-- model; created empty here and populated by the loaders' guarded REFRESH (both
-- corpora must be present). The route serves the matview and falls through to
-- the live function when it is empty/absent.
CREATE MATERIALIZED VIEW IF NOT EXISTS dual_corpus_rankings_cache AS
  SELECT dual_corpus_rankings() AS r
  WITH NO DATA;

-- The ONLY supported way for another migration to read this cache IN A STORED QUERY —
-- a view, a matview, or a function body Postgres parses at definition time. See the
-- header block. An AD-HOC query is always fine and needs no wrapper, because it records
-- no dependency: `/api/db/dual-corpus-rankings` (functions/db_routes.js) and
-- funds_hub_stats.data.test.ts both select from the matview directly, legitimately.
--
-- plpgsql bodies are not parsed at creation, so the reference below records no pg_depend
-- edge and the caller (today: `funds_hub_stats_cache`, 145) does not pin the matview.
-- That is what keeps the one-time manual DROP described up there safe to perform, and
-- what stops a restored DROP in this file from being fatal again.
--
-- MEASURED, because the obvious alternative looks equivalent and is not quite: a
-- `LANGUAGE sql` wrapper with a string body ALSO records no edge today — but the
-- SQL-standard `BEGIN ATOMIC` body form (PG14+) parses and DOES record one, so an
-- innocent-looking modernisation of a `LANGUAGE sql` wrapper would silently restore
-- the 2BP01. plpgsql has no such form and cannot regress that way.
--
-- It also DEGRADES, which the direct read it replaces could not. Selecting from an
-- unpopulated matview does not return zero rows — it RAISES 55000
-- (`object_not_in_prerequisite_state`) — and this cache is created WITH NO DATA on a
-- cold database and left that way until a loader's guarded REFRESH. So with the
-- direct read, `db:load:funds-fit:pg` on a database whose contracts corpus had not
-- yet been loaded (or right after the manual DROP above) failed on the refresh.
-- 42P01 is caught for the same reason 145's siblings guard their payload reads: a
-- database with no contracts corpus has no cache at all, and one tile rendering
-- without a figure is the honest state, not an aborted load.
--
-- NEVER `DROP` this function: `funds_hub_stats_cache` depends on it, so a DROP is
-- this bug in mirror image. The signature is deliberately minimal — a count is an
-- int for ever — so `CREATE OR REPLACE` alone will always do.
CREATE OR REPLACE FUNCTION dual_corpus_company_count()
RETURNS int LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN (SELECT (r->>'companyCount')::int FROM dual_corpus_rankings_cache);
EXCEPTION
  WHEN undefined_table OR object_not_in_prerequisite_state THEN RETURN NULL;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION dual_corpus_company_count() TO app_readonly;
  END IF;
END $$;
