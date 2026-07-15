-- "How typical is this tender?" — the ex-ante companion to the contract-stage
-- normalcy panel (063/064). Positions ONE tender (procedure) on a percentile
-- ruler against a cohort of similar tenders, over columns already in `tenders`.
-- DESCRIPTIVE, never a verdict of wrongdoing.
--
-- Dimensions (vs the contract panel):
--   value     — estimated_value_eur, neutral (informative, never a deviation).
--   window    — SUBMISSION days (publication → deadline). THE tender-only signal:
--               a short window suppresses competition (EU Dir. 2014/24 Art. 27
--               reference minimum ~14 days). Risk direction = LOW (few days).
--   procedure — procedure_type bucket vs the cohort's open share (same as 063).
-- Dropped vs contracts: bidders (tenders are count-only, bids blocked) and
-- concentration (no contractor at the tender stage).
-- Cohort context: cancellation + EU-funded shares (informative, not deviations).
--
-- COHORT = same-CPV adaptive-prefix tenders within the target's MONTH +/-30
-- months (month-aligned) — the SAME windowed definition as the contract panel
-- (063/064b). This replaced an earlier (prefix × 3-era) bucketing that, because
-- EVERY tender falls in one era (all publication dates are 2020+), compared each
-- tender against ALL same-CPV tenders ever. The fn and the set-based cache use
-- the identical window (parity-checked byte-for-byte). Uses procurement_procedure_bucket
-- (063) for the procedure vocabulary. Keyed by УНП (tenders PK). Depends on
-- tenders (031). EXECUTE → app_readonly.
--
-- Determinism (reference_pg_payload_determinism): percentile_cont is
-- deterministic given identical input; the value/window percentile BOUNDS are
-- ROUNDed (value → 2dp cents, window → 2dp days) so a cloud recompute of the fn
-- is byte-identical to the local-built matview (unrounded percentile_cont bounds
-- otherwise drift by last-ULP parallel-summation noise). The 'percentile' rank is
-- an integer count/N. mnum = year*12 + (month-1), so the +/-30-month window is
-- [mnum-30, mnum+30] and year = mnum / 12 exactly.

SET check_function_bodies = off;

