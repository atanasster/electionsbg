-- The BASIS of a person↔company link, and the registry's own people-per-name count.
-- docs/plans/tr-attribution-basis-v1.md (§1.1, §2.4).
--
-- Two objects, both created here because two consumers each need them and neither may
-- own the definition:
--
--   person_company_bridge_a — which (person, company) pairs are reachable from a CURATED
--     register rather than from a name. 120 built this inline as a CTE and 082 could not
--     see it at all, which is why the /persons browser could caveat a company list and
--     the /person profile could not.
--
--     ⚠️ INTERIM STATE: 120 still holds its own inline copy and reads that, not this view.
--     Step 2 of the plan switches it over and deletes the copy. Until then the two bodies
--     MUST stay identical — they are byte-equivalent today, and an edit to one of them in
--     this window produces the two surfaces disagreeing about one named person, which the
--     plan's §0.2 calls the worst bug this family can carry. 120's CTE carries the same
--     warning pointing back here.
--
--   tr_name_fold_people — how many DISTINCT people the Commerce Registry itself records
--     under a name fold. The guard that keeps a namesake's companies off a public
--     figure's page.
--
-- ⚠️ APPLY THIS BEFORE 082 AND 120. `person_by_slug` is LANGUAGE sql and Postgres
-- validates such a body at CREATE time, so applying 082 against a database without the
-- view fails the whole file with 42P01 — the 081→082 trap CLAUDE.md documents. Both
-- automated appliers order it that way: `SCHEMA_FILES` in resolve_persons.ts (before 082)
-- and `SCHEMA_FILES` in load_persons_browse_pg.ts (before 120). The hand-run form is:
--   npx tsx scripts/db/apply_functions.ts 148_person_company_basis.sql 082_person_api.sql 120_person_browse.sql
--
-- ⚠️ PRECONDITIONS for that command, neither of which it creates: `company_politicians`
-- (008, applied only by db:load:tr:pg) and `magistrate_company` (070) must already exist,
-- because a view body is validated at CREATE time too. On the resolver's path this costs
-- nothing new — its Bridge-A block SELECTs both unguarded already — but on a cold database
-- 148 is where the 42P01 now surfaces. And 120 is DROP MATERIALIZED VIEW … CASCADE +
-- CREATE, so it comes back EMPTY: run db:load:persons-browse:pg[:cloud] straight after.
--
-- The `person` side of this plan — fold_people_n and the 'shared_name' identity — lives
-- in 081 with the rest of the person table, NOT here: this file is applied by a LOADER
-- that runs before the resolver, and on a fresh clone the person table does not exist yet.

-- ---------------------------------------------------------------------------
-- Bridge A — the curated (person, company) pairs
-- ---------------------------------------------------------------------------
-- Moved verbatim out of 120's inline CTE. Everything a person holds in TR that is NOT
-- in here got there through Bridge B (name discovery, gated at resolve time on fold
-- people-uniqueness + a 3-part name + a ≤5-company footprint) or through the Tier-V
-- mint, and that is exactly what the 'name_match' caveat on both surfaces is about.
--
-- ⚠️ `declared` is NOT a confirmed identity, and no consumer may word it that way. Bridge
-- A takes the TR officers on an EIK the person is independently linked to and keeps those
-- whose (given, family) match the linked person (resolve_persons.ts, the Bridge-A block).
-- The COMPANY link is register-sourced; the officer row inside it is still a name match.
-- Much stronger than a bare fold hit — not proof.
--
-- Small by construction (company_politicians ~522 rows, magistrate_company ~245 usable,
-- 766 resulting pairs), so a view is the right shape and a matview would be a refresh
-- trigger for nothing. Measured for the per-person lookup 082 does — 0.266 ms over 10
-- buffers, the predicate pushed into two person_role_pkey index-only scans with
-- company_politicians never executed. person_company_basis.data.test.ts holds that.
CREATE OR REPLACE VIEW person_company_bridge_a AS
  SELECT DISTINCT pr.person_id, cp.eik AS uic
    FROM company_politicians cp
    JOIN person_role pr
      ON (cp.kind = 'mp' AND pr.source = 'mp'
          AND split_part(pr.ref, ':', 1) = replace(cp.ref, '/candidate/mp-', ''))
      OR (cp.kind = 'official'
          -- ALL SIX officials sources, not the three this listed until 2026-08-20. The
          -- officials tier is the set `person_officials_sources()` (103) names, and
          -- company_politicians stamps kind='official' on every one of them — so with
          -- `president`, `mep` and `diplomat` missing, a CURATED declared link on one of
          -- those people was not reachable from Bridge A and the pair fell through to the
          -- name-derived caveat. Measured on the corpus: Мартин Иванов Георгиев carries his
          -- officials slug at source='mep', so his declared link on EIK 000649348 read as
          -- Bridge B and failed tr_name_fold_people.data.test.ts's shared-fold guard, even
          -- though the resolver had licensed it correctly (its own Bridge A matches by
          -- name-on-linked-EIK and never looked at `source`). One pair, one person today —
          -- but it is a WRONG-BASIS bug, not a missing row: it labels a curated link as
          -- name-matched on a named individual.
          --
          -- The literal is restated rather than calling person_officials_sources(), which
          -- would be the "name the rule once" move: 103 is applied AFTER this file in
          -- resolve_persons.ts's SCHEMA_FILES, and load_persons_browse_pg.ts applies only
          -- 148 + 120 — and a view body is validated at CREATE time, so the call would fail
          -- with 42883 on exactly the cold-bootstrap path. 100 and 120 restate it for the
          -- same reason. person_company_basis.data.test.ts pins this list against 103's.
          AND pr.source IN ('official_exec', 'official_muni', 'public_sector',
                            'president', 'mep', 'diplomat')
          AND pr.ref = replace(cp.ref, '/officials/', ''))
  UNION
  SELECT DISTINCT pr.person_id, mc.eik
    FROM magistrate_company mc
    JOIN person_role pr ON pr.source = 'magistrate' AND pr.ref = mc.magistrate_name
   WHERE mc.eik IS NOT NULL AND NOT mc.eik_ambiguous;

