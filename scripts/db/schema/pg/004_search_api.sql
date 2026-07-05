-- Name-search API — the two functions the live endpoint calls. Both fold the
-- query with translit_bg_latin, require every query token to word-match the
-- folded name (order-independent, partial, fuzzy), and rank by whole-string word
-- similarity. The per-function SET clauses lower the trigram thresholds for the
-- duration of the call (index-friendly: the <% operator still uses the GIN
-- index) without touching any session/global state.
-- Requires 003_tr_search.sql (tables) + 000_search_fns.sql (translit_bg_latin).
-- See docs/plans/postgres-migration-v1.md (Feature 1).

-- Companies by name. contracts / contracts_eur summarize the firm's procurement
-- (contractor_eik = uic) so a hit surfaces both the company AND its contracts.
CREATE OR REPLACE FUNCTION search_companies(q text, lim int DEFAULT 20)
RETURNS TABLE (
  uic           text,
  name          text,
  legal_form    text,
  status        text,
  contracts     bigint,
  contracts_eur double precision,
  sim           real
)
LANGUAGE sql STABLE PARALLEL SAFE
-- 0.5, not 0.4: at 0.4 a no-real-match query surfaces near-miss noise
-- ("Невзоров" → "Невз"/"ВЗОРОВА"/"ЗОРОВ-97" at ws 0.44). Legit prefix/exact
-- hits score >=0.6, so 0.5 drops the noise without hurting recall.
SET pg_trgm.word_similarity_threshold = 0.5
SET pg_trgm.similarity_threshold = 0.3
AS $$
  WITH qq AS (SELECT translit_bg_latin(q) AS qf)
  SELECT c.uic, c.name, c.legal_form, c.status,
         (SELECT count(*) FROM contracts k WHERE k.contractor_eik = c.uic),
         (SELECT coalesce(sum(k.amount_eur), 0) FROM contracts k
            WHERE k.contractor_eik = c.uic AND k.tag = 'contract'),
         word_similarity((SELECT qf FROM qq), c.name_fold)
  FROM tr_companies c, qq
  -- Index-usable candidate filter (GIN trigram) first, THEN the strict
  -- every-token refine — otherwise the token subquery forces a full seq scan.
  WHERE qq.qf <% c.name_fold
    AND (SELECT bool_and(tok <% c.name_fold)
         FROM unnest(string_to_array(qq.qf, ' ')) AS tok WHERE tok <> '')
  ORDER BY word_similarity((SELECT qf FROM qq), c.name_fold) DESC,
           length(c.name), c.uic
  LIMIT lim;
$$;

-- Officers by name → the company they're tied to (+ that company's procurement).
CREATE OR REPLACE FUNCTION search_officers(q text, lim int DEFAULT 20)
RETURNS TABLE (
  officer       text,
  roles         text,
  active        integer,
  uic           text,
  company       text,
  contracts     bigint,
  contracts_eur double precision,
  sim           real
)
LANGUAGE sql STABLE PARALLEL SAFE
-- 0.5, not 0.4: mirror search_companies — 0.4 admits near-miss surname noise.
SET pg_trgm.word_similarity_threshold = 0.5
SET pg_trgm.similarity_threshold = 0.3
AS $$
  WITH qq AS (SELECT translit_bg_latin(q) AS qf)
  SELECT o.name, o.roles, o.active, o.uic, c.name,
         (SELECT count(*) FROM contracts k WHERE k.contractor_eik = o.uic),
         (SELECT coalesce(sum(k.amount_eur), 0) FROM contracts k
            WHERE k.contractor_eik = o.uic AND k.tag = 'contract'),
         word_similarity((SELECT qf FROM qq), o.name_fold)
  FROM tr_officers o
  CROSS JOIN qq
  LEFT JOIN tr_companies c ON c.uic = o.uic
  WHERE qq.qf <% o.name_fold
    AND (SELECT bool_and(tok <% o.name_fold)
         FROM unnest(string_to_array(qq.qf, ' ')) AS tok WHERE tok <> '')
  ORDER BY word_similarity((SELECT qf FROM qq), o.name_fold) DESC,
           o.active DESC NULLS LAST, length(o.name), o.uic
  LIMIT lim;
$$;
