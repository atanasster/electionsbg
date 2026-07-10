-- НЗОК CLINICAL-ACTIVITY corpus — the case-mix denominator the health pack
-- lacked (Phase 3 of docs/plans/nzok-hospital-intelligence-v1.md). Source =
-- НЗОК's monthly "Брой случаи и брой ЗОЛ по КП/АПр/КПр" files
-- (nhif.bg/bg/hospitalcare-report/activities/{year}), parsed + annually
-- aggregated by scripts/nzok/write_activities.ts into
-- data/budget/nzok/activities.json.
--
-- DESIGN RULES, baked into the data and enforced by anything reading it:
--
--   1. CASES ARE VOLUME, NOT VALUE. The source carries the procedure CODE only —
--      no name, no НРД price. `proc_type` is inferred from the code's first
--      letter (P→КП, A→АПр, K→КПр). There is deliberately no лв/€ column: a
--      value-per-pathway join to the НРД catalogue is a documented follow-up.
--
--   2. CASES-PER-BED IS PATHWAY-INTERNAL AND TYPE-GROUPED. The only outlier this
--      corpus supports without a black-box model compares a facility's cases/bed
--      on ONE procedure to the peer median for the SAME procedure among
--      SAME-TYPE hospitals (УМБАЛ vs УМБАЛ). Comparing across procedures or types
--      reproduces the specialty, not a finding. Floors below keep thin cells out.
--
--   3. IT IS A SIGNPOST, NOT A VERDICT. A high cases/bed ratio has legitimate
--      causes (referral concentration, day-case pathways, bed accounting). The
--      corpus invites a closer look; it does not assert over-reporting.
--
--   4. `zol` IS RETAINED, NOT (YET) SURFACED. Брой ЗОЛ (insured persons) is parsed,
--      summed and exposed in the payloads for a planned "cases vs distinct-ish
--      patients" view, but no tile renders it today — deliberately: the annual
--      figure sums MONTHLY counts, so a person treated in several months is counted
--      more than once. It is therefore NOT a clean distinct-patient count and must
--      carry that caveat wherever it is eventually shown.
--
-- The facility key is a NAME FOLD (`facility_fold`) — the source has no Рег.№ ЛЗ.
-- `eik` is attached by the loader's fold crosswalk against nzok_hospital_payments
-- (which spans private hospitals too); it is NULL where the fold does not match.
-- The same fold joins nzok_hospital_financials.name_fold for bed counts.

-- --------------------------------------------------------------------------
-- Annual (facility × procedure) matrix. `period` is the year anchor (Jan 1) so a
-- future monthly grain can share the table. ~20k rows/year.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nzok_activities (
  period        date NOT NULL,               -- year anchor (YYYY-01-01)
  rzok          text NOT NULL,               -- РЗОК region code ("01".."28")
  facility      text NOT NULL,               -- Име ЛЗБП (display)
  facility_fold text NOT NULL,               -- fold of facility, the join key
  eik           text,                        -- from the fold crosswalk; NULL if unmatched
  procedure     text NOT NULL,               -- КП/АПр/КПр code
  proc_type     text NOT NULL,               -- 'КП' | 'АПр' | 'КПр' | ''
  cases         bigint NOT NULL,             -- Брой случаи (annual)
  zol           bigint NOT NULL,             -- Брой ЗОЛ (annual; a person can recur)
  beds          double precision,            -- latest-year ЕЕОФ avg beds (loader crosswalk); NULL if unmatched
  PRIMARY KEY (period, facility_fold, procedure)
);
-- Idempotent add for DBs created by an earlier revision of this migration.
ALTER TABLE nzok_activities ADD COLUMN IF NOT EXISTS beds double precision;
-- An earlier revision shipped a name-fold beds view; the crosswalk is now done in
-- the loader, so drop it.
DROP VIEW IF EXISTS nzok_activity_latest_beds;

-- Per-hospital case-mix (activities_by_eik) — a hospital's rows biggest-first.
CREATE INDEX IF NOT EXISTS idx_nzok_activities_eik
  ON nzok_activities (eik);
-- National per-procedure roll-up + the cases/bed outlier group by procedure.
CREATE INDEX IF NOT EXISTS idx_nzok_activities_proc
  ON nzok_activities (procedure);

