-- Contract-name search — every contractor AS THEY APPEAR in the contract corpus,
-- so foreign / placeholder contractors absent from TR (~32% of distinct EIKs,
-- ~21.6k contracts: Elsevier, Pesa Bydgoszcz, …) are still findable by name.
-- Derived from contracts (distinct eik+name), rebuilt on each load. Self-contained
-- within the procurement load — no TR dependency. Requires 000_search_fns.sql.
-- See docs/plans/postgres-migration-v1.md (Feature 1).

CREATE TABLE IF NOT EXISTS contractor_search (
  eik       text NOT NULL,
  name      text NOT NULL,
  name_fold text GENERATED ALWAYS AS (translit_bg_latin(name)) STORED
);
CREATE INDEX IF NOT EXISTS idx_contractor_search_fold
  ON contractor_search USING gin (name_fold gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contractor_search_eik ON contractor_search (eik);

-- Same shape/behavior as search_companies but over the contract corpus, so it
-- covers contractors with no TR record. Each hit carries its procurement volume.
CREATE OR REPLACE FUNCTION search_contractors(q text, lim int DEFAULT 20)
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
         (SELECT count(*) FROM contracts k WHERE k.contractor_eik = s.eik),
         (SELECT coalesce(sum(k.amount_eur), 0) FROM contracts k
            WHERE k.contractor_eik = s.eik AND k.tag = 'contract'),
         word_similarity((SELECT qf FROM qq), s.name_fold)
  FROM contractor_search s, qq
  WHERE qq.qf <% s.name_fold
    AND (SELECT bool_and(tok <% s.name_fold)
         FROM unnest(string_to_array(qq.qf, ' ')) AS tok WHERE tok <> '')
  ORDER BY word_similarity((SELECT qf FROM qq), s.name_fold) DESC,
           length(s.name), s.eik
  LIMIT lim;
$$;
