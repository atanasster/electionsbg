-- Windowed sector peers for /procurement/sectors. sector_peers (018) ranks a
-- division's top contractors off the corpus-wide sector_contractor_stats matview
-- (no date dimension). But the sectors page's division TOTALS come from
-- procurement_sectors(from, to) — window-scoped via ?pscope — so the expanded
-- "top contractors" panel must be scoped the same way, or the two disagree.
--
-- This ranks a division's contractors live from `contracts` within the window
-- (date >= from AND date < to — same bounds as procurement_sectors, 036). The
-- corpus scope (from/to NULL) keeps using the fast matview via sector_peers; the
-- route only calls this for the windowed scopes.
--
-- contracts.cpv is otherwise unindexed (018's matview exists precisely because a
-- live division ranking is a full corpus scan). A PARTIAL COVERING index on
-- (tag, left(cpv,2), date) INCLUDE (contractor_eik, amount_eur) lets the window
-- query index-scan the division's rows directly — the worst case (a full year ×
-- the biggest division, ~26k contracts) drops from ~220ms to ~25ms.
--
-- Depends on: contracts (001), tr_companies (TR), contractor_search (006).

SET check_function_bodies = off;

CREATE INDEX IF NOT EXISTS idx_contracts_cpvdiv_date
  ON contracts (tag, (left(cpv, 2)), date)
  INCLUDE (contractor_eik, amount_eur)
  WHERE tag = 'contract' AND cpv IS NOT NULL AND cpv <> '';

DROP FUNCTION IF EXISTS sector_peers_window(text, text, text, text);
CREATE OR REPLACE FUNCTION sector_peers_window(
  p_division text, p_eik text, p_from text, p_to text
) RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH base AS (
  SELECT contractor_eik              AS eik,
         COALESCE(SUM(amount_eur), 0) AS total_eur
  FROM contracts
  WHERE tag = 'contract'
    AND cpv IS NOT NULL AND cpv <> ''
    AND contractor_eik IS NOT NULL AND contractor_eik <> ''
    AND left(cpv, 2) = p_division
    AND (p_from IS NULL OR date >= p_from)
    AND (p_to   IS NULL OR date <  p_to)
  GROUP BY contractor_eik
),
ranked AS (
  SELECT eik, total_eur,
         (RANK() OVER (ORDER BY total_eur DESC))::int AS rank_in_div,
         (COUNT(*) OVER ())::int                       AS div_contractors
  FROM base
),
topn AS (SELECT * FROM ranked ORDER BY rank_in_div LIMIT 8),
-- Top 8 + the queried company's own row if it's outside the top 8 (parity with
-- sector_peers). The state-wide page passes p_eik='' so nothing self-flags.
combined AS (
  SELECT * FROM topn
  UNION
  SELECT * FROM ranked
  WHERE p_eik <> '' AND eik = p_eik AND eik NOT IN (SELECT eik FROM topn)
),
-- Name only the ~9 selected rows. Prefer the canonical TR name; else a
-- contractor_search spelling.
named AS (
  SELECT c.eik, c.total_eur, c.rank_in_div, c.eik = p_eik AS is_self,
         COALESCE(
           tc.name,
           (SELECT MIN(name) FROM contractor_search cs WHERE cs.eik = c.eik)
         ) AS name
  FROM combined c
  LEFT JOIN tr_companies tc ON tc.uic = c.eik
)
SELECT jsonb_build_object(
  'division', p_division,
  'divContractors', (SELECT MAX(div_contractors) FROM ranked),
  'peers', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'eik', eik, 'name', name, 'totalEur', ROUND(total_eur),
      'rank', rank_in_div, 'isSelf', is_self
    ) ORDER BY rank_in_div) FROM named
  ), '[]'::jsonb)
);
$$;
