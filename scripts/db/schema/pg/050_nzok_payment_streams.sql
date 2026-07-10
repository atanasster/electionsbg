-- НЗОК pays a hospital through THREE separate monthly reports, published side by
-- side on the same nhif.bg/bg/hospitals/bmp/{year} listing page:
--
--   bmp      болнична медицинска помощ            €2.271bn  (FY2025, 388 facilities)
--   drugs    лекарствени продукти в условията на БМП  €0.799bn  (48 facilities)
--   devices  медицински изделия, прилагани в БМП    €0.059bn  (107 facilities)
--
-- 045 ingested only the first. Every per-hospital figure the site showed was
-- therefore the БМП slice, not the money a hospital actually received — УМБАЛ
-- „Света Екатерина" read €16.2M for FY2025 against a real НЗОК income roughly half
-- again as large. This migration adds the `stream` dimension and rewrites the two
-- 045 payload functions to sum across streams while exposing the split.
--
-- What deliberately does NOT change: the 047 trend + momentum functions stay
-- `stream = 'bmp'` only. They read a 2023→ monthly series, and the drugs/devices
-- backfill starts later; folding them in would print a step change in the national
-- chart that is an artefact of ingest coverage, not of spending. They are pinned,
-- and the pinning is asserted by the WHERE clause rather than left implicit.

ALTER TABLE nzok_hospital_payments
  ADD COLUMN IF NOT EXISTS stream text NOT NULL DEFAULT 'bmp';

-- Widen the PK: one facility reports in one period once PER STREAM.
ALTER TABLE nzok_hospital_payments DROP CONSTRAINT IF EXISTS nzok_hospital_payments_pkey;
ALTER TABLE nzok_hospital_payments
  ADD CONSTRAINT nzok_hospital_payments_pkey PRIMARY KEY (reg_no, period, stream);

ALTER TABLE nzok_hospital_payments DROP CONSTRAINT IF EXISTS nzok_hospital_payments_stream_ck;
ALTER TABLE nzok_hospital_payments
  ADD CONSTRAINT nzok_hospital_payments_stream_ck
  CHECK (stream IN ('bmp', 'drugs', 'devices'));

-- The 045 indexes stay useful (both lead with a column the new queries still
-- filter on), but every read now also narrows by stream.
CREATE INDEX IF NOT EXISTS idx_nzok_hp_stream_period
  ON nzok_hospital_payments (stream, period DESC);
CREATE INDEX IF NOT EXISTS idx_nzok_hp_eik_stream_period
  ON nzok_hospital_payments (eik, stream, period DESC);

-- The reporting anchor for the TIME SERIES (047): `bmp` is the stream that runs
-- unbroken across every month we ingest, so it defines "now".
CREATE OR REPLACE FUNCTION nzok_latest_period() RETURNS date LANGUAGE sql STABLE AS $$
  SELECT max(period) FROM nzok_hospital_payments WHERE stream = 'bmp';
$$;

-- Each stream's OWN newest ingested month.
--
-- The three reports are published on their own cadences and the drugs/devices
-- files reconcile for fewer months than бмп does, so pinning all three to
-- `nzok_latest_period()` would silently drop a stream from the snapshot the
-- moment it lagged — devices currently ends 2026-02 against bmp's 2026-05, and
-- every hospital's total would quietly lose its devices money with nothing in
-- the payload to say so. Taking each stream at its own latest period keeps the
-- totals whole; `periodByStream` in the payload reports the as-of per stream so
-- the UI can footnote the mismatch instead of hiding it.
CREATE OR REPLACE VIEW nzok_hospital_payments_latest_rows AS
  SELECT h.*
  FROM nzok_hospital_payments h
  JOIN (
    SELECT stream, max(period) AS d FROM nzok_hospital_payments GROUP BY stream
  ) lat ON lat.stream = h.stream AND lat.d = h.period;

