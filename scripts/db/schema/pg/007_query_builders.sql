-- Multi-table query builders — unified result sets that span companies,
-- officers, contractors and contracts in one call.
--   search_all(q, lim)          one ranked feed across TR companies + officers +
--                               non-TR contractors (each hit carries procurement).
--   recent_updates(days, lim)   what changed recently across the DB — contracts
--                               first-seen + TR companies/officers changed in the
--                               last `days` (default 1), newest first.
-- Requires 003 (tr tables + timestamps), 005 (contract_first_seen), 006
-- (contractor_search), 000 (translit_bg_latin). Applied by load_tr_pg.ts.
-- See docs/plans/postgres-migration-v1.md.

CREATE OR REPLACE FUNCTION search_all(q text, lim int DEFAULT 30)
RETURNS TABLE (
  kind          text,
  eik           text,
  name          text,
  detail        text,
  contracts     bigint,
  contracts_eur double precision,
  sim           real
)
LANGUAGE sql STABLE PARALLEL SAFE
SET pg_trgm.word_similarity_threshold = 0.4
SET pg_trgm.similarity_threshold = 0.3
AS $$
  WITH qq AS (SELECT translit_bg_latin(q) AS qf),
  comp AS (
    SELECT 'company'::text AS kind, c.uic AS eik, c.name,
           NULLIF(concat_ws(' · ', c.legal_form, c.status), '') AS detail,
           word_similarity((SELECT qf FROM qq), c.name_fold) AS sim
    FROM tr_companies c, qq
    WHERE qq.qf <% c.name_fold
      AND (SELECT bool_and(tok <% c.name_fold)
           FROM unnest(string_to_array(qq.qf, ' ')) AS tok WHERE tok <> '')
  ),
  off AS (
    SELECT 'officer'::text AS kind, o.uic AS eik, o.name,
           NULLIF(concat_ws(' · ', o.roles, co.name), '') AS detail,
           word_similarity((SELECT qf FROM qq), o.name_fold) AS sim
    FROM tr_officers o
    CROSS JOIN qq
    LEFT JOIN tr_companies co ON co.uic = o.uic
    WHERE qq.qf <% o.name_fold
      AND (SELECT bool_and(tok <% o.name_fold)
           FROM unnest(string_to_array(qq.qf, ' ')) AS tok WHERE tok <> '')
  ),
  cont AS (
    -- Contractors NOT in TR (foreign firms, placeholders) — TR-backed ones
    -- already surface via `comp`, so exclude them to avoid duplicates.
    SELECT 'contractor'::text AS kind, s.eik, s.name, NULL::text AS detail,
           word_similarity((SELECT qf FROM qq), s.name_fold) AS sim
    FROM contractor_search s, qq
    WHERE qq.qf <% s.name_fold
      AND NOT EXISTS (SELECT 1 FROM tr_companies c WHERE c.uic = s.eik)
      AND (SELECT bool_and(tok <% s.name_fold)
           FROM unnest(string_to_array(qq.qf, ' ')) AS tok WHERE tok <> '')
  ),
  -- Rank + LIMIT on name match FIRST, so the per-hit procurement summary runs
  -- for only the top `lim` rows (not every trigram candidate).
  matches AS (
    SELECT * FROM (
      SELECT * FROM comp UNION ALL SELECT * FROM off UNION ALL SELECT * FROM cont
    ) u
    ORDER BY sim DESC, length(name)
    LIMIT lim
  )
  SELECT m.kind, m.eik, m.name, m.detail,
         (SELECT count(*) FROM contracts k WHERE k.contractor_eik = m.eik) AS contracts,
         (SELECT coalesce(sum(k.amount_eur), 0) FROM contracts k
            WHERE k.contractor_eik = m.eik AND k.tag = 'contract') AS contracts_eur,
         m.sim
  FROM matches m
  ORDER BY m.sim DESC, contracts_eur DESC NULLS LAST, length(m.name);
$$;

-- recent_updates references ingest_first_seen / ingest_batches.mode (005) and
-- the tenders / fund / ngo tables, which may not all exist when THIS file is
-- applied (007 runs from the TR loader; those tables come from other loaders).
-- Defer body validation — every referenced table exists by CALL time.
SET check_function_bodies = off;
CREATE OR REPLACE FUNCTION recent_updates(days int DEFAULT 1, lim int DEFAULT 1000)
RETURNS TABLE (
  kind       text,
  eik        text,
  name       text,
  detail     text,
  changed_at timestamptz,
  amount_eur double precision
)
LANGUAGE sql STABLE AS $$
  WITH cutoff AS (SELECT now() - make_interval(days => days) AS ts)
  SELECT * FROM (
    -- Contracts first seen in the window (our ingestion time). Gated to 'detail'
    -- batches so a bulk contract backfill surfaces as one summary row (below),
    -- not 100k per-row entries.
    SELECT 'contract'::text AS kind, c.contractor_eik AS eik, c.contractor_name AS name,
           c.awarder_name AS detail, f.first_seen_at AS changed_at, c.amount_eur
    FROM contract_first_seen f
    JOIN ingest_batches b ON b.id = f.batch_id AND b.mode = 'detail'
    JOIN contracts c USING (key)
    CROSS JOIN cutoff
    WHERE f.first_seen_at >= cutoff.ts
    UNION ALL
    -- Per-row detail for every other PG-loaded dataset (tenders, EU fund
    -- projects, NGO funding) whose load delta was small enough to itemise.
    SELECT fs.source AS kind, fs.key AS eik, fs.name, fs.detail,
           fs.first_seen_at AS changed_at, fs.amount_eur
    FROM ingest_first_seen fs
    JOIN ingest_batches b ON b.id = fs.batch_id AND b.mode = 'detail'
    CROSS JOIN cutoff
    WHERE fs.first_seen_at >= cutoff.ts
    UNION ALL
    -- One-line summary for any bulk load (mode='summary', across ALL datasets):
    -- a first cold load or a backfill above the per-loader threshold.
    SELECT 'dataset'::text AS kind, NULL::text AS eik, b.source AS name,
           b.rows_new || ' new · ' || b.rows_total || ' total' AS detail,
           b.loaded_at AS changed_at, NULL::double precision AS amount_eur
    FROM ingest_batches b CROSS JOIN cutoff
    WHERE b.mode = 'summary' AND b.loaded_at >= cutoff.ts
    UNION ALL
    -- TR companies whose registry record changed in the window.
    SELECT 'company', co.uic, co.name,
           NULLIF(concat_ws(' · ', co.legal_form, co.status), ''),
           co.last_updated, NULL::double precision
    FROM tr_companies co CROSS JOIN cutoff
    WHERE co.last_updated >= cutoff.ts
    UNION ALL
    -- TR officers added/erased in the window.
    SELECT 'officer', o.uic, o.name, o.roles, o.changed_at, NULL::double precision
    FROM tr_officers o CROSS JOIN cutoff
    WHERE o.changed_at >= cutoff.ts
  ) u
  ORDER BY changed_at DESC
  LIMIT lim;
$$;
