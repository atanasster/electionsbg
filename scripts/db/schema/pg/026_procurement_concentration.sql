-- Single-supplier concentration for /procurement/concentration (and the excerpt
-- on /procurement/flags). Every buyer→supplier pair where the supplier took
-- ≥30% of the buyer's spend in the window, buyer ≥ €100k. Mirrors the offline
-- concentration_full.json / by_ns/concentration/<date>.json builder. Window
-- [from, to) or full corpus (NULL/NULL). oblast comes from awarder_seats (the
-- awarder's seat oblast, Bulgarian name; null when unresolved / central body).
-- Depends on contracts (001) + awarder_seats (021) + tr_companies. Live (no
-- matview): the per-pair group-by over the corpus is ~250ms, refresh-free.

SET check_function_bodies = off;

DROP FUNCTION IF EXISTS procurement_concentration(text, text);
CREATE OR REPLACE FUNCTION procurement_concentration(
  p_from text DEFAULT NULL,
  p_to text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH c AS (
  SELECT awarder_eik, awarder_name, contractor_eik, contractor_name, amount_eur
  FROM contracts
  WHERE tag = 'contract'
    AND awarder_eik IS NOT NULL AND awarder_eik <> ''
    AND contractor_eik IS NOT NULL AND contractor_eik <> ''
    AND date >= COALESCE(p_from, '')
    AND date <  COALESCE(p_to, '9999-99-99')
),
pair AS (
  -- COLLATE "C" pins the alias choice to byte order across instances (see
  -- risk-indexes, 70f92e10a).
  SELECT awarder_eik, MIN(awarder_name COLLATE "C") AS aw_name,
         contractor_eik, MIN(contractor_name COLLATE "C") AS ct_name,
         SUM(amount_eur) AS eur, COUNT(*)::int AS n
  FROM c GROUP BY awarder_eik, contractor_eik
),
awt AS (
  SELECT awarder_eik, SUM(eur) AS tot
  FROM pair GROUP BY awarder_eik HAVING SUM(eur) >= 100000
),
flagged AS (
  SELECT p.awarder_eik, p.aw_name, p.contractor_eik, p.ct_name, p.eur, p.n,
         a.tot, p.eur / a.tot AS share
  FROM pair p JOIN awt a USING (awarder_eik)
  WHERE a.tot > 0 AND p.eur / a.tot >= 0.30
)
SELECT jsonb_build_object(
  'generatedAt', '',
  'thresholdPct', 0.3,
  'minAwarderTotalEur', 100000,
  'total', (SELECT count(*) FROM flagged),
  'rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'awarderEik', f.awarder_eik,
      'awarderName', f.aw_name,
      'contractorEik', f.contractor_eik,
      'contractorName', COALESCE(
        (SELECT tc.name FROM tr_companies tc WHERE tc.uic = f.contractor_eik),
        f.ct_name),
      'sharePct', ROUND(f.share::numeric, 4),
      'pairTotalEur', ROUND(f.eur),
      'awarderTotalEur', ROUND(f.tot),
      'contractCount', f.n,
      'oblast', (SELECT s.oblast FROM awarder_seats s WHERE s.eik = f.awarder_eik)
    -- Rounded sort keys + eik tiebreaks: raw float share/eur carry
    -- per-instance summation noise that swaps near-equal rows (same
    -- determinism rule as risk-indexes, 70f92e10a).
    ) ORDER BY ROUND(f.share::numeric, 4) DESC, ROUND(f.eur) DESC,
               f.awarder_eik, f.contractor_eik)
    FROM flagged f
  ), '[]'::jsonb)
);
$$;