-- Latest-period snapshot, summed across streams. Shape is a superset of 045's:
-- `hospitals[]` gains bmpEur/drugsEur/devicesEur, and a top-level `byStream`
-- reports the three national totals. Determinism conventions kept (ROUND before
-- ordering, COLLATE "C", explicit tiebreak) per [[reference_pg_payload_determinism]].
CREATE OR REPLACE FUNCTION nzok_hospital_payments_latest()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH p AS (SELECT nzok_latest_period() AS d),
  raw AS (SELECT * FROM nzok_hospital_payments_latest_rows),
  -- One row per facility: totals across streams, plus the per-stream split.
  -- min(...) picks the identity columns; they agree across a facility's streams
  -- except for `name`, where the drugs/devices reports occasionally spell a
  -- facility differently — the БМП spelling wins because it is the widest report.
  f AS (
    SELECT reg_no,
           COALESCE(min(name) FILTER (WHERE stream = 'bmp'), min(name COLLATE "C")) AS name,
           min(rzok_code COLLATE "C") AS rzok_code,
           min(rzok_name COLLATE "C") AS rzok_name,
           min(eik) AS eik,
           SUM(cumulative_eur) AS cumulative_eur,
           SUM(month_eur)      AS month_eur,
           SUM(cumulative_eur) FILTER (WHERE stream = 'bmp')     AS bmp_eur,
           SUM(cumulative_eur) FILTER (WHERE stream = 'drugs')   AS drugs_eur,
           SUM(cumulative_eur) FILTER (WHERE stream = 'devices') AS devices_eur
    FROM raw GROUP BY reg_no
  )
  SELECT CASE WHEN COUNT(*) = 0 THEN NULL ELSE jsonb_build_object(
    'asOf',  to_char((SELECT d FROM p) + interval '1 month' - interval '1 day', 'YYYY-MM-DD'),
    'year',  extract(year  FROM (SELECT d FROM p))::int,
    'month', extract(month FROM (SELECT d FROM p))::int,
    'currencyOfRecord', (SELECT min(currency COLLATE "C") FROM raw),
    'totalCumulativeEur', ROUND(SUM(cumulative_eur))::bigint,
    -- bmp-only, so it corresponds to a SINGLE month (asOf). Summing month_eur
    -- across streams (via f) would add May's bmp flow to a lagging stream's
    -- earlier month — a "monthly total" with no single as-of. Per-stream month
    -- flow is in byStream for callers that want it. Cumulative sums ARE safe to
    -- combine (period-independent YTD figures, footnoted via periodByStream).
    'monthTotalEur', (
      SELECT ROUND(SUM(month_eur))::bigint FROM raw WHERE stream = 'bmp'
    ),
    'facilityCount',      COUNT(*),
    'periodByStream', (
      SELECT jsonb_object_agg(stream, pd) FROM (
        SELECT stream, to_char(max(period), 'YYYY-MM') AS pd
        FROM nzok_hospital_payments GROUP BY stream
      ) ps
    ),
    'byStream', (
      SELECT jsonb_object_agg(stream, jsonb_build_object(
               'cumulativeEur', ROUND(c)::bigint,
               'monthEur',      ROUND(m)::bigint,
               'facilityCount', n))
      FROM (
        SELECT stream, SUM(cumulative_eur) c, SUM(month_eur) m, COUNT(*) n
        FROM raw GROUP BY stream
      ) s
    ),
    'byRzok', (
      SELECT jsonb_agg(jsonb_build_object(
                'code', rzok_code, 'name', rzok_name,
                'cumulativeEur', ROUND(c)::bigint, 'facilityCount', n)
              ORDER BY ROUND(c) DESC, rzok_code COLLATE "C")
      FROM (
        SELECT rzok_code, min(rzok_name COLLATE "C") AS rzok_name,
               SUM(cumulative_eur) AS c, COUNT(*) AS n
        FROM f GROUP BY rzok_code
      ) g
    ),
    'hospitals', (
      SELECT jsonb_agg(jsonb_build_object(
                'regNo', reg_no, 'name', name,
                'rzokCode', rzok_code, 'rzokName', rzok_name,
                'cumulativeEur', ROUND(cumulative_eur)::bigint,
                'monthEur', ROUND(month_eur)::bigint,
                'bmpEur',     ROUND(COALESCE(bmp_eur, 0))::bigint,
                'drugsEur',   ROUND(COALESCE(drugs_eur, 0))::bigint,
                'devicesEur', ROUND(COALESCE(devices_eur, 0))::bigint,
                'eik', eik)
              ORDER BY ROUND(cumulative_eur) DESC, reg_no COLLATE "C")
      FROM f
    )
  ) END
  FROM f;
$$;

