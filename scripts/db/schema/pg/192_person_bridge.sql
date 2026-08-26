-- person_person_bridge(a, b) — SECOND-DEGREE connections for the „Проверка на връзка"
-- block: two people who share no company, but whom ONE bridge person joins.
-- Plan: docs/plans/person-connection-second-degree-v1.md
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- WHY THIS BLOCK IS THE RIGHT HOME, AND WHY THE CURATED GRAPH IS NOT.
--
-- `person_connections()` (084) — the graph behind „Кръг от партньори" and /connections —
-- drops any company with more than MAX_CO_OFFICERS (6) co-owners as "a board / professional
-- association, not a business tie". The reference chain this function exists to publish runs
-- through TWO companies with 7 officer folds each, so the curated graph is designed never to
-- surface it. That is correct FOR A CURATED GRAPH and wrong for a reader who typed a specific
-- name: `PersonConnectionCheck`'s own basis line already promises the same edge "за име по
-- ваш избор и БЕЗ изключенията там". This is the surface that answers, with evidence, and
-- labels what the evidence is.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- DEGREE 2 ONLY. DO NOT MAKE THIS RECURSIVE.
--
-- `company_person_path` (008) walks to depth 3 and this deliberately does not. Measured
-- 2026-08-26, hub-capped reachable companies from an ORDINARY subject:
--
--     depth 0 → 7   depth 1 → 55   depth 2 → 266   depth 3 → 1,435
--
-- ~5x per hop, and 847 ms for the depth-3 walk on a person with seven companies — against
-- the pool's 10 s statement_timeout, on a page a crawler walks. A hub subject is far worse.
--
-- The second reason matters more than the cost: at degree 2 the payload is FOUR registry rows
-- a reader can check in the Търговски регистър themselves. At degree 3 it is a claim about a
-- graph. 400 random name pairs (folds with 1–12 companies) produced 0 connections at degree 2
-- — so a hit here means something; nobody has measured degree 3, and after a 5x-per-hop
-- fan-out the honest prior is "approaching everyone".
--
-- A fixed 2-hop join is also more LEGIBLE than a recursive CTE bounded at 2: every leg keeps
-- its own roles, which the BFS cannot (it aggregates MIN(name) per step and loses them).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- THE THREE EXCLUSIONS, EACH LOAD-BEARING. Measured on the hub x hub worst case
-- (Биляна Пламенова Михайлова 292 companies x Снежина Минчева Маджарова 285):
--
--   1. HUB CAP (officer_name_counts.company_count <= 12, the same cut company_person_path
--      uses). Uncapped that pair returns 5,216 bridge rows; capped, 5. Without it the
--      feature is "everyone is connected" and says nothing.
--
--      ⚠️ COALESCE(..., 1) IS MANDATORY, NOT DEFENSIVE. 43,761 tr_officers rows carry a fold
--      that is ABSENT from officer_name_counts — the exit-only shareholders 008's header
--      describes (added_at IS NULL, a stake predating the 2021 feed window). A bare join
--      drops every one of them; they are ordinary low-risk people and belong at count 1.
--
--   2. THE DELETED-FACT PLACEHOLDER. „Заличено обстоятелство." is the single largest fold in
--      the corpus — 4,383 companies — and is not a person (003's header, tr_owner_share).
--      The hub cap already removes it; it is ALSO excluded by fold so that loosening the cap
--      later cannot resurrect a 4,383-company "bridge person".
--
--   3. ⚠️ COURT-APPOINTED PROFESSIONALS — the dominant false-positive class, and the one that
--      is invisible until you look at the rows. Uncapped, that hub x hub pair returned 5
--      chains and ALL FIVE were liquidator -> liquidator -> liquidator: синдици appearing in
--      each other's caseload, where nobody chose anyone. A liquidator/trustee/verifier is
--      appointed by a court or a creditors' meeting, so such a leg is not a relationship.
--      28,709 of 501,972 folds under the hub cap are professional-only, 24,905 companies
--      carry such an officer, and the five largest folds in the whole corpus are синдици.
--      Guarding ALL FOUR legs removes all five of those chains and leaves the reference chain
--      byte-identical.
--
-- A FOURTH exclusion is not a noise filter but a correctness one: a company where BOTH
-- subjects already sit is a DIRECT hit, which `connection_between` already answers. Without
-- `NOT EXISTS (… b_leg …)` the second-degree list restates the first-degree one.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- WHAT IS RETURNED AND NOT FILTERED ON.
--
-- `a_body` / `b_body` are the bridging company's officer-body size. They are RETURNED so the
-- UI can print „(7 вписани лица)" — which is the only thing on the row that distinguishes a
-- real tie from a 7-member управителен съвет. They are NOT a filter: only 316 companies in
-- the corpus exceed 20 officer folds and 46 exceed 50, so ordering by them and capping the
-- row count buys everything a threshold would, without refusing a reader's specific question.
--
-- `bridge_companies` is the bridge's own company count — the namesake signal `foldPeopleN`
-- carries elsewhere on the person page.
--
-- ⚠️ EVERY LEG IS FOLDED TO ONE ROW PER (COMPANY, NAME FOLD) BEFORE ANY JOIN, and skipping
-- that step silently DUPLICATES chains. tr_officers is deduped per (uic, NAME) — not per
-- (uic, name_fold) — and 31,647 (uic, name_fold) pairs carry more than one spelling, so a raw
-- join multiplies each chain by the product of the spelling counts on its four legs. The
-- duplicates are byte-identical apart from the role strings, so they read to a reader as
-- several independent pieces of evidence for one relationship, which is the opposite of what
-- this block is for. `tr_role_union` merges the role sets instead: a person entered twice at
-- one company under two spellings genuinely holds the union of those roles.
--
-- ⚠️ A BRIDGE IS NOT ALWAYS A HUMAN, and this function does not try to say which. tr_officers
-- has no person/entity flag, so a firm sitting on another firm's board is an ordinary row
-- here: 7,941 officer folds (0.9%) also name a company in tr_companies. Three reasons it is
-- left alone rather than filtered or flagged:
--   • A corporate bridge is a REAL and often stronger tie — dropping it loses evidence.
--   • The exact test is unaffordable. tr_companies has only a GIN TRIGRAM index on name_fold,
--     so one equality probe costs 321 buffers / 59 ms (measured); at 25 bridges that is ~1.5 s
--     on a route that otherwise runs in tens of milliseconds.
--   • The heuristic alternative is 024's regex, and it is one of the exclusions this block
--     exists to operate WITHOUT.
-- Consequence to know: the UI links a bridge to /person/<name>, which for a corporate bridge
-- resolves to nothing. That is pre-existing behaviour shared with company_connection() (008)
-- and PersonAssociatesTile, not something introduced here. A btree on tr_companies(name_fold)
-- would make an exact `bridge_is_entity` flag affordable; see the plan's §6.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- APPLIED, NEVER LOADED — and NOT in 008.
--
-- Applied by load_tr_pg.ts (after 008, which owns the officer_name_counts matview this reads
-- and which a LANGUAGE sql body is validated against at CREATE time), so db:load:tr:pg[:cloud]
-- carries it. A body fix ships on its own with:
--
--   npx tsx scripts/db/apply_functions.ts 003_tr_search.sql 008_connections.sql 192_person_bridge.sql
--
-- It is a separate file from 008 deliberately: 008 DROPs and recreates officer_name_counts, so
-- folding this in would make every body change to it rebuild that matview.
--
-- Cost, measured local under PREPARE (a GENERIC plan — which is what the pooled route gets;
-- a psql literal constant-folds and hides it): reference pair 37 ms, hub x common 35 ms,
-- hub x hub 52 ms, officer-of-the-773-member-body x common 46 ms, a clean miss 0.8 ms.
-- ⚠️ Local timings on tr_* have been wrong before — EXPLAIN on Cloud SQL before trusting them.
-- ═══════════════════════════════════════════════════════════════════════════════════════

-- Merge several tr_officers.roles strings into one deduped, comma-separated set.
--
-- The output is SORTED, so it is stable across two calls with the same roles in a different
-- order — the raw column is not. Both consumers are order-blind (the professional predicate
-- is a regex over an unordered alternation; the UI's trRoleList splits and translates), so
-- sorting costs nothing and makes the value comparable.
CREATE OR REPLACE FUNCTION tr_role_union(p_roles text[])
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT string_agg(DISTINCT btrim(r), ',' ORDER BY btrim(r))
  FROM unnest(p_roles) a, LATERAL unnest(string_to_array(a, ',')) r
  WHERE btrim(r) <> '';
$$;

COMMENT ON FUNCTION tr_role_union(text[]) IS
  'Deduped, sorted union of several comma-separated tr_officers.roles sets — what one person '
  'holds at one company across the spellings the register recorded them under.';

-- The professional-appointment predicate, named ONCE. Four hand-copies of a role test is the
-- shape that produced the six-way `magistrate_current` duplication; the precedent for naming
-- it is kzk_effective_suspension (042).
--
-- Deliberately NOT STRICT: a NULL role set is "we do not know", and the guard only ever
-- EXCLUDES on a positive match, so an unknown must answer false and be admitted. (0 rows in
-- tr_officers carry a NULL `roles` today, which is exactly why this would never be noticed.)
CREATE OR REPLACE FUNCTION tr_role_is_professional_only(p_roles text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT p_roles IS NOT NULL
     AND p_roles ~ '^(liquidator|trustee|verifier)(,(liquidator|trustee|verifier))*$';
$$;

COMMENT ON FUNCTION tr_role_is_professional_only(text) IS
  'True when every role in a tr_officers.roles set is a court/creditor appointment '
  '(liquidator, trustee, verifier) — i.e. a leg nobody chose. NULL-tolerant by design.';

DROP FUNCTION IF EXISTS person_person_bridge(text, text, int);
CREATE OR REPLACE FUNCTION person_person_bridge(a text, b text, p_limit int DEFAULT 25)
RETURNS TABLE (
  bridge_name      text,
  bridge_companies int,
  a_eik            text,
  a_company        text,
  a_subject_roles  text,
  a_bridge_roles   text,
  a_body           int,
  b_eik            text,
  b_company        text,
  b_subject_roles  text,
  b_bridge_roles   text,
  b_body           int
)
LANGUAGE sql STABLE AS $$
  WITH qa AS (SELECT translit_bg_latin(a) AS f),
       qb AS (SELECT translit_bg_latin(b) AS f),
  -- Each subject's own companies AND their own role set there, ONE row per company. Both
  -- sides folded by NAME, exactly as connection_between does — this block is name-matched by
  -- design and its basis line says so out loud. Index-served by idx_tr_officers_fold_eq.
  a_leg AS (
    SELECT o.uic, tr_role_union(array_agg(o.roles)) AS subject_roles
    FROM tr_officers o CROSS JOIN qa WHERE o.name_fold = qa.f GROUP BY o.uic
  ),
  b_leg AS (
    SELECT o.uic, tr_role_union(array_agg(o.roles)) AS subject_roles
    FROM tr_officers o CROSS JOIN qb WHERE o.name_fold = qb.f GROUP BY o.uic
  ),
  -- The first leg of the chain: candidate bridges at A's companies, one row per
  -- (fold, company), past the three exclusions.
  a_side AS (
    SELECT ob.name_fold, min(ob.name) AS name, ob.uic,
           tr_role_union(array_agg(ob.roles)) AS bridge_roles
    FROM tr_officers ob
    JOIN a_leg ON a_leg.uic = ob.uic
    CROSS JOIN qa CROSS JOIN qb
    LEFT JOIN officer_name_counts c ON c.name_fold = ob.name_fold
    WHERE ob.name_fold <> qa.f
      AND ob.name_fold <> qb.f
      AND ob.name_fold <> ''
      AND ob.name_fold <> 'zalicheno obstoyatelstvo.'
      AND COALESCE(c.company_count, 1) <= 12
      -- A company both subjects sit in is a DIRECT hit; connection_between owns it.
      AND NOT EXISTS (SELECT 1 FROM b_leg x WHERE x.uic = ob.uic)
    GROUP BY ob.name_fold, ob.uic
  ),
  bridge AS (
    SELECT s.name_fold, min(s.name) AS name,
           COALESCE(min(c.company_count), 1)::int AS company_count
    FROM a_side s LEFT JOIN officer_name_counts c ON c.name_fold = s.name_fold
    GROUP BY s.name_fold
  ),
  -- The second leg: the same bridge at B's companies. The mirror of the direct-hit test is
  -- needed here and it is not symmetric-by-accident — without it a chain can END at a company
  -- A is also entered in, i.e. present the direct hit as an indirect one with a person
  -- spliced into the middle.
  b_side AS (
    SELECT ob.name_fold, ob.uic, tr_role_union(array_agg(ob.roles)) AS bridge_roles
    FROM tr_officers ob
    JOIN bridge br ON br.name_fold = ob.name_fold
    JOIN b_leg ON b_leg.uic = ob.uic
    WHERE NOT EXISTS (SELECT 1 FROM a_leg y WHERE y.uic = ob.uic)
    GROUP BY ob.name_fold, ob.uic
  ),
  pairs AS (
    SELECT br.name AS bridge_name, br.company_count,
           sa.uic AS a_eik, al.subject_roles AS a_subject_roles, sa.bridge_roles AS a_bridge_roles,
           sb.uic AS b_eik, bl.subject_roles AS b_subject_roles, sb.bridge_roles AS b_bridge_roles
    FROM bridge br
    JOIN a_side sa ON sa.name_fold = br.name_fold
    JOIN a_leg  al ON al.uic = sa.uic
    JOIN b_side sb ON sb.name_fold = br.name_fold
    JOIN b_leg  bl ON bl.uic = sb.uic
    WHERE sb.uic <> sa.uic
      -- All four legs — see exclusion 3 in the header.
      AND NOT tr_role_is_professional_only(al.subject_roles)
      AND NOT tr_role_is_professional_only(sa.bridge_roles)
      AND NOT tr_role_is_professional_only(sb.bridge_roles)
      AND NOT tr_role_is_professional_only(bl.subject_roles)
  ),
  sized AS (
    SELECT p.*,
           (SELECT count(DISTINCT t.name_fold) FROM tr_officers t
             WHERE t.uic = p.a_eik AND t.name_fold <> '')::int AS a_body,
           (SELECT count(DISTINCT t.name_fold) FROM tr_officers t
             WHERE t.uic = p.b_eik AND t.name_fold <> '')::int AS b_body
    FROM pairs p
  )
  SELECT s.bridge_name, s.company_count,
         s.a_eik, ca.name, s.a_subject_roles, s.a_bridge_roles, s.a_body,
         s.b_eik, cb.name, s.b_subject_roles, s.b_bridge_roles, s.b_body
  FROM sized s
  LEFT JOIN tr_companies ca ON ca.uic = s.a_eik
  LEFT JOIN tr_companies cb ON cb.uic = s.b_eik
  -- Tightest tie first: the smallest bodies, then the least-worn bridge name.
  ORDER BY s.a_body + s.b_body, s.company_count, s.bridge_name, s.a_eik, s.b_eik
  LIMIT LEAST(COALESCE(p_limit, 25), 100);
$$;

COMMENT ON FUNCTION person_person_bridge(text, text, int) IS
  'Second-degree Commerce-Registry connections: the people who bridge two names that share '
  'no company. Degree 2 ONLY (see the file header). Name-matched on BOTH ends — a lead, not '
  'proof.';

-- Role-guarded — roles_readonly.sql is a one-time manual step on Cloud SQL, and exec() sends
-- a migration as ONE transaction, so a bare GRANT would 42704 and roll the whole file back on
-- a database that never ran it.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION tr_role_union(text[]) TO app_readonly;
    GRANT EXECUTE ON FUNCTION tr_role_is_professional_only(text) TO app_readonly;
    GRANT EXECUTE ON FUNCTION person_person_bridge(text, text, int) TO app_readonly;
  END IF;
END $$;
