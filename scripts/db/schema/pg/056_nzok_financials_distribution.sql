-- НЗОК hospital "report card" + decile-fan substrate — the CMS Care Compare
-- ("this hospital vs the national median") and OpenPrescribing (decile fan over
-- time) idea, applied to the ЕЕОФ quarterly financial indicators already loaded
-- in nzok_hospital_financials (migration 051). It adds NO new data: it is a
-- distribution reading of eight per-hospital RATIO measures.
--
-- WHY RATIOS ONLY. A decile comparison of a raw level (total spend) just ranks
-- hospitals by size. Every measure here is a rate/ratio (per bed-day, per
-- patient, a share, an occupancy) so the comparison is about how a hospital
-- operates, not how big it is. This is the cardinal rule the whole feature rests
-- on.
--
-- POLARITY IS ASSIGNED ONLY WHERE THE READING IS UNAMBIGUOUS. The client colours
-- a badge good/bad only for the two measures with a single correct direction
-- (overdue-debt share: higher is worse; bed occupancy: higher is better).
-- Everything else is POSITIONAL — "above / around / below the national median" —
-- with no good/bad claim, because case-mix legitimately drives cost-per-patient,
-- ALOS, personnel share, etc. This mirrors OpenPrescribing's measure-curation bar.
--
-- The eight measures (all latest-quarter, all >=20-bed hospitals):
--   overdueRevShare   overdue liabilities / revenue      (fraction)  higher=worse
--   bedOccupancy      average bed occupancy              (fraction)  higher=better
--   alos              average length of stay             (days)      neutral
--   costPerBedDay     cost per bed-day                   (eur)       neutral
--   costPerPatient    cost per treated patient           (eur)       neutral
--   personnelShare    personnel cost / total cost        (fraction)  neutral
--   patientsPerDoctor patients per doctor                (count)     neutral
--   costEfficiency    ЕЕОФ efficiency coefficient        (ratio)     neutral
--
-- Determinism (see reference_pg_payload_determinism): percentile_cont values are
-- deterministic; arrays are ORDER BY a stable key (measure COLLATE "C" or
-- quarter); an absent hospital / empty corpus returns NULL, not an object of
-- nulls. A >=20-bed volume floor keeps tiny facilities out of the distribution.

-- Long-form unpivot of the latest-quarter financials into (eik, measure, value),
-- one row per hospital-measure past the bed floor. Shared by both functions.
CREATE OR REPLACE FUNCTION nzok_financials_bed_floor() RETURNS double precision
  LANGUAGE sql IMMUTABLE AS $$ SELECT 20::double precision $$;

-- --------------------------------------------------------------------------
-- One hospital's report card: for every measure, the hospital's latest value,
-- the national median + the p40/p60 "around the median" band (the tolerance the
-- client uses for the CMS-style "около медианата / same as national" verdict),
-- its percentile (share of hospitals strictly below it), and the peer count.
-- NULL when the EIK has no latest-quarter row past the bed floor.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nzok_financials_measures_by_eik(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH latest AS (SELECT max(quarter) AS q FROM nzok_hospital_financials),
  long AS (
    SELECT f.eik, m.measure, m.value
    FROM nzok_hospital_financials f
    CROSS JOIN LATERAL (VALUES
      ('overdueRevShare',   f.overdue_liabilities_revenue_share_pct),
      ('bedOccupancy',      f.bed_occupancy_pct),
      ('alos',              f.avg_length_of_stay),
      ('costPerBedDay',     f.cost_per_bed_day_eur),
      ('costPerPatient',    f.cost_per_patient_eur),
      ('personnelShare',    f.personnel_cost_share_pct),
      ('patientsPerDoctor', f.patients_per_doctor),
      ('costEfficiency',    f.cost_efficiency_coef)
    ) AS m(measure, value)
    WHERE f.quarter = (SELECT q FROM latest)
      AND f.avg_monthly_beds >= nzok_financials_bed_floor()
      AND m.value IS NOT NULL
  ),
  dist AS (
    SELECT measure,
           COUNT(*)::int AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY value) AS median,
           percentile_cont(0.4) WITHIN GROUP (ORDER BY value) AS p40,
           percentile_cont(0.6) WITHIN GROUP (ORDER BY value) AS p60
    FROM long GROUP BY measure
  ),
  mine AS (SELECT measure, value FROM long WHERE eik = p_eik)
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM mine) THEN NULL ELSE jsonb_build_object(
    'eik',     p_eik,
    'quarter', (SELECT q FROM latest),
    'measures', (
      SELECT jsonb_agg(jsonb_build_object(
               'measure',    d.measure,
               'value',      mine.value,
               'median',     d.median,
               'p40',        d.p40,
               'p60',        d.p60,
               'n',          d.n,
               -- Share of peers strictly below this hospital, 0..1.
               'percentile', (
                 SELECT ROUND((COUNT(*) FILTER (WHERE l.value < mine.value))::numeric
                              / NULLIF(d.n, 0), 4)
                 FROM long l WHERE l.measure = d.measure))
             ORDER BY d.measure COLLATE "C")
      FROM dist d JOIN mine ON mine.measure = d.measure)
  ) END;
$$;

-- --------------------------------------------------------------------------
-- One measure's decile fan over time: per quarter, the p10..p90 bands + median
-- across all >=20-bed hospitals, plus the selected hospital's own value that
-- quarter (NULL in quarters where it has no row). This is the OpenPrescribing
-- "you are here in the distribution, and here is how the whole distribution
-- moved" chart. p_measure is one of the eight keys above. NULL for an unknown
-- measure / empty corpus.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nzok_financials_measure_fan(p_measure text, p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH long AS (
    SELECT f.eik, f.quarter, m.value
    FROM nzok_hospital_financials f
    CROSS JOIN LATERAL (VALUES
      ('overdueRevShare',   f.overdue_liabilities_revenue_share_pct),
      ('bedOccupancy',      f.bed_occupancy_pct),
      ('alos',              f.avg_length_of_stay),
      ('costPerBedDay',     f.cost_per_bed_day_eur),
      ('costPerPatient',    f.cost_per_patient_eur),
      ('personnelShare',    f.personnel_cost_share_pct),
      ('patientsPerDoctor', f.patients_per_doctor),
      ('costEfficiency',    f.cost_efficiency_coef)
    ) AS m(measure, value)
    WHERE m.measure = p_measure
      AND f.avg_monthly_beds >= nzok_financials_bed_floor()
      AND m.value IS NOT NULL
  ),
  bands AS (
    SELECT quarter,
           COUNT(*)::int AS n,
           percentile_cont(0.1) WITHIN GROUP (ORDER BY value) AS p10,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY value) AS p25,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY value) AS median,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY value) AS p90
    FROM long GROUP BY quarter
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM bands) THEN NULL ELSE jsonb_build_object(
    'measure', p_measure,
    'eik',     p_eik,
    'series', (
      SELECT jsonb_agg(jsonb_build_object(
               'quarter', b.quarter,
               'n',       b.n,
               'p10',     b.p10,
               'p25',     b.p25,
               'median',  b.median,
               'p75',     b.p75,
               'p90',     b.p90,
               'value',   (SELECT value FROM long WHERE eik = p_eik AND quarter = b.quarter))
             ORDER BY b.quarter)
      FROM bands b)
  ) END;
$$;
