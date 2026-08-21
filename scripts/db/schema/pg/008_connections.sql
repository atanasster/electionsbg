-- Person page (DB-backed) — a person is identified only by folded name (TR has
-- no person id), so these functions match tr_officers on name_fold (exact fold).
-- company_politicians holds the curated company↔politician links (loaded from
-- mp_connected/pep_connected by load_tr_pg.ts) so political connections come
-- straight from the DB. Requires 003 (tr tables), 006 (contracts), 000 (fold).
-- See docs/plans/postgres-migration-v1.md.
--
-- ⚠️ SHIPS WITH 003, AND 003 GOES FIRST. Since T2 (tr-owner-share-v1) both
-- person_roles and company_officers read the `tr_owner_share` VIEW that 003
-- owns — a view, not one of the "tr tables" above. They are LANGUAGE sql and
-- this file does NOT set check_function_bodies = off, so both bodies are
-- validated at CREATE and raise 42P01 on any database whose 003 predates that
-- view, rolling the whole file back (loud and atomic — the good direction, but
-- it does abort). db:load:tr:pg applies 003 → 008 → 022 in order; the
-- standalone function hatch must name both:
--   npx tsx scripts/db/apply_functions.ts 003_tr_search.sql 008_connections.sql

CREATE TABLE IF NOT EXISTS company_politicians (
  eik        text NOT NULL,
  politician text NOT NULL,
  ref        text NOT NULL,       -- app route: /candidate/mp-<id> | /officials/<slug>
  kind       text NOT NULL,       -- 'mp' | 'official'
  role       text,
  total_eur  double precision,
  -- Full relation detail (kind/confidence/shareSize/isCurrent/…) straight from
  -- the connections pipeline, so the candidate/officials procurement pages keep
  -- confidence badges when served from the DB.
  relations  jsonb NOT NULL DEFAULT '[]'::jsonb
);
-- Upgrade path for DBs created before the relations column existed.
ALTER TABLE company_politicians
  ADD COLUMN IF NOT EXISTS relations jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ⚠️ THE REAL IDENTITY, beside the URL string. `ref` is an app ROUTE, and five sites in
-- load_graph_pg.ts plus 112's `ref LIKE '/candidate/mp-%'` recover a person from it by regex —
-- a bridge that breaks on a roster re-slug and silently drops that person's links, which the
-- graph loader's per-arm preflight exists to catch after the fact. `person_id` is what the
-- rest of the person layer joins on, and it cannot be re-slugged.
--
-- ADDITIVE ON PURPOSE, and `ref` is NOT being retired. It is still the href the company page
-- renders, still the per-person grouping key in 028/029, and still what 031 aggregates
-- mp_ids out of. Dropping it would be a second, unrelated change to six migrations.
--
-- NULLABLE because a database whose company_politicians predates this column has no way to
-- fill it until the next db:load:tr:pg. A consumer must therefore treat NULL as „not resolved
-- here", never as „no such person" — the same rule person_id carries everywhere else.
ALTER TABLE company_politicians
  ADD COLUMN IF NOT EXISTS person_id bigint;
CREATE INDEX IF NOT EXISTS idx_company_politicians_person
  ON company_politicians (person_id) WHERE person_id IS NOT NULL;

-- ⚠️ ONE-OFF BACKFILL, AND IT CLOSES A WINDOW THAT WOULD OTHERWISE BREAK db:load:graph:pg.
-- The column is written by db:load:tr:pg, which is a REFRESH_EXCLUSIONS member — so on every
-- existing database every row stays NULL until somebody runs a ~35-minute TR load by hand,
-- while db:load:graph:pg (step ~47 of db:refresh) now reads the column and its preflight
-- throws at 0/94 and 0/579. The chain cannot self-heal and never reaches test:data.
--
-- The backfill resolves the SAME regexes the graph loader just stopped using, which is safe
-- precisely because it runs ONCE at apply time rather than on every load: verified against
-- the corpus, the regex resolution and the arms' own person_id agree on all 982 rows, and
-- every one of the 673 stored rows resolves.
--
-- Guarded on person_role so a database without a resolved person layer is a no-op rather
-- than an error, and scoped to `person_id IS NULL` so it never overwrites a loader-written
-- value. Idempotent.
DO $$ BEGIN
  IF to_regclass('public.person_role') IS NOT NULL THEN
    UPDATE company_politicians cp
       SET person_id = pr.person_id
      FROM person_role pr
     WHERE cp.person_id IS NULL
       AND (
         (cp.kind = 'mp' AND pr.source = 'mp'
            AND split_part(pr.ref, ':', 1)
                = substring(cp.ref from '^/candidate/mp-(.*)$'))
         OR
         (cp.kind = 'official'
            AND pr.ref = substring(cp.ref from '^/officials/(.*)$'))
       );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_company_politicians_eik ON company_politicians(eik);
