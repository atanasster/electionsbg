-- 080_ngo_signals.sql — per-NGO public-interest SIGNAL set + the list matview.
--
-- Turns the ЮЛНЦ surface into a signals product: each NGO carries a computed set
-- of public-interest signals rendered as chips on /procurement/ngos and the NGO
-- page (/company/:eik). Phase 1 covers the PUBLIC-MONEY class only — signals that
-- are a join over data already in PG. The CONNECTION class (politician/magistrate
-- on the board) is Phase 2 and lands in a separate `ngo_board_links` table + a
-- later migration; nothing here depends on it.
--
-- DRY: this does NOT re-aggregate. It composes the same per-EIK sources the
-- company endpoint already uses (functions/db_routes.js company()): `contracts`
-- (contractor_eik), `fund_projects` (beneficiary_eik, ИСУН), `ngo_funding` (040,
-- EU-FTS / state subsidy / foreign grants) and `supplier_risk_grade` (041, the
-- single-bid share). One computation function — `ngo_signal_row(eik)` — is reused
-- by BOTH the matview (list) and `ngo_signals_for(eik)` (the page endpoint).
--
-- FRAMING: every signal is a public-interest INDICATOR ("трейс, не доказателство"),
-- never proof. `foreign_funded` is a NEUTRAL disclosure (absolute €, slate tone),
-- not a red flag. See docs/plans/ngo-risk-signals-v1.md.
--
-- Depends on tr_companies (003), contracts (001), fund_projects (016), ngo_funding
-- (040), supplier_risk_grade (041). Applied + REFRESHed by scripts/db/load_tr_pg.ts
-- (guarded on those tables existing) and re-refreshed by load_ngo_funding_pg.ts.
-- EXECUTE auto-granted to app_readonly via ALTER DEFAULT PRIVILEGES.

SET check_function_bodies = off;