-- National monthly cases/ЗОЛ series (for the trend line; the annual matrix above
-- cannot answer "which month"). ~12 rows/year.
CREATE TABLE IF NOT EXISTS nzok_activity_monthly (
  period date NOT NULL PRIMARY KEY,          -- first of the month
  cases  bigint NOT NULL,
  zol    bigint NOT NULL
);

-- Floors for the cases-per-bed outlier, in one place (mirrors the tile footnote).
-- A facility needs at least this many cases on a procedure, this many beds, and
-- this many same-type peers on the procedure before its ratio is comparable.
CREATE OR REPLACE FUNCTION nzok_activity_casebed_min_cases() RETURNS int
  LANGUAGE sql IMMUTABLE AS $$ SELECT 50 $$;
CREATE OR REPLACE FUNCTION nzok_activity_casebed_min_beds() RETURNS int
  LANGUAGE sql IMMUTABLE AS $$ SELECT 20 $$;
CREATE OR REPLACE FUNCTION nzok_activity_casebed_min_peers() RETURNS int
  LANGUAGE sql IMMUTABLE AS $$ SELECT 4 $$;

-- Hospital type from a folded facility name, for peer grouping. Order matters:
-- УМБАЛ/УМБАЛСМ before МБАЛ (both contain "БАЛ"), СБАЛ/СБ before the generic tail.
CREATE OR REPLACE FUNCTION nzok_hospital_type(p_fold text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_fold ~ '(^| )УМБАЛ'  THEN 'УМБАЛ'
    WHEN p_fold ~ '(^| )СБАЛ'   THEN 'СБАЛ'
    WHEN p_fold ~ '(^| )МБАЛ'   THEN 'МБАЛ'
    WHEN p_fold ~ '(^| )СБР'    THEN 'СБР'
    WHEN p_fold ~ '(^| )КОЦ'    THEN 'КОЦ'
    WHEN p_fold ~ '(^| )СБ( |$)' THEN 'СБ'
    WHEN p_fold ~ '(^| )ДКЦ'    THEN 'ДКЦ'
    WHEN p_fold ~ '(^| )МЦ '    THEN 'МЦ'
    ELSE 'ДРУГИ'
  END;
$$;

-- Beds come pre-joined onto nzok_activities.beds by the loader's strong-fold
-- crosswalk (activities/payments/financials spell hospital names differently, so
-- the match is done once in JS rather than as a fragile SQL name-join). The
-- outlier below reads a.beds directly.

-- --------------------------------------------------------------------------
-- Overview payload: national headline + monthly trend + top procedures + the
-- cases-per-bed outlier leaderboard. NULL when the corpus is empty.
--
-- Determinism ([[reference_pg_payload_determinism]]): ROUND-ed sort keys, every
-- ORDER BY carries COLLATE "C" tiebreaks, empty table → NULL.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nzok_activities_overview()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH y AS (SELECT max(period) AS p FROM nzok_activities),
  cur AS (SELECT * FROM nzok_activities WHERE period = (SELECT p FROM y)),
  -- Cases-per-bed outlier: per (procedure, hospital type), each facility's
  -- cases/bed vs the peer median, ranked by ratio. Floors keep thin cells out.
  cb AS (
    SELECT a.facility, a.facility_fold, a.eik, a.procedure, a.proc_type,
           nzok_hospital_type(a.facility_fold) AS htype,
           a.cases, a.beds,
           a.cases::double precision / a.beds AS cases_per_bed
    FROM cur a
    WHERE a.beds IS NOT NULL
      AND a.cases >= nzok_activity_casebed_min_cases()
      AND a.beds >= nzok_activity_casebed_min_beds()
  ),
  -- Peer median + count per (procedure, hospital type). percentile_cont is an
  -- ordered-set aggregate and CANNOT be a window function in Postgres, so it is
  -- computed grouped here and joined back to the per-facility rows below.
  cb_grp AS (
    SELECT procedure, htype,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY cases_per_bed) AS peer_median,
           count(*) AS peer_n
    FROM cb GROUP BY procedure, htype
  ),
  cb_peer AS (
    SELECT cb.*, g.peer_median, g.peer_n
    FROM cb JOIN cb_grp g ON g.procedure = cb.procedure AND g.htype = cb.htype
  ),
  cb_rank AS (
    SELECT *, cases_per_bed / NULLIF(peer_median, 0) AS ratio
    FROM cb_peer
    WHERE peer_n >= nzok_activity_casebed_min_peers()
      AND peer_median > 0
      AND cases_per_bed > peer_median
  )
  SELECT CASE WHEN (SELECT p FROM y) IS NULL THEN NULL ELSE jsonb_build_object(
    'year',              EXTRACT(YEAR FROM (SELECT p FROM y))::int,
    'totalCases',        (SELECT sum(cases)::bigint FROM cur),
    'distinctProcedures',(SELECT count(DISTINCT procedure)::int FROM cur),
    'distinctFacilities',(SELECT count(DISTINCT facility_fold)::int FROM cur),
    'caseBedFloors', jsonb_build_object(
        'minCases', nzok_activity_casebed_min_cases(),
        'minBeds',  nzok_activity_casebed_min_beds(),
        'minPeers', nzok_activity_casebed_min_peers()),
    'monthly', (
      SELECT jsonb_agg(jsonb_build_object(
                'period', to_char(period, 'YYYY-MM'),
                'cases',  cases,
                'zol',    zol) ORDER BY period)
      FROM nzok_activity_monthly),
    -- Top 25 procedures by national cases.
    'topProcedures', (
      SELECT jsonb_agg(jsonb_build_object(
                'procedure',     procedure,
                'procType',      proc_type,
                'cases',         cases,
                'zol',           zol,
                'facilityCount', facility_count)
              ORDER BY cases DESC, procedure COLLATE "C")
      FROM (
        SELECT procedure, min(proc_type COLLATE "C") AS proc_type,
               sum(cases)::bigint AS cases, sum(zol)::bigint AS zol,
               count(*)::int AS facility_count
        FROM cur GROUP BY procedure
        ORDER BY sum(cases) DESC, procedure COLLATE "C"
        LIMIT 25
      ) t),
    -- Top 30 cases-per-bed outliers (signpost, see header rule 3).
    'caseBedOutliers', (
      SELECT jsonb_agg(jsonb_build_object(
                'facility',    facility,
                'eik',         eik,
                'procedure',   procedure,
                'procType',    proc_type,
                'hospitalType',htype,
                'cases',       cases,
                'beds',        ROUND(beds)::int,
                'casesPerBed', ROUND(cases_per_bed::numeric, 2),
                'peerMedian',  ROUND(peer_median::numeric, 2),
                'peerCount',   peer_n,
                'ratio',       ROUND(ratio::numeric, 2))
              ORDER BY ROUND(ratio::numeric, 2) DESC,
                       facility_fold COLLATE "C", procedure COLLATE "C")
      FROM (
        SELECT * FROM cb_rank
        ORDER BY ROUND(ratio::numeric, 2) DESC,
                 facility_fold COLLATE "C", procedure COLLATE "C"
        LIMIT 30
      ) o)
  ) END;
