-- Awarder K-Index — a Hlídač-státu-style scored risk signal: the share of an
-- awarding body's contract value that goes to suppliers linked to politics
-- (owned/managed by an MP or official, OR governed by one via an NGO board —
-- the latter is our extension, unique among CEE watchdogs). Inputs already in
-- PG: contracts (awarder→contractor→amount) + company_politicians (the
-- politician↔contractor links, incl. the ngo_board/ngo_representative relation
-- kinds from the connections rebuild). No party-donation leg yet (БУЛНАО
-- donations not ingested) — that's a future component.
--
-- Depends on contracts (001) + company_politicians (008). EXECUTE auto-granted
-- to app_readonly. See docs/plans/ngo-final-implementation-plan.md (Phase 5b).

SET check_function_bodies = off;

-- Per-awarder profile: total contract value, the slice going to politically
-- linked suppliers, the share, and the linked-supplier roster (with the
-- politician + relation kinds so the UI can say "owns" vs "on the board of").
DROP FUNCTION IF EXISTS awarder_kindex(text);
CREATE OR REPLACE FUNCTION awarder_kindex(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH base AS (
  SELECT contractor_eik, contractor_name, amount_eur
  FROM contracts
  WHERE awarder_eik = p_eik AND tag = 'contract' AND contractor_eik IS NOT NULL
),
tot AS (
  SELECT COALESCE(SUM(amount_eur), 0) AS total_eur,
         COUNT(DISTINCT contractor_eik)::int AS supplier_count
  FROM base
),
linked AS (
  SELECT b.contractor_eik AS eik,
         MIN(b.contractor_name) AS name,
         ROUND(SUM(b.amount_eur)) AS eur,
         (COUNT(*))::int AS n
  FROM base b
  WHERE EXISTS (SELECT 1 FROM company_politicians cp WHERE cp.eik = b.contractor_eik)
  GROUP BY b.contractor_eik
),
linked_rows AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.eur DESC NULLS LAST), '[]'::jsonb) AS arr
  FROM (
    SELECT l.eik, l.name, l.eur, l.n,
           (SELECT jsonb_agg(DISTINCT jsonb_build_object(
                     'politician', cp.politician, 'ref', cp.ref, 'kind', cp.kind))
              FROM company_politicians cp WHERE cp.eik = l.eik) AS politicians
    FROM linked l
    ORDER BY l.eur DESC NULLS LAST
    LIMIT 50
  ) x
)
SELECT jsonb_build_object(
  'totalEur', tot.total_eur,
  'supplierCount', tot.supplier_count,
  'linkedEur', COALESCE((SELECT SUM(eur) FROM linked), 0),
  'linkedSupplierCount', (SELECT COUNT(*)::int FROM linked),
  'sharePct', CASE WHEN tot.total_eur > 0
                THEN ROUND((COALESCE((SELECT SUM(eur) FROM linked), 0) / tot.total_eur)::numeric, 4)
                ELSE 0 END,
  'suppliers', (SELECT arr FROM linked_rows)
)
FROM tot;
$$;

-- Corpus ranking: awarders above a volume floor, ranked by linked share. The
-- floor keeps tiny buyers (whose one linked contract is 100%) out of the top.
-- Materialised (refreshed after contract + link loads) — a full scan of
-- contracts × company_politicians is too heavy for a live page.
DROP MATERIALIZED VIEW IF EXISTS awarder_kindex_ranking CASCADE;
CREATE MATERIALIZED VIEW awarder_kindex_ranking AS
WITH per_awarder AS (
  SELECT c.awarder_eik AS eik,
         MIN(c.awarder_name) AS name,
         SUM(c.amount_eur) AS total_eur,
         SUM(c.amount_eur) FILTER (
           WHERE EXISTS (SELECT 1 FROM company_politicians cp WHERE cp.eik = c.contractor_eik)
         ) AS linked_eur,
         COUNT(DISTINCT c.contractor_eik) FILTER (
           WHERE EXISTS (SELECT 1 FROM company_politicians cp WHERE cp.eik = c.contractor_eik)
         )::int AS linked_supplier_count
  FROM contracts c
  WHERE c.tag = 'contract' AND c.awarder_eik IS NOT NULL
  GROUP BY c.awarder_eik
)
SELECT eik, name,
       ROUND(total_eur) AS total_eur,
       ROUND(COALESCE(linked_eur, 0)) AS linked_eur,
       linked_supplier_count,
       ROUND((COALESCE(linked_eur, 0) / NULLIF(total_eur, 0))::numeric, 4) AS share_pct
FROM per_awarder
WHERE total_eur >= 500000            -- volume floor (≈ Hlídač eligibility)
  AND COALESCE(linked_eur, 0) > 0
ORDER BY share_pct DESC, linked_eur DESC;

CREATE INDEX IF NOT EXISTS idx_awarder_kindex_share
  ON awarder_kindex_ranking (share_pct DESC);
GRANT SELECT ON awarder_kindex_ranking TO app_readonly;

-- Top-N getter for the dashboard tile (jsonb, one round-trip).
DROP FUNCTION IF EXISTS awarder_kindex_top(int);
CREATE OR REPLACE FUNCTION awarder_kindex_top(p_limit int DEFAULT 25)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
  FROM (
    SELECT eik, name,
           total_eur      AS "totalEur",
           linked_eur     AS "linkedEur",
           linked_supplier_count AS "linkedSupplierCount",
           share_pct      AS "sharePct"
    FROM awarder_kindex_ranking
    ORDER BY share_pct DESC, linked_eur DESC
    LIMIT GREATEST(1, LEAST(p_limit, 100))
  ) x;
$$;
