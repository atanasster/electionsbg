-- Award-criterion mix (ЗОП чл. 70) over the tender corpus — the "how do we buy"
-- lens that complements procurement_benchmarks (037, "how competitive is it").
--
-- WHAT THIS IS NOT: `tenders.award_method` is the BID-EVALUATION rule applied at
-- award time, before any delivery. It is NOT payment-for-outcome, and MEAT
-- ("оптимално съотношение качество/цена") is not an outcomes-based contract.
-- Copy on every surface says „критерий за оценка на офертите", never „плащане за
-- резултат". See docs/plans/procurement-outcomes-v1.md §0a.
--
-- DENOMINATOR — competitive procedures only, and this predicate is defined HERE,
-- independently of 037's `no_call`. They are NOT the same set and must not be
-- shared (plan §10b, measured 2026-08-17):
--   * 037 reads contracts.procurement_method; this reads tenders.procedure_type.
--     The vocabularies intersect on 17 values but diverge — contracts also carries
--     the OCDS codes open/limited/selective/direct and „Вътрешен конкурентен избор
--     по РС", and 45% of contracts rows have no method at all.
--   * 037's list INCLUDES „Покана до определени лица", which here is 0.0% blank
--     across 2,229 tenders — it always carries a criterion, so excluding it would
--     drop 2,229 criterion-bearing rows from the denominator.
--   * 037's list OMITS three types that genuinely carry no criterion.
--
-- The rule is semantic, not a blank-rate threshold: a procedure with no call for
-- bids has no competitive evaluation, so it has no criterion to record. Measured
-- blank rates on the 2020+ corpus confirm the split cleanly —
--   no-call (this list):  74.6% – 85.9% blank
--   call-bearing:          0.0% – 55.8% blank
-- The residual blanks inside call-bearing types are genuine missing data and stay
-- visible as `unknown`; they are never dropped or redistributed (plan §1b).
--
-- Note „Ограничена процедура по ДСП" and „…по КС" are deliberately NOT here: a
-- dynamic purchasing system / qualification system WAS called for, so those are
-- competitive procedures whose criterion is sometimes unrecorded.
--
-- FIELD STARTS IN 2020. award_method is a ЦАИС ЕОП-era column — 119,461 tenders
-- before it exists carry NULL. Rendering 2018-2026 as a series draws a
-- data-availability cliff as a policy change, so byYear is floored at 2020 IN THE
-- FUNCTION rather than left to each consumer, and the rows excluded that way are
-- reported as `preCriterionTenders` so the omission stays visible.
--
-- Value sums are `estimated_value_eur` — FORECASTS, never spend. The 009
-- quarantine applies, so the key is named `estimatedEur` and every consumer leads
-- with counts. Depends on tenders (009). EXECUTE auto-granted to app_readonly.

SET check_function_bodies = off;

-- The function reads four narrow columns from a 329 MB heap, so without a
-- covering index every call is a full heap scan (42,136 buffers measured). With
-- it the pass is Index Only, and the tile stops being the most expensive thing on
-- the /procurement dashboard. publication_date leads because it is also the
-- window predicate.
CREATE INDEX IF NOT EXISTS idx_tenders_award_criteria
  ON tenders (publication_date)
  INCLUDE (procedure_type, award_method, contract_type);


-- The four procedure types that carry no call for bids, hence no award criterion.
-- IMMUTABLE so it inlines; kept as a function so the list has exactly one home and
-- award_criteria.data.test.ts can assert against it directly.
--
-- Returns FALSE (not NULL) for an unrecorded procedure_type. `IN` is three-valued,
-- so a bare `p_type IN (...)` yields NULL there — and a NULL predicate satisfies
-- neither `no_call` nor `NOT no_call`, so such a row would leave the coverage
-- partition entirely: competitive + noCall + preCriterion would quietly stop
-- summing to total. There are 0 such rows today, which is exactly why this has to
-- be closed now rather than when one appears.
--
-- FALSE is the safe direction: an unknown procedure counts as competitive, so its
-- criterion (or its absence) stays visible in the split instead of being excluded
-- as if we had established it was a direct award.
CREATE OR REPLACE FUNCTION procurement_no_call_procedure(p_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_type IN (
    'Договаряне без предварително обявление',
    'Пряко договаряне',
    'Договаряне без предварителна покана за участие',
    'Договаряне без публикуване на обявление за поръчка'
  ), false);
$$;

