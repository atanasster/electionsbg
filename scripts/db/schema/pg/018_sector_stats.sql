-- Sector benchmarking for the DB company page (/db/company/:eik). Answers "is
-- this contractor big or small in its market?" by ranking it within its CPV
-- DIVISION (2-digit prefix) against every other contractor in that division:
-- rank, percentile, the division's total spend, contractor count and median
-- contractor size. The disproportionate/captured-supplier headline.
--
-- Ranking a contractor across the thousands in a division is a window over the
-- whole corpus (contracts.cpv is unindexed) — so it's PRECOMPUTED into a matview
-- at load (REFRESHed in load_pg.ts), read back by contractor_eik (indexed).
-- Depends on `contracts` (001). EXECUTE/SELECT auto-granted to app_readonly.

SET check_function_bodies = off;

CREATE MATERIALIZED VIEW IF NOT EXISTS sector_contractor_stats AS
WITH base AS (
  SELECT left(cpv, 2)                 AS division,
         contractor_eik              AS eik,
         COALESCE(SUM(amount_eur), 0) AS total_eur,
         (COUNT(*))::int             AS contract_count
  FROM contracts
  WHERE tag = 'contract'
    AND cpv IS NOT NULL AND cpv <> ''
    AND contractor_eik IS NOT NULL AND contractor_eik <> ''
    -- Exclude €0 consortium member rows (migration 087): they'd inflate the
    -- per-division supplier count and drag the median down. The carrier holds value.
    AND consortium_role IS DISTINCT FROM 'member'
  GROUP BY left(cpv, 2), contractor_eik
),
div_stats AS (
  SELECT division,
         SUM(total_eur)                                          AS div_total,
         (COUNT(*))::int                                         AS div_contractors,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY total_eur)  AS div_median
  FROM base
  GROUP BY division
)
SELECT b.division,
       b.eik,
       b.total_eur,
       b.contract_count,
       (RANK() OVER (PARTITION BY b.division ORDER BY b.total_eur DESC))::int AS rank_in_div,
       d.div_contractors,
       d.div_total,
       d.div_median
FROM base b JOIN div_stats d USING (division);

CREATE INDEX IF NOT EXISTS idx_sector_stats_eik
  ON sector_contractor_stats(eik);
GRANT SELECT ON sector_contractor_stats TO app_readonly;

-- The company's divisions, biggest first (jsonb; camelCased for the client).
DROP FUNCTION IF EXISTS company_sectors(text);
CREATE OR REPLACE FUNCTION company_sectors(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s."totalEur" DESC NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT division                    AS "division",
           ROUND(total_eur)            AS "totalEur",
           contract_count              AS "contractCount",
           rank_in_div                 AS "rank",
           div_contractors             AS "divContractors",
           ROUND(div_total)            AS "divTotalEur",
           ROUND(div_median)           AS "divMedianEur"
    FROM sector_contractor_stats
    WHERE eik = p_eik
    ORDER BY total_eur DESC NULLS LAST
    LIMIT 6
  ) s;
$$;

-- Sector competitors for the company-page merged sectors tile (lazy, on expand).
-- Top-8 contractors in a CPV division + the queried company's own row (if it's
-- outside the top 8), with names from contractor_search. Used to show "who else
-- is big in this sector" with the current company highlighted.
CREATE INDEX IF NOT EXISTS idx_sector_stats_division
  ON sector_contractor_stats(division, rank_in_div);

DROP FUNCTION IF EXISTS sector_peers(text, text);
CREATE OR REPLACE FUNCTION sector_peers(p_division text, p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH ranked AS (
  SELECT s.eik, s.total_eur, s.rank_in_div, s.div_contractors
  FROM sector_contractor_stats s
  WHERE s.division = p_division
),
topn AS (SELECT * FROM ranked ORDER BY rank_in_div LIMIT 8),
combined AS (
  SELECT * FROM topn
  UNION
  SELECT * FROM ranked WHERE eik = p_eik AND eik NOT IN (SELECT eik FROM topn)
),
-- Name only the ~9 selected rows (not all 34k). Prefer the canonical TR name;
-- else a contractor_search spelling (that table has several per eik).
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
