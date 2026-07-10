-- ЕЕОФ per-hospital financials — the МЗ "Единна експертно-оценъчна форма"
-- quarterly indicator sheet for state + municipal лечебни заведения (revenue,
-- expense, liabilities, overdue liabilities, personnel/maintenance/drugs cost
-- split, staffing, bed occupancy, length of stay, cost per bed-day / per patient).
-- Source = МЗ (Наредба № 5/2019), quarterly, 2019-Q2 → 2025-Q3. Money is carried in
-- euros (the source's хил. лв. converted at 1 EUR = 1.95583 BGN at ingest); the raw
-- хил. лв. figure is kept alongside each euro column for provenance.
--
-- Normalised rows (hospital × quarter × ownership), not a payload blob: every
-- consumer is a query-time aggregate (latest-quarter national totals + ranking,
-- per-EIK quarterly series). `eik` is joined at load time by a conservative
-- fold-and-match against the НЗОК Рег.№→EIK crosswalk + the payments table names;
-- it is NULL when unmatched — never guessed.
--
-- The `nzok` sheet of the same publication (paid-by-НЗОК amounts for БМП, medical
-- devices and drugs by Рег.№ ЛЗ) lands in nzok_eeof_nzok_parity as an INDEPENDENT
-- parity reference for the three payment streams already ingested in
-- nzok_hospital_payments (045/050). The two are DIFFERENT accounting bases
-- (ЕЕОФ = accrual within the quarter; payments = cash YTD), so they are compared,
-- never reconciled to equality.

CREATE TABLE IF NOT EXISTS nzok_hospital_financials (
  quarter                              text NOT NULL,   -- "YYYY-Qn"
  ownership                            text NOT NULL,   -- state | municipal
  name                                 text NOT NULL,
  name_fold                            text NOT NULL,   -- fold key used for eik match + PK
  eik                                  text,            -- joined from crosswalk; null when unmatched
  revenue_thousands_bgn                double precision,
  revenue_eur                          double precision,
  expense_thousands_bgn                double precision,
  expense_eur                          double precision,
  cost_efficiency_coef                 double precision,
  personnel_cost_thousands_bgn         double precision,
  personnel_cost_eur                   double precision,
  personnel_cost_share_pct             double precision,
  maintenance_cost_thousands_bgn       double precision,
  maintenance_cost_eur                 double precision,
  maintenance_cost_share_pct           double precision,
  drugs_devices_cost_thousands_bgn     double precision,
  drugs_devices_cost_eur               double precision,
  drugs_devices_cost_share_pct         double precision,
  total_liabilities_thousands_bgn      double precision,
  total_liabilities_eur                double precision,
  overdue_liabilities_thousands_bgn    double precision,
  overdue_liabilities_eur              double precision,
  total_liabilities_revenue_share_pct  double precision,
  overdue_liabilities_revenue_share_pct   double precision,
  overdue_liabilities_expense_share_pct   double precision,
  patients_treated                     double precision,
  avg_monthly_doctors                  double precision,
  avg_monthly_nurses                   double precision,
  patients_per_doctor                  double precision,
  patients_per_nurse                   double precision,
  avg_monthly_beds                     double precision,
  bed_days                             double precision,
  cost_per_bed_day_bgn                 double precision,
  cost_per_bed_day_eur                 double precision,
  cost_per_patient_bgn                 double precision,
  cost_per_patient_eur                 double precision,
  avg_length_of_stay                   double precision,
  bed_occupancy_pct                    double precision,
  PRIMARY KEY (quarter, ownership, name_fold),
  CONSTRAINT nzok_hospital_financials_ownership_ck
    CHECK (ownership IN ('state', 'municipal'))
);

-- Per-hospital timeline (per-EIK quarterly series): one EIK's rows, newest first.
CREATE INDEX IF NOT EXISTS idx_nzok_fin_eik_quarter
  ON nzok_hospital_financials (eik, quarter DESC);
-- Latest-quarter national snapshot + ranking.
CREATE INDEX IF NOT EXISTS idx_nzok_fin_quarter
  ON nzok_hospital_financials (quarter DESC);

-- НЗОК-paid amounts per Рег.№ ЛЗ from the same МЗ publication — an independent
-- parity reference for nzok_hospital_payments' three streams. Kept EUR-only (the
-- site serves euros); the source хил. лв. is not retained here.
CREATE TABLE IF NOT EXISTS nzok_eeof_nzok_parity (
  quarter        text NOT NULL,        -- "YYYY-Qn"
  reg_no         text NOT NULL,        -- Рег.№ ЛЗ
  rzok_code      text,                 -- 2-digit РЗОК
  name           text,
  pathway_count  double precision,     -- брой клинични пътеки (nullable in source)
  bmp_eur        double precision,     -- болнична медицинска помощ, euros
  devices_eur    double precision,     -- медицински изделия, euros
  drugs_eur      double precision,     -- лекарствени продукти, euros
  PRIMARY KEY (quarter, reg_no)
);