-- The NGO entity-class surface — the three genuine ЮЛНЦ classes (сдружения /
-- фондации / читалища). foreign_branch is DELIBERATELY excluded: it is mostly
-- commercial foreign branches (banks — ИНГ, Ситибанк, Уестингхаус) that would
-- otherwise dominate the public-money ranking and misrepresent an "NGO" list.
-- Kept as an IMMUTABLE helper so the matview WHERE never drifts.
CREATE OR REPLACE FUNCTION is_ngo_class(p_class text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_class IN ('ngo_assoc', 'ngo_found', 'chitalishte');
$$;

-- ── Phase 2: connection signals ─────────────────────────────────────────────
-- ngo_board_links — a politician / official / magistrate who sits on an NGO's
-- governing body, found by matching the person's name against the NGO's board
-- officers (tr_officers roles ngo_board/representative/trustee/verifier), NOT via
-- the contract-gated company_politicians (which starves NGO boards — see the audit
-- in docs/plans/ngo-risk-signals-v1.md). High-confidence, namesake-guarded via
-- officer_name_counts. Populated by rebuild_ngo_board_links() (below).
--
-- official_roster is a build-time lookup loaded from data/officials/derived/
-- company_links.json by scripts/ngo/load_ngo_board_links_pg.ts (names + person
-- refs only — NOT served; the served artifact is ngo_board_links). Magistrates
-- come from the `magistrate` table (070); MPs from companies-index.json when the
-- connections graph has been rebuilt (the loader adds them if present).
CREATE TABLE IF NOT EXISTS official_roster (
  name text NOT NULL,
  slug text NOT NULL,
  role text,
  tier text
);
CREATE INDEX IF NOT EXISTS idx_official_roster_fold
  ON official_roster (translit_bg_latin(name));

CREATE TABLE IF NOT EXISTS ngo_board_links (
  eik            text NOT NULL,
  person         text NOT NULL,
  ref            text NOT NULL,   -- /officials/<slug> | /person/<name> | /candidate/mp-<id>
  kind           text NOT NULL,   -- 'mp' | 'official' | 'magistrate'
  role           text,            -- the NGO board role (ngo_board/representative/…)
  confidence     text NOT NULL,   -- 'high' (namesake company_count ≤2) | 'medium' (≤5)
  namesake_count int
);
CREATE INDEX IF NOT EXISTS idx_ngo_board_links_eik ON ngo_board_links (eik);

-- Rebuild the whole table from the current officers + rosters. TRUNCATE+INSERT so
-- it's deterministic and idempotent. Namesake guard (defamation guard on a PUBLIC
-- page): company_count = 1 → 'high' (the officer name is GLOBALLY UNIQUE across the
-- register, so the magistrate/official↔board-member match is very unlikely to be a
-- coincidence — and since magistrates are barred from commercial management, a real
-- magistrate on an NGO board naturally has cc=1); 2–3 → 'medium' (stored for review
-- but NEVER surfaced publicly); more common names are dropped entirely. Only 'high'
-- fires a signal / renders — see ngo_signal_row + the company endpoint.
CREATE OR REPLACE FUNCTION rebuild_ngo_board_links()
RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  TRUNCATE ngo_board_links;
  INSERT INTO ngo_board_links (eik, person, ref, kind, role, confidence, namesake_count)
  WITH ngo_off AS (
    SELECT o.uic AS eik, o.name_fold,
           CASE WHEN o.roles LIKE '%ngo_board%'          THEN 'ngo_board'
                WHEN o.roles LIKE '%ngo_representative%'  THEN 'ngo_representative'
                WHEN o.roles LIKE '%trustee%'            THEN 'trustee'
                WHEN o.roles LIKE '%verifier%'           THEN 'verifier' END AS board_role
    FROM tr_officers o JOIN tr_companies c ON c.uic = o.uic
    WHERE is_ngo_class(c.entity_class)
      AND (o.roles LIKE '%ngo_board%' OR o.roles LIKE '%ngo_representative%'
           OR o.roles LIKE '%trustee%' OR o.roles LIKE '%verifier%')
  ),
  matched AS (
    SELECT n.eik, m.name AS person, '/person/' || m.name AS ref, 'magistrate' AS kind,
           n.board_role AS role, nc.company_count AS cc
    FROM ngo_off n
    JOIN magistrate m ON translit_bg_latin(m.name) = n.name_fold
    JOIN officer_name_counts nc ON nc.name_fold = n.name_fold
    WHERE nc.company_count <= 3
    UNION ALL
    SELECT n.eik, r.name, '/officials/' || r.slug, 'official', n.board_role, nc.company_count
    FROM ngo_off n
    JOIN official_roster r ON translit_bg_latin(r.name) = n.name_fold
    JOIN officer_name_counts nc ON nc.name_fold = n.name_fold
    WHERE nc.company_count <= 3
  )
  SELECT DISTINCT ON (eik, ref)
         eik, person, ref, kind, role,
         CASE WHEN cc = 1 THEN 'high' ELSE 'medium' END, cc
  FROM matched
  ORDER BY eik, ref, cc;  -- keep the lowest-namesake (highest-confidence) per link
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Single computation, reused by the matview and the page endpoint. Returns the
-- ordered signal array plus the derived list columns (count / money / codes) so
-- everything is computed once per EIK.
DROP FUNCTION IF EXISTS ngo_signal_row(text) CASCADE;
CREATE OR REPLACE FUNCTION ngo_signal_row(p_eik text)
RETURNS TABLE (
  signals          jsonb,
  signal_count     int,
  public_money_eur bigint,
  signal_codes     text
) LANGUAGE sql STABLE AS $$
WITH ctr AS (  -- procurement as a contractor
  SELECT count(*) FILTER (WHERE tag = 'contract')::int AS n,
         COALESCE(sum(amount_eur) FILTER (WHERE tag = 'contract'), 0)::numeric AS eur,
         max(date) FILTER (WHERE tag = 'contract') AS last_date
  FROM contracts WHERE contractor_eik = p_eik
),
eu AS (  -- ИСУН EU-funds beneficiary
  SELECT COALESCE(sum(total_eur), 0)::numeric AS eur, count(*)::int AS n
  FROM fund_projects WHERE beneficiary_eik = p_eik
),
nf AS (  -- external funding (EU-FTS direct / state subsidy / foreign grants)
  SELECT COALESCE(sum(amount_eur) FILTER (WHERE source = 'budget_subsidy'), 0)::numeric AS subsidy_eur,
         max(year) FILTER (WHERE source = 'budget_subsidy') AS subsidy_year,
         COALESCE(sum(amount_eur) FILTER (WHERE source IN ('eu_fts', 'abf', 'ned')), 0)::numeric AS foreign_eur,
         max(year) FILTER (WHERE source IN ('eu_fts', 'abf', 'ned')) AS foreign_year
  FROM ngo_funding WHERE eik = p_eik
),
sb AS (  -- single-bid share — only compute when the NGO actually won contracts
  SELECT CASE WHEN (SELECT n FROM ctr) > 0 THEN (
    SELECT (comp->>'share')::numeric
    FROM jsonb_array_elements(supplier_risk_grade(p_eik) -> 'components') comp
    WHERE comp->>'key' = 'singleBid' AND (comp->>'available')::boolean
  ) END AS single_share
),
money AS (  -- BG/EU public money touched (foreign grants excluded from the total)
  SELECT (SELECT eur FROM ctr) + (SELECT eur FROM eu) + (SELECT subsidy_eur FROM nf) AS eur
),
board AS (  -- high-confidence politician / magistrate board members (Phase 2)
  SELECT
    count(*) FILTER (WHERE kind IN ('mp','official') AND confidence = 'high') AS pol,
    count(*) FILTER (WHERE kind = 'magistrate' AND confidence = 'high')       AS mag,
    (array_agg(person ORDER BY person)
       FILTER (WHERE kind IN ('mp','official') AND confidence = 'high'))[1]   AS pol_name,
    (array_agg(person ORDER BY person)
       FILTER (WHERE kind = 'magistrate' AND confidence = 'high'))[1]         AS mag_name
  FROM ngo_board_links WHERE eik = p_eik
),
sig AS (
  SELECT ord, code, obj FROM (
    -- Connection signals (Phase 2) — shown first; each carries the (single) top
    -- person name + confidence. "трейс, не доказателство" / PEP-risk-category.
    SELECT 1 AS ord, 'politician_board' AS code,
           jsonb_build_object('code','politician_board','class','connection','tone','violet',
             'count', (SELECT pol FROM board), 'detail', (SELECT pol_name FROM board),
             'confidence','high') AS obj
    WHERE (SELECT pol FROM board) > 0
    UNION ALL
    SELECT 2, 'magistrate_board',
           jsonb_build_object('code','magistrate_board','class','connection','tone','fuchsia',
             'count', (SELECT mag FROM board), 'detail', (SELECT mag_name FROM board),
             'confidence','high')
    WHERE (SELECT mag FROM board) > 0
    UNION ALL
    SELECT 3, 'public_contracts',
           jsonb_build_object('code','public_contracts','class','public_money','tone','teal',
             'valueEur', ROUND((SELECT eur FROM ctr)), 'count', (SELECT n FROM ctr),
             'asOf', left((SELECT last_date FROM ctr), 4))
    WHERE (SELECT n FROM ctr) > 0
    UNION ALL
    SELECT 4, 'single_bid',
           jsonb_build_object('code','single_bid','class','public_money','tone','amber',
             'share', ROUND((SELECT single_share FROM sb), 4))
    WHERE (SELECT single_share FROM sb) >= 0.5
    UNION ALL
    SELECT 5, 'eu_funds',
           jsonb_build_object('code','eu_funds','class','public_money','tone','emerald',
             'valueEur', ROUND((SELECT eur FROM eu)), 'count', (SELECT n FROM eu))
    WHERE (SELECT n FROM eu) > 0
    UNION ALL
    SELECT 6, 'budget_subsidy',
           jsonb_build_object('code','budget_subsidy','class','public_money','tone','emerald',
             'valueEur', ROUND((SELECT subsidy_eur FROM nf)), 'asOf', (SELECT subsidy_year FROM nf))
    WHERE (SELECT subsidy_eur FROM nf) > 0
    UNION ALL
    SELECT 7, 'foreign_funded',
           jsonb_build_object('code','foreign_funded','class','disclosure','tone','slate',
             'valueEur', ROUND((SELECT foreign_eur FROM nf)), 'asOf', (SELECT foreign_year FROM nf))
    WHERE (SELECT foreign_eur FROM nf) > 0
    UNION ALL
    SELECT 8, 'large',
           jsonb_build_object('code','large','class','public_money','tone','yellow',
             'valueEur', ROUND((SELECT eur FROM money)))
    WHERE (SELECT eur FROM money) >= 1000000
  ) s
)
SELECT
  COALESCE((SELECT jsonb_agg(obj ORDER BY ord) FROM sig), '[]'::jsonb),
  (SELECT count(*)::int FROM sig),
  ROUND((SELECT eur FROM money))::bigint,
  COALESCE((SELECT string_agg(code, ' ' ORDER BY ord) FROM sig), '');
