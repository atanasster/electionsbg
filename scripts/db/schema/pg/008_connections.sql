-- Person page (DB-backed) — a person is identified only by folded name (TR has
-- no person id), so these functions match tr_officers on name_fold (exact fold).
-- company_politicians holds the curated company↔politician links (loaded from
-- mp_connected/pep_connected by load_tr_pg.ts) so political connections come
-- straight from the DB. Requires 003 (tr tables), 006 (contracts), 000 (fold).
-- See docs/plans/postgres-migration-v1.md.

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
-- table + chronology. `share` is nullable until the TR parser captures дял.
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
           r.uic, r.role, r.share, r.added_at, r.erased_at
    FROM tr_person_roles r CROSS JOIN me
    WHERE r.name_fold = me.qf
    ORDER BY r.uic, r.role, (r.erased_at IS NULL) DESC, r.added_at DESC NULLS LAST
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
  FROM dedup d
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
CREATE OR REPLACE FUNCTION company_officers(eik text)
RETURNS TABLE (
  name           text,
  role           text,
  share          numeric,
  share_amount   numeric,
  share_currency text,
  added_at       timestamptz,
  erased_at      timestamptz,
  active         boolean
)
LANGUAGE sql STABLE AS $$
  WITH dedup AS (
    SELECT DISTINCT ON (r.name_fold, r.role)
           r.name, r.role, r.share, r.share_amount, r.share_currency,
           r.added_at, r.erased_at, (r.erased_at IS NULL) AS active
    FROM tr_person_roles r
    WHERE r.uic = eik
    ORDER BY r.name_fold, r.role,
             (r.erased_at IS NULL) DESC, r.added_at DESC NULLS LAST
  )
  SELECT name, role, share, share_amount, share_currency,
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
CREATE MATERIALIZED VIEW IF NOT EXISTS officer_name_counts AS
  SELECT name_fold, (COUNT(DISTINCT uic))::int AS company_count
  FROM tr_officers WHERE name_fold <> '' GROUP BY name_fold;
CREATE UNIQUE INDEX IF NOT EXISTS idx_officer_name_counts_fold
  ON officer_name_counts(name_fold);
GRANT SELECT ON officer_name_counts TO app_readonly;

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
