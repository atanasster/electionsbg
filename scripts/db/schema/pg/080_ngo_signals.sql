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
-- FRAMING: every signal is a public-interest INDICATOR ("следа, не доказателство"),
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
-- come from the `magistrate` table (070); MPs from `mp_roster` (the all-time MP
-- list, data/parliament/index.json), loaded by the same loader.
CREATE TABLE IF NOT EXISTS official_roster (
  name text NOT NULL,
  slug text NOT NULL,
  role text,
  tier text
);
CREATE INDEX IF NOT EXISTS idx_official_roster_fold
  ON official_roster (translit_bg_latin(name));

-- mp_roster — the full all-time MP list (data/parliament/index.json), loaded by
-- scripts/ngo/load_ngo_board_links_pg.ts. Same build-time-lookup role as
-- official_roster: names + the MP id (→ /candidate/mp-<id> ref), never served.
-- The MP leg matches these names against NGO board officers the same way the
-- official/magistrate legs do — namesake-guarded, high-confidence-only public.
CREATE TABLE IF NOT EXISTS mp_roster (
  name  text NOT NULL,
  mp_id int  NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mp_roster_fold
  ON mp_roster (translit_bg_latin(name));

CREATE TABLE IF NOT EXISTS ngo_board_links (
  eik            text NOT NULL,
  person         text NOT NULL,
  ref            text NOT NULL,   -- /officials/<slug> | /person/<name> | /candidate/mp-<id>
  kind           text NOT NULL,   -- 'mp' | 'official' | 'magistrate'
  role           text,            -- the NGO board role (ngo_board/representative/…)
  position       text,            -- registry position within the body (председател на УС / секретар / …), when known
  confidence     text NOT NULL,   -- 'high' (namesake company_count ≤2) | 'medium' (≤5)
  namesake_count int
);
-- Backfill the column on an already-created table (IF NOT EXISTS above is a no-op
-- when the table predates this column).
ALTER TABLE ngo_board_links ADD COLUMN IF NOT EXISTS position text;
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
  INSERT INTO ngo_board_links (eik, person, ref, kind, role, position, confidence, namesake_count)
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
           n.board_role AS role, nc.company_count AS cc, n.name_fold
    FROM ngo_off n
    JOIN magistrate m ON translit_bg_latin(m.name) = n.name_fold
    JOIN officer_name_counts nc ON nc.name_fold = n.name_fold
    WHERE nc.company_count <= 3
    UNION ALL
    SELECT n.eik, r.name, '/officials/' || r.slug, 'official', n.board_role, nc.company_count, n.name_fold
    FROM ngo_off n
    JOIN official_roster r ON translit_bg_latin(r.name) = n.name_fold
    JOIN officer_name_counts nc ON nc.name_fold = n.name_fold
    WHERE nc.company_count <= 3
    UNION ALL
    SELECT n.eik, mp.name, '/candidate/mp-' || mp.mp_id, 'mp', n.board_role, nc.company_count, n.name_fold
    FROM ngo_off n
    JOIN mp_roster mp ON translit_bg_latin(mp.name) = n.name_fold
    JOIN officer_name_counts nc ON nc.name_fold = n.name_fold
    WHERE nc.company_count <= 3
  ),
  pos AS (  -- current registry position (председател на УС / секретар / …) per
            -- person-at-NGO; the label lives mostly on the ngo_representative
            -- role. When a person holds several, prefer the most senior title so
            -- "председател" wins over "член"; position_label is the final
            -- deterministic tiebreak.
    SELECT DISTINCT ON (uic, name_fold) uic, name_fold, position_label
    FROM tr_person_roles
    WHERE position_label IS NOT NULL AND erased_at IS NULL
    ORDER BY uic, name_fold,
             CASE
               WHEN position_label ILIKE '%председател%'
                    AND position_label NOT ILIKE '%заместник%' THEN 0
               WHEN position_label ILIKE '%заместник%председател%' THEN 1
               WHEN position_label ILIKE '%изпълнителен директор%' THEN 2
               WHEN position_label ILIKE '%секретар%' THEN 3
               ELSE 4
             END,
             position_label
  )
  -- Dedup by PERSON identity (name_fold), not by ref: someone who is both an
  -- all-time MP and a listed official/magistrate matches the same board officer
  -- via multiple arms with different refs. Keying on name_fold collapses them to
  -- one link so the politician_board count isn't inflated. Kind priority picks the
  -- most-constrained roster (magistrate → official → mp); cc breaks ties toward
  -- the highest confidence.
  SELECT DISTINCT ON (m.eik, m.name_fold)
         m.eik, m.person, m.ref, m.kind, m.role, p.position_label,
         CASE WHEN m.cc = 1 THEN 'high' ELSE 'medium' END, m.cc
  FROM matched m
  LEFT JOIN pos p ON p.uic = m.eik AND p.name_fold = m.name_fold
  ORDER BY m.eik, m.name_fold,
           CASE m.kind WHEN 'magistrate' THEN 0 WHEN 'official' THEN 1 ELSE 2 END,
           m.cc, m.ref;  -- ref is the final deterministic tiebreak: two officials
                         -- sharing a fold-name must not flip the winning slug
                         -- between rebuilds (determinism — compared in tests).
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
rp AS (  -- related-party proximity: a high-confidence board member who ALSO
         -- controls a company (declared holdings) that wins public procurement,
         -- the firm being a DIFFERENT entity than this NGO. The strict "self-dealing
         -- counterparty" join is structurally empty under the namesake guard (0
         -- matches, see docs/plans/ngo-risk-signals-v1.md), so this flags the board
         -- member's own public-contractor firm instead. A trace, not proof.
         --
         -- Namesake-safe: the MP/official arm joins company_politicians on the
         -- person REF (identity), not the name; the magistrate arm matches the
         -- magistrate's (globally-unique, cc=1) name against magistrate_company
         -- (which carries no id). person_name + firm_name are read from the SAME
         -- row (parallel array_agg on one ORDER BY) so we never pair a person with
         -- another member's firm.
  SELECT count(DISTINCT person)::int AS n,
         (array_agg(person ORDER BY person, firm))[1] AS person_name,
         (array_agg(firm   ORDER BY person, firm))[1] AS firm_name
  FROM (
    SELECT b.person, tc.name AS firm
    FROM ngo_board_links b
    JOIN company_politicians cp ON cp.ref = b.ref AND cp.eik <> b.eik
    JOIN tr_companies tc ON tc.uic = cp.eik
    WHERE b.eik = p_eik AND b.confidence = 'high'
      AND EXISTS (SELECT 1 FROM contracts ct WHERE ct.contractor_eik = cp.eik)
    UNION
    SELECT b.person, tc.name
    FROM ngo_board_links b
    JOIN magistrate_company mc
      ON translit_bg_latin(mc.magistrate_name) = translit_bg_latin(b.person)
     AND mc.eik <> b.eik
    JOIN tr_companies tc ON tc.uic = mc.eik
    WHERE b.eik = p_eik AND b.confidence = 'high' AND b.kind = 'magistrate'
      AND EXISTS (SELECT 1 FROM contracts ct WHERE ct.contractor_eik = mc.eik)
  ) mf
),
sig AS (
  SELECT ord, code, obj FROM (
    -- Connection signals (Phase 2) — shown first; each carries the (single) top
    -- person name + confidence. "следа, не доказателство" / PEP-risk-category.
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
    SELECT 3, 'related_party',
           jsonb_build_object('code','related_party','class','connection','tone','rose',
             'count', (SELECT n FROM rp), 'detail', (SELECT person_name FROM rp),
             'firm', (SELECT firm_name FROM rp), 'confidence','high')
    WHERE (SELECT n FROM rp) > 0
    UNION ALL
    SELECT 4, 'public_contracts',
           jsonb_build_object('code','public_contracts','class','public_money','tone','teal',
             'valueEur', ROUND((SELECT eur FROM ctr)), 'count', (SELECT n FROM ctr),
             'asOf', left((SELECT last_date FROM ctr), 4))
    WHERE (SELECT n FROM ctr) > 0
    UNION ALL
    SELECT 5, 'single_bid',
           jsonb_build_object('code','single_bid','class','public_money','tone','amber',
             'share', ROUND((SELECT single_share FROM sb), 4))
    WHERE (SELECT single_share FROM sb) >= 0.5
    UNION ALL
    SELECT 6, 'eu_funds',
           jsonb_build_object('code','eu_funds','class','public_money','tone','emerald',
             'valueEur', ROUND((SELECT eur FROM eu)), 'count', (SELECT n FROM eu))
    WHERE (SELECT n FROM eu) > 0
    UNION ALL
    SELECT 7, 'budget_subsidy',
           jsonb_build_object('code','budget_subsidy','class','public_money','tone','emerald',
             'valueEur', ROUND((SELECT subsidy_eur FROM nf)), 'asOf', (SELECT subsidy_year FROM nf))
    WHERE (SELECT subsidy_eur FROM nf) > 0
    UNION ALL
    SELECT 8, 'foreign_funded',
           jsonb_build_object('code','foreign_funded','class','disclosure','tone','slate',
             'valueEur', ROUND((SELECT foreign_eur FROM nf)), 'asOf', (SELECT foreign_year FROM nf))
    WHERE (SELECT foreign_eur FROM nf) > 0
    UNION ALL
    SELECT 9, 'large',
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
