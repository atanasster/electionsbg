-- Covering-index upgrade for the DbDataTable procurement browsers.
--
-- WHY: /procurement/contracts, /procurement/tenders and the per-company /awarder
-- + /company contract lists each fire THREE hot queries per load — a count+sum
-- aggregate and two facet GROUP BYs (procedure mix, single-bid share) — whose
-- supporting index carried the WHERE keys but NOT the aggregated/faceted column.
-- So every one did thousands of random heap fetches to read amount_eur /
-- estimated_value_eur / procurement_method / number_of_tenderers / procedure_type.
-- MEASURED (warm local, this-parliament scope), buffers touched → after:
--   contracts count+sum   11,297 → 5,749 (Heap Fetches 0; all in a 40 MB index)
--   contracts proc facet  11,381 → 5,752
--   company  count+sum     6,393 →    86   (idx_contracts_contractor_tag_amt)
--   company  proc facet    6,411 →    89
--   tenders  count+sum     4,357 →    75   (idx_tenders_order)
--   tenders  proc facet    4,357 →    78
-- Warm on an SSD those were 9–38 ms; cold on the db-g1-small serving instance the
-- ~1 GB heap does not fit cache and the random reads hit disk — the slow first
-- load. Confining every read to a compact, fully-cacheable index removes it.
--
-- The fix has two halves that ONLY pay off together:
--   1. this file — grow the browser indexes with INCLUDE (summed + faceted
--      columns) so the aggregate/facet is an Index-Only Scan, and
--   2. functions/db_table.js — route the aggregate + facet queries at the BASE
--      table, not the contracts_list / tenders_list VIEW. The view's LEFT JOINs
--      (appeal flags, risk cache) BLOCK index-only scans: MEASURED, the all-years
--      count+sum stayed a 940 MB parallel seq scan through the view even with this
--      index present, and collapsed to a 40 MB index-only scan against the base.
-- Neither half helps much alone.
--
-- NAMES ARE PRESERVED: a btree name describes its KEY columns, which are unchanged
-- here — only the leaf INCLUDE payload grows — so every reference to these index
-- names elsewhere (001/009 create the minimal originals, comments in 062/077)
-- stays accurate. An index cannot gain an INCLUDE column in place, so each is
-- DROPped and recreated under the same name. Idempotent. Plain CREATE INDEX (not
-- CONCURRENTLY): the migration runner wraps each file in one implicit transaction;
-- the ShareLock blocks writes (no ingest runs during a deploy) but never the
-- serving reads. Applied by load_tenders_pg.ts — it runs after BOTH base tables
-- and the *_list views (042) exist, unlike load_pg.ts which can run before
-- `tenders` exists on a fresh db:refresh. Depends on: contracts (001), tenders
-- (009). EXECUTE → app_readonly is inherited (indexes need no grant).

-- ── Global contracts browser: WHERE tag = 'contract' AND date >= … [AND date < …]
-- (count+sum(amount_eur) + procurement_method / number_of_tenderers facets). Key
-- unchanged from 001 — the DESC NULLS LAST + key tail still backs the default
-- date-sort page.
DROP INDEX IF EXISTS idx_contracts_tag_date;
CREATE INDEX IF NOT EXISTS idx_contracts_tag_date
  ON contracts (tag, date DESC NULLS LAST, key)
  INCLUDE (amount_eur, procurement_method, number_of_tenderers);

-- ── Per-company (contractor) contract list: WHERE contractor_eik = $1 AND tag =
-- 'contract'. Was INCLUDE (amount_eur) only (001) — the count+sum was index-only
-- but the method + bid-count facets still hit the heap. Adds both facet columns.
-- The 077 dual-corpus IN-list aggregate that "rides" this index is unaffected
-- (same key; a superset INCLUDE only helps).
DROP INDEX IF EXISTS idx_contracts_contractor_tag_amt;
CREATE INDEX IF NOT EXISTS idx_contracts_contractor_tag_amt
  ON contracts (contractor_eik, tag)
  INCLUDE (amount_eur, procurement_method, number_of_tenderers);

-- ── Per-awarder contract list: WHERE awarder_eik = $1 AND tag = 'contract'. No
-- (awarder_eik, tag) covering index existed — the awarder aggregate/facets fell
-- back to idx_contracts_awarder (awarder_eik) + heap. NEW (idx_contracts_awarder_
-- date stays for the windowed awarder rollups; this is the tag-scoped browser).
CREATE INDEX IF NOT EXISTS idx_contracts_awarder_tag_cover
  ON contracts (awarder_eik, tag)
  INCLUDE (amount_eur, procurement_method, number_of_tenderers);

-- ── Global tenders browser: WHERE publication_date >= … [AND publication_date < …]
-- (count+sum(estimated_value_eur) + procedure_type / is_eu_funded facets). Key
-- unchanged from 009 (the 062 hub-count windowed scan still rides it).
DROP INDEX IF EXISTS idx_tenders_order;
CREATE INDEX IF NOT EXISTS idx_tenders_order
  ON tenders (publication_date, unp)
  INCLUDE (estimated_value_eur, procedure_type, is_eu_funded);

-- ── Per-buyer tender pipeline: WHERE buyer_eik = $1. idx_tenders_buyer_value
-- (buyer_eik, estimated_value_eur DESC NULLS LAST, unp DESC) already covers the buyer
-- count+sum (value is in its key); this one adds the facet columns so the buyer
-- procedure / eu-funded facets are index-only too.
--
-- ⚠️ Key unchanged from 009, and its NULLS FIRST spelling is DELIBERATE — see 009's header.
-- Re-spelling it to match db_table.js's buildOrder (`publication_date DESC NULLS LAST, unp`)
-- wins the browser's opt-in date sort 4,356 → 2,103 buffers and LOSES tenders_by_buyer, the
-- awarder page's default load, 254 → 2,603, because the planner then abandons the buyer seek
-- for a backward scan of idx_tenders_order. Measured A/B on one database. Do not "finish the
-- job" here; it is a named exception in
-- scripts/db/tests/db_table_sort_indexes.data.test.ts.
--
-- idx_tenders_buyer_value needs no change for the opposite reason: its leading key is already
-- NULLS LAST, so the default arrival IS index-served and only the `unp` tiebreak costs an
-- Incremental Sort — measured at ONE buffer (2,107 → 2,106).
DROP INDEX IF EXISTS idx_tenders_buyer_date;
CREATE INDEX IF NOT EXISTS idx_tenders_buyer_date
  ON tenders (buyer_eik, publication_date DESC, unp DESC)
  INCLUDE (estimated_value_eur, procedure_type, is_eu_funded);