-- Bucket one award_method value. The semicolon test MUST come first: the corpus
-- carries three semicolon-joined values, and a bare LIKE '%качество%' would pull
-- „Оптимално съотношение качество/цена; Най-ниска цена" into `meat` and overstate
-- it by ~600 tenders.
--
-- `unknown` means NOT STATED (NULL). `other` means a non-null value this function
-- does not recognise — a deliberately separate bucket so that an 8th criterion
-- string appearing in a future ingest surfaces as its own band instead of hiding
-- inside "not stated" (plan §6e). The data test asserts `other` is empty.
CREATE OR REPLACE FUNCTION procurement_award_criterion_bucket(p_method text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN NULLIF(TRIM(COALESCE(p_method, '')), '') IS NULL THEN 'unknown'
    WHEN p_method LIKE '%;%'                              THEN 'combined'
    WHEN p_method LIKE 'Оптимално съотношение качество/цена%' THEN 'meat'
    WHEN p_method LIKE 'Най-ниска цена%'                  THEN 'price'
    WHEN p_method LIKE 'Разходи%'                         THEN 'lcc'
    ELSE 'other'
  END;
$$;

CREATE OR REPLACE FUNCTION procurement_award_criteria(
  p_from text DEFAULT NULL,
  p_to text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
-- PERFORMANCE: this runs on every /procurement view, so it must stay near one
-- scan of `tenders`. The first cut computed the coverage counters and the two
-- breakdowns as six independent subqueries over a materialised CTE — measured
-- 188,591 buffers with a 4,748-block temp spill and 658 ms, on the same dashboard
-- whose six sibling routes had to be precomputed (124) after timing out at 10 s
-- on Cloud SQL. Folding the two breakdowns into one GROUPING SETS pass and the
-- counters into a single aggregate keeps it to two scans and no spill.
WITH t AS (
  SELECT left(publication_date, 4) AS yr,
         NULLIF(TRIM(COALESCE(contract_type, '')), '') AS ctype,
         procurement_award_criterion_bucket(award_method) AS bucket,
         procurement_no_call_procedure(procedure_type) AS no_call
  FROM tenders
  WHERE publication_date >= COALESCE(p_from, '')
    AND publication_date <  COALESCE(p_to, '9999-99-99')
),
cov AS (
  SELECT jsonb_build_object(
           'total',               count(*),
           'noCall',              count(*) FILTER (WHERE no_call),
           'competitive',         count(*) FILTER (WHERE NOT no_call AND yr >= '2020'),
           'preCriterionTenders', count(*) FILTER (WHERE NOT no_call AND yr <  '2020')
         ) AS j
  FROM t
),
-- byYear and byType come out of ONE pass over the same rows, which is also what
-- guarantees they share a denominator: an earlier cut filtered `unknown` out of
-- byType only, so the two blocks printed a MEAT share of the same name against
-- two different bases under one legend.
g AS (
  SELECT grouping(yr) AS g_yr,
         yr,
         ctype,
         count(*) AS total,
         count(*) FILTER (WHERE bucket = 'price')    AS price,
         count(*) FILTER (WHERE bucket = 'meat')     AS meat,
         count(*) FILTER (WHERE bucket = 'lcc')      AS lcc,
         count(*) FILTER (WHERE bucket = 'combined') AS combined,
         count(*) FILTER (WHERE bucket = 'other')    AS other,
         count(*) FILTER (WHERE bucket = 'unknown')  AS unknown
  FROM t
  WHERE NOT no_call AND yr >= '2020'
  GROUP BY GROUPING SETS ((yr), (ctype))
),
-- Each CTE is referenced EXACTLY ONCE below. Four scalar `(SELECT … FROM cov)`
-- subqueries re-evaluated the chain four times over — measured 188,590 buffers
-- against the 42,136 one pass actually costs.
years AS (
  SELECT jsonb_agg(jsonb_build_object(
           'year', yr, 'total', total, 'price', price, 'meat', meat,
           'lcc', lcc, 'combined', combined, 'other', other, 'unknown', unknown
         ) ORDER BY yr) AS j
  FROM g WHERE g_yr = 0
),
types AS (
  SELECT jsonb_agg(jsonb_build_object(
           'contractType', COALESCE(ctype, 'unspecified'),
           'total', total, 'price', price, 'meat', meat,
           'lcc', lcc, 'combined', combined, 'other', other, 'unknown', unknown
         ) ORDER BY COALESCE(ctype, 'unspecified')) AS j
  FROM g WHERE g_yr = 1
)
SELECT jsonb_build_object(
  'firstYear', '2020',
  'coverage', (SELECT j FROM cov),
  'byYear',   COALESCE((SELECT j FROM years), '[]'::jsonb),
  'byType',   COALESCE((SELECT j FROM types), '[]'::jsonb)
);
$$;
