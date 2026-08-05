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
--
--   5. THE ROW KEY IS `entity_key`, NEVER THE NAME. НЗОК renames facilities
--      MID-YEAR — it is migrating this feed from mixed-case trade names to
--      ALL-CAPS full legal names, and in 2025 the cutover fell between м.06 and
--      м.07. Keyed on the name fold, the annual matrix carried 463 "facilities"
--      against 376–403 in any single month: every renamed hospital appeared
--      twice with its cases SPLIT and its bed count attached in FULL to both
--      halves, which quietly halved its cases-per-bed ratio and double-counted
--      it in every peer median. `entity_key` is the loader's resolved identity —
--      the EIK when the crosswalk matched, else 'f:'||facility_fold — and every
--      aggregate here groups on it. `facility` is a DISPLAY LABEL ONLY: the name
--      the entity billed under in its LATEST period. Never GROUP BY it.
--
--      The residue is honest, not hidden: ~32% of names never resolve to an EIK,
--      so their halves stay split and are reported per period in the overview's
--      `coverage` block rather than dropped. Re-uniting them needs a curated
--      signature in scripts/db/lib/nzok_activity_eik.ts — brand-token linking was
--      measured and rejected (it recovers 2 facilities and mis-merges genuinely
--      distinct same-town hospitals, e.g. МЦ vs МБАЛ "Д-р Никола Василиев").

-- --------------------------------------------------------------------------
-- Annual (entity × procedure) matrix. `period` is the year anchor (Jan 1) so a
-- future monthly grain can share the table. ~20k rows/year.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nzok_activities (
  period        date NOT NULL,               -- year anchor (YYYY-01-01)
  rzok          text NOT NULL,               -- РЗОК region code ("01".."28")
  facility      text NOT NULL,               -- Име ЛЗБП as billed in the LATEST period (display only)
  facility_fold text NOT NULL,               -- fold of `facility`; peer-type input, NOT the key
  eik           text,                        -- from the fold crosswalk; NULL if unmatched
  entity_key    text NOT NULL,               -- eik, else 'f:'||facility_fold — THE grouping key
  procedure     text NOT NULL,               -- КП/АПр/КПр code
  proc_type     text NOT NULL,               -- 'КП' | 'АПр' | 'КПр' | ''
  cases         bigint NOT NULL,             -- Брой случаи (annual)
  zol           bigint NOT NULL,             -- Брой ЗОЛ (annual; a person can recur)
  beds          double precision,            -- latest-year ЕЕОФ avg beds (loader crosswalk); NULL if unmatched
  PRIMARY KEY (period, entity_key, procedure)
);
-- Idempotent adds for DBs created by an earlier revision of this migration.
ALTER TABLE nzok_activities ADD COLUMN IF NOT EXISTS beds double precision;
ALTER TABLE nzok_activities ADD COLUMN IF NOT EXISTS entity_key text;
-- Re-key from the old name-grain PK (period, facility_fold, procedure). The
-- loader TRUNCATEs and reloads, so there is nothing to migrate in place — but the
-- CONSTRAINT must be swapped before the reload or the insert fails on the old
-- shape. Guarded so a fresh DB (already created with the new PK) is a no-op.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'nzok_activities'::regclass AND c.contype = 'p'
      AND pg_get_constraintdef(c.oid) LIKE '%facility_fold%'
  ) THEN
    DELETE FROM nzok_activities;           -- old rows are name-grain; loader reloads
    ALTER TABLE nzok_activities DROP CONSTRAINT nzok_activities_pkey;
    ALTER TABLE nzok_activities ALTER COLUMN entity_key SET NOT NULL;
    ALTER TABLE nzok_activities ADD PRIMARY KEY (period, entity_key, procedure);
  END IF;
END $$;
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

