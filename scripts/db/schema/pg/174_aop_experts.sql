-- 174 — АОП external experts (чл. 232а, ал. 2 ЗОП). Plan P4.
--
-- The state's list of external experts a contracting authority may co-opt onto an
-- evaluation committee. Joined to the procurement-officer layer it answers „the
-- same person wrote the documentation and then sat on the committee".
--
-- ⚠️⚠️ THIS REGISTER IS HISTORICAL. Measured 2026-08-20 over the full crawl: 88
-- experts and NOT ONE still valid — the newest validity ended 2023-01-01 and no
-- expert has been added since 2020-01-01. Every consumer must phrase it in the
-- PAST tense. `aop_expert_coverage` carries the dates so no surface has to guess,
-- and `is_current` is a GENERATED column rather than a stored flag precisely so it
-- cannot go stale into a false present-tense claim.
--
-- ⚠️ THE NAME IS TWO PARTS, AND THAT IS THE WHOLE DIFFICULTY. The register prints
-- given + family only — its own form marks Презиме „за служебни цели и не се
-- отразява в публичната част" — while `person` holds three. So a link can only be
-- made on (given, family), which is a WEAKER key than anything else in this repo
-- joins on. Measured: 58 of 88 match at least one person, but only 25 match exactly
-- one. `aop_expert_person_links()` therefore returns ONLY the unambiguous 25 and
-- reports the rest as refused — it does not grade them, does not pick the
-- best-scoring candidate, and must never be changed to. Naming the wrong person as
-- a state-approved procurement expert is the exact harm this refusal prevents.

CREATE TABLE IF NOT EXISTS aop_expert (
  une           text PRIMARY KEY,           -- „ЕТС-49" — the register's own id
  name          text NOT NULL,              -- as printed: given + family
  given_fold    text,                       -- translit_bg_latin, to join `person`
  family_fold   text,
  -- ⚠️ DERIVED — the UNION of this expert's per-area windows, not a fact the
  -- register states. Validity belongs to (expert, area): see aop_expert_area.
  valid_from    date,
  valid_until   date,
  areas         jsonb NOT NULL DEFAULT '[]'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN aop_expert.name IS
  'Given + family ONLY. The register withholds the patronymic, so this is a weaker '
  'identity key than any other person-bearing table here. Never join on it directly '
  '— use aop_expert_person_links(), which refuses a name held by more than one person.';

CREATE INDEX IF NOT EXISTS idx_aop_expert_fold
  ON aop_expert (given_fold, family_fold);

-- ⚠️ THE REGISTER'S REAL GRAIN. An expert admitted to a second competence area
-- later carries a DIFFERENT validity window there — measured 2026-08-20, 4 of 88
-- do (ЕТС-49 Анна Савова is 2019→2022 in one area and 2020→2023 in another). A
-- scalar pair on `aop_expert` can only hold one of two true answers, picked by
-- whichever area the crawl visited first, so the pair on the parent is explicitly
-- the UNION and this is where the facts live.
CREATE TABLE IF NOT EXISTS aop_expert_area (
  une         text NOT NULL REFERENCES aop_expert(une) ON DELETE CASCADE,
  area_no     integer NOT NULL,
  area        text NOT NULL,
  valid_from  date,
  valid_until date,
  PRIMARY KEY (une, area_no)
);

-- ⚠️ VALIDITY IS DERIVED AT QUERY TIME AND IS NEVER STORED — the same rule
-- `open_calls_table` (142) follows, for the same reason: a stored flag is only
-- true until the clock moves past it, and here it would silently become a
-- present-tense claim about a state-approved expert. A GENERATED column cannot do
-- this job either (CURRENT_DATE is not immutable, so Postgres refuses it), which
-- is a useful accident: the database will not let this be stored wrong.
CREATE OR REPLACE VIEW aop_expert_table AS
  SELECT e.*,
         (e.valid_until IS NOT NULL AND e.valid_until >= CURRENT_DATE) AS is_current
    FROM aop_expert e;

-- One row. The register's own coverage, so a surface can state the window rather
-- than inferring it from the rows it happens to have.
CREATE TABLE IF NOT EXISTS aop_expert_coverage (
  id                       integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  crawled_at               timestamptz NOT NULL,
  areas_queried            integer NOT NULL,
  areas_with_experts       integer NOT NULL,
  expert_count             integer NOT NULL,
  earliest_from            date,
  latest_from              date,
  latest_until             date,
  still_valid_on_crawl_date integer NOT NULL
);

-- The ONE supported way to reach a person from this register.
--
-- Returns the unambiguous matches only. `refused_ambiguous` is the count a caller
-- must be able to state, because „25 of 88 experts are in our person layer" and
-- „25 matched, 33 more share their name with somebody" are different claims and
-- only the second is true.
CREATE OR REPLACE FUNCTION aop_expert_person_links()
RETURNS TABLE (
  une text, expert_name text, person_id bigint, person_slug text,
  display_name text, valid_from date, valid_until date, areas jsonb
)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH cand AS (
    SELECT e.une, e.name AS expert_name, p.person_id, p.slug AS person_slug,
           p.display_name, e.valid_from, e.valid_until, e.areas
      FROM aop_expert e
      JOIN person p
        ON p.given_fold = e.given_fold
       AND p.family_fold = e.family_fold
     WHERE e.given_fold IS NOT NULL AND e.family_fold IS NOT NULL
       AND p.status = 'active'
  ), unambiguous AS (
    SELECT une FROM cand GROUP BY une HAVING count(DISTINCT person_id) = 1
  )
  SELECT c.* FROM cand c JOIN unambiguous u USING (une) ORDER BY c.une;
$$;

CREATE OR REPLACE FUNCTION aop_expert_link_stats()
RETURNS TABLE (experts integer, matched_any integer, unambiguous integer,
               refused_ambiguous integer)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH cand AS (
    SELECT e.une, p.person_id
      FROM aop_expert e
      JOIN person p ON p.given_fold = e.given_fold AND p.family_fold = e.family_fold
     WHERE e.given_fold IS NOT NULL AND p.status = 'active'
  ), per AS (SELECT une, count(DISTINCT person_id) n FROM cand GROUP BY une)
  SELECT (SELECT count(*) FROM aop_expert)::int,
         (SELECT count(*) FROM per)::int,
         (SELECT count(*) FROM per WHERE n = 1)::int,
         (SELECT count(*) FROM per WHERE n > 1)::int;
$$;

-- Role-guarded (117/130 shape): roles are CLUSTER-wide, so a virgin pgdata volume
-- has no app_readonly and a bare GRANT would 42704 and roll this whole file back.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON aop_expert, aop_expert_area, aop_expert_table, aop_expert_coverage
      TO app_readonly;
    GRANT EXECUTE ON FUNCTION aop_expert_person_links() TO app_readonly;
    GRANT EXECUTE ON FUNCTION aop_expert_link_stats() TO app_readonly;
  ELSE
    RAISE WARNING 'app_readonly absent — 174 granted nothing. /api/db will 42501 '
                  'against a corpus that looks fully loaded. Run db:pg:bootstrap.';
  END IF;
END $$;
