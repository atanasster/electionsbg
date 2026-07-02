-- Company procurement rollup for the DB-backed company page (/db/company/:eik).
-- Returns, in ONE jsonb, the same shape the static contractors/<eik>.json rollup
-- carries (ProcurementContractorRollup) so the DB page reuses the existing
-- procurement tiles unchanged: headline totals, per-awarder + per-year rollups,
-- top contracts, and the raw CPV-division / procedure-method aggregation the
-- breakdown tile buckets client-side (d = left(cpv,2), b = procedureBucket()).
--
-- Aggregations mirror the offline builder exactly (contract-only rule
-- tag='contract'; db:build already proves PG reproduces that rollup 0-diff), so
-- the DB page is at parity with the JSON page for contracts/awarders/charts.
-- Returns NULL when the EIK has no procurement rows (page hides the block).
--
-- Depends on `contracts` (001). EXECUTE auto-granted to app_readonly via ALTER
-- DEFAULT PRIVILEGES (roles_readonly.sql).

SET check_function_bodies = off;
DROP FUNCTION IF EXISTS company_procurement(text);

CREATE OR REPLACE FUNCTION company_procurement(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH base AS (
  SELECT * FROM contracts WHERE contractor_eik = p_eik
),
hd AS (
  SELECT
    COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract'), 0)   AS total_eur,
    (COUNT(*) FILTER (WHERE tag = 'contract'))::int                AS contract_count,
    (COUNT(*) FILTER (WHERE tag <> 'contract'))::int               AS award_count,
    (COUNT(DISTINCT awarder_eik) FILTER (WHERE tag = 'contract'))::int AS awarder_count
  FROM base
),
other AS (
  SELECT COALESCE(jsonb_object_agg(cur, s), '{}'::jsonb) AS total_other FROM (
    SELECT currency AS cur, ROUND(SUM(amount)) AS s
    FROM base
    WHERE tag = 'contract' AND currency IS NOT NULL AND amount IS NOT NULL
    GROUP BY currency
  ) q
),
byaw AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a."totalEur" DESC NULLS LAST), '[]'::jsonb) AS arr FROM (
    SELECT awarder_eik AS eik, MIN(awarder_name) AS name,
           COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract'), 0) AS "totalEur",
           '{}'::jsonb AS "totalOther",
           (COUNT(*) FILTER (WHERE tag = 'contract'))::int AS "contractCount"
    FROM base
    GROUP BY awarder_eik
    HAVING COUNT(*) FILTER (WHERE tag = 'contract') > 0
    ORDER BY "totalEur" DESC NULLS LAST
    LIMIT 50
  ) a
),
byyr AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(y) ORDER BY y.year), '[]'::jsonb) AS arr FROM (
    SELECT left(date, 4) AS year,
           COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract'), 0) AS "totalEur",
           '{}'::jsonb AS "totalOther",
           (COUNT(*) FILTER (WHERE tag = 'contract'))::int AS "contractCount"
    FROM base
    WHERE tag = 'contract'
    GROUP BY left(date, 4)
  ) y
),
topc AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t."amountEur" DESC NULLS LAST), '[]'::jsonb) AS arr FROM (
    SELECT key, ocid, date, tag, amount, currency,
           amount_eur   AS "amountEur",
           awarder_eik  AS "partyEik",
           awarder_name AS "partyName",
           bundle_uuid  AS "bundleUuid",
           source_url   AS "sourceUrl"
    FROM base
    WHERE tag = 'contract'
    ORDER BY amount_eur DESC NULLS LAST
    LIMIT 25
  ) t
),
bd_cpv AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.eur DESC NULLS LAST), '[]'::jsonb) AS arr FROM (
    SELECT left(cpv, 2) AS d, ROUND(SUM(amount_eur)) AS eur, (COUNT(*))::int AS n
    FROM base
    WHERE tag = 'contract' AND cpv IS NOT NULL AND cpv <> ''
    GROUP BY left(cpv, 2)
  ) x
),
bd_proc AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.eur DESC NULLS LAST), '[]'::jsonb) AS arr FROM (
    SELECT procurement_method AS method, ROUND(SUM(amount_eur)) AS eur, (COUNT(*))::int AS n
    FROM base
    WHERE tag = 'contract' AND procurement_method IS NOT NULL AND procurement_method <> ''
    GROUP BY procurement_method
  ) x
),
bd AS (
  SELECT
    COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract'), 0) AS total_eur,
    COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract' AND cpv IS NOT NULL AND cpv <> ''), 0) AS cpv_known_eur,
    COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract' AND procurement_method IS NOT NULL AND procurement_method <> ''), 0) AS proc_known_eur,
    COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract' AND eu_funded = 1), 0) AS eu_eur,
    COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract' AND eu_funded IS NOT NULL), 0) AS eu_known_eur
  FROM base
)
SELECT CASE
  WHEN hd.contract_count = 0 AND hd.award_count = 0 THEN NULL
  ELSE jsonb_build_object(
    'totalEur', hd.total_eur,
    'totalOther', other.total_other,
    'contractCount', hd.contract_count,
    'awardCount', hd.award_count,
    'awarderCount', hd.awarder_count,
    'byAwarder', byaw.arr,
    'byYear', byyr.arr,
    'topContracts', topc.arr,
    'breakdown', jsonb_build_object(
      'totalEur', bd.total_eur,
      'cpvKnownEur', bd.cpv_known_eur,
      'procKnownEur', bd.proc_known_eur,
      'euEur', bd.eu_eur,
      'euKnownEur', bd.eu_known_eur,
      'cpvRaw', bd_cpv.arr,
      'procRaw', bd_proc.arr
    )
  )
END
FROM hd, other, byaw, byyr, topc, bd, bd_cpv, bd_proc;
$$;