-- --------------------------------------------------------------------------
-- Per-PERIOD facility roster — one row per (period, facility name fold). This is
-- what the annual matrix necessarily flattens away, and it is what makes the
-- rename visible: the name a fold billed under in each month, and whether that
-- month's volume reached a known EIK. ~12 × ~400 ≈ 4.8k rows/year.
--
-- It exists for two jobs neither the annual matrix nor the national monthly
-- series can do: the loader's name-churn assert (rule 5 above) reads it, and the
-- overview's `coverage` block publishes per-period unmapped volume from it, so
-- the ~11% of national cases that never reach an EIK are stated rather than
-- silently dropped.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nzok_activity_facility_periods (
  period        date NOT NULL,               -- first of the month
  facility_fold text NOT NULL,               -- fold of the name billed THAT period
  facility      text NOT NULL,               -- the name as billed THAT period
  rzok          text NOT NULL,
  eik           text,                        -- crosswalk result; NULL if unmatched
  entity_key    text NOT NULL,               -- eik, else 'f:'||facility_fold
  cases         bigint NOT NULL,
  zol           bigint NOT NULL,
  PRIMARY KEY (period, facility_fold)
);
CREATE INDEX IF NOT EXISTS idx_nzok_activity_fac_periods_entity
  ON nzok_activity_facility_periods (entity_key, period);

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
--
-- BOTH NAME FORMS MUST CLASSIFY ALIKE. НЗОК's ALL-CAPS migration (rule 5) spells
-- the type acronym OUT — "МНОГОПРОФИЛНА БОЛНИЦА ЗА АКТИВНО ЛЕЧЕНИЕ-АЙТОС" no
-- longer contains the token "МБАЛ" — so the acronym branches alone dropped 38 of
-- 404 entities into 'ДРУГИ' the month they were renamed. That is not cosmetic:
-- the cases-per-bed outlier compares a hospital only to SAME-TYPE peers
-- (rule 2), so a mistyped hospital is measured against the wrong median and
-- silently distorts its peers' median too. The spelled-out branches below run
-- after the acronym ones, so a name carrying either form lands in one place.
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
    -- Spelled-out equivalents of exactly the branches above, same precedence.
    WHEN p_fold ~ 'УНИВЕРСИТЕТСКА МНОГОПРОФИЛНА БОЛНИЦА ЗА АКТИВНО ЛЕЧЕНИЕ'
                                THEN 'УМБАЛ'
    WHEN p_fold ~ 'СПЕЦИАЛИЗИРАНА БОЛНИЦА ЗА АКТИВНО ЛЕЧЕНИЕ'
                                THEN 'СБАЛ'
    -- "МНОГОПРОФИЛНА ОБЛАСТНА БОЛНИЦА…" (МОБАЛ) groups with МБАЛ, as its
    -- acronym form always has.
    WHEN p_fold ~ 'МНОГОПРОФИЛНА( ОБЛАСТНА)? БОЛНИЦА ЗА АКТИВНО ЛЕЧЕНИЕ'
                                THEN 'МБАЛ'
    WHEN p_fold ~ 'СПЕЦИАЛИЗИРАНА БОЛНИЦА ЗА РЕХАБИЛИТАЦИЯ'
                                THEN 'СБР'
    WHEN p_fold ~ 'КОМПЛЕКСЕН ОНКОЛОГИЧЕН ЦЕНТЪР'
                                THEN 'КОЦ'
    WHEN p_fold ~ 'ДИАГНОСТИЧНО КОНСУЛТАТИВЕН ЦЕНТЪР'
                                THEN 'ДКЦ'
    WHEN p_fold ~ 'МЕДИЦИНСКИ ЦЕНТЪР'
                                THEN 'МЦ'
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
-- ==========================================================================
-- The SLIM procedure index behind the clinical-pathway group of the
-- /sector/health search box — every code with activity rows, which is exactly
-- the SERVABLE set behind /procedure/:code.
--
-- A SEPARATE function, for the same reason nzok_drug_pack_index() is: bolting
-- these 571 rows onto nzok_activities_overview() took that payload from 12.8 kB
-- to 46.6 kB for EVERY reader of /sector/health and /awarder/121858220, to
-- serve one group on one page that only needs it after the reader focuses the
-- box. Requested on arm, so a non-searching reader pays nothing.
--
-- The search group must build from THIS, not from procedures.json: the name
-- dictionary carries ~80 parent/rollup codes (A01, A10, A43) with no activity
-- rows, and offering those would produce results that cannot land.
-- ==========================================================================
CREATE OR REPLACE FUNCTION nzok_procedure_index()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH y AS (SELECT max(period) AS p FROM nzok_activities),
  cur AS (SELECT * FROM nzok_activities WHERE period = (SELECT p FROM y))
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM cur) THEN NULL
    ELSE jsonb_build_object(
      'period', (SELECT p FROM y),
      'procedures', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                  'procedure', procedure,
                  'procType',  proc_type,
                  'cases',     cases)
                ORDER BY cases DESC, procedure COLLATE "C")
        FROM (
          SELECT procedure, min(proc_type COLLATE "C") AS proc_type,
                 sum(cases)::bigint AS cases
          FROM cur GROUP BY procedure
        ) p), '[]'::jsonb))
  END;
