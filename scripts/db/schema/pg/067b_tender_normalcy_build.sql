-- 067b — BUILD the tender_normalcy_cache TABLE (created empty in 067). Runs only
-- where we COMPUTE the payloads: the local Postgres. The rows are COPYed to Cloud
-- SQL by load_tenders_pg (the shared-core instance can't build the windowed
-- matview — temp_file_limit 53400). Deterministic function of `tenders`.
SET maintenance_work_mem = '1GB';
SET work_mem = '512MB';
TRUNCATE tender_normalcy_cache;
INSERT INTO tender_normalcy_cache (unp, payload)
  WITH base_all AS (
    SELECT unp, cpv, estimated_value_eur AS val,
           tender_window_days(publication_date, submission_deadline) AS win,
           procedure_type, is_cancelled, is_eu_funded, publication_date,
           CASE WHEN publication_date ~ '^[0-9]{4}-[0-9]{2}'
                THEN substr(publication_date, 1, 4)::int * 12 + substr(publication_date, 6, 2)::int - 1 END AS mnum
    FROM tenders
  ),
  base AS (SELECT * FROM base_all WHERE cpv IS NOT NULL AND mnum IS NOT NULL),
  -- Expand to 5 CPV prefixes so every join is an equi-join on (len, prefix)
  -- (a per-row `left(cpv,len)=prefix` predicate forces a nested loop → huge spill).
  base_prefixes AS (
    SELECT b.unp, b.val, b.win, b.procedure_type, b.is_cancelled, b.is_eu_funded,
           b.publication_date, b.mnum, v.len, left(b.cpv, v.len) AS prefix
    FROM base b CROSS JOIN (VALUES (8), (5), (4), (3), (2)) v(len)
  ),
  mp AS (
    SELECT len, prefix, mnum, count(*)::int AS n FROM base_prefixes GROUP BY len, prefix, mnum
  ),
  wc AS (
    SELECT len, prefix, mnum,
           sum(n) OVER (PARTITION BY len, prefix ORDER BY mnum
                        RANGE BETWEEN 30 PRECEDING AND 30 FOLLOWING)::int AS wn
    FROM mp
  ),
  chosen AS (
    SELECT bp.unp, bp.mnum,
           COALESCE(max(bp.len) FILTER (WHERE wc.wn >= 30), 2) AS plen
    FROM base_prefixes bp JOIN wc USING (len, prefix, mnum)
    GROUP BY bp.unp, bp.mnum
  ),
  tgt AS (
    SELECT ch.unp, ch.mnum, ch.plen AS len, left(b.cpv, ch.plen) AS prefix
    FROM chosen ch JOIN base b USING (unp)
  ),
  used AS (SELECT DISTINCT len, prefix, mnum FROM tgt),
  cohort_members AS (
    SELECT u.len, u.prefix, u.mnum AS tmnum,
           bp.unp AS munp, bp.val, bp.win, bp.procedure_type, bp.is_cancelled,
           bp.is_eu_funded, bp.publication_date
    FROM used u
    JOIN base_prefixes bp
      ON bp.len = u.len AND bp.prefix = u.prefix
     AND bp.mnum >= u.mnum - 30 AND bp.mnum <= u.mnum + 30
  ),
  cohort_stats AS (
    SELECT len, prefix, tmnum, left(prefix, 2) AS division,
           count(*) FILTER (WHERE val IS NOT NULL AND val > 0)::int AS v_n,
           percentile_cont(0.10) WITHIN GROUP (ORDER BY val) FILTER (WHERE val > 0) AS v_p10,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY val) FILTER (WHERE val > 0) AS v_p25,
           percentile_cont(0.50) WITHIN GROUP (ORDER BY val) FILTER (WHERE val > 0) AS v_med,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY val) FILTER (WHERE val > 0) AS v_p75,
           percentile_cont(0.90) WITHIN GROUP (ORDER BY val) FILTER (WHERE val > 0) AS v_p90,
           count(*) FILTER (WHERE win IS NOT NULL)::int AS w_n,
           percentile_cont(0.10) WITHIN GROUP (ORDER BY win) FILTER (WHERE win IS NOT NULL) AS w_p10,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY win) FILTER (WHERE win IS NOT NULL) AS w_p25,
           percentile_cont(0.50) WITHIN GROUP (ORDER BY win) FILTER (WHERE win IS NOT NULL) AS w_med,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY win) FILTER (WHERE win IS NOT NULL) AS w_p75,
           percentile_cont(0.90) WITHIN GROUP (ORDER BY win) FILTER (WHERE win IS NOT NULL) AS w_p90,
           avg((win < 14)::int) FILTER (WHERE win IS NOT NULL)::double precision AS w_short,
           count(*) FILTER (WHERE procedure_type IS NOT NULL
             AND btrim(procedure_type) <> '')::int AS proc_n,
           avg((procurement_procedure_bucket(procedure_type) = 'open')::int)
             FILTER (WHERE procedure_type IS NOT NULL
               AND btrim(procedure_type) <> '')::double precision AS proc_open,
           avg(is_cancelled::int)::double precision AS cancelled_share,
           avg(is_eu_funded::int)::double precision AS eu_funded_share,
           left(min(publication_date), 4) AS year_from,
           left(max(publication_date), 4) AS year_to
    FROM cohort_members GROUP BY len, prefix, tmnum
  ),
  member_ranks AS (
    SELECT munp AS unp, len, prefix, tmnum,
           (rank() OVER (PARTITION BY len, prefix, tmnum ORDER BY val) - 1)::numeric AS v_below,
           (rank() OVER (PARTITION BY len, prefix, tmnum ORDER BY win) - 1)::numeric AS w_below
    FROM cohort_members
  )
  SELECT ba.unp, jsonb_build_object(
    'unp', ba.unp,
    'cohort', CASE WHEN ba.cpv IS NULL OR ba.mnum IS NULL THEN NULL ELSE jsonb_build_object(
      'division',       cs.division,
      'cpvPrefix',      t.prefix,
      'cpvLen',         t.len,
      'n',              cs.v_n,
      'yearFrom',       cs.year_from,
      'yearTo',         cs.year_to,
      'sufficient',     cs.v_n >= 30,
      'windowMonths',   30,
      'cancelledShare', cs.cancelled_share,
      'euFundedShare',  cs.eu_funded_share
    ) END,
    'value', CASE WHEN cs.v_n IS NULL OR cs.v_n = 0 OR ba.val IS NULL OR ba.val <= 0
      THEN NULL ELSE jsonb_build_object(
      'dir', 'neutral', 'value', ba.val, 'n', cs.v_n,
      'p10', ROUND(cs.v_p10::numeric, 2), 'p25', ROUND(cs.v_p25::numeric, 2), 'median', ROUND(cs.v_med::numeric, 2), 'p75', ROUND(cs.v_p75::numeric, 2), 'p90', ROUND(cs.v_p90::numeric, 2),
      'percentile', ROUND(mr.v_below / NULLIF(cs.v_n, 0), 4)
    ) END,
    'window', CASE WHEN cs.w_n IS NULL OR cs.w_n = 0 OR ba.win IS NULL THEN NULL ELSE jsonb_build_object(
      'dir', 'low', 'value', ba.win, 'n', cs.w_n,
      'p10', ROUND(cs.w_p10::numeric, 2), 'p25', ROUND(cs.w_p25::numeric, 2), 'median', ROUND(cs.w_med::numeric, 2), 'p75', ROUND(cs.w_p75::numeric, 2), 'p90', ROUND(cs.w_p90::numeric, 2),
      'shortShare', cs.w_short, 'isShort', ba.win < 14,
      'percentile', ROUND(mr.w_below / NULLIF(cs.w_n, 0), 4)
    ) END,
    'procedure', CASE WHEN cs.proc_n IS NULL OR cs.proc_n = 0 OR ba.procedure_type IS NULL THEN NULL ELSE jsonb_build_object(
      'bucket', procurement_procedure_bucket(ba.procedure_type),
      'isOpen', procurement_procedure_bucket(ba.procedure_type) = 'open',
      'openShare', cs.proc_open, 'n', cs.proc_n
    ) END
  ) AS payload
  FROM base_all ba
  LEFT JOIN tgt t ON t.unp = ba.unp
  LEFT JOIN cohort_stats cs ON cs.len = t.len AND cs.prefix = t.prefix AND cs.tmnum = t.mnum
  LEFT JOIN member_ranks mr ON mr.unp = ba.unp AND mr.len = t.len AND mr.prefix = t.prefix AND mr.tmnum = t.mnum;

