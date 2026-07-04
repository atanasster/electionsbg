-- Full procurement rankings for the standalone "see all" screens
-- (/procurement/contractors, /procurement/awarders, /procurement/mps) — the
-- big-list sibling of procurement_overview (025), which caps its lists at
-- treemap size. Same window semantics: [p_from, p_to) or NULL/NULL for the
-- full corpus. Replaces the derived/top_contractors.json + by_ns/{date}.json
-- readers.
--
-- topContractors carries the MP-tie badge (mpTied/mpIds from
-- company_politicians) and the un-converted native remainder (totalOther:
-- USD/GBP/CHF/… rows have amount_eur NULL, so they are absent from totalEur —
-- the client renders them appended, same as the offline builder).
-- Depends on contracts (001) + company_politicians (008). EXECUTE → app_readonly.

SET check_function_bodies = off;

DROP FUNCTION IF EXISTS procurement_rankings(text, text);
CREATE OR REPLACE FUNCTION procurement_rankings(
  p_from text DEFAULT NULL,
  p_to text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH base AS (
  SELECT tag, contractor_eik, contractor_name, awarder_eik, awarder_name,
         amount, currency, amount_eur
  FROM contracts
  WHERE (p_from IS NULL OR date >= p_from)
    AND (p_to   IS NULL OR date <  p_to)
    AND tag IN ('contract', 'award')
    AND contractor_eik IS NOT NULL AND contractor_eik <> ''
),
ctr AS (
  SELECT contractor_eik AS eik, MIN(contractor_name) AS name,
         COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract'), 0) AS eur,
         (COUNT(*) FILTER (WHERE tag = 'contract'))::int AS n,
         (COUNT(*) FILTER (WHERE tag = 'award'))::int    AS awards
  FROM base
  GROUP BY contractor_eik
  HAVING COUNT(*) FILTER (WHERE tag = 'contract') > 0
),
-- Native remainder per contractor: rows whose currency never got
-- EUR-converted (amount_eur NULL). A handful corpus-wide, so aggregated once
-- here and LEFT-joined — never correlated per contractor.
others AS (
  SELECT contractor_eik AS eik, jsonb_object_agg(cur, s) AS other FROM (
    SELECT contractor_eik, currency AS cur, ROUND(SUM(amount)) AS s
    FROM base
    WHERE tag = 'contract' AND amount_eur IS NULL
      AND amount IS NOT NULL AND currency IS NOT NULL
    GROUP BY contractor_eik, currency
  ) q GROUP BY contractor_eik
),
awr AS (
  SELECT awarder_eik AS eik, MIN(awarder_name) AS name,
         SUM(amount_eur) AS eur, COUNT(*)::int AS n
  FROM base
  WHERE tag = 'contract' AND awarder_eik IS NOT NULL AND awarder_eik <> ''
  GROUP BY awarder_eik
),
-- MP links per contractor (for the mpTied badge on the contractors list).
mpties AS (
  SELECT cp.eik,
         array_agg(DISTINCT NULLIF(regexp_replace(cp.ref, '^/candidate/mp-', ''), '')::int) AS mp_ids
  FROM company_politicians cp
  WHERE cp.kind = 'mp' AND cp.ref LIKE '/candidate/mp-%'
  GROUP BY cp.eik
),
pol AS (
  SELECT cp.politician, cp.ref, cp.kind, cp.role,
         ctr.eik, COALESCE(tc.name, ctr.name) AS name, ctr.eur, ctr.n
  FROM company_politicians cp
  JOIN ctr ON ctr.eik = cp.eik
  LEFT JOIN tr_companies tc ON tc.uic = ctr.eik
),
polagg AS (
  SELECT ref,
         MIN(politician) AS politician, MIN(kind) AS kind, MIN(role) AS role,
         SUM(eur) AS total_eur, SUM(n)::int AS contract_count,
         COUNT(DISTINCT eik)::int AS contractor_count,
         (array_agg(name ORDER BY eur DESC NULLS LAST))[1:3] AS top_names
  FROM pol GROUP BY ref
)
SELECT jsonb_build_object(
  'start', p_from,
  'end', p_to,
  'topContractors', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'eik', x.eik,
      'name', COALESCE((SELECT tc.name FROM tr_companies tc WHERE tc.uic = x.eik), x.name),
      'totalEur', ROUND(x.eur), 'totalOther', COALESCE(x.other, '{}'::jsonb),
      'contractCount', x.n, 'awardCount', x.awards,
      'mpTied', x.mp_ids IS NOT NULL,
      'mpIds', COALESCE(to_jsonb(x.mp_ids), '[]'::jsonb)
    ) ORDER BY x.eur DESC), '[]'::jsonb)
    FROM (
      SELECT ctr.*, others.other, mpties.mp_ids
      FROM ctr
      LEFT JOIN others ON others.eik = ctr.eik
      LEFT JOIN mpties ON mpties.eik = ctr.eik
      ORDER BY ctr.eur DESC NULLS LAST LIMIT 1000
    ) x
  ),
  'topAwarders', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'eik', eik, 'name', name, 'totalEur', ROUND(eur), 'contractCount', n
    ) ORDER BY eur DESC), '[]'::jsonb)
    FROM (SELECT * FROM awr ORDER BY eur DESC NULLS LAST LIMIT 1000) x
  ),
  'topMps', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'mpId', NULLIF(regexp_replace(ref, '^/candidate/mp-', ''), '')::int,
      'mpName', politician, 'totalEur', ROUND(total_eur),
      'contractCount', contract_count, 'contractorCount', contractor_count,
      'topContractorNames', to_jsonb(top_names)
    ) ORDER BY total_eur DESC), '[]'::jsonb)
    FROM polagg WHERE kind = 'mp'
  ),
  'topOfficials', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'slug', regexp_replace(ref, '^/officials/', ''),
      'name', politician, 'role', role, 'totalEur', ROUND(total_eur),
      'contractCount', contract_count, 'contractorCount', contractor_count,
      'topContractorNames', to_jsonb(top_names)
    ) ORDER BY total_eur DESC), '[]'::jsonb)
    FROM polagg WHERE kind = 'official'
  )
);
$$;

-- Full-corpus rankings cache (all-years scope + the AI fiscal tools). The
-- NULL/NULL aggregate is ~530ms live; served from this matview, refreshed by
-- load_pg. Windowed calls fall through to the live function.
CREATE MATERIALIZED VIEW IF NOT EXISTS procurement_rankings_cache AS
  SELECT procurement_rankings(NULL, NULL) AS r;