$$;

-- --------------------------------------------------------------------------
-- One hospital's case-mix: its top procedures by cases, its total cases, and its
-- share of the national volume for each procedure. Keyed on the crosswalked EIK.
-- NULL when the EIK has no activity rows.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nzok_activities_by_eik(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH mine AS (
    SELECT * FROM nzok_activities
    WHERE eik = p_eik
      AND period = (SELECT max(period) FROM nzok_activities)
  ),
  nat AS (
    SELECT procedure, sum(cases)::bigint AS nat_cases
    FROM nzok_activities
    WHERE period = (SELECT max(period) FROM nzok_activities)
    GROUP BY procedure
  )
  SELECT CASE WHEN (SELECT count(*) FROM mine) = 0 THEN NULL ELSE jsonb_build_object(
    'eik',        p_eik,
    'year',       (SELECT EXTRACT(YEAR FROM max(period))::int FROM mine),
    'totalCases', (SELECT sum(cases)::bigint FROM mine),
    'procedureCount', (SELECT count(DISTINCT procedure)::int FROM mine),
    'topProcedures', (
      SELECT jsonb_agg(jsonb_build_object(
                'procedure',   m.procedure,
                'procType',    m.proc_type,
                'cases',       m.cases,
                'zol',         m.zol,
                'nationalCases', n.nat_cases,
                'nationalSharePct', ROUND((m.cases::numeric / NULLIF(n.nat_cases,0)) * 100, 1))
              ORDER BY m.cases DESC, m.procedure COLLATE "C")
      FROM (
        SELECT * FROM mine ORDER BY cases DESC, procedure COLLATE "C" LIMIT 25
      ) m
      LEFT JOIN nat n ON n.procedure = m.procedure)
  ) END;
$$;
