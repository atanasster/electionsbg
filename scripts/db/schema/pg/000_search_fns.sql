-- Name-search foundation: a Cyrillic→Latin fold so company/officer/contract
-- name search works over ONE normalized form regardless of script (BG or EN),
-- case, or diacritics — then pg_trgm does partial + fuzzy on top.
-- See docs/plans/postgres-migration-v1.md (Feature 1).

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
-- Query-level perf visibility (needs shared_preload_libraries, set in
-- docker-compose.yml locally / database flags on Cloud SQL). Harmless no-op
-- error-free create when preloaded; skipped silently on servers without it.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Bulgarian Streamlined System (2009) romanization + diacritic fold + lowercase.
-- "Иван Петров", "ИВАН ПЕТРОВ" and "Ivan Petrov" all collapse to "ivan petrov".
-- Both Cyrillic cases are mapped explicitly so the result is independent of the
-- database collation (lower() on Cyrillic isn't guaranteed under the C locale).
--
-- unaccent() is only STABLE, but we pin the dictionary and assert the whole
-- function IMMUTABLE so it can drive STORED generated columns + GIN indexes.
-- Two pg_dump/restore subtleties are handled here:
--   1. We inline unaccent rather than via a wrapper function — pg_dump doesn't
--      record dependencies inside SQL function bodies, so an intermediate user
--      function would be restored AFTER the tables that (transitively) need it.
--   2. unaccent lives in `public`; pg_restore runs with search_path='' and only
--      pg_catalog is implicit, so unaccent + its dictionary are schema-qualified
--      (translate/lower/replace are pg_catalog and resolve without qualifying).
CREATE OR REPLACE FUNCTION translit_bg_latin(txt text)
  RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$
  SELECT lower(public.unaccent('public.unaccent'::regdictionary, translate(
    replace(replace(replace(replace(replace(replace(replace(
    replace(replace(replace(replace(replace(replace(replace(
      coalesce(txt, ''),
      'ж','zh'),'Ж','zh'),'ц','ts'),'Ц','ts'),'ч','ch'),'Ч','ch'),
      'ш','sh'),'Ш','sh'),'щ','sht'),'Щ','sht'),'ю','yu'),'Ю','yu'),
      'я','ya'),'Я','ya'),
    'абвгдезийклмнопрстуфхъьАБВГДЕЗИЙКЛМНОПРСТУФХЪЬ',
    'abvgdeziyklmnoprstufhayabvgdeziyklmnoprstufhay')));
$$;

-- Retire the old immutable_unaccent wrapper (its body dependency broke pg_dump
-- restore ordering); translit_bg_latin no longer references it.
DROP FUNCTION IF EXISTS immutable_unaccent(text);
