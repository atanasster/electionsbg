-- ЕВРОФОНДОВЕ (ИСУН) project search — the 5th group in the combined procurement
-- search (functions/db_routes.js "procurement-search") + the project-file picker
-- (§4.1). Unlike contracts/tenders, fund_projects has no transliterated *_fold
-- column, only a gin_trgm index on the raw Cyrillic `title` (016_fund_projects),
-- so this searches `title` directly by trigram word-similarity — index-backed and
-- adequate for the Cyrillic project titles. Returned rows are manual-add-only in
-- the picker (no ЗОП lineage — §2), keyed by contract_number.
--
-- STABLE + PARALLEL SAFE; the word_similarity threshold is set per-call so the
-- session GUC isn't relied upon.
CREATE OR REPLACE FUNCTION search_fund_projects(q text, lim int DEFAULT 6)
RETURNS TABLE (
  contract_number  text,
  title            text,
  beneficiary_eik  text,
  beneficiary_name text,
  program_name     text,
  total_eur        double precision,
  paid_eur         double precision,
  status           text
)
LANGUAGE sql STABLE PARALLEL SAFE
SET pg_trgm.word_similarity_threshold = 0.5
AS $$
  SELECT f.contract_number, f.title, f.beneficiary_eik, f.beneficiary_name,
         f.program_name, f.total_eur, f.paid_eur, f.status
  FROM fund_projects f
  WHERE f.title IS NOT NULL AND f.title <> ''
    AND q <% f.title                       -- gin_trgm word-similarity (idx_fund_projects_title)
  ORDER BY word_similarity(q, f.title) DESC,
           f.total_eur DESC NULLS LAST,
           f.contract_number
  LIMIT lim
$$;