-- One company's НЗОК income for the latest period, summed across its facilities
-- AND its streams, with the split retained per facility and in total.
CREATE OR REPLACE FUNCTION nzok_hospital_reimbursement_by_eik(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH p AS (SELECT nzok_latest_period() AS d),
  raw AS (SELECT * FROM nzok_hospital_payments_latest_rows WHERE eik = p_eik),
  f AS (
    SELECT reg_no,
           COALESCE(min(name) FILTER (WHERE stream = 'bmp'), min(name COLLATE "C")) AS name,
           SUM(cumulative_eur) AS cumulative_eur,
           SUM(month_eur)      AS month_eur,
           SUM(cumulative_eur) FILTER (WHERE stream = 'bmp')     AS bmp_eur,
           SUM(cumulative_eur) FILTER (WHERE stream = 'drugs')   AS drugs_eur,
           SUM(cumulative_eur) FILTER (WHERE stream = 'devices') AS devices_eur
    FROM raw GROUP BY reg_no
  )
  SELECT CASE WHEN COUNT(*) = 0 THEN NULL ELSE jsonb_build_object(
    'asOf', to_char((SELECT d FROM p) + interval '1 month' - interval '1 day', 'YYYY-MM-DD'),
    'totalCumulativeEur', ROUND(SUM(cumulative_eur))::bigint,
    -- bmp-only, matching asOf — see nzok_hospital_payments_latest().
    'totalMonthEur', (
      SELECT ROUND(SUM(month_eur))::bigint FROM raw WHERE stream = 'bmp'
    ),
    'bmpEur',     ROUND(SUM(COALESCE(bmp_eur, 0)))::bigint,
    'drugsEur',   ROUND(SUM(COALESCE(drugs_eur, 0)))::bigint,
    'devicesEur', ROUND(SUM(COALESCE(devices_eur, 0)))::bigint,
    'facilities', jsonb_agg(jsonb_build_object(
                    'regNo', reg_no, 'name', name,
                    'cumulativeEur', ROUND(cumulative_eur)::bigint,
                    'monthEur', ROUND(month_eur)::bigint,
                    'bmpEur',     ROUND(COALESCE(bmp_eur, 0))::bigint,
                    'drugsEur',   ROUND(COALESCE(drugs_eur, 0))::bigint,
                    'devicesEur', ROUND(COALESCE(devices_eur, 0))::bigint)
                  ORDER BY ROUND(cumulative_eur) DESC, reg_no COLLATE "C")
  ) END
  FROM f;
$$;

-- ---------------------------------------------------------------------------
-- 047's trend + momentum functions, PINNED to stream = 'bmp'.
--
-- Redefined here rather than edited in place because 047 runs before this
-- migration on a fresh database, where `stream` does not yet exist. Without the
-- pin they would sum all three streams over a period range in which drugs and
-- devices are only partially backfilled — the national chart would show a step
-- change caused by ingest coverage, and every facility's YoY would compare a
-- three-stream year against a one-stream year. The filters below are the whole
-- point of this block; do not remove them when the backfill catches up without
-- first checking that all three streams cover the full period range.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION nzok_hospital_payments_trends()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH latest AS (SELECT nzok_latest_period() AS p),
  prior AS (SELECT ((SELECT p FROM latest) - interval '1 year')::date AS p),
  natl AS (
    SELECT period,
           ROUND(SUM(month_eur))::bigint      AS month_eur,
           ROUND(SUM(cumulative_eur))::bigint AS cumulative_eur,
           COUNT(*)::int                      AS facility_count
    FROM nzok_hospital_payments
    WHERE stream = 'bmp'
    GROUP BY period
  ),
  cur AS (
    SELECT reg_no,
           min(name COLLATE "C") AS name,
           min(eik)              AS eik,
           SUM(cumulative_eur)   AS ytd
    FROM nzok_hospital_payments
    WHERE stream = 'bmp' AND period = (SELECT p FROM latest)
    GROUP BY reg_no
  ),
  pri AS (
    SELECT reg_no, SUM(cumulative_eur) AS ytd
    FROM nzok_hospital_payments
    WHERE stream = 'bmp' AND period = (SELECT p FROM prior)
    GROUP BY reg_no
  )
  SELECT CASE
    WHEN (SELECT p FROM latest) IS NULL THEN NULL
    ELSE jsonb_build_object(
      'asOf', to_char((SELECT p FROM latest) + interval '1 month' - interval '1 day', 'YYYY-MM-DD'),
      'currentPeriod', to_char((SELECT p FROM latest), 'YYYY-MM'),
      'priorPeriod',   to_char((SELECT p FROM prior),  'YYYY-MM'),
      'hasPriorYear',  EXISTS (SELECT 1 FROM pri),
      'stream', 'bmp',
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
      'currentYtdEur', (SELECT ROUND(SUM(ytd))::bigint FROM cur),
      'priorYtdEur',   (SELECT ROUND(SUM(ytd))::bigint FROM pri),
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
          ORDER BY ROUND(c.ytd) DESC, c.reg_no COLLATE "C"
          LIMIT 40
        ) q
      )
    )
  END;
$$;

CREATE OR REPLACE FUNCTION nzok_hospital_momentum_by_eik(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH latest AS (SELECT nzok_latest_period() AS p),
  prior AS (SELECT ((SELECT p FROM latest) - interval '1 year')::date AS p),
  cur AS (
    SELECT eik, SUM(cumulative_eur) AS ytd
    FROM nzok_hospital_payments
    WHERE stream = 'bmp' AND period = (SELECT p FROM latest) AND eik IS NOT NULL
    GROUP BY eik
  ),
  pri AS (
    SELECT eik, SUM(cumulative_eur) AS ytd
    FROM nzok_hospital_payments
    WHERE stream = 'bmp' AND period = (SELECT p FROM prior) AND eik IS NOT NULL
    GROUP BY eik
  ),
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
      'stream',        'bmp',
      'currentYtdEur', ROUND(t.cur_ytd)::bigint,
      'priorYtdEur',   ROUND(t.pri_ytd)::bigint,
      'yoyDelta',      t.delta,
      'peerCount',     (SELECT count(*)::int FROM yoy),
      'percentile', (
        SELECT count(*)::double precision FROM yoy y WHERE y.delta < t.delta
      ) / NULLIF((SELECT count(*) FROM yoy), 0),
      'medianDelta', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY delta) FROM yoy)
    )
    FROM yoy t WHERE t.eik = p_eik
  ) END;
$$;
