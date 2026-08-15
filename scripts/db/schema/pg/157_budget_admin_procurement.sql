-- 157 — the spending unit → procurement cross-link (plan T9.9).
--
-- WHAT IT ANSWERS: a ministry's row on /budget/ministries says what the State
-- Budget Law appropriated to it. This says what it then went out and BOUGHT,
-- and whether any of the companies it bought from are tied to a politician.
-- The legacy `BudgetMinistriesTile` carried both; the migrated screen lost them
-- with the `derived/ministry_procurement.json` artifact T7 retired.
--
-- ── WHY A STORED TABLE AND NOT A JOIN IN `budget_admin_list` ──────────────
--
-- ⚠️ THE HEADLINE REASON IS CORRECTNESS, NOT SPEED, and an earlier draft of this
-- header had it the other way round. `mp_contractor_count` is a count of
-- DISTINCT contractors and is therefore NOT summable across years — МО is 8
-- distinct politician-linked contractors against a naive per-year sum of 38, and
-- 28 of 46 units differ — so the 'all' figure has to be STORED whatever a live
-- join would cost.
--
-- The speed argument is real but narrower than first claimed. Measured on this
-- corpus, reconstructing the live-join form of `budget_admin_list`:
--
--     one year   (sargable range)     ~1,437 buffers  — about what reading this
--                                                       table costs (1,505)
--     one year   left(c.date,4)       17,331 buffers  — the non-sargable first
--                                                       draft, 91 ms
--     all years                      ~19,050 buffers  + a ~22k-page spill to temp
--
-- So on today's indexes (`idx_contracts_awarder`, `_awarder_date`,
-- `_awarder_tag_cover`) the ONE-YEAR live join is not expensive, and the page
-- only ever asks for one year — `useBudgetAdminList` sets `enabled: fy != null`.
-- What the table buys is the all-years path and, above all, the distinct count.
-- An earlier revision of this comment claimed 8,665 for the sargable one-year
-- case; that does not reproduce and was measured on a different query shape.
--
-- This is the 122/124 shape (contractor_rank, procurement_payloads) applied to
-- a much smaller fan-out: 46 spending units × (9 fiscal years + 'all').
--
-- The 'all' row is currently reachable only by calling /api/db/budget-ministries
-- with no `fy` — the page always passes one — so nothing on screen depends on
-- it today.
--
-- ── WHERE THE EIK COMES FROM, WHICH IS NOT THIS FILE ──────────────────────
--
-- ⚠️ EVERY ROW HERE IS A JOIN ON `budget_admin_node.eik`, AND THAT COLUMN IS
-- NOT DERIVED IN POSTGRES. It is stamped by `load_budget_pg.ts` from the
-- COMMITTED artifact `data/budget/derived/ministry_procurement.json` — 46 of the
-- 54 admin nodes carry one — which is itself written offline by
-- `crossReferenceProcurement` (scripts/budget/cross_reference.ts) during
-- `npm run budget:ingest`, by NAME-MATCHING each budget unit against the
-- procurement awarders index.
--
-- So the artifact T7 retired as a browser FETCH is still load-bearing as an
-- INGEST INPUT, and the T9.9 note that this table's MP count is „a wider basis
-- than the ministry_procurement.json it replaces" is true of the COUNT and false
-- of the match: the match is still that file's.
--
-- Postgres COULD express that match — `contracts.awarder_name` is populated on
-- 409,200 rows — but nothing does, so the artifact is the only producer.
--
-- That gives this table a FOURTH staleness trigger the three loaders do not
-- cover. The other three (a budget reload, a contracts reload, a TR reload) all
-- rebuild rows from an EIK that is already correct. This one changes WHICH EIK a
-- unit has, and it takes BOTH steps: `budget:ingest` moves the artifact,
-- `db:load:budget:pg` moves the column.
--
--     a procurement re-ingest that adds, renames or re-EIKs an awarder
--       → the name match is stale
--       → a unit keeps its old EIK, or a newly-matchable unit keeps none
--       → this table attributes contracts to the wrong unit, or omits them,
--         with every row count reconciling.
--
-- Re-run `npm run budget:ingest` after a procurement ingest that moves the
-- awarder set, then `db:load:budget:pg`.
--
-- ⚠️ THE INGEST NEEDS `data/procurement/awarders/`, WHICH IS GITIGNORED — 0
-- tracked against 4,415 files on a machine that has run the pipeline. Run it
-- without them and it matches nothing and writes `entries: []`, which would
-- blank this whole table on the next load; `assertProcurementArtifactUsable`
-- in `load_budget_pg.ts` refuses that, and `budget_serving.data.test.ts` fails
-- on any drift between the artifact and the column.

