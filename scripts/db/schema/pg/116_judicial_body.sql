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
-- "every prosecution office", "every court in X" — the two ways the dimension is sliced.
CREATE INDEX IF NOT EXISTS idx_judicial_body_kind ON judicial_body (kind, tier);
CREATE INDEX IF NOT EXISTS idx_judicial_body_place ON judicial_body (place_code)
  WHERE place_code IS NOT NULL;
