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

-- ═══════════════════════════════════════════════════════════════════════════
-- Serving (T4). Live functions, no matview: the flu subset is a few thousand
-- cells behind idx_his_month_vaccine, and every matview is one more refresh to
-- forget (§4). Every figure carries `asOf` and `basis`.
-- ═══════════════════════════════════════════════════════════════════════════

-- Recorded flu shots per oblast for one season, per 1,000 people aged 60+.
-- `population` is НЗИС's own НСИ column for the oblast × age × sex cell; the
-- cell repeats on every vaccine × month row, so the 60+ denominator is the max
-- per (oblast, band, sex) over the season's year — never a sum across rows.
-- The 60+ band is what НЗИС publishes; it is not the programme's 65+ (§7.2).
-- Age bands: age_order 6 = 60–79, 7 = 80+. `p_family` 'flu_all' folds
-- injectable and nasal together.
--
-- Both seasons are counted TO THE SAME COMPLETE MONTH (§7.4): the info-app's
-- data stop days before its fetch, so the fetch month is partial, and a season
-- to date beside a whole previous season reads as a collapse. `complete_through`
-- is that month; with no fetch stamp there is no cut and every to-date figure
-- is NULL rather than a partial month read as whole. `oct_n` / `prev_oct_n` are
-- October's shots at ALL ages (§5.4), NULL until this season's October is
-- complete. A season with no recorded flu cells returns NO rows — never 28
-- oblasts at zero.
DROP FUNCTION IF EXISTS vaccines_oblast(integer, text);
CREATE FUNCTION vaccines_oblast(p_season integer, p_family text DEFAULT 'flu')
RETURNS TABLE (
  oblast_code      text,
  name_bg          text,
  name_en          text,
  complete_through text,
  n60              bigint,
  pop60            bigint,
  per1000          double precision,
  prev_n60         bigint,
  prev_per1000     double precision,
  oct_n            bigint,
  prev_oct_n       bigint
)
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  WITH fam AS (
    SELECT vaccine_code FROM his_vaccine_dim
     WHERE family = p_family OR (p_family = 'flu_all' AND family IN ('flu', 'flu_nasal'))
  ),
  cells AS (
    SELECT m.oblast_code, m.period, flu_season(m.period) AS season,
           EXTRACT(month FROM m.period)::int AS mon,
           m.age_order >= 6 AS is60, m.n
      FROM his_immunization_month m
     WHERE m.vaccine_code IN (SELECT vaccine_code FROM fam)
       AND m.period >= make_date(p_season - 1, 8, 1)
       AND m.period <  make_date(p_season + 1, 8, 1)
  ),
  cut AS (
    SELECT CASE WHEN x.c >= make_date(p_season, 8, 1)
                THEN least(x.c, make_date(p_season + 1, 7, 1)) END AS c
      FROM (SELECT CASE WHEN f.fetch_month IS NOT NULL
                        THEN least((SELECT max(period) FROM his_immunization_month),
                                   (f.fetch_month - interval '1 month')::date) END AS c
              FROM (SELECT (SELECT date_trunc('month', as_of::timestamptz)::date
                              FROM vaccine_source_asof
                             WHERE source = 'his_monthly') AS fetch_month) f) x
  ),
  pop AS (
    -- The denominator for a season: the НСИ cell as published in the season's
    -- autumn year (the campaign's peak months).
    SELECT oblast_code, sum(p)::bigint AS pop60
      FROM (SELECT oblast_code, age_band, sex, max(population) AS p
              FROM his_immunization_month
             WHERE age_order >= 6
               AND period >= make_date(p_season, 1, 1)
               AND period <  make_date(p_season + 1, 1, 1)
             GROUP BY 1, 2, 3) x
     GROUP BY 1
  ),
  prev_pop AS (
    SELECT oblast_code, sum(p)::bigint AS pop60
      FROM (SELECT oblast_code, age_band, sex, max(population) AS p
              FROM his_immunization_month
             WHERE age_order >= 6
               AND period >= make_date(p_season - 1, 1, 1)
               AND period <  make_date(p_season, 1, 1)
             GROUP BY 1, 2, 3) x
     GROUP BY 1
  ),
  agg AS (
    SELECT cl.oblast_code,
           sum(cl.n) FILTER (WHERE cl.season = p_season AND cl.is60
                               AND cl.period <= cut.c)                       AS n60,
           sum(cl.n) FILTER (WHERE cl.season = p_season - 1 AND cl.is60
                               AND cl.period <= (cut.c - interval '1 year')) AS prev_n60,
           sum(cl.n) FILTER (WHERE cl.season = p_season AND cl.mon = 10
                               AND make_date(p_season, 10, 1) <= cut.c)      AS oct_n,
           sum(cl.n) FILTER (WHERE cl.season = p_season - 1 AND cl.mon = 10) AS prev_oct_n
      FROM cells cl CROSS JOIN cut
     GROUP BY 1
  )
  SELECT d.code, d.name_bg, d.name_en,
         to_char(cut.c, 'YYYY-MM'),
         CASE WHEN cut.c IS NOT NULL THEN coalesce(a.n60, 0) END::bigint,
         p.pop60,
         CASE WHEN cut.c IS NOT NULL AND p.pop60 > 0
              THEN 1000.0 * coalesce(a.n60, 0) / p.pop60 END,
         a.prev_n60::bigint,
         CASE WHEN pp.pop60 > 0 AND a.prev_n60 IS NOT NULL
              THEN 1000.0 * a.prev_n60 / pp.pop60 END,
         a.oct_n::bigint, a.prev_oct_n::bigint
    FROM place_dim d
    CROSS JOIN cut
    LEFT JOIN agg a ON a.oblast_code = d.code
    LEFT JOIN pop p ON p.oblast_code = d.code
    LEFT JOIN prev_pop pp ON pp.oblast_code = d.code
   WHERE d.kind = 'oblast'
     AND EXISTS (SELECT 1 FROM cells WHERE season = p_season)
   ORDER BY 7 DESC NULLS LAST, d.code
$$;

-- The whole page in one call. p_season NULL = the latest season with recorded
-- flu shots. Sections are independent keys, each with its own asOf + basis.
CREATE OR REPLACE FUNCTION vaccines_overview(p_season integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_seasons  integer[];
  v_season   integer;
  v_asof     jsonb;
  v_month_to date;
  v_contracts jsonb;
  v_complete date;
  v_daily jsonb;
BEGIN
  SELECT array_agg(s ORDER BY s DESC) INTO v_seasons
    FROM (SELECT DISTINCT flu_season(m.period) AS s
            FROM his_immunization_month m
            JOIN his_vaccine_dim d USING (vaccine_code)
           WHERE d.family IN ('flu', 'flu_nasal')) x;
  IF v_seasons IS NULL THEN
    RETURN NULL;
  END IF;
  v_season := CASE WHEN p_season = ANY (v_seasons) THEN p_season ELSE v_seasons[1] END;

  SELECT jsonb_object_agg(source, as_of) INTO v_asof FROM vaccine_source_asof;
  SELECT max(period) INTO v_month_to FROM his_immunization_month;
  -- The info-app's data stops days before its fetch, so the fetch month is
  -- partial: only months before it are compared across seasons (§7.4).
  -- No fetch stamp → no cut: least() would skip the NULL and treat the partial
  -- month as complete.
  v_complete := CASE WHEN v_asof ? 'his_monthly' THEN least(
    v_month_to,
    (date_trunc('month', (v_asof ->> 'his_monthly')::timestamptz) - interval '1 month')::date) END;

  -- The procurement corpus may be absent on a database that never loaded it;
  -- the contracts section is then null rather than failing the whole page.
  BEGIN
    v_contracts := (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'year', y, 'supplierEik', contractor_eik, 'supplierName', name,
                   'contracts', n, 'eur', eur) ORDER BY y DESC, eur DESC), '[]'::jsonb)
            FROM (SELECT left(c.date, 4)::int AS y, c.contractor_eik,
                         max(c.contractor_name) AS name, count(*) AS n,
                         round(sum(c.amount_eur)::numeric, 2) AS eur
                    FROM contracts c
                   WHERE c.tag = 'contract' AND c.awarder_eik = '000695317'
                     AND c.cpv LIKE '336516%' AND c.cpv NOT LIKE '33651690%'
                   GROUP BY 1, 2) k
    );
  EXCEPTION WHEN undefined_table THEN
    v_contracts := NULL;
  END;


  -- The current season's DAILY curve: the report page's calendar-year counter
  -- minus the same year's Jan–Jul monthly cells (the previous campaign's tail).
  -- Two НЗИС products with two clocks; both as-ofs are carried. Only while the
  -- season's own calendar year is the open counter (Aug–Dec of it); from
  -- January the counter resets and the season continues on monthly cells only.
  IF v_season = v_seasons[1]
     AND v_season = EXTRACT(year FROM now() AT TIME ZONE 'Europe/Sofia')::int THEN
    v_daily := (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'from', r.valid_from, 'asOf', r.as_of,
             'n', r.total - coalesce(tail.n, 0)) ORDER BY r.valid_from), '[]'::jsonb)
      FROM (
        -- Every capture time of either counter, and at each the value each
        -- counter held then (a run is written only when its counter moved).
        SELECT t.valid_from, max(h.as_of) AS as_of, sum(h.n_ytd)::bigint AS total
          FROM (SELECT DISTINCT valid_from FROM his_immunization_daily
                 WHERE scope = 'vaccine' AND key IN ('flu', 'flu_nasal')
                   AND year = v_season) t
          JOIN his_immunization_daily h
            ON h.scope = 'vaccine' AND h.key IN ('flu', 'flu_nasal')
           AND h.year = v_season
           AND h.valid_from <= t.valid_from
           AND (h.valid_to IS NULL OR h.valid_to > t.valid_from)
         GROUP BY t.valid_from
      ) r
      LEFT JOIN LATERAL (
        SELECT sum(m.n)::bigint AS n
          FROM his_immunization_month m
          JOIN his_vaccine_dim d USING (vaccine_code)
         WHERE d.family IN ('flu', 'flu_nasal')
           AND m.period >= make_date(v_season, 1, 1)
           AND m.period <  make_date(v_season, 8, 1)
      ) tail ON true
    );
  END IF;

  RETURN jsonb_build_object(
    'season', v_season,
    'seasons', to_jsonb(v_seasons),
    'asOf', coalesce(v_asof, '{}'::jsonb),
    'monthlyThrough', to_char(v_month_to, 'YYYY-MM'),

    -- §2 Кога: cumulative recorded flu shots by month of season (Aug = 1),
    -- this season and the three before it. Monthly steps, from the info-app.
    'curve', jsonb_build_object(
      'basis', 'his_monthly',
      'asOf', v_asof -> 'his_monthly',
      'seasons', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('season', s, 'points', pts) ORDER BY s DESC), '[]'::jsonb)
          FROM (
            SELECT s, jsonb_agg(jsonb_build_object(
                     'month', to_char(p, 'YYYY-MM'),
                     'm', ((EXTRACT(month FROM p)::int + 4) % 12) + 1,
                     'n', n,
                     'cum', cum)
                   ORDER BY p) AS pts
              FROM (
               SELECT s, p, n, sum(n) OVER (PARTITION BY s ORDER BY p)::bigint AS cum
                 FROM (
                SELECT flu_season(m.period) AS s, m.period AS p, sum(m.n)::bigint AS n
                  FROM his_immunization_month m
                  JOIN his_vaccine_dim d USING (vaccine_code)
                 WHERE d.family IN ('flu', 'flu_nasal')
                   AND m.period >= make_date(v_season - 3, 8, 1)
                   AND m.period <  make_date(v_season + 1, 8, 1)
                 GROUP BY 1, 2
                 ) mm0
              ) mm
             GROUP BY s
          ) z
      ),
      'daily', v_daily
    ),

    -- §1 head + §3 За кого: the curated plan, every row (superseded ones too —
    -- §7.8), as published. Nothing here is a remainder or a derived total.
    'plan', jsonb_build_object(
      'basis', 'season_plan',
      'asOf', v_asof -> 'season_plan',
      'rows', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'id', p.id, 'channel', p.channel, 'doses', p.doses,
                 'qualifier', p.doses_qualifier, 'scope', p.scope, 'basis', p.basis,
                 'within', p.within_channel, 'source', p.source,
                 'sourceUrl', p.source_url, 'sourceDate', p.source_date,
                 'supersededBy', p.superseded_by)
               ORDER BY p.source_date, p.id), '[]'::jsonb)
          FROM vaccine_season_plan p
         WHERE p.season = v_season
      ),
      'events', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'date', e.event_date, 'kind', e.kind, 'textBg', e.text_bg,
                 'textEn', e.text_en, 'sourceUrl', e.source_url)
               ORDER BY e.event_date), '[]'::jsonb)
          FROM vaccine_season_event e
         WHERE e.season = v_season
      )
    ),

    -- §1/§3 recorded: flu shots entered in НЗИС this season, by age band
    -- (injectable and nasal apart). Recorded ≠ administered (§7.3).
    'recorded', jsonb_build_object(
      'basis', 'his_monthly',
      'asOf', v_asof -> 'his_monthly',
      'through', to_char(v_month_to, 'YYYY-MM'),
      'total', (SELECT coalesce(sum(m.n), 0)
                  FROM his_immunization_month m
                  JOIN his_vaccine_dim d USING (vaccine_code)
                 WHERE d.family IN ('flu', 'flu_nasal')
                   AND m.period >= make_date(v_season, 8, 1)
                   AND m.period <  make_date(v_season + 1, 8, 1)),
      -- Complete months only, this season against the same months of the
      -- previous one. NULL when the season has no complete month yet.
      'completeThrough', CASE WHEN v_complete >= make_date(v_season, 8, 1)
                              THEN to_char(least(v_complete, make_date(v_season + 1, 7, 1)), 'YYYY-MM') END,
      'completeTotal', CASE WHEN v_complete >= make_date(v_season, 8, 1) THEN (
        SELECT coalesce(sum(m.n), 0)
          FROM his_immunization_month m
          JOIN his_vaccine_dim d USING (vaccine_code)
         WHERE d.family IN ('flu', 'flu_nasal')
           AND m.period >= make_date(v_season, 8, 1)
           AND m.period <= v_complete
           AND m.period <  make_date(v_season + 1, 8, 1)) END,
      'sameMonthsLastSeason', CASE WHEN v_complete >= make_date(v_season, 8, 1) THEN (
        SELECT coalesce(sum(m.n), 0)
          FROM his_immunization_month m
          JOIN his_vaccine_dim d USING (vaccine_code)
         WHERE d.family IN ('flu', 'flu_nasal')
           AND m.period >= make_date(v_season - 1, 8, 1)
           AND m.period <= (v_complete - interval '1 year')::date
           AND m.period <  make_date(v_season, 8, 1)) END,
      -- Season to date from the report page's daily counter (fresher than the
      -- monthly cells): its calendar-year total minus this year's Jan–Jul
      -- monthly cells. Only for the season the open counter covers.
      'seasonToDate', v_daily -> -1 -> 'n',
      'seasonToDateAsOf', v_daily -> -1 -> 'asOf',
      'seasonToDateBasis', 'his_daily',
      'byAge', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'ageBand', age_band, 'ageOrder', age_order,
                 'flu', flu, 'fluNasal', nasal) ORDER BY age_order), '[]'::jsonb)
          FROM (SELECT m.age_band, m.age_order,
                       sum(m.n) FILTER (WHERE d.family = 'flu')       AS flu,
                       sum(m.n) FILTER (WHERE d.family = 'flu_nasal') AS nasal
                  FROM his_immunization_month m
                  JOIN his_vaccine_dim d USING (vaccine_code)
                 WHERE d.family IN ('flu', 'flu_nasal')
                   AND m.period >= make_date(v_season, 8, 1)
                   AND m.period <  make_date(v_season + 1, 8, 1)
                 GROUP BY 1, 2) a
      )
    ),

    -- §5 Какво липсва: vaccines on the weekly shortage list, per window. Absence
    -- from the list is not evidence of supply (§7.7).
    'shortage', jsonb_build_object(
      'basis', 'ial_shortage',
      'asOf', v_asof -> 'ial_shortage',
      'firstWindow', (SELECT min(valid_from) FROM ial_shortage_week),
      'weeks', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'validFrom', w.valid_from, 'validTo', w.valid_to,
                 'products', w.products, 'vaccines', w.vaccines)
               ORDER BY w.valid_from), '[]'::jsonb)
          FROM (SELECT valid_from, max(valid_to) AS valid_to, count(*) AS products,
                       coalesce(jsonb_agg(DISTINCT name) FILTER (WHERE is_vaccine), '[]'::jsonb) AS vaccines
                  FROM ial_shortage_week
                 WHERE valid_from >= make_date(v_season, 8, 1)
                   AND valid_from <  make_date(v_season + 1, 8, 1)
                 GROUP BY valid_from) w
      )
    ),

    -- §6 Заболяемост: national weekly incidence (all ages) + virology.
    'incidence', jsonb_build_object(
      'basis', 'ncipd_flu',
      'asOf', v_asof -> 'ncipd_flu',
      'weeks', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'weekStart', i.week_start, 'isoWeek', i.iso_week,
                 'cases', i.cases, 'ratePer10k', i.rate_per_10k)
               ORDER BY i.week_start), '[]'::jsonb)
          FROM flu_incidence_week i
         WHERE i.oblast_code = 'BG' AND i.age_band = 'all'
           AND i.week_start >= make_date(v_season, 8, 1)
           AND i.week_start <  make_date(v_season + 1, 8, 1)
      ),
      'virology', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'weekStart', v.week_start, 'tested', v.tested,
                 'aH1n1', v.a_h1n1, 'aH1n1pdm09', v.a_h1n1pdm09, 'aH3n2', v.a_h3n2,
                 'bVictoria', v.b_victoria, 'bYamagata', v.b_yamagata)
               ORDER BY v.week_start), '[]'::jsonb)
          FROM flu_virology_week v
         WHERE v.week_start >= make_date(v_season, 8, 1)
           AND v.week_start <  make_date(v_season + 1, 8, 1)
      )
    ),

    -- §7 Откъде: monthly import value of ALL human vaccines (CN 3002 41), and the
    -- dispatching countries over the season's months. Two-letter partners only —
    -- Eurostat's aggregates are not countries. Dispatch ≠ manufacture (§7.6).
    'imports', jsonb_build_object(
      'basis', 'eurostat_comext_300241',
      'asOf', v_asof -> 'eurostat_trade',
      'monthly', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'month', to_char(period, 'YYYY-MM'), 'eur', eur) ORDER BY period), '[]'::jsonb)
          FROM (SELECT period, sum(value_eur) AS eur
                  FROM vaccine_trade_month
                 WHERE flow = 'import' AND partner ~ '^[A-Z]{2}$'
                 GROUP BY period) t
      ),
      'partners', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('partner', partner, 'eur', eur)
               ORDER BY eur DESC), '[]'::jsonb)
          FROM (SELECT partner, sum(value_eur) AS eur
                  FROM vaccine_trade_month
                 WHERE flow = 'import' AND partner ~ '^[A-Z]{2}$'
                   AND period >= make_date(v_season, 8, 1)
                   AND period <  make_date(v_season + 1, 8, 1)
                 GROUP BY partner
                 ORDER BY 2 DESC
                 LIMIT 10) p
      )
    ),

    -- §8 Парите: МЗ's vaccine contracts (CPV 336516, human vaccines; 33651690
    -- veterinary excluded) by year and supplier. Every edge is a contract.
    'contracts', jsonb_build_object(
      'basis', 'procurement_contracts',
      'awarderEik', '000695317',
      'rows', v_contracts
    ),

    -- §9 Спрямо ЕС: Eurostat's 65+ coverage. A different basis from НЗИС's
    -- 60+ counts and never combined with them (§7.2).
    'euCoverage', jsonb_build_object(
      'basis', 'eurostat_hlth_ps_immu_65plus',
      'asOf', v_asof -> 'eurostat_coverage',
      'rows', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('geo', geo, 'year', year, 'pct', pct)
               ORDER BY geo, year), '[]'::jsonb)
          FROM flu_coverage_eu
      )
    )
  );
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION vaccines_oblast(integer, text), vaccines_overview(integer)
      TO app_readonly;
  ELSE
    RAISE WARNING 'app_readonly absent — 206 granted no EXECUTE on the vaccines serving '
                  'functions. Run db:pg:bootstrap.';
  END IF;
END
$$;
