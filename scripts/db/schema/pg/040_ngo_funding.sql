-- External funding received by NGOs — one unified table for every "named funder
-- → NGO → amount" source: EU direct-managed funds (FTS), domestic State-Budget
-- subsidies to named ЮЛНЦ, and foreign grantmakers (America for Bulgaria, NED).
-- All funder-side sources are name-keyed (no BG EIK), so each row records how it
-- was matched (vat / name_exact / name_fuzzy / manual / unmatched). Framing:
-- ABSOLUTE € per NGO alongside domestic public money — never a "% foreign" ratio
-- (see docs/plans/ngo-final-implementation-plan.md, Phases 5a + 6).
--
-- Populated by scripts/ngo/load_ngo_funding_pg.ts. Depends on tr_companies (003)
-- for the EIK join target. EXECUTE auto-granted to app_readonly.

DROP TABLE IF EXISTS ngo_funding CASCADE;
CREATE TABLE ngo_funding (
  id           bigserial PRIMARY KEY,
  eik          text,          -- matched NGO EIK (NULL when unmatched)
  name_raw     text NOT NULL, -- beneficiary name as the source publishes it
  source       text NOT NULL, -- 'eu_fts' | 'budget_subsidy' | 'abf' | 'ned'
  funder       text,          -- 'EU (direct)' | 'МТСП' | 'America for Bulgaria Foundation' | 'NED'
  year         int,
  amount_eur   numeric,
  programme    text,
  match_method text           -- 'vat' | 'name_exact' | 'name_fuzzy' | 'manual' | 'unmatched'
);

CREATE INDEX idx_ngo_funding_eik ON ngo_funding (eik) WHERE eik IS NOT NULL;
CREATE INDEX idx_ngo_funding_source ON ngo_funding (source);

-- Per-NGO funding rollup for the company page: total + by-source + by-year + the
-- rows. Only matched rows (eik = p_eik). Returns NULL when the NGO has none.
DROP FUNCTION IF EXISTS ngo_funding_for(text);
CREATE OR REPLACE FUNCTION ngo_funding_for(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH base AS (
  SELECT * FROM ngo_funding WHERE eik = p_eik
)
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM base) THEN NULL ELSE jsonb_build_object(
  'totalEur', COALESCE((SELECT ROUND(SUM(amount_eur)) FROM base), 0),
  'bySource', (
    SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.eur DESC NULLS LAST), '[]'::jsonb)
    FROM (
      SELECT source, MIN(funder) AS funder, ROUND(SUM(amount_eur)) AS eur,
             (COUNT(*))::int AS n
      FROM base GROUP BY source
    ) x
  ),
  'rows', (
    SELECT COALESCE(jsonb_agg(to_jsonb(y) ORDER BY y.eur DESC NULLS LAST), '[]'::jsonb)
    FROM (
      SELECT source, funder, year, programme, ROUND(amount_eur) AS eur
      FROM base ORDER BY amount_eur DESC NULLS LAST LIMIT 40
    ) y
  )
) END;
$$;
