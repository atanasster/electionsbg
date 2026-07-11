-- "Public money scanner" for /procurement/people — the full ranked index of the
-- political class (MPs + non-MP officials) whose curated business ties intersect
-- with contract winners, with the public procurement reachable through those
-- companies in the window. Same connected-people aggregation the overview's
-- topMps/topOfficials use, but the WHOLE list (no top-N cap), one row per
-- politician (kind + mpId|slug + role). Mirrors person_procurement_index.json /
-- by_ns/people/<date>.json. Window [from, to) or full corpus.
-- Depends on contracts (001) + company_politicians (008).

SET check_function_bodies = off;

DROP FUNCTION IF EXISTS procurement_scanner(text, text);
CREATE OR REPLACE FUNCTION procurement_scanner(
  p_from text DEFAULT NULL,
  p_to text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH ctr AS (  -- per-contractor window spend
  SELECT contractor_eik AS eik, SUM(amount_eur) AS eur, COUNT(*)::int AS n
  FROM contracts
  WHERE tag = 'contract' AND contractor_eik IS NOT NULL AND contractor_eik <> ''
    AND date >= COALESCE(p_from, '')
    AND date <  COALESCE(p_to, '9999-99-99')
  GROUP BY contractor_eik
),
pol AS (  -- politician links intersected with the window's contractors
  SELECT cp.ref, cp.kind, cp.role, ctr.eik, ctr.eur, ctr.n
  FROM company_politicians cp JOIN ctr ON ctr.eik = cp.eik
),
polagg AS (  -- one row per politician (unique route)
  SELECT ref, MIN(kind) AS kind, MIN(role) AS role,
         SUM(eur) AS total_eur, SUM(n)::int AS contract_count,
         COUNT(DISTINCT eik)::int AS contractor_count,
         (SELECT MIN(cp.politician) FROM company_politicians cp WHERE cp.ref = p.ref) AS name
  FROM pol p GROUP BY ref
)
SELECT jsonb_build_object(
  'generatedAt', '',
  'total', (SELECT count(*) FROM polagg),
  'rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'kind', kind,
      'mpId', CASE WHEN kind = 'mp'
        THEN NULLIF(regexp_replace(ref, '^/candidate/mp-', ''), '')::int END,
      'slug', CASE WHEN kind = 'official'
        THEN regexp_replace(ref, '^/officials/', '') END,
      'name', name,
      'role', role,
      'totalEur', ROUND(total_eur),
      'contractorCount', contractor_count,
      'contractCount', contract_count
    ) ORDER BY total_eur DESC)
    FROM polagg
  ), '[]'::jsonb)
);
$$;
