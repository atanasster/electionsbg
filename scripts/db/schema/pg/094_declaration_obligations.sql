-- 094_declaration_obligations.sql — the register's full listing, and what we hold of it.
--
-- WHAT THIS IS NOT. The audit's T3.5 proposed a "filed vs required" metric on the premise
-- that a `Sent` flag of anything but "True" in the register's list.xml means "не е подал
-- декларация". THAT PREMISE IS FALSE, and it was tested rather than trusted:
--
--   2015/640E558D-E799-4507-BF6A-A0141EA52F4B66791.xml is listed <Sent>False</Sent> for
--   Силвия Трифонова Диманова — and fetching it returns HTTP 200 and a complete 33,702-byte
--   <PublicPerson> declaration. 3,052 of the 3,961 non-"True" rows name a real xmlFile.
--
-- So `Sent` is some workflow state the register does not document, NOT a compliance signal.
-- Publishing "3,961 officials did not declare" would have been a false accusation against
-- named individuals, repeated 3,961 times. No compliance metric is built here, and none may
-- be built on this column until someone establishes what it actually means.
--
-- WHAT THIS IS. The register's complete listing — every declaration node it publishes,
-- 96,402 of them across 2015-2025 — with the raw flag stored UNINTERPRETED. That makes one
-- honest thing computable: how much of what the register lists do we actually hold? That is
-- a statement about OUR coverage, not about anyone's conduct.
--
-- It also exposed a real bug: every ingest on the site skips `Sent != "True"`
-- (scripts/officials/index.ts, scripts/declarations/index.ts, scripts/lib/cacbg_register.ts),
-- so those 3,052 real, fetchable declarations are being discarded — 747 in 2025 alone.

CREATE TABLE IF NOT EXISTS declaration_obligation (
  obligation_id  bigserial PRIMARY KEY,
  -- The register folder — "2025", "2021_nc". Matches declaration.register_year's source.
  folder         text NOT NULL,
  register_year  int  NOT NULL,
  declarant_name text NOT NULL,
  institution    text,
  position_title text,
  category_raw   text,
  -- The register's `Sent` flag, VERBATIM and UNINTERPRETED. Do not read it as
  -- filed/not-filed — see the header. Kept so the question stays answerable if the
  -- register ever documents it.
  sent_flag      boolean NOT NULL,
  -- The filing's XML name; joins to the tail of declaration.source_url.
  xml_file       text
);

-- Retrofit the rename onto a table created before the flag was renamed. The column was
-- first shipped as `filed`, which asserted a compliance meaning the register's own data
-- falsifies; CREATE TABLE IF NOT EXISTS is a no-op on an existing table, so without this
-- the loader's COPY fails with "column sent_flag does not exist".
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'declaration_obligation' AND column_name = 'filed'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'declaration_obligation' AND column_name = 'sent_flag'
  ) THEN
    ALTER TABLE declaration_obligation RENAME COLUMN filed TO sent_flag;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_declaration_obligation_year
  ON declaration_obligation (register_year);
CREATE INDEX IF NOT EXISTS idx_declaration_obligation_institution
  ON declaration_obligation (institution);
CREATE INDEX IF NOT EXISTS idx_declaration_obligation_xml
  ON declaration_obligation (xml_file) WHERE xml_file IS NOT NULL;

-- ---------------------------------------------------------------------------
-- OUR coverage of the register, per year: how many listed declarations we hold. Held is
-- decided by joining the listed xmlFile to the tail of a declaration's source_url — the
-- same identity the loader uses — so this cannot drift from what the site serves.
--
-- A gap here is OUR problem (an ingest that skipped rows, a fetch that failed), never a
-- statement about a declarant.
-- The compliance functions this migration first shipped are dropped, not merely unused:
-- they computed "who did not declare" from a flag that does not mean that, and a lingering
-- definition is a loaded gun for the next caller who finds it in the catalogue.
DROP FUNCTION IF EXISTS declaration_coverage_by_institution(int, int);
DROP FUNCTION IF EXISTS declaration_coverage_by_year();

DROP FUNCTION IF EXISTS register_coverage_by_year();
CREATE OR REPLACE FUNCTION register_coverage_by_year()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'year', register_year,
    'listed', listed,
    'held', held,
    'missing', listed - held,
    'heldPct', round(100.0 * held / NULLIF(listed, 0), 1)
  ) ORDER BY register_year), '[]'::jsonb)
  FROM (
    SELECT o.register_year,
           count(*) AS listed,
           count(*) FILTER (
             WHERE EXISTS (SELECT 1 FROM declaration d
                            WHERE d.source_url LIKE '%/' || o.xml_file)
           ) AS held
      FROM declaration_obligation o
     WHERE o.xml_file IS NOT NULL
     GROUP BY o.register_year
  ) t;
$$;

GRANT SELECT ON declaration_obligation TO app_readonly;
