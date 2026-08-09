-- The /funds hub's ONE stat call. Plan: docs/plans/funds-hub-v1.md §4.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- A FUNCTION, NOT A JSON ARTIFACT — a deliberate departure from the plan's own §4, which said
-- `data/funds/derived/hub_stats.json`. Two repo conventions outrank it:
--
--   * `feedback_no_json_from_pg` — PG is for live serving and queryable tables, not for
--     generating committed JSON.
--   * `reference_funds_pg_only` — every /funds page already reads PG through /api/db; the
--     static funds tree is retired as a serving surface. A JSON blob would be a SECOND
--     serving surface for the same numbers.
--
-- And the hazard is documented rather than hypothetical: CLAUDE.md's note on
-- `data/procurement/derived/hub_stats.json` records that a committed-but-PG-derived artifact
-- went stale in the repo for two months while still serving 200s, because nothing regenerated
-- it when the corpus reloaded. A function cannot have that failure mode.
--
-- The skill's anti-drift rule survives the swap. It asks that a hub's numbers come from the
-- same source as its sub-pages' so they cannot disagree; here that means ONE SQL definition
-- that the route and the gates both read, which is what this file is.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- WHY EVERY FIGURE NAMES ITS BASIS IN ITS KEY. `absorptionPctOfGrant`, not `absorptionPct`.
-- The plan's §4.2 measured six live basis forks in this corpus, each of which is a different
-- true sentence — absorption is 53.8% on grant and 41.1% on contracted, 12.7 points apart. A
-- key called `absorptionPct` invites the consumer to pick a denominator by accident, which is
-- precisely how six of six figures came out wrong on the parliament hub. The key IS the
-- declaration.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- MATERIALISED, AND THE MEASUREMENT IS WHY. The first draft of this file was a plain STABLE
-- function over fund_projects. Measured with EXPLAIN (ANALYZE, BUFFERS) on the real corpus:
--
--     Buffers: shared hit=6621 read=12234, temp read=1202 written=1205
--
-- 18,855 buffers and a spill to disk, on a call every single /funds view would make — against
-- the dashboard-hub skill's ~2,000-buffer ceiling for anything served live, on a prod
-- db-g1-small. Nine times over.
--
-- So the aggregate lives in a one-row matview and the served function is a seek on it. This is
-- the same reason `fund_fit` (143) is materialised rather than computed per request, and the
-- cost is the usual one: the numbers move when the matview is REFRESHed, which the funds
-- loader does at the end of its run. Nothing else refreshes it, and a stale matview serves
-- the previous vintage at a 200 — the standard hazard, recorded here rather than discovered.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- WHERE THIS FILE MAY BE APPLIED FROM, and it is not where it started.
--
-- `CREATE MATERIALIZED VIEW` RESOLVES ITS QUERY at creation — `check_function_bodies = off`
-- does not help — so every dependency must already exist. This file needs `canon_oblast` (143)
-- and `interreg_operations`/`interreg_partners` (137), and `db:refresh` orders them:
--
--     step 10  db:load:funds:pg        ← the first draft applied 145 here
--     step 11  db:load:funds-fit:pg    ← 143 lands here, so canon_oblast appears
--     step 52  db:load:interreg:pg     ← 137 lands here
--
-- Applied at step 10 on a cold database it fails with `function canon_oblast(text) does not
-- exist`, rolls the whole file back, and kills a 57-step `db:refresh` at step 10. So the
-- applier is `load_funds_fit_pg.ts` (after 143), guarded on the Interreg tables existing.
--
-- THE INTERREG DEPENDENCY IS A CYCLE, stated rather than hidden — the same shape CLAUDE.md
-- documents for graph → tr-company-place → interreg. 145 reads Interreg (step 52) but its
-- primary input is the funds corpus (step 10/11), so it is refreshed from BOTH ends:
-- `db:load:funds-fit:pg` and `db:load:interreg:pg`. Consequence, said plainly: on a FIRST-EVER
-- run the funds-fit attempt skips (no Interreg tables yet) and the step-52 refresh is what
-- first populates it; on later runs funds-fit refreshes with the PREVIOUS Interreg vintage and
-- step 52 corrects it. After any complete `db:refresh` the numbers are current.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- Depends on fund_projects (016), interreg_operations/interreg_partners (137) and
-- canon_oblast (143). EXECUTE → app_readonly, role-guarded for a cold bootstrap.