CREATE INDEX IF NOT EXISTS idx_company_politicians_ref ON company_politicians(ref);

-- Companies a person is an officer of (+ roles, procurement, politician-link count).
CREATE OR REPLACE FUNCTION person_profile(q text)
RETURNS TABLE (
  uic              text,
  company          text,
  status           text,
  roles            text,
  active           integer,
  contracts        bigint,
  contracts_eur    double precision,
  politician_links bigint
)
LANGUAGE sql STABLE AS $$
  WITH me AS (SELECT translit_bg_latin(q) AS qf),
  -- tr_officers can carry >1 row per (person, company) across filings; collapse
  -- to one current record per company so a person's page lists each company once.
  dedup AS (
    SELECT DISTINCT ON (o.uic) o.uic, o.roles, o.active
    FROM tr_officers o CROSS JOIN me
    WHERE o.name_fold = me.qf
    ORDER BY o.uic, o.active DESC, o.changed_at DESC NULLS LAST
  )
  SELECT d.uic,
         c.name AS company,
         c.status,
         d.roles,
         d.active,
         (SELECT count(*) FROM contracts k WHERE k.contractor_eik = d.uic)
           AS contracts,
         (SELECT coalesce(sum(k.amount_eur), 0) FROM contracts k
            WHERE k.contractor_eik = d.uic AND k.tag = 'contract')
           AS contracts_eur,
         (SELECT count(*) FROM company_politicians p WHERE p.eik = d.uic)
           AS politician_links
  FROM dedup d
  LEFT JOIN tr_companies c ON c.uic = d.uic
  ORDER BY contracts_eur DESC NULLS LAST, company;
$$;

-- Per-role history: one row per company × role, with the ownership share and the
-- from/to dates (current vs former). Powers the person page's detailed roles
-- table + chronology.
--
-- `share` comes from tr_owner_share (003), NEVER from tr_person_roles.share —
-- see that view's header for why the stored column is wrong. NULL means "we
-- cannot express this stake as a fraction of the current capital" and must
-- render as "—", never as 0%.
CREATE OR REPLACE FUNCTION person_roles(q text)
RETURNS TABLE (
  uic           text,
  company       text,
  status        text,
  role          text,
  share         numeric,
  added_at      timestamptz,
  erased_at     timestamptz,
  active        boolean,
  contracts     bigint,
  contracts_eur double precision
)
LANGUAGE sql STABLE AS $$
  WITH me AS (SELECT translit_bg_latin(q) AS qf),
  -- tr_person_roles keeps one row per FILING, so a partner re-listed on every
  -- capital change appears many times (50× for a heavy filer). Collapse to the
  -- current record per (company, role) so the person page lists each once.
  dedup AS (
    SELECT DISTINCT ON (r.uic, r.role)
           r.uic, r.name_fold, r.role, r.added_at, r.erased_at
    FROM tr_person_roles r CROSS JOIN me
    WHERE r.name_fold = me.qf
    ORDER BY r.uic, r.role, (r.erased_at IS NULL) DESC, r.added_at DESC NULLS LAST
  ),
  -- ⚠️ CORRELATED ON PURPOSE — do not "simplify" this to a LEFT JOIN.
  -- tr_owner_share is only cheap when the planner can push a constant `uic`
  -- into it, and this function has none: it filters on name_fold, so a plain
  -- join gives the planner nothing and it materialises the WHOLE view to
  -- answer for one person — measured 200,666 buffers / 1,465 ms for six rows,
  -- on a route a crawler walks under a 10 s statement_timeout. Correlated,
  -- each probe rides idx_tr_person_roles_uic: 285 buffers / 1.9 ms.
  -- The lookup still carries all three key columns; name_fold is pinned to
  -- me.qf here, but 55 (uic, name_fold) pairs hold both a partner and a
  -- sole_owner row in one vintage, so dropping `role` would fan out.
  shared AS (
    SELECT d.uic, d.role, d.added_at, d.erased_at,
           (SELECT os.share_pct FROM tr_owner_share os
             WHERE os.uic = d.uic AND os.name_fold = d.name_fold
               AND os.role = d.role) AS share
    FROM dedup d
  )
  SELECT d.uic,
         c.name AS company,
         c.status,
         d.role,
         d.share,
         d.added_at,
         d.erased_at,
         (d.erased_at IS NULL) AS active,
         (SELECT count(*) FROM contracts k WHERE k.contractor_eik = d.uic)
           AS contracts,
         (SELECT coalesce(sum(k.amount_eur), 0) FROM contracts k
            WHERE k.contractor_eik = d.uic AND k.tag = 'contract')
           AS contracts_eur
  FROM shared d
  LEFT JOIN tr_companies c ON c.uic = d.uic
  ORDER BY active DESC, added_at DESC NULLS LAST, company;
