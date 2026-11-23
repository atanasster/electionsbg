-- 206 · Vaccines: supply → channel → arm (docs/plans/vaccines-flow-v1.md §4).
--
-- Applied by `db:load:vaccines:pg[:cloud]` and by nothing else, so a corpus reload
-- carries every object here. All tables are small (under 150k rows in total).
--
-- THREE BASES, never one. НЗИС counts what was ENTERED in the national health
-- information system (a floor on what was given); НЗОК/МЗ state what was planned,
-- contracted or announced; Eurostat publishes a 65+ coverage rate. A surface that
-- puts two of them side by side labels each — §7.2, §7.3.
--
-- SEASON, NOT YEAR. A flu campaign runs from autumn into the next calendar year,
-- so every flu aggregate keys on flu_season(d): the starting year of the season
-- running 1 August → 31 July. A calendar-year flu total mixes two campaigns.

CREATE OR REPLACE FUNCTION flu_season(d date)
RETURNS integer
LANGUAGE sql
IMMUTABLE PARALLEL SAFE STRICT
AS $$
  SELECT EXTRACT(year FROM d)::integer
       - CASE WHEN EXTRACT(month FROM d) < 8 THEN 1 ELSE 0 END
$$;

-- The 31 НЗИС vaccine labels, each classified once (scripts/health/vaccines/
-- vaccine_dim.ts is the source; the loader refuses an unclassified label).
CREATE TABLE IF NOT EXISTS his_vaccine_dim (
  vaccine_code text PRIMARY KEY,
  label_en     text NOT NULL UNIQUE,
  label_bg     text NOT NULL,
  family       text NOT NULL
    CHECK (family IN ('flu', 'flu_nasal', 'covid', 'calendar', 'other'))
);

-- НЗИС info-app: month × oblast × age band × sex × vaccine. Stage-merged from the
-- gitignored cache (raw_data/health/vaccines/his_monthly.json). `population` is
-- the НСИ population of the oblast × age × sex cell, as НЗИС publishes it.
-- ⚠️ Cells reach n = 1; nothing finer than oblast × vaccine × month may be
-- rendered (§3).
CREATE TABLE IF NOT EXISTS his_immunization_month (
  period          date     NOT NULL,   -- first day of the month
  oblast_code     text     NOT NULL,   -- place_dim kind='oblast'
  age_band        text     NOT NULL,
  age_order       smallint NOT NULL,
  sex             char(1)  NOT NULL CHECK (sex IN ('F', 'M')),
  vaccine_code    text     NOT NULL REFERENCES his_vaccine_dim (vaccine_code),
  n               integer  NOT NULL CHECK (n >= 0),
  unique_patients integer  NOT NULL CHECK (unique_patients >= 0),
  population      integer  NOT NULL CHECK (population >= 0),
  PRIMARY KEY (period, oblast_code, age_band, sex, vaccine_code)
);
CREATE INDEX IF NOT EXISTS idx_his_month_vaccine
  ON his_immunization_month (vaccine_code, period, oblast_code)
  INCLUDE (age_order, n, population);

-- НЗИС report-page counters, as SCD-2 runs: a row per value the counter held,
-- valid from the capture that first saw it until the capture that saw the next
-- one (NULL = still current). Rebuilt from the committed his_daily.jsonl.
-- `scope = 'vaccine'` keys on vaccine_code (national); `scope = 'oblast'` keys on
-- the place_dim code (all vaccines).
CREATE TABLE IF NOT EXISTS his_immunization_daily (
  year       integer     NOT NULL,
  scope      text        NOT NULL CHECK (scope IN ('vaccine', 'oblast')),
  key        text        NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to   timestamptz,
  n_ytd      integer     NOT NULL CHECK (n_ytd >= 0),
  -- The page's own „актуализирани" stamp (Europe/Sofia wall clock); NULL for a
  -- closed year, whose page carries none.
  as_of      timestamp,
  PRIMARY KEY (year, scope, key, valid_from)
);

-- ИАЛ СЕСПА weekly shortage list (чл. 217в ЗЛПХМ), every product, vaccines
-- flagged. One row per (window, product) as of the LATEST capture of that window.
-- Never shrinks across windows: a window no longer in the source is history.
-- ⚠️ Absence from this list is not evidence of supply (§7.7).
CREATE TABLE IF NOT EXISTS ial_shortage_week (
  valid_from  date        NOT NULL,
  valid_to    date        NOT NULL,
  ncpr_code   text        NOT NULL,
  name        text        NOT NULL,
  inn         text        NOT NULL,
  strength    text        NOT NULL,
  unit        text        NOT NULL,
  form        text        NOT NULL,
  pack        text        NOT NULL,
  is_vaccine  boolean     NOT NULL,
  fetched_at  timestamptz NOT NULL,
  PRIMARY KEY (valid_from, ncpr_code)
);

