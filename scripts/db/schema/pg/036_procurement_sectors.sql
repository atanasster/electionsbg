-- National CPV-division totals for the procurement dashboard's "what does the
-- state buy" tile. Window [from, to) or full corpus — the same scope contract
-- as procurement_overview. Divisions are the 2-digit CPV prefix (labelled
-- client-side via cpvDivisionName); contracts without a CPV code are summed
-- into the `uncoded` bucket so shares stay honest against the window total.
-- Depends on contracts (001). EXECUTE auto-granted to app_readonly.

SET check_function_bodies = off;

CREATE OR REPLACE FUNCTION procurement_sectors(
  p_from text DEFAULT NULL,
  p_to text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH c AS (
  SELECT left(cpv, 2) AS d, amount_eur
  FROM contracts
  WHERE tag = 'contract'
    AND (p_from IS NULL OR date >= p_from)
    AND (p_to   IS NULL OR date <  p_to)
),
coded AS (
  SELECT d, COALESCE(SUM(amount_eur), 0) AS eur, COUNT(*)::int AS n
  FROM c WHERE d IS NOT NULL AND d <> '' GROUP BY d
)
-- ROUND + rounded ordering: raw double sums carry per-instance summation
-- noise (Docker vs Cloud SQL) — same determinism rule as risk-indexes.
SELECT jsonb_build_object(
  'totalEur', (SELECT ROUND(COALESCE(SUM(amount_eur), 0)) FROM c),
  'uncoded', jsonb_build_object(
    'eur', (SELECT ROUND(COALESCE(SUM(amount_eur), 0)) FROM c WHERE d IS NULL OR d = ''),
    'n',   (SELECT COUNT(*)::int FROM c WHERE d IS NULL OR d = '')
  ),
  'sectors', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'division', d, 'eur', ROUND(eur), 'n', n
    ) ORDER BY ROUND(eur) DESC NULLS LAST, d), '[]'::jsonb)
    FROM coded
  )
);
$$;
