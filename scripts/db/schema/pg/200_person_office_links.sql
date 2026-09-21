-- person_office_links(name) / company_office_links(eik) — the REGISTRY basis for
-- „Политически връзки": a co-registered person who HOLDS PUBLIC OFFICE, with no
-- requirement that the shared company ever won public money.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- WHY THIS EXISTS. `person_politicians()` (082) and the „Политически връзки" block it feeds
-- read `company_politicians` (008), which is PROCUREMENT-derived: its arms INNER JOIN
-- contract money, so it holds 981 rows over ~347 EIKs. That is the right basis for „which
-- suppliers of the state are politically connected" and the wrong one for „is this person
-- co-registered with a politician" — and the block asks the second question.
--
-- The reference case: `/person/ГЕОРГИ ГЕОРГИЕВ МАНОЛОВ` published „Политически връзки (0)"
-- directly under a connection check that had just named **Антон Йорданов Адамов, народен
-- представител в 45 НС**, as a co-съдружник in TWO companies (ВИ 8 СТУДИОС 206325958,
-- ТЕАТРО ВАРНА 206440670). Neither company has ever won a public contract, so neither can
-- appear in `company_politicians` — the zero was structural, not an absence of links, and it
-- read as „no connection to politicians" on a page that had the connection on it.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- ⚠️⚠️ WHY THIS DOES NOT READ `person_role`, AND WHY THAT IS NOT LAZINESS.
--
-- The obvious implementation — join the identity layer's gated tr/ngo role set — returns
-- NOTHING for the reference case. Adamov's `person_role` holds exactly ONE tr row (БУЛГАРГАЗ
-- 175203485, bridge A, from the curated `linkedEiks`); Bridge B refused the other five
-- because his name fold spans SIX distinct companies and `FOOTPRINT_CAP` is 5.
--
-- That cap is a SIZE bound on how many companies get PERMANENTLY ATTACHED to a person in
-- `person_role`. It is not an identity test, and this question attaches nothing: it asks
-- whether one name appearing alongside the subject belongs to a known office-holder. Adamov
-- passes every guard that IS about identity — `name_parts = 3`, `is_public_figure`,
-- `status = 'active'`, exactly one `person` row on the fold, and `tr_name_fold_people
-- .people_n = 1` (the registry's own count, demanded as POSITIVE evidence exactly as
-- `bridgeB.ts` demands it). He fails only the cap.
--
-- So the guards below are Bridge B's identity guards applied at QUERY time, minus the
-- footprint cap. ⚠️ Do NOT "simplify" this by widening `FOOTPRINT_CAP` instead: that would
-- change what is ATTACHED to every person in the layer — the thing `bridgeB.ts`'s header
-- says must not move without its own measurement — to fix a question that never needed it.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- THE THREE GUARDS, and what each refuses.
--
--   • PEOPLE-UNIQUENESS — the fold must map to exactly ONE row of `person`. Over the WHOLE
--     table, not just public 3-part people: a fold shared with a private or 2-part person is
--     ambiguous too. Same anti-join, same scope, same reason as `BRIDGE_B_CTE`.
--   • REGISTRY-UNIQUENESS — `tr_name_fold_people.people_n = 1`, as `EXISTS (… = 1)` and NEVER
--     `NOT EXISTS (… > 1)`. The two differ exactly for a fold the counter has never observed,
--     and for those the second form silently means „assume one person". Unmeasured is not
--     evidence of uniqueness, and this is a surface that names a living politician.
--   • OFFICE HELD, not office sought. ⚠️ `is_public_figure` ALONE IS TOO BROAD and this is the
--     guard a reader would most likely have been given by accident. Measured 2026-09-21 over
--     the 28,097 public 3-part figures present in `tr_officers`, the largest office-ish
--     bucket is `candidate` at 7,578 people — merely having stood for election. „Политическа
--     връзка" resting on a 2007 candidacy is an overclaim about a named private individual.
--     `OFFICE_SOURCES` below therefore admits only HELD office and excludes:
--       `candidate`  never held anything;
--       `tr` / `ngo` registry roles, not offices — including them makes every co-owner a
--                    „political" link and the block circular;
--       `ds`         the Комисия по досиетата affiliation register — a historical fact about
--                    a person, not a public office, and a far graver thing to imply;
--       `public_sector` school / kindergarten / medical-centre / social-care managers. Public
--                    employment is not political office, and a head teacher rendered as a
--                    „политическа връзка" is the overclaim in its purest form.
--
-- Measured effect of the uniqueness pair: 28,097 public 3-part figures in `tr_officers` →
-- **8,238** identifiable office-holders, i.e. the guards refuse 70.7%.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- ASSOCIATION-NOISE GUARD, and it is the COMPANY's own count.
--
-- `officer_count <= MAX_CO_OFFICERS (6)` from `company_officer_counts`, the same threshold
-- and the same rationale as `person_connections()` (084): a company with more co-officers
-- than that is a board / professional association / кооперация, not a business tie. This
-- block is UN-PROMPTED — the reader typed nothing — so it needs the guard, unlike
-- `person_person_bridge` (192), which answers about a name the reader supplied and
-- deliberately drops it.
--
-- ⚠️ IT IS A COMPANY-LEVEL COUNT, NEVER `public_officer_count`. 084's header records what
-- that mistake cost: ЕИК 000703172, a 54-member федерация with 6 public officers, published
-- those 6 as each other's business connections because few of its members were public. The
-- rationale is a claim about the COMPANY.
--
-- Measured on the reference case: ВИ 8 СТУДИОС (2) and ТЕАТРО ВАРНА (4) pass; Хилс
-- Инвестмънт (9 officers, a 9-member АД board) is correctly dropped.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- ⚠️⚠️ NON-PERSONS MUST NOT BE HOPPED THROUGH, AND THIS IS THE BUG THIS FILE SHIPPED FIRST.
--
-- „Заличено обстоятелство." is the register's DELETED-FACT PLACEHOLDER and the LARGEST name
-- fold in the corpus (4,383 companies). It is an officer row at МЛГ ЕООД 113581389 — the
-- reference company — so the first cut of `company_office_links` hopped through it and
-- returned **74 links of which 72 were reached via the placeholder**: Айхан Ахмед Етем „чрез
-- Заличено обстоятелство.", and seventy more. Every one of those is a fabricated claim that a
-- named company is politically connected to a named politician, which is the single worst
-- thing either of these functions could emit.
--
-- The guard is `name_fold <> '' AND NOT tr_fold_is_placeholder(name_fold)`, per 192's helper,
-- and it is applied at EVERY hop and on the candidate — the two are different non-persons
-- („no name recorded" vs „a fact was deleted"), so each call site states both, exactly as
-- 192's own comment requires. `office_holder_by_fold` carries it too: a `person` row is not
-- supposed to exist on the placeholder fold, and relying on that is relying on the identity
-- layer to stay clean rather than saying so here.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- `company_office_links` IS DEGREE 2, AND MUST NOT BECOME RECURSIVE.
--
-- The DIRECT question — „is anyone registered at THIS company an office-holder?" — is already
-- answered by the existing „Пряка политическа връзка" block, and for МЛГ ЕООД the answer is
-- honestly 0. This function answers the INDIRECT one: this company's people → their other
-- companies → office-holders there. That is what connects МЛГ to Adamov through Manolov.
--
-- Degree 2 only, for 192's reasons: reachable companies grow ~5x per hop (7 → 55 → 266 →
-- 1,435 from an ordinary subject), and more importantly at degree 2 the payload is a set of
-- registry rows a reader can check in the Търговски регистър themselves, while at degree 3 it
-- is a claim about a graph. Both functions return the bridge person and the company, so every
-- row is checkable.
--
-- Name-fold identity: treat every row as a LEAD. The payload carries `basis` so no consumer
-- can drop the caveat, exactly as 084 bakes its disclaimer in.
--
-- Depends on tr_officers / tr_companies (003), person / person_role (081),
-- tr_name_fold_people (148), company_officer_counts (071), translit_bg_latin (000),
-- tr_fold_is_placeholder (192).
-- EXECUTE auto-granted to app_readonly via ALTER DEFAULT PRIVILEGES (roles_readonly.sql).
--
-- ⚠️ APPLIED BY NO LOADER. Ship it by name, and note it reads `tr_name_fold_people`, whose
-- only loader is `db:load:tr-name-fold-people:pg`:
--   npx tsx scripts/db/apply_functions.ts 200_person_office_links.sql
--
-- Plan: docs/plans/consortium-member-visibility-v1.md §6 (this closes that deferral).

