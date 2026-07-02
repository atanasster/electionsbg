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
  total_eur  double precision
);
CREATE INDEX IF NOT EXISTS idx_company_politicians_eik ON company_politicians(eik);

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
  WITH me AS (SELECT translit_bg_latin(q) AS qf)
  SELECT o.uic,
         c.name AS company,
         c.status,
         o.roles,
         o.active,
         (SELECT count(*) FROM contracts k WHERE k.contractor_eik = o.uic)
           AS contracts,
         (SELECT coalesce(sum(k.amount_eur), 0) FROM contracts k
            WHERE k.contractor_eik = o.uic AND k.tag = 'contract')
           AS contracts_eur,
         (SELECT count(*) FROM company_politicians p WHERE p.eik = o.uic)
           AS politician_links
  FROM tr_officers o
  CROSS JOIN me
  LEFT JOIN tr_companies c ON c.uic = o.uic
  WHERE o.name_fold = me.qf
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
  WITH me AS (SELECT translit_bg_latin(q) AS qf)
  SELECT r.uic,
         c.name AS company,
         c.status,
         r.role,
         r.share,
         r.added_at,
         r.erased_at,
         (r.erased_at IS NULL) AS active,
         (SELECT count(*) FROM contracts k WHERE k.contractor_eik = r.uic)
           AS contracts,
         (SELECT coalesce(sum(k.amount_eur), 0) FROM contracts k
            WHERE k.contractor_eik = r.uic AND k.tag = 'contract')
           AS contracts_eur
  FROM tr_person_roles r
  CROSS JOIN me
  LEFT JOIN tr_companies c ON c.uic = r.uic
  WHERE r.name_fold = me.qf
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
