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
  -- The seasonal anchor behind every `*_projected_*` column below: the prior
  -- complete fiscal year whose monthly cumulative shape was used to scale this
  -- year's actuals forward (`kfp.ts` projectFigures). NULL on a complete year,
  -- which is the same thing as „the projected columns are NULL here".
  y.projection_basis,
  -- Money, each key naming its basis. NULL where the corpus withholds rather
  -- than reports zero.
  --
  -- ⚠️⚠️ `planned` AND `projected` ARE NOT THE SAME CLAIM AND MUST NEVER BE
  -- FOLDED INTO ONE COLUMN. `basis = 'planned'` is МФ's own budget-law column
  -- off the КФП report (`kfp.ts` header.lawCol) — what the National Assembly
  -- appropriated. `basis = 'projected'` is OURS: this year's actuals scaled
  -- through `projection_basis`'s monthly profile. Publishing the second under
  -- the first's name asserts the Assembly voted a figure we forecast, which is
  -- exactly what the /budget head shipped for one review cycle. A consumer
  -- picking between them must carry the pick and the label together — see
  -- `src/screens/budget/budgetHubFigures.ts`.
  max(f.amount_eur) FILTER (WHERE f.series = 'revenue'        AND f.basis = 'actual')    AS revenue_executed_eur,
  max(f.amount_eur) FILTER (WHERE f.series = 'revenue'        AND f.basis = 'planned')   AS revenue_planned_eur,
  max(f.amount_eur) FILTER (WHERE f.series = 'revenue'        AND f.basis = 'projected') AS revenue_projected_eur,
  max(f.amount_eur) FILTER (WHERE f.series = 'expenditure'    AND f.basis = 'actual')    AS expenditure_executed_eur,
  max(f.amount_eur) FILTER (WHERE f.series = 'expenditure'    AND f.basis = 'planned')   AS expenditure_planned_eur,
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
GROUP BY y.fiscal_year, y.as_of, y.complete, y.months_available, y.gdp_eur,
         y.projection_basis;

-- A PLAIN COLUMN, so REFRESH … CONCURRENTLY can actually succeed.
CREATE UNIQUE INDEX IF NOT EXISTS ux_budget_hub_stats_cache_fy
  ON budget_hub_stats_cache (fiscal_year);