CREATE INDEX IF NOT EXISTS idx_nzok_parity_reg_quarter
  ON nzok_eeof_nzok_parity (reg_no, quarter DESC);

-- ---------------------------------------------------------------------------
-- Determinism conventions (see [[reference_pg_payload_determinism]] and 045/050):
-- ROUND money sums before ORDER BY, COLLATE "C" on text sort keys, explicit
-- tiebreaks, and NULL (not an object-of-nulls) on an empty table.
--
-- NOTE ON PER-PATIENT / PER-BED-DAY INDICATORS: cost_per_patient_* and the other
-- per-patient / per-bed-day figures are emitted as RAW values only. They are
-- deliberately NEVER ranked, ORDER BY-ed, or percentile'd here: without a case-mix
-- (тежест на случая) denominator a per-patient cost ranking is misleading — a
-- tertiary center treating heavier cases will always look "expensive". Case-mix
-- adjustment is Phase 3 of the plan and is not built, so no ordering keys off these
-- columns anywhere in this file.
-- ---------------------------------------------------------------------------

-- Latest quarter: national aggregates + top-60 hospitals by expense. `quarter` is
-- "YYYY-Qn"; single-digit quarter makes byte order == chronological order, so
-- max(quarter COLLATE "C") is the newest quarter.
CREATE OR REPLACE FUNCTION nzok_hospital_financials_latest()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH latest AS (SELECT max(quarter COLLATE "C") AS q FROM nzok_hospital_financials),
  r AS (
    SELECT * FROM nzok_hospital_financials WHERE quarter = (SELECT q FROM latest)
  )
  SELECT CASE WHEN COUNT(*) = 0 THEN NULL ELSE jsonb_build_object(
    'quarter',                    (SELECT q FROM latest),
    'hospitalCount',              COUNT(*),
    'totalRevenueEur',            ROUND(SUM(revenue_eur))::bigint,
    'totalExpenseEur',            ROUND(SUM(expense_eur))::bigint,
    'totalLiabilitiesEur',        ROUND(SUM(total_liabilities_eur))::bigint,
    'totalOverdueLiabilitiesEur', ROUND(SUM(overdue_liabilities_eur))::bigint,
    'matchedEikCount',            COUNT(*) FILTER (WHERE eik IS NOT NULL),
    'byOwnership', (
      SELECT jsonb_object_agg(ownership, jsonb_build_object(
                'hospitalCount',       n,
                'revenueEur',          ROUND(rev)::bigint,
                'expenseEur',          ROUND(exp)::bigint,
                'totalLiabilitiesEur', ROUND(tl)::bigint,
                'overdueLiabilitiesEur', ROUND(ovl)::bigint))
      FROM (
        SELECT ownership, COUNT(*) AS n,
               SUM(revenue_eur) AS rev, SUM(expense_eur) AS exp,
               SUM(total_liabilities_eur) AS tl, SUM(overdue_liabilities_eur) AS ovl
        FROM r GROUP BY ownership
      ) o
    ),
    -- Top 60 by expense (allowed sort key). Per-patient/per-bed-day fields ride
    -- along as raw values but never define the order (see NOTE above).
    'hospitals', (
      SELECT jsonb_agg(jsonb_build_object(
                'name',                          name,
                'ownership',                     ownership,
                'eik',                           eik,
                'revenueEur',                    ROUND(revenue_eur)::bigint,
                'expenseEur',                    ROUND(expense_eur)::bigint,
                'costEfficiencyCoef',            cost_efficiency_coef,
                'personnelCostSharePct',         personnel_cost_share_pct,
                'totalLiabilitiesEur',           ROUND(total_liabilities_eur)::bigint,
                'overdueLiabilitiesEur',         ROUND(overdue_liabilities_eur)::bigint,
                'overdueLiabilitiesRevenueSharePct', overdue_liabilities_revenue_share_pct,
                'patientsTreated',               ROUND(patients_treated)::bigint,
                'avgMonthlyBeds',                ROUND(avg_monthly_beds)::bigint,
                'bedOccupancyPct',               bed_occupancy_pct,
                'avgLengthOfStay',               avg_length_of_stay,
                'costPerPatientEur',             cost_per_patient_eur,
                'costPerBedDayEur',              cost_per_bed_day_eur)
              ORDER BY ROUND(expense_eur) DESC, name_fold COLLATE "C")
      FROM (
        SELECT * FROM r
        ORDER BY ROUND(expense_eur) DESC NULLS LAST, name_fold COLLATE "C"
        LIMIT 60
      ) top
    )
  ) END
  FROM r;
