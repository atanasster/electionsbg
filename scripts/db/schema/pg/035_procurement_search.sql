-- Combined procurement search (Feature: one search box over the whole section).
-- Building blocks the /api/db/procurement-search route queries in parallel
-- (persons are merged client-side from person_procurement_index.json so the
-- bilingual token matching lives in ONE place):
--
--   awarder_search          — distinct buyer eik+name as they appear in the
--                             corpus (mirror of contractor_search; rebuilt on
--                             each load by load_pg.ts)
--   search_awarders()       — fuzzy buyer-name search, procurement volume inline
--   search_contract_titles()— contract-subject search
--   search_tender_subjects()— tender-subject search; plpgsql so creating it
--                             doesn't require the tenders table to exist yet
--                             (loaded by load_tenders_pg)
--
-- Names use pg_trgm word similarity (short strings, typo tolerance). Subjects
-- are long text where trigram rechecks explode on common words (measured 1.7s
-- for "доставка на компютри") — those use FTS prefix-AND over the same
-- translit fold instead (measured <10ms on the same query), ordered by value
-- so the dropdown surfaces the contracts that matter.
--
-- Requires 000_search_fns.sql (translit_bg_latin) + 001_procurement.sql.

CREATE TABLE IF NOT EXISTS awarder_search (
  eik       text NOT NULL,
  name      text NOT NULL,
  name_fold text GENERATED ALWAYS AS (translit_bg_latin(name)) STORED
);
CREATE INDEX IF NOT EXISTS idx_awarder_search_fold
  ON awarder_search USING gin (name_fold gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_awarder_search_eik ON awarder_search (eik);

-- Script-independent subject search: FTS + trigram over the same
-- Cyrillic→Latin fold as every other search surface, so "магистрала" and
-- "magistrala" hit the same rows. STORED column (like tenders.subject_fold),
-- not an expression index: both passes recheck candidate rows, and
-- recomputing the translit chain per row is what the recheck pays for.
-- The tenders twin (idx_tenders_subj_fts) lives in 009_tenders.sql, applied
-- by load_tenders_pg — this file must stay contracts-only-safe.
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS title_fold text
  GENERATED ALWAYS AS (translit_bg_latin(title)) STORED;
CREATE INDEX IF NOT EXISTS idx_contracts_title_fts
  ON contracts USING gin (to_tsvector('simple', title_fold));
-- Trigram twin for the rare-token top-up pass (mid-word matches).
CREATE INDEX IF NOT EXISTS idx_contracts_title_fold_trgm
  ON contracts USING gin (title_fold gin_trgm_ops);

-- Folded query → prefix-AND tsquery ("dostavka:* & komputri:*"); NULL when the
-- query folds to nothing (then @@ NULL matches no rows).
CREATE OR REPLACE FUNCTION fold_prefix_tsquery(q text)
RETURNS tsquery LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT to_tsquery('simple', string_agg(tok || ':*', ' & '))
  FROM (
    SELECT regexp_replace(t, '[^a-z0-9]+', '', 'g') AS tok
    FROM unnest(string_to_array(translit_bg_latin(q), ' ')) AS t
  ) x
  WHERE tok <> '';
$$;

-- Same shape/behavior as search_contractors but over the buyer side.
CREATE OR REPLACE FUNCTION search_awarders(q text, lim int DEFAULT 20)
RETURNS TABLE (
  eik           text,
  name          text,
  contracts     bigint,
  contracts_eur double precision,
  sim           real
)
LANGUAGE sql STABLE PARALLEL SAFE
SET pg_trgm.word_similarity_threshold = 0.4
SET pg_trgm.similarity_threshold = 0.3
AS $$
  WITH qq AS (SELECT translit_bg_latin(q) AS qf)
  SELECT s.eik, s.name,
         (SELECT count(*) FROM contracts k WHERE k.awarder_eik = s.eik),
         (SELECT coalesce(sum(k.amount_eur), 0) FROM contracts k
            WHERE k.awarder_eik = s.eik AND k.tag = 'contract'),
         word_similarity((SELECT qf FROM qq), s.name_fold)
  FROM awarder_search s, qq
  WHERE qq.qf <% s.name_fold
    AND (SELECT bool_and(tok <% s.name_fold)
         FROM unnest(string_to_array(qq.qf, ' ')) AS tok WHERE tok <> '')
  ORDER BY word_similarity((SELECT qf FROM qq), s.name_fold) DESC,
           length(s.name), s.eik
  LIMIT lim;
$$;

-- Contract subjects: every query token must prefix-match; biggest first.
-- Hybrid: the cheap FTS pass answers common-word queries; when it comes back
-- short (rare tokens — e.g. "магистрала струма" won't prefix-match
-- "АВТОмагистрала"), a trigram word-similarity top-up catches mid-word forms.
-- The top-up only fires on rare-token queries, so its recheck set stays small.
CREATE OR REPLACE FUNCTION search_contract_titles(q text, lim int DEFAULT 6)
RETURNS TABLE (
  key             text,
  title           text,
  date            text,
  awarder_name    text,
  contractor_name text,
  amount_eur      double precision
)
LANGUAGE plpgsql STABLE PARALLEL SAFE
SET pg_trgm.word_similarity_threshold = 0.6
AS $$
DECLARE seen text[]; dense boolean; tsq tsquery := fold_prefix_tsquery(q);
BEGIN
  -- First pass keys only; rows are re-fetched by PK so the top-up can exclude
  -- them with a cheap ANY() instead of re-evaluating the FTS predicate.
  --
  -- The ORDER BY value + LIMIT plan is bimodal: on COMMON tokens the planner's
  -- value-index walk finds the top rows immediately (sub-ms), but on RARE
  -- tokens the same walk degenerates into evaluating the tsvector across the
  -- whole table (measured 1.3s) because the match-count estimate is a default
  -- guess. A bounded probe (does the query match ≥500 rows?) picks the plan
  -- explicitly: dense → value-index walk; sparse → materialised bitmap scan
  -- of the few matches. Both corners stay in the tens of milliseconds.
  SELECT count(*) = 500 INTO dense FROM (
    SELECT 1 FROM contracts c
    WHERE c.tag = 'contract' AND c.title IS NOT NULL AND c.title <> ''
      AND to_tsvector('simple', c.title_fold) @@ tsq
    LIMIT 500) p;
  IF dense THEN
    seen := ARRAY(
      SELECT c.key FROM contracts c
      WHERE c.tag = 'contract' AND c.title IS NOT NULL AND c.title <> ''
        AND to_tsvector('simple', c.title_fold) @@ tsq
      ORDER BY c.amount_eur DESC NULLS LAST, c.key
      LIMIT lim);
  ELSE
    seen := ARRAY(
      SELECT m.key FROM (
        WITH m0 AS MATERIALIZED (
          SELECT c.key, c.amount_eur FROM contracts c
          WHERE c.tag = 'contract' AND c.title IS NOT NULL AND c.title <> ''
            AND to_tsvector('simple', c.title_fold) @@ tsq)
        SELECT * FROM m0) m
      ORDER BY m.amount_eur DESC NULLS LAST, m.key
      LIMIT lim);
  END IF;
  RETURN QUERY
  SELECT c.key, c.title, c.date, c.awarder_name, c.contractor_name, c.amount_eur
  FROM contracts c WHERE c.key = ANY(seen)
  ORDER BY c.amount_eur DESC NULLS LAST, c.key;
  IF COALESCE(array_length(seen, 1), 0) < lim THEN
    RETURN QUERY
    WITH qq AS (SELECT translit_bg_latin(q) AS qf)
    SELECT c.key, c.title, c.date, c.awarder_name, c.contractor_name, c.amount_eur
    FROM contracts c, qq
    WHERE c.tag = 'contract' AND c.title IS NOT NULL AND c.title <> ''
      AND qq.qf <% c.title_fold
      AND NOT (c.key = ANY(seen))
    ORDER BY word_similarity((SELECT qf FROM qq), c.title_fold) DESC,
             c.amount_eur DESC NULLS LAST, c.key
    LIMIT lim - COALESCE(array_length(seen, 1), 0);
  END IF;
END;
$$;

-- Tender subjects — same FTS + trigram-top-up hybrid as the contracts search.
-- plpgsql also keeps the body unresolved at CREATE time, so a contracts-only
-- load (tenders table not created yet) still applies this file cleanly.
CREATE OR REPLACE FUNCTION search_tender_subjects(q text, lim int DEFAULT 6)
RETURNS TABLE (
  unp                 text,
  subject             text,
  publication_date    text,
  buyer_name          text,
  estimated_value_eur double precision
)
LANGUAGE plpgsql STABLE PARALLEL SAFE
SET pg_trgm.word_similarity_threshold = 0.6
AS $$
DECLARE seen text[]; dense boolean; tsq tsquery := fold_prefix_tsquery(q);
BEGIN
  -- Density probe — see search_contract_titles for why.
  SELECT count(*) = 500 INTO dense FROM (
    SELECT 1 FROM tenders t
    WHERE t.subject IS NOT NULL AND t.subject <> ''
      AND to_tsvector('simple', t.subject_fold) @@ tsq
    LIMIT 500) p;
  IF dense THEN
    seen := ARRAY(
      SELECT t.unp FROM tenders t
      WHERE t.subject IS NOT NULL AND t.subject <> ''
        AND to_tsvector('simple', t.subject_fold) @@ tsq
      ORDER BY t.estimated_value_eur DESC NULLS LAST, t.unp
      LIMIT lim);
  ELSE
    seen := ARRAY(
      SELECT m.unp FROM (
        WITH m0 AS MATERIALIZED (
          SELECT t.unp, t.estimated_value_eur FROM tenders t
          WHERE t.subject IS NOT NULL AND t.subject <> ''
            AND to_tsvector('simple', t.subject_fold) @@ tsq)
        SELECT * FROM m0) m
      ORDER BY m.estimated_value_eur DESC NULLS LAST, m.unp
      LIMIT lim);
  END IF;
  RETURN QUERY
  SELECT t.unp, t.subject, t.publication_date, t.buyer_name,
         t.estimated_value_eur
  FROM tenders t WHERE t.unp = ANY(seen)
  ORDER BY t.estimated_value_eur DESC NULLS LAST, t.unp;
  IF COALESCE(array_length(seen, 1), 0) < lim THEN
    RETURN QUERY
    WITH qq AS (SELECT translit_bg_latin(q) AS qf)
    SELECT t.unp, t.subject, t.publication_date, t.buyer_name,
           t.estimated_value_eur
    FROM tenders t, qq
    WHERE t.subject IS NOT NULL AND t.subject <> ''
      AND qq.qf <% t.subject_fold
      AND NOT (t.unp = ANY(seen))
    ORDER BY word_similarity((SELECT qf FROM qq), t.subject_fold) DESC,
             t.estimated_value_eur DESC NULLS LAST, t.unp
    LIMIT lim - COALESCE(array_length(seen, 1), 0);
  END IF;
END;
$$;
