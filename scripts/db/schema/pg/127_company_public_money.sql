-- 127_company_public_money.sql — per-EIK BROAD public money, the ONE reusable basis.
--
-- public_money_eur per company = Σ (contracts ∪ agri_subsidies ∪ fund_beneficiaries):
--   • contracts.amount_eur  WHERE tag='contract' AND consortium_role IS DISTINCT FROM 'member'
--     (the 078 post-annex SIGMA-matching basis)
--   • agri_subsidies.total_eur
--   • fund_beneficiaries.paid_eur
--
-- This exact UNION was INLINED in TWO places — 120_person_browse.sql (`nf_company`, the name-fold
-- private arm) and scripts/person/resolve_persons.ts (`money_eik`, the Tier-V money-linked EIK set).
-- The connections graph (128) needs the same per-company money on every company node, for ~all
-- linked EIKs at once — a correlated per-node subquery would be N scans of the 400k-row contracts
-- table. So it is extracted here as a matview the graph loader JOINs once. Same basis, one source.
--
-- APPLIED + REFRESHED BY THE GRAPH LOADER (scripts/db/load_graph_pg.ts, P3.3) — NOT by load_pg.
-- load_pg does not create agri_subsidies (a separate loader does), so a fresh db:refresh that ran
-- this in load_pg's schema phase would fail on the missing table. The graph loader runs LATE (after
-- persons-browse + tr + the agri/funds corpora exist) and is this matview's only consumer, so it
-- owns the apply + REFRESH. Consequence: on a fresh DB this is UNBUILT until P3.3 runs (the data
-- test auto-skips), and a standalone contracts reload does NOT refresh it unless the graph loader
-- re-runs (the watch-reload wiring in P3.6 handles that).
--
-- ADDITIVE, for now: this EXTRACTS the basis but does not yet replace the inline copies in 120
-- (nf_company) / resolve_persons (money_eik) — those still compute their own UNION. Collapsing them
-- to JOIN this matview (the true "one source") is a deferred follow-up (blast radius on the
-- invariant-heavy 120). The data test pins 127 against the canonical UNION spec so the copies cannot
-- silently diverge from it; it does NOT (cannot) read 120's inline expression.

DROP MATERIALIZED VIEW IF EXISTS company_public_money CASCADE;
CREATE MATERIALIZED VIEW company_public_money AS
  SELECT eik,
         round(sum(eur)::numeric, 2)::double precision AS public_money_eur
  FROM (
    SELECT contractor_eik AS eik, amount_eur AS eur
      FROM contracts
     WHERE contractor_eik <> '' AND tag = 'contract'
       AND consortium_role IS DISTINCT FROM 'member'
    UNION ALL SELECT eik, total_eur FROM agri_subsidies     WHERE eik IS NOT NULL
    UNION ALL SELECT eik, paid_eur  FROM fund_beneficiaries WHERE eik IS NOT NULL
  ) x
  WHERE eur IS NOT NULL
  GROUP BY eik;

-- UNIQUE so the graph loader's JOIN is a plain index lookup and a REFRESH CONCURRENTLY is possible.
CREATE UNIQUE INDEX idx_company_public_money_eik ON company_public_money (eik);
