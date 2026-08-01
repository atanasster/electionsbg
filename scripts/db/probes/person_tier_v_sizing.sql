-- S0 sizing probe for the people/connections consolidation (Phase 1).
-- Sizes the Tier-V (money-linked private owner) materialization: how many folded owner
-- names would S4 mint as real persons, how many stay name-fold, how many are already a person.
--
-- Run: PGPASSWORD=postgres psql -h 127.0.0.1 -p 5433 -U postgres -d electionsbg \
--        -f scripts/db/probes/person_tier_v_sizing.sql
--
-- "money-linked" uses the BROAD basis (contracts ∪ agri_subsidies ∪ fund_beneficiaries) —
-- the locked tier-boundary definition.
-- "verified" mirrors the S4 mint guard, which itself reuses Bridge B's classification:
-- name_parts = 3 (EXACTLY 3 tokens — translit_bg_latin folds hyphens/dashes to spaces first)
-- AND ≤5 distinct firms. `parts = 3` (not `>= 3`) is deliberate: it matches Bridge B's
-- `name_parts = 3` (resolve_persons.ts) so this count is an honest S4 mint ceiling, not an
-- inflated one that also captures 4+-token names.
-- The `name_fold NOT IN person` anti-join is S4's own mint guard (skip a fold already resolved
-- to a person), NOT part of Bridge B. See docs/plans/people-connections-phase1-impl-v1.md §S0.

WITH money_eik AS (
  SELECT contractor_eik AS eik FROM contracts WHERE contractor_eik <> ''
  UNION SELECT eik FROM agri_subsidies WHERE eik IS NOT NULL
  UNION SELECT eik FROM fund_beneficiaries WHERE eik IS NOT NULL
),
owner_folds AS (
  SELECT o.name_fold,
         count(DISTINCT o.uic)                                            AS firms,
         array_length(regexp_split_to_array(btrim(o.name_fold), '\s+'), 1) AS parts,
         bool_or(m.eik IS NOT NULL)                                        AS money_linked
  FROM tr_officers o
  LEFT JOIN money_eik m ON m.eik = o.uic
  GROUP BY o.name_fold
)
SELECT
  -- full частен-сектор browse V set (S3 name-fold arm): every money-linked fold not already a person
  count(*) FILTER (WHERE money_linked)                                     AS money_linked_folds,
  count(*) FILTER (WHERE money_linked
                        AND name_fold NOT IN (SELECT name_fold FROM person
                                               WHERE name_fold IS NOT NULL)) AS namefold_browse_v,
  -- verified subset (S4 mint): EXACTLY 3 tokens, ≤5 firms
  count(*) FILTER (WHERE money_linked AND parts = 3 AND firms <= 5)        AS verified_candidates,
  count(*) FILTER (WHERE money_linked AND parts = 3 AND firms <= 5
                        AND name_fold NOT IN (SELECT name_fold FROM person
                                               WHERE name_fold IS NOT NULL)) AS verified_after_antijoin
FROM owner_folds;
