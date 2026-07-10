-- НЗОК per-hospital DRUG UNIT PRICES — the peer-comparison substrate behind the
-- health pack's "who pays more for the same pack?" tile (Phase 2 of
-- docs/plans/nzok-hospital-intelligence-v1.md). Source = НЗОК's monthly "Справка
-- 5" antineoplastic/coagulopathy files (nhif.bg/bg/nzok/medicine/5), parsed by
-- scripts/nzok/write_drug_unit_prices.ts into data/budget/nzok/drug_unit_prices.json.
--
-- THREE design rules are baked into the data and MUST be respected by anything
-- reading these tables:
--
--   1. PACK IDENTITY, NOT INN. A unit price is comparable only within one pack
--      identity — Национален № (national_no), falling back to the НЗОК код
--      (nzok_code) when the national number is blank. Comparing across INN is
--      WRONG: pack size and dosage form silently drive the "anomaly". Every join
--      and every distinct-pack count keys on (national_no, nzok_code).
--
--   2. VOLUME FLOOR = 5 packs. A facility holding fewer than five packs of a pack
--      in a period has no negotiating context and its unit price would dominate
--      any ratio, so it is dropped BEFORE the peer distribution is built (already
--      applied upstream in the parser; nzok_drug_volume_floor_packs() records the
--      threshold for display).
--
--   3. DISPERSION IS NOT WRONGDOING. Two hospitals paying different unit prices
--      for the same pack has legitimate causes — volume discounts, delivery
--      period, contract terms. The one-month `ratio` in nzok_drug_overpay is a
--      SIGNPOST, not a verdict; the defensible claim is PERSISTENT dispersion
--      across months, which nzok_drug_pack_trend() exposes and a single-year
--      corpus cannot answer. Present the trend, never a lone month's ratio, as
--      evidence.
--
-- Money is euros throughout (2025 rows are BGN converted at ingest at
-- 1 EUR = 1.95583 BGN; 2026 is EUR-native), matching the rest of the pack.

-- --------------------------------------------------------------------------
-- Per-(period, pack) peer distribution: median / p25 / p75 of facility unit
-- prices over facilities past the volume floor, for packs held by ≥2 such
-- facilities. `period` is the first of the month.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nzok_drug_pack_stats (
  period          date NOT NULL,               -- month, normalised to the 1st
  national_no     text NOT NULL,               -- Национален № (pack identity); '' when blank
  nzok_code       text NOT NULL,               -- НЗОК код (fallback pack identity)
  inn             text,                         -- active substance (context, NOT the comparison key)
  trade_name      text,
  form            text,                         -- dosage form
  atc             text,
  median_unit_eur double precision,             -- median facility unit price, euros
  p25_unit_eur    double precision,
  p75_unit_eur    double precision,
  facility_count  int,                          -- facilities past the floor for this pack/period
  total_packs     double precision,
  total_eur       double precision,             -- reimbursed euros for this pack/period
  PRIMARY KEY (period, national_no, nzok_code)
);

-- One pack's monthly series (nzok_drug_pack_trend): "is the gap widening?".
CREATE INDEX IF NOT EXISTS idx_nzok_drug_ps_pack_period
  ON nzok_drug_pack_stats (national_no, period DESC);
-- Latest-period ranking (overview): top packs by spend in a period.
CREATE INDEX IF NOT EXISTS idx_nzok_drug_ps_period_eur
  ON nzok_drug_pack_stats (period DESC, total_eur DESC);

