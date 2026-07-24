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
-- Final btrim(regexp_replace(…, '[[:space:]–—-]+', ' ')) collapses every run of
-- whitespace and hyphen/dash variants (ASCII '-', en '–', em '—') to a SINGLE space, so a
-- double surname folds the same however the source spaced it: "Асиова-Диамант",
-- "Асиова - Диамант" and "Асиова Диамант" all land on `asiova diamant`. Without this the
-- exact-key person↔TR bridge (name_fold = name_fold) silently drops the spaced variants —
-- the Commerce Registry writes the same person's name inconsistently across filings.
-- IMMUTABLE is preserved (regexp_replace/btrim are immutable). Changing this body makes
-- every STORED *_fold generated column stale until recomputed — see
-- 099_translit_fold_recompute.sql.
CREATE OR REPLACE FUNCTION translit_bg_latin(txt text)
  RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$
  SELECT btrim(regexp_replace(
    lower(public.unaccent('public.unaccent'::regdictionary, translate(
    replace(replace(replace(replace(replace(replace(replace(
    replace(replace(replace(replace(replace(replace(replace(
      coalesce(txt, ''),
      'ж','zh'),'Ж','zh'),'ц','ts'),'Ц','ts'),'ч','ch'),'Ч','ch'),
      'ш','sh'),'Ш','sh'),'щ','sht'),'Щ','sht'),'ю','yu'),'Ю','yu'),
      'я','ya'),'Я','ya'),
    'абвгдезийклмнопрстуфхъьАБВГДЕЗИЙКЛМНОПРСТУФХЪЬ',
    'abvgdeziyklmnoprstufhayabvgdeziyklmnoprstufhay'))),
    '[[:space:]–—-]+', ' ', 'g'));
$$;

-- Retire the old immutable_unaccent wrapper (its body dependency broke pg_dump
-- restore ordering); translit_bg_latin no longer references it.
DROP FUNCTION IF EXISTS immutable_unaccent(text);

-- Entity-class classifier over the TR legal_form zoo (40+ code + Cyrillic
-- variants). IMMUTABLE so it can drive a STORED generated column on
-- tr_companies. ЮЛНЦ classes (сдружение/фондация/читалище) are the NGO surface;
-- coop, state_enterprise and foreign_branch are their own (non-NGO) classes so
-- the product can segment them. Everything else = company.
CREATE OR REPLACE FUNCTION tr_entity_class(legal_form text)
  RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$
  SELECT CASE
    WHEN legal_form IN ('ASSOC', 'Сдружение')                       THEN 'ngo_assoc'
    WHEN legal_form IN ('FOUND', 'Фондация')                        THEN 'ngo_found'
    WHEN legal_form IN ('CC', 'Народно читалище')
         OR legal_form ILIKE '%читалищ%'                            THEN 'chitalishte'
    WHEN legal_form IN ('K', 'Кооперация')                          THEN 'coop'
    WHEN legal_form IN ('TPP', 'TPPD')                              THEN 'state_enterprise'
    WHEN legal_form IN ('BFLE', 'KCHT', 'Клон на ЧЮЛНЦ')
         OR legal_form ILIKE '%чуждестранен търговец%'
         OR legal_form ILIKE '%клон%чуждестранн%'                   THEN 'foreign_branch'
    ELSE 'company'
  END;
$$;

-- Heuristic NGO sub-type (LittleSis-style categorisation) so influence analysis
-- can distinguish a sports club from a think-tank. Name+form based, best-effort;
-- IMMUTABLE for a STORED generated column. Only meaningful for NGO classes.
CREATE OR REPLACE FUNCTION tr_ngo_type(name text, legal_form text)
  RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$
  SELECT CASE
    WHEN tr_entity_class(legal_form) NOT IN ('ngo_assoc','ngo_found','chitalishte')
      THEN NULL
    WHEN name ILIKE '%спорт%' OR name ILIKE '%футбол%' OR name ILIKE '%волейбол%'
      OR name ILIKE '%баскетбол%' OR name ILIKE '%тенис%' OR name ILIKE '%борба%'
      OR name ILIKE '%шахмат%' OR name ILIKE '%клуб по%' OR name ILIKE '%сдружение по%'
      THEN 'sport'
    WHEN name ILIKE '%ловно%' OR name ILIKE '%риболов%' OR name ILIKE '%ловец%'
      THEN 'hunting'
    WHEN name ILIKE '%училищ%' OR name ILIKE '%настоятелств%'
      OR name ILIKE '%родителс%' OR name ILIKE '%детск%градин%'
      THEN 'school'
    WHEN tr_entity_class(legal_form) = 'chitalishte'
      THEN 'chitalishte'
    WHEN name ILIKE '%камара%' OR name ILIKE '%федерация%' OR name ILIKE '%асоциация%'
      OR name ILIKE '%съюз%' OR name ILIKE '%браншов%' OR name ILIKE '%гилдия%'
      THEN 'chamber'
    WHEN name ILIKE '%пчелар%' OR name ILIKE '%земеделск%' OR name ILIKE '%животновъд%'
      OR name ILIKE '%лозар%'
      THEN 'professional'
    ELSE 'other'
  END;
$$;

-- Rebuild the contracts_list serving view (SELECT c.* + КЗК appeal flags) from a
-- single definition. A `SELECT c.*` view freezes its column list at creation, so
-- it must be recreated whenever a column is added to `contracts` (e.g. 049 unp,
-- 050 lot_name). Migrations 042 (appeals) and 050 both need to rebuild it, and
-- "whichever runs last wins" is only safe if they rebuild it identically — so the
-- body lives here, called by both, instead of being duplicated. Applied first by
-- both loaders (FN_FILE), so it exists before either caller. plpgsql bodies are
-- validation-deferred, so referencing the appeals matviews here is fine even on a
-- contracts-/appeals-less DB; the guards adapt at call time.
CREATE OR REPLACE FUNCTION rebuild_contracts_list() RETURNS void AS $fn$
BEGIN
  IF to_regclass('public.contracts') IS NULL THEN
    RETURN;
  END IF;
  DROP VIEW IF EXISTS contracts_list;
  IF to_regclass('public.appealed_ocids') IS NOT NULL
     AND to_regclass('public.upheld_ocids') IS NOT NULL THEN
    EXECUTE $v$
      CREATE VIEW contracts_list AS
        SELECT c.*,
          (ao.ocid IS NOT NULL) AS has_appeal,
          (uo.ocid IS NOT NULL) AS appeal_upheld
        FROM contracts c
        LEFT JOIN appealed_ocids ao ON ao.ocid = c.ocid
        LEFT JOIN upheld_ocids uo ON uo.ocid = c.ocid
    $v$;
  ELSE
    EXECUTE $v$
      CREATE VIEW contracts_list AS
        SELECT c.*, false AS has_appeal, false AS appeal_upheld
        FROM contracts c
    $v$;
  END IF;
  EXECUTE 'GRANT SELECT ON contracts_list TO app_readonly';
END;
$fn$ LANGUAGE plpgsql;
