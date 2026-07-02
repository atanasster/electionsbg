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
