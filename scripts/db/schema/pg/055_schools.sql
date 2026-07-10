-- Schools serving layer → PG, so /education + /school/:id are DB-backed and the
-- per-school data joins the entity graph (schools.eik = contracts.awarder_eik =
-- tr_companies.uic). SERVING migration, not an ingest rewrite: the update-schools
-- ingest keeps writing data/schools/index.json + data/education/*.json, which stay
-- the PG load sources (see [[feedback_no_json_from_pg]] — JSON → PG, never PG → JSON).
--
-- Two serving shapes, mirroring the funds/agri migrations:
--  1. Relational dim + fact (schools, school_scores, school_context) — queryable,
--     and the eik FK that links schools into the entity graph (a school's own
--     procurement, financials, connections).
--  2. school_payloads — a generic (kind, key) → jsonb blob. The loader writes one
--     'directory' blob (key '') holding the whole /education dataset with the SES
--     + value-added regressions ALREADY COMPUTED in the loader (static all-time
--     reads, no date windowing), so the client fetches one small blob instead of
--     the 1.25 MB raw index + a client-side regression; /school/:id reads its row
--     out of that same blob. Stored verbatim → local↔cloud parity is byte-exact
--     by construction. The (kind, key) shape leaves room for future per-school
--     blobs, but only 'directory' is emitted today.

-- 1. Dimension: one row per school -----------------------------------------------
CREATE TABLE IF NOT EXISTS schools (
  id          text PRIMARY KEY,          -- НЕИСПУО code
  name        text NOT NULL,
  obshtina    text NOT NULL,             -- obshtina code (SOF00 for Sofia city)
  oblast      text,                      -- oblast code (3-char prefix / S23)
  address     text,                      -- settlement ("ГР.БАНСКО")
  lat         double precision,
  lng         double precision,
  eik         text,                      -- Bulstat (procurement awarder); NULL if unmatched
  latest_year integer,
  latest_bel  double precision,          -- latest ДЗИ БЕЛ average (convenience)
  latest_n    integer                    -- that year's cohort size
);
-- The entity-graph join (school ↔ its own procurement/company page).
CREATE INDEX IF NOT EXISTS idx_schools_eik ON schools (eik) WHERE eik IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_schools_obshtina ON schools (obshtina);

-- 2. Fact: one row per (school × year × subject) --------------------------------
-- subject ∈ dzi_bel | dzi_math (grades 2–6) | nvo_bel | nvo_math (points 0–100).
CREATE TABLE IF NOT EXISTS school_scores (
  school_id text NOT NULL,
  year      integer NOT NULL,
  subject   text NOT NULL,
  value     double precision NOT NULL,
  n         integer,
  PRIMARY KEY (school_id, year, subject)
);
CREATE INDEX IF NOT EXISTS idx_school_scores_subject_year
  ON school_scores (subject, year);

-- 3. Per-obshtina socioeconomic context ("Индекс на средата") --------------------
CREATE TABLE IF NOT EXISTS school_context (
  obshtina       text PRIMARY KEY,
  ses            double precision,
  share_tertiary double precision,
  share_low_ed   double precision,
  unemployment   double precision
);

-- 4. Precomputed page payloads (verbatim jsonb) ---------------------------------
CREATE TABLE IF NOT EXISTS school_payloads (
  kind    text NOT NULL,               -- 'directory' (only kind emitted today)
  key     text NOT NULL DEFAULT '',    -- '' for the directory singleton
  payload jsonb NOT NULL,
  PRIMARY KEY (kind, key)
);
