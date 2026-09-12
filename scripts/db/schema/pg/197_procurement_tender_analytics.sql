-- Read-only projection. No copies of complaint outcomes or source mutations.
-- Cache rebuild and revision stamp share one statement snapshot; stale caches fail closed.
CREATE OR REPLACE FUNCTION procurement_query_instant(value text) RETURNS timestamptz
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE
 WHEN value ~ '^\d{4}-\d{2}-\d{2}$' AND pg_input_is_valid(value,'date') THEN value::date::timestamp AT TIME ZONE 'UTC'
 WHEN value ~ '^\d{4}-\d{2}-\d{2}T' AND pg_input_is_valid(value,'timestamptz') THEN CASE WHEN value ~ '(Z|[+-]\d{2}:?\d{2})$' THEN value::timestamptz ELSE (value || 'Z')::timestamptz END
 ELSE NULL END
$$;
CREATE OR REPLACE VIEW procurement_tender_risk_live AS
WITH awards AS (
 SELECT unp, sum(amount_eur::numeric) AS awarded,
 min(procurement_query_instant(NULLIF(date_signed,date))) AS first_signed
 FROM contracts WHERE tag='contract' AND consortium_role IS DISTINCT FROM 'member'
 GROUP BY unp
), inputs AS (
 SELECT t.unp, t.procedure_type, t.estimated_value_eur, a.awarded,
 floor(extract(epoch FROM (procurement_query_instant(t.submission_deadline)-procurement_query_instant(t.publication_date)))/86400) AS submission_days,
 floor(extract(epoch FROM (a.first_signed-procurement_query_instant(t.submission_deadline)))/86400) AS decision_days
 FROM tenders t LEFT JOIN awards a ON a.unp=t.unp
), flags AS (
 SELECT unp,
 CASE WHEN length(procedure_type)>0 THEN procedure_type ~ 'без предварително обявление|без публикуване|без предварителна покана|Пряко договаряне|Покана до определени' END AS non_open,
 CASE WHEN procedure_type ~ 'Открита процедура|Публично състезание' AND submission_days>=0 THEN submission_days<12 END AS rushed,
 CASE WHEN decision_days>=0 THEN decision_days BETWEEN 1 AND 4 END AS short_decision,
 CASE WHEN estimated_value_eur>0 AND awarded>0 THEN awarded/estimated_value_eur::numeric>1.10 END AS over_estimate
 FROM inputs
), masks AS (
 SELECT unp,
 (CASE WHEN non_open THEN 1 ELSE 0 END + CASE WHEN rushed THEN 2 ELSE 0 END + CASE WHEN short_decision THEN 4 ELSE 0 END + CASE WHEN over_estimate THEN 8 ELSE 0 END)::int AS fired_mask,
 (CASE WHEN non_open IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN rushed IS NOT NULL THEN 2 ELSE 0 END + CASE WHEN short_decision IS NOT NULL THEN 4 ELSE 0 END + CASE WHEN over_estimate IS NOT NULL THEN 8 ELSE 0 END)::int AS available_mask
 FROM flags
)
SELECT unp, fired_mask, available_mask, bit_count(fired_mask::bit(4))::int AS fired,
 bit_count(available_mask::bit(4))::int AS available,
 100.0*bit_count(fired_mask::bit(4))/NULLIF(bit_count(available_mask::bit(4)),0) AS cri
 , '1.0.0'::text AS catalog_version
FROM masks;

CREATE TABLE IF NOT EXISTS procurement_tender_risk_cache (
 unp text PRIMARY KEY,fired_mask int,available_mask int,fired int,available int,cri numeric,catalog_version text
);
CREATE TABLE IF NOT EXISTS procurement_tender_risk_meta (
 only_row bool PRIMARY KEY DEFAULT true CHECK(only_row),catalog_version text,revision jsonb,rebuilt_at timestamptz
);
CREATE OR REPLACE FUNCTION rebuild_procurement_tender_risk() RETURNS bigint LANGUAGE sql AS $$
 WITH removed AS(DELETE FROM procurement_tender_risk_cache RETURNING unp),
 inserted AS(INSERT INTO procurement_tender_risk_cache SELECT live.* FROM procurement_tender_risk_live live CROSS JOIN (SELECT count(*) FROM removed) dependency RETURNING unp),
 stamped AS(INSERT INTO procurement_tender_risk_meta(only_row,catalog_version,revision,rebuilt_at)
 SELECT true,'1.0.0',(SELECT COALESCE(jsonb_object_agg(resource,generation::text),'{}'::jsonb) FROM procurement_query_revisions WHERE resource IN ('contracts','tenders')),clock_timestamp()
 FROM (SELECT count(*) FROM inserted) dependency
 ON CONFLICT(only_row) DO UPDATE SET catalog_version=EXCLUDED.catalog_version,revision=EXCLUDED.revision,rebuilt_at=EXCLUDED.rebuilt_at RETURNING only_row)
 SELECT count(*) FROM inserted CROSS JOIN stamped
$$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_readonly') THEN
  GRANT SELECT ON procurement_tender_risk_cache,procurement_tender_risk_meta TO app_readonly;
  GRANT EXECUTE ON FUNCTION procurement_query_instant(text) TO app_readonly;
 END IF;
END $$;
