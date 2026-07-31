-- Money-flow Sankey for /procurement/flows (+ the preview tile on the overview):
-- public money → politician-connected contractors → the MPs/officials tied to
-- them. A 3-column graph: awarder → contractor → mp|official. Only contractors
-- that appear in company_politicians (the curated MP/official links) anchor the
-- graph. Link value: awarder→contractor = that buyer's payments to the
-- contractor; contractor→politician = the contractor's total window spend (all
-- of it reaches the connected person). Window [from, to) or full corpus.
-- Mirrors the offline flow.json / by_ns/flow builder. Node ids match the JSON:
-- awarder:<eik> | contractor:<eik> | mp:<id> | official:<slug>.
-- Depends on contracts (001) + company_politicians (008) + tr_companies.

SET check_function_bodies = off;

-- NOT dropped before the CREATE — same rule as 030 and 025. procurement_payloads (124) is a
-- matview OVER this function, so DROP FUNCTION fails outright and aborts the transaction on
-- every db:load:pg run; and this file must not drop 124 instead, because load_pg applies THIS
-- file but not 124. See 026's note for the full reasoning.
CREATE OR REPLACE FUNCTION procurement_flow(
  p_from text DEFAULT NULL,
  p_to text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH c AS (
  SELECT awarder_eik, awarder_name, contractor_eik, amount_eur
  FROM contracts
  WHERE tag = 'contract'
    AND awarder_eik IS NOT NULL AND awarder_eik <> ''
    AND contractor_eik IS NOT NULL AND contractor_eik <> ''
    AND date >= COALESCE(p_from, '')
    AND date <  COALESCE(p_to, '9999-99-99')
),
tied AS (  -- politician-linked contractors that have contracts in the window
  SELECT DISTINCT cp.eik AS contractor_eik
  FROM company_politicians cp
  WHERE EXISTS (SELECT 1 FROM c WHERE c.contractor_eik = cp.eik)
),
ac AS (  -- awarder → contractor edges (money the buyer paid the tied contractor)
  SELECT c.awarder_eik, MIN(c.awarder_name) AS aw_name,
         c.contractor_eik, SUM(c.amount_eur) AS eur
  FROM c JOIN tied t USING (contractor_eik)
  GROUP BY c.awarder_eik, c.contractor_eik
),
ctot AS (  -- per tied contractor: total window spend (= contractor→politician value)
  SELECT contractor_eik, SUM(eur) AS eur FROM ac GROUP BY contractor_eik
),
cp AS (  -- contractor → politician edges
  SELECT p.eik AS contractor_eik,
         CASE WHEN p.kind = 'mp'
              THEN 'mp:' || regexp_replace(p.ref, '^/candidate/mp-', '')
              ELSE 'official:' || regexp_replace(p.ref, '^/officials/', '') END AS pid,
         p.politician, ct.eur
  FROM company_politicians p JOIN ctot ct ON ct.contractor_eik = p.eik
),
-- Nodes: distinct awarders, contractors, politicians (with labels).
n_aw AS (
  SELECT DISTINCT 'awarder:' || awarder_eik AS id, 'awarder' AS type,
         MIN(aw_name) AS label
  FROM ac GROUP BY awarder_eik
),
n_ct AS (
  SELECT 'contractor:' || ct.contractor_eik AS id, 'contractor' AS type,
         COALESCE(tc.name,
           (SELECT MIN(cc.contractor_name) FROM contracts cc
            WHERE cc.contractor_eik = ct.contractor_eik AND cc.tag = 'contract'))
         AS label
  FROM ctot ct LEFT JOIN tr_companies tc ON tc.uic = ct.contractor_eik
),
n_pol AS (
  SELECT DISTINCT pid AS id,
         CASE WHEN pid LIKE 'mp:%' THEN 'mp' ELSE 'official' END AS type,
         MIN(politician) AS label
  FROM cp GROUP BY pid
)
SELECT jsonb_build_object(
  'generatedAt', '',
  -- ORDER BY on both aggregates: without it the graph's shape is whatever order the plan
  -- happened to emit, so the SAME data serialises differently under a parallel or
  -- non-hashagg plan. That was tolerable while this ran live per request; it is not now that
  -- 124 STORES the result, because a stored payload that cannot be compared to a freshly
  -- computed one gives its data gate nothing to assert. The keys chosen are unique, so the
  -- order is total: `id` is DISTINCT/GROUP BY'd in all three node CTEs, and (source, target)
  -- is unique per link — the two branches cannot collide, their sources carry different
  -- prefixes. Same determinism convention as 119/122/123: a rounded sort key with a
  -- tiebreak that cannot tie.
  'nodes', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'type', type, 'label', label) ORDER BY type, id), '[]'::jsonb)
    FROM (
      SELECT id, type, label FROM n_aw
      UNION ALL SELECT id, type, label FROM n_ct
      UNION ALL SELECT id, type, label FROM n_pol
    ) nodes
  ),
  'links', (
    SELECT COALESCE(jsonb_agg(l ORDER BY v DESC, src, tgt), '[]'::jsonb) FROM (
      SELECT jsonb_build_object(
        'source', 'awarder:' || awarder_eik,
        'target', 'contractor:' || contractor_eik,
        'valueEur', ROUND(eur)) AS l,
        ROUND(eur) AS v, 'awarder:' || awarder_eik AS src,
        'contractor:' || contractor_eik AS tgt
      FROM ac
      UNION ALL
      SELECT jsonb_build_object(
        'source', 'contractor:' || contractor_eik,
        'target', pid,
        'valueEur', ROUND(eur)) AS l,
        ROUND(eur) AS v, 'contractor:' || contractor_eik AS src, pid AS tgt
      FROM cp
    ) links
  )
);
$$;
