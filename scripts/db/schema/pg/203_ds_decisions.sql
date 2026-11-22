-- 203 — Комисия по досиетата (comdos.bg) decision corpus: every decision the
-- Commission has published, and every person it announced in them.
-- docs/plans/comdos-ds-ingest-v1.md. Loaded by `db:load:ds:pg` from the COMMITTED
-- data/comdos/ corpus (`pnpm run comdos:crawl && pnpm run comdos:parse`).
--
-- ⚠️⚠️ WHAT THIS CORPUS IS — and the rules that are not negotiable (plan §4):
--
--   1. ONLY ESTABLISHED AFFILIATION. A decision names a person only when the
--      Commission FOUND them in the archives. The people who were checked with no
--      finding appear here as COUNTS (`ds_decision.checked`), never as rows — the
--      per-person „Проверени лица" search, which does list them, is not ingested.
--   2. NAME ≠ IDENTITY. `ds_announcement` is a statement about the person NAMED IN
--      THE DECISION. It is never attached to a `person` row on a name match: the
--      resolver attaches a `ds` role only through a stable disambiguator plus an
--      EXACT birth-date match (MPs: `mp_profile`). Everyone else here is a lead.
--   3. THE DECEASED ARE COUNTED, NOT NAMED. The Commission publishes nothing about
--      them beyond „на N лица, данните за които не подлежат на публикуване"; that
--      count is `ds_decision.deceased`, and nothing may try to recover them.
--   4. THE RECRUITING / HANDLING OFFICER IS NOT STORED. They are third parties who
--      were not the subject of the decision. Only the recruitment YEAR is kept.
--
-- ⚠️ UPSERT-ONLY. A decision is a permanent public record, so a crawl that misses a
-- page must leave its decision standing (`last_seen_at` records the absence). The
-- one deletion the loader performs is SCOPED to decisions it re-parsed in the same
-- run: a re-parsed decision's person list is authoritative, so a block the parser no
-- longer emits goes — the council loader's rule, for the same reason.

CREATE TABLE IF NOT EXISTS ds_decision (
  decision_id   integer PRIMARY KEY,         -- comdos.bg DecisionID
  number        text,                        -- „3-69"; NULL for the one unnumbered decision
  decision_date date,
  title         text NOT NULL,
  -- FALSE when the decision page links no document (or it is gone): its counts
  -- are UNKNOWN, never zero. Every aggregate must filter on this.
  has_document  boolean NOT NULL,
  total         integer,                     -- „общо N лица" submitted
  checked       integer,                     -- „Проверени са M лица"
  deceased      integer,                     -- counted, never named (rule 3); NULL = no document
  person_count  integer,                     -- announced blocks parsed; NULL = no document
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ds_announcement (
  decision_id     integer NOT NULL REFERENCES ds_decision(decision_id),
  seq             integer NOT NULL,          -- block position within the decision
  name            text NOT NULL,             -- as printed: three names
  -- The person layer's fold, so the resolver joins on ONE definition of it.
  name_fold       text GENERATED ALWAYS AS (translit_bg_latin(name)) STORED,
  birth_date      date,                      -- NULL on re-disclosures: they cite the prior decision
  birth_place     text,
  section         text NOT NULL CHECK (section IN ('establish', 'already', 'newdocs')),
  quality_raw     text NOT NULL,
  categories      text[] NOT NULL,
  pseudonyms      text,
  structures      text,
  recruit_year    integer,                   -- the officer's NAME is never stored (rule 4)
  after_nov_1989  boolean NOT NULL,
  office          text NOT NULL,
  party           text,
  mir             text,
  prior_decisions text[] NOT NULL,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (decision_id, seq)
);

-- Warm databases: the two counts were NOT NULL (a no-document decision stored 0,
-- i.e. „announced nobody"). CREATE TABLE IF NOT EXISTS cannot relax them.
ALTER TABLE ds_decision ALTER COLUMN deceased DROP NOT NULL;
ALTER TABLE ds_decision ALTER COLUMN deceased DROP DEFAULT;
ALTER TABLE ds_decision ALTER COLUMN person_count DROP NOT NULL;
UPDATE ds_decision SET deceased = NULL, person_count = NULL
 WHERE NOT has_document AND (deceased IS NOT NULL OR person_count IS NOT NULL);
-- A decision's counts are known exactly when its document is.
ALTER TABLE ds_decision DROP CONSTRAINT IF EXISTS ds_decision_counts_need_document;
ALTER TABLE ds_decision ADD CONSTRAINT ds_decision_counts_need_document
  CHECK (has_document = (person_count IS NOT NULL AND deceased IS NOT NULL));

COMMENT ON TABLE ds_announcement IS
  'A person the Комисия по досиетата ANNOUNCED in a decision. Established affiliation '
  'only. Never attach to a person on a name match — see 203''s header, rule 2.';

CREATE INDEX IF NOT EXISTS idx_ds_announcement_fold
  ON ds_announcement (name_fold, birth_date);

-- Role-guarded (117/130 shape): roles are CLUSTER-wide, so a virgin pgdata volume
-- has no app_readonly and a bare REVOKE would 42704 and roll this whole file back.
--
-- ⚠️ NEITHER TABLE is readable by the serving role. `ds_announcement` names
-- people; `ds_decision.title` does too — the чл. 28 decisions are titled with the
-- person they concern („чл. 28 за <three names>"). The serving role reads COUNTS only,
-- through the SECURITY DEFINER aggregates in 204, so no `/api/db` route can be
-- written that lists named rows — a per-person surface goes through the person layer
-- and rule 2. `roles_readonly.sql` re-grants SELECT ON ALL TABLES on every run, so it
-- carries the matching REVOKE; this one covers a database where 203 lands after it.
--
-- ⚠️ A FUTURE SERVING FUNCTION over these tables must be SECURITY DEFINER and
-- return AGGREGATES ONLY. New functions get EXECUTE for app_readonly through the
-- default privileges, so a function returning names would publish them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    REVOKE ALL ON ds_decision, ds_announcement FROM app_readonly;
  ELSE
    RAISE WARNING 'app_readonly absent — 203 revoked nothing. Run db:pg:bootstrap.';
  END IF;
END $$;