SET check_function_bodies = off;

-- The HELD-OFFICE sources. A person qualifies on ANY of them; `candidate`, `tr`, `ngo`, `ds`
-- and `public_sector` are excluded for the reasons in the header. Kept as an IMMUTABLE
-- function rather than inlined twice so the two functions below cannot drift.
DROP FUNCTION IF EXISTS office_link_sources();
CREATE OR REPLACE FUNCTION office_link_sources()
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ARRAY['mp', 'mep', 'president', 'local', 'official_exec', 'official_muni',
               'magistrate', 'regulator', 'diplomat']::text[]
$$;

-- One office-holder identified by name fold, with the offices they hold. `offices` is
-- aggregated so a consumer can print „народен представител · директор в държавно
-- предприятие" rather than asserting a single role.
DROP FUNCTION IF EXISTS office_holder_by_fold(text);
CREATE OR REPLACE FUNCTION office_holder_by_fold(p_fold text)
RETURNS TABLE(person_id bigint, slug text, display_name text, offices jsonb)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT p.person_id, p.slug, p.display_name,
         (SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
                   'source', r.source, 'role', r.role, 'party', r.party)), '[]'::jsonb)
            FROM person_role r
           WHERE r.person_id = p.person_id
             AND r.source = ANY (office_link_sources())) AS offices
    FROM person p
   WHERE p.name_fold = p_fold
     -- Non-persons first: see the header. A `person` row should never exist on either fold,
     -- but saying so here is cheaper than trusting the identity layer to stay clean.
     AND p_fold <> ''
     AND NOT tr_fold_is_placeholder(p_fold)
     AND p.is_public_figure
     AND p.status = 'active'
     AND p.name_parts = 3
     -- people-uniqueness, over the WHOLE table
     AND NOT EXISTS (SELECT 1 FROM person p2
                      WHERE p2.name_fold = p.name_fold AND p2.person_id <> p.person_id)
     -- registry-uniqueness, as POSITIVE evidence
     AND EXISTS (SELECT 1 FROM tr_name_fold_people f
                  WHERE f.name_fold = p.name_fold AND f.people_n = 1)
     -- office HELD
     AND EXISTS (SELECT 1 FROM person_role r
                  WHERE r.person_id = p.person_id
                    AND r.source = ANY (office_link_sources()))