-- ---------------------------------------------------------------------------
-- tr_name_fold_people — distinct registry PEOPLE per name fold
-- ---------------------------------------------------------------------------
-- Filled by db:load:tr-name-fold-people:pg from the committed
-- data/person/tr_name_fold_people.tsv, which scripts/declarations/tr/count_registry_people.ts
-- mints from raw_data/tr/daily/.
--
-- ⚠️ WHAT THIS IS DERIVED FROM, AND WHAT IS DELIBERATELY NOT STORED. Every Subject in the
-- TR daily feed carries an `Indent` element holding a hash+salt of the person's EGN. The
-- repo treats that hash exactly as the EGN — never extracted, never stored, never
-- displayed (parse_daily_filing.ts, types.ts, sqlite_writer.ts all say so). The counter
-- honours that: it digests each hash at read time, counts DISTINCT digests per fold in
-- memory, and persists ONLY the integer. There is no cluster id and nothing reversible
-- here. A count is all the guard needs — the identifier would only let us SPLIT a
-- footprint, and nothing in this corpus can say WHICH half is the public figure.
--
-- ⚠️ THREE STATES, NOT TWO, AND THE THIRD IS THE POINT.
--   people_n = 1   the registry says one person
--   people_n > 1   the registry says two or more — a namesake collision, proven
--   row ABSENT     never observed in the feed's window; UNMEASURED, not unique
-- Storing only the >1 rows would have made "unmeasured" indistinguishable from "unique"
-- and every guard built on it fail open in silence. That is why the artifact is the FULL
-- table (~531k folds) rather than the ~26.5k shared ones.
--
-- ⚠️ COVERAGE IS PARTIAL AND WILL FALL. The feed starts 2021-01-01 and holds only records
-- a filing touched: 489,326 of 539,999 tr_person_roles folds are measured (90.6%). The
-- other arm of the TR corpus — the CR Deeds capture — publishes NO identity key of any
-- kind (no Indent, no EGN, no hash), and it is the growth path, so this share falls as
-- that crawl widens. tr_name_fold_people.data.test.ts carries a coverage FLOOR so the
-- decay fails a test rather than passing unnoticed.
-- ⚠️ NO RECONCILE BLOCK, so a later change here reaches a fresh clone and NOTHING else:
-- `CREATE TABLE IF NOT EXISTS` is a no-op on a warm database (the 003 lesson CLAUDE.md
-- spells out, gated for the TR tables by tr_search_shape.test.ts). Two columns and one
-- CHECK make that risk negligible today, which is exactly when the note is cheap: a new
-- column, a type change or a CHECK change needs an explicit `ALTER … IF NOT EXISTS` added
-- below, not just an edit to the CREATE.
CREATE TABLE IF NOT EXISTS tr_name_fold_people (
  name_fold text PRIMARY KEY,
  -- Distinct registry people observed under this fold. >= 1 by construction: a fold with
  -- no observation has no row at all, which is the third state above.
  people_n  integer NOT NULL CHECK (people_n >= 1)
);

COMMENT ON TABLE tr_name_fold_people IS
  'Distinct Commerce-Registry people per translit name fold, counted from the feed''s '
  'salted-EGN keys and storing only the count. Absent row = unmeasured, never unique.';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON tr_name_fold_people TO app_readonly;
    GRANT SELECT ON person_company_bridge_a TO app_readonly;
  END IF;
END $$;