-- --------------------------------------------------------------------------
-- Per-facility overpay ranking for the latest FULL calendar year. Each row is
-- one facility that paid ABOVE the year's per-pack median unit price for a pack
-- identity. `period` is NULL here because the ranking is annual (a whole-year
-- aggregate is more robust than one month); the column exists so a future
-- monthly ranking can share the table. Surrogate PK because (national_no can be
-- '', period is NULL) rules out a natural composite key.
--
-- overpay_eur = (unit_eur − median_unit_eur) × units. It is a SIGNPOST toward
-- packs worth a closer look, NOT proof of wrongdoing (see rule 3 above).
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nzok_drug_overpay (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period          date,                         -- NULL: annual (latest full year) ranking
  national_no     text NOT NULL,                -- pack identity; '' when blank
  nzok_code       text NOT NULL,
  inn             text,
  trade_name      text,
  form            text,
  facility        text NOT NULL,
  reg_no          text NOT NULL,                -- Рег.№ ЛЗ (NHIF facility id)
  eik             text,                         -- from the Рег.№→EIK crosswalk; null when unmatched
  unit_eur        double precision,             -- this facility's unit price, euros
  median_unit_eur double precision,             -- the pack's year median, euros
  ratio           double precision,             -- unit_eur / median_unit_eur
  units           double precision,             -- units purchased in the year
  overpay_eur     double precision              -- (unit_eur − median_unit_eur) × units
);

-- One hospital's overpay rows (nzok_drug_overpay_by_eik).
CREATE INDEX IF NOT EXISTS idx_nzok_drug_overpay_eik
  ON nzok_drug_overpay (eik);
-- The overpay leaderboard (overview): biggest gaps first.
CREATE INDEX IF NOT EXISTS idx_nzok_drug_overpay_period_eur
  ON nzok_drug_overpay (period DESC, overpay_eur DESC);

-- The volume floor, in one place, for the overview payload (mirrors
-- VOLUME_FLOOR_PACKS in scripts/nzok/write_drug_unit_prices.ts — a pack held in
-- fewer than this many packs by a facility never enters the peer distribution).
CREATE OR REPLACE FUNCTION nzok_drug_volume_floor_packs() RETURNS int
  LANGUAGE sql IMMUTABLE AS $$ SELECT 5 $$;

-- --------------------------------------------------------------------------
-- Overview payload: latest period headline + the two leaderboards.
--
-- Determinism (see [[reference_pg_payload_determinism]]): sums are ROUND-ed,
-- every ORDER BY rounds its sort key and carries an explicit COLLATE "C" +
-- id/pack tiebreak so local == cloud, and an empty table returns NULL (not an
-- object of nulls). `topPacks` and the headline are the LATEST period; `overpay`
-- is the annual (latest-full-year) leaderboard — those are the only rows the
-- overpay table holds.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nzok_drug_unit_prices_overview()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH latest AS (SELECT max(period) AS p FROM nzok_drug_pack_stats),
  cur AS (
    SELECT * FROM nzok_drug_pack_stats WHERE period = (SELECT p FROM latest)
  )
  SELECT CASE WHEN (SELECT p FROM latest) IS NULL THEN NULL ELSE jsonb_build_object(
    'latestPeriod',     to_char((SELECT p FROM latest), 'YYYY-MM'),
    'volumeFloorPacks', nzok_drug_volume_floor_packs(),
    -- Distinct pack identities priced in the latest period.
    'distinctPacks',    (SELECT COUNT(*)::int
                           FROM (SELECT DISTINCT national_no, nzok_code FROM cur) d),
    'totalEur',         (SELECT ROUND(SUM(total_eur))::bigint FROM cur),
    'facilityCount',    (SELECT COUNT(*)::int FROM cur),
    -- Top 20 packs by spend in the latest period, with their dispersion band.
    'topPacks', (
      SELECT jsonb_agg(jsonb_build_object(
                'nationalNo',    national_no,
                'nzokCode',      nzok_code,
                'inn',           inn,
                'tradeName',     trade_name,
                'form',          form,
                'atc',           atc,
                'facilityCount', facility_count,
                'totalPacks',    total_packs,
                'totalEur',      ROUND(total_eur)::bigint,
                'medianUnitEur', median_unit_eur,
                'p25UnitEur',    p25_unit_eur,
                'p75UnitEur',    p75_unit_eur)
              ORDER BY ROUND(total_eur) DESC,
                       national_no COLLATE "C", nzok_code COLLATE "C")
      FROM (
        SELECT * FROM cur
        ORDER BY ROUND(total_eur) DESC,
                 national_no COLLATE "C", nzok_code COLLATE "C"
        LIMIT 20
      ) t
    ),
    -- Top 40 overpay rows (annual). A signpost, not a verdict — see the header.
    'overpay', (
      SELECT jsonb_agg(jsonb_build_object(
                'nationalNo',    national_no,
                'nzokCode',      nzok_code,
                'inn',           inn,
                'tradeName',     trade_name,
                'form',          form,
                'facility',      facility,
                'regNo',         reg_no,
                'eik',           eik,
                'unitEur',       unit_eur,
                'medianUnitEur', median_unit_eur,
                'ratio',         ratio,
                'units',         units,
                'overpayEur',    ROUND(overpay_eur)::bigint)
              ORDER BY ROUND(overpay_eur) DESC,
                       reg_no COLLATE "C", national_no COLLATE "C",
                       nzok_code COLLATE "C", id)
      FROM (
        SELECT * FROM nzok_drug_overpay
        ORDER BY ROUND(overpay_eur) DESC,
                 reg_no COLLATE "C", national_no COLLATE "C",
                 nzok_code COLLATE "C", id
        LIMIT 40
      ) o
    )
  ) END;