-- НЦЗПБ weekly flu + ОРЗ incidence (sentinel GP surveillance). `oblast_code` is
-- 'BG' for the national row; `age_band` is one of НЦЗПБ's five bands or 'all'.
CREATE TABLE IF NOT EXISTS flu_incidence_week (
  week_start   date             NOT NULL,
  week_end     date             NOT NULL,
  iso_week     smallint         NOT NULL,
  oblast_code  text             NOT NULL,
  age_band     text             NOT NULL,
  served       integer          NOT NULL,
  cases        integer          NOT NULL,
  rate_per_10k double precision NOT NULL,
  fetched_at   timestamptz      NOT NULL,
  PRIMARY KEY (week_start, oblast_code, age_band)
);

CREATE TABLE IF NOT EXISTS flu_virology_week (
  week_start  date        PRIMARY KEY,
  week_end    date        NOT NULL,
  iso_week    smallint    NOT NULL,
  tested      integer     NOT NULL,
  a_h1n1      integer     NOT NULL,
  a_h3n2      integer     NOT NULL,
  a_h1n1pdm09 integer     NOT NULL,
  b_victoria  integer     NOT NULL,
  b_yamagata  integer     NOT NULL,
  fetched_at  timestamptz NOT NULL
);

-- Eurostat Comext, CN 3002 41 (vaccines for human medicine): ALL vaccines, not
-- flu. `partner` is the country of dispatch (imports) or destination (exports),
-- never the manufacturer, and includes Eurostat's aggregates (EXT_EU, EXT_EA
-- …), which a surface must filter out (§7.6).
CREATE TABLE IF NOT EXISTS vaccine_trade_month (
  period         date             NOT NULL,
  flow           text             NOT NULL CHECK (flow IN ('import', 'export')),
  product        text             NOT NULL,
  partner        text             NOT NULL,
  value_eur      double precision NOT NULL,
  quantity_100kg double precision,
  PRIMARY KEY (period, flow, product, partner)
);

-- Eurostat hlth_ps_immu: % of people aged 65+ vaccinated against influenza.
-- A different basis from НЗИС's 60+ counts; never mixed with them (§7.2).
CREATE TABLE IF NOT EXISTS flu_coverage_eu (
  geo  text             NOT NULL,
  year integer          NOT NULL,
  pct  double precision NOT NULL,
  PRIMARY KEY (geo, year)
);

-- Curated, source-cited (data/health/vaccines/season_plan.json). A later
-- announcement never overwrites an earlier row: it supersedes it (§7.8).
CREATE TABLE IF NOT EXISTS vaccine_season_plan (
  id              text    PRIMARY KEY,
  season          integer NOT NULL,
  channel         text    NOT NULL,
  doses           integer NOT NULL CHECK (doses > 0),
  doses_qualifier text    CHECK (doses_qualifier IN ('over')),
  scope           text    CHECK (scope IN ('delivery')),
  basis           text    NOT NULL CHECK (basis IN ('planned', 'contracted', 'announced')),
  within_channel  text,
  source          text    NOT NULL,
  source_url      text    NOT NULL,
  source_date     date    NOT NULL,
  superseded_by   text
);

CREATE TABLE IF NOT EXISTS vaccine_season_event (
  season     integer NOT NULL,
  event_date date    NOT NULL,
  kind       text    NOT NULL CHECK (kind IN ('plan', 'delay', 'delivery')),
  text_bg    text    NOT NULL,
  text_en    text    NOT NULL,
  source_url text    NOT NULL,
  PRIMARY KEY (event_date, source_url, kind)
);

-- МЗ tender lots → doses, where a document states the quantity. Joined to
-- tenders at query time on (unp, lot_id).
CREATE TABLE IF NOT EXISTS vaccine_tender_dose (
  unp        text    NOT NULL,
  lot_id     text    NOT NULL,
  doses      integer NOT NULL CHECK (doses > 0),
  source_url text    NOT NULL,
  PRIMARY KEY (unp, lot_id)
);

-- One row per source: its own as-of (the НЗИС cache's fetch time, Eurostat's
-- `updated` stamp …), so every served figure can carry the clock it was read on.
CREATE TABLE IF NOT EXISTS vaccine_source_asof (
  source    text        PRIMARY KEY,
  as_of     text        NOT NULL,
  loaded_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON his_vaccine_dim, his_immunization_month, his_immunization_daily,
      ial_shortage_week, flu_incidence_week, flu_virology_week, vaccine_trade_month,
      flu_coverage_eu, vaccine_season_plan, vaccine_season_event, vaccine_tender_dose,
      vaccine_source_asof
      TO app_readonly;
    GRANT EXECUTE ON FUNCTION flu_season(date) TO app_readonly;
  ELSE
    RAISE WARNING 'app_readonly absent — 206 granted nothing. /api/db will 42501 '
                  'against a corpus that looks fully loaded. Run db:pg:bootstrap.';
  END IF;
END
$$;