$$;

-- Officers of a company (for the DB-backed company page) — role, ownership
-- share (% + raw amount), from/to dates, current-vs-former.
--
-- tr_person_roles keeps the full FILING HISTORY: every capital change re-lists
-- all partners, so one person appears once per filing (a 50-member company can
-- have ~1,000 rows). Collapse to the CURRENT record per (person, role) — the
-- most recent, active-preferred — so each officer shows once.
--
-- ⚠️ That dedup fixes WHO is shown and cannot fix the PERCENTAGE: the stored
-- tr_person_roles.share was derived against the UN-deduped set, so it divides
-- each owner by every vintage the company has ever filed (and, since the euro
-- changeover, by лв and EUR added together). `share` therefore comes from
-- tr_owner_share (003). A row outside the current vintage — or an erased one —
-- gets NULL and must render "—", never 0%.
-- ⚠️ DROP before CREATE, and the line is load-bearing: T2 added `share_eur` to
-- the OUT parameters, and CREATE OR REPLACE cannot change a function's return
-- row type (42P13 — "cannot change return type of existing function"). Same
-- reason 144 drops funds_wire. Safe here because 008 OWNS this function and
-- recreates it three lines down, and exec() sends the file as ONE transaction
-- so the drop and the create commit together. NO CASCADE: nothing reads it in
-- a stored definition today (db_routes.js calls it at runtime), so a bare DROP
-- fails loudly if that ever changes rather than deleting the new reader.
DROP FUNCTION IF EXISTS company_officers(text);
CREATE OR REPLACE FUNCTION company_officers(eik text)
RETURNS TABLE (
  name           text,
  role           text,
  share          numeric,
  share_eur      numeric,
  share_amount   numeric,
  share_currency text,
  added_at       timestamptz,
  erased_at      timestamptz,
  active         boolean
)
LANGUAGE sql STABLE AS $$
  WITH dedup AS (
    SELECT DISTINCT ON (r.name_fold, r.role)
           r.name, r.role, os.share_pct AS share, os.share_eur,
           r.share_amount, r.share_currency,
           r.added_at, r.erased_at, (r.erased_at IS NULL) AS active
    FROM tr_person_roles r
    LEFT JOIN tr_owner_share os
      ON os.uic = r.uic AND os.name_fold = r.name_fold AND os.role = r.role
    WHERE r.uic = eik
    ORDER BY r.name_fold, r.role,
             (r.erased_at IS NULL) DESC, r.added_at DESC NULLS LAST
  )
  SELECT name, role, share, share_eur, share_amount, share_currency,
         added_at, erased_at, active
  FROM dedup
  ORDER BY active DESC, share DESC NULLS LAST, added_at DESC NULLS LAST;
$$;

-- Politicians reachable from the person, via a company they're both tied to
-- (the person as officer, the politician via the curated link).
CREATE OR REPLACE FUNCTION person_politicians(q text)
RETURNS TABLE (
  politician  text,
  ref         text,
  kind        text,
  role        text,
  via_eik     text,
  via_company text,
  total_eur   double precision
)
LANGUAGE sql STABLE AS $$
  WITH me AS (SELECT translit_bg_latin(q) AS qf),
  mine AS (
    SELECT DISTINCT o.uic FROM tr_officers o CROSS JOIN me WHERE o.name_fold = me.qf
  )
  SELECT p.politician, p.ref, p.kind, p.role, p.eik, c.name, p.total_eur
  FROM company_politicians p
  JOIN mine ON mine.uic = p.eik
  LEFT JOIN tr_companies c ON c.uic = p.eik
  ORDER BY p.total_eur DESC NULLS LAST;
$$;

