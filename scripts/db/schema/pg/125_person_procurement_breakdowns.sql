-- Person procurement BREAKDOWNS — the "by company" and "by settlement" tiles on the person
-- page (docs/plans/person-procurement-browser-v1.md, Tier 1).
--
-- person_procurement (024) already returns the headline rollup (top awarders / top contracts /
-- by-year / CPV+method breakdown). These four functions add the two missing cuts:
--   • by_company   — the person's OWN firms, ranked by procurement € (the portfolio spread);
--   • by_settlement — the AWARDER settlements paying the person's firms (awarder_seats.ekatte).
--
-- RECONCILIATION is the whole point (same discipline as ProcurementSettlementContractsSection):
-- every function aggregates over the SAME contract set as person_procurement — same EIK set,
-- same `tag='contract'` basis, same date window, same €0-consortium-member exclusion in the
-- COUNT (024:47-48) — so `Σ byCompany.totalEur == Σ bySettlement.totalEur == portfolio total`
-- and each `contractCount` reconciles with the headline. totalEur is the RAW sum (no ROUND),
-- exactly like person_procurement, so the reconciliation is exact to the cent.
--
-- Two keying paths, mirroring the two person screens (§1 of the plan):
--   • by NAME (…_by_company / …_by_settlement) → tr_officers.name_fold, matches person_procurement
--     (024). Excludes the TR redaction sentinel 'заличено обстоятелство' so a placeholder never
--     resolves to a 777-firm "portfolio" (a no-op for any real person).
--   • by SLUG (…_slug)                          → person_role.ref (source='tr', high-confidence),
--     matches person_by_slug / person_money (082). Identity-resolved, so no sentinel guard needed.
--
-- Both paths funnel into ONE core per cut (…_core, EIK-array in), so the aggregation lives in a
-- single place. Depends on: contracts (001), tr_officers (003), tr_companies (003),
-- awarder_seats (021), person / person_role (081). EXECUTE granted to app_readonly.

SET check_function_bodies = off;

-- ── Cores: aggregate a given EIK set ─────────────────────────────────────────────────────────

