-- НЗОК clinical-pathway TARIFFS — the missing price factor that turns the
-- volume-only activity corpus (migration 053, cases with no лв/€) into a SPEND
-- reading, and unlocks the case-mix "expected vs actual" signal (OpenPrescribing
-- STAR-PU / CMS MSPB idea). Source = the НРД (Национален рамков договор) appendix
-- listing the price per КП/АПр/КПр, fetched by scripts/nzok/write_pathway_tariffs.ts
-- into data/budget/nzok/pathway_tariffs.json and loaded here.
--
-- DATA STATUS: the fetch is IP-gated to Bulgarian egress (nhif.bg 403s elsewhere,
-- exactly like the procedure-names fetch), so on most machines this table is EMPTY
-- until the operator runs the ingest from BG egress. Every function below is a
-- LEFT JOIN / returns NULL when empty, so the pathway tree and report card keep
-- working (volume-only) until the tariffs land.
--
-- IMPORTANT — a tariff is the LIST price, not what was actually paid. Comparing
-- expected (Σ tariff × cases) against actual (the hospital's real БМП from the
-- ЕЕОФ parity table) is a case-mix-standardized signal — "paid 1.1× what its
-- case-mix predicts at list price" — a signpost for надлимитна/corrections/coding
-- differences, NOT a verdict.
--
-- Determinism: ROUND money sums, ORDER BY a rounded key + COLLATE "C" tiebreak,
-- empty corpus → NULL.

