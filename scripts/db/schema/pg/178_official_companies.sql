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

DROP MATERIALIZED VIEW IF EXISTS official_companies CASCADE;
CREATE MATERIALIZED VIEW official_companies AS
WITH linked AS (
  -- The registry arm. Joined on `name_fold` for the reason 150 is: TR spells one person
  -- several ways across filings, and the fold is the key the person layer already uses.
  -- The confidence filter is 150's, not a new one — an unbridged `low` row is a name
  -- coincidence the person layer has already declined to publish.
  -- ⚠️ `tr_name_fold_people` IS RE-CHECKED HERE, not inherited. person_role's confidence was
  -- decided at RESOLVE time, and the registry moves underneath it: 19 pairs currently rest on
  -- a fold the Commerce Registry NOW says belongs to more than one human. 150's header
  -- documents the same staleness and mp_tr_roles.data.test.ts closes it by joining this table
  -- directly. Naming the wrong individual as a company's officer is the harm the fold gate
  -- exists to prevent, so a stale pass is not good enough.
  SELECT ptr.ref AS uic,
         pe.person_id,
         -- Whether ANY of this person's roles at this company is still open. See the
         -- has_current_role note below — a withdrawn filing is not a present-tense fact.
         bool_or(t.erased_at IS NULL) AS any_current
    FROM person_role ptr
    JOIN person pe
      ON pe.person_id = ptr.person_id
     AND pe.status = 'active'
     AND pe.is_public_figure
    JOIN tr_person_roles t
      ON t.uic = ptr.ref AND t.name_fold = pe.name_fold
    LEFT JOIN tr_name_fold_people f ON f.name_fold = pe.name_fold
   WHERE ptr.source IN ('tr', 'ngo')
     AND ptr.confidence IN ('exact_id', 'high', 'manual')
     -- NULL = the fold has not been measured. 148's own rule is that an UNMEASURED fold is
     -- REFUSED, never admitted — absence of evidence is not evidence of uniqueness.
     AND f.people_n = 1
   GROUP BY 1, 2
),
staked AS (
  -- The declaration arm — 096's gated resolution, same privacy gate.
  SELECT DISTINCT sc.uic, sc.person_id
    FROM declaration_stake_company sc
    JOIN person pe
      ON pe.person_id = sc.person_id
     AND pe.status = 'active'
     AND pe.is_public_figure
),
-- Named `arms` and not `both`: BOTH is reserved (TRIM(BOTH …)) and the CTE fails to parse.
arms AS (
  SELECT uic, person_id, true AS via_registry, false AS via_stake, any_current FROM linked
  UNION ALL
  -- A declared stake carries no erasure date: the filing is a dated statement, not an open
  -- registry entry, so it can neither assert nor deny currency. NULL, never false.
  SELECT uic, person_id, false, true, NULL::boolean FROM staked
),
agg AS (
  SELECT uic,
         -- DISTINCT over the union: a person reached by BOTH arms is one person.
         count(DISTINCT person_id)::int AS person_count,
         bool_or(via_registry) AS has_registry_link,
         bool_or(via_stake) AS has_declared_stake,
         -- ⚠️ WITHOUT THIS THE PAGE IS ERASED-BLIND, and says so in the present tense.
         -- 2,108 companies with no declared stake rest ENTIRELY on withdrawn filings
         -- (€119.8m) — Първа инвестиционна банка among them — while /person already renders
         -- the same pair as former, from 150's erasedAt. Listing them is right (a former
         -- directorship is a real fact); listing them UNLABELLED is not.
         COALESCE(bool_or(via_registry AND any_current), false) AS has_current_role
    FROM arms
   GROUP BY uic
)
SELECT a.uic,
       -- LEFT JOIN, never inner: a company can be reachable through the person layer and
       -- absent from tr_companies (an NGO the register carries under a different class, a
       -- row the last TR load did not cover). Dropping it here would make the page's count
       -- disagree with its own arms for no reason a reader could see.
       c.name,
       c.legal_form,
       c.seat,
       c.status,
       c.entity_class,
       -- The search fold. Same function the rest of the search layer uses, so a query folded
       -- by `translit_bg_latin` on the way in matches what is stored here.
       translit_bg_latin(COALESCE(c.name, '')) AS name_fold,
       -- ⚠️ NAMED FOR WHAT THEY HOLD. `tr_company_place.oblast` is a DISPLAY NAME
       -- („Благоевград") while `obshtina` beside it is a CODE (`BLG01`) — so a column pair
       -- called (oblast, obshtina) invites `WHERE oblast = 'SFO'`, which matches nothing and
       -- returns an empty page rather than an error. There is no oblast CODE in that table,
       -- and deriving one from the obshtina prefix is unsafe here (see
       -- project_oblast_code_shard_mismatch). The browse resource therefore facets and filters
       -- the NAME — the `?court` pattern, where the picker and the filter read one column so
       -- the counts are exact and no dictionary is needed.
       -- NULL where the seat did not resolve, which is 40% of the population: this column may
       -- narrow a view and must never define one.
       p.oblast AS oblast_name,
       p.obshtina AS obshtina_code,
       a.person_count,
       a.has_registry_link,
       a.has_declared_stake,
       a.has_current_role,
       -- 127, the one reusable broad-money basis (contracts ∪ subsidies ∪ funds ∪ interreg).
       -- COALESCE to 0 so the column sorts: a company with no public money is €0, not
       -- unknown, and NULL would sort it beside the biggest.
       COALESCE(m.public_money_eur, 0)::double precision AS money_eur
  FROM agg a
  LEFT JOIN tr_companies c ON c.uic = a.uic
  LEFT JOIN tr_company_place p ON p.uic = a.uic
  LEFT JOIN company_public_money_rows() m ON m.eik = a.uic;

CREATE UNIQUE INDEX official_companies_pkey ON official_companies (uic);
-- ⚠️ `NULLS LAST` IS LOAD-BEARING, NOT DECORATION. db_table.js's buildOrder emits
-- `<col> DESC NULLS LAST` for every descending sort, while a plain `DESC` index is NULLS
-- FIRST. Mismatched, the default arrival stops being an index walk and becomes a seq scan
-- plus a top-N heapsort: measured 426 buffers / 7.3 ms against 51 / 0.15 ms. Both of these
-- exist to serve a sort the engine actually issues, so both must spell it the same way.
--
-- ⚠️ AN EARLIER VERSION OF THIS NOTE BLAMED THE MATVIEW ("no NOT NULL constraint for the
-- planner to bridge the two with"). That is FALSE and the wrong lesson to carry away: there
-- is no bridge to build. Postgres compares pathkeys structurally and never consults a NOT
-- NULL constraint to equate two NULLS orderings — verified on a NOT NULL int column, where
-- a `(v DESC, id)` index serves `ORDER BY v DESC` and is refused for `ORDER BY v DESC NULLS
-- LAST`. So ordinary tables are exposed too, which is how `price_products.chain_count`
-- (NOT NULL) came to seq-scan 102,976 rows on every /consumption/products arrival.
-- The house-wide gate is scripts/db/tests/db_table_sort_indexes.data.test.ts.
CREATE INDEX idx_official_companies_money
  ON official_companies (money_eur DESC NULLS LAST, uic);
CREATE INDEX idx_official_companies_people
  ON official_companies (person_count DESC NULLS LAST, uic);
CREATE INDEX idx_official_companies_oblast ON official_companies (oblast_name)
  WHERE oblast_name IS NOT NULL;
-- Free-text search over both the Cyrillic name and its fold, the pair every other browse
-- resource in this repo indexes.
CREATE INDEX idx_official_companies_name_trgm
  ON official_companies USING gin (name gin_trgm_ops);
CREATE INDEX idx_official_companies_fold_trgm
  ON official_companies USING gin (name_fold gin_trgm_ops);

COMMENT ON MATERIALIZED VIEW official_companies IS
  'Companies attached to a person in public life, from the gated person layer (registry arm) '
  'and 096 (declared arm). The national twin of place_mp_companies (151) — and deliberately '
  'NOT built on tr_company_place.person_link_n, which requires a resolved seat and would drop '
  '40% of the population.';

-- Role-guarded, per the 117/130 shape: roles_readonly.sql is a one-time manual step on Cloud
-- SQL, and exec() sends a migration as one transaction, so a bare GRANT would roll the whole
-- file back on a database that never ran it.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON official_companies TO app_readonly;
  END IF;
END $$;
