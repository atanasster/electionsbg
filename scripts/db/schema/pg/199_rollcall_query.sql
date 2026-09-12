-- Query revisions publish in the same transaction as source/identity changes.
CREATE TABLE IF NOT EXISTS rollcall_query_revisions(resource text PRIMARY KEY,generation bigint NOT NULL DEFAULT 0,changed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS rollcall_query_meta(key text PRIMARY KEY,value jsonb NOT NULL);
CREATE OR REPLACE FUNCTION rollcall_query_touch_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO rollcall_query_revisions(resource,generation) VALUES(TG_TABLE_NAME,1)
 ON CONFLICT(resource) DO UPDATE SET generation=rollcall_query_revisions.generation+1,changed_at=now();
 RETURN NULL;
END $$;
DO $$ DECLARE rel text; BEGIN
 FOREACH rel IN ARRAY ARRAY['vote_item','vote_cast','vote_day','mp_seat','party_dim','council_muni','council_muni_code','council_resolution','council_vote','person','person_role','official_roster','rollcall_query_meta'] LOOP
  IF EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass(rel) AND relkind IN ('r','p')) THEN
   INSERT INTO rollcall_query_revisions(resource) VALUES(rel) ON CONFLICT DO NOTHING;
   EXECUTE format('DROP TRIGGER IF EXISTS rollcall_query_revision ON %I',rel);
   EXECUTE format('CREATE TRIGGER rollcall_query_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION rollcall_query_touch_revision()',rel);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_readonly') THEN
  GRANT SELECT ON rollcall_query_revisions,rollcall_query_meta TO app_readonly;
 END IF;
END $$;
