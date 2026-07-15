-- 064b — BUILD the procurement_normalcy_cache TABLE (created empty in 064).
-- Run only where we COMPUTE the cohort payloads: the local Postgres. The rows
-- are then COPYed to Cloud SQL by load_pg.ts, so this NEVER runs on the prod
-- (shared-core) instance. Deterministic function of `contracts`.
-- Build with generous memory so the member-rank sorts stay in RAM. Cloud SQL's
-- small default work_mem spilled them to disk (~15 min); in RAM it is ~1-2 min.
-- Session-scoped, so this only affects the apply/load connection.
SET maintenance_work_mem = '1GB';
SET work_mem = '256MB';
TRUNCATE procurement_normalcy_cache;
INSERT INTO procurement_normalcy_cache (key, payload)
  WITH base_all AS (
    SELECT key, cpv, amount_eur, number_of_tenderers, procurement_method,
           awarder_eik, contractor_eik, date, procurement_era(date) AS era
    FROM contracts WHERE tag = 'contract'
  ),
  -- Cohort computation runs only on cpv-bearing rows; a cpv-less contract still
  -- gets a cached row (concentration only), so it never falls to the live path.
  base AS (SELECT * FROM base_all WHERE cpv IS NOT NULL),
  -- Expand each contract into its 5 candidate CPV prefixes (× era), so the
  -- adaptive-prefix pick and the cohort membership are plain equi-joins.
  base_prefixes AS (
    SELECT b.key, b.amount_eur, b.number_of_tenderers, b.procurement_method,
           b.date, b.era, v.len, left(b.cpv, v.len) AS prefix
    FROM base b CROSS JOIN (VALUES (8), (5), (4), (3), (2)) v(len)
  ),
  pc AS (
    SELECT len, prefix, era, count(*)::int AS n
    FROM base_prefixes GROUP BY len, prefix, era
  ),
  -- Each contract's chosen prefix length: the finest whose (prefix, era) has >=30.
  chosen AS (
    SELECT bp.key, COALESCE(max(bp.len) FILTER (WHERE pc.n >= 30), 2) AS plen
    FROM base_prefixes bp JOIN pc USING (len, prefix, era)
    GROUP BY bp.key
  ),
  -- Each contract paired with the cohort IT is compared against: its chosen
  -- (prefix, era). Cohorts OVERLAP — a fine-cpv contract is also a member of the
  -- coarser cohort a sibling uses — which is why membership below is a prefix
  -- join, not a single partition. (The earlier group-by-own-prefix build wrongly
  -- fragmented the cohort: CPV 71311 read 25 instead of 89.)
  tgt AS (
    SELECT b.key, b.amount_eur, b.number_of_tenderers, b.procurement_method,
           b.era, c.plen AS len, left(b.cpv, c.plen) AS prefix
    FROM base b JOIN chosen c USING (key)
  ),
  used AS (SELECT DISTINCT len, prefix, era FROM tgt),
  -- Every contract that belongs to each USED cohort (shares its prefix + era) —
  -- this is the live function's "all sharing the target's prefix".
  members AS (
    SELECT bp.key, bp.amount_eur, bp.number_of_tenderers, bp.procurement_method,
           bp.date, bp.len, bp.prefix, bp.era
    FROM base_prefixes bp JOIN used u USING (len, prefix, era)
  ),
  cohort_stats AS (
    SELECT len, prefix, era, left(prefix, 2) AS division,
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
    FROM members GROUP BY len, prefix, era
  ),
  -- rank()-1 = count strictly below within the cohort (nulls sort last, so a
  -- non-null target's rank counts only the non-null values below it).
  member_ranks AS (
    SELECT key, len, prefix, era,
           (rank() OVER (PARTITION BY len, prefix, era ORDER BY amount_eur) - 1)::numeric AS v_below,
           (rank() OVER (PARTITION BY len, prefix, era ORDER BY number_of_tenderers) - 1)::numeric AS b_below
    FROM members
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
      'cpvPrefix',  t.prefix,
      'cpvLen',     t.len,
      'n',          cs.v_n,
      'yearFrom',   cs.year_from,
      'yearTo',     cs.year_to,
      'sufficient', cs.v_n >= 30
    ) END,
    'value', CASE WHEN cs.v_n IS NULL OR cs.v_n = 0 OR ba.amount_eur IS NULL THEN NULL ELSE jsonb_build_object(
      'dir', 'neutral', 'value', ba.amount_eur, 'n', cs.v_n,
      'p10', cs.v_p10, 'p25', cs.v_p25, 'median', cs.v_med, 'p75', cs.v_p75, 'p90', cs.v_p90,
      'percentile', ROUND(mr.v_below / NULLIF(cs.v_n, 0), 4)
    ) END,
    'bidders', CASE WHEN cs.b_n IS NULL OR cs.b_n = 0 OR ba.number_of_tenderers IS NULL THEN NULL ELSE jsonb_build_object(
      'dir', 'low', 'value', ba.number_of_tenderers, 'n', cs.b_n,
      'p10', cs.b_p10, 'p25', cs.b_p25, 'median', cs.b_med, 'p75', cs.b_p75, 'p90', cs.b_p90,
      'singleShare', cs.b_single, 'singleBidder', ba.number_of_tenderers = 1,
      'percentile', ROUND(mr.b_below / NULLIF(cs.b_n, 0), 4)
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
  LEFT JOIN tgt t ON t.key = ba.key
  LEFT JOIN cohort_stats cs ON cs.len = t.len AND cs.prefix = t.prefix AND cs.era = t.era
  LEFT JOIN member_ranks mr ON mr.key = ba.key AND mr.len = t.len AND mr.prefix = t.prefix AND mr.era = t.era
  LEFT JOIN aw_rank ar ON ar.awarder_eik = ba.awarder_eik AND ar.contractor_eik = ba.contractor_eik
  LEFT JOIN aw_stats ast ON ast.awarder_eik = ba.awarder_eik;

