-- Per-politician procurement detail (/candidate/:id/procurement and the
-- officials profile procurement section) — every contractor linked to one
-- politician ref ('/candidate/mp-<id>' | '/officials/<slug>') with live
-- totals, per-year breakdown and top awarders per company. Replaces the
-- derived/per-mp/ and derived/pep-by-slug/ JSON shard readers.
--
-- Linkage set = company_politicians (curated high-confidence links, with the
-- full relations jsonb straight from the connections pipeline). A ref has a
-- handful of companies, each aggregated via the contractor_eik index.
-- Depends on contracts (001) + company_politicians (008). EXECUTE → app_readonly.

SET check_function_bodies = off;

DROP FUNCTION IF EXISTS ref_procurement(text);
CREATE OR REPLACE FUNCTION ref_procurement(p_ref text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH links AS (
  SELECT DISTINCT ON (eik) eik, politician, kind, role, relations
  FROM company_politicians
  WHERE ref = p_ref
  ORDER BY eik
),
per AS (
  SELECT
    l.eik, l.politician, l.kind, l.role, l.relations,
    COALESCE((SELECT tc.name FROM tr_companies tc WHERE tc.uic = l.eik),
             (SELECT MIN(c.contractor_name) FROM contracts c WHERE c.contractor_eik = l.eik AND c.consortium_role IS DISTINCT FROM 'member')) AS name,
    (SELECT COALESCE(SUM(c.amount_eur) FILTER (WHERE c.tag = 'contract'), 0)
     FROM contracts c WHERE c.contractor_eik = l.eik AND c.consortium_role IS DISTINCT FROM 'member') AS total_eur,
    (SELECT COALESCE(jsonb_object_agg(cur, s), '{}'::jsonb) FROM (
       SELECT c.currency AS cur, ROUND(SUM(c.amount)) AS s
       FROM contracts c
       WHERE c.contractor_eik = l.eik AND c.consortium_role IS DISTINCT FROM 'member' AND c.tag = 'contract'
         AND c.amount_eur IS NULL AND c.amount IS NOT NULL AND c.currency IS NOT NULL
       GROUP BY c.currency
    ) q) AS total_other,
    (SELECT (COUNT(*) FILTER (WHERE c.tag = 'contract'))::int
     FROM contracts c WHERE c.contractor_eik = l.eik AND c.consortium_role IS DISTINCT FROM 'member') AS contract_count,
    (SELECT (COUNT(*) FILTER (WHERE c.tag = 'award'))::int
     FROM contracts c WHERE c.contractor_eik = l.eik AND c.consortium_role IS DISTINCT FROM 'member') AS award_count,
    (SELECT COALESCE(jsonb_agg(to_jsonb(y) ORDER BY y.year), '[]'::jsonb) FROM (
       SELECT left(c.date, 4) AS year,
              ROUND(COALESCE(SUM(c.amount_eur) FILTER (WHERE c.tag = 'contract'), 0)) AS "totalEur",
              '{}'::jsonb AS "totalOther",
              (COUNT(*) FILTER (WHERE c.tag = 'contract'))::int AS "contractCount"
       FROM contracts c WHERE c.contractor_eik = l.eik AND c.consortium_role IS DISTINCT FROM 'member'
       GROUP BY left(c.date, 4)
       HAVING COUNT(*) FILTER (WHERE c.tag = 'contract') > 0
    ) y) AS by_year,
    (SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a."totalEur" DESC), '[]'::jsonb) FROM (
       SELECT c.awarder_eik AS eik, MIN(c.awarder_name) AS name,
              ROUND(COALESCE(SUM(c.amount_eur) FILTER (WHERE c.tag = 'contract'), 0)) AS "totalEur",
              '{}'::jsonb AS "totalOther",
              (COUNT(*) FILTER (WHERE c.tag = 'contract'))::int AS "contractCount"
       FROM contracts c WHERE c.contractor_eik = l.eik AND c.consortium_role IS DISTINCT FROM 'member'
       GROUP BY c.awarder_eik
       HAVING COUNT(*) FILTER (WHERE c.tag = 'contract') > 0
       ORDER BY "totalEur" DESC
       LIMIT 5
    ) a) AS top_awarders
  FROM links l
)
SELECT jsonb_build_object(
  'ref', p_ref,
  'summary', (
    SELECT jsonb_build_object(
      'totalEur', ROUND(COALESCE(SUM(total_eur), 0)),
      'totalOther', '{}'::jsonb,
      'contractCount', COALESCE(SUM(contract_count), 0)::int,
      'awardCount', COALESCE(SUM(award_count), 0)::int
    ) FROM per
  ),
  'entries', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'mpId', CASE WHEN p_ref LIKE '/candidate/mp-%'
                   THEN NULLIF(regexp_replace(p_ref, '^/candidate/mp-', ''), '')::int END,
      'mpName', politician,
      'slug', CASE WHEN p_ref LIKE '/officials/%'
                   THEN regexp_replace(p_ref, '^/officials/', '') END,
      'name', politician,
      'role', role,
      'contractorEik', eik,
      'contractorName', name,
      'relations', relations,
      'totalEur', ROUND(total_eur),
      'totalOther', total_other,
      'contractCount', contract_count,
      'awardCount', award_count,
      'byYear', by_year,
      'topAwarders', top_awarders
    ) ORDER BY total_eur DESC), '[]'::jsonb)
    FROM per
  )
);
$$;

