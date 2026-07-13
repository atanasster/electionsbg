-- Precompute for "how normal is this procurement?" (migration 063). The live
-- procurement_normalcy() scans a whole CPV division with heap fetches for the
-- non-indexed metric columns — ~290ms warm but ~90MB of cold Cloud SQL buffer
-- reads (6-12s) per uncached contract, and the /api/db route is not CDN-cached,
-- so every first view paid it. This turns a view into a PK seek.
--
-- TWO changes vs 063:
--   1. The cohort is (adaptive CPV prefix × ERA), not a per-target ±30-month
--      window. Era buckets — pre-2015 / 2015-2019 / 2020+ — keep the comparison
--      era-matched (procurement value drifts with inflation across a 15-year
--      corpus) while being SET-BASED: every contract sharing a (prefix, era)
--      shares one cohort, so percentiles come from window functions in a few
--      passes instead of a per-row scan. The adaptive prefix floor (n>=30) is
--      evaluated WITHIN the era. Concentration stays all-time — a supplier's
--      share of a buyer's lifetime spend isn't an era question.
--   2. procurement_normalcy_cache — one precomputed payload per contract,
--      byte-for-byte the shape procurement_normalcy() returns, served by PK. The
--      route seeks the cache and falls back to the live function for a key not
--      yet built (freshly ingested between refreshes).
--
-- The live function is rewritten to the SAME (prefix, era) cohort so the cache
-- and the fallback are byte-identical (parity-checked).

