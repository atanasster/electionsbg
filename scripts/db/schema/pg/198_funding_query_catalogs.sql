-- Additive funding query catalogs and revision tokens. Data readers never mutate them.
CREATE TABLE IF NOT EXISTS funding_query_revisions(resource text PRIMARY KEY,generation bigint NOT NULL DEFAULT 0,changed_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION funding_query_touch_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO funding_query_revisions(resource,generation) VALUES(TG_TABLE_NAME,1)
 ON CONFLICT(resource) DO UPDATE SET generation=funding_query_revisions.generation+1,changed_at=now();
 RETURN NULL;
END $$;
CREATE TABLE IF NOT EXISTS funding_programmes(corpus text NOT NULL,code text NOT NULL,label_bg text NOT NULL,label_en text,period text NOT NULL,mechanism text NOT NULL,fund_type text NOT NULL,eligible_nuts text[],PRIMARY KEY(corpus,code));
CREATE TABLE IF NOT EXISTS funding_themes(id text PRIMARY KEY,label_bg text NOT NULL,label_en text NOT NULL,keywords text[] NOT NULL,programme_ids text[] NOT NULL);
CREATE TABLE IF NOT EXISTS funding_sectors(id text PRIMARY KEY,label_bg text NOT NULL,label_en text NOT NULL,eiks text[] NOT NULL);
CREATE TABLE IF NOT EXISTS funding_isun_observations(contract_number text PRIMARY KEY,total_eur double precision,grant_eur double precision,own_cofinance_eur double precision,paid_eur double precision,observed_mask int NOT NULL CHECK(observed_mask BETWEEN 0 AND 15),source_hash text NOT NULL);
CREATE TABLE IF NOT EXISTS funding_query_meta(key text PRIMARY KEY,value jsonb NOT NULL);
DO $$ DECLARE rel text; BEGIN
 FOREACH rel IN ARRAY ARRAY['fund_projects','agri_subsidies','interreg_operations','interreg_partners','interreg_programmes','funding_programmes','funding_themes','funding_sectors','funding_isun_observations','funding_query_meta','person','person_role','ingest_first_seen','contracts','debarred'] LOOP
  IF EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass(rel) AND relkind IN ('r','p')) THEN
   INSERT INTO funding_query_revisions(resource) VALUES(rel) ON CONFLICT DO NOTHING;
   EXECUTE format('DROP TRIGGER IF EXISTS funding_query_revision ON %I',rel);
   EXECUTE format('CREATE TRIGGER funding_query_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION funding_query_touch_revision()',rel);
  END IF;
 END LOOP;
 IF to_regclass('person_role') IS NOT NULL AND to_regclass('person') IS NOT NULL THEN
  EXECUTE $view$CREATE OR REPLACE VIEW funding_political_eiks AS SELECT DISTINCT r.ref AS eik FROM person_role r JOIN person p ON p.person_id=r.person_id WHERE r.source IN ('tr','ngo') AND r.confidence IN ('exact_id','high','manual') AND p.status='active' AND p.is_public_figure$view$;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_readonly') THEN
  GRANT SELECT ON funding_query_revisions,funding_programmes,funding_themes,funding_sectors,funding_isun_observations,funding_query_meta TO app_readonly;
  IF to_regclass('funding_political_eiks') IS NOT NULL THEN GRANT SELECT ON funding_political_eiks TO app_readonly; END IF;
 END IF;
END $$;
