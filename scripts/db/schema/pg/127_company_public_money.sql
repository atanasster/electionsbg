-- 127_company_public_money.sql — per-EIK BROAD public money, the ONE reusable basis.
--
-- public_money_eur per company = Σ (contracts ∪ agri_subsidies ∪ fund_beneficiaries):
--   • contracts.amount_eur  WHERE tag='contract' AND consortium_role IS DISTINCT FROM 'member'
--     (the 078 post-annex SIGMA-matching basis)
--   • agri_subsidies.total_eur
--   • fund_beneficiaries.paid_eur
--   • interreg_partners.budget_eur (Bulgarian rows with an EIK) — see below
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
-- THE INTERREG ARM IS TIER L ONLY, AND THAT CEILING IS STRUCTURAL. keep.eu's
-- national-id field exists only in the 2021-2027 template: 0 of 1,080 Bulgarian
-- 2014-2020 partner rows carry an EIK, against 336 of 413. So this arm can reach
-- roughly a third of a €396m corpus and is blind to the rest BY SOURCE, not by
-- any choice made here — an organisation active in both periods contributes its
-- 2021-2027 half and nothing else. That is why `interreg_eur` is a COLUMN of its
-- own rather than only a summand: a caption that cannot name the arm cannot warn
-- that it is partial, and a company tile silently understating Interreg money is
-- worse than one that omits it.
--
-- SCOPED TO BULGARIA. `interreg_partners.eik` is a NAMESPACE, not an identity —
-- it holds whatever national id keep.eu published, for every country. 196
-- distinct foreign ids sit in it and 321 values are exactly nine digits; two
-- collide EXACTLY with a live tr_companies.uic (204426451, 204911337, both
-- Georgian bodies). Without the country predicate this matview would attribute a
-- Georgian organisation's budget to a Bulgarian company as public money.
-- interreg_by_eik shipped without that predicate once; this is the same trap.
--
-- THE GRAPH LOADER APPLIES 137's DDL BEFORE THIS FILE, which is what lets the
-- arm be unconditional. A matview body is resolved at CREATE time, so without
-- that guarantee this file would fail to create on a database that never ran
-- db:load:interreg:pg — taking /connections down with it. Branching on
-- to_regclass was the first attempt and is worse: the branch bakes into the
-- STORED definition, so a database that built this Interreg-blind stays blind
-- through every REFRESH and only a re-APPLY repairs it — invisible, and not
-- fixed by the thing an operator would reach for.
--
-- ONE VINTAGE OF LAG, BY CONSTRUCTION, and it cannot be ordered away. db:refresh
-- runs graph (47) → tr-company-place (49) → interreg (50), and that order is
-- forced: tr_company_place denormalizes THIS matview, while the Interreg place
-- cascade reads tr_company_place's EKATTE. Adding this arm closes the loop —
-- 127 now reads interreg_partners — so the three form a cycle that no
-- ORDER_PAIRS entry can express. The consequence is stated rather than hidden:
-- the Interreg arm is built from the PREVIOUS run's interreg_partners, so a
-- corpus that grew this run lands in company_public_money on the NEXT one, and
-- a first-ever Interreg load contributes nothing until graph runs again. Re-run
-- db:load:graph:pg after any Interreg reload to close it in one pass.
--
-- ADDITIVE, for now: this EXTRACTS the basis but does not yet replace the inline copies in 120
-- (nf_company) / resolve_persons (money_eik) — those still compute their own UNION. Collapsing them
-- to JOIN this matview (the true "one source") is a deferred follow-up (blast radius on the
-- invariant-heavy 120). The data test pins 127 against the canonical UNION spec so the copies cannot
-- silently diverge from it; it does NOT (cannot) read 120's inline expression.

DROP MATERIALIZED VIEW IF EXISTS company_public_money CASCADE;
CREATE MATERIALIZED VIEW company_public_money AS
  SELECT eik,
         round(sum(eur)::numeric, 2)::double precision AS public_money_eur,
         -- The Interreg share of the figure beside it, so a surface can say
         -- "of which €X is Interreg, and that arm reaches 2021-2027 only".
         -- COALESCEd to 0 rather than left NULL: "no Interreg money" and "the
         -- arm is missing" are not distinguishable here anyway, and a NULL makes
         -- `public_money_eur - interreg_eur` NULL for the 81,119 companies that
         -- have none — which is every consumer's first instinct.
         COALESCE(
           round(sum(eur) FILTER (WHERE arm = 'interreg')::numeric, 2), 0
         )::double precision AS interreg_eur
  FROM (
    SELECT contractor_eik AS eik, amount_eur AS eur, 'zop' AS arm
      FROM contracts
     WHERE contractor_eik <> '' AND tag = 'contract'
       AND consortium_role IS DISTINCT FROM 'member'
    UNION ALL SELECT eik, total_eur, 'agri' FROM agri_subsidies     WHERE eik IS NOT NULL
    UNION ALL SELECT eik, paid_eur,  'isun' FROM fund_beneficiaries WHERE eik IS NOT NULL
    -- The Interreg arm. SCOPED TO BULGARIA — see the header: `eik` here is a
    -- namespace holding every country's national id, and two Georgian values
    -- collide exactly with live Bulgarian company UICs.
    UNION ALL SELECT eik, budget_eur, 'interreg' FROM interreg_partners
     WHERE eik IS NOT NULL
       AND (country = 'Bulgaria' OR country_department = 'Bulgaria')
  ) x
  WHERE eur IS NOT NULL
  GROUP BY eik;

-- UNIQUE so the graph loader's JOIN is a plain index lookup and a REFRESH CONCURRENTLY is possible.
CREATE UNIQUE INDEX idx_company_public_money_eik ON company_public_money (eik);
