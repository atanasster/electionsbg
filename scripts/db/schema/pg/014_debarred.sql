-- АОП debarred-suppliers register (data/procurement/debarred.json → PG) so the
-- DB company page can show a "debarred" red flag entirely from Postgres.
--
-- The register is NAME-ONLY (no EIK), so matching is by name. debar_norm() folds
-- a name to lowercase-latin-alnum via translit_bg_latin (000) + stripping every
-- non-alnum char — applied to BOTH the debarred name and the company's names, so
-- '„Нед палас" ООД' and 'НЕД ПАЛАС ООД' both fold to 'nedpalasood' and match,
-- independent of case / quotes / spacing.

SET check_function_bodies = off;

CREATE OR REPLACE FUNCTION debar_norm(t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(translit_bg_latin(coalesce(t, '')), '[^a-z0-9]', '', 'g')
$$;

CREATE TABLE IF NOT EXISTS debarred (
  name           text,
  name_norm      text,
  published_at   text,
  debarred_until text,
  details_url    text
);
CREATE INDEX IF NOT EXISTS idx_debarred_norm ON debarred(name_norm);

DROP FUNCTION IF EXISTS company_debarred(text);
CREATE OR REPLACE FUNCTION company_debarred(p_eik text)
RETURNS TABLE(
  name           text,
  debarred_until text,
  details_url    text,
  published_at   text
) LANGUAGE sql STABLE AS $$
  SELECT d.name, d.debarred_until, d.details_url, d.published_at
  FROM debarred d
  WHERE d.name_norm <> ''
    AND d.name_norm IN (
      SELECT debar_norm(name)
      FROM tr_companies WHERE uic = p_eik AND name IS NOT NULL
      UNION
      SELECT DISTINCT debar_norm(contractor_name)
      FROM contracts WHERE contractor_eik = p_eik
    );
$$;
