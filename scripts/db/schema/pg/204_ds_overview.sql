-- 204 — the aggregate serving layer over the comdos.bg ДС corpus (203), for a
-- future /data/ds page. Applied by
-- `db:load:ds:pg` after 203.
--
-- ⚠️⚠️ AGGREGATES ONLY. `ds_announcement` names people and is deliberately not
-- readable by app_readonly (203). This function is SECURITY DEFINER so the serving
-- role can read the COUNTS, and it must never return a name, a pseudonym, a birth
-- date, a place or a free-text field — a per-person surface goes through the person
-- layer and rule 2 (scripts/person/dsJoin.ts). New functions get EXECUTE through the
-- default privileges, so a column added here is published the moment it ships.
-- ds_overview.data.test.ts fails if the payload carries any announced name.
--
-- Three bases, named in the payload so a consumer cannot mix them:
--   * `checked` — people the Commission CHECKED (every decision with a document).
--   * `records` — announcement BLOCKS. One person is announced again in every
--     decision that covers a new office of theirs, so records ≠ people.
--   * `people`  — distinct (folded name, birth date) among the 'establish' blocks,
--     the only section that prints a birth date. An estimate of distinct humans,
--     not an identity claim; it is never broken down below the corpus level.
--
-- ⚠️ A HIT RATE IS recordsOfChecked / checked, NEVER records / checked. Some
-- decisions with a document print no „Проверени са N лица" line (`withoutChecked`),
-- yet still announce people; dividing every record by the checked count of the
-- OTHER decisions overstates the rate (measured 5.15% against 4.17% corpus-wide,
-- unevenly by sector and year).
--
-- A decision with no document carries UNKNOWN counts (203's CHECK) and is reported
-- as `withoutDocument`, never folded into a rate as zero findings.

CREATE OR REPLACE FUNCTION ds_sector(p_title text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  -- ORDERED: the first matching bucket wins. A title-keyword classifier, so the
  -- `other` bucket is reported rather than hidden (plan §6 open question — a curated
  -- title→sector table would be the honest replacement).
  SELECT CASE
    WHEN t ~ '(избор|кандидат|\mрик\M|\mцик\M|европейски парламент|народни представители|президент)' THEN 'elections'
    -- before every rule that would otherwise claim an ЮЛНЦ title by its subject
    WHEN t ~ '(\mюлнц\M|сдружени|фондаци|синдикат|камара|подкрепа|\mкнсб\M|\mсъюз)' THEN 'ngo'
    WHEN t ~ '(народно(?:то)? събрание|министерски съвет|областни управи|министер|областн[аи] администрац|заместник-министр)' THEN 'state'
    WHEN t ~ '(община|общински|кмет|районна администрация|главни архитекти)' THEN 'municipal'
    WHEN t ~ '(съд|прокур|следовател|адвокат|нотариус|следств)' THEN 'judiciary'
    WHEN t ~ '(университет|академия|училищ|\mбан\M|институт|общи събрания|ректор)' THEN 'academia'
    WHEN t ~ '(\mбнт\M|\mбнр\M|\mбта\M|медии|вестник|телевизи|радио|печат)' THEN 'media'
    WHEN t ~ '(\mпп\M|партия|политическ|коалиция)' THEN 'parties'
    -- the company forms as WHOLE words: a bare `ад\M` also matches „град" and
    -- surnames ending in -ад
    WHEN t ~ '(приватиз|предприяти|\mе?ад\M|\mоод\M|\mеоод\M|\mпф\M|банк|\mктб\M|застрах|пенсионн|инвест|дружеств|холдинг)' THEN 'business'
    WHEN t ~ '(федерация|спорт|олимпийск)' THEN 'sport'
    WHEN t ~ '(агенци|комиси|служб|фонд|дирекци|регулатор|съвет)' THEN 'agencies'
    WHEN t ~ '(религиоз|църк|мюфтийство|митрополи|синод)' THEN 'religion'
    ELSE 'other'
  END
  FROM (SELECT lower(coalesce(p_title, '')) AS t) s
$$;

CREATE OR REPLACE FUNCTION ds_overview()
RETURNS jsonb
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH d AS (
    SELECT decision_id, has_document, checked, deceased, person_count,
           ds_sector(title) AS sector,
           extract(year FROM decision_date)::int AS year
      FROM ds_decision
  ),
  a AS (
    SELECT an.decision_id, an.section, an.categories, an.recruit_year,
           an.after_nov_1989, an.name_fold, an.birth_date, d.sector, d.year
      FROM ds_announcement an JOIN d USING (decision_id)
  )
  SELECT jsonb_build_object(
    'totals', (SELECT jsonb_build_object(
        'decisions', count(*),
        'withoutDocument', count(*) FILTER (WHERE NOT has_document),
        'checked', sum(checked) FILTER (WHERE has_document),
        'records', sum(person_count) FILTER (WHERE has_document),
        'recordsOfChecked', sum(person_count) FILTER (WHERE checked IS NOT NULL),
        'withoutChecked', count(*) FILTER (WHERE has_document AND checked IS NULL),
        'deceasedNotPublished', sum(deceased) FILTER (WHERE has_document),
        'people', (SELECT count(DISTINCT (name_fold, birth_date)) FROM a
                    WHERE section = 'establish' AND birth_date IS NOT NULL),
        'afterNov1989Records', (SELECT count(*) FROM a WHERE after_nov_1989)
      ) FROM d),
    'bySector', (SELECT coalesce(jsonb_agg(x ORDER BY x->>'sector'), '[]') FROM (
        SELECT jsonb_build_object(
          'sector', sector,
          'decisions', count(*),
          'withoutDocument', count(*) FILTER (WHERE NOT has_document),
          'checked', sum(checked) FILTER (WHERE has_document),
          'records', sum(person_count) FILTER (WHERE has_document),
          'recordsOfChecked', sum(person_count) FILTER (WHERE checked IS NOT NULL),
          'withoutChecked', count(*) FILTER (WHERE has_document AND checked IS NULL)) x
        FROM d GROUP BY sector) s),
    'byYear', (SELECT coalesce(jsonb_agg(x ORDER BY (x->>'year')::int), '[]') FROM (
        SELECT jsonb_build_object(
          'year', year,
          'decisions', count(*),
          'withoutDocument', count(*) FILTER (WHERE NOT has_document),
          'checked', sum(checked) FILTER (WHERE has_document),
          'records', sum(person_count) FILTER (WHERE has_document),
          'recordsOfChecked', sum(person_count) FILTER (WHERE checked IS NOT NULL),
          'withoutChecked', count(*) FILTER (WHERE has_document AND checked IS NULL)) x
        FROM d WHERE year IS NOT NULL GROUP BY year) s),
    -- categories over RECORDS: a block may carry several (агент + ДЛ)
    'categories', (SELECT coalesce(jsonb_object_agg(c, n), '{}') FROM (
        SELECT c, count(*) n FROM a, unnest(categories) c GROUP BY c) s),
    -- recruitment year over distinct PEOPLE, so a re-announced person counts once
    'recruitYears', (SELECT coalesce(jsonb_agg(jsonb_build_object('year', y, 'people', n)
                                       ORDER BY y), '[]') FROM (
        SELECT recruit_year y, count(DISTINCT (name_fold, birth_date)) n FROM a
         WHERE section = 'establish' AND birth_date IS NOT NULL
           AND recruit_year IS NOT NULL
         GROUP BY recruit_year) s)
  )
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION ds_overview() TO app_readonly;
  END IF;
END $$;