$$;

-- ── The person page's arm ────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS person_office_links(text);
CREATE OR REPLACE FUNCTION person_office_links(p_name text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH me AS (SELECT translit_bg_latin(p_name) AS f),
mine AS (
  SELECT DISTINCT o.uic FROM tr_officers o CROSS JOIN me WHERE o.name_fold = me.f
),
-- Co-officers at the subject's own companies, association-noise guard applied on the
-- COMPANY's officer count.
co AS (
  SELECT o.uic, o.name_fold, min(o.name) AS reg_name, min(o.roles) AS roles
    FROM mine m
    JOIN tr_officers o ON o.uic = m.uic
    JOIN company_officer_counts c ON c.uic = m.uic
    CROSS JOIN me
   WHERE o.name_fold <> me.f
     AND o.name_fold <> ''
     AND NOT tr_fold_is_placeholder(o.name_fold)
     AND c.officer_count <= 6
   GROUP BY o.uic, o.name_fold
),
hits AS (
  SELECT h.slug, h.display_name, h.offices, co.uic, co.reg_name, co.roles,
         tc.name AS company
    FROM co
    CROSS JOIN LATERAL office_holder_by_fold(co.name_fold) h
    LEFT JOIN tr_companies tc ON tc.uic = co.uic
)
SELECT jsonb_build_object(
  'links', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.display_name, t.company)
                       FROM (SELECT slug, display_name, offices, uic,
                                    reg_name AS "registryName", roles, company
                               FROM hits LIMIT 100) t), '[]'::jsonb),
  'count', (SELECT count(*) FROM hits),
  -- Baked in so no consumer can render the links without the caveat, and so the two blocks
  -- on the page cannot be read as the same basis. 084's pattern.
  'basis', 'registry'
)
$$;

