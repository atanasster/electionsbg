-- 068_admin_services.sql — Административен регистър (ИИСДА) services catalogue.
-- One row per (service_id, provider tier). Source: data/administration/
-- services_catalog.json, scraped by scripts/administration/fetch_services.ts.
-- Served by the generic DbDataTable engine as resource `admin_services`
-- (browse page /sector/administration/services). Small (~2.7k rows) but belongs
-- in PG so the catalogue is searchable/paginated server-side instead of shipping
-- a 0.7 MB JSON to every visitor.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS admin_services (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_id text NOT NULL,
  name       text NOT NULL,
  tier       text NOT NULL, -- central | special_territorial | regional | municipal
  UNIQUE (service_id, tier)
);

-- Global free-text search on the service name (idx_admin_services_name_trgm).
CREATE INDEX IF NOT EXISTS idx_admin_services_name_trgm
  ON admin_services USING gin (name gin_trgm_ops);
-- Tier facet filter.
CREATE INDEX IF NOT EXISTS idx_admin_services_tier
  ON admin_services (tier);
