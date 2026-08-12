-- The searchable body of a tender's dossier — docs/plans/tender-dossier-ingest-v1.md (B3).
--
-- `tenders` exposes two searchable strings: buyer_name and subject. subject is a
-- 138-char headline, so the words a reader actually searches for — the nine coffee
-- types, the 39,000 sugar packets, the brand a specification names — are not in the
-- corpus at all. They live in the dossier's long description, in the rendered
-- обявление, and in the extracted specification text. This table is those three
-- concatenated per procedure, so one gin index serves all of them.
--
-- ⚠️ HOW THIS IS SEARCHED IS PART OF THE SCHEMA. db_table.js folds it into the
-- tenders search as `unp = ANY(ARRAY(SELECT t_unp FROM tender_search_text WHERE …))`
-- — an UNCORRELATED InitPlan whose result is an indexed key equality on `tenders`.
-- The obvious alternative, a correlated `EXISTS`, cannot participate in a BitmapOr
-- and therefore drags the ENTIRE tender search off its indexes: measured for "кафе",
-- the pre-existing arms plan as a BitmapOr in 37 ms, the EXISTS form made the whole
-- query a Seq Scan at 6,617 ms, and this form is 21.5 ms. The regression would hit
-- every search, not only the ones this table can answer.
--
-- The key is `t_unp` rather than `unp` to keep that mistake from compiling: written
-- as a correlated `EXISTS (… WHERE unp = unp)`, two identically-named columns bind
-- BOTH sides to the inner scope — a tautology matching every tender, valid SQL,
-- raising nothing.
--
-- ⚠️ COVERAGE IS PARTIAL AND WILL BE FOR A LONG TIME. The tier-A crawl is ~26h and
-- has run for a sample: 1,861 of 237,321 procedures (0.78%) at the time of writing.
-- A row's ABSENCE therefore means "not crawled yet" far more often than it means
-- "this procedure does not mention that word", so this arm may only ever ADD hits
-- to a search — it must never become a filter, a facet, or a count that a reader
-- could read as corpus-wide. `tender_search_coverage` below is what any UI must
-- consult before making a claim about what was searched.

-- ⚠️ APPLIED BY load_tenders_pg.ts AS WELL AS BY load_tender_dossier_pg.ts, and the
-- first of those is the one that matters. db_table.js reads this table on EVERY
-- global search of the `tenders` resource with no degrade path — a 42P01 there is a
-- 500, not a narrower answer. The dossier loader cannot be the only applier: it is a
-- REFRESH_EXCLUSIONS member (so `db:refresh` never reaches it) and its input is a
-- gitignored ~26 h capture, so on any machine without that capture it has nothing to
-- do. Applying from the loader that owns `tenders` makes the table exist wherever
-- the column it protects exists.
--
-- That is also why every GRANT below is existence-guarded: applied from the tenders
-- loader, 146's seven tables may legitimately not exist yet.

-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tender_search_text (
  t_unp text PRIMARY KEY,
  -- Streamlined-System romanization of description_text ‖ every notice's rendered
  -- text ‖ every extracted document text — the same fold as tenders.buyer_fold and
  -- subject_fold, so one transliterated query matches all of them identically.
  --
  -- ⚠️ THE RAW TEXT IS DELIBERATELY NOT STORED. An earlier cut kept `body text NOT
  -- NULL` with `fold` GENERATED from it, which measured 103 MB at 1,861 rows (avg
  -- body 56 kB, max 1.6 MB) — ~7.3 GB extrapolated to the 131,716-tender work set,
  -- on a prod db-g1-small. Half of that was a pure duplicate that nothing read: the
  -- search arm reads `fold`, and the dossier page re-derives its display text from
  -- tender_dossier / tender_notice / tender_document_text directly. Those three
  -- remain the source of truth for any "why did this match?" snippet.
  fold  text NOT NULL
);

-- ⚠️ FULL-TEXT ONLY — DELIBERATELY NO gin_trgm INDEX, unlike every other fold in
-- this codebase. The `%>` word-similarity arm that 009_tenders.sql pairs with FTS on
-- `subject_fold` CANNOT be used here, and the gap is three orders of magnitude:
-- measured on 1,861 rows for the query "кафе", FTS answered in 0.073 ms off this
-- index while `fold %> …` took 13,490 ms as a seq scan — word_similarity recomputes
-- trigram sets over the WHOLE body per row, and a body here averages a document
-- rather than a 138-char headline. At full corpus that arm is tens of minutes, i.e.
-- far past the 10 s statement_timeout, so it would not be slow — it would 500.
--
-- The cost of dropping it is real and worth stating: no mid-word or near-spelling
-- matching on document text. A prefix-AND FTS query needs whole words. Keeping an
-- unused gin_trgm index instead would pay a large build and write cost on every load
-- for an arm nothing may call.
CREATE INDEX IF NOT EXISTS idx_tender_search_text_fts
  ON tender_search_text USING gin (to_tsvector('simple', fold));

-- ---------------------------------------------------------------------------
-- Prefix search on the УНП (plan §13.7). `unp LIKE 'q%'` does NOT use tenders_pkey:
-- the database is not in the C collation, so a btree built with the default operator
-- class cannot serve a pattern match at all. Measured, the PK gave a full Parallel
-- Index Only Scan — 125 ms, 237,276 rows removed by filter. text_pattern_ops is the
-- collation-independent opclass that makes it a range scan.
CREATE INDEX IF NOT EXISTS idx_tenders_unp_pattern
  ON tenders (unp text_pattern_ops);

-- ---------------------------------------------------------------------------
-- What a caller must read before saying anything about what was searched. Returns
-- the covered procedure count and the corpus it is a fraction of, so the claim is
-- always built from two live numbers rather than from a constant that goes stale in
-- both directions as the crawl advances.
CREATE OR REPLACE FUNCTION tender_search_coverage()
RETURNS TABLE (covered bigint, corpus bigint)
LANGUAGE sql STABLE AS $$
  SELECT (SELECT count(*) FROM tender_search_text),
         (SELECT count(*) FROM tenders);
$$;

-- ---------------------------------------------------------------------------
-- Role-guarded: roles_readonly.sql is a one-time manual step, and an unguarded GRANT
-- raises 42704 on a cold bootstrap, rolling back this whole file (117/130 shape).
--
-- 146's seven tables are granted HERE rather than in 146 because they shipped with no
-- GRANT at all. That is invisible locally — the loader and the data tests connect as
-- the owner — and surfaces only as /api/db 42501 on Cloud SQL against a corpus whose
-- every row count reconciles. Applying this file is what repairs an already-deployed
-- 146; see the grant-guard sweep note in CLAUDE.md.
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON tender_search_text TO app_readonly;
    GRANT EXECUTE ON FUNCTION tender_search_coverage() TO app_readonly;
    -- Existence-guarded: this file is applied by the TENDERS loader too, where 146
    -- may not have run. A bare GRANT would raise 42704 and roll back the whole file
    -- — taking tender_search_text with it, which is the table the tenders search
    -- cannot run without.
    FOREACH t IN ARRAY ARRAY[
      'tender_dossier', 'tender_document', 'tender_document_text', 'tender_notice',
      'tender_announcement', 'tender_contract_item', 'tender_buyer_profile'
    ] LOOP
      IF to_regclass(t) IS NOT NULL THEN
        EXECUTE format('GRANT SELECT ON %I TO app_readonly', t);
      END IF;
    END LOOP;
  END IF;
END $$;
