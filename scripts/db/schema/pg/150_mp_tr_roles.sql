-- The MP's Commerce-Registry management roles, served live — the replacement for the
-- static `parliament/mp-management/{mpId}.json` shard family.
-- Plan: docs/plans/mp-tr-edges-pg-v1.md §4 Tier 1, as revised by
--       docs/plans/data-hub-lateral-edges-v1.md §11.10.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- THIS IS A FUNCTION, NOT A TABLE, AND THAT IS THE WHOLE DESIGN.
--
-- Both earlier drafts of this migration created a `mp_tr_role` table with its own loader and
-- its own confidence model. Both were wrong, for the same reason: the question "which
-- companies may we attribute to this public figure" is ALREADY answered, once, by
-- `person_role` at source tr/ngo — the set `resolve_persons` mints through Bridge A/B and
-- gates on `tr_name_fold_people` (148). A second table would be a second answer.
--
-- That matters more here than it usually does, because `MpManagementRoles` and
-- `PersonCompanies` are the two surfaces that list one person's companies — mutually exclusive
-- branches of CandidateScreen rather than literally one page, but a reader reaching the same
-- person by either route must not be told two different things. A table minted by a different
-- rule would have them disagree about which companies belong to one named person, which
-- tr-attribution-basis-v1 §0.2 calls the worst defect this family can carry, and which it had
-- just finished removing from the other branch.
--
-- ⚠️ SAME SET, DIFFERENT PARTITION — do not read "the same as the companies list" too
-- literally. 082 SPLITS the gated set in two: `companies` holds source 'tr' and `ngos` holds
-- source 'ngo'. This function returns both in one list, because the shard it replaces listed
-- читалище trusteeships beside company directorships and that is what the block is for.
-- Measured 2026-08-12: 616 of 1,966 published role rows (31.3%) are ngo-sourced, i.e. they
-- appear in 082's `ngos` array and NOT in its `companies` array. So the invariant to hold — and
-- what mp_tr_roles.data.test.ts actually asserts — is equality with the UNION of the two, never
-- with `companies` alone. An earlier draft of this comment claimed the latter and was wrong.
--
-- So: no table, no loader, no ORDER_PAIRS entry, nothing to go stale. This file is applied,
-- never loaded (CLAUDE.md, "SQL functions and indexes").
--
-- ⚠️ 148 IS A HARD PREREQUISITE, not merely an ordering preference. The body SELECTs
-- `person_company_bridge_a` (a view 148 owns) and is LANGUAGE sql, which Postgres validates at
-- CREATE time — so applying 150 to a database without 148 fails the WHOLE file with 42P01, the
-- same trap 148's own header carries about 082/120 and CLAUDE.md documents for 070→116 and
-- 081→082. Ship a body change with both, 148 first:
--   npx tsx scripts/db/apply_functions.ts 148_person_company_basis.sql 150_mp_tr_roles.sql
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- WHAT CHANGES FOR A READER, STATED PLAINLY.
--
-- The static shards published 2,014 (MP, company) pairs across 896 MPs. This publishes 1,313
-- pairs / 1,966 role rows across 755 MPs (measured 2026-08-12; 73 roles are `declared`).
-- 1,367 of the 2,122 servable MPs get an empty list. The ~700 pairs that stop appearing are
-- not lost data —
-- they are attributions the Commerce Registry's own person key says rest on a name belonging
-- to more than one human. 121 of those 896 MPs have such a name; „ГЕОРГИ ИВАНОВ ГЕОРГИЕВ"
-- is 135 distinct people. The rest of the site stopped making that claim when
-- tr-attribution-basis-v1 shipped; this file is what stops the MP profile making it too.
--
-- Refusal covers BOTH `people_n > 1` and a fold absent from the table — "never observed" is
-- not "unique", and treating it as unique is the fail-open direction (148's three-state note).
-- Nothing here re-implements that rule: it is inherited whole from `person_role`.
--
-- ⚠️ AND THAT INHERITANCE IS A RESOLVE-TIME PROPERTY, NOT A LIVE READ — unlike the `status`
-- check below, which is live. The refusal was decided when `db:resolve:persons` last ran, so
-- between a `tr:count-people` + `db:load:tr-name-fold-people:pg` that moves a fold from 1 to 2
-- and the next resolve, this function keeps publishing on the old answer. The gap closes on
-- the resolve, and nothing reports it in the meantime: `person.fold_people_n` is stamped by
-- that same resolver, so a test comparing the two finds them agreeing while both are stale.
-- mp_tr_roles.data.test.ts therefore joins `tr_name_fold_people` DIRECTLY rather than trusting
-- the stamped column, which is what makes the drift visible instead of self-consistent.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- WHAT WAS DELIBERATELY NOT PORTED: `COMMON_NAME_TR_ROWS = 11`.
--
-- The shards' guard suppressed a name carrying 11+ officer ROWS in TR. It was a proxy for
-- "is this name one person", written before anything could measure that — and it is wrong in
-- both directions. It over-suppresses: an MP with a rare name loses their whole medium set
-- because one busy registered agent shares it. It under-suppresses: 11 officer rows is not
-- 11 people, and a name held by two people with six companies each sails through. The
-- registry now answers the real question directly, so the proxy is deleted rather than
-- carried. Do not reintroduce a row-count heuristic beside a people count.

-- `mp_id` is the parliament.bg profile id. `person_role.ref` at source 'mp' carries TWO
-- shapes — a bare `3011` and a per-term `3011:44` — so every join onto it must
-- split_part(…, ':', 1) or it silently sees only the bare half. That is
-- reference_mp_id_not_person_key, and it cost this plan a wrong overlap measurement once
-- already (827 pairs vs the true 1,294 at the time).
-- ⚠️ THIS INDEX IS NOT OPTIONAL, AND IT LIVES HERE RATHER THAN IN 081 ON PURPOSE.
--
-- `person_role.ref` at source 'mp' carries two shapes, so the lookup is on an EXPRESSION —
-- and `idx_person_role_source_ref` cannot serve `split_part(ref, ':', 1) = $1`. Measured on
-- this function before the index: 64.4 ms and 10,274 buffers for ONE profile, of which 9,424
-- were this one filter scanning every mp row (3,848 removed). After: 7.5 ms, and ~0.75 ms
-- per call averaged over a 300-MP sample. That is the same defect class as 081's missing
-- `idx_person_role_ref`, which cost 74 s across 23,916 probes and is documented in CLAUDE.md.
--
-- It is in THIS file because 081 is applied only by `db:resolve:persons` (a multi-hour
-- rebuild) and `add_override.ts`, so an index added there would not reach a serving database
-- until the next full re-resolve — while the function that needs it ships with
-- `apply_functions.ts` in seconds. Indexes are in the same "applied, never loaded" position
-- as functions (CLAUDE.md). Partial + expression, so it covers ~3.1k rows, not 200k.
CREATE INDEX IF NOT EXISTS idx_person_role_mp_id
  ON person_role (split_part(ref, ':', 1))
  WHERE source = 'mp';

CREATE OR REPLACE FUNCTION mp_tr_roles(p_mp_id integer)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH subj AS (
    -- The MP's person row, read LIVE rather than trusted from any snapshot, so a person
    -- flipped out of 'active' drops out immediately.
    --
    -- ⚠️ THE ELIGIBILITY CLAUSE MIRRORS 082's `pick` GATE VERBATIM, and must keep doing so.
    -- 082 serves the profile; if this were the weaker `status`-only check, a person who is
    -- neither a public figure nor verified would have their TR roles served here while
    -- /person/:slug returned nothing for them — the two surfaces disagreeing again, in the
    -- one direction that matters. Exposure is zero today (all 2,119 active MP-linked persons
    -- are is_public_figure) precisely because nothing has ever exercised the difference; that
    -- is a reason to encode the invariant, not to rely on it.
    SELECT DISTINCT pe.person_id, pe.display_name, pe.name_fold
      FROM person_role pr
      JOIN person pe ON pe.person_id = pr.person_id
     WHERE pr.source = 'mp'
       AND split_part(pr.ref, ':', 1) = p_mp_id::text
       AND pe.status = 'active'
       AND (pe.is_public_figure
            OR pe.identity_confidence IN ('verified', 'shared_name'))
     -- ORDER BY before LIMIT: an mp_id can reach two person rows after a merge, and an
     -- unordered LIMIT 1 would let the profile's identity change between two identical calls.
     -- Lowest person_id is the oldest row, which is the one the slug was minted from.
     ORDER BY pe.person_id
     LIMIT 1
  ),
  -- The GATED company set. Inherited from person_role, never recomputed here: same
  -- Bridge A/B mint, same tr_name_fold_people refusal, same confidence filter 082 uses for
  -- the profile's own companies list, so the two blocks on the profile cannot disagree.
  cos AS (
    SELECT ptr.ref AS uic
      FROM subj s
      JOIN person_role ptr ON ptr.person_id = s.person_id
     WHERE ptr.source IN ('tr', 'ngo')
       AND ptr.confidence IN ('exact_id', 'high', 'manual')
     GROUP BY ptr.ref
  ),
  -- Explode to one row per registry ROLE. `person_role` collapses a company to one row per
  -- (person, source, ref, role); the profile block shows the filing detail — the ownership
  -- share, when the role opened, whether it is still held — which only tr_person_roles has.
  --
  -- Joined on `name_fold`, not on name: TR spells one person several ways across filings
  -- (case, hyphen spacing), and the fold is the key the whole person layer already uses.
  --
  -- `share` comes from tr_owner_share (003), NEVER from tr_person_roles.share:
  -- the stored column divides each owner by every cap table the company has
  -- ever filed, and since the euro changeover by лв and EUR added together.
  -- ⚠️ CORRELATED, not a LEFT JOIN — there is no constant uic here to push into
  -- the view, and a plain join makes the planner materialise the whole thing
  -- (200,666 buffers for a handful of rows). 008's person_roles carries the
  -- same note and the same shape. All three key columns, because 55
  -- (uic, name_fold) pairs hold both a partner and a sole_owner row.
  --
  -- NOTE this CTE does NOT dedup — it is one row per FILING by design, so a
  -- company re-listed across vintages still appears once per filing. Each of
  -- those rows now carries the SAME current-vintage percentage rather than one
  -- stale figure per vintage, which is an improvement but not a dedup; that
  -- question belongs with roleCount/companyCount below, not here.
  roles AS (
    SELECT t.uic, t.role, t.position_label,
           (SELECT os.share_pct FROM tr_owner_share os
             WHERE os.uic = t.uic AND os.name_fold = t.name_fold
               AND os.role = t.role) AS share,
           t.added_at, t.erased_at,
           c.name AS company_name, c.legal_form, c.seat, c.status,
           -- ⚠️ CORRELATED, not a LEFT JOIN — same reason as `tr_owner_share` above, and
           -- measured on the same shape. `person_company_bridge_a` joins `company_politicians`
           -- to `person_role` through string surgery on `ref` under an OR, so there is no
           -- constant the planner can push into it: joined, it builds the WHOLE bridge once
           -- per call (a Bitmap Heap Scan looping over every company_politicians row) and the
           -- subject's own person_id never narrows anything. That is the 084 `person_connections`
           -- defect exactly — whole-corpus work per request, paid in full by an MP with no
           -- companies — and it scales with company_politicians, which the Tier 4-6
           -- consolidation took from ~514 rows to 982.
           -- Measured on the busiest MP (2670, 14 roles): 7,745 buffers / 32.5 ms joined,
           -- 867 / 2.3 ms correlated. EXISTS rather than a scalar read because `declared` is
           -- consumed only as a boolean.
           EXISTS (SELECT 1 FROM person_company_bridge_a ba
                    WHERE ba.person_id = s.person_id AND ba.uic = t.uic) AS declared
      FROM subj s
      -- Deliberate cross join, and safe ONLY because `subj` is LIMIT 1 — it carries the one
      -- subject's name_fold down to the tr_person_roles join below. If that LIMIT is ever
      -- removed this silently becomes a fan-out over every matched person.
      JOIN cos ON true
      JOIN tr_person_roles t ON t.uic = cos.uic AND t.name_fold = s.name_fold
      LEFT JOIN tr_companies c ON c.uic = t.uic
  )
  SELECT jsonb_build_object(
    'mpId',   p_mp_id,
    'mpName', (SELECT display_name FROM subj),
    -- BOTH counts, each naming its basis, because they differ and "total" beside a company
    -- list reads as companies: 1,966 role rows against 1,313 (MP, company) pairs corpus-wide.
    -- One person holding two roles at one company is two rows and one company.
    -- `total` is kept as an alias of roleCount ONLY for shard payload compatibility during the
    -- repoint; drop it once no consumer reads it. (CLAUDE.md: every key names its basis.)
    'roleCount',    (SELECT count(*)::int FROM roles),
    'companyCount', (SELECT count(DISTINCT uic)::int FROM roles),
    'total',        (SELECT count(*)::int FROM roles),
    'roles',  COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'uic',           r.uic,
        'companyName',   r.company_name,
        'legalForm',     r.legal_form,
        'seat',          r.seat,
        'status',        COALESCE(r.status, 'unknown'),
        'role',          r.role,
        'positionLabel', r.position_label,
        'sharePercent',  r.share,
        'addedAt',       r.added_at,
        'erasedAt',      r.erased_at,
        -- The SAME two words 082 puts on the profile's companies list, from the SAME view,
        -- so one page cannot call one company 'declared' in one block and 'name_match' in
        -- the other. 'declared' = a curated register (declared interests / ИВСС чл.175а) put
        -- this COMPANY on this person; everything else was found by name.
        --
        -- ⚠️ 'declared' IS NOT A CONFIRMED IDENTITY, and no consumer may word it that way:
        -- Bridge A keeps the TR officers on an independently-linked EIK whose name matches,
        -- so the COMPANY link is register-sourced and the officer row inside it is still a
        -- name match. Much stronger than a bare fold hit — not proof. (148, §0.2.)
        'linkBasis',     CASE WHEN r.declared THEN 'declared' ELSE 'name_match' END
      )
      -- Currently-held first, then most recently opened. An unordered jsonb_agg would let
      -- the row order change between two identical calls, and this payload is rendered as a
      -- list a reader may screenshot.
      -- ⚠️ `erased_at` IS PART OF THE KEY, not decoration. The four columns before it do NOT
      -- separate every row: this CTE is one row per FILING, so a company re-listed across
      -- vintages yields several rows sharing (uic, role) — and where `added_at` is NULL on
      -- both, the sort was a complete tie broken by whatever order the plan emitted. MP 209
      -- has exactly that pair (206544231/partner, both added_at NULL, erased_at 2023-06-02 vs
      -- 2025-04-30) and its two rows swapped places when the bridge-A read above changed
      -- shape — with the row SET identical, which is how a "deterministic" comment survived
      -- being false. Total up to rows equal in every emitted field, which are indistinguishable
      -- in the output anyway.
      ORDER BY (r.erased_at IS NULL) DESC, r.added_at DESC NULLS LAST, r.uic, r.role,
               r.erased_at DESC NULLS LAST)
      FROM roles r), '[]'::jsonb)
  )
  -- NULL, not an empty payload, when the mp_id resolves to no active person — the route
  -- turns that into a 404-equivalent `null` and the tile self-suppresses, exactly as the
  -- static shard's 404 did.
  WHERE EXISTS (SELECT 1 FROM subj);
$$;

COMMENT ON FUNCTION mp_tr_roles(integer) IS
  'An MP''s Commerce-Registry roles, derived from the gated person_role tr/ngo set so the '
  'profile''s two company blocks cannot disagree. Refuses shared and unmeasured name folds.';

-- Role-guarded, not bare. `roles_readonly.sql` is a one-time manual step on Cloud SQL, so on
-- a database where it has never run a bare GRANT raises 42704 — and exec() sends a migration
-- as ONE transaction, so that would roll back the function too and leave nothing at all.
-- The guard inverts the failure into a silent skip, which is why exec()/execEach() warn once
-- per process when a file grants to an absent app_readonly. (CLAUDE.md, db:pg:bootstrap.)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION mp_tr_roles(integer) TO app_readonly;
  END IF;
END $$;
