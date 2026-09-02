-- ЕВРОФОНДОВЕ (ИСУН) project search — the 5th group in the combined procurement
-- search (functions/db_routes.js "procurement-search") + the project-file picker
-- (§4.1) + the home finder's funds group. Returned rows are manual-add-only in
-- the picker (no ЗОП lineage — §2), keyed by contract_number.
--
-- ⚠️ TWO ARMS, NOT ONE FOLDED PREDICATE, and the difference is the whole design.
--
-- `fund_projects.title` is raw Cyrillic and this function searched it directly, so a Latin
-- keyboard reached NOTHING here while places, people, institutions, companies, contracts and
-- tenders all support one. Measured: `search_fund_projects('ремонт', 6)` returned 6 rows and
-- `search_fund_projects('remont', 6)` returned 0.
--
-- ⚠️ THE FOLDED ARM IS GATED ON THE QUERY CARRYING NO CYRILLIC, AND THAT GATE IS THE
-- DIFFERENCE BETWEEN A FIX AND A 3x REGRESSION. Measured on the full 82,283-row corpus: for
-- „ремонт" the raw arm returns 701 candidates AT THE 0.5 THRESHOLD THIS FUNCTION PINS, the
-- folded arm returns 701, and the folded arm contributes ZERO rows the raw arm did not —
-- because 82,236 of 82,283 titles are Cyrillic, so folding both sides of a Cyrillic query
-- re-derives the same matches. (Quote the threshold with any candidate count here: the same
-- probe is 689 at pg_trgm's 0.6 default, and a helper written without the `SET` measures a
-- different predicate. That is not hypothetical — this file's first draft said 689.)
--
-- It is not free: the gin index is lossy for `<%`, so every candidate is rechecked by
-- evaluating `translit_bg_latin(title)` again, and „енергийна ефективност" went 124 ms ->
-- 384 ms and 2,248 -> 24,400 buffers.
--
-- ⚠️ THE GATE IS ALSO A CORRECTNESS PROPERTY, not only a cost one, and that is the stronger
-- reason to keep it: on „оса" an ungated fold CHANGES 5 of the 6 rows returned. A Cyrillic
-- query's result set is only provably unchanged because the folded arm does not run for it.
--
-- The 47 Latin-only titles are English project names („OddStorm Parsers", „Maritsa PV+BESS"),
-- not transliterated Bulgarian — measured, ZERO of them are reachable from any of nine common
-- Bulgarian query words through the fold. So the gate loses nothing real. If the corpus ever
-- acquires transliterated-Bulgarian titles, drop the gate, pay the cost, and re-derive the
-- „unchanged" claim, which the gate is what makes true.
--
-- ⚠️ RESULT IS BYTE-IDENTICAL; COST IS NOT, and an earlier draft of this header claimed both.
-- Measured through the function, worst probe first — max shared buffers, which is the portable
-- signal (wall-clock hides this locally: 120 ms -> 145 ms, because everything is in
-- shared_buffers):
--
--   query                    single-arm   this function
--   енергийна ефективност         1,268           2,424
--   обучение                        509           2,142
--   училище                         493           1,444
--   ремонт                          431           1,300
--
-- ~2-3x, in absolute terms 1,300-2,400 buffers, well inside the ~2,000-per-view budget the
-- dashboard-hub discipline sets and far from the 22,624 this cost before the LIMIT was pushed
-- in front of the join-back (see `top` below). The residue is the UNION ALL + DISTINCT ON
-- structure, which is paid even when the folded branch is dropped.
--
-- The obvious fix — fold both sides and search the fold — is WRONG, and it is wrong quietly.
-- `translit_bg_latin` changes the trigram set (`ж` becomes `zh`, two characters where there
-- was one), so every existing Cyrillic query gets different `word_similarity` scores against
-- a threshold this function PINS at 0.5. Both the RANKING and the MEMBERSHIP of today's
-- results move, with nothing failing and no way to see it from a row count.
--
-- So the raw arm stays exactly as it was and the folded arm is added beside it, with an
-- explicit `arm` rank so an exact hit outranks a folded one at equal similarity. That skeleton
-- is `search_interreg_operations`'s (138) — `hits` / `DISTINCT ON` / `ORDER BY sim DESC, arm` /
-- `LIMIT GREATEST` / the pinned 0.5 — and its comment records the regression that motivated
-- the arm rank there: on „Благоевград" three Latin-named partners tied at 1.000 with
-- `Община Благоевград` and pushed it out of a 6-row preview by id order alone.
--
-- ⚠️ WITH ONE DEPARTURE, AND IT IS THIS FILE'S MOST LOAD-BEARING PREDICATE. 138's folded arm
-- is UNCONDITIONAL and its comment calls that deliberate („both sides folded, so it is
-- symmetric: a Cyrillic query also reaches a Latin-named partner") — because Interreg PARTNER
-- names are routinely Latin. ИСУН project TITLES are not: 82,236 of 82,283 are Cyrillic. A
-- future reader „restoring symmetry" from 138 would reintroduce both the 3x cost and the
-- „оса" result change.
--
-- ⚠️ THE FOLDED ARM NEEDS AN EXPRESSION INDEX, AND THAT INDEX IS THE FOURTH MEMBER OF A
-- CLASS `176_translit_homoglyph_refold.sql` DOES NOT TOUCH. That file recomputes STORED
-- generated `*_fold` columns whenever `translit_bg_latin`'s body changes — and explicitly
-- does NOT cover `tender_search_text.fold`, which its own header hands to a separate
-- `--refold` pass because a loader writes that column rather than Postgres generating it.
-- Postgres does NOT reindex an expression index on an
-- IMMUTABLE function's body change — the index keeps the OLD fold while queries evaluate the
-- new one — so any such index must be REINDEXed in the same maintenance window. The others
-- are `idx_official_roster_fold` and `idx_mp_roster_fold` (080, btree) and
-- `idx_interreg_partners_name_fold_trgm` (137, gin):
--
--   REINDEX INDEX CONCURRENTLY idx_fund_projects_title_fold_trgm;
--
-- ⚠️ WHY AN EXPRESSION INDEX AND NOT A STORED `title_fold` COLUMN like `contracts.title_fold`
-- / `tenders.subject_fold`. A STORED generated column REWRITES the heap into a new
-- relfilenode whose visibility map is EMPTY — the `price_products.title_fold` incident, where
-- `relallvisible` went to 0 on both databases and an `ANALYZE` afterwards was the disguise
-- rather than the fix (it stamps `last_analyze` and marks no pages). `load_funds_pg.ts` DOES
-- vacuum `fund_projects` after its reload — so the recovery would in fact run — but only on a
-- LOAD, and the rewrite happens on the ALTER, which this file's own apply path performs
-- without one. An expression index adds a ShareLock for its build and touches no heap, so the
-- question does not arise.
--
-- ⚠️ `exec()` SENDS THIS FILE AS ONE TRANSACTION, so the index cannot be CONCURRENTLY. It is
-- a ShareLock over 82,283 rows — seconds — but this file is applied on the Cloud SQL publish
-- path (`db:load:funds:pg:cloud`, including `--payloads-only`, which applies the schemas
-- before its shard-reading branch), so it blocks writers to `fund_projects` while it builds.
--
-- STABLE + PARALLEL SAFE; the word_similarity threshold is set per-call so the
-- session GUC isn't relied upon.

-- The raw-Cyrillic arm's index (016_fund_projects). Named here because this function is its
-- only consumer and a future reader deleting it would silently seq-scan the raw arm.
--   CREATE INDEX idx_fund_projects_title ON fund_projects USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_fund_projects_title_fold_trgm
  ON fund_projects USING gin (translit_bg_latin(title) gin_trgm_ops);

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
  WITH hits AS (
    -- Arm 0 — the title AS PUBLISHED. Byte-identical to this function before the folded arm
    -- existed, which is what makes a Cyrillic query's result set provably unchanged.
    --
    -- `total_eur` rides through the CTEs rather than being fetched in the join-back: it is in
    -- the final ORDER BY, so without it here every candidate needs a PK lookup BEFORE the
    -- LIMIT can discard it. Measured on „енергийна ефективност": 22,624 buffers that way
    -- against 1,645 this way, on identical results.
    SELECT f.contract_number, f.total_eur, word_similarity(q, f.title) AS sim, 0 AS arm
      FROM fund_projects f
     WHERE f.title IS NOT NULL AND f.title <> ''
       AND q <% f.title                     -- gin_trgm (idx_fund_projects_title)
    UNION ALL
    -- Arm 1 — both sides folded, so a Latin query reaches a Cyrillic title. Runs ONLY for a
    -- query with no Cyrillic in it: see the header for why that gate is load-bearing rather
    -- than an optimisation. `q !~ '[Ѐ-ӿ]'` is a constant per call, so the planner drops this
    -- whole branch for a Cyrillic needle rather than scanning and discarding.
    SELECT f.contract_number, f.total_eur,
           word_similarity(translit_bg_latin(q), translit_bg_latin(f.title)) AS sim,
           1 AS arm
      FROM fund_projects f
     WHERE q !~ '[Ѐ-ӿ]'
       AND f.title IS NOT NULL AND f.title <> ''
       AND translit_bg_latin(q) <% translit_bg_latin(f.title)  -- idx_fund_projects_title_fold_trgm
  ), best AS (
    -- One row per project: a title both arms match is one result, not two. DISTINCT ON keeps
    -- the strongest arm, so a row that matched as published never loses its rank to its own
    -- folded score. `contract_number` is the PK, so this is 1:1 and the order below is total.
    SELECT DISTINCT ON (contract_number) contract_number, total_eur, sim, arm
      FROM hits ORDER BY contract_number, sim DESC, arm
  ), top AS (
    -- ⚠️ THE LIMIT LANDS HERE, BEFORE THE JOIN-BACK, and that placement is the difference
    -- between 1,645 buffers and 22,624. With the LIMIT below the join, `best` hands every
    -- candidate to a PK lookup and 5,047 of 5,053 are then discarded — a cost the old
    -- single-arm body never paid, because it sorted the scan output directly. Wall-clock
    -- hides it locally (120 ms → 145 ms) since everything is in shared_buffers, which is
    -- precisely why buffers are the portable signal and a local timing is not.
    --
    -- `arm` ranks BELOW sim and above the money: at equal similarity an exact hit must
    -- outrank a folded one, or a Latin-spelled near-match displaces the title the reader
    -- typed.
    SELECT contract_number, total_eur, sim, arm FROM best
     ORDER BY sim DESC, arm, total_eur DESC NULLS LAST, contract_number
     -- Clamped in the function rather than only in the route: a negative LIMIT raises.
     -- ⚠️ `GREATEST` IGNORES NULLS, so `GREATEST(NULL, 1)` is 1 and a NULL `lim` yields ONE
     -- row rather than the "unbounded" a bare `LIMIT NULL` would mean. Deliberate here — a
     -- search preview has no unbounded reading — but it is the opposite of what
     -- `open_calls_list` does with a NULL limit, so do not carry the idiom across.
     LIMIT GREATEST(lim, 1)
  )
  SELECT f.contract_number, f.title, f.beneficiary_eik, f.beneficiary_name,
         f.program_name, f.total_eur, f.paid_eur, f.status
    FROM top t
    JOIN fund_projects f USING (contract_number)
   -- Repeated because a join does not preserve the subquery's order.
   ORDER BY t.sim DESC, t.arm, f.total_eur DESC NULLS LAST, f.contract_number
$$;