-- ── The serving function ──────────────────────────────────────────────────
--
-- The same two-tier pick as budget_year_summary: prefer the newest year that
-- HAS a headline figure, then fall back to the newest of any kind, because МФ
-- freezes a column from time to time and a NULL then reads as „nothing
-- collected".
-- ── The national municipal-commitments line (plan §8.4 / T5.6) ────────────
--
-- ONE line on /budget: what municipalities have COMMITTED, beside the state
-- deficit, for the reader who came asking how big the deficit is.
--
-- ⚠️ NEVER SUMMED WITH THE STATE'S OWN FIGURES, and never with the чл. 53
-- transfers either. Different debtors, different mandates — and no row count
-- would show the error. The payload therefore ships this as its own object
-- with its own quarter label, never as a field beside `balanceExecutedEur`.
--
-- ⚠️ THE LATEST QUARTER OFTEN HAS NO COMMITMENTS. МФ freezes the column and the
-- ingest withholds it rather than carrying it forward — 2025 Q3 reports
-- `commitments` in `suppressed_fields` with all 265 municipalities filed on
-- other columns. So this reads the latest quarter that actually CARRIES the
-- figure and returns that quarter's label with it. Falling through to the
-- newest quarter would render „€0 поети ангажименти", which is the healthiest
-- number in the country and completely false.
--
-- plpgsql, not `LANGUAGE sql`, ON PURPOSE: a sql body is parsed at CREATE time,
-- so naming `municipal_fiscal` would make 156 unappliable to any database that
-- has not run 149 — a different loader entirely (see CLAUDE.md's note on 149's
-- own 42P01). A plpgsql body records no dependency and the EXCEPTION arm turns
-- an absent corpus into `null`, which the hub renders as „no line" rather than
-- as zero.
CREATE OR REPLACE FUNCTION budget_muni_commitments_national()
RETURNS jsonb LANGUAGE plpgsql STABLE AS $fn$
DECLARE r jsonb;
BEGIN
  EXECUTE $q$
    -- The FULL roster, not the picked quarter's own count. Taking `count(*)`
    -- inside the quarter makes a short-roster quarter report „N of N" and
    -- suppress its own partial-roster notice — the one case the notice exists
    -- for.
    WITH roster AS (SELECT count(DISTINCT obshtina) AS total FROM municipal_fiscal)
    SELECT jsonb_build_object(
             'fiscalYear', m.fiscal_year,
             'quarter',    m.quarter,
             'commitmentsEur', m.c,
             -- How many of the 265 actually filed the figure. A national total
             -- over a partial roster is a smaller number pretending to be a
             -- complete one.
             'filedCount', m.n,
             'municipalityCount', (SELECT total FROM roster),
             'arrearsEur', m.a)
      FROM (SELECT fiscal_year, quarter,
                   sum(commitments_eur) AS c,
                   count(commitments_eur) AS n,
                   sum(arrears_eur) AS a
              FROM municipal_fiscal
             GROUP BY fiscal_year, quarter
            -- A COVERAGE FLOOR, not merely „someone filed". Without it a single
            -- filer in a newer quarter displaces a complete one, and the hub
            -- publishes one municipality's commitments as the national figure.
            HAVING count(commitments_eur) >= 0.5 * (SELECT total FROM roster)
             ORDER BY fiscal_year DESC, quarter DESC
             LIMIT 1) m
  $q$ INTO r;
  RETURN r;