$$;

-- Page endpoint: just the signal array for one NGO.
DROP FUNCTION IF EXISTS ngo_signals_for(text);
CREATE OR REPLACE FUNCTION ngo_signals_for(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT signals FROM ngo_signal_row(p_eik);
$$;

-- List matview — one row per NGO-class entity, signals precomputed.
DROP VIEW IF EXISTS ngos_list;
DROP MATERIALIZED VIEW IF EXISTS ngo_signals;
CREATE MATERIALIZED VIEW ngo_signals AS
SELECT c.uic AS eik, r.signals, r.signal_count, r.public_money_eur, r.signal_codes
FROM tr_companies c, LATERAL ngo_signal_row(c.uic) r
WHERE is_ngo_class(c.entity_class)
WITH NO DATA;

-- UNIQUE(eik) enables REFRESH … CONCURRENTLY once populated; the money/count
-- indexes serve the list default sort; the GIN index serves code-filtering.
CREATE UNIQUE INDEX idx_ngo_signals_eik   ON ngo_signals (eik);
CREATE INDEX        idx_ngo_signals_money ON ngo_signals (public_money_eur DESC);
CREATE INDEX        idx_ngo_signals_count ON ngo_signals (signal_count DESC);
CREATE INDEX        idx_ngo_signals_gin   ON ngo_signals USING gin (signals jsonb_path_ops);

-- The list registry base — the /api/db/table engine is single-relation, so the
-- join lives in this view (mirrors contracts_list / tenders_list). It DRIVES from
-- ngo_signals (which already holds exactly one row per NGO-class entity) so the
-- money/count indexes are usable for the default sort and no COALESCE / is_ngo_class
-- seq-scan of tr_companies (1M rows) is needed; tr_companies is joined by its uic
-- PK only for the display columns. public_money_eur is pre-rounded to bigint.
CREATE VIEW ngos_list AS
SELECT c.uic, c.name, c.entity_class, c.ngo_type, c.seat, c.status,
       s.signals, s.signal_count, s.public_money_eur,
       (s.signal_count > 0) AS has_signal, s.signal_codes
FROM ngo_signals s
JOIN tr_companies c ON c.uic = s.eik;

DO $$ BEGIN
  EXECUTE 'GRANT SELECT ON ngo_signals TO app_readonly';
  EXECUTE 'GRANT SELECT ON ngos_list TO app_readonly';
EXCEPTION WHEN undefined_object THEN NULL; END $$;