$$;

-- One hospital's full quarterly series (ascending) + its latest-quarter indicators.
-- NULL when the EIK has no matched ЕЕОФ rows. (quarter, eik) is unique among
-- matched rows, so no per-quarter aggregation is needed.
CREATE OR REPLACE FUNCTION nzok_hospital_financials_by_eik(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH r AS (SELECT * FROM nzok_hospital_financials WHERE eik = p_eik),
  ser AS (
    SELECT jsonb_agg(obj ORDER BY q COLLATE "C") AS arr
    FROM (
      SELECT quarter AS q, jsonb_build_object(
               'quarter',                       quarter,
               'name',                          name,
               'ownership',                     ownership,
               'revenueThousandsBgn',           revenue_thousands_bgn,
               'revenueEur',                    ROUND(revenue_eur)::bigint,
               'expenseThousandsBgn',           expense_thousands_bgn,
               'expenseEur',                    ROUND(expense_eur)::bigint,
               'costEfficiencyCoef',            cost_efficiency_coef,
               'personnelCostEur',              ROUND(personnel_cost_eur)::bigint,
               'personnelCostSharePct',         personnel_cost_share_pct,
               'maintenanceCostEur',            ROUND(maintenance_cost_eur)::bigint,
               'maintenanceCostSharePct',       maintenance_cost_share_pct,
               'drugsDevicesCostEur',           ROUND(drugs_devices_cost_eur)::bigint,
               'drugsDevicesCostSharePct',      drugs_devices_cost_share_pct,
               'totalLiabilitiesEur',           ROUND(total_liabilities_eur)::bigint,
               'overdueLiabilitiesEur',         ROUND(overdue_liabilities_eur)::bigint,
               'totalLiabilitiesRevenueSharePct',  total_liabilities_revenue_share_pct,
               'overdueLiabilitiesRevenueSharePct', overdue_liabilities_revenue_share_pct,
               'overdueLiabilitiesExpenseSharePct', overdue_liabilities_expense_share_pct,
               'patientsTreated',               ROUND(patients_treated)::bigint,
               'avgMonthlyDoctors',             avg_monthly_doctors,
               'avgMonthlyNurses',              avg_monthly_nurses,
               'patientsPerDoctor',             patients_per_doctor,
               'patientsPerNurse',              patients_per_nurse,
               'avgMonthlyBeds',                avg_monthly_beds,
               'bedDays',                       ROUND(bed_days)::bigint,
               -- raw only, never ranked (see NOTE above)
               'costPerBedDayEur',              cost_per_bed_day_eur,
               'costPerPatientEur',             cost_per_patient_eur,
               'avgLengthOfStay',               avg_length_of_stay,
               'bedOccupancyPct',               bed_occupancy_pct) AS obj
      FROM r
    ) s
  )
  SELECT CASE WHEN arr IS NULL THEN NULL ELSE jsonb_build_object(
    'eik',           p_eik,
    'name',          (arr -> (jsonb_array_length(arr) - 1) ->> 'name'),
    'ownership',     (arr -> (jsonb_array_length(arr) - 1) ->> 'ownership'),
    'latestQuarter', (arr -> (jsonb_array_length(arr) - 1) ->> 'quarter'),
    'quarterCount',  jsonb_array_length(arr),
    'series',        arr,
    'latest',        arr -> (jsonb_array_length(arr) - 1)
  ) END
  FROM ser;
$$;
