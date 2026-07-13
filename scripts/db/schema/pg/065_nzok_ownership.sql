-- НЗОК hospital OWNERSHIP (state | municipal | private) — surfaced on every
-- payment-derived view of the health pack. This is the direct answer to Диагноза
-- България's biggest published gap ("excludes private hospitals"): we include the
-- private sector AND label it, so the pack can headline the private-vs-public
-- split (~44% of НЗОК hospital money flows to private hospitals) and let every
-- tile chip + filter by ownership.
--
-- The `ownership` column is filled at load time from the committed, hand-verified
-- data/budget/nzok/hospital_ownership.json (derived by scripts/nzok/
-- write_hospital_ownership.ts from the МЗ ЕЕОФ roster + manual overrides). It is
-- NULLABLE — a facility the classifier could not place stays NULL and is reported
-- as `unclassified`, never silently folded into private.
--
-- This migration redefines the payload functions from 050 (payments/trends/
-- momentum) AND 054 (risk) to carry ownership, so it is applied by BOTH the
-- payments loader (after 050) and the drug-prices loader (after 054/060).
-- CREATE OR REPLACE keeps re-application idempotent; bodies are validated lazily
-- so it applies on a fresh DB before the activities/financials tables exist.

SET check_function_bodies = false;

ALTER TABLE nzok_hospital_payments
  ADD COLUMN IF NOT EXISTS ownership text;

ALTER TABLE nzok_hospital_payments DROP CONSTRAINT IF EXISTS nzok_hospital_payments_ownership_ck;
ALTER TABLE nzok_hospital_payments
  ADD CONSTRAINT nzok_hospital_payments_ownership_ck
  CHECK (ownership IS NULL OR ownership IN ('state', 'municipal', 'private'));

-- 050's nzok_hospital_payments_latest_rows view is `SELECT h.*`, whose column list
-- Postgres FROZE at view-creation time — before this migration added `ownership`.
-- A `SELECT *` view does NOT pick up a later base-table column, so the payload
-- functions below (which read the view, then reference `ownership`) would break on
-- a clean apply where 065 runs after 050. Re-expand the view here so it includes
-- the new column. (Definition copied verbatim from 050.)
CREATE OR REPLACE VIEW nzok_hospital_payments_latest_rows AS
  SELECT h.*
  FROM nzok_hospital_payments h
  JOIN (
    SELECT stream, max(period) AS d FROM nzok_hospital_payments GROUP BY stream
  ) lat ON lat.stream = h.stream AND lat.d = h.period;

