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

CREATE MATERIALIZED VIEW IF NOT EXISTS company_person_roles AS
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
GRANT SELECT ON company_person_roles TO app_readonly;
