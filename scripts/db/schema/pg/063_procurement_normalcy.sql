-- "How normal is this procurement?" — a DISTRIBUTION reading of one signed
-- contract against a cohort of similar ones. It adds NO new data: it is a
-- percentile view of columns already in `contracts`, the ex-post public
-- complement to an ex-ante control tool (see docs/plans/procurement-normalcy).
--
-- WHAT IT IS, AND ISN'T. This is descriptive, not a verdict. It never emits a
-- single "guilt" score; each metric is positioned in its cohort ("shorter /
-- more concentrated / fewer bidders than X% of similar procurements") and the
-- direction of risk is a hint, not a finding. The per-contract JUDGMENT stays in
-- computeProcurementRisk (the CRI + flags); this panel gives the CONTEXT that
-- makes a flag legible — e.g. single-bidder is only meaningful where the CPV
-- market is normally competitive, which the bidders block quantifies.
--
-- THE COHORT (the proposal's "~120 similar procurements"):
--   * same 2-digit CPV division, refined to the FINEST CPV prefix (8/5/4/3/2)
--     whose cohort still has >=30 rows — adaptive granularity with a sample floor;
--   * era-matched: target date +/- 30 months (sargable on the text `date` via
--     idx_contracts_cpvdiv_date = (tag, left(cpv,2), date) INCLUDE amount_eur),
--     which also bounds the heap fetch for the non-indexed metric columns;
--   * tag = 'contract' only; the target itself is excluded from its own cohort.
--
-- METRICS SHIPPED (only where the corpus actually carries the data):
--   value        amount_eur           CPV cohort     neutral (both tails inform)
--   bidders      number_of_tenderers  CPV cohort     low = weaker competition
--   procedure    procedure bucket     CPV cohort     categorical (share is open)
--   concentration this supplier's share of THIS buyer's spend, vs the buyer's
--                other suppliers                     high = single-supplier reliance
--
-- DELIBERATELY OMITTED: срок за оферти (tender_period_* is 0% populated in the
-- contracts corpus) and estimated-vs-contracted (the tender estimate is the whole
-- procedure, so the ratio is meaningless for multi-lot awards). Both are noted in
-- the UI methodology rather than shipped as empty/misleading strips.
--
-- Determinism (reference_pg_payload_determinism): percentile_cont is
-- deterministic; a percentile is the share of the cohort STRICTLY below the
-- target; ROUND sums; an absent contract / cpv-less row returns NULL for the
-- cohort block (not an object of nulls). `sufficient` is false when the cohort
-- can't clear 30 even at the division level — the UI then says "too few
-- comparators" instead of drawing a misleading strip.

-- --------------------------------------------------------------------------
-- Procedure-family bucketer — the SQL port of src/lib/cpvSectors.procedureBucket,
-- so the cohort's "open-procedure share" folds the OCDS enums and the Bulgarian
-- АОП phrases the same way the client does. Order mirrors the TS: exact enum
-- match first, then substring rules.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurement_procedure_bucket(p_method text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_method IS NULL OR btrim(p_method) = ''            THEN 'unknown'
    WHEN lower(btrim(p_method)) = 'open'                     THEN 'open'
    WHEN lower(btrim(p_method)) = 'selective'                THEN 'competition'
    WHEN lower(btrim(p_method)) IN ('limited', 'direct')     THEN 'direct'
    WHEN lower(p_method) LIKE '%открит%'                     THEN 'open'
    WHEN lower(p_method) LIKE '%събиране на оферт%'          THEN 'collection'
    WHEN lower(p_method) LIKE '%пряко%'
      OR lower(p_method) LIKE '%без обявление%'
      OR lower(p_method) LIKE '%без публикуване%'
      OR lower(p_method) LIKE '%договаряне без%'             THEN 'direct'
    WHEN lower(p_method) LIKE '%състеза%'
      OR lower(p_method) LIKE '%конкурс%'                    THEN 'competition'
    WHEN lower(p_method) LIKE '%рамков%'                     THEN 'framework'
    WHEN lower(p_method) LIKE '%неизвест%'                   THEN 'unknown'
    ELSE 'other'
  END;
$$;

-- --------------------------------------------------------------------------
-- One contract's normalcy card. NULL when the key is unknown / not a signed
-- contract. The `cohort` block is null when the contract has no CPV (nothing to
-- compare against); the concentration block still resolves off the buyer.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurement_normalcy(p_key text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH tgt AS (
    SELECT key, cpv, amount_eur, number_of_tenderers, procurement_method,
           awarder_eik, contractor_eik, date,
           left(cpv, 2)                 AS div,
           to_date(date, 'YYYY-MM-DD')  AS d
    FROM contracts
    WHERE key = p_key AND tag = 'contract'
  ),
  -- Windowed division pool: era-matched (+/-30 months) and division-scoped so the
  -- scan rides idx_contracts_cpvdiv_date and the heap fetch for the non-indexed
  -- metric columns is bounded. Empty when the target has no CPV.
  pool AS (
    SELECT c.cpv, c.amount_eur, c.number_of_tenderers, c.procurement_method, c.date
    FROM contracts c CROSS JOIN tgt
    WHERE tgt.cpv IS NOT NULL
      AND c.tag = 'contract'
      AND left(c.cpv, 2) = tgt.div
      AND c.date >= to_char(tgt.d - interval '30 months', 'YYYY-MM-DD')
      AND c.date <= to_char(tgt.d + interval '30 months', 'YYYY-MM-DD')
      AND c.key <> tgt.key
  ),
  -- Adaptive CPV prefix: the finest length whose cohort still clears 30. A wider
  -- prefix never has fewer rows, so "finest with n>=30" is well-defined.
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
    SELECT pool.amount_eur, pool.number_of_tenderers, pool.procurement_method
    FROM pool CROSS JOIN tgt CROSS JOIN chosen
    WHERE left(pool.cpv, chosen.plen) = left(tgt.cpv, chosen.plen)
  ),
  -- Value distribution (amount_eur) — neutral direction.
  val AS (
    SELECT count(*)::int AS n,
           percentile_cont(0.10) WITHIN GROUP (ORDER BY amount_eur) AS p10,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY amount_eur) AS p25,
           percentile_cont(0.50) WITHIN GROUP (ORDER BY amount_eur) AS median,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY amount_eur) AS p75,
           percentile_cont(0.90) WITHIN GROUP (ORDER BY amount_eur) AS p90
    FROM cohort WHERE amount_eur IS NOT NULL
  ),
  -- Bidder-count distribution — low = weaker competition. Only rows that publish
  -- a realised bid count (~54% of the corpus) enter this cohort.
  bids AS (
    SELECT count(*)::int AS n,
           percentile_cont(0.10) WITHIN GROUP (ORDER BY number_of_tenderers) AS p10,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY number_of_tenderers) AS p25,
           percentile_cont(0.50) WITHIN GROUP (ORDER BY number_of_tenderers) AS median,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY number_of_tenderers) AS p75,
           percentile_cont(0.90) WITHIN GROUP (ORDER BY number_of_tenderers) AS p90,
           avg((number_of_tenderers = 1)::int)::double precision AS single_share
    FROM cohort WHERE number_of_tenderers IS NOT NULL
  ),
  -- Procedure mix — the share of the cohort that ran an OPEN procedure (the most
  -- competitive family), and this contract's own bucket.
  proc AS (
    SELECT count(*) FILTER (WHERE procurement_method IS NOT NULL
             AND btrim(procurement_method) <> '')::int AS n,
           avg((procurement_procedure_bucket(procurement_method) = 'open')::int)
             FILTER (WHERE procurement_method IS NOT NULL
               AND btrim(procurement_method) <> '')::double precision AS open_share
    FROM cohort
  ),
  -- Supplier concentration on THIS buyer: every supplier's lifetime share of the
  -- buyer's contracted spend, and where the target's supplier sits among them.
  aw AS (
    SELECT c.contractor_eik, sum(c.amount_eur) AS s
    FROM contracts c CROSS JOIN tgt
    WHERE c.awarder_eik = tgt.awarder_eik AND c.tag = 'contract'
      AND c.amount_eur IS NOT NULL AND c.contractor_eik <> ''
    GROUP BY c.contractor_eik
  ),
  aw_tot AS (SELECT sum(s) AS total, count(*)::int AS peer_n FROM aw),
  aw_share AS (
    SELECT contractor_eik,
           s / NULLIF((SELECT total FROM aw_tot), 0) AS share
    FROM aw
  ),
  conc AS (
    SELECT (SELECT peer_n FROM aw_tot) AS peer_n,
           percentile_cont(0.50) WITHIN GROUP (ORDER BY share) AS median,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY share) AS p75,
           percentile_cont(0.90) WITHIN GROUP (ORDER BY share) AS p90,
           (SELECT share FROM aw_share s CROSS JOIN tgt
             WHERE s.contractor_eik = tgt.contractor_eik) AS mine
    FROM aw_share
  ),
  -- Cohort year span (from the WINDOWED division pool, not the prefix cohort, so
  -- the label reflects the comparison horizon even for a fine prefix).
  span AS (SELECT min(date) AS d0, max(date) AS d1 FROM pool)
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM tgt) THEN NULL ELSE jsonb_build_object(
    'key', p_key,
    'cohort', CASE WHEN (SELECT cpv FROM tgt) IS NULL THEN NULL ELSE jsonb_build_object(
      'division',    (SELECT div FROM tgt),
      'cpvPrefix',   left((SELECT cpv FROM tgt), (SELECT plen FROM chosen)),
      'cpvLen',      (SELECT plen FROM chosen),
      'n',           (SELECT n FROM val),
      'windowMonths', 30,
      'yearFrom',    left((SELECT d0 FROM span), 4),
      'yearTo',      left((SELECT d1 FROM span), 4),
      'sufficient',  (SELECT n FROM val) >= 30
    ) END,
    'value', CASE WHEN (SELECT n FROM val) = 0 OR (SELECT amount_eur FROM tgt) IS NULL
      THEN NULL ELSE jsonb_build_object(
      'dir', 'neutral',
      'value',  (SELECT amount_eur FROM tgt),
      'n',      (SELECT n FROM val),
      'p10',    (SELECT p10 FROM val), 'p25', (SELECT p25 FROM val),
      'median', (SELECT median FROM val),
      'p75',    (SELECT p75 FROM val), 'p90', (SELECT p90 FROM val),
      'percentile', (SELECT ROUND((count(*) FILTER (
                       WHERE amount_eur < (SELECT amount_eur FROM tgt)))::numeric
                       / NULLIF((SELECT n FROM val), 0), 4) FROM cohort
                     WHERE amount_eur IS NOT NULL)
    ) END,
    'bidders', CASE WHEN (SELECT n FROM bids) = 0 OR (SELECT number_of_tenderers FROM tgt) IS NULL
      THEN NULL ELSE jsonb_build_object(
      'dir', 'low',
      'value',  (SELECT number_of_tenderers FROM tgt),
      'n',      (SELECT n FROM bids),
      'p10',    (SELECT p10 FROM bids), 'p25', (SELECT p25 FROM bids),
      'median', (SELECT median FROM bids),
      'p75',    (SELECT p75 FROM bids), 'p90', (SELECT p90 FROM bids),
      'singleShare', (SELECT single_share FROM bids),
      'singleBidder', (SELECT number_of_tenderers FROM tgt) = 1,
      'percentile', (SELECT ROUND((count(*) FILTER (
                       WHERE number_of_tenderers < (SELECT number_of_tenderers FROM tgt)))::numeric
                       / NULLIF((SELECT n FROM bids), 0), 4) FROM cohort
                     WHERE number_of_tenderers IS NOT NULL)
    ) END,
    'procedure', CASE WHEN (SELECT n FROM proc) = 0 OR (SELECT procurement_method FROM tgt) IS NULL
      THEN NULL ELSE jsonb_build_object(
      'bucket',    procurement_procedure_bucket((SELECT procurement_method FROM tgt)),
      'isOpen',    procurement_procedure_bucket((SELECT procurement_method FROM tgt)) = 'open',
      'openShare', (SELECT open_share FROM proc),
      'n',         (SELECT n FROM proc)
    ) END,
    'concentration', CASE WHEN (SELECT mine FROM conc) IS NULL OR (SELECT peer_n FROM conc) < 3
      THEN NULL ELSE jsonb_build_object(
      'dir', 'high',
      'value',  (SELECT mine FROM conc),
      'peerN',  (SELECT peer_n FROM conc),
      'median', (SELECT median FROM conc),
      'p75',    (SELECT p75 FROM conc),
      'p90',    (SELECT p90 FROM conc),
      'percentile', (SELECT ROUND((count(*) FILTER (WHERE share < (SELECT mine FROM conc)))::numeric
                       / NULLIF((SELECT peer_n FROM conc), 0), 4) FROM aw_share)
    ) END
  ) END;
$$;
