-- 176_translit_homoglyph_refold.sql — ONE-TIME data migration (NOT wired into any
-- idempotent file list; run manually once per deployment AFTER 000_search_fns.sql ships
-- the homoglyph-aware translit_bg_latin()).
--
-- Why: `translit_bg_latin()` gained two fixes (docs/plans/search-fold-homoglyphs-v1.md).
-- `unaccent` now runs BEFORE the Cyrillic→Latin translate — it folds `ё` into a plain
-- Cyrillic `е`, which used to re-enter the output after the translate had already run —
-- and the mapping now covers the Cyrillic HOMOGLYPHS that are not Bulgarian letters
-- (`і` U+0456 alone occurs 2,155,780 times, because ЦАИС writes „Раздел І:" with it).
--
-- STORED generated *_fold columns do NOT recompute on a function-body change; they
-- recompute when their row is rewritten. A no-op `UPDATE t SET base = base` does that.
-- This is 099_translit_fold_recompute.sql's pattern, for the same reason and with the
-- same shape — read that file first if this one is unfamiliar.
--
-- ⚠️ UNTIL THIS RUNS, THE TWO SIDES DISAGREE AND SOME SEARCHES THAT WORK TODAY BREAK.
-- Every consumer folds the QUERY with the new function while the stored folds still hold
-- the old output, so a reader typing the Cyrillic `І` no longer matches the stored `і`
-- (the query now folds to `i`) and a reader typing `i` does not match it either. That is
-- a narrower window than it sounds — those rows were already unfindable by anyone typing
-- Latin — but it is a REGRESSION for the Cyrillic spelling, so this migration belongs in
-- the same maintenance window as the function, on every database, not the next one.
--
-- After this file, the LOADER-WRITTEN fold needs its own pass — `tender_search_text.fold`
-- is not a generated column, so no UPDATE here touches it:
--   npx tsx scripts/db/load_tender_dossier_pg.ts --refold           (--dry-run to report)
-- That mode reads only rows already in Postgres, so it works on a machine with no
-- `raw_data/procurement/eop_dossier.sqlite`, which is where the repair is most needed. It
-- slices its transactions like the loader proper and re-running it is the repair for an
-- interrupted run. Measured here: 50,256 stale → 0 of 50,283 rows in 20 min.
--
-- And, as in 099, the person layer rebuilds its own folds through the resolver:
--   npm run db:resolve:persons
--   npm run db:load:declarations:pg -- --resolve
--   npm run db:load:person-elections:pg
--   npm run person:slugs

-- Fail fast if 000's homoglyph mapping is not in place — otherwise this rewrites ~4M rows
-- to the same stale value for nothing, and reports success. Both arms are checked because
-- they are independent fixes: a database could carry the reorder without the mapping.
DO $$
BEGIN
  IF translit_bg_latin('ё') <> 'e' THEN
    RAISE EXCEPTION
      'translit_bg_latin() still folds ё to a Cyrillic е — apply 000_search_fns.sql first';
  END IF;
  IF translit_bg_latin('І') <> 'i' THEN
    RAISE EXCEPTION
      'translit_bg_latin() does not map the Cyrillic homoglyphs — apply 000_search_fns.sql first';
  END IF;
END $$;

-- Recompute every STORED *_fold generated column, by touching THE COLUMN ITS OWN
-- EXPRESSION READS.
--
-- ⚠️⚠️ ONE TOUCH PER TABLE IS NOT ENOUGH, AND 099 SAYS OTHERWISE — IT IS WRONG.
-- 099 writes `UPDATE tenders SET buyer_name = buyer_name` with the comment "also
-- recomputes subject_fold (same row)". Measured on PostgreSQL 16.14 after exactly that
-- statement ran here over all 237,806 rows: `buyer_fold` went 245 → 0 stale while
-- `subject_fold` stayed at 4,477 and disagreed with a fresh `translit_bg_latin(subject)`.
-- Postgres recomputes a stored generated column when a column ITS EXPRESSION DEPENDS ON
-- is in the UPDATE's target list — not on every row rewrite. So a table with two folds
-- needs both sources touched, and the failure is silent: the migration succeeds, the row
-- counts reconcile, and one of the two columns keeps the old fold for ever.
--
-- The source column per fold, read from `pg_get_expr` rather than assumed:
--   awarder_search.name_fold    ← name           tenders.buyer_fold    ← buyer_name
--   contractor_search.name_fold ← name           tenders.subject_fold  ← subject
--   contracts.title_fold        ← title          tr_companies.name_fold    ← name
--   person.name_fold            ← display_name   tr_officers.name_fold     ← name
--   person_alias.alias_fold     ← alias_raw      tr_person_roles.name_fold ← name
--   person_search.name_fold     ← name
UPDATE tr_person_roles   SET name = name;
UPDATE tr_officers       SET name = name;
UPDATE tr_companies      SET name = name;
UPDATE contracts         SET title = title;
UPDATE tenders           SET buyer_name = buyer_name, subject = subject;
UPDATE contractor_search SET name = name;
UPDATE awarder_search    SET name = name;
-- Not in 099, because it did not exist then. `person_search` is rebuilt wholesale by
-- `db:load:person-search:pg`, so this is belt-and-braces — but that loader is a separate
-- step nothing here can force, and until it runs those rows are unfindable by the Latin
-- spelling. Touching them costs one pass over a derived table.
UPDATE person_search     SET name = name;
-- `person` / `person_alias` are rebuilt by `db:resolve:persons` (099's reasoning) and
-- measured CLEAN here — 0 residue and 0 stale rows on both — so they are deliberately not
-- rewritten. If a future corpus puts a homoglyph in a person name, the resolver's own
-- INSERTs will fold it correctly; nothing needs to happen in this file.

-- Refresh the matviews aggregated/joined on those folds so their keys track the new folds.
--
-- ⚠️ CONCURRENTLY WHERE POSSIBLE, and on a serving database that is the difference between
-- a refresh and an outage. A plain REFRESH takes an AccessExclusiveLock for its whole run,
-- so every reader of these five blocks — `company_person_roles` alone is 311 MB and takes
-- ~500 s to rebuild, which on a db-g1-small is /connections and the conflict-of-interest
-- surfaces hanging for eight minutes in the middle of the day. CONCURRENTLY takes an
-- ExclusiveLock instead and readers keep the previous contents until it commits.
--
-- Two preconditions, which is why this is a DO block rather than five plain statements:
-- CONCURRENTLY needs a UNIQUE index (all five have one) and refuses on a matview that was
-- created WITH NO DATA. The fallback matters on a COLD database — a fresh clone or a first
-- cloud deploy — where an unpopulated matview would otherwise raise and, since exec() sends
-- this file as one transaction, roll the entire refold back.
--
-- Verified on 16.14: unlike VACUUM and CREATE INDEX CONCURRENTLY, REFRESH ... CONCURRENTLY
-- IS allowed inside a transaction block, so it composes with the way migrations are applied.
DO $$
DECLARE
  mv text;
  populated boolean;
BEGIN
  FOREACH mv IN ARRAY ARRAY[
    'owner_name_counts', 'officer_name_counts', 'company_officer_counts',
    'company_person_roles', 'declaration_stake_company'
  ] LOOP
    SELECT c.relispopulated INTO populated
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'm' AND n.nspname = 'public' AND c.relname = mv;
    IF populated IS NULL THEN
      RAISE NOTICE 'skipping %: not present on this database', mv;
    ELSIF populated THEN
      EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %I', mv);
    ELSE
      -- Never populated, so there are no readers to protect and CONCURRENTLY would refuse.
      EXECUTE format('REFRESH MATERIALIZED VIEW %I', mv);
    END IF;
  END LOOP;
END $$;

-- ⚠️ VACUUM AFTERWARDS — IT IS NOT OPTIONAL, AND IT CANNOT LIVE IN THIS FILE.
-- `apply_functions.ts` runs a migration through `exec()`, which sends the whole file as
-- ONE multi-statement query, i.e. inside an implicit transaction block — and VACUUM is
-- refused there ("VACUUM cannot run inside a transaction block"), which would abort this
-- entire migration rather than merely skipping the vacuum.
--
-- It matters because rewriting every row of seven tables is exactly the shape that leaves
-- `relallvisible = 0` (the defect reload_visibility_map.data.test.ts exists for): without
-- it, index-only scans stay unavailable on the procurement and TR hot paths afterwards,
-- silently and permanently — autovacuum's insert threshold does not fire on an UPDATE-only
-- rewrite, and its dead-tuple threshold is a 20% fraction these tables will not cross.
--
-- Run this immediately after applying the file. PARALLEL 0 is required on the local docker
-- Postgres: parallel vacuum allocates a DSM segment up front and the container's 64 MB
-- /dev/shm cannot resize for a 14-index table.
--
--   psql "$DATABASE_URL" -c "VACUUM (ANALYZE, PARALLEL 0) tr_person_roles, tr_officers,
--     tr_companies, contracts, tenders, contractor_search, awarder_search;"