-- A company's ownership = the ownership of its facilities (mode; a legal entity
-- does not mix state/municipal/private across its ЛЗ). Used by the eik-keyed
-- functions (momentum, risk) which have no facility grain of their own.
CREATE OR REPLACE FUNCTION nzok_eik_ownership(p_eik text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT mode() WITHIN GROUP (ORDER BY ownership)
  FROM nzok_hospital_payments
  WHERE eik = p_eik AND ownership IS NOT NULL;
$$;

-- ── 050's latest-period snapshot, now carrying per-facility ownership + a
--    top-level byOwnership split (the private-vs-public headline). ────────────
CREATE OR REPLACE FUNCTION nzok_hospital_payments_latest()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH p AS (SELECT nzok_latest_period() AS d),
  raw AS (SELECT * FROM nzok_hospital_payments_latest_rows),
  f AS (
    SELECT reg_no,
           COALESCE(min(name) FILTER (WHERE stream = 'bmp'), min(name COLLATE "C")) AS name,
           min(rzok_code COLLATE "C") AS rzok_code,
           min(rzok_name COLLATE "C") AS rzok_name,
           min(eik) AS eik,
           min(ownership COLLATE "C") AS ownership,
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
    -- Private-vs-public split. Key is state|municipal|private|unclassified; each
    -- carries its € total + facility count. This is the headline Диагноза cannot
    -- draw (they exclude private entirely).
    'byOwnership', (
      SELECT jsonb_object_agg(COALESCE(ownership, 'unclassified'), jsonb_build_object(
               'cumulativeEur', ROUND(c)::bigint, 'facilityCount', n))
      FROM (
        SELECT ownership, SUM(cumulative_eur) c, COUNT(*) n
        FROM f GROUP BY ownership
      ) o
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
                'ownership', ownership,
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

-- ── 050's per-company reimbursement, now carrying the company's ownership. ────
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
    'ownership', nzok_eik_ownership(p_eik),
    'totalCumulativeEur', ROUND(SUM(cumulative_eur))::bigint,
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

-- ── 050's trend/momentum, now carrying ownership per mover / per company. ─────
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
           min(ownership COLLATE "C") AS ownership,
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
                   'ownership',     c.ownership,
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
      'ownership',     nzok_eik_ownership(p_eik),
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

-- ── 054's risk ranking, now carrying each hospital's ownership. ───────────────
CREATE OR REPLACE FUNCTION nzok_hospital_risk_ranking()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH
  dyear AS (SELECT max(year) AS y FROM nzok_drug_overpay_by_hospital),
  drug AS (
    SELECT eik, facility, overpay_eur, pack_count, inn_count, max_ratio
    FROM nzok_drug_overpay_by_hospital
    WHERE year = (SELECT y FROM dyear)
  ),
  ay AS (SELECT max(period) AS p FROM nzok_activities),
  acur AS (
    SELECT * FROM nzok_activities
    WHERE period = (SELECT p FROM ay) AND eik IS NOT NULL
  ),
  cb AS (
    SELECT a.eik, a.facility, a.procedure,
           nzok_hospital_type(a.facility_fold) AS htype,
           a.cases::double precision / a.beds AS cases_per_bed
    FROM acur a
    WHERE a.beds IS NOT NULL
      AND a.cases >= nzok_activity_casebed_min_cases()
      AND a.beds  >= nzok_activity_casebed_min_beds()
  ),
  cb_grp AS (
    SELECT procedure, htype,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY cases_per_bed) AS peer_median,
           count(*) AS peer_n
    FROM cb GROUP BY procedure, htype
  ),
  act AS (
    SELECT cb.eik, min(cb.facility) AS facility,
           count(*)::int AS outliers,
           ROUND(max(cb.cases_per_bed / NULLIF(g.peer_median, 0))::numeric, 2) AS max_ratio
    FROM cb JOIN cb_grp g ON g.procedure = cb.procedure AND g.htype = cb.htype
    WHERE g.peer_n >= nzok_activity_casebed_min_peers()
      AND g.peer_median > 0
      AND cb.cases_per_bed > g.peer_median
    GROUP BY cb.eik
  ),
  fq AS (SELECT max(quarter) AS q FROM nzok_hospital_financials),
  fin AS (
    SELECT DISTINCT ON (eik) eik, name,
           overdue_liabilities_eur AS overdue_eur,
           overdue_liabilities_revenue_share_pct AS overdue_pct
    FROM nzok_hospital_financials
    WHERE quarter = (SELECT q FROM fq) AND eik IS NOT NULL
      AND overdue_liabilities_eur IS NOT NULL
    ORDER BY eik, overdue_liabilities_eur DESC
  ),
  drug_r AS (SELECT eik, percent_rank() OVER (ORDER BY overpay_eur) AS pr FROM drug),
  act_r  AS (SELECT eik, percent_rank() OVER (ORDER BY outliers)    AS pr FROM act),
  fin_r  AS (SELECT eik, percent_rank() OVER (ORDER BY overdue_eur) AS pr FROM fin),
  eiks AS (
    SELECT eik FROM drug UNION SELECT eik FROM act UNION SELECT eik FROM fin
  ),
  joined AS (
    SELECT e.eik,
           coalesce(d.facility, a.facility, f.name) AS facility,
           d.overpay_eur, d.pack_count, d.inn_count, d.max_ratio AS drug_max_ratio,
           a.outliers, a.max_ratio AS act_max_ratio,
           f.overdue_eur, f.overdue_pct,
           dr.pr AS drug_pr, ar.pr AS act_pr, fr.pr AS fin_pr
    FROM eiks e
    LEFT JOIN drug   d  ON d.eik  = e.eik
    LEFT JOIN act    a  ON a.eik  = e.eik
    LEFT JOIN fin    f  ON f.eik  = e.eik
    LEFT JOIN drug_r dr ON dr.eik = e.eik
    LEFT JOIN act_r  ar ON ar.eik = e.eik
    LEFT JOIN fin_r  fr ON fr.eik = e.eik
  ),
  scored AS (
    SELECT j.*,
           ( (j.drug_pr IS NOT NULL)::int
           + (j.act_pr  IS NOT NULL)::int
           + (j.fin_pr  IS NOT NULL)::int ) AS signals_present,
           ROUND( 100.0 *
             (coalesce(j.drug_pr,0) + coalesce(j.act_pr,0) + coalesce(j.fin_pr,0)) / 3.0
           )::int AS risk_index
    FROM joined j
  )
  SELECT CASE WHEN (SELECT y FROM dyear) IS NULL THEN NULL ELSE jsonb_build_object(
    'drugYear',   (SELECT y FROM dyear),
    'finQuarter', (SELECT q FROM fq),
    'coverage', jsonb_build_object(
       'drug', (SELECT count(*) FROM drug),
       'activity', (SELECT count(*) FROM act),
       'financial', (SELECT count(*) FROM fin)),
    'hospitals', (
      SELECT jsonb_agg(jsonb_build_object(
               'eik',            eik,
               'facility',       facility,
               'ownership',      nzok_eik_ownership(eik),
               'riskIndex',      risk_index,
               'signalsPresent', signals_present,
               'drugOverpayEur', CASE WHEN overpay_eur IS NULL THEN NULL
                                      ELSE ROUND(overpay_eur)::bigint END,
               'drugPackCount',  pack_count,
               'drugInnCount',   inn_count,
               'drugMaxRatio',   drug_max_ratio,
               'activityOutliers', outliers,
               'activityMaxRatio', act_max_ratio,
               'overdueEur',     CASE WHEN overdue_eur IS NULL THEN NULL
                                      ELSE ROUND(overdue_eur)::bigint END,
               'overduePct',     CASE WHEN overdue_pct IS NULL THEN NULL
                                      ELSE ROUND((overdue_pct * 100)::numeric, 1) END)
             ORDER BY risk_index DESC, signals_present DESC,
                      coalesce(overpay_eur,0) DESC, eik)
      FROM (SELECT * FROM scored ORDER BY risk_index DESC, signals_present DESC,
                                          coalesce(overpay_eur,0) DESC, eik
            LIMIT 30) t)
  ) END;
$$;

RESET check_function_bodies;
