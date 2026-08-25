-- 178_official_companies.sql — companies a person in public life is attached to.
--
-- The relation behind /governance/companies, which replaces /mp/companies. Two things change
-- at once and both are deliberate:
--
--   • THE POPULATION WIDENS FROM MPs TO EVERY PUBLIC OFFICE-HOLDER. Measured 2026-08-20:
--     17,681 companies against the retired artifact's 2,969 — 6.0x. MPs are a minority of it.
--   • THE BASIS BECOMES THE GATED PERSON LAYER. companies-index.json matched an MP NAME
--     against TR officers with no people-per-name guard; this is `person_role` at source
--     tr/ngo, minted through Bridge A/B and refused on a name the Commerce Registry says
--     belongs to more than one human (tr_name_fold_people, 148). Same set 150 (`mp_tr_roles`),
--     151 (`place_mp_companies`) and 158 (`company_political_links`) publish — so no two
--     surfaces can describe one person's companies differently.
--
-- Plan: docs/plans/company-page-consolidation-v1.md (Tier 3).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ THIS IS NOT `tr_company_place.person_link_n`, AND THAT SUBSTITUTION IS THE TRAP.
--
-- 133's column answers almost the same question and is already indexed for it, so it looks
-- like the ready-made basis — 151 uses it, and its header documents the same 2,159 → 10,202
-- improvement over the retired shards. But `tr_company_place` holds only companies whose
-- free-text seat RESOLVED to an EKATTE. Measured: 10,373 of 17,173 registry-linked companies
-- are in it, so building this on that column drops 40% of the population silently, at a 200,
-- on a page whose entire job is to list them. 151 is a PLACE page and is scoped to a place by
-- construction; this is the national view and must not inherit its seat requirement.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- TWO ARMS, COUNTED SEPARATELY, BECAUSE THEY ARE DIFFERENT CLAIMS.
--
--   registry — the Commerce Registry itself records this person at this company. 17,173.
--   declared — the person's own Court-of-Audit filing says so, and 096's three gates
--              confirmed it against the registry. 1,335.
--
-- ⚠️ `declaration_stake_company` IS read directly, unlike the money below, and the difference
-- is which loader recreates it. 096 DROPs that matview with CASCADE — but its only applier is
-- load_declarations_pg's phase 2, which applies 096 and then THIS FILE a few statements later
-- on the same path, so the CASCADE and the rebuild always travel together. That is the
-- `person_wealth_year` shape, and it is recorded in migration_drop_dependents.data.test.ts's
-- SANCTIONED list with that reason. 127 has no such property, hence the wrapper.
--
-- They overlap, and the union is 17,681. `has_registry_link` / `has_declared_stake` ride on
-- every row so a surface can say WHICH, and `person_count` is over the union — a person
-- reached by both arms is ONE person, which is why it is a DISTINCT count and not a sum.
-- Publishing „N лица" off a sum would double-count exactly the best-evidenced rows.

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ WHY THE MONEY COMES THROUGH A plpgsql WRAPPER AND NOT FROM THE TABLE.
--
-- A MATVIEW records a real pg_depend edge on everything its query names. 127 opens with a
-- DROP of `company_public_money`, and 127's ONLY applier is `db:load:graph:pg` — a different
-- loader from this one. So read directly, every routine graph load would CASCADE this matview
-- out of existence and exit 0: nothing in the output, no row count moving, and
-- /governance/companies empty at a 200 until the next declarations resolve happened to run.
--
-- A plpgsql body is an opaque string that Postgres never parses at CREATE, so it records no
-- edge — the same escape 077 uses for `dual_corpus_company_count()`. It is deliberately NOT
-- `LANGUAGE sql`: that form is parsed today (and the PG14+ BEGIN ATOMIC form records the edge
-- outright), so it would put the dependency straight back.
--
-- The cost is one materialisation of the money table per rebuild, hash-joined — which this
-- pays once, at build time, not per request.
--
-- DO NOT "simplify" this back to a direct read. `migration_drop_dependents.data.test.ts`
-- fails if you do, and its message is the fix list.
CREATE OR REPLACE FUNCTION company_public_money_rows()
RETURNS TABLE (eik text, public_money_eur double precision)
-- ROWS: the planner's default estimate for a set-returning function is 1000, against
-- ~81k actual — which sized the hash join for a thousandth of the input and spilled the
-- tuplestore. PARALLEL SAFE because it only reads.
LANGUAGE plpgsql STABLE PARALLEL SAFE ROWS 100000 AS $fn$
BEGIN
  RETURN QUERY SELECT m.eik, m.public_money_eur FROM company_public_money m;
END
$fn$;

-- RETIRED (migration 188). official_companies answered one population — companies linked to
-- a person in public life — while the general registry ("look up any company") had no browse
-- at all. company_browse_table (188) is the FULL tr_companies corpus with this population as
-- one filter column (is_official_linked) instead of a separate matview and a separate page.
-- Tombstone DROP: applying this file sheds the stale matview; nothing recreates it.
DROP MATERIALIZED VIEW IF EXISTS official_companies;
-- The FUNCTION is NOT dropped before the CREATE — same rule 025/030/031 use for a function a
-- RETIRING migration still depends on. company_browse_table (188) also depends on it, this
-- file does not own that matview, and 188 keeps its own CREATE OR REPLACE of the identical
-- body so neither file's apply order is load-bearing for the other.
-- (The CREATE MATERIALIZED VIEW / indexes / GRANT that used to follow are retired — see the
-- DROP above and migration 188, whose company_browse_table carries the identical query logic
-- plus the full tr_companies corpus around it.)
