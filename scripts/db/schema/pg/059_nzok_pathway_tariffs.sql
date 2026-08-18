-- НЗОК clinical-pathway TARIFFS — the price factor that turns the volume-only
-- activity corpus (migration 053, cases with no лв/€) into a SPEND reading, and
-- unlocks the case-mix "expected vs actual" signal (OpenPrescribing STAR-PU /
-- CMS MSPB idea). Source = the НРД (Национален рамков договор) CONTRACT BODY —
-- the чл. 368/369/370 tables (…б in amendments), NOT an annex — parsed by
-- scripts/nzok/write_pathway_tariffs.ts into
-- data/budget/nzok/pathway_tariffs.json and loaded here. First loaded
-- 2026-08-04 (НРД 2025, 410 codes).
--
-- DATA STATUS: the JSON is gitignored and the ingest is a manual pass per
-- НРД/amendment (the nzok_nrd_tariffs watcher flags new documents), so a fresh
-- clone has this table EMPTY until the operator runs the ingest. (An earlier
-- version of this header claimed nhif.bg is IP-gated to BG egress — it is not;
-- verified 200 from non-BG egress 2026-08-04.) Every function below is a
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
    -- DISTINCT entity_key, not COUNT(*) — see rule 5 in 053. One row per entity
    -- per procedure is the invariant; counting entities says so out loud.
    SELECT COALESCE(SUM(cases), 0) AS cases, COALESCE(SUM(zol), 0) AS zol,
           COUNT(DISTINCT entity_key)::int AS facility_count,
           min(proc_type COLLATE "C") AS proc_type
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
             ORDER BY cases DESC, entity_key COLLATE "C")
      FROM (
        SELECT * FROM rows
        ORDER BY cases DESC, entity_key COLLATE "C"
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
-- SCOPE CAVEAT — RESOLVED BY MEASUREMENT (2026-08-04, first tariff load, НРД
-- 2025): the parsed per-hospital БМП figure DOES cover АПр and КПр. National
-- 2025 expected at list price = КП €1,784M + АПр €229M + КПр €124M = €2,137M
-- vs actual 'bmp' paid €2,108M — a 1.4% gap (unpriced codes + the 80%-rate
-- billing modifiers), whereas a КП-only basis would leave an 18% shortfall.
-- EXPECTED spanning the full mix against the 'bmp' ACTUAL is therefore the
-- correct pairing as written below; no restriction or widening needed. Re-check
-- if the НРД ever moves АПр/КПр reimbursement out of БМП.
-- --------------------------------------------------------------------------
-- Case-mix expected-vs-actual for one hospital: what the НРД list price says its
-- OWN case mix should have cost, against what НЗОК actually paid it.
--
-- TWO SUPPRESSION GUARDS, both of which null the RATIO while keeping the parts
-- visible, so a consumer can say WHY rather than silently showing nothing
-- (docs/plans/procurement-outcomes-v1.md §6b):
--
--   * partial-payment-year — the actual is summed over the payment months the
--     corpus holds for that year. A hospital with four of them against a full
--     year of cases reads as absurdly cheap: measured on the 2025 corpus, one
--     facility showed €1.1 per case on 4 months of payments and 1,646 cases.
--
--     The floor is DERIVED from the year, never a constant. "A full year" is not
--     twelve months here — the payment corpus holds 9 months for 2023, 12 for
--     2024, 11 for 2025 and 6 so far for 2026. A hard 11 is right for exactly
--     one vintage and would suppress EVERY hospital in 2023 or 2026; and since
--     the activity corpus went multi-year (plan §8e), which year this reads is
--     no longer fixed. So the floor is the year's OWN full complement — the most
--     months any hospital has in it — and a hospital is partial when it has
--     fewer. Measured: 255 of 259 clear it in 2025, and the four that do not are
--     exactly the artifacts.
--   * low-tariff-coverage — `expected` only counts cases whose procedure has a
--     tariff. Below 0.80 the comparison rests on too little of the hospital's
--     work to mean anything. 245 of 248 priced hospitals clear it.
--
-- The ratio is a SIGNPOST, never a verdict: case mix legitimately drives cost,
-- and the list price is not what НЗОК contracted to pay.
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
    -- monthly payment corpus (stream 'bmp'). Robust — no name matching. The
    -- month COUNT rides along: it is what tells a partial year from a cheap one.
    SELECT SUM(month_eur) AS bmp_eur, count(DISTINCT period) AS months
    FROM nzok_hospital_payments
    WHERE eik = p_eik AND stream = 'bmp'
      AND EXTRACT(YEAR FROM period) = EXTRACT(YEAR FROM (SELECT p FROM y))
  ),
  -- The year's own full complement of payment months, from the corpus itself.
  full_year AS (
    SELECT max(n)::int AS months FROM (
      SELECT count(DISTINCT period) AS n
        FROM nzok_hospital_payments
       WHERE stream = 'bmp'
         AND EXTRACT(YEAR FROM period) = EXTRACT(YEAR FROM (SELECT p FROM y))
       GROUP BY eik) x
  ),
  calc AS (
    SELECT
      (SELECT expected_eur FROM agg)                            AS expected_eur,
      (SELECT bmp_eur FROM actual)                              AS bmp_eur,
      COALESCE((SELECT months FROM actual), 0)::int             AS months,
      COALESCE((SELECT months FROM full_year), 0)::int          AS full_months,
      ROUND(((SELECT priced_cases FROM agg)::numeric
             / NULLIF((SELECT total_cases FROM agg), 0)), 3)    AS coverage
  ),
  gated AS (
    SELECT c.*,
           CASE
             WHEN c.bmp_eur IS NULL          THEN 'no-payments'
             WHEN c.months < 11              THEN 'partial-payment-year'
             WHEN c.coverage IS NULL
               OR c.coverage < 0.80          THEN 'low-tariff-coverage'
             ELSE NULL
           END AS suppressed
    FROM calc c
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM acts)
              OR (SELECT expected_eur FROM agg) IS NULL
              OR (SELECT expected_eur FROM agg) = 0
         THEN NULL ELSE jsonb_build_object(
    'eik',            p_eik,
    'year',           EXTRACT(YEAR FROM (SELECT p FROM y))::int,
    'expectedEur',    ROUND((SELECT expected_eur FROM gated)),
    'actualEur',      (SELECT ROUND(bmp_eur) FROM gated),
    -- Payment months behind `actualEur`. 11 is a full year in this corpus.
    'paymentMonths',  (SELECT months FROM gated),
    -- The year's own full complement, so a consumer can say "4 of 11" rather
    -- than implying twelve.
    'fullYearMonths', (SELECT full_months FROM gated),
    -- Share of the hospital's cases that had a tariff.
    'coverage',       (SELECT coverage FROM gated),
    -- Why the ratio is withheld, or null when it is not. A consumer should say
    -- this rather than render nothing.
    'suppressed',     (SELECT suppressed FROM gated),
    -- NULL whenever `suppressed` is set: a ratio computed over a partial payment
    -- year or a thinly-priced case mix is not wrong so much as meaningless, and
    -- it is the headline number on the card.
    'ratio',          (SELECT CASE WHEN suppressed IS NOT NULL THEN NULL
                              ELSE ROUND((bmp_eur / expected_eur)::numeric, 3)
                            END FROM gated)
  ) END;
$$;
