-- A company's links to people in public office, served live from the gated person layer —
-- the replacement for the `parliament/company-connections/{eik}.json` shard family (16,609
-- bucket objects) that the AI chat's `companyConnections` tool read.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- WHY THIS EXISTS AT ALL: THE SHARDS WERE FROZEN, NOT MERELY SLOW.
--
-- `bucket_sync_paths.ts` excluded that tree from sync, and `gsutil rsync -x` excludes a match
-- from DELETION as well as from upload while `syncPaths` passes `-x` together with `-d`. So the
-- objects sat at their 2026-07-29 vintage and the tool answered company questions from that
-- snapshot at a 200, with nothing red anywhere. An exclusion FREEZES a tree; it never retires
-- one. (CLAUDE.md says this at the exclusion site; this file is the fix it names.)
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- THIS IS NOT A PORT OF `build_company_connections.ts`, AND THE ANSWER CHANGES.
--
-- The builder joined TR officers to a power roster BY NORMALISED NAME, with one guard:
-- `isUniqueName` — the name must appear in exactly ONE company in the whole registry. That is a
-- proxy for "is this one human", written before anything could measure it, and it is wrong in
-- both directions. It DROPS a genuine businessman-politician the moment they hold a second
-- company (the common case for exactly the people this tool is about), and it ADMITS any
-- single-company namesake of a common Bulgarian name. Its `confidence` was `medium` when the
-- name had three parts and `low` otherwise — a name-shape test wearing the word confidence.
--
-- Here the DIRECT arm is `person_role` at source tr/ngo: the set `resolve_persons` mints
-- through Bridge A/B and gates on `tr_name_fold_people` (148), which counts the DISTINCT
-- PEOPLE the Commerce Registry itself records under a name fold. Nothing is recomputed — it is
-- inherited whole, the same set 150 (`mp_tr_roles`) and 151 (`place_mp_companies`) publish, so
-- the chat and the /person profile cannot disagree about one named person. That refusal is what
-- CLAUDE.md means by "the PG functions refuse a shared name rather than grading it".
--
-- Measured 2026-08-16, local corpus, against the 19,232 shard files on disk:
--
--                                    shards        this file
--   companies with a DIRECT link      3,843            9,982
--   companies answerable at all      19,232           26,047
--
-- Wider on BOTH arms, despite refusing the 410 shared-name attributions, because the person
-- layer's public population is far larger than the builder's three roster files (MPs +
-- executive + municipal) and because the fold gate replaces a one-company straitjacket with an
-- actual people count. So "fewer links for some EIKs" is true per-EIK and false in aggregate;
-- both facts belong in the record.
--
-- ⚠️ `COMMON_NAME_TR_ROWS = 11` IS NOT REVIVED HERE. It counted officer ROWS as a proxy for
-- "is this name one person" and is wrong in both directions; 150's header deletes it and this
-- file does not bring it back. Do not reintroduce a row-count heuristic beside a people count.
--
-- ⚠️ THE NUMBER 25 DOES COME BACK, FOR A DIFFERENT JOB — read the distinction, it matters.
-- The builder's `NAMESAKE_CAP = 25` bounded the bridge because a common name explodes into
-- namesake noise; that job now belongs to `people_n` and is done properly. What survives at 25
-- is `BRIDGE_MAX_COMPANIES` below, which bounds nothing about identity: with people_n = 1 the
-- registry is telling us one human really does hold all 132 of those companies. It is a SIGNAL
-- bound — a person holding scores of companies is a registered agent, and "your company shares
-- an officer with a company where a councillor sits" is not a fact about you when the shared
-- officer is on 132 boards. Same shape as 084's association-noise guard (MAX_CO_OFFICERS = 6),
-- one hop over.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- THE BRIDGED ARM SURVIVES THE MOVE — AND IT HAD TO BE CHECKED, NOT ASSUMED.
--
-- 16,188 of the 19,232 shard files (84%) carry ONLY bridged links, so dropping the second hop
-- would have taken the tool from 19,232 answerable companies to 9,982 while every remaining
-- answer also changed. It is expressible here and strictly better gated:
--
--   company → officer fold F (people_n = 1) → another company Y → an office-holder at Y
--
-- The builder's second hop rested on a name appearing in ≤ 25 companies. Here hop 1 is the
-- registry's own people count (F is one human, or the fold is refused), and hop 2's endpoint is
-- the SAME gated `person_role` set the direct arm uses. Both hops are now identity claims the
-- registry backs, rather than one heuristic stacked on another.
--
-- The bridge is bounded at BRIDGE_MAX_COMPANIES (25) for the signal reason above, and the
-- bound is REPORTED rather than applied silently: `bridgeMaxCompanies` and
-- `bridgeFoldsSuppressed` ride in the payload, so a consumer can say how many of this
-- company's officers were too busy to traverse. Measured coverage, companies answerable at all:
-- no cap 29,959 · span<=50 27,272 · span<=25 26,047 · span<=10 23,627 · direct only 9,982. 25
-- keeps 35% more companies answerable than the shard family it replaces while dropping the
-- registered-agent tail; only 335 of 400,784 single-person folds exceed it.
--
-- ⚠️ IT IS STILL A SECOND-DEGREE LINK AND MUST NEVER BE RENDERED AS A FIRST-DEGREE ONE. The
-- payload keeps the two arms in SEPARATE arrays with separate counts for that reason — a single
-- merged list with a `confidence` column is exactly how the shards let a two-hop coincidence
-- read as a finding. What the arm licenses is "an officer of this company also sits at a
-- company where X sits", nothing more.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- WHAT REPLACED `confidence`.
--
-- Nothing grades a link on a scale here, because the scale the shards used measured name
-- SHAPE. The direct arm carries `linkBasis` — the same two words 082 and 150 put on the
-- profile's company list, from the same `person_company_bridge_a` view, so one company cannot
-- be 'declared' on one surface and 'name_match' on another:
--
--   declared    a curated register (declared interests / ИВСС чл. 175а) put this COMPANY on
--               this person. ⚠️ NOT a confirmed identity — Bridge A keeps the TR officers on an
--               independently-linked EIK whose name matches, so the officer row inside it is
--               still a name match. Much stronger than a bare fold hit; not proof. (148 §0.2.)
--   name_match  found by name, through a fold the registry says is one person.
--
-- The bridged arm has no `linkBasis`: `person_company_bridge_a` answers "is THIS person's link
-- to THIS company curated", and the bridged person's link is to the VIA company, not to the
-- subject. Publishing a basis there would attribute the via-company's provenance to a company
-- the register never connected them to. It carries `bridgeCompanies` instead — how many
-- companies the bridge person holds, which is the reader's actual question about how tight the
-- path is, and which is why the arm is ORDERED by it ascending.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- WHAT A REFUSAL ACTUALLY LOOKS LIKE, SO IT IS NOT MISREAD AS A BUG.
--
-- Sampled 60 shard companies 2026-08-16: 44 answered by both, 16 by the shards only, 0 lost
-- the other way (the sample is drawn FROM shard files, so it cannot show the ~6.8k companies
-- only this function answers). Direct links over that sample went 18 → 26; bridged 124 → 114.
--
-- Worked example of a refusal, because the mechanism is not obvious. `КРЕАТИВ` (118578685) has
-- one officer, Димитричка Христова Ганчева-Панова, who is a real, active, public chief
-- architect with a person row — and this function returns nothing for it. Her name fold has NO
-- row in `tr_name_fold_people`: it was never observed in the daily feed's window, which is
-- UNMEASURED, not unique. The resolver therefore never minted her a `person_role` at source
-- tr, and the direct arm inherits that. Fail-closed on an unmeasured fold is 148's stated
-- three-state rule and the whole reason the artifact stores all ~531k folds instead of only the
-- shared ones. Coverage is 90.6% of folds today and 148 says it will FALL, because the CR Deeds
-- arm publishes no identity key at all — so this class of refusal grows, and it is the safe
-- direction.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- COST, MEASURED — AND THE REWRITE THAT GOT IT THERE.
--
-- Warm, local: 963 buffers / 7 ms for a company with no links, 1,927 / 8.8 ms for a busy real
-- one (831646048, 13 direct + 11 bridged), 12,301 / 14 ms at the worst post-cap fan-out
-- (204332614). Comfortably inside a chat tool call.
--
-- ⚠️ THE FIRST DRAFT WAS 987 ms AND ~17,500 BUFFERS WITH A TEMP SPILL, and the shape of that
-- mistake is worth keeping. It opened with an `office` CTE that resolved every office-holder in
-- the corpus and then filtered down to this company — so the expensive half did not depend on
-- `p_eik` at all, and a company with NO links paid the same 987 ms as the busiest one. That is
-- exactly the defect 084's header records for `person_connections` (a whole-corpus officer map
-- rebuilt per request, 96.5% of its buffers, on a path whose traffic is a crawler walking
-- profiles). The fix, there and here, was to re-order rather than to add an object: resolve the
-- candidate person_ids from this company FIRST, then look each one's office up by primary key.
-- Every CTE below is subject-scoped for that reason; do not hoist one out.
--
-- Applied, never loaded (CLAUDE.md, "SQL functions and indexes"). No table, no loader, nothing
-- to go stale: every input is read live.
--   npx tsx scripts/db/apply_functions.ts 148_person_company_basis.sql 158_company_political_links.sql
--
-- ⚠️ 148 IS A HARD PREREQUISITE and must come first in that command. The body SELECTs
-- `person_company_bridge_a` and `tr_name_fold_people`, and a LANGUAGE sql body is validated at
-- CREATE time, so applying this against a database without 148 fails the WHOLE file with 42P01
-- — the 081→082 trap CLAUDE.md documents, and the same one 150's header carries.
--
-- 151's `idx_person_role_tr_ref_person` is what makes the bridged arm servable: it carries the
-- gated predicate IN the index with `person_id` as a payload column, so the per-via-company
-- lookup is index-only. It is created there, not here, and this file does not duplicate it.