-- By the person's OWN firms. `name` is the registry-canonical name (tr_companies), falling back
-- to the contract's contractor_name. Groups that are ONLY €0 consortium-member rows are dropped
-- by the HAVING (they carry no own contract), matching the headline count basis.
DROP FUNCTION IF EXISTS person_by_company_core(text[], text, text);
CREATE OR REPLACE FUNCTION person_by_company_core(
  p_eiks text[], p_from text, p_to text
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH base AS MATERIALIZED (
    SELECT ct.contractor_eik, ct.contractor_name, ct.awarder_eik,
           ct.amount_eur, ct.consortium_role
    FROM contracts ct
    WHERE ct.contractor_eik = ANY(p_eiks)
      AND ct.tag = 'contract'
      AND (p_from IS NULL OR ct.date >= p_from)
      AND (p_to   IS NULL OR ct.date <= p_to)
  )
  SELECT COALESCE(
    jsonb_agg(to_jsonb(t) ORDER BY t."totalEur" DESC NULLS LAST, t.eik), '[]'::jsonb)
  FROM (
    SELECT b.contractor_eik AS eik,
           COALESCE(
             (SELECT tc.name FROM tr_companies tc WHERE tc.uic = b.contractor_eik),
             MIN(b.contractor_name)) AS name,
           COALESCE(SUM(b.amount_eur), 0)::float8 AS "totalEur",
           (COUNT(*) FILTER (WHERE b.consortium_role IS DISTINCT FROM 'member'))::int
             AS "contractCount",
           -- Buyers with a REAL (non-member) contract, so the count sits on the same basis
           -- as contractCount — a firm whose only tie to a buyer is a €0 consortium-member
           -- row is not "a buyer of this firm".
           (COUNT(DISTINCT b.awarder_eik) FILTER (WHERE b.consortium_role IS DISTINCT FROM 'member'))::int
             AS "awarderCount"
    FROM base b
    GROUP BY b.contractor_eik
    HAVING COUNT(*) FILTER (WHERE b.consortium_role IS DISTINCT FROM 'member') > 0
    -- No LIMIT: the FULL ranked breakdown so Σ reconciles EXACTLY with person_procurement
    -- (the tiles slice top-N client-side). A person's firm count is naturally bounded, and
    -- the TR redaction sentinel — the only pathological fan-out — is guarded out upstream.
    ORDER BY "totalEur" DESC NULLS LAST, b.contractor_eik
  ) t;
$$;

-- By the AWARDER's seat. awarder_seats.eik is PRIMARY KEY, so the join is 1:1 — no double-count,
-- no DISTINCT. Buyers with no geo/local-HQ seat fall to a single ekatte=NULL "национални" bucket
-- (mirrors procurement_by_settlement, 030). Same member-exclusion + HAVING as by_company.
DROP FUNCTION IF EXISTS person_by_settlement_core(text[], text, text);
CREATE OR REPLACE FUNCTION person_by_settlement_core(
  p_eiks text[], p_from text, p_to text
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH base AS MATERIALIZED (
    SELECT ct.awarder_eik, ct.amount_eur, ct.consortium_role
    FROM contracts ct
    WHERE ct.contractor_eik = ANY(p_eiks)
      AND ct.tag = 'contract'
      AND (p_from IS NULL OR ct.date >= p_from)
      AND (p_to   IS NULL OR ct.date <= p_to)
  ),
  seated AS (
    SELECT b.awarder_eik, b.amount_eur, b.consortium_role, s.ekatte, s.settlement
    FROM base b
    LEFT JOIN awarder_seats s
      ON s.eik = b.awarder_eik AND s.source = 'geo' AND s.is_local_hq
  )
  SELECT COALESCE(
    jsonb_agg(to_jsonb(t) ORDER BY t."totalEur" DESC NULLS LAST, t.ekatte NULLS LAST),
    '[]'::jsonb)
  FROM (
    SELECT ekatte,
           MIN(settlement) AS settlement,
           COALESCE(SUM(amount_eur), 0)::float8 AS "totalEur",
           (COUNT(*) FILTER (WHERE consortium_role IS DISTINCT FROM 'member'))::int
             AS "contractCount",
           -- Non-member basis, like by_company. NOTE: Σ of this across buckets is NOT the
           -- headline awarder_count (024:51) — that one counts member-only (€0) awarders too,
           -- which this deliberately excludes; the two are different questions, not a drift.
           (COUNT(DISTINCT awarder_eik) FILTER (WHERE consortium_role IS DISTINCT FROM 'member'))::int
             AS "awarderCount"
    FROM seated
    GROUP BY ekatte
    HAVING COUNT(*) FILTER (WHERE consortium_role IS DISTINCT FROM 'member') > 0
    -- No LIMIT — see person_by_company_core. Σ reconciles with person_procurement; the
    -- ekatte=NULL "национални" bucket is one of these rows, so nothing leaks out of the sum.
    ORDER BY "totalEur" DESC NULLS LAST, ekatte NULLS LAST
  ) t;
$$;

-- ── Name-keyed wrappers (legacy PersonScreen — matches person_procurement, 024) ──────────────

DROP FUNCTION IF EXISTS person_procurement_by_company(text, text, text);
CREATE OR REPLACE FUNCTION person_procurement_by_company(
  p_name text, p_from text DEFAULT NULL, p_to text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT person_by_company_core(
    (SELECT array_agg(DISTINCT o.uic)
       FROM tr_officers o
      WHERE o.name_fold = translit_bg_latin(p_name)
        AND o.name_fold <> 'zalicheno obstoyatelstvo.'),
    p_from, p_to);
$$;

DROP FUNCTION IF EXISTS person_procurement_by_settlement(text, text, text);
CREATE OR REPLACE FUNCTION person_procurement_by_settlement(
  p_name text, p_from text DEFAULT NULL, p_to text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT person_by_settlement_core(
    (SELECT array_agg(DISTINCT o.uic)
       FROM tr_officers o
      WHERE o.name_fold = translit_bg_latin(p_name)
        AND o.name_fold <> 'zalicheno obstoyatelstvo.'),
    p_from, p_to);
$$;

-- ── Slug-keyed wrappers (new PersonDashboard — matches person_by_slug, 082) ───────────────────

-- The slug → TR-company EIK set, in ONE place so both slug wrappers track 082's basis
-- together (source='tr', high-confidence, public figure). If 082 ever changes its confidence
-- tiers, this is the single line that must move in step — the reconciliation test keys on it.
DROP FUNCTION IF EXISTS person_slug_tr_eiks(text);
CREATE OR REPLACE FUNCTION person_slug_tr_eiks(p_slug text)
RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT array_agg(DISTINCT r.ref)
    FROM person_role r
    JOIN person p ON p.person_id = r.person_id
   WHERE p.slug = p_slug AND p.status = 'active' AND p.is_public_figure
     AND r.source = 'tr' AND r.confidence IN ('exact_id', 'high', 'manual');
$$;

DROP FUNCTION IF EXISTS person_procurement_by_company_slug(text, text, text);
CREATE OR REPLACE FUNCTION person_procurement_by_company_slug(
  p_slug text, p_from text DEFAULT NULL, p_to text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT person_by_company_core(person_slug_tr_eiks(p_slug), p_from, p_to);
$$;

DROP FUNCTION IF EXISTS person_procurement_by_settlement_slug(text, text, text);
CREATE OR REPLACE FUNCTION person_procurement_by_settlement_slug(
  p_slug text, p_from text DEFAULT NULL, p_to text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT person_by_settlement_core(person_slug_tr_eiks(p_slug), p_from, p_to);
$$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION person_by_company_core(text[], text, text)              TO app_readonly;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION person_by_settlement_core(text[], text, text)           TO app_readonly;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION person_slug_tr_eiks(text)                               TO app_readonly;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION person_procurement_by_company(text, text, text)         TO app_readonly;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION person_procurement_by_settlement(text, text, text)      TO app_readonly;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION person_procurement_by_company_slug(text, text, text)    TO app_readonly;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION person_procurement_by_settlement_slug(text, text, text) TO app_readonly;
  END IF;
END $$;
