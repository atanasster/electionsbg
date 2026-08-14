-- 156 — the /budget hub's ONE stat call.
--
-- Plan: docs/plans/budget-hub-v1.md §6.3 and T4. Applied and refreshed by
-- scripts/db/load_budget_hub_pg.ts.
--
-- ── WHY A MATVIEW ─────────────────────────────────────────────────────────
--
-- This runs on EVERY /budget view and spans five tables. Measured against the
-- live aggregate on the worst fiscal year before materialising: see the loader,
-- which prints the figure it achieved.
--
-- ── THREE RULES FROM 145's REVIEW, EACH OF WHICH SHIPPED BROKEN THERE ─────
--
-- 1. The unique index is on a PLAIN COLUMN, not an expression. An expression
--    index does not qualify a matview for REFRESH … CONCURRENTLY, so the
--    loader's 55000 catch would silently take the locking path for ever.
-- 2. `CREATE MATERIALIZED VIEW`, never `IF NOT EXISTS` — with IF NOT EXISTS,
--    apply_functions.ts prints "applied" while changing nothing, so the
--    documented escape hatch for a body fix is a no-op that reports success.
--    The DROP below is what makes the CREATE meaningful, and it is safe here
--    for the reason 077's is not: nothing else reads this matview in a stored
--    query. If something ever does, this file must stop dropping it.
-- 3. EVERY KEY NAMES ITS BASIS. `expenditureExecutedEur`, never
--    `expenditureEur`. The plan's §2.1 lists five questions with more than one
--    true answer; a key that omits the basis invites a consumer to pick one by
--    accident, which is the defect class this whole pillar keeps producing.

-- ── The EU peer bands ─────────────────────────────────────────────────────
--
-- Three scalars that currently cost the hub 794 KB — 66% of its eager payload —
-- because they are read out of macro_peers.json, which the page fetches whole.
-- macro_peers.json is untouched for /indicators/compare, which reads the entire
-- distribution legitimately; this table exists so /budget can stop.
CREATE TABLE IF NOT EXISTS budget_peer_band (
  -- The Eurostat gov_10a_main na_item: TR (revenue), TE (expenditure),
  -- B9 (net lending/borrowing).
  na_item        text PRIMARY KEY,
  year           int  NOT NULL,
  bg_pct_gdp     double precision,
  eu_avg_pct_gdp double precision,
  rank           int,
  total          int
);

COMMENT ON TABLE budget_peer_band IS
  'The three EU peer bands /budget renders beside its headline cards. A % of GDP on the '
  'EUROSTAT basis (general government, ESA), which is NOT the МФ КФП state-budget basis the '
  'cards themselves use — the chip compares Bulgaria to the EU, never to the card beside it.';

DROP MATERIALIZED VIEW IF EXISTS budget_hub_stats_cache;

