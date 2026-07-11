-- НЗОК "risk" views — a TRANSPARENT ranking of hospitals (and of drugs) by how far
-- they deviate from peer norms, for the health pack (/awarder/121858220). Phase 4 of
-- docs/plans/nzok-hospital-intelligence-v1.md.
--
-- WHAT "RISK" MEANS HERE, AND WHAT IT DOES NOT. The rest of the pack is emphatic that
-- each individual signal — a drug-price gap, a high cases-per-bed ratio, overdue debt
-- — is a SIGNPOST, not a verdict (see 052/053 headers). This view does not overturn
-- that. It is a convenience index that surfaces the hospitals sitting near the top of
-- SEVERAL of those signposts at once, so a reader can start their own look somewhere.
-- Three deliberate design choices keep it honest:
--   1. NO OPAQUE SCORE. Every component is shown in its own column with its real
--      value (€ overpaid, # of outlier pathways, overdue-debt %). The index is only
--      the mean of the components' PERCENTILE ranks — a reading aid, not a claim.
--   2. MEAN OF PRESENT COMPONENTS. A hospital is ranked only on the signals it has
--      data for (a private clinic absent from the МЗ ЕЕОФ financials is not scored on
--      debt, not penalised for it). `signalsPresent` states the coverage per row.
--   3. THE COMPONENTS ARE THE SAME ONES THE OTHER TILES ALREADY DEFEND. Drug overpay
--      is the latest-full-year, pack-identity, volume-floored gap (052). Activity
--      outliers reuse the exact cases-per-bed peer test (053). Debt is overdue
--      liabilities as a share of revenue (051). Nothing new is asserted.
--
-- The drug component needs a FULL per-hospital / per-INN aggregate; nzok_drug_overpay
-- is capped at the top-100 rows, so the writer (write_drug_unit_prices.ts) emits these
-- two aggregates over the entire above-median corpus and the drug-prices loader fills
-- the tables below.

-- Cross-table function bodies (nzok_activities, nzok_hospital_financials) are validated
-- lazily so this migration applies even if run before those loaders on a fresh DB.
SET check_function_bodies = false;

-- --------------------------------------------------------------------------
-- Full per-hospital drug-overpay aggregate (latest full year). One row per EIK.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nzok_drug_overpay_by_hospital (
  year        int  NOT NULL,          -- latest full calendar year
  eik         text NOT NULL,
  facility    text NOT NULL,
  overpay_eur double precision NOT NULL,  -- Σ (unit − pack median) × units, all packs
  pack_count  int  NOT NULL,          -- # of above-median (pack × facility) instances
  inn_count   int  NOT NULL,          -- distinct molecules involved
  max_ratio   double precision,       -- worst single pack ratio (unit / median)
  PRIMARY KEY (year, eik)
);

-- --------------------------------------------------------------------------
-- Full per-molecule (INN) drug-overpay aggregate (latest full year), packs nested.
-- The INN is the readable headline; `packs` keeps the pack-identity breakdown so the
-- comparison never silently drifts to molecule level (the cardinal sin 052 guards).
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nzok_drug_overpay_by_inn (
  year           int  NOT NULL,
  inn            text NOT NULL,
  overpay_eur    double precision NOT NULL,
  facility_count int  NOT NULL,       -- distinct hospitals paying above median
  pack_count     int  NOT NULL,       -- distinct pack identities
  max_ratio      double precision,
  packs          jsonb NOT NULL,      -- [{nationalNo,nzokCode,tradeName,medianUnitEur,overpayEur,facilityCount,maxRatio}]
  PRIMARY KEY (year, inn)
);

-- ==========================================================================
-- Hospital risk ranking — transparent components + a mean-percentile index.
-- ==========================================================================
CREATE OR REPLACE FUNCTION nzok_hospital_risk_ranking()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH
  dyear AS (SELECT max(year) AS y FROM nzok_drug_overpay_by_hospital),
  drug AS (
    SELECT eik, facility, overpay_eur, pack_count, inn_count, max_ratio
    FROM nzok_drug_overpay_by_hospital
    WHERE year = (SELECT y FROM dyear)
  ),
  -- Cases-per-bed outliers per hospital, over the WHOLE latest year (not the
  -- overview's top-30 cap). Same peer test as nzok_activities_overview.
  ay AS (SELECT max(period) AS p FROM nzok_activities),
  acur AS (
    SELECT * FROM nzok_activities
    WHERE period = (SELECT p FROM ay) AND eik IS NOT NULL
  ),
  cb AS (
    SELECT a.eik, a.facility, a.procedure,
           nzok_hospital_type(a.facility_fold) AS htype,
           a.cases::double precision / a.beds AS cases_per_bed
    FROM acur a
    WHERE a.beds IS NOT NULL
      AND a.cases >= nzok_activity_casebed_min_cases()
      AND a.beds  >= nzok_activity_casebed_min_beds()
  ),
  cb_grp AS (
    SELECT procedure, htype,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY cases_per_bed) AS peer_median,
           count(*) AS peer_n
    FROM cb GROUP BY procedure, htype
  ),
  act AS (
    SELECT cb.eik, min(cb.facility) AS facility,
           count(*)::int AS outliers,
           ROUND(max(cb.cases_per_bed / NULLIF(g.peer_median, 0))::numeric, 2) AS max_ratio
    FROM cb JOIN cb_grp g ON g.procedure = cb.procedure AND g.htype = cb.htype
    WHERE g.peer_n >= nzok_activity_casebed_min_peers()
      AND g.peer_median > 0
      AND cb.cases_per_bed > g.peer_median
    GROUP BY cb.eik
  ),
  -- Financial distress = OVERDUE liabilities in euros (latest quarter), per EIK.
  -- Overdue debt (a supplier not paid on time) is the sharp signal the financials
  -- tile already defends; total leverage can be ordinary working capital. Most
  -- hospitals carry zero overdue debt — correctly scoring 0 on this axis.
  fq AS (SELECT max(quarter) AS q FROM nzok_hospital_financials),
  fin AS (
    SELECT DISTINCT ON (eik) eik, name,
           overdue_liabilities_eur AS overdue_eur,
           overdue_liabilities_revenue_share_pct AS overdue_pct
    FROM nzok_hospital_financials
    WHERE quarter = (SELECT q FROM fq) AND eik IS NOT NULL
      AND overdue_liabilities_eur IS NOT NULL
    ORDER BY eik, overdue_liabilities_eur DESC
  ),
  -- Percentile of each component, computed ONLY among hospitals that have it.
  drug_r AS (SELECT eik, percent_rank() OVER (ORDER BY overpay_eur) AS pr FROM drug),
  act_r  AS (SELECT eik, percent_rank() OVER (ORDER BY outliers)    AS pr FROM act),
  fin_r  AS (SELECT eik, percent_rank() OVER (ORDER BY overdue_eur) AS pr FROM fin),
  eiks AS (
    SELECT eik FROM drug UNION SELECT eik FROM act UNION SELECT eik FROM fin
  ),
  joined AS (
    SELECT e.eik,
           coalesce(d.facility, a.facility, f.name) AS facility,
           d.overpay_eur, d.pack_count, d.inn_count, d.max_ratio AS drug_max_ratio,
           a.outliers, a.max_ratio AS act_max_ratio,
           f.overdue_eur, f.overdue_pct,
           dr.pr AS drug_pr, ar.pr AS act_pr, fr.pr AS fin_pr
    FROM eiks e
    LEFT JOIN drug   d  ON d.eik  = e.eik
    LEFT JOIN act    a  ON a.eik  = e.eik
    LEFT JOIN fin    f  ON f.eik  = e.eik
    LEFT JOIN drug_r dr ON dr.eik = e.eik
    LEFT JOIN act_r  ar ON ar.eik = e.eik
    LEFT JOIN fin_r  fr ON fr.eik = e.eik
  ),
  scored AS (
    SELECT j.*,
           ( (j.drug_pr IS NOT NULL)::int
           + (j.act_pr  IS NOT NULL)::int
           + (j.fin_pr  IS NOT NULL)::int ) AS signals_present,
           -- Risk index = the three component percentiles summed and divided by 3
           -- (a MISSING component counts as 0, not omitted). So a hospital elevated
           -- on one signal alone tops out near 33, two near 67, and only a hospital
           -- high across all three approaches 100 — "risk" means corroboration, not
           -- a single large number. Every component stays visible in its own column.
           ROUND( 100.0 *
             (coalesce(j.drug_pr,0) + coalesce(j.act_pr,0) + coalesce(j.fin_pr,0)) / 3.0
           )::int AS risk_index
    FROM joined j
  )
  SELECT CASE WHEN (SELECT y FROM dyear) IS NULL THEN NULL ELSE jsonb_build_object(
    'drugYear',   (SELECT y FROM dyear),
    'finQuarter', (SELECT q FROM fq),
    'coverage', jsonb_build_object(
       'drug', (SELECT count(*) FROM drug),
       'activity', (SELECT count(*) FROM act),
       'financial', (SELECT count(*) FROM fin)),
    'hospitals', (
      SELECT jsonb_agg(jsonb_build_object(
               'eik',            eik,
               'facility',       facility,
               'riskIndex',      risk_index,
               'signalsPresent', signals_present,
               'drugOverpayEur', CASE WHEN overpay_eur IS NULL THEN NULL
                                      ELSE ROUND(overpay_eur)::bigint END,
               'drugPackCount',  pack_count,
               'drugInnCount',   inn_count,
               'drugMaxRatio',   drug_max_ratio,
               'activityOutliers', outliers,
               'activityMaxRatio', act_max_ratio,
               'overdueEur',     CASE WHEN overdue_eur IS NULL THEN NULL
                                      ELSE ROUND(overdue_eur)::bigint END,
               'overduePct',     CASE WHEN overdue_pct IS NULL THEN NULL
                                      ELSE ROUND((overdue_pct * 100)::numeric, 1) END)
             ORDER BY risk_index DESC, signals_present DESC,
                      coalesce(overpay_eur,0) DESC, eik)
      FROM (SELECT * FROM scored ORDER BY risk_index DESC, signals_present DESC,
                                          coalesce(overpay_eur,0) DESC, eik
            LIMIT 30) t)
  ) END;
$$;

-- ==========================================================================
-- Risk by drug — INN headline, packs nested. Straight read of the aggregate.
-- ==========================================================================
CREATE OR REPLACE FUNCTION nzok_drug_risk_by_inn()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH y AS (SELECT max(year) AS yr FROM nzok_drug_overpay_by_inn)
  SELECT CASE WHEN (SELECT yr FROM y) IS NULL THEN NULL ELSE jsonb_build_object(
    'year', (SELECT yr FROM y),
    'drugs', (
      SELECT jsonb_agg(jsonb_build_object(
               'inn',           inn,
               'overpayEur',    ROUND(overpay_eur)::bigint,
               'facilityCount', facility_count,
               'packCount',     pack_count,
               'maxRatio',      max_ratio,
               'packs',         packs)
             ORDER BY overpay_eur DESC, inn COLLATE "C")
      FROM nzok_drug_overpay_by_inn
      WHERE year = (SELECT yr FROM y))
  ) END;
$$;

-- ==========================================================================
-- One molecule's (INN) full detail → the /molecule/:inn page. The pre-aggregated
-- per-INN headline + nested packs (from nzok_drug_overpay_by_inn), joined to the
-- FULL per-facility overpay rows for that molecule (nzok_drug_overpay is capped
-- only in the overview payload, never per-INN). Comparison stays at pack identity:
-- both `packs` and `rows` carry (nationalNo, nzokCode). NULL when the INN has no
-- above-median rows in the latest full year.
-- ==========================================================================
CREATE OR REPLACE FUNCTION nzok_drug_molecule_detail(p_inn text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH y AS (SELECT max(year) AS yr FROM nzok_drug_overpay_by_inn),
  agg AS (
    SELECT * FROM nzok_drug_overpay_by_inn
    WHERE year = (SELECT yr FROM y) AND inn = p_inn
    LIMIT 1
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM agg) THEN NULL ELSE jsonb_build_object(
    'inn',           p_inn,
    'year',          (SELECT yr FROM y),
    'overpayEur',    (SELECT ROUND(overpay_eur)::bigint FROM agg),
    'facilityCount', (SELECT facility_count FROM agg),
    'packCount',     (SELECT pack_count FROM agg),
    'maxRatio',      (SELECT max_ratio FROM agg),
    'packs',         (SELECT packs FROM agg),
    'rows', (
      SELECT jsonb_agg(jsonb_build_object(
               'nationalNo',    national_no,
               'nzokCode',      nzok_code,
               'tradeName',     trade_name,
               'form',          form,
               'facility',      facility,
               'regNo',         reg_no,
               'eik',           eik,
               'unitEur',       unit_eur,
               'medianUnitEur', median_unit_eur,
               'ratio',         ratio,
               'units',         units,
               'overpayEur',    ROUND(overpay_eur)::bigint)
             ORDER BY ROUND(overpay_eur) DESC,
                      reg_no COLLATE "C", national_no COLLATE "C",
                      nzok_code COLLATE "C", id)
      FROM nzok_drug_overpay
      -- period IS NULL = the annual (latest-full-year) ranking, the only rows this
      -- table holds today; the guard keeps `rows` on one year if a future monthly
      -- ranking ever shares the table (the headline `agg` is already max(year)).
      WHERE inn = p_inn AND period IS NULL)
  ) END;
$$;

RESET check_function_bodies;
