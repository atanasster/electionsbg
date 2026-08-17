-- The /subsidies hub's ONE stat call. Plan: docs/plans/subsidies-hub-v1.md §5.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- A FUNCTION OVER A MATVIEW, NOT A COMMITTED JSON BLOB — the same departure 145 made for
-- /funds, for the same two reasons. `feedback_no_json_from_pg` (PG is for live serving and
-- queryable tables, not for generating committed JSON) and the fact that /subsidies is ALREADY
-- 100% PG-served, so a blob would be a SECOND serving surface for the same numbers. CLAUDE.md
-- records what that costs: `data/procurement/derived/hub_stats.json` went stale in the repo
-- for two months while still serving 200s, because nothing regenerated it when the corpus
-- reloaded.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- KEYED BY SCOPE, AND THAT IS THE WHOLE POINT OF THE FILE.
--
-- /subsidies carries `?pscope` (ns | all | y:YYYY) and its DEFAULT is the latest financial
-- year — €1.59bn — not the €11.04bn corpus. A tile showing the corpus total under a pill
-- reading „Последна година" is the dashboard-hub skill's first trap, fully formed: a figure
-- that is arithmetically correct and false as a sentence.
--
-- `scope_key` is the `agri_payloads` overview key ('' | <year> | 'all'), the same ten values
-- `agri_beneficiary_year` uses, so the hub, the ranking and the overview payloads cannot
-- disagree about which scopes exist. `agri_hub_stats.data.test.ts` asserts all three sets.
--
-- An UNCOVERED scope returns NULL rather than a row of zeroes. `agriScopeToKey` maps a year
-- outside the corpus (2019, say — the ?pscope param is shared with /procurement, whose picker
-- runs from 2011) to `null`, and the tiles must then render with NO metric. A zero is a claim.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- MATERIALISED, AND THE MEASUREMENT IS WHY. The politically-linked arm alone, as a live
-- aggregate, measured with EXPLAIN (ANALYZE, BUFFERS) on the real corpus:
--
--     Aggregate (actual time=259.540..259.543)
--       Buffers: shared hit=217884 read=15390        ← 233,274 buffers
--
-- against the dashboard-hub skill's ~2,000-buffer ceiling for anything served live, on a call
-- every single /subsidies view would make, on a prod db-g1-small reading cold over the proxy
-- under a 10 s statement_timeout. The cross-programme arms are the same shape.
--
-- So the aggregate lives in a matview and the served function is a seek on it. The cost is the
-- usual one, recorded here rather than discovered: the numbers move when the matview is
-- REFRESHed, which `scripts/agri/ingest.ts` does at the end of its run, and a stale matview
-- serves the previous vintage at a 200.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ ITS REFRESH TRIGGERS ARE WIDER THAN ITS OWN LOADER, because three arms read corpora the
-- agri ingest does not own:
--
--     political      → person_role ⨝ person      (db:resolve:persons)
--     isun_eiks      → fund_projects             (db:load:funds:pg)
--     contract_eiks  → contracts                 (db:load:pg)
--     muni_transfer  → budget_muni_transfer      (db:load:budget-muni:pg)
--
-- Re-run `db:load:agri:pg` after any of those. AND NOTE THE CYCLE, stated rather than hidden:
-- db:refresh runs db:load:agri:pg at step 14 and db:resolve:persons at step 45, so a full
-- refresh builds the political arm from the PREVIOUS run's person layer. Same shape as the
-- Interreg/graph cycle CLAUDE.md documents. A second `db:load:agri:pg` after the person chain
-- closes it in one pass.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- WHY EVERY MONEY FIGURE NAMES ITS BASIS IN ITS KEY — `top100SharePctOfEntityMoney`, never
-- `top100Share`. This corpus has live basis forks and each is a different true sentence:
--
--   * top-100 concentration is 12.6% of LEGAL-ENTITY money and 7.5% of ALL money;
--   * 39.8% of the money sits on rows with NO ЕИК — and „no ЕИК" is NOT „физическо лице":
--     €385.5m of it carries an unmistakable company name (Напоителни системи ЕАД at €47.8m,
--     Община Баните), so the key is `noEikEur`, never `individualEur`. See plan §4.3.
--
-- A key called `top100Share` invites a consumer to pick a denominator by accident, which is
-- how six of six figures came out wrong on the parliament hub.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