$$;

CREATE OR REPLACE FUNCTION nzok_activities_overview()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH y AS (SELECT max(period) AS p FROM nzok_activities),
  cur AS (SELECT * FROM nzok_activities WHERE period = (SELECT p FROM y)),
  -- Cases-per-bed outlier: per (procedure, hospital type), each facility's
  -- cases/bed vs the peer median, ranked by ratio. Floors keep thin cells out.
  cb AS (
    SELECT a.facility, a.facility_fold, a.entity_key, a.eik, a.procedure, a.proc_type,
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
    -- ENTITY count, not a name count (rule 5) — counting names inflates this by
    -- every hospital НЗОК renamed mid-year.
    'distinctFacilities',(SELECT count(DISTINCT entity_key)::int FROM cur),
    -- How much of the year's volume never reached an EIK, nationally and per
    -- period. Unmatched entities cannot be re-united across a rename, so this is
    -- the honest ceiling on any eik-keyed reading of the corpus.
    'coverage', (
      SELECT jsonb_build_object(
        'mappedEntities',   count(DISTINCT entity_key) FILTER (WHERE eik IS NOT NULL)::int,
        'unmappedEntities', count(DISTINCT entity_key) FILTER (WHERE eik IS NULL)::int,
        'unmappedCases',    COALESCE(sum(cases) FILTER (WHERE eik IS NULL), 0)::bigint,
        'unmappedCasesPct', ROUND(
            100.0 * COALESCE(sum(cases) FILTER (WHERE eik IS NULL), 0)
            / NULLIF(sum(cases), 0), 1),
        'byPeriod', (
          SELECT jsonb_agg(jsonb_build_object(
                   'period',           to_char(period, 'YYYY-MM'),
                   'facilities',       facilities,
                   'unmappedFacilities', unmapped_facilities,
                   'cases',            cases,
                   'unmappedCases',    unmapped_cases,
                   'unmappedCasesPct', unmapped_pct) ORDER BY period)
          FROM (
            SELECT period,
                   count(*)::int                                   AS facilities,
                   count(*) FILTER (WHERE eik IS NULL)::int        AS unmapped_facilities,
                   sum(cases)::bigint                              AS cases,
                   COALESCE(sum(cases) FILTER (WHERE eik IS NULL), 0)::bigint
                                                                   AS unmapped_cases,
                   ROUND(100.0 * COALESCE(sum(cases) FILTER (WHERE eik IS NULL), 0)
                         / NULLIF(sum(cases), 0), 1)               AS unmapped_pct
            FROM nzok_activity_facility_periods
            GROUP BY period
          ) bp)
      ) FROM cur),
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
               -- DISTINCT entity_key, not count(*): one row per entity per
               -- procedure is the invariant, and counting entities states it.
               count(DISTINCT entity_key)::int AS facility_count
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
                       entity_key COLLATE "C", procedure COLLATE "C")
      FROM (
        SELECT * FROM cb_rank
        ORDER BY ROUND(ratio::numeric, 2) DESC,
                 entity_key COLLATE "C", procedure COLLATE "C"
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