-- Custom connection: the companies where BOTH names are officers (co-officership).
CREATE OR REPLACE FUNCTION connection_between(a text, b text)
RETURNS TABLE (
  uic     text,
  company text,
  status  text,
  a_roles text,
  b_roles text
)
LANGUAGE sql STABLE AS $$
  WITH qa AS (SELECT translit_bg_latin(a) AS f),
       qb AS (SELECT translit_bg_latin(b) AS f)
  SELECT DISTINCT oa.uic,
         c.name AS company,
         c.status,
         oa.roles AS a_roles,
         ob.roles AS b_roles
  FROM tr_officers oa
  CROSS JOIN qa
  CROSS JOIN qb
  JOIN tr_officers ob ON ob.uic = oa.uic AND ob.name_fold = qb.f
  LEFT JOIN tr_companies c ON c.uic = oa.uic
  WHERE oa.name_fold = qa.f
  ORDER BY company;
$$;

-- Company ↔ person connection check for the DB company page. Given a company EIK
-- and a typed person name, returns (a) the person's DIRECT role(s) in this
-- company, and (b) BRIDGE companies — other firms where the person co-appears
-- with one of THIS company's officers (the indirect ownership/management link),
-- naming the bridge person. The company-anchored analog of connection_between().
-- Name-only match (no personal id) — treat as a lead, like the person page.
DROP FUNCTION IF EXISTS company_connection(text, text);
CREATE OR REPLACE FUNCTION company_connection(p_eik text, p_name text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH pf AS (SELECT translit_bg_latin(p_name) AS f),
mine AS (  -- officers of THIS company (bridge candidates)
  SELECT DISTINCT name_fold, name FROM tr_officers
  WHERE uic = p_eik AND name_fold <> ''
),
direct AS (  -- the person's own role(s) in this company
  SELECT o.name, o.roles, (o.active = 1) AS active
  FROM tr_officers o CROSS JOIN pf
  WHERE o.uic = p_eik AND o.name_fold = pf.f
),
bridges AS (  -- other companies where the person co-appears with an officer of THIS company
  SELECT DISTINCT op.uic AS eik, c.name AS company, m.name AS bridge
  FROM tr_officers op
  CROSS JOIN pf
  JOIN tr_officers ob ON ob.uic = op.uic AND ob.name_fold <> pf.f
  JOIN mine m ON m.name_fold = ob.name_fold AND m.name_fold <> pf.f
  LEFT JOIN tr_companies c ON c.uic = op.uic
  WHERE op.name_fold = pf.f AND op.uic <> p_eik
)
SELECT jsonb_build_object(
  'direct', COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM direct d), '[]'::jsonb),
  'shared', COALESCE(
    (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.company) FROM (SELECT * FROM bridges LIMIT 40) b),
    '[]'::jsonb)
);
$$;

