-- 099_translit_fold_recompute.sql — ONE-TIME data migration (NOT wired into the idempotent
-- load_pg.ts file list; run manually once per deployment AFTER 000_search_fns.sql ships the
-- whitespace/hyphen-collapsing translit_bg_latin()).
--
-- Why: translit_bg_latin() now folds "Асиова-Диамант" / "Асиова - Диамант" / "Асиова Диамант"
-- to one key. STORED generated *_fold columns do NOT recompute on a function-body change —
-- they only recompute when their row is (re)written. A no-op `UPDATE t SET base = base`
-- rewrites every row, recomputing the generated fold against the new function. Every fold
-- consumer folds the QUERY at query time with the new function, so stale stored folds would
-- silently break exact-key matching (person↔TR bridge) and search for any hyphenated/multi-
-- spaced name until this runs.
--
-- After this file: re-run the person graph so person/person_alias/person_role rebuild on the
-- new folds and the dropped spaced-variant TR links attach —
--   npm run db:resolve:persons
--   npm run db:load:declarations:pg -- --resolve
--   npm run db:load:person-elections:pg
--   npm run person:slugs
-- (person/person_alias fold columns are recomputed by that rebuild's INSERTs, so they are
-- intentionally NOT rewritten here.)

-- Fail fast if 000's new normalizer is not in place — otherwise this rewrites 4M rows to the
-- same stale value for nothing.
DO $$
BEGIN
  IF translit_bg_latin('А - Б') <> 'a b' THEN
    RAISE EXCEPTION 'translit_bg_latin() has not been updated to collapse hyphen/whitespace; apply 000_search_fns.sql first';
  END IF;
END $$;

-- Recompute every STORED *_fold generated column not rebuilt by db:resolve:persons.
-- (base = base touches a real column, forcing the generated-column recompute.)
UPDATE tr_person_roles  SET name = name;
UPDATE tr_officers      SET name = name;
UPDATE tr_companies     SET name = name;
UPDATE contracts        SET title = title;
UPDATE tenders          SET buyer_name = buyer_name;   -- also recomputes subject_fold (same row)
UPDATE contractor_search SET name = name;
UPDATE awarder_search   SET name = name;

-- Refresh the matviews aggregated/joined on those folds so their keys track the new folds.
REFRESH MATERIALIZED VIEW owner_name_counts;
REFRESH MATERIALIZED VIEW officer_name_counts;
REFRESH MATERIALIZED VIEW company_officer_counts;
REFRESH MATERIALIZED VIEW company_person_roles;
REFRESH MATERIALIZED VIEW declaration_stake_company;