-- ── The company page's INDIRECT arm ──────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS company_office_links(text);
CREATE OR REPLACE FUNCTION company_office_links(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH own AS (
  -- The people registered at THIS company. No noise guard here: they are the subject.
  -- ⚠️ The BRIDGE guard. Without it the placeholder — an officer row at the reference
  -- company itself — links it to every company the placeholder appears in: 72 of 74 rows.
  SELECT DISTINCT o.name_fold, o.name FROM tr_officers o
   WHERE o.uic = p_eik
     AND o.name_fold <> ''
     AND NOT tr_fold_is_placeholder(o.name_fold)
),
-- Their OTHER companies. The noise guard applies to the company being hopped THROUGH.
hop AS (
  SELECT own.name_fold AS via_fold, min(own.name) AS via_name, o.uic
    FROM own
    JOIN tr_officers o ON o.name_fold = own.name_fold AND o.uic <> p_eik
    JOIN company_officer_counts c ON c.uic = o.uic
   WHERE c.officer_count <= 6
   GROUP BY own.name_fold, o.uic
),
co AS (
  SELECT hop.via_fold, hop.via_name, hop.uic, o.name_fold, min(o.name) AS reg_name,
         min(o.roles) AS roles
    FROM hop
    JOIN tr_officers o ON o.uic = hop.uic AND o.name_fold <> hop.via_fold
   WHERE o.name_fold <> ''
     AND NOT tr_fold_is_placeholder(o.name_fold)
   GROUP BY hop.via_fold, hop.via_name, hop.uic, o.name_fold
),
hits AS (
  SELECT h.slug, h.display_name, h.offices, co.uic, co.reg_name, co.roles,
         co.via_name, tc.name AS company
    FROM co
    CROSS JOIN LATERAL office_holder_by_fold(co.name_fold) h
    LEFT JOIN tr_companies tc ON tc.uic = co.uic
)
SELECT jsonb_build_object(
  'links', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.display_name, t.company)
                       FROM (SELECT slug, display_name, offices, uic,
                                    reg_name AS "registryName", roles, company,
                                    via_name AS "viaName"
                               FROM hits LIMIT 100) t), '[]'::jsonb),
  'count', (SELECT count(*) FROM hits),
  'basis', 'registry-indirect'
)
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION office_link_sources() TO app_readonly;
    GRANT EXECUTE ON FUNCTION office_holder_by_fold(text) TO app_readonly;
    GRANT EXECUTE ON FUNCTION person_office_links(text) TO app_readonly;
    GRANT EXECUTE ON FUNCTION company_office_links(text) TO app_readonly;
  ELSE
    RAISE WARNING 'role app_readonly is absent — GRANTs skipped; /api/db will 42501 on these functions until db:pg:bootstrap runs and this file is re-applied';
  END IF;
END $$;
