-- Ex-ante tender-risk BASE RATES — the §6b calibration pass for the tender
-- risk-signal set (docs/plans/procurement-risk-v2.md). READ-ONLY: no schema
-- changes, no writes. Run before writing any tender-risk scoring SQL, so the
-- thresholds are calibrated on the Bulgarian corpus rather than imported (an
-- imported band is noise — WB PRWP 10444's flat "7–11d submission = risk"
-- fires on ~1 in 5 BG tenders, almost all legitimate low-value procedures).
--
--   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d electionsbg \
--     -f scripts/procurement/tender_base_rates.sql
--
-- Procedure-type bucket mirrors GTI/PRWP 10444 Table 2, mapped to ЗОП names:
--   0   open        — Открита процедура · Публично състезание · Събиране на оферти с обява
--   0.5 restricted / negotiated WITH a prior call — Ограничена · с предварителна покана · …
--   1   non-open    — Пряко договаряне · Договаряне без обявление/покана/публикуване ·
--                     Покана до определени лица (closed invitation, no public advert)
--
-- Findings recorded in the plan §6b-results (measured 2026-07-18, 126,413 rows):
--   non-open = 14.3% (ship); short submission window must be tier-conditional
--   (7–11d is 44% on low-value "Събиране на оферти", 0.3% on Открита процедура);
--   decision period 1–4d = 3.2% (usable, run two-sided); change_notice_count
--   0.1%-filled and has_unsecured_funding 33.8%-filled ⇒ do not score.
\pset footer off

\echo '== A. Procedure-type risk buckets (overall) =='
WITH b AS (
  SELECT CASE
    WHEN procedure_type ~ 'без предварително обявление|без публикуване|без предварителна покана|Пряко договаряне|Покана до определени' THEN 1.0
    WHEN procedure_type ~ 'Ограничена|с предварителна покана|с публикуване на обявление|Състезателна процедура с догов|Квалификационна|Партньорство' THEN 0.5
    ELSE 0.0 END AS bucket
  FROM tenders
)
SELECT bucket, count(*), round(100.0*count(*)/sum(count(*)) over (),1) AS pct
FROM b GROUP BY 1 ORDER BY 1;

\echo ''
\echo '== B. Non-open (bucket=1) share BY YEAR =='
WITH b AS (
  SELECT left(publication_date,4) AS yr,
    (procedure_type ~ 'без предварително обявление|без публикуване|без предварителна покана|Пряко договаряне|Покана до определени')::int AS nonopen
  FROM tenders
)
SELECT yr, count(*) AS tenders, sum(nonopen) AS non_open,
       round(100.0*sum(nonopen)/count(*),1) AS non_open_pct
FROM b GROUP BY 1 ORDER BY 1;

\echo ''
\echo '== C. Submission-period days = deadline - publication (distribution) =='
WITH d AS (
  SELECT (submission_deadline::date - publication_date::date) AS days
  FROM tenders
  WHERE submission_deadline ~ '^\d{4}-\d\d-\d\d' AND publication_date ~ '^\d{4}-\d\d-\d\d'
)
SELECT
  count(*)                                             AS n_with_window,
  count(*) FILTER (WHERE days < 0)                     AS negative,
  count(*) FILTER (WHERE days BETWEEN 1 AND 6)         AS d_1_6,
  count(*) FILTER (WHERE days BETWEEN 7 AND 11)        AS d_7_11,
  count(*) FILTER (WHERE days BETWEEN 12 AND 29)       AS d_12_29,
  count(*) FILTER (WHERE days >= 30)                   AS d_30_plus,
  round(100.0*count(*) FILTER (WHERE days BETWEEN 1 AND 6)/count(*),2)  AS pct_1_6,
  round(100.0*count(*) FILTER (WHERE days BETWEEN 7 AND 11)/count(*),2) AS pct_7_11
FROM d;

\echo ''
\echo '== C2. Submission window by procedure tier (proves the 7-11d band is a low-value artifact) =='
WITH d AS (
  SELECT procedure_type, (submission_deadline::date - publication_date::date) AS days
  FROM tenders
  WHERE submission_deadline ~ '^\d{4}-\d\d-\d\d' AND publication_date ~ '^\d{4}-\d\d-\d\d'
    AND (submission_deadline::date - publication_date::date) BETWEEN 0 AND 400
)
SELECT procedure_type, count(*) AS n,
  percentile_disc(0.50) WITHIN GROUP (ORDER BY days) AS median_days,
  round(100.0*count(*) FILTER (WHERE days BETWEEN 1 AND 6)/count(*),1)  AS pct_1_6,
  round(100.0*count(*) FILTER (WHERE days BETWEEN 7 AND 11)/count(*),1) AS pct_7_11
FROM d GROUP BY 1 HAVING count(*) > 500 ORDER BY 2 DESC LIMIT 8;

\echo ''
\echo '== D. Decision period (deadline -> min award date) via unp join to contracts =='
WITH j AS (
  SELECT t.unp, t.submission_deadline::date AS deadline, min(c.date_signed::date) AS awarded
  FROM tenders t JOIN contracts c ON c.unp = t.unp
  WHERE t.submission_deadline ~ '^\d{4}-\d\d-\d\d' AND c.date_signed ~ '^\d{4}-\d\d-\d\d' AND c.tag='contract'
  GROUP BY 1,2
), d AS (SELECT (awarded - deadline) AS days FROM j WHERE awarded >= deadline)
SELECT count(*) AS n_joined,
  percentile_disc(0.10) WITHIN GROUP (ORDER BY days) AS p10,
  percentile_disc(0.50) WITHIN GROUP (ORDER BY days) AS p50,
  percentile_disc(0.90) WITHIN GROUP (ORDER BY days) AS p90,
  round(100.0*count(*) FILTER (WHERE days BETWEEN 1 AND 4)/count(*),1) AS pct_1_4,
  round(100.0*count(*) FILTER (WHERE days BETWEEN 5 AND 8)/count(*),1) AS pct_5_8
FROM d;

\echo ''
\echo '== E. Field fill / true rates (score-worthiness gate) =='
SELECT
  round(100.0*count(*) FILTER (WHERE is_framework_agreement)/count(*),1)  AS framework_pct,
  round(100.0*count(*) FILTER (WHERE is_eu_funded)/count(*),1)            AS eu_funded_pct,
  round(100.0*count(has_unsecured_funding)/count(*),1)                    AS unsecured_fill_pct,
  round(100.0*count(*) FILTER (WHERE change_notice_count > 0)/count(*),1) AS has_change_notice_pct,
  round(100.0*count(legal_basis)/count(*),1)                             AS legal_basis_fill_pct
FROM tenders;
