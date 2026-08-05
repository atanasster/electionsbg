-- 116_judicial_body.sql — the canonical judicial-institution dimension.
--
-- Plan: docs/plans/person-role-place-consolidation-v1.md (T2).
--
-- WHY A NEW TABLE RATHER THAN court_load. `court_load` (109) covers COURTS ONLY — 208
-- names across 6 court tiers — while `magistrate.court` also names прокуратури (260
-- distinct strings) and следствени отдели (40). It is also unnormalised in the same way
-- its input is (`АдмС - Благоевград` AND `АдмС Благоевград` are both rows), so only 9 of
-- the 975 magistrate strings match a `court_load.name` exactly. It seeds the court half
-- here — it is the only source carrying a tier and a seat per court — and everything
-- else is parsed by scripts/judiciary/judicialBodies.ts.
--
-- WHY AN ALIAS TABLE. The 975 surface forms are not going away: the ИВСС declaration
-- form is free text and next year's harvest will invent new spellings. Recording the
-- fold explicitly (rather than re-deriving it in every consumer) means a new spelling is
-- a one-row insert, and an UNRESOLVED spelling is visible as an absence rather than
-- silently landing on the wrong court.
--
-- `kind` also retires the client-side regex in src/lib/magistrateRole.ts, which sniffed
-- Съдия / Прокурор / Следовател out of the institution STRING to label a person's role.

CREATE TABLE IF NOT EXISTS judicial_body (
  body_code   text PRIMARY KEY,        -- 'rs-varna', 'op-plovdiv', 'vks', 'nsls'
  name        text NOT NULL,           -- canonical Bulgarian display name
  kind        text NOT NULL
    CHECK (kind IN ('court', 'prosecution', 'investigation', 'council')),
  tier        text,                    -- районен|окръжен|градски|апелативен|
                                       --   административен|върховен|военен|
                                       --   специализиран|национален
  place       text,                    -- seat settlement, Bulgarian
  place_code  text,                    -- app obshtina code for the seat, when resolvable
  lng         double precision,        -- from court_load, court half only
  lat         double precision
);

