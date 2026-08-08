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
-- 0.5, not 0.4: mirror search_companies / search_contractors — 0.4 admits
-- near-miss noise for no-real-match queries; legit hits score >=0.6.
SET pg_trgm.word_similarity_threshold = 0.5
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

-- recent_updates references changelog_days / ingest_first_seen (005) and the
-- tenders / fund / ngo tables, which may not all exist when THIS file is applied
-- (007 runs from the TR loader; those tables come from other loaders). Defer body
-- validation — every referenced table exists by CALL time.
--
-- Day-grained feed: the itemise-vs-summarise decision is per (source, calendar
-- day), read from the coalesced changelog_days history — so multiple same-day
-- ingests of a source read as ONE unit (all its per-row entries, or one summary
-- line if that day's coalesced new-row total is large), and past days persist
-- (changelog_days is append-only, never erased). 500 mirrors
-- INGEST_SUMMARY_THRESHOLD (scripts/db/lib/ingest_changelog.ts); a loader may
-- also force summary for its source by passing its own threshold, which the
-- `summarised` CTE below honours via ingest_batches.mode.
SET check_function_bodies = off;
-- Return signature changed (added the `id` record-id column), so CREATE OR
-- REPLACE alone can't alter an already-created function — drop it first.
DROP FUNCTION IF EXISTS recent_updates(int, int);
CREATE OR REPLACE FUNCTION recent_updates(days int DEFAULT 1, lim int DEFAULT 1000)
RETURNS TABLE (
  kind       text,
  id         text,   -- the record's own id (contract key / tender unp / fund
                     -- contract_number); null for company/officer/dataset rows.
                     -- Routed to the record page by `kind` (contract → /contract,
                     -- tender → /tenders, fund_project → /funds/contract).
  eik        text,   -- the involved party: contractor / beneficiary (→ /company),
                     -- tender buyer (→ /awarder), or the TR company (→ /company).
  name       text,
  detail     text,
  changed_at timestamptz,
  amount_eur double precision
)
LANGUAGE sql STABLE AS $$
  -- NOT MATERIALIZED IS LOAD-BEARING, AND ITS ABSENCE IS WHY THE 0.15 s BELOW STOPPED
  -- BEING TRUE. Postgres 12+ inlines a CTE referenced ONCE and MATERIALISES one referenced
  -- several times; `cutoff` is referenced by five branches, so it was materialised. A
  -- materialised CTE's value is opaque at plan time, so `changed_at >= cutoff.ts` could not
  -- become an Index Cond on ANY branch — every one of them walked its whole index backwards
  -- and applied the cutoff afterwards.
  --
  -- That cost NOTHING while the recent window was busy: the per-branch LIMIT filled from the
  -- first few index entries and the walk stopped. It becomes catastrophic when the window is
  -- QUIET, because a branch with fewer than `lim` qualifying rows never fills its limit and
  -- walks to the end of the index. Measured 2026-08-08 at the route default (1, 200), which
  -- matched 2 rows in total: ingest_first_seen emitted 17,795,799 rows, tr_companies
  -- 1,020,707 and tr_officers 793,949 — for zero output each. 23.8 s locally and 166.9 s on
  -- Cloud SQL, against a 10 s statement_timeout, so /api/db/recent was a hard 500.
  --
  -- Isolated: one reference 0.134 ms, two references 175 ms, two + NOT MATERIALIZED
  -- 0.060 ms — same rows, same indexes. Do not remove it, and do not add a sixth reference
  -- believing the count no longer matters.
  WITH cutoff AS NOT MATERIALIZED (SELECT now() - make_interval(days => days) AS ts),
  -- The (source, day) pairs that render as ONE summary line instead of per-row.
  -- Two ways in:
  --   • the day's coalesced new-row total crossed the threshold (a cold load, a
  --     bulk backfill, or several same-day loads that together got large);
  --   • any of that day's batches was recorded in summary mode — a loader that
  --     set its own threshold. 'tr_company' does this on every load: TR is
  --     already itemised per-row by the company/officer branches below (off the
  --     registry's own timestamps), so its ingest delta must NOT be itemised
  --     again under a second kind.
  -- The second rule also keeps a summary batch from ever being itemised: those
  -- batches deliberately don't snapshot name/detail (005), so per-row output
  -- would be blank.
  summarised AS (
    SELECT d.source, d.day
    FROM changelog_days d
    WHERE d.rows_new > 500
       OR EXISTS (
            SELECT 1 FROM ingest_batches b
            WHERE b.source = d.source AND b.loaded_at::date = d.day
              AND b.mode = 'summary')
  )
  -- EVERY BRANCH BELOW CARRIES ITS OWN `ORDER BY changed_at DESC LIMIT lim`, and that is
  -- load-bearing rather than tidy. Any row in the global top-`lim` from a branch is necessarily
  -- in that branch's own top-`lim`, so the pushdown cannot lose a row that belonged in the
  -- answer — and it is what stops Postgres materialising the whole union first.
  --
  -- Without it, measured on this corpus: the Append emitted **1,688,150 rows** and read **16.9M
  -- buffers** to feed a top-N heapsort. At the shapes `/api/db/…` (functions/db_routes.js)
  -- actually asks for — it clamps `limit` to 1–1000 — that was **13.61 s at the route default
  -- (1, 200)** and **14.05 s at its ceiling (3650, 1000)**, against Cloud Run's 10 s
  -- `statement_timeout`. So the endpoint was over budget at its MOST COMMON parameters, not
  -- merely under artificial load. Now 0.15 s and 1.34 s. It surfaced as two data tests timing
  -- out; the tests were the symptom.
  --
  -- Each branch's ordering column is indexed (idx_cfs_seen, idx_ifs_seen,
  -- idx_tr_companies_updated, idx_tr_officers_changed), so a branch walks its index backwards
  -- and stops after `lim` qualifying rows instead of scanning the window.
  --
  -- NOT row-for-row identical at a limited shape, and that is expected. `changed_at` is not a
  -- total order — a bulk load stamps one timestamp on hundreds of rows (408 share a single
  -- `first_seen_at` today) — so which of the tied rows fills the last places differs from the
  -- pre-pushdown plan: 150 of 200 rows change at the route default. The `changed_at` multiset
  -- and the kind distribution are identical, both answers are legal, and each is deterministic
  -- for a given plan. Do NOT "fix" this with a branch-level tiebreak (… , key DESC): it makes
  -- the sort key wider than every index above, defeats the backward index walk, and restores the
  -- 13.6 s plan. At the UNLIMITED shape the two bodies are exactly equal — verified by
  -- `EXCEPT ALL` in both directions over all 1,688,150 rows.
  SELECT * FROM (
    -- Contracts (source 'shards') first seen on a day whose coalesced new-row
    -- total stayed small — itemised per-row. A bulk contract day is summarised
    -- (below), not shown as 100k rows. id = contract key (→ /contract page),
    -- eik = contractor company.
    (SELECT 'contract'::text AS kind, c.key AS id, c.contractor_eik AS eik,
           c.contractor_name AS name,
           c.awarder_name AS detail, f.first_seen_at AS changed_at, c.amount_eur
    FROM contract_first_seen f
    JOIN contracts c USING (key)
    JOIN changelog_days d
      ON d.source = 'shards' AND d.day = f.first_seen_at::date
    CROSS JOIN cutoff
    WHERE f.first_seen_at >= cutoff.ts
      AND NOT EXISTS (SELECT 1 FROM summarised s
                      WHERE s.source = d.source AND s.day = d.day)
    ORDER BY f.first_seen_at DESC
    LIMIT lim)
    UNION ALL
    -- Per-row detail for every other PG-loaded dataset (tenders, EU fund
    -- projects, NGO funding) on days that stayed small. id = the record key
    -- (fs.key = tender unp / fund contract_number); eik = the party company/
    -- institution, pulled from the source table (buyer for tenders → /awarder,
    -- beneficiary for funds → /company). Both join keys are PRIMARY KEY, so the
    -- LEFT JOINs cannot fan out. NGO rows carry no eik (no join).
    -- SCALAR SUBQUERIES, not LEFT JOINs, and this is the difference between 13.7 s and
    -- milliseconds. Written as `LEFT JOIN tenders t ON fs.source = 'tender' AND t.unp = fs.key`,
    -- the planner cannot use `tenders_pkey` as an index condition — the source predicate has to
    -- be evaluated per row and NULLs produced when it fails — so it chose a Nested Loop Left
    -- Join with a bare Join Filter and read **16.8M buffers to emit 3,968 rows** (~4,200 buffers
    -- each, i.e. re-reading `tenders` per row).
    --
    -- A correlated scalar subquery cannot degrade that way: it is a PK lookup, and it only runs
    -- for the row's own source. Both keys are UNIQUE (tenders_pkey on unp, fund_projects_pkey on
    -- contract_number), so ≤1 row comes back and this is exactly equivalent to the LEFT JOINs it
    -- replaces — the original comment already relied on that ("both join keys are PRIMARY KEY,
    -- so the LEFT JOINs cannot fan out").
    (SELECT fs.source AS kind, fs.key AS id,
           CASE fs.source
             WHEN 'tender' THEN (SELECT t.buyer_eik FROM tenders t WHERE t.unp = fs.key)
             WHEN 'fund_project' THEN (SELECT fp.beneficiary_eik FROM fund_projects fp
                                        WHERE fp.contract_number = fs.key)
           END AS eik,
           fs.name, fs.detail,
           fs.first_seen_at AS changed_at, fs.amount_eur
    FROM ingest_first_seen fs
    CROSS JOIN cutoff
    -- EXISTS, not JOIN, for the changelog_days membership test. `changelog_days` contributes no
    -- output column here — the join existed only to name (d.source, d.day) for the NOT EXISTS
    -- below, and those are by definition (fs.source, fs.first_seen_at::date). As a JOIN the
    -- planner drove the branch FROM changelog_days and probed `ingest_first_seen` once per day
    -- (212 loops × ~60 ms = 12.7 s, 16.8M buffers), because the join condition is on
    -- `first_seen_at::date` — an expression no index serves, so each probe scanned the source's
    -- whole partition of the PK.
    --
    -- As an EXISTS the branch drives from `idx_ifs_seen` on the raw timestamp instead, honours
    -- `ORDER BY first_seen_at DESC LIMIT lim` by walking that index backwards, and stops early —
    -- the shape the contracts branch above already had. Semantically identical: changelog_days'
    -- PK is (source, day), so the JOIN could never fan out or duplicate a row.
    WHERE fs.first_seen_at >= cutoff.ts
      AND EXISTS (SELECT 1 FROM changelog_days d
                  WHERE d.source = fs.source AND d.day = fs.first_seen_at::date)
      AND NOT EXISTS (SELECT 1 FROM summarised s
                      WHERE s.source = fs.source AND s.day = fs.first_seen_at::date)
    ORDER BY fs.first_seen_at DESC
    LIMIT lim)
    UNION ALL
    -- One coalesced summary line per (source, day) whose day total was large:
    -- a first cold load, a bulk backfill, or several same-day loads that together
    -- crossed the threshold. 'shards' → 'contract' so it matches the detail kind.
    (SELECT 'dataset'::text AS kind, NULL::text AS id, NULL::text AS eik,
           CASE d.source WHEN 'shards' THEN 'contract' ELSE d.source END AS name,
           d.rows_new || ' new · ' || d.rows_total || ' total'
             || CASE WHEN d.load_count > 1 THEN ' (' || d.load_count || ' loads)' ELSE '' END AS detail,
           d.last_loaded_at AS changed_at, NULL::double precision AS amount_eur
    FROM changelog_days d
    JOIN summarised s ON s.source = d.source AND s.day = d.day
    CROSS JOIN cutoff
    WHERE d.last_loaded_at >= cutoff.ts AND d.rows_new > 0
    ORDER BY d.last_loaded_at DESC
    LIMIT lim)
    UNION ALL
    -- TR companies whose registry record changed in the window.
    (SELECT 'company', NULL::text, co.uic, co.name,
           NULLIF(concat_ws(' · ', co.legal_form, co.status), ''),
           co.last_updated, NULL::double precision
    FROM tr_companies co CROSS JOIN cutoff
    WHERE co.last_updated >= cutoff.ts
    ORDER BY co.last_updated DESC
    LIMIT lim)
    UNION ALL
    -- TR officers added/erased in the window.
    (SELECT 'officer', NULL::text, o.uic, o.name, o.roles, o.changed_at, NULL::double precision
    FROM tr_officers o CROSS JOIN cutoff
    WHERE o.changed_at >= cutoff.ts
    ORDER BY o.changed_at DESC
    LIMIT lim)
  ) u
  ORDER BY changed_at DESC
  LIMIT lim;
$$;
