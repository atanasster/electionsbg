-- НЗОК per-hospital БМП (болнична медицинска помощ) payments — the multi-period
-- corpus behind the health pack's payments tile and the /company/:eik
-- reimbursement tile. Normalised rows (facility × period), not a payload blob:
-- every consumer is a query-time aggregate (latest-period ranking, per-РЗОК
-- rollup, per-EIK reimbursement, and — once the backfill lands — momentum), so a
-- relational table with the right indexes beats a precomputed blob.
--
-- amount columns are ALWAYS euros (2025 rows are BGN converted at ingest; 2026 is
-- EUR-native). `currency` records the source currency for provenance. `eik` is
-- joined from the Рег.№→EIK crosswalk at load time (null when unmatched).

CREATE TABLE IF NOT EXISTS nzok_hospital_payments (
  reg_no          text NOT NULL,        -- 10-digit Рег.№ ЛЗ (NHIF facility id)
  period          date NOT NULL,        -- month, normalised to the 1st
  eik             text,                 -- from the crosswalk; null when unmatched
  name            text NOT NULL,
  rzok_code       text NOT NULL,        -- 2-digit РЗОК (regional fund)
  rzok_name       text NOT NULL,
  cumulative_eur  double precision NOT NULL,  -- year-to-date paid, euros
  month_eur       double precision NOT NULL,  -- paid in `period`'s month, euros
  currency        text NOT NULL,        -- source currency (BGN|EUR)
  PRIMARY KEY (reg_no, period)
);

-- Per-hospital timeline (company page + momentum): one EIK's rows, newest first.
CREATE INDEX IF NOT EXISTS idx_nzok_hp_eik_period
  ON nzok_hospital_payments (eik, period DESC);
-- Latest-period ranking (pack tile): the top-paid facilities in a period.
CREATE INDEX IF NOT EXISTS idx_nzok_hp_period_amount
  ON nzok_hospital_payments (period DESC, cumulative_eur DESC);

-- Latest-period snapshot in the exact shape NzokHospitalPaymentsFile expects
-- (replaces data/budget/nzok/hospital_payments.json for the pack tile). Sums are
-- ROUND-ed and every ORDER BY carries a deterministic tiebreak so local == cloud
-- and the payload matches the static JSON byte-for-byte (see
-- [[reference_pg_payload_determinism]]).
CREATE OR REPLACE FUNCTION nzok_hospital_payments_latest()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH latest AS (SELECT max(period) AS p FROM nzok_hospital_payments),
  r AS (
    SELECT * FROM nzok_hospital_payments WHERE period = (SELECT p FROM latest)
  )
  SELECT jsonb_build_object(
    'asOf',  to_char((SELECT p FROM latest) + interval '1 month' - interval '1 day', 'YYYY-MM-DD'),
    'year',  extract(year  FROM (SELECT p FROM latest))::int,
    'month', extract(month FROM (SELECT p FROM latest))::int,
    'currencyOfRecord', (SELECT min(currency) FROM r),
    'totalCumulativeEur', ROUND(SUM(cumulative_eur))::bigint,
    'monthTotalEur',      ROUND(SUM(month_eur))::bigint,
    'facilityCount',      COUNT(*),
    'byRzok', (
      SELECT jsonb_agg(jsonb_build_object(
                'code', rzok_code, 'name', rzok_name,
                'cumulativeEur', ROUND(c)::bigint, 'facilityCount', n)
              ORDER BY ROUND(c) DESC, rzok_code)
      FROM (
        SELECT rzok_code, min(rzok_name COLLATE "C") AS rzok_name,
               SUM(cumulative_eur) AS c, COUNT(*) AS n
        FROM r GROUP BY rzok_code
      ) g
    ),
    'hospitals', (
      SELECT jsonb_agg(jsonb_build_object(
                'regNo', reg_no, 'name', name,
                'rzokCode', rzok_code, 'rzokName', rzok_name,
                'cumulativeEur', ROUND(cumulative_eur)::bigint,
                'monthEur', ROUND(month_eur)::bigint,
                'eik', eik)
              ORDER BY ROUND(cumulative_eur) DESC, reg_no)
      FROM r
    )
  )
  FROM r;
$$;

-- One company's reimbursement for the latest period (replaces the byEik lookup on
-- /company/:eik). Sums a company's multiple ЛЗ facilities. NULL when the EIK has
-- no matched НЗОК reimbursement.
CREATE OR REPLACE FUNCTION nzok_hospital_reimbursement_by_eik(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH latest AS (SELECT max(period) AS p FROM nzok_hospital_payments),
  r AS (
    SELECT * FROM nzok_hospital_payments
    WHERE period = (SELECT p FROM latest) AND eik = p_eik
  )
  SELECT CASE WHEN COUNT(*) = 0 THEN NULL ELSE jsonb_build_object(
    'asOf', to_char((SELECT p FROM latest) + interval '1 month' - interval '1 day', 'YYYY-MM-DD'),
    'totalCumulativeEur', ROUND(SUM(cumulative_eur))::bigint,
    'totalMonthEur',      ROUND(SUM(month_eur))::bigint,
    'facilities', jsonb_agg(jsonb_build_object(
                    'regNo', reg_no, 'name', name,
                    'cumulativeEur', ROUND(cumulative_eur)::bigint,
                    'monthEur', ROUND(month_eur)::bigint)
                  ORDER BY ROUND(cumulative_eur) DESC, reg_no)
  ) END
  FROM r;
$$;