-- Multi-hop connection PATH from a company to a person, over the officer graph.
-- BFS (recursive CTE) that walks company → shared non-hub officer → next company,
-- up to p_max_depth hops, returning the SHORTEST chain to a company the person
-- sits on. Hub names (in > 12 companies — nominees / namesakes) are excluded
-- both to keep the dense graph tractable (worst-case full BFS ~90ms) and to
-- avoid spurious "everyone is connected" links. Cycle-free (no company revisited
-- on a path); expansion stops once the person is reached. Name-only match.
-- DROP+CREATE, not IF NOT EXISTS. Until 2026-08-10 this was IF NOT EXISTS and it
-- propagated anyway, by accident: 003_tr_search.sql's `DROP TABLE tr_officers
-- CASCADE` deleted this matview on every db:load:tr:pg, and load_tr_pg.ts applies
-- THIS file later in the same run — so the body was rebuilt from the file text on
-- every warm database. 003 no longer drops (its CASCADE was also deleting three
-- matviews nothing recreated — see 003's header), which removed that accident and
-- would have frozen this body on every warm database, prod included, while the
-- loader kept REFRESHing it: a current timestamp and current row counts over last
-- year's definition. Exactly the drift 003's own reconcile block prevents for
-- columns, one object type over.
--
-- No CASCADE, deliberately: nothing reads this in a stored definition today
-- (checked), so a bare DROP is enough, and if that ever changes it fails LOUDLY
-- with 2BP01 instead of silently deleting the new reader. That is the whole
-- lesson of the 077/145/003 family — see migration_drop_dependents.data.test.ts.
-- ⚠️ COUNTS ONLY COMPANIES WE OBSERVED THE NAME *ARRIVE* AT, and that clause is
-- load-bearing for identity, not for this matview's own consumers.
--
-- `company_count` is `namesakeRisk` in the resolver (scripts/person/cluster.ts), where it
-- GATES MERGES: Tier 2 unifies an identical full name only at `namesakeRisk <= 1`, on the
-- reasoning that a name attached to several companies is probably worn by several people.
-- So anything that inflates this number silently splits people apart.
--
-- ShareTransfers recovery (person-enrichment-v1) introduced a new class of row: a
-- shareholder we only ever saw LEAVE, because their stake predates the 2021-01-01 feed
-- window. Those carry `added_at IS NULL` and land here as ordinary officers — 96,078 of
-- them, inflating 79,325 name folds, 50,311 of which had no TR presence at all before.
-- Measured consequence: Иван Петев Демерджиев went from 0 companies to 2, crossed the
-- Tier-2 cap, and his ministerial identity stopped merging with his MP one — his
-- declarations and net worth fell off /person/mp-5104. 189 MPs lost their declaration
-- block the same way.
--
-- The EXISTS clause keeps every (name, company) pair we ever saw somebody ARRIVE at,
-- INCLUDING pairs since erased — so this is a restoration, not a new policy: before the
-- recovery every company_persons row carried an added_at (1,244,718 of 1,244,718), which
-- makes the clause a provable no-op on that corpus and an exact filter on the new rows.
-- Filtering on `tr_officers.active` instead would NOT work: `active` is
-- `MAX(erased_at IS NULL)`, so it cannot tell an exit-only row from a genuinely-erased
-- one, and dropping the latter would LOOSEN merging below the historical baseline —
-- the dangerous direction, since a wrong merge is an accusation.
--
-- An exit-only row still earns its place everywhere else: it is a real registry fact and
-- it is what puts the company on /person. It is denied a vote on IDENTITY only.
-- person_identity_stability.data.test.ts holds the thresholds this feeds.
DROP MATERIALIZED VIEW IF EXISTS officer_name_counts;
CREATE MATERIALIZED VIEW officer_name_counts AS
  SELECT o.name_fold, (COUNT(DISTINCT o.uic))::int AS company_count
  FROM tr_officers o
  WHERE o.name_fold <> ''
    AND EXISTS (
      SELECT 1 FROM tr_person_roles r
       WHERE r.name_fold = o.name_fold AND r.uic = o.uic
         AND r.added_at IS NOT NULL
    )
  GROUP BY o.name_fold;
CREATE UNIQUE INDEX IF NOT EXISTS idx_officer_name_counts_fold
  ON officer_name_counts(name_fold);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON officer_name_counts TO app_readonly;
  END IF;
END $$;

DROP FUNCTION IF EXISTS company_person_path(text, text, int);
CREATE OR REPLACE FUNCTION company_person_path(
  p_eik text, p_name text, p_max_depth int DEFAULT 3
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH RECURSIVE
pf AS (SELECT translit_bg_latin(p_name) AS f),
walk AS (
  SELECT p_eik AS uic, 0 AS depth,
         ARRAY[p_eik] AS cpath,
         ARRAY[]::text[] AS people,
         EXISTS (SELECT 1 FROM tr_officers t, pf WHERE t.uic = p_eik AND t.name_fold = pf.f) AS hit
  UNION ALL
  SELECT step.uic, w.depth + 1, w.cpath || step.uic, w.people || step.person,
         EXISTS (SELECT 1 FROM tr_officers t, pf WHERE t.uic = step.uic AND t.name_fold = pf.f)
  FROM walk w
  CROSS JOIN LATERAL (
    SELECT ob.uic, MIN(oa.name) AS person
    FROM tr_officers oa
    JOIN officer_name_counts c ON c.name_fold = oa.name_fold AND c.company_count <= 12
    JOIN tr_officers ob ON ob.name_fold = oa.name_fold AND ob.uic <> oa.uic
    WHERE oa.uic = w.uic AND ob.uic <> ALL(w.cpath)
    GROUP BY ob.uic
  ) step
  WHERE w.depth < p_max_depth AND NOT w.hit
)
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM walk WHERE hit) THEN NULL
ELSE (
  SELECT jsonb_build_object(
    'degree', w.depth,
    'companies', (
      SELECT jsonb_agg(jsonb_build_object('eik', e,
        'name', (SELECT name FROM tr_companies WHERE uic = e)) ORDER BY ord)
      FROM unnest(w.cpath) WITH ORDINALITY AS u(e, ord)
    ),
    'people', to_jsonb(w.people)
  )
  FROM walk w WHERE w.hit ORDER BY w.depth LIMIT 1
) END;
$$;