-- ---------------------------------------------------------------------------
-- The office floor, named once
-- ---------------------------------------------------------------------------
-- Which `person_role` sources count as HOLDING PUBLIC OFFICE, as opposed to being a fact about
-- a person (a ДС file, a sanctions listing), a candidacy that may have lost, or a private-sector
-- role. Expressed as a floor on `role_prominence` (120) rather than as a source list, so the one
-- ordering the whole person layer sorts by is also the one that answers this — a second list
-- would be a second answer, and the two would drift.
--
-- 42 is the boundary the ladder already draws: `historic_mp` (42) sits directly above `ds` (40)
-- and `sanctions` (38) precisely because, in 120's own words, it "is an OFFICE and outranks the
-- two registers below it, which are facts ABOUT a person rather than posts they held".
--
-- ⚠️ THAT MAKES THIS A COUPLING, NOT A DERIVATION. Nothing in `role_prominence` declares 42 to
-- be an office boundary; a new source slotted at 43 for ranking reasons would silently join the
-- office set here. `company_political_links.data.test.ts` therefore pins the office-ness of
-- EVERY `person_source.key` in an explicit table, so such a change goes red instead of shipping.
CREATE OR REPLACE FUNCTION person_role_is_office(p_source text, p_role text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT role_prominence(p_source, p_role) >= 42;
$$;

COMMENT ON FUNCTION person_role_is_office(text, text) IS
  'Does this person_role source/role denote a public OFFICE (as opposed to a candidacy, a '
  'register entry about a person, or a private-sector role)? A floor on role_prominence.';

CREATE OR REPLACE FUNCTION company_political_links(p_eik text, p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH args AS (
    SELECT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200) AS lim,
           -- BRIDGE_MAX_COMPANIES. Named once, here; see the header for why it is a signal
           -- bound and not the namesake guard it looks like.
           25 AS bridge_cap
  ),
  -- ⚠️ EVERY CTE BELOW IS SUBJECT-SCOPED, AND THE ORDER IS THE WHOLE PERFORMANCE STORY.
  -- The first draft opened with an `office` CTE that resolved every office-holder in the
  -- corpus and then filtered it to this company: 987 ms and ~17,500 buffers with a temp spill,
  -- paid IN FULL by a company with no links at all, because the expensive half did not depend
  -- on p_eik. That is precisely the defect 084's header records — `person_connections` rebuilt
  -- a whole-corpus officer map per request, 96.5% of its buffers, and was fixed by a rewrite
  -- rather than a new object. So: find the candidate person_ids from this company FIRST, then
  -- look each one's office up by primary key. Same answer, ~40 buffers.

  -- ── DIRECT candidates: registry roles AT this company ────────────────────────────────────
  direct_role AS (
    SELECT r.person_id, r.role
      FROM person_role r
     WHERE r.ref = p_eik
       AND r.source IN ('tr', 'ngo')
       AND r.confidence IN ('exact_id', 'high', 'manual')
  ),
  -- ── BRIDGED candidates: officer of this company → their other companies → someone there ──
  -- Hop 1's identity claim, gated on the registry's own people count. `people_n > 1` is a
  -- proven namesake collision and an ABSENT row is "never observed in the feed's window" —
  -- unmeasured, NOT unique — so the inner join refuses both. Treating absence as uniqueness is
  -- the fail-open direction 148's three-state note exists to prevent.
  bridge_fold AS (
    SELECT t.name_fold,
           -- The readable spelling, pinned rather than picked: TR spells one person several
           -- ways across filings and min() makes the exemplar stable between two calls.
           min(t.name) AS bridge_name
      FROM tr_person_roles t
      JOIN tr_name_fold_people f ON f.name_fold = t.name_fold AND f.people_n = 1
     WHERE t.uic = p_eik
     GROUP BY t.name_fold
  ),
  -- The bridge person's whole footprint. With people_n = 1 the registry says this really is one
  -- human holding them all, so this is not an identity guard — it is the signal bound (and the
  -- ordering key: a two-company bridge is a tie, a 284-company one is a registered agent).
  bridge_span AS (
    SELECT bf.name_fold, bf.bridge_name, count(DISTINCT t2.uic)::int AS n_companies
      FROM bridge_fold bf
      JOIN tr_person_roles t2 ON t2.name_fold = bf.name_fold
     GROUP BY bf.name_fold, bf.bridge_name
  ),
  via AS (
    SELECT bs.bridge_name, bs.n_companies, t2.uic AS via_uic
      FROM bridge_span bs
      JOIN tr_person_roles t2 ON t2.name_fold = bs.name_fold
      CROSS JOIN args
     WHERE t2.uic <> p_eik
       AND bs.n_companies <= args.bridge_cap
     GROUP BY 1, 2, 3
  ),
  bridged_raw AS (
    SELECT v.via_uic, v.bridge_name, v.n_companies, r.person_id
      FROM via v
      -- 151's idx_person_role_tr_ref_person carries the gated predicate IN the index with
      -- person_id as a payload column, so this is index-only per via company.
      JOIN person_role r ON r.ref = v.via_uic
       AND r.source IN ('tr', 'ngo')
       AND r.confidence IN ('exact_id', 'high', 'manual')
      -- The bridge fold itself is not a path: if the office-holder is the officer we bridged
      -- THROUGH, the link is direct at this company or it is nothing.
     WHERE r.person_id NOT IN (SELECT person_id FROM direct_role)
     GROUP BY 1, 2, 3, 4
  ),
  -- ── The office gate, applied ONCE to the candidate set ───────────────────────────────────
  cand AS (
    SELECT person_id FROM direct_role
    UNION
    SELECT person_id FROM bridged_raw
  ),
  -- Eligibility is read LIVE off `person`, never off a snapshot, so someone flipped out of
  -- 'active' or de-flagged as a public figure drops out of every arm immediately — the privacy
  -- contract 084's header spells out. The clause mirrors 150's, which mirrors 082's `pick`
  -- gate: a person whose TR roles this function published but whose /person/:slug returned
  -- nothing would be the two surfaces disagreeing again, in the one direction that matters.
  elig AS (
    SELECT p.person_id, p.slug, p.display_name
      FROM cand c
      JOIN person p ON p.person_id = c.person_id
     WHERE p.status = 'active'
       AND (p.is_public_figure
            OR p.identity_confidence IN ('verified', 'shared_name'))
  ),
  -- One office per person — the most prominent, tie-broken to the last column so two identical
  -- calls cannot label the same human differently. A payload a reader may screenshot. A
  -- candidate with no office role at all simply has no row here and drops out of both arms.
  top_office AS (
    SELECT DISTINCT ON (r.person_id)
           r.person_id, e.slug, e.display_name, r.source, r.role,
           role_prominence(r.source, r.role) AS prom
      FROM elig e
      JOIN person_role r ON r.person_id = e.person_id
     WHERE r.confidence IN ('exact_id', 'high', 'manual')
       AND person_role_is_office(r.source, r.role)
     ORDER BY r.person_id, role_prominence(r.source, r.role) DESC, r.source, r.role
  ),
  direct AS (
    SELECT dr.person_id,
           jsonb_agg(DISTINCT dr.role) AS roles,
           bool_or(ba.person_id IS NOT NULL) AS declared
      FROM direct_role dr
      JOIN top_office o ON o.person_id = dr.person_id
      LEFT JOIN person_company_bridge_a ba
             ON ba.person_id = dr.person_id AND ba.uic = p_eik
     GROUP BY dr.person_id
  ),
  -- ONE ROW PER PERSON, not per path. The reader's question is "who in public office is this
  -- company connected to"; the same person reached through four companies is one answer with
  -- four supporting paths, and four rows of it crowds out three other people. The exemplar is
  -- the TIGHTEST path — fewest companies on the bridge — with `pathCount` keeping the rest
  -- visible rather than silently dropped.
  bridged AS (
    SELECT DISTINCT ON (b.person_id)
           b.person_id, b.bridge_name, b.n_companies, b.via_uic,
           count(*) OVER (PARTITION BY b.person_id)::int AS path_count
      FROM bridged_raw b
      JOIN top_office o ON o.person_id = b.person_id
     ORDER BY b.person_id, b.n_companies, b.via_uic
  ),
  direct_rows AS (
    SELECT jsonb_build_object(
             'slug',         o.slug,
             'name',         o.display_name,
             'office',       ps.label_bg,
             'officeSource', o.source,
             'officeRole',   o.role,
             'roles',        d.roles,
             'linkBasis',    CASE WHEN d.declared THEN 'declared' ELSE 'name_match' END
           ) AS j,
           o.prom, o.display_name AS nm, o.slug AS sl
      FROM direct d
      JOIN top_office o     ON o.person_id = d.person_id
      JOIN person_source ps ON ps.key = o.source
  ),
  bridged_rows AS (
    SELECT jsonb_build_object(
             'slug',         o.slug,
             'name',         o.display_name,
             'office',       ps.label_bg,
             'officeSource', o.source,
             'officeRole',   o.role,
             'bridgeName',   b.bridge_name,
             'bridgeCompanies', b.n_companies,
             'viaEik',       b.via_uic,
             'viaCompany',   vc.name,
             'pathCount',    b.path_count
           ) AS j,
           b.n_companies AS span, o.prom, o.display_name AS nm, o.slug AS sl
      FROM bridged b
      JOIN top_office o     ON o.person_id = b.person_id
      JOIN person_source ps ON ps.key = o.source
      LEFT JOIN tr_companies vc ON vc.uic = b.via_uic
  ),
  co AS (SELECT name, legal_form, status FROM tr_companies WHERE uic = p_eik)
  SELECT jsonb_build_object(
    'eik',        p_eik,
    'name',       (SELECT name FROM co),
    'legalForm',  (SELECT legal_form FROM co),
    'status',     (SELECT status FROM co),
    -- Registry officer ROWS at this company, which is what the shard's `officers` array
    -- counted. Not people: one human holding two capacities is two rows.
    'officerRowCount', (SELECT count(*)::int FROM tr_person_roles WHERE uic = p_eik),
    -- True totals, always over the whole answer — the arrays below are capped and these are
    -- how a consumer knows it. (CLAUDE.md: no silent caps.)
    'directCount',     (SELECT count(*)::int FROM direct),
    'bridgedCount',    (SELECT count(*)::int FROM bridged),
    'bridgedPathCount',(SELECT COALESCE(sum(path_count), 0)::int FROM bridged),
    -- The bound, and what it cost HERE. Reported per company rather than assumed from the
    -- header, so an answer that traversed nothing because every officer is a registered agent
    -- is distinguishable from one where the company simply has no second-degree link.
    'bridgeMaxCompanies',    (SELECT bridge_cap FROM args),
    'bridgeFoldsSuppressed', (SELECT count(*)::int FROM bridge_span
                               CROSS JOIN args WHERE n_companies > args.bridge_cap),
    'directTruncated', (SELECT count(*) FROM direct)  > (SELECT lim FROM args),
    'bridgedTruncated',(SELECT count(*) FROM bridged) > (SELECT lim FROM args),
    'direct', COALESCE((
      SELECT jsonb_agg(j ORDER BY prom DESC, nm, sl)
        FROM (SELECT * FROM direct_rows ORDER BY prom DESC, nm, sl
               LIMIT (SELECT lim FROM args)) x), '[]'::jsonb),
    -- Tightest bridge first, then office prominence — a two-company bridge to a councillor is a
    -- better answer than a 25-company one to a minister, and putting prominence first would
    -- fill the visible rows with the busiest bridges the cap still admits.
    'bridged', COALESCE((
      SELECT jsonb_agg(j ORDER BY span, prom DESC, nm, sl)
        FROM (SELECT * FROM bridged_rows ORDER BY span, prom DESC, nm, sl
               LIMIT (SELECT lim FROM args)) x), '[]'::jsonb)
  );
$$;

COMMENT ON FUNCTION company_political_links(text, int) IS
  'A company''s links to office-holders, from the gated person layer: direct registry roles '
  'plus a one-hop bridge through an officer whose name fold the registry says is one person. '
  'Replaces the frozen parliament/company-connections shard family.';

-- Role-guarded, not bare — `roles_readonly.sql` is a one-time manual step on Cloud SQL, and
-- exec() sends a migration as ONE transaction, so a bare GRANT on a database that never ran it
-- raises 42704 and rolls back the functions too, leaving nothing at all. (150's note; CLAUDE.md
-- under db:pg:bootstrap.)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION person_role_is_office(text, text) TO app_readonly;
    GRANT EXECUTE ON FUNCTION company_political_links(text, int) TO app_readonly;
  END IF;
END $$;
