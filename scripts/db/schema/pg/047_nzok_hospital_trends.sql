-- НЗОК hospital-payment momentum — the time dimension the competitor (Диагноза
-- България, single-year 2025) structurally lacks. Reads the SAME multi-period
-- corpus as 045 (nzok_hospital_payments, 2023-2026 monthly) but exposes the
-- national monthly series + a year-over-year comparison of the latest YTD figure
-- against the same month of the prior year, per facility. Display-only (no static
-- JSON parity target), but keeps the determinism conventions — ROUND-ed sums,
-- COLLATE "C" name mins, explicit ORDER BY tiebreaks — so local == cloud.

-- The €-floor a facility's prior-year YTD must clear to be RANKED as a mover /
-- peer (below it, % swings are noise). Defined ONCE here so the trends payload's
-- moverBaseFloorEur, the trends mover filter and the per-EIK percentile function
-- all share one value — the momentum tile and the /company percentile badge must
-- rank the same base set.
CREATE OR REPLACE FUNCTION nzok_mover_floor_eur()
RETURNS bigint IMMUTABLE LANGUAGE sql AS $$ SELECT 2000000::bigint $$;

CREATE OR REPLACE FUNCTION nzok_hospital_payments_trends()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH latest AS (SELECT max(period) AS p FROM nzok_hospital_payments),
  prior AS (SELECT ((SELECT p FROM latest) - interval '1 year')::date AS p),
  -- National monthly series (every ingested month, ascending) — the trend line.
  natl AS (
    SELECT period,
           ROUND(SUM(month_eur))::bigint      AS month_eur,
           ROUND(SUM(cumulative_eur))::bigint AS cumulative_eur,
           COUNT(*)::int                      AS facility_count
    FROM nzok_hospital_payments
    GROUP BY period
  ),
  -- Latest-period YTD per facility (a facility can appear once per period only,
  -- but GROUP BY keeps it robust to any dup and lets us carry name/eik).
  cur AS (
    SELECT reg_no,
           min(name COLLATE "C") AS name,
           min(eik)              AS eik,
           SUM(cumulative_eur)   AS ytd
    FROM nzok_hospital_payments
    WHERE period = (SELECT p FROM latest)
    GROUP BY reg_no
  ),
  -- Same month, prior year — YTD is directly comparable (both cumulative from
  -- Jan 1), so a facility's growth is cur.ytd / pri.ytd - 1.
  pri AS (
    SELECT reg_no, SUM(cumulative_eur) AS ytd
    FROM nzok_hospital_payments
    WHERE period = (SELECT p FROM prior)
    GROUP BY reg_no
  )
  SELECT CASE
    WHEN (SELECT p FROM latest) IS NULL THEN NULL
    ELSE jsonb_build_object(
      'asOf', to_char((SELECT p FROM latest) + interval '1 month' - interval '1 day', 'YYYY-MM-DD'),
      'currentPeriod', to_char((SELECT p FROM latest), 'YYYY-MM'),
      'priorPeriod',   to_char((SELECT p FROM prior),  'YYYY-MM'),
      'hasPriorYear',  EXISTS (SELECT 1 FROM pri),
      -- The €-floor the momentum tile filters its movers at, emitted so the tile
      -- reads it instead of hard-coding its own copy (single-sourced via
      -- nzok_mover_floor_eur()).
      'moverBaseFloorEur', nzok_mover_floor_eur(),
      'national', (
        SELECT jsonb_agg(jsonb_build_object(
                  'period',        to_char(period, 'YYYY-MM'),
                  'monthEur',      month_eur,
                  'cumulativeEur', cumulative_eur,
                  'facilityCount', facility_count)
                ORDER BY period)
        FROM natl
      ),
      -- National YTD now vs same-month-prior-year YTD.
      'currentYtdEur', (SELECT ROUND(SUM(ytd))::bigint FROM cur),
      'priorYtdEur',   (SELECT ROUND(SUM(ytd))::bigint FROM pri),
      -- Top facilities by current YTD, each with its prior-year YTD (null when the
      -- facility wasn't reported a year ago) so the client can compute the delta.
      'facilities', (
        SELECT jsonb_agg(x) FROM (
          SELECT jsonb_build_object(
                   'regNo',         c.reg_no,
                   'name',          c.name,
                   'eik',           c.eik,
                   'currentYtdEur', ROUND(c.ytd)::bigint,
                   'priorYtdEur',   CASE WHEN p.ytd IS NULL THEN NULL ELSE ROUND(p.ytd)::bigint END)
                 AS x
          FROM cur c
          LEFT JOIN pri p USING (reg_no)
          ORDER BY ROUND(c.ytd) DESC, c.reg_no
          LIMIT 40
        ) q
      )
    )
  END;
$$;

-- One company's spend-growth PERCENTILE among all hospitals — the transparent,
-- published-formula answer to the competitor's black-box "AI anomaly" flags.
-- Reports the EIK's YTD-vs-same-month-prior-year growth and the share of peer
-- hospitals it grew faster than, ranked only over hospitals whose prior-year base
-- clears the floor (so a €5k→€60k facility can't masquerade as a top mover).
-- NULL when the EIK isn't a matched hospital, has no prior-year figure, or sits
-- below the base floor. Powers the percentile badge on /company/:eik.
CREATE OR REPLACE FUNCTION nzok_hospital_momentum_by_eik(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH latest AS (SELECT max(period) AS p FROM nzok_hospital_payments),
  prior AS (SELECT ((SELECT p FROM latest) - interval '1 year')::date AS p),
  cur AS (
    SELECT eik, SUM(cumulative_eur) AS ytd
    FROM nzok_hospital_payments
    WHERE period = (SELECT p FROM latest) AND eik IS NOT NULL
    GROUP BY eik
  ),
  pri AS (
    SELECT eik, SUM(cumulative_eur) AS ytd
    FROM nzok_hospital_payments
    WHERE period = (SELECT p FROM prior) AND eik IS NOT NULL
    GROUP BY eik
  ),
  -- Per-EIK YoY, ranked only where the prior-year base is meaningful — the same
  -- floor the momentum tile uses, single-sourced via nzok_mover_floor_eur().
  yoy AS (
    SELECT c.eik, c.ytd AS cur_ytd, p.ytd AS pri_ytd,
           c.ytd / p.ytd - 1 AS delta
    FROM cur c JOIN pri p USING (eik)
    WHERE p.ytd >= nzok_mover_floor_eur()
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM yoy WHERE eik = p_eik) THEN NULL
  ELSE (
    SELECT jsonb_build_object(
      'currentPeriod', to_char((SELECT p FROM latest), 'YYYY-MM'),
      'priorPeriod',   to_char((SELECT p FROM prior),  'YYYY-MM'),
      'currentYtdEur', ROUND(t.cur_ytd)::bigint,
      'priorYtdEur',   ROUND(t.pri_ytd)::bigint,
      'yoyDelta',      t.delta,
      'peerCount',     (SELECT count(*)::int FROM yoy),
      -- Share of peers this hospital grew strictly faster than (0..1).
      'percentile', (
        SELECT count(*)::double precision FROM yoy y WHERE y.delta < t.delta
      ) / NULLIF((SELECT count(*) FROM yoy), 0),
      'medianDelta', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY delta) FROM yoy)
    )
    FROM yoy t WHERE t.eik = p_eik
  ) END;
$$;
