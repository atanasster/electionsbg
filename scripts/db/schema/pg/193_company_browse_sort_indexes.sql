-- The sort indexes company_browse_table was missing — on their own, so a warm database can
-- pick them up without rebuilding the matview.
--
-- WHY THIS FILE EXISTS RATHER THAN JUST THE LINES IN 188.
--
-- They belong in 188 too, and are there, so a fresh build has them beside their siblings.
-- But 188 opens with `DROP MATERIALIZED VIEW IF EXISTS company_browse_table` — so applying 188 to
-- a warm database to pick up one index rebuilds all 1,022,592 rows, and the `companies`
-- DbDataTable resource reads that base relation with NO `missingMigration` degrade. `/companies`
-- would therefore 500 outright for the whole rebuild, not degrade to an empty page.
--
-- That is the hazard CLAUDE.md states for 122: *"Do not add `122_contractor_rank.sql` to that
-- command — 122 DROPs and recreates `contractor_rank` WITH NO DATA, and /procurement/contractors
-- reads it WITHOUT degrading, so applying it would blank that page until a multi-minute refresh
-- finished."* Same shape, same resolution: a separate, idempotent file.
--
-- WHAT IT FIXES. All four numeric columns on /companies are sortable, and only `public_money_eur`
-- was properly served: „Поръчки" (`contract_count`) had no index at all, and the other two had
-- only a plain one — which is not enough, per the PAIR note below. Measured 2026-08-26 for
-- „Поръчки", the worst of the three:
--
--   before (no index)              page 1        23,578 buffers, parallel seq scan + heapsort
--   plain index, contract-leading  page 1            39 buffers
--   plain index, contract-leading  OFFSET 20000 1,030,451 buffers ← WORSE than the seq scan
--   this pair                      page 1            28 buffers
--   this pair                      OFFSET 20000  20,068 buffers
--
-- ⚠️ A PAIR, NOT ONE INDEX. The default view always sends `has_signal = true`, which rejects
-- 90.3% of the corpus (923,855 of 1,022,592). An index that does not LEAD with it turns that
-- into a row Filter, so any page past the first reads the whole table — which is how a
-- contract-leading index alone measured 1,030,451 buffers at OFFSET 20000, worse than the seq
-- scan it was meant to remove. 188 already solved this for `public_money_eur` with exactly this
-- shape (`idx_company_browse_default` has_signal-leading + `idx_company_browse_money` plain);
-- the plain half is what serves `showAll` and `count(*) WHERE contract_count > 0`.
--
-- ⚠️ THE TIEBREAK IS `uic` ALONE, NOT `name, uic`. `buildOrder` appends exactly ONE tiebreak —
-- `r.columns.key ? "key" : r.select[0]` — and `companies` declares no `key`, so it is
-- select[0] = `uic`. The page's three other numeric indexes carry `name` only because it is an
-- explicit term in `defaultSort`, which a header click REPLACES. Spelled `(…, name, uic)` this
-- leaves `uic` unsorted and Postgres degrades to an Incremental Sort on top of the scan.
--
-- ⚠️ `DESC NULLS LAST` IS LOAD-BEARING. `db_table.js`'s `buildOrder` emits `<col> DESC NULLS
-- LAST` for every descending sort, while a plain DESC index is NULLS FIRST — mismatched, the
-- sort stops being an index walk and silently becomes the seq scan this file exists to remove.
-- 188's own index comments say the same. Gate: db_table_sort_indexes.data.test.ts.
--
-- ⚠️ THE OTHER TWO COLUMNS ARE A SECOND INSTANCE OF THE SAME DEFECT, found by the gate written
-- for the first. `contractor_total_eur` and `person_count` each had the plain half from 188 and
-- no has_signal-leading partner, so both were reading the whole table on any page past the
-- first — measured at OFFSET 20000 on the default view, before these:
--
--   public_money_eur      206 buffers  ← the only column with a partner
--   contractor_total_eur  1,031,019    ← index scan + Rows Removed by Filter: 923,855
--   person_count             23,331    ← planner abandons the index for a full Sort
--
-- ⚠️ NOTHING APPLIES THIS FILE AUTOMATICALLY — it is "applied, never loaded". No `db:load:*`
-- ships it and `deploy:db` ships function CODE, which is a different thing from a Postgres
-- index. On every database that already has `company_browse_table`, run:
--
--   DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg \
--     npx tsx scripts/db/apply_functions.ts 193_company_browse_sort_indexes.sql
--
-- Safe to run at any time and idempotent. It takes a SHARE lock on the matview, so /companies
-- reads through it — but SHARE conflicts with the AccessExclusive a plain REFRESH takes, and
-- FOUR loaders refresh this matview (`declarations --resolve`, `graph`, `tr-company-place`,
-- `db:load:pg`). Do not run it against a database mid-reload: the CREATE INDEXes and the REFRESH
-- will queue behind each other, and everything else waiting on the matview queues behind them.

CREATE INDEX IF NOT EXISTS idx_company_browse_contracts_default
  ON company_browse_table (has_signal, contract_count DESC NULLS LAST, uic);
-- The same pairing for the other two columns (see the header for their before/after).
-- 40 MB each. A partial `… WHERE has_signal` is 3.9 MB and plans the same, but the planner
-- prefers the leading form when both exist and `idx_company_browse_default` above already
-- establishes that shape here; consistency is worth more than 36 MB on a 37 GB volume.
CREATE INDEX IF NOT EXISTS idx_company_browse_contractor_total_default
  ON company_browse_table (has_signal, contractor_total_eur DESC NULLS LAST, uic);
CREATE INDEX IF NOT EXISTS idx_company_browse_person_count_default
  ON company_browse_table (has_signal, person_count DESC NULLS LAST, uic);
CREATE INDEX IF NOT EXISTS idx_company_browse_contract_count
  ON company_browse_table (contract_count DESC NULLS LAST, uic);