-- Every surface form that folds onto a body. `alias_norm` is the output of
-- foldJudicialName() — NOT the raw string — so the table stays small and a re-harvest
-- with different casing/punctuation does not add rows.
CREATE TABLE IF NOT EXISTS judicial_body_alias (
  alias_norm text PRIMARY KEY,
  body_code  text NOT NULL REFERENCES judicial_body (body_code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_judicial_body_alias_body
  ON judicial_body_alias (body_code);

-- The RAW source strings, keyed as they appear in their own table. `alias_norm`
-- above is the FOLDED form, and the fold lives in TypeScript (foldJudicialName)
-- — so SQL cannot join court_load.name to a body without it. This table carries
-- the un-folded name the loader already resolved, which is what lets
-- judicial_body_detail() join the workload series without re-implementing the
-- fold in plpgsql (three copies of a name normaliser is how they drift).
CREATE TABLE IF NOT EXISTS judicial_body_source_name (
  source_name text PRIMARY KEY,
  body_code   text NOT NULL REFERENCES judicial_body (body_code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_judicial_body_source_body
  ON judicial_body_source_name (body_code);
-- "every prosecution office", "every court in X" — the two ways the dimension is sliced.
CREATE INDEX IF NOT EXISTS idx_judicial_body_kind ON judicial_body (kind, tier);
CREATE INDEX IF NOT EXISTS idx_judicial_body_place ON judicial_body (place_code)
  WHERE place_code IS NOT NULL;

-- ==========================================================================
-- One judicial body's page payload → /court/:bodyCode.
--
-- COVERS ALL 283 BODIES, not just the 186 courts (plan §9.4). The 70
-- prosecution offices and 27 investigation services get pages too — they are
-- exactly what a reader types — but three of the four blocks below DEGRADE for
-- them, and the page must NAME that rather than draw an empty chart:
--   * `load`  — court_load has rows for 180 bodies only. NULL for the rest.
--   * `lng`/`lat` — court_load's geo, so NULL wherever `load` is.
--   * magistrate counts — present for any body the ИВСС register names.
-- What every body carries is its name, kind, tier and place.
--
-- The workload join goes through judicial_body_source_name because the fold
-- that maps a raw name to a body lives in TypeScript; see that table's comment.
-- ==========================================================================
-- court_load (069) and magistrate (070) are loaded by their own operator-run
-- loaders and are NOT in resolve_persons.ts's SCHEMA_FILES, so this file must
-- still apply on a database where neither exists. LANGUAGE sql bodies are
-- validated at CREATE time, and exec() sends the file as ONE transaction — so
-- an unvalidatable body here would roll the whole migration back and abort
-- db:resolve:persons on a cold bootstrap.
SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION judicial_body_detail(p_code text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH b AS (SELECT * FROM judicial_body WHERE body_code = p_code),
  src AS (
    SELECT source_name FROM judicial_body_source_name
    WHERE body_code = (SELECT body_code FROM b)
  ),
  -- ONE row per year. 28 administrative courts fold two court_load spellings
  -- onto one body; their year ranges are disjoint today, so the duplicate is
  -- latent rather than live — but a single overlapping year would emit two rows
  -- with the same React key and double the series. Prefer the better-staffed
  -- spelling, which is the fuller filing.
  load AS (
    SELECT DISTINCT ON (c.year) c.*
    FROM court_load c
    WHERE c.name IN (SELECT source_name FROM src)
    ORDER BY c.year, c.judges DESC NULLS LAST, c.name COLLATE "C"
  ),
  mags AS (
    SELECT count(*)::int AS n
    FROM magistrate m
    WHERE m.court IN (SELECT source_name FROM src)
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM b) THEN NULL
    ELSE jsonb_build_object(
      'bodyCode',   (SELECT body_code FROM b),
      'name',       (SELECT name FROM b),
      'kind',       (SELECT kind FROM b),
      'tier',       (SELECT tier FROM b),
      'place',      (SELECT place FROM b),
      'placeCode',  (SELECT place_code FROM b),
      'lng',        (SELECT lng FROM b),
      'lat',        (SELECT lat FROM b),
      'magistrates',(SELECT n FROM mags),
      -- Distinguishes "this body has no published workload" from "the bridge
      -- table was never loaded". Without it an empty judicial_body_source_name
      -- returns load:null for ALL 283 bodies, shape-identical to a real
      -- prosecution office — so every court page would assert, at a 200, that
      -- the ВСС publishes no workload for it. Applying this file with
      -- apply_functions.ts creates the table empty, which is the normal way a
      -- function change ships. Mirrors the psp:not-built / pp:not-built pattern.
      'sourcesBuilt', (SELECT EXISTS (SELECT 1 FROM judicial_body_source_name)),
      -- NULL, not [], when the body has no published workload: the page branches
      -- on it to say so, and an empty array would render an empty chart instead.
      'load', (
        SELECT jsonb_agg(jsonb_build_object(
                 'year',             year,
                 'judges',           judges,
                 'personMonths',     person_months,
                 'filedPerMonth',    filed_per_month,
                 'considerPerMonth', consider_per_month,
                 'resolvedPerMonth', resolved_per_month)
               ORDER BY year)
        FROM load)
    ) END;
$$;

-- ==========================================================================
-- The slim body index behind the /judiciary search group — all 283, with just
-- enough to search, rank and link. ~30 kB, requested only when the reader
-- focuses the box (same lazy shape as nzok_procedure_index / _pack_index).
--
-- Ranked by magistrate count: a reader typing "софия" wants Софийски районен
-- съд, not the smallest office that happens to sit there.
-- ==========================================================================
CREATE OR REPLACE FUNCTION judicial_body_index()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH m AS (
    SELECT s.body_code, count(*)::int AS n
    FROM judicial_body_source_name s
    JOIN magistrate g ON g.court = s.source_name
    GROUP BY s.body_code
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'bodyCode',    b.body_code,
           'name',        b.name,
           'kind',        b.kind,
           'tier',        b.tier,
           'place',       b.place,
           'magistrates', COALESCE(m.n, 0))
         ORDER BY COALESCE(m.n, 0) DESC, b.name COLLATE "C"), '[]'::jsonb)
  FROM judicial_body b LEFT JOIN m ON m.body_code = b.body_code;
$$;

RESET check_function_bodies;
