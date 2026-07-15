-- 071_magistrate_connections.sql — the "richer bridge": politicians reachable from a
-- magistrate's DECLARED companies over the TR officer graph.
--
-- A magistrate owns shares (magistrate_company) but is barred from management, so they
-- are almost never a tr_officer — which is why person_politicians (008), seeded from
-- tr_officers, never finds a magistrate a political link, and why the /company and
-- /person magistrate tiles show "Политически връзки (0)" for every magistrate company
-- (the two layers are disjoint at degree 0). This seeds the SAME hub-excluded,
-- cycle-free officer-graph BFS (see company_person_path in 008) from the magistrate's
-- declared companies instead, and stops at any company carrying a politician
-- (company_politicians). So the chain is: magistrate —declares→ company A —shared
-- officer→ … → company B ←linked— politician.
--
-- Requires 008 (company_politicians, officer_name_counts, tr_officers/tr_companies) and
-- 070 (magistrate, magistrate_company). Name-only, ownership-declared — a LEAD, not
-- proof, exactly like the rest of the connections layer. Degree defaults to 2: degree 0
-- is a shared company (none exist today), degree 1 a shared officer, degree 2 one more
-- hop; beyond that the "link" is too weak to assert about a named judge.

-- Companies by their officer count — the DUAL of officer_name_counts (008), which
-- prunes hub PEOPLE. Big state/association entities (Български пощи ~28, НСОРБ ~32,
-- ДКК, …) are conduits down which "everyone is 2 hops apart", so a magistrate who
-- merely owns public shares would appear "linked" to every politician who sits on one.
-- The bridge walk below refuses to hop THROUGH or INTO such a hub. Refreshed by the
-- magistrate loader (tr_officers is loaded before it in db:refresh).
CREATE MATERIALIZED VIEW IF NOT EXISTS company_officer_counts AS
  SELECT uic, (count(DISTINCT name_fold))::int AS officer_count
  FROM tr_officers WHERE name_fold <> '' GROUP BY uic;
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_officer_counts_uic
  ON company_officer_counts(uic);
GRANT SELECT ON company_officer_counts TO app_readonly;

DROP FUNCTION IF EXISTS magistrate_politician_links(text, int);
CREATE OR REPLACE FUNCTION magistrate_politician_links(
  p_norm text, p_max_depth int DEFAULT 2
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH RECURSIVE
seeds AS (  -- the magistrate's EIK-resolved declared companies
  SELECT DISTINCT mc.eik AS uic
  FROM magistrate m
  JOIN magistrate_company mc ON mc.magistrate_name = m.name
  WHERE m.name_norm = p_norm AND mc.eik IS NOT NULL
),
walk AS (
  SELECT s.uic, 0 AS depth, ARRAY[s.uic] AS cpath, ARRAY[]::text[] AS people
  FROM seeds s
  UNION ALL
  -- one officer-hop: a non-hub person who sits on w.uic AND on another NON-HUB
  -- company (≤ 20 officers), so the chain can't launder through a state entity.
  SELECT step.uic, w.depth + 1, w.cpath || step.uic, w.people || step.person
  FROM walk w
  CROSS JOIN LATERAL (
    SELECT ob.uic, MIN(oa.name) AS person
    FROM tr_officers oa
    JOIN officer_name_counts c
      ON c.name_fold = oa.name_fold AND c.company_count <= 12
    JOIN tr_officers ob
      ON ob.name_fold = oa.name_fold AND ob.uic <> oa.uic
    JOIN company_officer_counts cc
      ON cc.uic = ob.uic AND cc.officer_count <= 20
    WHERE oa.uic = w.uic AND ob.uic <> ALL(w.cpath)
    GROUP BY ob.uic
  ) step
  WHERE w.depth < p_max_depth
    -- stop expanding once we reach a politician company; the row is still recorded.
    AND NOT EXISTS (SELECT 1 FROM company_politicians cp WHERE cp.eik = w.uic)
),
hits AS (  -- shortest path per politician reached
  SELECT DISTINCT ON (cp.politician, cp.ref)
         cp.politician, cp.ref, cp.kind, cp.role, cp.total_eur,
         w.depth, w.cpath, w.people
  FROM walk w
  JOIN company_politicians cp ON cp.eik = w.uic
  ORDER BY cp.politician, cp.ref, w.depth
)
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'politician', h.politician, 'ref', h.ref, 'kind', h.kind, 'role', h.role,
  'totalEur', h.total_eur, 'degree', h.depth,
  'path', jsonb_build_object(
    'companies', (
      SELECT jsonb_agg(jsonb_build_object(
        'eik', e, 'name', (SELECT name FROM tr_companies WHERE uic = e)
      ) ORDER BY ord)
      FROM unnest(h.cpath) WITH ORDINALITY AS u(e, ord)),
    'people', to_jsonb(h.people)
  )
) ORDER BY h.depth, h.politician), '[]'::jsonb)
FROM hits h;
$$;