EXCEPTION
  -- ⚠️ `insufficient_privilege` is NOT in this list, deliberately. A missing
  -- GRANT on a plain table is permanent rather than a refresh artifact, and
  -- 149's GRANT sits behind an `IF EXISTS (pg_roles)` guard — exactly how that
  -- state arises — so swallowing it would serve „no municipal line" for ever
  -- with nothing to notice. It propagates and the route 500s, per CLAUDE.md.
  WHEN undefined_table OR undefined_column THEN
    -- Said once, so an operator learns the loader never ran here. Silence is
    -- what makes a degraded hub indistinguishable from a healthy one.
    RAISE WARNING
      'budget_muni_commitments_national: municipal_fiscal is absent — serving no national line. Run db:load:municipal-fiscal:pg:cloud.';
    RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION budget_hub_stats(
  p_fy int DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE AS $$
  -- The per-ПРБ appropriation rollup behind the head's evidence aside: its five rows, the
  -- total they are drawn from, and how many units carry one. ONE definition, because the
  -- caption claims the three describe the same population.
  --
  -- ⚠️ `coalesce(planned_law_eur, planned_eur)` — the SAME basis `budget_admin_list` (155)
  -- ranks by, because the aside links into the page that function serves and a list whose
  -- order disagrees with its own destination is worse than no list. `planned_eur` alone
  -- carries the Отчет's consolidated restatement in report-years, which moves a unit's rank
  -- (МОСВ by €43.9m) — and only in report-years, so the two agree on the current corpus and
  -- a row-level gate cannot tell them apart. `budget_hub_stats.data.test.ts` reads the
  -- DEFINITIONS for that reason.
  WITH admin AS (
    SELECT f.fiscal_year,
           n.node_id AS "nodeId", n.name_bg AS "nameBg", n.name_en AS "nameEn",
           sum(coalesce(f.planned_law_eur, f.planned_eur)) AS eur
      FROM budget_admin_node n
      JOIN budget_admin_fact f
        ON f.node_id = n.node_id AND f.kind = 'expenditure'
     GROUP BY f.fiscal_year, n.node_id, n.name_bg, n.name_en
    HAVING sum(coalesce(f.planned_law_eur, f.planned_eur)) > 0
  ),
  pick AS (
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
           p.revenue_planned_eur          AS "revenuePlannedEur",
           p.revenue_projected_eur        AS "revenueProjectedEur",
           p.expenditure_executed_eur     AS "expenditureExecutedEur",
           p.expenditure_planned_eur      AS "expenditurePlannedEur",
           p.expenditure_projected_eur    AS "expenditureProjectedEur",
           -- The seasonal anchor year behind the `*Projected*` keys, so a consumer
           -- rendering one can say WHOSE profile it was scaled through instead of
           -- presenting a forecast as a bare fact.
           p.projection_basis             AS "projectionBasisYear",
           -- ⚠️ THE BASIS CHANGE HAPPENS HERE, not in the screen. `budgetBasis.test.ts`
           -- §7.1 forbids a client-side division by GDP or population for a stated reason:
           -- a basis change done twice is the same question with two implementations, and
           -- they drift. The gate caught the /budget head computing this inline.
           --
           -- TWO shares, not one, for the same reason there are two numerators: folding
           -- them would produce a percentage whose basis the consumer has to guess.
           --
           -- The two operands come from DIFFERENT base tables — `gdp_eur` from
           -- `budget_fiscal_year`, the numerator from `budget_fiscal_year_figure` through the
           -- LEFT JOIN above — but they are folded into ONE `budget_hub_stats_cache` row keyed
           -- on `fiscal_year`, so numerator and denominator cannot be different years. That is
           -- the other half of why this belongs on the server: a screen holding two figures has
           -- no way to prove it. NULL when either side is missing, so a consumer renders
           -- nothing rather than a share of an unknown economy.
           --
           -- ⚠️ THE DENOMINATOR IS NOT ALWAYS MEASURED. `gdp_eur` comes from macro.json's
           -- Eurostat nominalGdp series, which ends ~18 months behind — `buildGdpByYear`
           -- extrapolates the in-progress year from the geometric mean of the last three
           -- YoY rates. So on a running year this is a forecast over a forecast, and a
           -- caption that says only „спрямо БВП" overstates what is known. Any year with a
           -- non-NULL `projection_basis` has an extrapolated denominator too.
           --
           -- ⚠️ AND THE PERIMETER IS THE КФП STATE BUDGET, not ESA general government.
           -- `budget_peer_band` fifty lines above carries the OTHER one (TE = 41.7% of GDP
           -- for 2025), and /budget/execution renders it one click away. The two differ by
           -- ~18 points because they measure different governments; a caption naming neither
           -- invites a reader to conclude one of the pages is wrong.
           round(
             (100 * p.expenditure_planned_eur / nullif(p.gdp_eur, 0))::numeric,
             1
           )                              AS "expenditurePlannedPctGdp",
           round(
             (100 * p.expenditure_projected_eur / nullif(p.gdp_eur, 0))::numeric,
             1
           )                              AS "expenditureProjectedPctGdp",
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
           -- COFOG's OWN coverage, which is NOT `yearsAvailable`. Eurostat's
           -- gov_10a_exp runs 2010-2024 while the КФП feed reaches 2026, so a
           -- consumer that offers the module's year list on /budget/functional
           -- opens on a year with no breakdown at all and reads as „nothing was
           -- spent on anything". No filter is needed and none is applied: a year
           -- could only be wrongly admitted if it carried nothing but the TOTAL
           -- row, and TOTAL always rides with the ten.
           (SELECT array_agg(DISTINCT fiscal_year ORDER BY fiscal_year)
              FROM budget_cofog)          AS "cofogYears",
           -- The FUNCTIONAL shares, for the hub's tax receipt (§7.5). Ten rows,
           -- ~300 bytes, so the hub stays a single call.
           --
           -- ⚠️ COFOG, therefore S13 — the WHOLE general-government sector, not
           -- the state budget the rest of this blob reports. That is the right
           -- basis for a receipt (a taxpayer funds every level of government,
           -- and it is what the taxpayer-receipt literature uses) and the WRONG
           -- one to mix with `expenditureExecutedEur`, so the card names it.
           -- Keyed on COFOG's own latest year, which is NOT the hub's: the
           -- Eurostat series ends two years before the КФП feed.
           (SELECT jsonb_agg(jsonb_build_object('code', c.cofog_code,
                                                'pct',  c.pct_of_total)
                             ORDER BY c.pct_of_total DESC)
              FROM budget_cofog c
             WHERE c.cofog_code <> 'TOTAL'
               AND c.fiscal_year = (SELECT max(fiscal_year) FROM budget_cofog)
               AND c.pct_of_total IS NOT NULL) AS "cofogShares",
           -- The head's EVIDENCE LIST: the five largest first-level spending units in the
           -- picked year, by appropriation, plus the denominator that keeps them honest.
           -- ~380 bytes, so the hub stays a single call — the same trade `cofogShares`
           -- above makes, and the reason this is not a second eager fetch
           -- (`tests/perf.spec.ts` counts the hub's requests).
           --
           -- ⚠️⚠️ THESE ROWS DO NOT DECOMPOSE THE BAND'S HEADLINE, and they sit directly
           -- under it. The band is the КФП consolidated programme — which folds in НОИ,
           -- НЗОК and the municipalities — while this is the ЗДБРБ per-ПРБ appropriation:
           -- measured on FY2026, €13.25bn across 44 units against €29.58bn of projected
           -- КФП expenditure. A reader adding five rows and finding 30% of the number
           -- above them is the „destination counts a different set" trap one column over,
           -- so the total and the unit count ride beside the rows and the caption states
           -- both. Never publish the rows without them.
           --
           -- ⚠️ ALL THREE COME FROM ONE ROLLUP (`a`), not from three sibling subqueries.
           -- The caption asserts that the five rows are drawn from N units summing to €X;
           -- with three independently-filtered subqueries that is a coincidence of the
           -- data rather than a property of the query — measured, they agreed only
           -- because `budget_admin_fact` happens to hold one expenditure row per
           -- (node, year) and no non-positive ones.
           (SELECT jsonb_agg(jsonb_build_object(
                     'nodeId', u."nodeId", 'nameBg', u."nameBg",
                     'nameEn', u."nameEn", 'eur', u.eur)
                   ORDER BY u.eur DESC, u."nodeId")
              FROM (SELECT * FROM admin a2
                     WHERE a2.fiscal_year = p.fiscal_year
                     -- ⚠️ `node_id` BREAKS THE TIE, on both this ORDER BY and the one
                     -- above, because the corpus HAS ties: FY2023 and FY2024 each carry
                     -- two nodes at an identical euro. None sits on the rank-5 boundary
                     -- today, but FY2026's rank-5-to-6 margin is 0.48%, so an amount-only
                     -- sort makes both the served payload and the gate that checks it
                     -- non-deterministic the first time one lands there.
                     ORDER BY a2.eur DESC, a2."nodeId"
                     LIMIT 5) u)  AS "topSpendingUnits",
           (SELECT sum(a2.eur) FROM admin a2
             WHERE a2.fiscal_year = p.fiscal_year)  AS "adminTotalPlannedEur",
           (SELECT count(*) FROM admin a2
             WHERE a2.fiscal_year = p.fiscal_year)  AS "adminUnitCount",
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
              FROM budget_peer_band b)    AS "peerBands",
           -- Its own object, never a field beside the state's balance.
           budget_muni_commitments_national() AS "municipalCommitments"
      FROM pick p
  ) row;
$$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT  ON budget_peer_band          TO app_readonly;
    GRANT SELECT  ON budget_hub_stats_cache    TO app_readonly;
    GRANT EXECUTE ON FUNCTION budget_hub_stats(int) TO app_readonly;
    GRANT EXECUTE ON FUNCTION budget_muni_commitments_national() TO app_readonly;
  END IF;
END $$;
