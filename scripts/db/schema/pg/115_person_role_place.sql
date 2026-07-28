-- 115_person_role_place.sql — split `person_role.place` into a TYPED place.
--
-- Plan: docs/plans/person-role-place-consolidation-v1.md.
--
-- WHY. `place` was one untyped text column holding five mutually incompatible
-- namespaces — an oblast/МИР code for candidates, an obshtina CODE for
-- official_muni, an obshtina NAME for local, an uppercase МИР name for mp, a raw
-- unnormalized court string for magistrates — plus three sources (ds / sanctions /
-- regulator) where the value was not a place at all but a duplicate of what already
-- sits in `source_row`. One column doing three jobs:
--
--   1. a STRUCTURAL KEY   — 102_municipal_officials.sql keys the whole municipal
--                           roster matview on it,
--   2. a DISPLAY BADGE    — the /person offices tile prints it verbatim, which is
--                           why 6,210 rows rendered raw codes like `BLG11` to users,
--   3. NOTHING            — the 45 ds/sanctions/regulator rows.
--
-- The split gives each job its own column: `place_kind` says which namespace
-- `place_code` is in, and `place_label`/`place_label_en` carry the display string so
-- no consumer has to own a code→name dictionary.
--
-- WHY THE LABEL IS STORED, not joined. Every existing code→name hook in the app
-- (src/data/municipalities/*, src/data/regions/*) is keyed on the SELECTED ELECTION,
-- and a /person page is not election-scoped. Materialising the label here is a few
-- hundred KB across the table and removes the need for a person-page place
-- dictionary entirely.
--
-- ADDITIVE. `place` is deliberately left in place by this migration; it is dropped
-- only after every consumer has moved (plan T4), so T1..T3 can land independently
-- and a half-migrated database still serves.

ALTER TABLE person_role
  ADD COLUMN IF NOT EXISTS place_kind     text,
  ADD COLUMN IF NOT EXISTS place_code     text,
  ADD COLUMN IF NOT EXISTS place_label    text,
  ADD COLUMN IF NOT EXISTS place_label_en text;

-- The namespace tag. `mir` is the ELECTORAL constituency (31 of them — Пловдив
-- град/област are two, `PDV-00` and `PDV`), deliberately NOT the statistical oblast
-- (28), which is a different rollup and belongs only in the resolver's corroborant.
-- `obshtina` is the app's own obshtina code (`BLG11`, `S2309`, and the synthetic
-- city-wide `SFO_CITY`). `judicial` is a judicial_body.body_code (migration 116).
ALTER TABLE person_role DROP CONSTRAINT IF EXISTS person_role_place_kind;
ALTER TABLE person_role ADD CONSTRAINT person_role_place_kind
  CHECK (place_kind IS NULL OR place_kind IN ('mir', 'obshtina', 'judicial'));

-- Never a kind without a code, never a code without a kind. Consumers get ONE check
-- instead of two, and the 394 magistrate roles with no court / the 16,124 candidacies
-- with no МИР land in one unambiguous state rather than a half-filled one.
ALTER TABLE person_role DROP CONSTRAINT IF EXISTS person_role_place_pair;
ALTER TABLE person_role ADD CONSTRAINT person_role_place_pair
  CHECK ((place_kind IS NULL) = (place_code IS NULL));

-- Pre-provisioned for the "who holds office in place X" lookup that T4/T5 open up, and
-- shaped `(place_code, source)` because that is what such a query filters on.
--
-- Explicitly NOT for the municipal roster: 102_municipal_officials.sql is a whole-table
-- REFRESH filtered on `source`, so the planner seq-scans it regardless of what indexes
-- exist here. The person page rides the PK's leading person_id. So this index has no
-- reader today and is maintained on every COPY of ~143k rows per resolve — cheap, but
-- do not mistake it for something load-bearing.
CREATE INDEX IF NOT EXISTS idx_person_role_place
  ON person_role (place_code, source)
  WHERE place_code IS NOT NULL;
