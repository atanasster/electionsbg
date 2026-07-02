-- Buyer-relationship strength for the DB company page (/db/company/:eik).
-- Answers "how captured is this supplier?" two ways in ONE jsonb:
--   (a) contractor→buyer CONCENTRATION — HHI + top-1/top-3 share of the
--       contractor's own procurement revenue across the buyers it works with;
--   (b) buyer→contractor CAPTURE — this contractor's share of each BUYER's total
--       spend ("won 41% of everything this municipality awarded"), the strongest
--       single-supplier-dependence / capture signal.
--
-- All from `contracts` (001). Buyer grand-totals are precomputed into the
-- `awarder_totals` matview (refreshed after each contracts load) — a per-request
-- re-aggregation over a heavy contractor's ~700 buyers was 227ms (> the 200ms
-- precompute bar); the matview join drops it to a few ms. Returns NULL when the
-- EIK has no contractor rows. EXECUTE auto-granted to app_readonly.

SET check_function_bodies = off;

-- Buyer (awarder) grand totals across ALL contractors — reused by the capture
-- share here and available to the sector/geo features. REFRESHed in load_pg.ts.
CREATE MATERIALIZED VIEW IF NOT EXISTS awarder_totals AS
  SELECT awarder_eik,
         COALESCE(SUM(amount_eur), 0) AS buyer_eur,
         (COUNT(*))::int              AS buyer_count
  FROM contracts
  WHERE tag = 'contract' AND awarder_eik IS NOT NULL
  GROUP BY awarder_eik;
CREATE UNIQUE INDEX IF NOT EXISTS idx_awarder_totals_eik
  ON awarder_totals(awarder_eik);
GRANT SELECT ON awarder_totals TO app_readonly;

DROP FUNCTION IF EXISTS company_buyer_relationships(text);

CREATE OR REPLACE FUNCTION company_buyer_relationships(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH mine AS (
  SELECT awarder_eik,
         MIN(awarder_name)                         AS awarder_name,
         COALESCE(SUM(amount_eur), 0)              AS my_eur,
         (COUNT(*))::int                            AS my_count,
         MIN(date)                                  AS first_date,
         MAX(date)                                  AS last_date
  FROM contracts
  WHERE contractor_eik = p_eik AND tag = 'contract' AND awarder_eik IS NOT NULL
  GROUP BY awarder_eik
),
-- Each of the contractor's buyers, total spend across ALL its contractors
-- (precomputed matview join, not a per-request re-aggregation).
buyer_tot AS (
  SELECT at.awarder_eik, at.buyer_eur, at.buyer_count
  FROM awarder_totals at
  WHERE at.awarder_eik IN (SELECT awarder_eik FROM mine)
),
tot AS (
  SELECT COALESCE(SUM(my_eur), 0) AS grand, (COUNT(*))::int AS buyers FROM mine
),
rel AS (
  SELECT m.awarder_eik AS "eik",
         m.awarder_name AS "name",
         ROUND(m.my_eur)                             AS "myEur",
         m.my_count                                  AS "myCount",
         m.first_date                                AS "firstDate",
         m.last_date                                 AS "lastDate",
         ROUND(bt.buyer_eur)                         AS "buyerEur",
         bt.buyer_count                              AS "buyerCount",
         CASE WHEN bt.buyer_eur > 0
              THEN ROUND((m.my_eur / bt.buyer_eur)::numeric, 4)
              ELSE NULL END                          AS "captureShare",
         CASE WHEN (SELECT grand FROM tot) > 0
              THEN ROUND((m.my_eur / (SELECT grand FROM tot))::numeric, 4)
              ELSE NULL END                          AS "revenueShare"
  FROM mine m JOIN buyer_tot bt USING (awarder_eik)
)
SELECT CASE
  WHEN (SELECT grand FROM tot) = 0 THEN NULL
  ELSE jsonb_build_object(
    'buyerCount', (SELECT buyers FROM tot),
    'totalEur',   ROUND((SELECT grand FROM tot)),
    -- HHI over the contractor's revenue split across buyers (0..1; 1 = one buyer).
    'hhi', (
      SELECT COALESCE(ROUND(SUM(POWER(my_eur / (SELECT grand FROM tot), 2))::numeric, 4), 0)
      FROM mine
    ),
    'top1Share', (
      SELECT ROUND((MAX(my_eur) / (SELECT grand FROM tot))::numeric, 4) FROM mine
    ),
    'top3Share', (
      SELECT ROUND((SUM(s) / (SELECT grand FROM tot))::numeric, 4)
      FROM (SELECT my_eur AS s FROM mine ORDER BY my_eur DESC LIMIT 3) x
    ),
    -- Buyers this contractor is most dependent on, by revenue (top 50).
    'relationships', (
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r."myEur" DESC NULLS LAST), '[]'::jsonb)
      FROM (SELECT * FROM rel ORDER BY "myEur" DESC NULLS LAST LIMIT 50) r
    )
  )
END;
$$;