$$;

-- --------------------------------------------------------------------------
-- One pack's monthly median/p25/p75 series, ascending by month. THIS is the
-- "is the gap widening or closing?" query — persistent dispersion across months
-- is the defensible claim a single month's ratio cannot make. Pack identity is
-- (national_no, nzok_code); pass national_no = '' when the pack has no national
-- number and identify it by nzok_code alone. NULL when the pack has no rows.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nzok_drug_pack_trend(p_national_no text, p_nzok_code text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH s AS (
    SELECT * FROM nzok_drug_pack_stats
    WHERE national_no = p_national_no AND nzok_code = p_nzok_code
  )
  SELECT CASE WHEN COUNT(*) = 0 THEN NULL ELSE jsonb_build_object(
    'nationalNo', p_national_no,
    'nzokCode',   p_nzok_code,
    'inn',        (SELECT min(inn COLLATE "C") FROM s),
    'tradeName',  (SELECT min(trade_name COLLATE "C") FROM s),
    'form',       (SELECT min(form COLLATE "C") FROM s),
    'atc',        (SELECT min(atc COLLATE "C") FROM s),
    'series', (
      SELECT jsonb_agg(jsonb_build_object(
                'period',        to_char(period, 'YYYY-MM'),
                'medianUnitEur', median_unit_eur,
                'p25UnitEur',    p25_unit_eur,
                'p75UnitEur',    p75_unit_eur,
                'facilityCount', facility_count,
                'totalPacks',    total_packs,
                'totalEur',      ROUND(total_eur)::bigint)
              ORDER BY period)
      FROM s
    )
  ) END
  FROM s;
$$;

-- --------------------------------------------------------------------------
-- One hospital's overpay rows, biggest gap first, capped at 40. Keyed on the
-- crosswalked EIK. NULL when the EIK has no overpay rows. `period` is NULL for
-- the current annual ranking, so the sort falls through to overpay_eur.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nzok_drug_overpay_by_eik(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH o AS (SELECT * FROM nzok_drug_overpay WHERE eik = p_eik)
  SELECT CASE WHEN COUNT(*) = 0 THEN NULL ELSE jsonb_build_object(
    'eik', p_eik,
    'rows', (
      SELECT jsonb_agg(jsonb_build_object(
                'period',        to_char(period, 'YYYY-MM'),
                'nationalNo',    national_no,
                'nzokCode',      nzok_code,
                'inn',           inn,
                'tradeName',     trade_name,
                'form',          form,
                'facility',      facility,
                'regNo',         reg_no,
                'unitEur',       unit_eur,
                'medianUnitEur', median_unit_eur,
                'ratio',         ratio,
                'units',         units,
                'overpayEur',    ROUND(overpay_eur)::bigint)
              ORDER BY period DESC NULLS LAST, ROUND(overpay_eur) DESC,
                       reg_no COLLATE "C", national_no COLLATE "C",
                       nzok_code COLLATE "C", id)
      FROM (
        SELECT * FROM o
        ORDER BY period DESC NULLS LAST, ROUND(overpay_eur) DESC,
                 reg_no COLLATE "C", national_no COLLATE "C",
                 nzok_code COLLATE "C", id
        LIMIT 40
      ) t
    )
  ) END
  FROM o;
$$;