DROP MATERIALIZED VIEW IF EXISTS agri_hub_stats_cache;

-- ⚠️ EVERY MONEY SUM ACCUMULATES IN `numeric`, not in the `double precision` the column
-- carries. Floating-point addition is order-dependent, and the order here is a property of
-- the PLAN (parallel aggregation in particular) rather than of the data — so a served figure
-- could move by a cent between two identical requests. Measured against the Node-computed
-- overview payload, the corpus total differed by exactly that: €11,037,181,927.18 vs .17.
-- Exact decimal accumulation makes the served number deterministic; the residual disagreement
-- with the payload is unavoidable (two engines, two accumulators) and the gate compares to
-- the euro rather than the cent for that reason. See `reference_pg_payload_determinism`.
CREATE MATERIALIZED VIEW agri_hub_stats_cache AS
WITH
  -- The ten scopes, taken from `agri_payloads` so this file cannot invent an eleventh
  -- or miss one. Reading the payload keys rather than re-deriving them from `year` is
  -- what keeps the hub, the ranking and the overview blobs on one list.
  scopes AS (SELECT key AS scope_key FROM agri_payloads WHERE kind = 'overview'),
  -- Which calendar year each scope covers. NULL for 'all' (every year), and for ''
  -- it is whatever the payload DECLARES rather than a fresh max(year) — a third
  -- derivation of „the latest year" is a third thing that can drift.
  scope_year AS (
    SELECT s.scope_key,
           CASE WHEN s.scope_key = 'all' THEN NULL
                WHEN s.scope_key = '' THEN
                  (SELECT (payload->>'scopeYear')::int FROM agri_payloads
                    WHERE kind = 'overview' AND key = '')
                -- GUARDED. `agri_payloads` keys are ours today, but an unguarded
                -- cast turns any non-numeric key somebody adds later into a 22P02
                -- that aborts the whole loader rather than skipping one scope.
                WHEN s.scope_key ~ '^[0-9]{4}$' THEN s.scope_key::int
                ELSE NULL END AS y
    FROM scopes s
  ),
  -- ⚠️ THREE EQUI-GROUPED ARMS, never one non-equi join. The obvious form —
  -- `JOIN agri_subsidies a ON sy.y IS NULL OR a.year = sy.y` — cannot be hashed or
  -- merged, so the planner nested-loops it: measured 24.8M filter evaluations for
  -- 5.19M output rows, a row estimate 21x low, and a 650 MB external merge sort
  -- downstream — 246,397 buffers, ~9 GB of temp traffic, 28.1 s. On the db-g1-small
  -- prod runs on, with 1.7 GB RAM, that is the shape CLAUDE.md's migration-123 note
  -- describes as „expect minutes, not seconds".
  --
  -- The UNION ALL below is the same three partitions `agri_beneficiary_year` uses
  -- (046), reached by ordinary GROUP BY over an equality predicate. It scans
  -- agri_subsidies three times instead of fanning it ten ways.
  --
  -- It deliberately does NOT read `agri_beneficiary_year` itself, cheap though that
  -- would be (101,179 rows against 2.48M): 046 DROPs that matview on every apply and
  -- this loader applies 046 first, so the pg_depend edge would make the DROP raise
  -- 2BP01 — a dependent owned by a DIFFERENT file, which is exactly what
  -- migration_drop_dependents.data.test.ts fails on.
  rows_in_scope AS (
    SELECT a.year::text AS scope_key, a.eik, a.name, a.oblast, a.scheme, a.total_eur
      FROM agri_subsidies a
    UNION ALL
    SELECT 'all', a.eik, a.name, a.oblast, a.scheme, a.total_eur
      FROM agri_subsidies a
    UNION ALL
    SELECT '', a.eik, a.name, a.oblast, a.scheme, a.total_eur
      FROM agri_subsidies a
     WHERE a.year = (SELECT y FROM scope_year WHERE scope_key = '')
  ),
  -- The politically-linked EIK set, computed ONCE. This is the canonical
  -- `person_link_n` gate — person_role(tr,ngo) at exact_id/high/manual, held by an
  -- active public figure — the SAME predicate 133's loader and 151's
  -- place_mp_companies use. Deliberately NOT company_politicians (008), which is
  -- money-restricted and procurement-derived: 11 EIKs and €17.6m here against 568
  -- and €184.4m, a factor of 10 on money. It reports a REGISTRY ROLE, never
  -- ownership and never wrongdoing.
  political_eik AS (
    SELECT DISTINCT r.ref AS eik, r.person_id
    FROM person_role r
    JOIN person pe ON pe.person_id = r.person_id
    WHERE r.source IN ('tr', 'ngo')
      AND r.confidence IN ('exact_id', 'high', 'manual')
      AND pe.status = 'active' AND pe.is_public_figure
  ),
  isun_eik AS (
    SELECT DISTINCT beneficiary_eik AS eik FROM fund_projects
    WHERE beneficiary_eik IS NOT NULL
  ),
  contract_eik AS (
    SELECT DISTINCT contractor_eik AS eik FROM contracts
    WHERE contractor_eik IS NOT NULL
  ),
  -- Per-entity totals in scope, for the concentration tiers. The payer is excluded
  -- (it is a counterparty, not a recipient, and has no /farm page to land on).
  -- Entity-grained rollup, used ONLY by the cross-corpus arms below. The
  -- concentration percentages and the entity count/money are NOT computed here —
  -- they are read from `agri_payloads.concentration`, per plan §5.2: where a figure
  -- already exists in the payload the cache reads THAT, so the hub and the dashboard
  -- body cannot drift. Re-deriving them was also what produced a second, colliding
  -- `entityEur` on a different basis from the payload's.
  entity AS (
    SELECT year::text AS scope_key, eik, sum(coalesce(total_eur, 0)::numeric) AS eur
      FROM agri_subsidies WHERE eik IS NOT NULL AND eik <> '121100421'
     GROUP BY year, eik
    UNION ALL
    SELECT 'all', eik, sum(coalesce(total_eur, 0)::numeric)
      FROM agri_subsidies WHERE eik IS NOT NULL AND eik <> '121100421'
     GROUP BY eik
    UNION ALL
    SELECT '', eik, sum(coalesce(total_eur, 0)::numeric)
      FROM agri_subsidies
     WHERE eik IS NOT NULL AND eik <> '121100421'
       AND year = (SELECT y FROM scope_year WHERE scope_key = '')
     GROUP BY eik
  ),
  -- What the payload ALREADY carries, read rather than re-derived (plan §5.2).
  -- `concentration` there is payer-EXCLUDED, which is the basis the two percentages
  -- need; `headline.entityEur` is a different, payer-INCLUSIVE figure and is
  -- deliberately not used. `individualEur` is the payload's name for the no-ЕИК
  -- money — renamed on the way out, because „no ЕИК" is not „физическо лице".
  payload AS (
    SELECT key AS scope_key,
           round((payload->'headline'->>'totalEur')::numeric, 2)        AS total_eur,
           round((payload->'concentration'->>'entityEur')::numeric, 2)  AS entity_eur,
           (payload->'concentration'->>'entityCount')::bigint           AS entity_count,
           (payload->'concentration'->>'top100Share')::numeric          AS top100_pct,
           (payload->'concentration'->>'top1000Share')::numeric         AS top1000_pct,
           round((payload->'headline'->>'individualEur')::numeric, 2)   AS no_eik_eur,
           (payload->'headline'->>'individualCount')::bigint            AS no_eik_beneficiaries,
           payload->'headline'->'topScheme'->>'scheme'                  AS top_scheme,
           round((payload->'headline'->'topScheme'->>'totalEur')::numeric, 2) AS top_scheme_eur,
           jsonb_array_length(payload->'byOblast')                      AS oblast_count,
           payload->'byOblast'->0->>'oblast'                            AS top_oblast,
           round((payload->'byOblast'->0->>'totalEur')::numeric, 2)     AS top_oblast_eur
    FROM agri_payloads WHERE kind = 'overview'
  ),
  -- The four figures the payload does NOT carry. `byScheme` there is a top-12, so a
  -- distinct count has to come from the rows; the two no-ЕИК row measures likewise.
  raw AS (
    SELECT r.scope_key,
           count(*)                                       AS payment_rows,
           count(DISTINCT r.scheme) FILTER (WHERE r.scheme IS NOT NULL) AS scheme_count,
           count(*) FILTER (WHERE r.eik IS NULL)          AS no_eik_rows
    FROM rows_in_scope r
    GROUP BY r.scope_key
  ),
  -- The three cross-corpus arms, all off `entity` (101k rows) rather than the raw
  -- 5.19M. Identical results — verified per scope — at a fraction of the work.
  cross_corpus AS (
    SELECT e.scope_key,
           count(*) FILTER (WHERE e.eik IN (SELECT eik FROM political_eik)) AS political_eiks,
           sum(e.eur) FILTER (WHERE e.eik IN (SELECT eik FROM political_eik)) AS political_eur,
           count(*) FILTER (WHERE e.eik IN (SELECT eik FROM isun_eik))       AS isun_eiks,
           count(*) FILTER (WHERE e.eik IN (SELECT eik FROM contract_eik))   AS contract_eiks
    FROM entity e GROUP BY e.scope_key
  ),
  political_people AS (
    SELECT e.scope_key, count(DISTINCT p.person_id) AS n
    FROM entity e JOIN political_eik p ON p.eik = e.eik
    GROUP BY e.scope_key
  )
