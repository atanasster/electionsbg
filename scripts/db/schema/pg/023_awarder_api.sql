-- Awarder (buy-side) procurement rollup for the DB company page when the EIK is
-- an awarding body (/db/company/:eik, institution view). The mirror of
-- company_procurement (011) but from the BUYER's side: filters awarder_eik and
-- groups by CONTRACTOR (who the institution paid). Returns the same jsonb shape
-- so the page reuses the contract/party/by-year tiles — with byContractor in
-- place of byAwarder and contractorCount in place of awarderCount.
--
-- Depends on contracts (001). awarder_eik is indexed. Returns NULL when the EIK
-- awarded nothing. EXECUTE auto-granted to app_readonly.

SET check_function_bodies = off;
DROP FUNCTION IF EXISTS awarder_procurement(text);
DROP FUNCTION IF EXISTS awarder_procurement(text, text, text);

CREATE OR REPLACE FUNCTION awarder_procurement(
  p_eik text,
  p_from text DEFAULT NULL,
  p_to text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH base AS (
  SELECT * FROM contracts
  WHERE awarder_eik = p_eik
    AND (p_from IS NULL OR date >= p_from)
    AND (p_to IS NULL OR date <= p_to)
),
hd AS (
  SELECT
    COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract'), 0)        AS total_eur,
    (COUNT(*) FILTER (WHERE tag = 'contract'))::int                     AS contract_count,
    (COUNT(*) FILTER (WHERE tag = 'award'))::int                        AS award_count,
    (COUNT(*) FILTER (WHERE tag = 'contractAmendment'))::int            AS amendment_count,
    (COUNT(DISTINCT contractor_eik) FILTER (WHERE tag = 'contract'))::int AS contractor_count
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
byc AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a."totalEur" DESC NULLS LAST), '[]'::jsonb) AS arr FROM (
    SELECT contractor_eik AS eik, MIN(contractor_name) AS name,
           COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract'), 0) AS "totalEur",
           '{}'::jsonb AS "totalOther",
           (COUNT(*) FILTER (WHERE tag = 'contract'))::int AS "contractCount"
    FROM base
    GROUP BY contractor_eik
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
           amount_eur     AS "amountEur",
           contractor_eik AS "partyEik",
           contractor_name AS "partyName",
           title,
           bundle_uuid    AS "bundleUuid",
           source_url     AS "sourceUrl"
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
  WHEN hd.contract_count = 0 AND hd.award_count = 0 AND hd.amendment_count = 0 THEN NULL
  ELSE jsonb_build_object(
    'totalEur', hd.total_eur,
    'totalOther', other.total_other,
    'contractCount', hd.contract_count,
    'awardCount', hd.award_count,
    'amendmentCount', hd.amendment_count,
    'contractorCount', hd.contractor_count,
    'byContractor', byc.arr,
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
FROM hd, other, byc, byyr, topc, bd, bd_cpv, bd_proc;
$$;