-- Submission window in days (publication → deadline). NULL when either date is
-- not a clean ISO YYYY-MM-DD or the span is outside [0, 400] (data errors / open
-- frameworks), so it drops out of the window cohort like any absent metric.
CREATE OR REPLACE FUNCTION tender_window_days(p_pub text, p_deadline text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_pub ~ '^\d{4}-\d{2}-\d{2}' AND p_deadline ~ '^\d{4}-\d{2}-\d{2}'
     AND (left(p_deadline, 10)::date - left(p_pub, 10)::date) BETWEEN 0 AND 400
    THEN (left(p_deadline, 10)::date - left(p_pub, 10)::date)
  END;
$$;

-- --------------------------------------------------------------------------
-- Live function — month-aligned +/-30-month windowed cohort (reference impl).
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tender_normalcy(p_unp text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH tgt AS (
    SELECT unp, cpv, estimated_value_eur AS val,
           tender_window_days(publication_date, submission_deadline) AS win,
           procedure_type, left(cpv, 2) AS div,
           to_date(NULLIF(btrim(publication_date), ''), 'YYYY-MM-DD') AS pd
    FROM tenders
    WHERE unp = p_unp
  ),
  -- Same division + month-aligned target-month +/-30 months (self INCLUDED — a
  -- tender is a member of its own cohort; self never counts in "strictly below",
  -- keeping the fallback byte-identical to the matview build).
  pool AS (
    SELECT t.cpv, t.estimated_value_eur AS val,
           tender_window_days(t.publication_date, t.submission_deadline) AS win,
           t.procedure_type, t.is_cancelled, t.is_eu_funded, t.publication_date
    FROM tenders t CROSS JOIN tgt
    WHERE tgt.cpv IS NOT NULL
      AND left(t.cpv, 2) = tgt.div
      AND t.publication_date >= to_char(date_trunc('month', tgt.pd) - interval '30 months', 'YYYY-MM-DD')
      AND t.publication_date <  to_char(date_trunc('month', tgt.pd) + interval '31 months', 'YYYY-MM-DD')
  ),
  prefix_counts AS (
    SELECT v.plen, count(*) AS n
    FROM pool CROSS JOIN tgt CROSS JOIN (VALUES (8), (5), (4), (3), (2)) v(plen)
    WHERE left(pool.cpv, v.plen) = left(tgt.cpv, v.plen)
    GROUP BY v.plen
  ),
  chosen AS (
    SELECT COALESCE(
      (SELECT plen FROM prefix_counts WHERE n >= 30 ORDER BY plen DESC LIMIT 1),
      2) AS plen
  ),
  cohort AS (
    SELECT pool.val, pool.win, pool.procedure_type, pool.is_cancelled,
           pool.is_eu_funded, pool.publication_date
    FROM pool CROSS JOIN tgt CROSS JOIN chosen
    WHERE left(pool.cpv, chosen.plen) = left(tgt.cpv, chosen.plen)
  ),
  val AS (
    SELECT count(*)::int AS n,
           percentile_cont(0.10) WITHIN GROUP (ORDER BY val) AS p10,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY val) AS p25,
           percentile_cont(0.50) WITHIN GROUP (ORDER BY val) AS median,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY val) AS p75,
           percentile_cont(0.90) WITHIN GROUP (ORDER BY val) AS p90
    FROM cohort WHERE val IS NOT NULL AND val > 0
  ),
  win AS (
    SELECT count(*)::int AS n,
           percentile_cont(0.10) WITHIN GROUP (ORDER BY win) AS p10,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY win) AS p25,
           percentile_cont(0.50) WITHIN GROUP (ORDER BY win) AS median,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY win) AS p75,
           percentile_cont(0.90) WITHIN GROUP (ORDER BY win) AS p90,
           avg((win < 14)::int)::double precision AS short_share
    FROM cohort WHERE win IS NOT NULL
  ),
  proc AS (
    SELECT count(*) FILTER (WHERE procedure_type IS NOT NULL
             AND btrim(procedure_type) <> '')::int AS n,
           avg((procurement_procedure_bucket(procedure_type) = 'open')::int)
             FILTER (WHERE procedure_type IS NOT NULL
               AND btrim(procedure_type) <> '')::double precision AS open_share
    FROM cohort
  ),
  ctx AS (
    SELECT count(*)::int AS n,
           avg(is_cancelled::int)::double precision AS cancelled_share,
           avg(is_eu_funded::int)::double precision AS eu_funded_share,
           left(min(publication_date), 4) AS year_from,
           left(max(publication_date), 4) AS year_to
    FROM cohort
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM tgt) THEN NULL ELSE jsonb_build_object(
    'unp', p_unp,
    'cohort', CASE WHEN (SELECT cpv FROM tgt) IS NULL THEN NULL ELSE jsonb_build_object(
      'division',       (SELECT div FROM tgt),
      'cpvPrefix',      left((SELECT cpv FROM tgt), (SELECT plen FROM chosen)),
      'cpvLen',         (SELECT plen FROM chosen),
      'n',              (SELECT n FROM val),
      'yearFrom',       (SELECT year_from FROM ctx),
      'yearTo',         (SELECT year_to FROM ctx),
      'sufficient',     (SELECT n FROM val) >= 30,
      'windowMonths',   30,
      'cancelledShare', (SELECT cancelled_share FROM ctx),
      'euFundedShare',  (SELECT eu_funded_share FROM ctx)
    ) END,
    'value', CASE WHEN (SELECT n FROM val) = 0 OR (SELECT val FROM tgt) IS NULL
        OR (SELECT val FROM tgt) <= 0
      THEN NULL ELSE jsonb_build_object(
      'dir', 'neutral',
      'value',  (SELECT val FROM tgt),
      'n',      (SELECT n FROM val),
      'p10',    ROUND((SELECT p10 FROM val)::numeric, 2), 'p25', ROUND((SELECT p25 FROM val)::numeric, 2),
      'median', ROUND((SELECT median FROM val)::numeric, 2),
      'p75',    ROUND((SELECT p75 FROM val)::numeric, 2), 'p90', ROUND((SELECT p90 FROM val)::numeric, 2),
      'percentile', (SELECT ROUND((count(*) FILTER (
                       WHERE val < (SELECT val FROM tgt)))::numeric
                       / NULLIF((SELECT n FROM val), 0), 4) FROM cohort
                     WHERE val IS NOT NULL AND val > 0)
    ) END,
    'window', CASE WHEN (SELECT n FROM win) = 0 OR (SELECT win FROM tgt) IS NULL
      THEN NULL ELSE jsonb_build_object(
      'dir', 'low',
      'value',  (SELECT win FROM tgt),
      'n',      (SELECT n FROM win),
      'p10',    ROUND((SELECT p10 FROM win)::numeric, 2), 'p25', ROUND((SELECT p25 FROM win)::numeric, 2),
      'median', ROUND((SELECT median FROM win)::numeric, 2),
      'p75',    ROUND((SELECT p75 FROM win)::numeric, 2), 'p90', ROUND((SELECT p90 FROM win)::numeric, 2),
      'shortShare', (SELECT short_share FROM win),
      'isShort', (SELECT win FROM tgt) < 14,
      'percentile', (SELECT ROUND((count(*) FILTER (
                       WHERE win < (SELECT win FROM tgt)))::numeric
                       / NULLIF((SELECT n FROM win), 0), 4) FROM cohort
                     WHERE win IS NOT NULL)
    ) END,
    'procedure', CASE WHEN (SELECT n FROM proc) = 0 OR (SELECT procedure_type FROM tgt) IS NULL
      THEN NULL ELSE jsonb_build_object(
      'bucket',    procurement_procedure_bucket((SELECT procedure_type FROM tgt)),
      'isOpen',    procurement_procedure_bucket((SELECT procedure_type FROM tgt)) = 'open',
      'openShare', (SELECT open_share FROM proc),
      'n',         (SELECT n FROM proc)
    ) END
  ) END;
$$;

-- --------------------------------------------------------------------------
-- Precomputed per-tender payloads live in a TABLE (not a matview). The windowed
-- build (067b_tender_normalcy_build.sql) runs ONCE on the fast local Postgres;
-- load_tenders_pg then SHIPS the rows to Cloud SQL via COPY, because the
-- shared-core prod instance cannot build it (the windowed rank() sort exceeds
-- temp_file_limit → error 53400). Deterministic function of `tenders`.
-- --------------------------------------------------------------------------
DO $mv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'tender_normalcy_cache') THEN
    DROP MATERIALIZED VIEW tender_normalcy_cache CASCADE;
  END IF;
END $mv$;
CREATE TABLE IF NOT EXISTS tender_normalcy_cache (
  unp     text  PRIMARY KEY,
  payload jsonb NOT NULL
);
GRANT SELECT ON tender_normalcy_cache TO app_readonly;
