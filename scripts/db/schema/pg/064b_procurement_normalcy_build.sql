-- 064b — BUILD the procurement_normalcy_cache TABLE (created empty in 064).
-- Runs only where we COMPUTE the payloads: the local Postgres. The rows are then
-- COPYed to Cloud SQL by load_pg.ts, so this NEVER runs on the prod (shared-core)
-- instance. Deterministic function of `contracts`.
--
-- COHORT = same-CPV adaptive-prefix contracts within the target's MONTH +/-30
-- months (month-aligned), the SAME definition as the reference fn (063). This is
-- the set-based, whole-corpus port of that per-key fn: it replaces the earlier
-- 3-era bucketing (which lumped all of 2020-2026 into one cohort) with a true
-- +/-30-month window. Key trick for feasibility: targets sharing a (cpv-prefix,
-- month) share one cohort, so the window is precomputable as a monthly-count
-- window frame (RANGE +/-30) for the adaptive-prefix pick, plus one
-- (prefix, target-month)-keyed membership join for the percentiles/ranks. The
-- target is INCLUDED in its own cohort (matches the fn + the shared-cohort
-- convention; ~1/n effect at the >=30 floor).
--
-- Month arithmetic: mnum = year*12 + (month-1), so year = mnum / 12 exactly and
-- the +/-30-month window is [mnum-30, mnum+30]. Parity with the fn's
-- month-aligned date bounds is exact.
-- Build with generous memory so the big membership sort/aggregate stays mostly in
-- RAM. Session-scoped, so this only affects the build connection.
SET maintenance_work_mem = '1GB';
SET work_mem = '512MB';
TRUNCATE procurement_normalcy_cache;
INSERT INTO procurement_normalcy_cache (key, payload)
  WITH base_all AS (
    SELECT key, cpv, amount_eur, number_of_tenderers, procurement_method,
           awarder_eik, contractor_eik, date, left(cpv, 2) AS div,
           CASE WHEN date ~ '^[0-9]{4}-[0-9]{2}'
                THEN substr(date, 1, 4)::int * 12 + substr(date, 6, 2)::int - 1 END AS mnum
    FROM contracts WHERE tag = 'contract'
  ),
  -- Cohort computation runs only on cpv-bearing, dated rows; a cpv-less/undated
  -- contract still gets a cached row (concentration only), never the live path.
  base AS (SELECT * FROM base_all WHERE cpv IS NOT NULL AND mnum IS NOT NULL),
  -- Expand each contract into its 5 candidate CPV prefixes so EVERY downstream
  -- join is a plain equi-join on (len, prefix) — the membership join below is
  -- otherwise a `left(cpv,len)=prefix` predicate with a per-row length, which the
  -- planner can only satisfy with a nested loop (catastrophic: 340 GB of temp).
  base_prefixes AS (
    SELECT b.key, b.amount_eur, b.number_of_tenderers, b.procurement_method,
           b.mnum, v.len, left(b.cpv, v.len) AS prefix
    FROM base b CROSS JOIN (VALUES (8), (5), (4), (3), (2)) v(len)
  ),
  -- Per-(prefix-length, prefix, month) contract counts.
  mp AS (
    SELECT len, prefix, mnum, count(*)::int AS n
    FROM base_prefixes GROUP BY len, prefix, mnum
  ),
  -- Windowed count: for each (len, prefix, month) sum the monthly counts over the
  -- +/-30-month window. This is the adaptive-prefix denominator, computed once per
  -- (len, prefix, month) instead of per target.
  wc AS (
    SELECT len, prefix, mnum,
           sum(n) OVER (PARTITION BY len, prefix ORDER BY mnum
                        RANGE BETWEEN 30 PRECEDING AND 30 FOLLOWING)::int AS wn
    FROM mp
  ),
  -- Each contract's chosen prefix length: the finest whose windowed count at its
  -- own (prefix, month) clears 30; else the 2-digit division. Mirrors the fn's
  -- "finest with n>=30, COALESCE(...,2)".
  chosen AS (
    SELECT bp.key, bp.mnum,
           COALESCE(max(bp.len) FILTER (WHERE wc.wn >= 30), 2) AS plen
    FROM base_prefixes bp
    JOIN wc USING (len, prefix, mnum)
    GROUP BY bp.key, bp.mnum
  ),
  -- Each contract paired with the cohort it is compared against: (chosen prefix,
  -- own month). Targets sharing (prefix, month) share a cohort.
  tgt AS (
    SELECT ch.key, ch.mnum, ch.plen AS len, left(b.cpv, ch.plen) AS prefix
    FROM chosen ch JOIN base b USING (key)
  ),
  used AS (SELECT DISTINCT len, prefix, mnum FROM tgt),
  -- Cohort membership: every contract sharing the cohort's prefix within the
  -- cohort target-month's +/-30-month window. Carries mkey so the target's own
  -- rank falls out of a window function (the target is a member of its cohort).
  cohort_members AS (
    SELECT u.len, u.prefix, u.mnum AS tmnum,
           bp.key AS mkey, bp.amount_eur, bp.number_of_tenderers, bp.procurement_method,
           bp.mnum AS cmnum
    FROM used u
    JOIN base_prefixes bp
      ON bp.len = u.len AND bp.prefix = u.prefix
     AND bp.mnum >= u.mnum - 30 AND bp.mnum <= u.mnum + 30
  ),
  cohort_stats AS (
    SELECT len, prefix, tmnum, left(prefix, 2) AS division,
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
           (min(cmnum) / 12)::text AS year_from,
           (max(cmnum) / 12)::text AS year_to
    FROM cohort_members GROUP BY len, prefix, tmnum
  ),
  -- rank()-1 = count strictly below within the cohort. The target is a member, so
  -- its own rank comes straight from the partitioned window (joined back by mkey).
  member_ranks AS (
    SELECT mkey AS key, len, prefix, tmnum,
           (rank() OVER (PARTITION BY len, prefix, tmnum ORDER BY amount_eur) - 1)::numeric AS v_below,
           (rank() OVER (PARTITION BY len, prefix, tmnum ORDER BY number_of_tenderers) - 1)::numeric AS b_below
    FROM cohort_members
  ),
  -- concentration: per awarder (all-time), each supplier's share of buyer spend.
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
    'cohort', CASE WHEN ba.cpv IS NULL OR ba.mnum IS NULL THEN NULL ELSE jsonb_build_object(
      'division',     cs.division,
      'cpvPrefix',    t.prefix,
      'cpvLen',       t.len,
      'n',            cs.v_n,
      'yearFrom',     cs.year_from,
      'yearTo',       cs.year_to,
      'sufficient',   cs.v_n >= 30,
      'windowMonths', 30
    ) END,
    'value', CASE WHEN cs.v_n IS NULL OR cs.v_n = 0 OR ba.amount_eur IS NULL THEN NULL ELSE jsonb_build_object(
      'dir', 'neutral', 'value', ba.amount_eur, 'n', cs.v_n,
      'p10', ROUND(cs.v_p10::numeric, 2), 'p25', ROUND(cs.v_p25::numeric, 2), 'median', ROUND(cs.v_med::numeric, 2), 'p75', ROUND(cs.v_p75::numeric, 2), 'p90', ROUND(cs.v_p90::numeric, 2),
      'percentile', ROUND(mr.v_below / NULLIF(cs.v_n, 0), 4)
    ) END,
    'bidders', CASE WHEN cs.b_n IS NULL OR cs.b_n = 0 OR ba.number_of_tenderers IS NULL THEN NULL ELSE jsonb_build_object(
      'dir', 'low', 'value', ba.number_of_tenderers, 'n', cs.b_n,
      'p10', ROUND(cs.b_p10::numeric, 2), 'p25', ROUND(cs.b_p25::numeric, 2), 'median', ROUND(cs.b_med::numeric, 2), 'p75', ROUND(cs.b_p75::numeric, 2), 'p90', ROUND(cs.b_p90::numeric, 2),
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
  LEFT JOIN cohort_stats cs ON cs.len = t.len AND cs.prefix = t.prefix AND cs.tmnum = t.mnum
  LEFT JOIN member_ranks mr ON mr.key = ba.key AND mr.len = t.len AND mr.prefix = t.prefix AND mr.tmnum = t.mnum
  LEFT JOIN aw_rank ar ON ar.awarder_eik = ba.awarder_eik AND ar.contractor_eik = ba.contractor_eik
  LEFT JOIN aw_stats ast ON ast.awarder_eik = ba.awarder_eik;