CREATE MATERIALIZED VIEW budget_hub_stats_cache AS
SELECT
  y.fiscal_year,
  y.as_of,
  y.complete,
  y.months_available,
  y.gdp_eur,
  -- Money, each key naming its basis. NULL where the corpus withholds rather
  -- than reports zero.
  max(f.amount_eur) FILTER (WHERE f.series = 'revenue'        AND f.basis = 'actual')    AS revenue_executed_eur,
  max(f.amount_eur) FILTER (WHERE f.series = 'revenue'        AND f.basis = 'projected') AS revenue_projected_eur,
  max(f.amount_eur) FILTER (WHERE f.series = 'expenditure'    AND f.basis = 'actual')    AS expenditure_executed_eur,
  max(f.amount_eur) FILTER (WHERE f.series = 'expenditure'    AND f.basis = 'projected') AS expenditure_projected_eur,
  max(f.amount_eur) FILTER (WHERE f.series = 'euContribution' AND f.basis = 'actual')    AS eu_contribution_executed_eur,
  max(f.amount_eur) FILTER (WHERE f.series = 'balance'        AND f.basis = 'actual')    AS balance_executed_eur,
  max(f.amount_eur) FILTER (WHERE f.series = 'balance'        AND f.basis = 'projected') AS balance_projected_eur,
  -- Counts. `spending_unit_count` is DISTINCT nodes, never rows: by-admin rows
  -- are (nodeId × kind) and a row count read as a number of ministries
  -- over-states by 1.8x-2.9x.
  (SELECT count(DISTINCT node_id) FROM budget_admin_fact a
    WHERE a.fiscal_year = y.fiscal_year)                        AS spending_unit_count,
  (SELECT count(DISTINCT node_id) FROM budget_admin_fact a
    WHERE a.fiscal_year = y.fiscal_year AND a.executed_eur IS NOT NULL)
                                                                AS variance_covered_units,
  (SELECT count(*) FROM budget_program_fact p
    WHERE p.fiscal_year = y.fiscal_year)                        AS program_count,
  -- ALL YEARS, and the key says so. Documents span the corpus and one (the
  -- kfp-feed record) belongs to no fiscal year at all, so a year-scoped count
  -- would be a different and less useful number — but an unnamed one sitting in
  -- a per-year row reads as „this year's documents".
  (SELECT count(*) FROM budget_document)                        AS document_count_all_years,
  (SELECT count(DISTINCT obs_category) FROM budget_document
    WHERE obs_category IS NOT NULL)                             AS obs_categories_present,
  -- The municipal band. From what the state SENDS — never municipal_fiscal.
  (SELECT sum(total_eur) FROM budget_muni_transfer m
    WHERE m.fiscal_year = y.fiscal_year)                        AS muni_transfer_planned_eur,
  -- YEAR-SCOPED, like the transfer total beside them. Unscoped, FY2026
  -- published 3,492 ИПОП projects (every one of them 2025) and 26 capital
  -- municipalities where that year has 1 — a corpus total on a scoped row,
  -- which is the first trap the dashboard-hub skill lists.
  (SELECT count(*) FROM budget_muni_ipop_project i
    WHERE i.fiscal_year = y.fiscal_year)                        AS ipop_project_count,
  (SELECT count(*) FROM budget_muni_ipop_project i
    WHERE i.fiscal_year = y.fiscal_year AND i.stalled)          AS ipop_stalled_count,
  (SELECT count(DISTINCT obshtina) FROM budget_muni_capital_project cp
    WHERE cp.fiscal_year = y.fiscal_year)                       AS capital_municipality_count,
  -- The newest year each partial corpus actually covers, so a tile showing zero
  -- can say „ИПОП е за 2025" instead of implying the programme stopped.
  (SELECT max(fiscal_year) FROM budget_muni_ipop_project)       AS ipop_latest_year,
  (SELECT max(fiscal_year) FROM budget_muni_capital_project)    AS capital_latest_year,
  -- The wire.
  (SELECT max(period) FROM budget_kfp_observation)              AS latest_kfp_period,
  (SELECT max(published_on) FROM budget_document)               AS latest_document_on
FROM budget_fiscal_year y
LEFT JOIN budget_fiscal_year_figure f ON f.fiscal_year = y.fiscal_year
GROUP BY y.fiscal_year, y.as_of, y.complete, y.months_available, y.gdp_eur;

-- A PLAIN COLUMN, so REFRESH … CONCURRENTLY can actually succeed.
CREATE UNIQUE INDEX IF NOT EXISTS ux_budget_hub_stats_cache_fy
  ON budget_hub_stats_cache (fiscal_year);

