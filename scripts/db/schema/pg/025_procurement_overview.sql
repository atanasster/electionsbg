-- Procurement dashboard OVERVIEW (/procurement) — the headline totals + the
-- top-contractor / top-awarder treemaps + the connected-politician lists, all
-- scoped to a date window [p_from, p_to] (the selected parliament's tenure, or
-- NULL/NULL for the full corpus). Mirrors the offline by_ns/{date}.json builder
-- so the DB page renders the same shape.
--
-- The connected-people section (mpCount / officialCount / connected totals +
-- topMps / topOfficials) is computed by intersecting company_politicians (the
-- curated MP/official ↔ contractor links) with the window's contractors and
-- summing each linked contractor's WINDOW spend. Confidence/tier badges from the
-- offline builder are derived, not stored — omitted here (numbers are faithful).
-- Depends on contracts (001) + company_politicians (008). EXECUTE → app_readonly.

SET check_function_bodies = off;

-- Drop the dependent cache matview first so the function DROP doesn't fail on the
-- dependency (re-apply path); it's recreated at the file tail. Mirrors 033.
DROP MATERIALIZED VIEW IF EXISTS procurement_overview_cache;
DROP FUNCTION IF EXISTS procurement_overview(text, text);
CREATE OR REPLACE FUNCTION procurement_overview(
  p_from text DEFAULT NULL,
  p_to text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH base AS (
  SELECT tag, contractor_eik, contractor_name, awarder_eik, awarder_name, amount_eur
  FROM contracts
  -- Half-open window [from, to): a contract on the next election day belongs to
  -- the NEXT parliament, matching the offline by_ns builder.
  WHERE (p_from IS NULL OR date >= p_from)
    AND (p_to   IS NULL OR date <  p_to)
),
c AS (
  SELECT * FROM base
  WHERE tag = 'contract' AND contractor_eik IS NOT NULL AND contractor_eik <> ''
),
-- Per-contractor and per-awarder window aggregates (reused for treemaps + the
-- connected calc, so the corpus is scanned once). COLLATE "C" pins MIN() to
-- byte order — the Docker and Cloud SQL glibc builds sort quotes/case
-- differently under en_US.utf8, so an unpinned MIN picks different name
-- aliases per instance (same rule as risk-indexes, 70f92e10a).
ctr AS (
  SELECT contractor_eik AS eik, MIN(contractor_name COLLATE "C") AS name,
         SUM(amount_eur) AS eur, COUNT(*)::int AS n
  FROM c GROUP BY contractor_eik
),
awr AS (
  SELECT awarder_eik AS eik, MIN(awarder_name COLLATE "C") AS name,
         SUM(amount_eur) AS eur, COUNT(*)::int AS n
  FROM c
  WHERE awarder_eik IS NOT NULL AND awarder_eik <> ''
  GROUP BY awarder_eik
),
-- Curated politician links intersected with the window's contractors. Prefer
-- the canonical TR name (contract rows carry several aliases per eik).
pol AS (
  SELECT cp.politician, cp.ref, cp.kind, cp.role,
         ctr.eik, COALESCE(tc.name, ctr.name) AS name, ctr.eur, ctr.n
  FROM company_politicians cp
  JOIN ctr ON ctr.eik = cp.eik
  LEFT JOIN tr_companies tc ON tc.uic = ctr.eik
),
-- Group by ref (the unique /candidate/mp-<id> | /officials/<slug> route), not
-- the display name — two distinct officials can share a name.
polagg AS (
  SELECT ref,
         MIN(politician) AS politician, MIN(kind) AS kind, MIN(role) AS role,
         SUM(eur) AS total_eur, SUM(n)::int AS contract_count,
         COUNT(DISTINCT eik)::int AS contractor_count,
         (array_agg(name ORDER BY ROUND(eur) DESC NULLS LAST, name))[1:3] AS top_names
  FROM pol GROUP BY ref
),
hd AS (
  SELECT
    (SELECT count(*) FROM base WHERE tag = 'contract')::int          AS contracts,
    (SELECT count(*) FROM base WHERE tag = 'contractAmendment')::int AS amendments,
    (SELECT count(*) FROM base WHERE tag = 'award')::int             AS awards,
    (SELECT count(*) FROM ctr)::int                                  AS contractor_count,
    (SELECT count(*) FROM awr)::int                                  AS awarder_count,
    (SELECT COALESCE(sum(eur), 0) FROM ctr)                          AS total_eur,
    (SELECT count(*) FROM polagg WHERE kind = 'mp')::int             AS mp_count,
    (SELECT count(*) FROM polagg WHERE kind = 'official')::int       AS official_count,
    (SELECT count(DISTINCT eik) FROM pol)::int                       AS connected_contractor_count,
    (SELECT COALESCE(sum(eur), 0) FROM (SELECT DISTINCT eik, eur FROM pol) u)                         AS connected_total_eur,
    (SELECT count(DISTINCT eik) FROM pol WHERE kind = 'mp')::int     AS mp_connected_contractor_count,
    (SELECT COALESCE(sum(eur), 0) FROM (SELECT DISTINCT eik, eur FROM pol WHERE kind = 'mp') u)       AS mp_connected_total_eur,
    (SELECT count(DISTINCT eik) FROM pol WHERE kind = 'official')::int AS official_connected_contractor_count,
    (SELECT COALESCE(sum(eur), 0) FROM (SELECT DISTINCT eik, eur FROM pol WHERE kind = 'official') u) AS official_connected_total_eur
)
SELECT jsonb_build_object(
  'totals', jsonb_build_object(
    'contracts', hd.contracts,
    'amendments', hd.amendments,
    'awards', hd.awards,
    'contractorCount', hd.contractor_count,
    'awarderCount', hd.awarder_count,
    -- ROUND: raw double sums carry per-instance summation-order noise (Docker
    -- vs Cloud SQL glibc/plan differences) — same determinism rule as the
    -- risk-indexes payload (70f92e10a).
    'totalEur', ROUND(hd.total_eur),
    'mpCount', hd.mp_count,
    'officialCount', hd.official_count,
    'connectedContractorCount', hd.connected_contractor_count,
    'connectedTotalEur', ROUND(hd.connected_total_eur),
    'mpConnectedContractorCount', hd.mp_connected_contractor_count,
    'mpConnectedTotalEur', ROUND(hd.mp_connected_total_eur),
    'officialConnectedContractorCount', hd.official_connected_contractor_count,
    'officialConnectedTotalEur', ROUND(hd.official_connected_total_eur)
  ),
  'topContractors', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'eik', x.eik,
      'name', COALESCE((SELECT tc.name FROM tr_companies tc WHERE tc.uic = x.eik), x.name),
      'totalEur', ROUND(x.eur), 'contractCount', x.n
    ) ORDER BY ROUND(x.eur) DESC, x.eik), '[]'::jsonb)
    FROM (SELECT * FROM ctr ORDER BY ROUND(eur) DESC NULLS LAST, eik LIMIT 50) x
  ),
  'topAwarders', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'eik', eik, 'name', name, 'totalEur', ROUND(eur), 'contractCount', n
    ) ORDER BY ROUND(eur) DESC, eik), '[]'::jsonb)
    FROM (SELECT * FROM awr ORDER BY ROUND(eur) DESC NULLS LAST, eik LIMIT 50) x
  ),
  'topMps', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'mpId', NULLIF(regexp_replace(ref, '^/candidate/mp-', ''), '')::int,
      'mpName', politician, 'totalEur', ROUND(total_eur),
      'contractCount', contract_count, 'contractorCount', contractor_count,
      'topContractorNames', to_jsonb(top_names)
    ) ORDER BY ROUND(total_eur) DESC, ref), '[]'::jsonb)
    FROM (SELECT * FROM polagg WHERE kind = 'mp' ORDER BY ROUND(total_eur) DESC, ref LIMIT 15) x
  ),
  'topOfficials', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'slug', regexp_replace(ref, '^/officials/', ''),
      'name', politician, 'role', role, 'totalEur', ROUND(total_eur),
      'contractCount', contract_count, 'contractorCount', contractor_count,
      'topContractorNames', to_jsonb(top_names)
    ) ORDER BY ROUND(total_eur) DESC, ref), '[]'::jsonb)
    FROM (SELECT * FROM polagg WHERE kind = 'official' ORDER BY ROUND(total_eur) DESC, ref LIMIT 30) x
  )
) FROM hd;
$$;

-- Full-corpus (all-years) overview cache. The windowed call is fast (small
-- slice), but the NULL/NULL full-corpus aggregate is ~334ms — too slow per
-- request on Cloud SQL. The route serves this matview when from/to are both
-- absent; load_pg refreshes it after each load. Same pattern as
-- procurement_risk_indexes_cache (033).
CREATE MATERIALIZED VIEW IF NOT EXISTS procurement_overview_cache AS
  SELECT procurement_overview(NULL, NULL) AS r;