-- ── WHY A TABLE AND NOT A MATERIALIZED VIEW ───────────────────────────────
--
-- A matview resolves its query at CREATE time, so it could only be created on a
-- database that already has `contracts` — and this file is applied by
-- `load_budget_pg.ts`, whose own corpus is loaded independently of the
-- procurement one. A plain table plus a plpgsql rebuild applies anywhere and
-- stays EMPTY where there is nothing to compute, which is the 147 shape. The
-- rebuild is plpgsql specifically so its body records no `pg_depend` edge on
-- `contracts` (see 077's note on the 2BP01 that stalled db:load:pg for a day).

CREATE TABLE IF NOT EXISTS budget_admin_procurement (
  node_id             text    NOT NULL,
  -- The four-digit fiscal year, or 'all' for the whole corpus. A TEXT sentinel
  -- rather than a NULL, because `(node_id, NULL)` is not a usable primary key
  -- and a magic 0 reads as a year. Same idiom as 122's 'ALL' division.
  scope               text    NOT NULL,
  eik                 text    NOT NULL,
  eur                 double precision NOT NULL,
  contract_count      int     NOT NULL,
  -- DISTINCT contractors in this scope that appear in `company_politicians`.
  -- NOT summable across scopes — a contractor active in two years is one
  -- company, not two — which is why 'all' is stored rather than derived.
  mp_contractor_count int     NOT NULL,
  -- How many admin nodes carry THIS EIK. Normally 1; it is 2 for
  -- „Министерство на земеделието" and „Министерство на земеделието и храните",
  -- which are one legal entity under two registry names spanning a rename and
  -- BOTH of which carry the same appropriation in 2023 and 2024. The footprint
  -- belongs to the EIK, so both rows legitimately show the same €107.6m over
  -- 886 contracts — and a reader adding them gets €215m. The count is stored so
  -- the page can say the figure is shared instead of the reader summing it.
  eik_node_count      int     NOT NULL DEFAULT 1,
  PRIMARY KEY (node_id, scope)
);

-- Reconcile for a warm database: CREATE TABLE IF NOT EXISTS is a no-op, so a
-- new column reaches only a fresh one without this.
ALTER TABLE budget_admin_procurement
  ADD COLUMN IF NOT EXISTS eik_node_count int NOT NULL DEFAULT 1;

COMMENT ON TABLE budget_admin_procurement IS
  'Per spending unit × fiscal year: contracts awarded, and how many of the '
  'contractors are politician-linked. Rebuilt by rebuild_budget_admin_procurement().';
COMMENT ON COLUMN budget_admin_procurement.eik_node_count IS
  'Admin nodes sharing this EIK. > 1 means the footprint is one legal entity''s '
  'and appears on more than one row, so the rows must not be summed.';
COMMENT ON COLUMN budget_admin_procurement.eur IS
  'Sum of contracts.amount_eur at tag = ''contract'' — the post-annex current '
  'value. Amendments carry no money weight and are excluded, as in every other '
  'money rollup over this corpus.';
COMMENT ON COLUMN budget_admin_procurement.mp_contractor_count IS
  'DISTINCT contractor EIKs present in company_politicians. This is a WIDER '
  'basis than the retired ministry_procurement.json, which counted only '
  'contractors whose TRUNCATED topAwarders list named this buyer — measured, 2 '
  'against 18 for Министерство на здравеопазването. The old figure was a floor.';

/**
 * Rebuild the whole table from `contracts` × `company_politicians`.
 *
 * Returns the row count written. A no-op returning 0 when any input relation is
 * absent — this file is applied by the budget loader, which knows nothing about
 * whether the procurement corpus has ever been loaded, and an empty table makes
 * the page render without the footprint rather than 500.
 *
 * plpgsql, deliberately: a `LANGUAGE sql` body would record a pg_depend edge on
 * `contracts`, so a later migration that DROPs it would 2BP01 against this file.
 */
CREATE OR REPLACE FUNCTION rebuild_budget_admin_procurement()
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  n bigint;
BEGIN
  -- ALL THREE, including `company_politicians` — which is loaded ONLY by
  -- `db:load:tr:pg`, a REFRESH_EXCLUSIONS member, so CLAUDE.md records its
  -- absence as legitimate rather than broken (`hub_stats` probes for it for the
  -- same reason). Guarding on two of the three raises 42P01 from the body on
  -- exactly the machine the guard exists for.
  IF to_regclass('public.contracts') IS NULL
     OR to_regclass('public.budget_admin_node') IS NULL
     OR to_regclass('public.company_politicians') IS NULL THEN
    RETURN 0;
  END IF;

  -- One pass over the 46 buyers' contracts, bucketed per year AND to 'all', so
  -- the distinct-contractor count is exact in both — a UNION of two aggregates
  -- would recount, and summing the per-year counts would double-count any
  -- contractor active in more than one year.
  CREATE TEMP TABLE _bap_src ON COMMIT DROP AS
    SELECT n.node_id,
           n.eik,
           left(c.date, 4)   AS fy,
           c.amount_eur,
           c.contractor_eik,
           -- The politician link is resolved ONCE here rather than per bucket.
           (cp.eik IS NOT NULL) AS mp_linked
      FROM budget_admin_node n
      JOIN contracts c
        ON c.awarder_eik = n.eik
       AND c.tag = 'contract'
      LEFT JOIN (
        SELECT DISTINCT eik FROM company_politicians
      ) cp ON cp.eik = c.contractor_eik
     WHERE n.eik IS NOT NULL
       AND n.eik <> ''
       -- A malformed date cannot be bucketed into a year, and dropping it from
       -- 'all' as well keeps the year rows summing to it.
       AND c.date ~ '^\d{4}-';

  -- How many admin nodes share each EIK — computed over the WHOLE dimension,
  -- not over _bap_src, so a node that shares an EIK while having no contracts
  -- of its own still counts toward the sharing.
  CREATE TEMP TABLE _bap_eik ON COMMIT DROP AS
    SELECT eik, count(*)::int AS n
      FROM budget_admin_node
     WHERE eik IS NOT NULL AND eik <> ''
     GROUP BY eik;

  -- DELETE, not TRUNCATE. This table is on a serving path — `budget_admin_list`
  -- LEFT JOINs it — and TRUNCATE takes an AccessExclusiveLock for the whole
  -- rebuild (291 ms measured locally, seconds on a db-g1-small over the proxy).
  -- A blocked reader that times out gets 55P03, which is in `BUDGET_DEGRADE`
  -- with sentinel `{rows: []}` — so the page would drop the whole SPENDING-UNIT
  -- LIST, not merely the footprint, and say „no units this year" over an intact
  -- corpus. At 615 rows DELETE + INSERT under RowExclusiveLock costs nothing and
  -- readers stay on their MVCC snapshot. Same shape as agri_subsidies.
  DELETE FROM budget_admin_procurement;

  INSERT INTO budget_admin_procurement
    (node_id, scope, eik, eur, contract_count, mp_contractor_count, eik_node_count)
  SELECT s.node_id, s.fy, min(s.eik),
         coalesce(sum(s.amount_eur), 0), count(*),
         count(DISTINCT s.contractor_eik) FILTER (WHERE s.mp_linked),
         max(k.n)
    FROM _bap_src s JOIN _bap_eik k ON k.eik = s.eik
   GROUP BY s.node_id, s.fy
  UNION ALL
  SELECT s.node_id, 'all', min(s.eik),
         coalesce(sum(s.amount_eur), 0), count(*),
         count(DISTINCT s.contractor_eik) FILTER (WHERE s.mp_linked),
         max(k.n)
    FROM _bap_src s JOIN _bap_eik k ON k.eik = s.eik
   GROUP BY s.node_id;

  GET DIAGNOSTICS n = ROW_COUNT;
  DROP TABLE IF EXISTS _bap_src;
  DROP TABLE IF EXISTS _bap_eik;
  RETURN n;
END;
$$;

-- Role-guarded, the 117/130 shape: `roles_readonly.sql` may not have run on the
-- target, and a bare GRANT raises 42704 and rolls the whole file back — exec()
-- sends a migration as one transaction.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON budget_admin_procurement TO app_readonly;
    GRANT EXECUTE ON FUNCTION rebuild_budget_admin_procurement() TO app_readonly;
  ELSE
    RAISE WARNING 'app_readonly is absent — budget_admin_procurement has no ACL. Run npm run db:pg:bootstrap (local) or roles_readonly.sql (cloud).';
  END IF;
END $$;