-- ── The serving function ──────────────────────────────────────────────────
--
-- The same two-tier pick as budget_year_summary: prefer the newest year that
-- HAS a headline figure, then fall back to the newest of any kind, because МФ
-- freezes a column from time to time and a NULL then reads as „nothing
-- collected".
CREATE OR REPLACE FUNCTION budget_hub_stats(
  p_fy int DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH pick AS (
    SELECT * FROM (
      SELECT c.*, 1 AS tier FROM budget_hub_stats_cache c
       WHERE (p_fy IS NULL OR c.fiscal_year = p_fy)
         AND c.revenue_executed_eur IS NOT NULL
      UNION ALL
      SELECT c.*, 2 FROM budget_hub_stats_cache c
       WHERE (p_fy IS NULL OR c.fiscal_year = p_fy)
    ) t ORDER BY tier, fiscal_year DESC LIMIT 1
  )
  SELECT to_jsonb(row) FROM (
    SELECT p.fiscal_year                  AS "fiscalYear",
           p.as_of                        AS "asOf",
           p.complete,
           -- Captured observations, NOT coverage. FY2021 is 6 with complete =
           -- true, because the КФП feed is cumulative and its December row is
           -- the whole year.
           p.months_available             AS "monthsAvailable",
           p.gdp_eur                      AS "gdpEur",
           p.revenue_executed_eur         AS "revenueExecutedEur",
           p.revenue_projected_eur        AS "revenueProjectedEur",
           p.expenditure_executed_eur     AS "expenditureExecutedEur",
           p.expenditure_projected_eur    AS "expenditureProjectedEur",
           p.eu_contribution_executed_eur AS "euContributionExecutedEur",
           p.balance_executed_eur         AS "balanceExecutedEur",
           p.balance_projected_eur        AS "balanceProjectedEur",
           p.spending_unit_count          AS "spendingUnitCount",
           -- Always beside its denominator. A ranking without this asserts it
           -- ranks the government's ministries; measured, it covers 8 of 48 in
           -- the best year and none in six of nine.
           p.variance_covered_units       AS "varianceCoveredUnits",
           p.program_count                AS "programCount",
           p.document_count_all_years     AS "documentCountAllYears",
           p.obs_categories_present       AS "obsCategoriesPresent",
           -- The LAW's envelope, not money paid out — чл. 53 is an
           -- appropriation. „Planned" is the fork this key has to name.
           p.muni_transfer_planned_eur    AS "muniTransferPlannedEur",
           -- ⚠️ From the ИПОП corpus's OWN latest row, NOT from `pick`. The
           -- cache is keyed per fiscal year and its per-year rows are correct
           -- (a 2026 row holds 2026's zero); the TILE, though, fronts a page
           -- that shows the whole 2025 return, and a tile reading „0 обекта"
           -- over a destination showing 3 492 is the „destination counts a
           -- different set" trap. `ipopLatestYear` ships so the caption can
           -- name the year, and `budget_muni_ipop()` is scoped the same way so
           -- the two can never diverge.
           (SELECT c.ipop_project_count FROM budget_hub_stats_cache c
             WHERE c.fiscal_year = p.ipop_latest_year) AS "ipopProjectCount",
           (SELECT c.ipop_stalled_count FROM budget_hub_stats_cache c
             WHERE c.fiscal_year = p.ipop_latest_year) AS "ipopStalledCount",
           p.ipop_latest_year             AS "ipopLatestYear",
           p.capital_municipality_count   AS "capitalMunicipalityCount",
           p.capital_latest_year          AS "capitalLatestYear",
           p.latest_kfp_period            AS "latestKfpPeriod",
           p.latest_document_on           AS "latestDocumentOn",
           -- The wire's source discriminator. СЕБРА (individual budget payments
           -- ≥ BGN 5,000) is the intended second arm — plan §3.2 — and it lands
           -- as a union member keyed on this, not as a rewrite.
           'kfp'                          AS "wireSource",
           (SELECT array_agg(fiscal_year ORDER BY fiscal_year)
              FROM budget_hub_stats_cache) AS "yearsAvailable",
           -- COFOG'"'"'s OWN coverage, which is NOT `yearsAvailable`. Eurostat'"'"'s
           -- gov_10a_exp runs 2010-2024 while the КФП feed reaches 2026, so a
           -- consumer that offers the module'"'"'s year list on /budget/functional
           -- opens on a year with no breakdown at all and reads as „nothing was
           -- spent on anything". Excludes the TOTAL row'"'"'s year only if that year
           -- has nothing else, which cannot happen — TOTAL rides with the ten.
           (SELECT array_agg(DISTINCT fiscal_year ORDER BY fiscal_year)
              FROM budget_cofog)          AS "cofogYears",
           -- The чл. 53 transfer table's OWN coverage: 2018-2026, against the
           -- КФП feed's 2021-2026. A picker built from `yearsAvailable` omits
           -- three years the corpus HAS, and leaves ?fy=2018 rendering
           -- correctly with no chip selected.
           (SELECT array_agg(DISTINCT fiscal_year ORDER BY fiscal_year)
              FROM budget_muni_transfer)  AS "muniYears",
           (SELECT jsonb_object_agg(b.na_item, jsonb_build_object(
                     'year', b.year, 'bgPctGdp', b.bg_pct_gdp,
                     'euAvgPctGdp', b.eu_avg_pct_gdp,
                     'rank', b.rank, 'total', b.total))
              FROM budget_peer_band b)    AS "peerBands"
      FROM pick p
  ) row;
$$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT  ON budget_peer_band          TO app_readonly;
    GRANT SELECT  ON budget_hub_stats_cache    TO app_readonly;
    GRANT EXECUTE ON FUNCTION budget_hub_stats(int) TO app_readonly;
  END IF;
END $$;