SET check_function_bodies = off;

DROP FUNCTION IF EXISTS funds_hub_stats();

-- DROP + CREATE, exactly as its sibling 143 does — NOT `IF NOT EXISTS`.
--
-- The first draft used IF NOT EXISTS, reasoning that it would avoid blanking a populated cache.
-- Measured: on an existing matview Postgres emits `NOTICE: relation "funds_hub_stats_cache"
-- already exists, skipping` and returns CREATE MATERIALIZED VIEW — so `apply_functions.ts`
-- prints „applied 145_funds_hub_stats.sql" while changing NOTHING. The documented escape hatch
-- for a body fix was a no-op that reported success, which is worse than blanking: the operator
-- believes the fix shipped.
--
-- WITH NO DATA, so applying the file is instant and cannot be mistaken for a refresh. The
-- loader REFRESHes immediately after, and until it does the route's 55000 arm degrades to null
-- and the hub renders tiles without figures — the honest state, and the same posture 143 takes.
DROP MATERIALIZED VIEW IF EXISTS funds_hub_stats_cache CASCADE;

CREATE MATERIALIZED VIEW funds_hub_stats_cache AS
  WITH isun AS (
    SELECT
      count(*)                                        AS contract_count,
      -- 47,599, NOT the 46,174 that `DISTINCT beneficiary_eik` gives: 7,240 rows carry no EIK
      -- and collapse onto 1,425 further organisations. Measured; the gate asserts both.
      count(DISTINCT COALESCE(beneficiary_eik, 'n:' || beneficiary_name)) AS beneficiary_count,
      count(DISTINCT beneficiary_eik)                 AS beneficiary_count_eik_only,
      count(DISTINCT program_code)                    AS programme_count,
      sum(total_eur)                                  AS contracted_eur,
      sum(grant_eur)                                  AS grant_eur,
      sum(paid_eur)                                   AS paid_eur,
      -- THE PLACE COVERAGE, as MONEY. 3,779 of 82,011 rows (4.6%) carry no oblast and they
      -- hold 50.05% of the money — national-scope programmes with no single oblast to sit in.
      -- Row coverage here is true and misleading; this is the figure a place surface must
      -- declare. See the plan's §4.2 note.
      sum(total_eur) FILTER (WHERE oblast IS NOT NULL) AS placed_contracted_eur,
      count(DISTINCT canon_oblast(oblast)) FILTER (WHERE oblast IS NOT NULL) AS oblast_count,
      count(DISTINCT ekatte) FILTER (WHERE ekatte IS NOT NULL) AS settlement_count
    FROM fund_projects
  ), rrf AS (
    SELECT sum(total_eur) AS contracted_eur, sum(grant_eur) AS grant_eur,
           sum(paid_eur) AS paid_eur, count(*) AS contract_count
      FROM fund_projects WHERE program_code LIKE '2021BG-RRP%'
  ), interreg AS (
    SELECT
      (SELECT count(*) FROM interreg_operations) AS operation_count,
      -- OPERATIONS WITH A BULGARIAN PARTNER — 1,115 of the 1,954 in the corpus. The two are
      -- different questions and a surface about Bulgarian participation wants this one; the
      -- /funds/interreg page rendered 1,954 directly above a tile showing 1,115, both labelled
      -- „Operations" in English.
      count(DISTINCT keep_id) AS bg_operation_count,
      -- ROWS and ORGS both, because they differ by 52% (1,493 vs 983): an organisation
      -- partnering on five operations is five rows. Publishing one as the other over-counts
      -- the partner base by half.
      count(*)                                                     AS partner_row_count,
      count(DISTINCT COALESCE(eik, 'n:' || partner_name))           AS partner_org_count,
      sum(budget_eur)                                              AS bg_budget_eur
    -- BOTH clauses, the canonical form 137's header names and 127/138/139/143 all use.
    -- Measured identical on today's corpus, so this is latent rather than live — but a
    -- one-clause copy is how the two drift the first time a partner is filed with only a
    -- country_department.
    FROM interreg_partners
    WHERE country = 'Bulgaria' OR country_department = 'Bulgaria'
  )
  -- `k` exists ONLY to carry the unique index. See the note on it below: an expression index
  -- does not qualify a matview for REFRESH … CONCURRENTLY, so a constant column is the cheapest
  -- thing that does.
  SELECT 1 AS k, jsonb_build_object(
    'isun', jsonb_build_object(
      'contractCount',            i.contract_count,
      'beneficiaryCount',         i.beneficiary_count,
      'beneficiaryCountEikOnly',  i.beneficiary_count_eik_only,
      'programmeCount',           i.programme_count,
      'contractedEur',            round(i.contracted_eur::numeric, 2),
      'grantEur',                 round(i.grant_eur::numeric, 2),
      'paidEur',                  round(i.paid_eur::numeric, 2),
      -- Both denominators, both named. A consumer that wants „усвояване" takes the grant one;
      -- one that wants „изплатено от договореното" takes the other. Neither is `absorptionPct`.
      'absorptionPctOfGrant',     round((100 * i.paid_eur / nullif(i.grant_eur, 0))::numeric, 1),
      'absorptionPctOfContracted', round((100 * i.paid_eur / nullif(i.contracted_eur, 0))::numeric, 1),
      'placedContractedEur',      round(i.placed_contracted_eur::numeric, 2),
      -- The share of the MONEY a place surface can map. ~50%.
      'placedMoneyPct',           round((100 * i.placed_contracted_eur / nullif(i.contracted_eur, 0))::numeric, 1),
      'oblastCount',              i.oblast_count,
      'settlementCount',          i.settlement_count
    ),
    'rrf', jsonb_build_object(
      'contractCount',            r.contract_count,
      'contractedEur',            round(r.contracted_eur::numeric, 2),
      'absorptionPctOfGrant',     round((100 * r.paid_eur / nullif(r.grant_eur, 0))::numeric, 1)
    ),
    -- A SEPARATE OBJECT, never folded into `isun`. fund_projects holds zero Interreg rows (a
    -- system boundary — Interreg runs on Jems), and the money is not the same quantity either:
    -- ИСУН publishes a contract value, this is a partner's published budget. Two arms, so a
    -- consumer cannot sum them into one unlabelled total by reaching for a shared key.
    'interreg', jsonb_build_object(
      'operationCount',           n.operation_count,
      'bgOperationCount',         n.bg_operation_count,
      'bgPartnerRowCount',        n.partner_row_count,
      'bgPartnerOrgCount',        n.partner_org_count,
      'bgBudgetEur',              round(n.bg_budget_eur::numeric, 2)
    )
  ) AS payload
  FROM isun i, rrf r, interreg n;

-- ON A PLAIN COLUMN (`k`), NOT an expression. This is the whole reason `k` exists.
--
-- The first draft indexed `((1))`. Postgres accepts that index and then refuses the refresh:
--   ERROR: cannot refresh materialized view "public.funds_hub_stats_cache" concurrently
--   HINT:  Create a unique index with no WHERE clause on one or more COLUMNS of the
--          materialized view.
-- Permanently, on every call — and the loader caught 55000 and fell back to the locking
-- REFRESH, i.e. precisely the lock this index was added to avoid, while the comment claimed
-- otherwise. It was the only expression unique index on any matview in the database.
CREATE UNIQUE INDEX IF NOT EXISTS ux_funds_hub_stats_cache
  ON funds_hub_stats_cache (k);

-- The served reader. A seek on one row — measured below 20 buffers, against the 18,855 the
-- live aggregate cost.
CREATE OR REPLACE FUNCTION funds_hub_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT payload FROM funds_hub_stats_cache LIMIT 1;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION funds_hub_stats() TO app_readonly;
  END IF;
END $$;
