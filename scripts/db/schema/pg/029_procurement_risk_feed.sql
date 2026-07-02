-- Risk-signals feed for /procurement/flags: the top single-supplier
-- concentration pairs + the top MP-tied contractor relationships + headline
-- counts + a per-oblast concentration tally. Mirrors risk_feed.json /
-- by_ns/risk_feed/<date>.json. Window [from, to) or full corpus. oblast is the
-- awarder's seat oblast name (from awarder_seats), consistent with the
-- concentration page (decoupled from the NUTS scheme). The per-contract risk
-- score stays client-side JS — this is the aggregate excerpt feed only.
-- Depends on contracts (001) + company_politicians (008) + awarder_seats (021).

SET check_function_bodies = off;

DROP FUNCTION IF EXISTS procurement_risk_feed(text, text);
CREATE OR REPLACE FUNCTION procurement_risk_feed(
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
    AND (p_from IS NULL OR date >= p_from)
    AND (p_to   IS NULL OR date <  p_to)
),
ctr AS (  -- per-contractor window spend (for MP-tied edges)
  SELECT contractor_eik AS eik, SUM(amount_eur) AS eur FROM c GROUP BY contractor_eik
),
pair AS (
  SELECT awarder_eik, MIN(awarder_name) AS aw_name,
         contractor_eik, MIN(contractor_name) AS ct_name,
         SUM(amount_eur) AS eur, COUNT(*)::int AS n
  FROM c GROUP BY awarder_eik, contractor_eik
),
awt AS (
  SELECT awarder_eik, SUM(eur) AS tot FROM pair GROUP BY awarder_eik HAVING SUM(eur) >= 100000
),
flagged AS (
  SELECT p.awarder_eik, p.aw_name, p.contractor_eik, p.ct_name, p.eur, a.tot,
         p.eur / a.tot AS share,
         (SELECT s.oblast FROM awarder_seats s WHERE s.eik = p.awarder_eik) AS oblast
  FROM pair p JOIN awt a USING (awarder_eik)
  WHERE a.tot > 0 AND p.eur / a.tot >= 0.30
),
mptied AS (  -- MP ↔ contractor relationships (contractor's window total)
  SELECT cp.ref, ctr.eik AS contractor_eik, ctr.eur,
         (SELECT MIN(politician) FROM company_politicians x WHERE x.ref = cp.ref) AS mp_name
  FROM company_politicians cp JOIN ctr ON ctr.eik = cp.eik
  WHERE cp.kind = 'mp'
),
conn AS (  -- distinct politicians (mp+official) reachable = connectedPeopleTotal
  SELECT DISTINCT cp.ref FROM company_politicians cp JOIN ctr ON ctr.eik = cp.eik
)
SELECT jsonb_build_object(
  'generatedAt', '',
  'concentrationTotal', (SELECT count(*) FROM flagged),
  'concentration100Total', (SELECT count(*) FROM flagged WHERE share >= 0.9999),
  'mpTiedTotal', (SELECT count(*) FROM mptied),
  'connectedPeopleTotal', (SELECT count(*) FROM conn),
  'concentrationNationalCount', (SELECT count(*) FROM flagged WHERE oblast IS NULL),
  'topConcentration', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'awarderEik', awarder_eik, 'awarderName', aw_name,
      'contractorEik', contractor_eik,
      'contractorName', COALESCE(
        (SELECT tc.name FROM tr_companies tc WHERE tc.uic = contractor_eik), ct_name),
      'sharePct', ROUND(share::numeric, 4), 'pairTotalEur', ROUND(eur))
      ORDER BY share DESC, eur DESC)
    FROM (SELECT * FROM flagged ORDER BY share DESC, eur DESC LIMIT 50) x
  ), '[]'::jsonb),
  'topMpTied', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'mpId', NULLIF(regexp_replace(ref, '^/candidate/mp-', ''), '')::int,
      'mpName', mp_name, 'contractorEik', contractor_eik,
      'contractorName', COALESCE(
        (SELECT tc.name FROM tr_companies tc WHERE tc.uic = contractor_eik),
        (SELECT MIN(cc.contractor_name) FROM contracts cc
         WHERE cc.contractor_eik = mptied.contractor_eik AND cc.tag = 'contract')),
      'totalEur', ROUND(eur))
      ORDER BY eur DESC)
    FROM (SELECT * FROM mptied ORDER BY eur DESC LIMIT 35) mptied
  ), '[]'::jsonb),
  'concentrationByOblast', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('oblast', oblast, 'count', cnt) ORDER BY cnt DESC)
    FROM (SELECT oblast, count(*)::int AS cnt FROM flagged WHERE oblast IS NOT NULL
          GROUP BY oblast) o
  ), '[]'::jsonb)
);
$$;