CREATE TABLE IF NOT EXISTS nzok_pathway_tariffs (
  procedure  text NOT NULL,        -- КП/АПр/КПр code, feed format (P###/A##/K##, .N kept)
  nrd_year   int  NOT NULL,        -- the НРД year the price is from
  price_eur  double precision NOT NULL,
  PRIMARY KEY (procedure, nrd_year)
);
-- Join key for the activity corpus (procedure) — latest НРД year wins.
CREATE INDEX IF NOT EXISTS idx_nzok_pathway_tariffs_proc
  ON nzok_pathway_tariffs (procedure, nrd_year DESC);

-- The latest tariff per procedure (one НРД year, the most recent loaded).
CREATE OR REPLACE VIEW nzok_pathway_tariff_latest AS
  SELECT DISTINCT ON (procedure) procedure, nrd_year, price_eur
  FROM nzok_pathway_tariffs
  ORDER BY procedure, nrd_year DESC;

-- --------------------------------------------------------------------------
-- Pathway navigation WITH spend — the migration-057 by-procedure view, plus the
-- list-price tariff and the implied spend (cases × tariff) per hospital when a
-- tariff exists. `priceEur`/`spendEur`/`totalSpendEur` are NULL until the tariff
-- table is populated, so the client shows volume and, when present, spend.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nzok_activity_by_procedure_spend(p_procedure text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH y AS (SELECT max(period) AS p FROM nzok_activities),
  tariff AS (
    SELECT price_eur FROM nzok_pathway_tariff_latest WHERE procedure = p_procedure
  ),
  rows AS (
    SELECT a.*, (SELECT price_eur FROM tariff) AS price_eur
    FROM nzok_activities a
    WHERE a.period = (SELECT p FROM y) AND a.procedure = p_procedure
  ),
  tot AS (
    SELECT COALESCE(SUM(cases), 0) AS cases, COALESCE(SUM(zol), 0) AS zol,
           COUNT(*)::int AS facility_count, min(proc_type COLLATE "C") AS proc_type
    FROM rows
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM rows) THEN NULL ELSE jsonb_build_object(
    'procedure',     p_procedure,
    'procType',      (SELECT proc_type FROM tot),
    'year',          EXTRACT(YEAR FROM (SELECT p FROM y))::int,
    'priceEur',      (SELECT price_eur FROM tariff),
    'totalCases',    (SELECT cases FROM tot),
    'totalZol',      (SELECT zol FROM tot),
    'facilityCount', (SELECT facility_count FROM tot),
    'totalSpendEur', (SELECT CASE WHEN (SELECT price_eur FROM tariff) IS NULL
                             THEN NULL ELSE ROUND((SELECT cases FROM tot)
                                                  * (SELECT price_eur FROM tariff)) END),
    'hospitals', (
      SELECT jsonb_agg(jsonb_build_object(
               'eik',      eik,
               'facility', facility,
               'rzok',     rzok,
               'cases',    cases,
               'zol',      zol,
               'sharePct', ROUND((cases::numeric
                                  / NULLIF((SELECT cases FROM tot), 0) * 100), 1),
               'spendEur', CASE WHEN price_eur IS NULL THEN NULL
                                ELSE ROUND(cases * price_eur) END)
             ORDER BY cases DESC, facility_fold COLLATE "C")
      FROM (
        SELECT * FROM rows
        ORDER BY cases DESC, facility_fold COLLATE "C"
        LIMIT 60
      ) t)
  ) END;
$$;

-- --------------------------------------------------------------------------
-- Case-mix expected-vs-actual for one hospital — the STAR-PU / MSPB signal. The
-- EXPECTED pathway spend is Σ over the hospital's pathways of (list tariff × its
-- cases); the ACTUAL is its real БМП paid, from the eik-keyed monthly payment
-- corpus (nzok_hospital_payments, stream 'bmp', summed over the activity year).
-- The ratio actual/expected says whether the hospital is paid more or less than
-- its case-mix predicts at list price. NULL until tariffs are loaded OR when the
-- hospital has no matched activity + payment rows. `coverage` = share of the
-- hospital's cases that had a tariff, so a thin match is visible and not silently
-- trusted.
--
-- SCOPE CAVEAT (confirm before the ratio is presented as a live signal): EXPECTED
-- spans the hospital's ENTIRE activity mix — КП **and** АПр **and** КПр — while
-- ACTUAL is the total 'bmp' stream. If АПр/КПр are reimbursed OUTSIDE the per-
-- hospital БМП figure we parse, the numerator excludes spend the denominator
-- includes, biasing every ratio DOWNWARD by the hospital's АПр/КПр share (~40% of
-- cases nationally). Whether the parsed БМП total already covers АПр/КПр is
-- unconfirmed from the dev box — validate it when the tariffs are ingested from BG
-- egress, and if they land outside 'bmp' either restrict EXPECTED to КП-only or
-- widen ACTUAL to the matching streams. The feature stays dormant (NULL) until
-- then, so this is a note for whoever loads the tariffs, not a live defect.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nzok_casemix_expected_vs_actual(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH y AS (SELECT max(period) AS p FROM nzok_activities),
  acts AS (
    SELECT a.procedure, a.cases, t.price_eur
    FROM nzok_activities a
    LEFT JOIN nzok_pathway_tariff_latest t ON t.procedure = a.procedure
    WHERE a.period = (SELECT p FROM y) AND a.eik = p_eik
  ),
  agg AS (
    SELECT
      SUM(cases) AS total_cases,
      SUM(cases) FILTER (WHERE price_eur IS NOT NULL) AS priced_cases,
      SUM(cases * price_eur) FILTER (WHERE price_eur IS NOT NULL) AS expected_eur
    FROM acts
  ),
  actual AS (
    -- The hospital's ACTUAL БМП paid in the activity year, from the eik-keyed
    -- monthly payment corpus (stream 'bmp'). Robust — no name matching.
    SELECT SUM(month_eur) AS bmp_eur
    FROM nzok_hospital_payments
    WHERE eik = p_eik AND stream = 'bmp'
      AND EXTRACT(YEAR FROM period) = EXTRACT(YEAR FROM (SELECT p FROM y))
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM acts)
              OR (SELECT expected_eur FROM agg) IS NULL
              OR (SELECT expected_eur FROM agg) = 0
         THEN NULL ELSE jsonb_build_object(
    'eik',          p_eik,
    'year',         EXTRACT(YEAR FROM (SELECT p FROM y))::int,
    'expectedEur',  ROUND((SELECT expected_eur FROM agg)),
    'actualEur',    (SELECT ROUND(bmp_eur) FROM actual),
    'ratio',        (SELECT CASE WHEN (SELECT bmp_eur FROM actual) IS NULL THEN NULL
                            ELSE ROUND(((SELECT bmp_eur FROM actual)
                                        / (SELECT expected_eur FROM agg))::numeric, 3) END),
    -- Share of the hospital's cases that had a tariff — a low value means the
    -- expected figure rests on partial coverage and must be read cautiously.
    'coverage',     (SELECT ROUND((priced_cases::numeric
                                   / NULLIF(total_cases, 0)), 3) FROM agg)
  ) END;
$$;
