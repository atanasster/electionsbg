-- 117_place_dim.sql — the canonical PLACE dimension: one dictionary for every
-- code→name lookup that is NOT election-scoped.
--
-- WHY IT EXISTS. Two consumers had to work around the absence of this table.
--   1. person_role (115) MATERIALISED place_label/place_label_en at write time, and its
--      own header says why: "every code→name hook in the app is keyed on the SELECTED
--      ELECTION (src/data/municipalities/*, src/data/regions/*) and a /person page is not
--      election-scoped, so there is no cheap client-side lookup". This table is that
--      lookup, so those two columns become a join.
--   2. /procurement/by-settlement shipped the 940 KB data/settlements.json to the BROWSER
--      just to localise a settlement name into English.
--
-- THREE NAMESPACES, deliberately distinct — `kind` mirrors person_role.place_kind:
--   settlement  EKATTE code (5 digits).
--   obshtina    the app's obshtina code (BLG11, S2309) PLUS the synthetic city-wide
--               SFO_CITY, which is not an EKATTE municipality and is absent from
--               data/municipalities.json (scripts/officials/municipality_join.ts mints
--               it). It is the ONE code the source file cannot label.
--   mir         the 31 ELECTORAL constituencies — NOT the 28 statistical oblasts. Пловдив
--               splits into град (PDV-00, МИР 16) and област (PDV, МИР 17), and Sofia city
--               elects from three (S23/S24/S25). Naming a constituency by its oblast would
--               merge distinct electorates on a person's profile.
--
-- Both the settlement and obshtina namespaces ADDITIONALLY carry the out-of-country voting
-- geography inherited from the source files: 88 countries keyed by ISO code as settlements
-- (AU, AT, DZ…) and 6 continents as obshtini (EU, AS, AF, NA, SA, OC). They are kept rather
-- than filtered — obshtinaLabels() is the producer person_role's labels come from, and
-- dropping a code it contains would re-open the byte-identity gap this table closes — and
-- they carry a NULL oblast_code and mir_code.
--
-- The JUDICIAL namespace stays in judicial_body (116): it carries kind/tier/geo this table
-- has no column for, and person_role already joins it by body_code. 082_person_api.sql
-- resolves 'mir'/'obshtina' labels from here and 'judicial' from judicial_body.
--
-- CONTAINMENT COLUMNS name the places CONTAINING the row, and are NULL on the row's own
-- kind (a mir row has no mir_code). Both oblast_code and mir_code exist because the two
-- namespaces genuinely disagree: oblast_code is the STATISTICAL oblast (the oblastToCanon
-- fold — PDV-00→PDV, S2x→SOFIA_CITY), mir_code is the constituency. Note that the `oblast`
-- field in data/settlements.json and data/municipalities.json is really the МИР namespace
-- (its 32 distinct values are the 31 МИР codes plus "32", the out-of-country pseudo-code),
-- which is what makes both columns derivable from that one field. Values the fold cannot
-- place — notably the out-of-country pseudo-code "32" — are stored as NULL rather than
-- verbatim, so no consumer inherits a bucket it cannot name.
--
-- oblast_code POINTS INTO OBLAST_NAME (src/lib/regionalOblast.ts) AND, since the place-header
-- consolidation (place-header-consolidation-v1), ALSO into this table's own kind='oblast'
-- rows — the 28 statistical oblast names, loaded from OBLAST_NAME. That kind was added when a
-- consumer finally needed the name from SQL: the shared place hero / seat line resolves an
-- oblast label as a self-join instead of shipping a client-side dictionary. The procurement
-- choropleth still folds+labels oblasti client-side; it does not read these rows.
--
-- SOFIA ALIAS CROSSWALK (shard_code / governance_code / price_code). Sofia city-wide has
-- five code tokens in circulation — SFO_CITY (officials/person), SOF (local-election
-- shards + council), SOF00 (governance/My-Area), SOF46 (price tree), and the S2*** районы
-- — and the remaps between them are hand-rolled across dozens of files. These columns are
-- the canonical home for that crosswalk. Only the SFO_CITY row carries them, and NO
-- consumer reads them yet: they are scaffolding for a later consolidation, not a live
-- contract. The CHECK below ties them to that one row so "NULL" can never be misread as
-- "this place has no alias" — it means "not Sofia, the question does not apply".

CREATE TABLE IF NOT EXISTS place_dim (
  kind            text NOT NULL
    CHECK (kind IN ('settlement', 'obshtina', 'mir', 'oblast')),
  code            text NOT NULL,
  name_bg         text NOT NULL,
  name_en         text,
  -- Containing places (NULL on the row's own kind).
  oblast_code     text,                  -- statistical oblast (oblastToCanon fold)
  obshtina_code   text,                  -- settlements only
  mir_code        text,                  -- electoral constituency
  -- Sofia-only alias crosswalk; NULL on every other row.
  shard_code      text,                  -- local-election shard tree  ('SOF')
  governance_code text,                  -- governance / My-Area       ('SOF00')
  price_code      text,                  -- price tree                 ('SOF46')
  PRIMARY KEY (kind, code),
  -- The crosswalk describes exactly one place; enforced rather than narrated.
  CONSTRAINT place_dim_sofia_aliases CHECK (
    (shard_code IS NULL AND governance_code IS NULL AND price_code IS NULL)
    OR (kind = 'obshtina' AND code = 'SFO_CITY')
  )
);

-- The person-label join and the procurement name join are both (kind, code) equality —
-- the primary key serves them. This index serves the reverse question ("every settlement
-- in this obshtina"), which the procurement roll-ups ask.
CREATE INDEX IF NOT EXISTS idx_place_dim_obshtina
  ON place_dim (obshtina_code) WHERE obshtina_code IS NOT NULL;

-- Guarded because this file is applied by db:resolve:persons (SCHEMA_FILES, before 082),
-- which must still work on a cold bootstrap where roles_readonly.sql has never run — an
-- unconditional GRANT to a missing role would abort the whole resolve.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON place_dim TO app_readonly;
  END IF;
END $$;

-- ── Header-completeness (place-header-consolidation-v1) ──────────────────────────────────
-- Two columns the shared place hero / seat line need beyond a name:
--   loc              "lon,lat" centroid string — the hero's static map thumbnail.
--                    Settlements + obshtini carry one; mir/oblast/diaspora rows are NULL.
--   settlement_type  the t_v_m marker (с./гр./…) shown before a settlement's name.
-- Added as idempotent ALTERs rather than folded into the CREATE above BECAUSE 117 is
-- CREATE TABLE IF NOT EXISTS and is already live on Cloud SQL (applied on every
-- db:resolve:persons) — an amended CREATE would never touch the existing table. The loader
-- (load_place_dim_pg.ts) self-applies THIS file before its TRUNCATE+COPY, so these columns
-- (and the widened kind check below) land before the new column values / oblast rows do.
ALTER TABLE place_dim ADD COLUMN IF NOT EXISTS loc             text;
ALTER TABLE place_dim ADD COLUMN IF NOT EXISTS settlement_type text;

-- Widen the kind check to admit kind='oblast'. The inline CHECK above already lists it for a
-- COLD bootstrap; this guarded swap is what migrates an EXISTING table (where CREATE TABLE IF
-- NOT EXISTS was a no-op and the old 3-value check is still in force). Postgres has no
-- ADD CONSTRAINT IF NOT EXISTS, so: drop whatever kind-only check exists (by definition, NOT
-- the multi-column place_dim_sofia_aliases one, which also mentions `kind`), then add the
-- named 4-value check if absent. Idempotent — re-applied on every db:resolve:persons.
DO $$
DECLARE cn text;
BEGIN
  FOR cn IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'place_dim' AND c.contype = 'c'
       -- Target ONLY the kind-set check, in either the raw ('kind IN (…)') or the
       -- catalog-normalised ('kind = ANY (ARRAY[…])') rendering — NOT any check that merely
       -- mentions `kind` (place_dim_sofia_aliases carries `kind = 'obshtina'`, excluded both
       -- by the pattern below and, belt-and-suspenders, by the shard_code guard).
       AND (
         pg_get_constraintdef(c.oid) LIKE '%kind IN %'
         OR pg_get_constraintdef(c.oid) LIKE '%kind = ANY%'
       )
       AND pg_get_constraintdef(c.oid) NOT LIKE '%shard_code%'
  LOOP
    EXECUTE format('ALTER TABLE place_dim DROP CONSTRAINT %I', cn);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'place_dim' AND c.conname = 'place_dim_kind_check'
  ) THEN
    ALTER TABLE place_dim
      ADD CONSTRAINT place_dim_kind_check
      CHECK (kind IN ('settlement', 'obshtina', 'mir', 'oblast'));
  END IF;
END $$;
