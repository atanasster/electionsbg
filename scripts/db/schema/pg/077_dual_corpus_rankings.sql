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

-- Drop the dependent cache matview first (re-apply path); recreated WITH NO DATA
-- at tail and populated by the loaders' guarded REFRESH.
DROP MATERIALIZED VIEW IF EXISTS dual_corpus_rankings_cache;
DROP FUNCTION IF EXISTS dual_corpus_rankings();
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
