-- Deduped officer/partner records per company, as a base relation for the
-- server-side table engine (functions/db_table.js) so the officers list on the
-- DB company page gets a standalone backend-paginated page (/db/company/:eik/
-- officers) instead of dumping all rows (a 743-partner company is a full page).
--
-- tr_person_roles keeps one row per FILING; company_officers() collapses that at
-- query time, but the table engine paginates a plain relation (no DISTINCT ON),
-- so we materialise the same current-record-per-(company, person, role) view.
-- `key` is the unique paging tiebreaker the engine needs. REFRESHed in
-- load_tr_pg.ts. Depends on tr_person_roles. SELECT auto-granted to app_readonly.

SET check_function_bodies = off;

-- DROP+CREATE, not IF NOT EXISTS — see the identical note in 008_connections.sql.
-- 003's `DROP TABLE tr_person_roles CASCADE` used to delete this on every TR load
-- and load_tr_pg.ts applies this file later in the same run, so the body
-- propagated by accident. 003 no longer drops, so without this a changed
-- `DISTINCT ON` here would reach fresh clones and NOTHING else, while the loader
-- keeps REFRESHing it. No CASCADE: nothing reads it in a stored definition today,
-- so a bare DROP fails loudly if that changes rather than deleting the new reader.
DROP MATERIALIZED VIEW IF EXISTS company_person_roles;
CREATE MATERIALIZED VIEW company_person_roles AS
  SELECT DISTINCT ON (r.uic, r.name_fold, r.role)
         r.uic || '~' || r.name_fold || '~' || COALESCE(r.role, '') AS key,
         r.uic,
         r.name,
         r.role,
         r.share,
         r.share_amount,
         r.share_currency,
         r.added_at,
         r.erased_at,
         (CASE WHEN r.erased_at IS NULL THEN 1 ELSE 0 END) AS active
  FROM tr_person_roles r
  ORDER BY r.uic, r.name_fold, r.role,
           (r.erased_at IS NULL) DESC, r.added_at DESC NULLS LAST;

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_person_roles_key
  ON company_person_roles(key);
CREATE INDEX IF NOT EXISTS idx_company_person_roles_uic
  ON company_person_roles(uic);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON company_person_roles TO app_readonly;
  END IF;
END $$;
