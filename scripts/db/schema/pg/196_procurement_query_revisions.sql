-- Change tokens for query links/cursors; statement triggers avoid per-row work.
-- Reads never update these rows. All updates publish with the source transaction.
CREATE TABLE IF NOT EXISTS procurement_query_revisions (
  resource text PRIMARY KEY,
  generation bigint NOT NULL DEFAULT 0,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION procurement_query_touch_revision() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  INSERT INTO procurement_query_revisions(resource,generation,changed_at)
    VALUES (TG_TABLE_NAME,1,now())
  ON CONFLICT(resource) DO UPDATE SET generation=procurement_query_revisions.generation+1,changed_at=now();
  RETURN NULL;
END $$;
DO $$ DECLARE rel text; BEGIN
  FOREACH rel IN ARRAY ARRAY['contracts','tenders','kzk_appeals','kzk_decisions','contract_risk_cache'] LOOP
    IF to_regclass(rel) IS NOT NULL THEN
      INSERT INTO procurement_query_revisions(resource) VALUES(rel) ON CONFLICT DO NOTHING;
      EXECUTE format('DROP TRIGGER IF EXISTS procurement_query_revision ON %I',rel);
      EXECUTE format('CREATE TRIGGER procurement_query_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION procurement_query_touch_revision()',rel);
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_readonly') THEN
    GRANT SELECT ON procurement_query_revisions TO app_readonly;
  END IF;
END $$;