-- Per-MP procurement scorecard metric for the candidate-page scorecard tile
-- (useMpScorecard): one MP's connected-contract total + its rank / cohort size /
-- cohort median among all connected MPs. Replaces the derived/per-mp/ shard +
-- the chamber-wide mp_connected.json fallback the tile used to fetch. Value =
-- Σ over the MP's DISTINCT connected contractors (matches the shard semantics,
-- deduping multi-role links). Full corpus (connections aren't NS-scoped).
-- Depends on contracts (001) + company_politicians (008). EXECUTE → app_readonly.
DROP FUNCTION IF EXISTS mp_scorecard(int);
CREATE OR REPLACE FUNCTION mp_scorecard(p_mp_id int)
RETURNS jsonb LANGUAGE sql STABLE AS $$
-- Aggregate ONLY the connected contractors' contracts (via the contractor_eik
-- index), not the whole 300k corpus — the cohort is just the ~120 firms MPs are
-- linked to. ~10× faster than a full GROUP BY contractor_eik (≈50ms → ≈5ms).
WITH links AS (SELECT DISTINCT eik FROM company_politicians WHERE kind = 'mp'),
ctr AS (
  SELECT c.contractor_eik AS eik, SUM(c.amount_eur) AS eur
  FROM contracts c
  WHERE c.tag = 'contract' AND c.contractor_eik IN (SELECT eik FROM links)
  GROUP BY c.contractor_eik
),
pol AS (
  SELECT DISTINCT cp.ref, ctr.eik, ctr.eur
  FROM company_politicians cp
  JOIN ctr ON ctr.eik = cp.eik
  WHERE cp.kind = 'mp'
),
polagg AS (SELECT ref, SUM(eur) AS total_eur FROM pol GROUP BY ref),
ranked AS (
  SELECT ref, total_eur,
         RANK() OVER (ORDER BY total_eur DESC NULLS LAST) AS rnk
  FROM polagg
),
stats AS (
  SELECT COUNT(*)::int AS cohort_size,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY total_eur) AS median
  FROM polagg
),
me AS (SELECT total_eur, rnk FROM ranked WHERE ref = '/candidate/mp-' || p_mp_id)
SELECT jsonb_build_object(
  'value', (SELECT ROUND(total_eur::numeric, 2) FROM me),
  'rank', (SELECT rnk FROM me),
  'cohortSize', (SELECT cohort_size FROM stats),
  'cohortMedian', (SELECT ROUND(median::numeric, 2) FROM stats)
);
$$;
