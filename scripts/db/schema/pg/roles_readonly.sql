-- Least-privilege role for the PUBLIC endpoints (/api/sql + /api/db). It can
-- READ everything in `public` and EXECUTE the search/query functions — and
-- nothing else: no writes, no DDL, no other schemas, no superuser functions.
-- Defense-in-depth *underneath* the function layer's read-only transaction +
-- statement_timeout + row cap: even a bug there can't mutate data.
--
-- Run this ONCE against the deployed Cloud SQL DB (as `postgres`, through the
-- Auth Proxy), then set the role's password and the ELECTIONSBG_DB_READONLY_PASSWORD
-- secret, then redeploy the db + sql functions. See the runbook in
-- docs/plans/postgres-migration-v1.md.
--
-- The ALTER DEFAULT PRIVILEGES lines are ESSENTIAL: the TR loaders DROP + recreate
-- tables (tr_companies / tr_officers / tr_person_roles / contractor_search), which
-- strips per-table grants on every reload. Default privileges re-grant SELECT /
-- EXECUTE automatically on anything the loader role (postgres) creates in public,
-- so the role keeps working after every db:load:tr:pg.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_readonly') THEN
    -- LOGIN role; password is set separately (never committed to git).
    CREATE ROLE app_readonly LOGIN;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE electionsbg TO app_readonly;
GRANT USAGE ON SCHEMA public TO app_readonly;

-- Existing objects.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_readonly;

-- Future objects created by the loader role (postgres) — survives drop+recreate.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT ON TABLES TO app_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO app_readonly;
