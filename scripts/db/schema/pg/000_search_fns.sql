-- Name-search foundation: a Cyrillic→Latin fold so company/officer/contract
-- name search works over ONE normalized form regardless of script (BG or EN),
-- case, or diacritics — then pg_trgm does partial + fuzzy on top.
-- See docs/plans/postgres-migration-v1.md (Feature 1).

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() is only STABLE (it depends on the loaded dictionary), so it can't
-- appear in a generated column or index expression. Documented workaround: pin
-- the dictionary by name and assert IMMUTABLE.
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
  RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT unaccent('unaccent', $1) $$;

-- Bulgarian Streamlined System (2009) romanization + diacritic fold + lowercase.
-- "Иван Петров", "ИВАН ПЕТРОВ" and "Ivan Petrov" all collapse to "ivan petrov".
-- Both Cyrillic cases are mapped explicitly so the result is independent of the
-- database collation (lower() on Cyrillic isn't guaranteed under the C locale).
-- IMMUTABLE so it can drive STORED generated columns + GIN trigram indexes.
CREATE OR REPLACE FUNCTION translit_bg_latin(txt text)
  RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$
  SELECT lower(immutable_unaccent(translate(
    replace(replace(replace(replace(replace(replace(replace(
    replace(replace(replace(replace(replace(replace(replace(
      coalesce(txt, ''),
      'ж','zh'),'Ж','zh'),'ц','ts'),'Ц','ts'),'ч','ch'),'Ч','ch'),
      'ш','sh'),'Ш','sh'),'щ','sht'),'Щ','sht'),'ю','yu'),'Ю','yu'),
      'я','ya'),'Я','ya'),
    'абвгдезийклмнопрстуфхъьАБВГДЕЗИЙКЛМНОПРСТУФХЪЬ',
    'abvgdeziyklmnoprstufhayabvgdeziyklmnoprstufhay')));
$$;