SELECT p.scope_key,
       rw.payment_rows,
       p.total_eur,
       p.entity_count,
       p.entity_eur,
       p.no_eik_eur,
       p.no_eik_beneficiaries,
       rw.no_eik_rows,
       rw.scheme_count,
       p.top_scheme,
       p.top_scheme_eur,
       p.oblast_count,
       p.top_oblast,
       p.top_oblast_eur,
       p.top100_pct   AS top100_pct_of_entity_eur,
       p.top1000_pct  AS top1000_pct_of_entity_eur,
       xc.political_eiks,
       xc.political_eur,
       pp.n           AS political_people,
       xc.isun_eiks,
       xc.contract_eiks
FROM payload p
LEFT JOIN raw rw            ON rw.scope_key = p.scope_key
LEFT JOIN cross_corpus xc   ON xc.scope_key = p.scope_key
LEFT JOIN political_people pp ON pp.scope_key = p.scope_key
-- WITH NO DATA, because `scripts/agri/ingest.ts` REFRESHes this immediately after the
-- corpus commits. Building it here would compute the whole thing against the PRE-load
-- corpus and throw it away — the apply runs at the TOP of runAgriIngest — so a warm
-- load paid the full build TWICE. It also shortens the apply's AccessExclusiveLock to
-- ~0. Reading an unpopulated matview RAISES 55000 rather than returning zero rows, and
-- /api/db/agri-hub-stats degrades on exactly that code, so this makes the route's
-- documented first-deploy branch the intended path rather than dead code.
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agri_hub_stats_cache_scope
  ON agri_hub_stats_cache (scope_key);

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- The served function. A PK seek on the matview above, returning the tile figures for ONE
-- scope plus the scope-INDEPENDENT cross-stream block.
--
-- ⚠️ THE CROSS-STREAM BLOCK IS NOT SCOPED AND MUST NOT BE READ AS IF IT WERE. Band 3 of the
-- hub fronts the OTHER public subsidy streams, which have no `?pscope` dimension and different
-- accounting bases entirely — municipal transfers are intra-government, CAP money is EU funds
-- passing through a paying agency. THEY ARE NEVER SUMMED WITH EACH OTHER OR WITH THE AGRI
-- FIGURES, and every tile that renders one names its year in the caption.
--
-- Only the municipal-transfer figure is here, because it is the only one of the four that
-- lives in Postgres. The rail subsidy (data/transport/rail_subsidy.json), the НФЦ film
-- register (data/culture/overview.json) and the ЗПП party subsidy (PARTY_SUBSIDY_VOTES ×
-- PARTY_SUBSIDY_RATE_EUR in src/lib/bgTaxPolicy.ts) are read client-side from the artifacts
-- and constants that already own them — 10 KB between them. Restating any of the three as a
-- literal here would go stale at a 200 the next time update-budget or update-culture ran.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION agri_hub_stats(p_scope text DEFAULT '')
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'scopeKey', c.scope_key,
    -- Which financial year this scope actually describes, so a caption can name it
    -- rather than the caller inferring it from the key. NULL for 'all'.
    'scopeYear', (SELECT (payload->>'scopeYear')::int FROM agri_payloads
                   WHERE kind = 'overview' AND key = c.scope_key),
    'paymentRows',   c.payment_rows,
    'totalEur',      round(c.total_eur, 2),
    -- ⚠️ ExPayer, and the suffix is load-bearing. `agri_payloads.headline.entityEur`
    -- is the same words on a DIFFERENT basis — it INCLUDES ДФ „Земеделие" itself,
    -- €27,964,642 more on the `all` scope and different on 7 of 10 scopes. This one
    -- excludes the paying agency because it is the denominator of the two
    -- concentration percentages below, and because the payer is a counterparty with
    -- no /farm page rather than a recipient.
    'entityCountExPayer', c.entity_count,
    'entityEurExPayer',   round(c.entity_eur, 2),
    -- „no ЕИК", never „физически лица" — 8.8% of this carries a company name.
    'noEikEur',      round(c.no_eik_eur, 2),
    'noEikBeneficiaries', c.no_eik_beneficiaries,
    'noEikRows',     c.no_eik_rows,
    'noEikPctOfTotalEur', CASE WHEN c.total_eur > 0
      THEN round((c.no_eik_eur / c.total_eur * 100), 1) END,
    'schemeCount',   c.scheme_count,
    'topScheme',     c.top_scheme,
    'topSchemeEur',  round(c.top_scheme_eur, 2),
    'oblastCount',   c.oblast_count,
    'topOblast',     c.top_oblast,
    'topOblastEur',  round(c.top_oblast_eur, 2),
    'top100PctOfEntityEur',  c.top100_pct_of_entity_eur,
    'top1000PctOfEntityEur', c.top1000_pct_of_entity_eur,
    'politicalEiks',   nullif(c.political_eiks, 0),
    'politicalEur',    round(c.political_eur, 2),
    -- NULL, never 0. On a first build the person layer may be empty (db:refresh runs
    -- this loader at step 14 and db:resolve:persons at 45), and „0 фирми · 0 лица" is
    -- a CLAIM where „not computed yet" is the truth. `politicalBasisBuilt` is the
    -- `sourcesBuilt` precedent from judicial_body_detail(): it lets the tile say
    -- „не е изчислено" instead of publishing a zero.
    'politicalPeople', c.political_people,
    'politicalBasisBuilt',
      (SELECT count(*) > 0 FROM person_role WHERE source IN ('tr','ngo')),
    'isunEiks',        c.isun_eiks,
    'contractEiks',    c.contract_eiks,
    'crossStream', jsonb_build_object(
      'muniTransferEur',  round(m.eur, 2),
      'muniTransferYear', m.y,
      'muniCount',        m.n
    )
  )
  FROM agri_hub_stats_cache c
  LEFT JOIN LATERAL (
    SELECT fiscal_year AS y, sum(total_eur::numeric) AS eur, count(*) AS n
    FROM budget_muni_transfer
    WHERE fiscal_year = (SELECT max(fiscal_year) FROM budget_muni_transfer)
    GROUP BY fiscal_year
  ) m ON true
  WHERE c.scope_key = coalesce(p_scope, '');
$$;

-- ROLE-GUARDED (the 117/130 shape). `roles_readonly.sql` is a one-time MANUAL step on Cloud
-- SQL, so an unguarded GRANT raises 42704 on a database where it never ran and — exec()
-- sending the file as one implicit transaction — rolls back the whole migration, leaving no
-- matview and no function at all.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON agri_hub_stats_cache TO app_readonly;
    GRANT EXECUTE ON FUNCTION agri_hub_stats(text) TO app_readonly;
  END IF;
END $$;