-- Era bucket for a contract by its notice year. String compare on the YYYY head
-- (the date is 'YYYY-MM-DD' text) — no date parsing, so a blank/malformed date
-- degrades to NULL (its own tiny bucket) rather than raising.
CREATE OR REPLACE FUNCTION procurement_era(p_date text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_date IS NULL OR btrim(p_date) = '' THEN NULL
    WHEN left(p_date, 4) < '2015' THEN 'e1'
    WHEN left(p_date, 4) < '2020' THEN 'e2'
    ELSE 'e3'
  END;
$$;

-- --------------------------------------------------------------------------
-- Live function — (prefix, era) cohort (fallback + reference implementation).
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurement_normalcy(p_key text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH tgt AS (
    SELECT key, cpv, amount_eur, number_of_tenderers, procurement_method,
           awarder_eik, contractor_eik, left(cpv, 2) AS div,
           procurement_era(date) AS era
    FROM contracts
    WHERE key = p_key AND tag = 'contract'
  ),
  -- Same division + same era as the target (self INCLUDED — a contract is a
  -- member of its own cohort; self never counts in "strictly below", and this
  -- keeps the fallback byte-identical to the matview build).
  pool AS (
    SELECT c.cpv, c.amount_eur, c.number_of_tenderers, c.procurement_method, c.date
    FROM contracts c CROSS JOIN tgt
    WHERE tgt.cpv IS NOT NULL
      AND c.tag = 'contract'
      AND left(c.cpv, 2) = tgt.div
      AND procurement_era(c.date) IS NOT DISTINCT FROM tgt.era
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
    SELECT pool.amount_eur, pool.number_of_tenderers, pool.procurement_method,
           pool.date
    FROM pool CROSS JOIN tgt CROSS JOIN chosen
    WHERE left(pool.cpv, chosen.plen) = left(tgt.cpv, chosen.plen)
  ),
  val AS (
    SELECT count(*)::int AS n,
           percentile_cont(0.10) WITHIN GROUP (ORDER BY amount_eur) AS p10,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY amount_eur) AS p25,
           percentile_cont(0.50) WITHIN GROUP (ORDER BY amount_eur) AS median,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY amount_eur) AS p75,
           percentile_cont(0.90) WITHIN GROUP (ORDER BY amount_eur) AS p90
    FROM cohort WHERE amount_eur IS NOT NULL
  ),
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
  proc AS (
    SELECT count(*) FILTER (WHERE procurement_method IS NOT NULL
             AND btrim(procurement_method) <> '')::int AS n,
           avg((procurement_procedure_bucket(procurement_method) = 'open')::int)
             FILTER (WHERE procurement_method IS NOT NULL
               AND btrim(procurement_method) <> '')::double precision AS open_share
    FROM cohort
  ),
  -- Concentration: ALL-TIME (a supplier's share of the buyer's lifetime spend).
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
           ROUND((s / NULLIF((SELECT total FROM aw_tot), 0))::numeric, 10) AS share
    FROM aw
  ),
  conc AS (
    SELECT (SELECT peer_n FROM aw_tot) AS peer_n,
           ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY share)::numeric, 10) AS median,
           ROUND(percentile_cont(0.75) WITHIN GROUP (ORDER BY share)::numeric, 10) AS p75,
           ROUND(percentile_cont(0.90) WITHIN GROUP (ORDER BY share)::numeric, 10) AS p90,
           (SELECT share FROM aw_share s CROSS JOIN tgt
             WHERE s.contractor_eik = tgt.contractor_eik) AS mine
    FROM aw_share
  ),
  -- Span over the PREFIX cohort (not the division pool) so yearFrom/yearTo match
  -- the cohort `n` the header shows — and the set-based cache, which spans the
  -- prefix cohort too.
  span AS (SELECT min(date) AS d0, max(date) AS d1 FROM cohort)
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM tgt) THEN NULL ELSE jsonb_build_object(
    'key', p_key,
    'cohort', CASE WHEN (SELECT cpv FROM tgt) IS NULL THEN NULL ELSE jsonb_build_object(
      'division',   (SELECT div FROM tgt),
      'cpvPrefix',  left((SELECT cpv FROM tgt), (SELECT plen FROM chosen)),
      'cpvLen',     (SELECT plen FROM chosen),
      'n',          (SELECT n FROM val),
      'yearFrom',   left((SELECT d0 FROM span), 4),
      'yearTo',     left((SELECT d1 FROM span), 4),
      'sufficient', (SELECT n FROM val) >= 30
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

-- --------------------------------------------------------------------------
-- Precomputed per-contract payload — the SET-BASED build of the same output.
-- rank()-1 over a cohort = the count strictly below (ties share the min rank),
-- exactly the live function's `count(value < x)`, so the percentiles match to the
-- same ROUND(…,4). Cohort partition key = (cpv-prefix, era). One row per signed
-- contract; served by PK.
-- --------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS procurement_normalcy_cache CASCADE;
CREATE MATERIALIZED VIEW procurement_normalcy_cache AS
  WITH base_all AS (
    SELECT key, cpv, amount_eur, number_of_tenderers, procurement_method,
           awarder_eik, contractor_eik, date, procurement_era(date) AS era
    FROM contracts WHERE tag = 'contract'
  ),
  -- Cohort computation runs only on cpv-bearing rows; a cpv-less contract still
  -- gets a cached row (concentration only), so it never falls to the live path.
  base AS (SELECT * FROM base_all WHERE cpv IS NOT NULL),
  -- per (prefix-length, prefix, era) contract counts, for the adaptive prefix pick
  pc AS (
    SELECT v.len, left(b.cpv, v.len) AS prefix, b.era, count(*)::int AS n
    FROM base b CROSS JOIN (VALUES (8), (5), (4), (3), (2)) v(len)
    GROUP BY v.len, left(b.cpv, v.len), b.era
  ),
  chosen_len AS (
    SELECT b.key,
           COALESCE(max(v.len) FILTER (WHERE pc.n >= 30), 2) AS plen
    FROM base b
    CROSS JOIN (VALUES (8), (5), (4), (3), (2)) v(len)
    JOIN pc ON pc.len = v.len AND pc.prefix = left(b.cpv, v.len)
           AND pc.era IS NOT DISTINCT FROM b.era
    GROUP BY b.key
  ),
  assigned AS (
    SELECT b.*, left(b.cpv, cl.plen) AS cpv_prefix, cl.plen,
           left(b.cpv, cl.plen) || '#' || COALESCE(b.era, '?') AS cohort_ck
    FROM base b JOIN chosen_len cl USING (key)
  ),
  cohort_stats AS (
    SELECT cohort_ck,
           min(cpv_prefix) AS cpv_prefix,
           min(left(cpv_prefix, 2)) AS division,
           min(plen) AS plen,
           count(*) FILTER (WHERE amount_eur IS NOT NULL)::int AS v_n,
           percentile_cont(0.10) WITHIN GROUP (ORDER BY amount_eur) AS v_p10,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY amount_eur) AS v_p25,
           percentile_cont(0.50) WITHIN GROUP (ORDER BY amount_eur) AS v_med,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY amount_eur) AS v_p75,
           percentile_cont(0.90) WITHIN GROUP (ORDER BY amount_eur) AS v_p90,
           count(*) FILTER (WHERE number_of_tenderers IS NOT NULL)::int AS b_n,
           percentile_cont(0.10) WITHIN GROUP (ORDER BY number_of_tenderers)
             FILTER (WHERE number_of_tenderers IS NOT NULL) AS b_p10,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY number_of_tenderers)
             FILTER (WHERE number_of_tenderers IS NOT NULL) AS b_p25,
           percentile_cont(0.50) WITHIN GROUP (ORDER BY number_of_tenderers)
             FILTER (WHERE number_of_tenderers IS NOT NULL) AS b_med,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY number_of_tenderers)
             FILTER (WHERE number_of_tenderers IS NOT NULL) AS b_p75,
           percentile_cont(0.90) WITHIN GROUP (ORDER BY number_of_tenderers)
             FILTER (WHERE number_of_tenderers IS NOT NULL) AS b_p90,
           avg((number_of_tenderers = 1)::int)
             FILTER (WHERE number_of_tenderers IS NOT NULL)::double precision AS b_single,
           count(*) FILTER (WHERE procurement_method IS NOT NULL
             AND btrim(procurement_method) <> '')::int AS proc_n,
           avg((procurement_procedure_bucket(procurement_method) = 'open')::int)
             FILTER (WHERE procurement_method IS NOT NULL
               AND btrim(procurement_method) <> '')::double precision AS proc_open,
           left(min(date), 4) AS year_from,
           left(max(date), 4) AS year_to
    FROM assigned GROUP BY cohort_ck
  ),
  v_rank AS (
    SELECT key,
           (rank() OVER (PARTITION BY cohort_ck ORDER BY amount_eur) - 1)::numeric AS below
    FROM assigned WHERE amount_eur IS NOT NULL
  ),
  b_rank AS (
    SELECT key,
           (rank() OVER (PARTITION BY cohort_ck ORDER BY number_of_tenderers) - 1)::numeric AS below
    FROM assigned WHERE number_of_tenderers IS NOT NULL
  ),
  -- concentration: per awarder (all-time), each supplier's share of buyer spend
  aw AS (
    SELECT awarder_eik, contractor_eik, sum(amount_eur) AS s
    FROM contracts
    WHERE tag = 'contract' AND amount_eur IS NOT NULL AND contractor_eik <> ''
    GROUP BY awarder_eik, contractor_eik
  ),
  aw_tot AS (SELECT awarder_eik, sum(s) AS total, count(*)::int AS peer_n FROM aw GROUP BY awarder_eik),
  aw_share AS (
    SELECT a.awarder_eik, a.contractor_eik,
           ROUND((a.s / NULLIF(t.total, 0))::numeric, 10) AS share, t.peer_n
    FROM aw a JOIN aw_tot t USING (awarder_eik)
  ),
  aw_stats AS (
    SELECT awarder_eik, peer_n,
           ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY share)::numeric, 10) AS median,
           ROUND(percentile_cont(0.75) WITHIN GROUP (ORDER BY share)::numeric, 10) AS p75,
           ROUND(percentile_cont(0.90) WITHIN GROUP (ORDER BY share)::numeric, 10) AS p90
    FROM aw_share GROUP BY awarder_eik, peer_n
  ),
  aw_rank AS (
    SELECT awarder_eik, contractor_eik, share, peer_n,
           (rank() OVER (PARTITION BY awarder_eik ORDER BY share) - 1)::numeric AS below
    FROM aw_share
  )
  SELECT ba.key, jsonb_build_object(
    'key', ba.key,
    'cohort', CASE WHEN ba.cpv IS NULL THEN NULL ELSE jsonb_build_object(
      'division',   cs.division,
      'cpvPrefix',  cs.cpv_prefix,
      'cpvLen',     cs.plen,
      'n',          cs.v_n,
      'yearFrom',   cs.year_from,
      'yearTo',     cs.year_to,
      'sufficient', cs.v_n >= 30
    ) END,
    'value', CASE WHEN cs.v_n IS NULL OR cs.v_n = 0 OR ba.amount_eur IS NULL THEN NULL ELSE jsonb_build_object(
      'dir', 'neutral', 'value', ba.amount_eur, 'n', cs.v_n,
      'p10', cs.v_p10, 'p25', cs.v_p25, 'median', cs.v_med, 'p75', cs.v_p75, 'p90', cs.v_p90,
      'percentile', ROUND(vr.below / NULLIF(cs.v_n, 0), 4)
    ) END,
    'bidders', CASE WHEN cs.b_n IS NULL OR cs.b_n = 0 OR ba.number_of_tenderers IS NULL THEN NULL ELSE jsonb_build_object(
      'dir', 'low', 'value', ba.number_of_tenderers, 'n', cs.b_n,
      'p10', cs.b_p10, 'p25', cs.b_p25, 'median', cs.b_med, 'p75', cs.b_p75, 'p90', cs.b_p90,
      'singleShare', cs.b_single, 'singleBidder', ba.number_of_tenderers = 1,
      'percentile', ROUND(br.below / NULLIF(cs.b_n, 0), 4)
    ) END,
    'procedure', CASE WHEN cs.proc_n IS NULL OR cs.proc_n = 0 OR ba.procurement_method IS NULL THEN NULL ELSE jsonb_build_object(
      'bucket', procurement_procedure_bucket(ba.procurement_method),
      'isOpen', procurement_procedure_bucket(ba.procurement_method) = 'open',
      'openShare', cs.proc_open, 'n', cs.proc_n
    ) END,
    'concentration', CASE WHEN ar.share IS NULL OR ar.peer_n < 3 THEN NULL ELSE jsonb_build_object(
      'dir', 'high', 'value', ar.share, 'peerN', ar.peer_n,
      'median', ast.median, 'p75', ast.p75, 'p90', ast.p90,
      'percentile', ROUND(ar.below / NULLIF(ar.peer_n, 0), 4)
    ) END
  ) AS payload
  FROM base_all ba
  LEFT JOIN assigned a ON a.key = ba.key
  LEFT JOIN cohort_stats cs ON cs.cohort_ck = a.cohort_ck
  LEFT JOIN v_rank vr ON vr.key = ba.key
  LEFT JOIN b_rank br ON br.key = ba.key
  LEFT JOIN aw_rank ar ON ar.awarder_eik = ba.awarder_eik AND ar.contractor_eik = ba.contractor_eik
  LEFT JOIN aw_stats ast ON ast.awarder_eik = ba.awarder_eik;

CREATE UNIQUE INDEX IF NOT EXISTS idx_procurement_normalcy_cache_key
  ON procurement_normalcy_cache (key);
