-- 201_admin_service_requests.sql — e-service REQUEST volumes from МЕУ's еФорми system.
--
-- Source: data.egov.bg dataset 20218 „Списък на заявените услуги през надградената система
-- еФорми", one resource per month, fetched by scripts/administration/fetch_eforms.ts into the
-- COMMITTED data/administration/eforms_requests.json, loaded by
-- scripts/db/load_admin_service_requests_pg.ts (db:load:admin-service-requests:pg).
--
-- Three things a consumer must not get backwards:
--   * REQUESTS, not completions — „заявени" carries no outcome;
--   * еФорми ONLY — a service a body runs on its own portal is absent here, not zero;
--   * MONTHS ARE MISSING — the publisher skipped 2025-01…04, 2025-07…08 and 2026-02 (as of
--     2026-10-21). `admin_service_requests_month` lists the months that WERE published, so a
--     period total can say how many months it spans; a month absent from it is unpublished,
--     never a month with no requests.
--
-- service_id is the ИИСДА id `admin_services.service_id` (068) carries — 295 of the 407
-- services seen so far join it, so the name is stored here too rather than borrowed.

CREATE TABLE IF NOT EXISTS admin_service_requests_month (
  period        date PRIMARY KEY,        -- first day of the month
  resource_uri  text NOT NULL,
  published_at  text NOT NULL,           -- the portal's own resource stamp, as published
  service_count integer NOT NULL CHECK (service_count > 0),
  request_total bigint  NOT NULL CHECK (request_total >= 0)
);

CREATE TABLE IF NOT EXISTS admin_service_requests (
  period       date    NOT NULL REFERENCES admin_service_requests_month (period),
  service_id   text    NOT NULL,
  service_name text    NOT NULL,
  requests     integer NOT NULL CHECK (requests >= 0),
  PRIMARY KEY (period, service_id)
);

-- One service's series.
CREATE INDEX IF NOT EXISTS idx_admin_service_requests_service
  ON admin_service_requests (service_id, period);

-- Role-guarded: a database where roles_readonly.sql has not run has no app_readonly, and a
-- bare GRANT would 42704 and roll this whole file back.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON admin_service_requests, admin_service_requests_month TO app_readonly;
  END IF;
END $$;
