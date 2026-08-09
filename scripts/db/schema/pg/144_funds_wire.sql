-- 144 — the /funds wire (band 0) and news rail (band 2).
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS IS FOR. Every number on /funds is all-time and static, so the page reads as an
-- archive: nothing on it can tell a returning reader whether anything happened. The wire is one
-- line („обновено 3 авг · 101 нови договора · €12,4 млн. · 45 отворени процедури") and the rail
-- is four cards of what actually moved. docs/plans/funds-module-v2.md §5.2, bands 0 and 2.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- THE THING THIS CORPUS CANNOT DO, stated first because it shapes every label below.
--
-- `fund_projects` HAS NO DATE COLUMNS. Not a signing date, not a start, not an end — ИСУН's
-- beneficiary export publishes none, and the loader invents none. Verified against
-- information_schema: the table's only temporal information is `duration_months` and a `status`
-- string, and „Приключен (към датата на приключване)" names a state without naming the date.
--
-- Two consequences, both of which the plan's §3.2 rule 2 („event date, not ingest date") assumes
-- away because it was written for the PROCUREMENT corpus, where `contracts.date` exists:
--
--   1. „Процедури, приключили наскоро" — one of the four rail cards §5.2 lists — IS NOT
--      COMPUTABLE. There is no completion date to sort by. It is not built, and the reason is
--      here rather than in a backlog: shipping a „recently completed" card ordered by ingest
--      date would present the order we happened to crawl in as the order things finished.
--   2. Everything here is honestly an INGEST window, and every label says so. „Нови в ИСУН",
--      never „нови договори" unqualified; „новопоявили се", never „подписани този месец". The
--      lag is real and unmeasurable on this corpus, so the copy must not imply it is zero.
--
-- A BACKFILL IS NOT NEWS (§3.2 rule 3). The whole corpus was first seen on one day, so a naive
-- „new in the last 30 days" reports 82,011 — the load, not the world. The `summarised` rule from
-- `007_query_builders.sql` is REUSED rather than re-derived: a day whose `rows_new > 500`, or
-- any of whose batches ran in summary mode, is excluded from the itemised output and reported as
-- a single line. Re-deriving the threshold here would let the two drift, and the wire would
-- eventually disagree with /data/updates about what counted as news.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- ── The index the window needs ─────────────────────────────────────────────────────────────
--
-- `idx_ifs_seen` is on `first_seen_at` ALONE, so a time-range predicate over `ingest_first_seen`
-- pulls EVERY source's rows out of a 15M-row table before the `source` filter is applied.
-- Measured on the wire's 30-day window: a BitmapAnd over 15,126,361 index rows, 14,119 buffers
-- and 311 ms for one figure, on a function that runs on every /funds view.
--
-- Leading with `source` makes the seek exact. It is general — every dataset in this table wants
-- „what did source X first see in window W", and the one existing composite is a partial index
-- for `cacbg_declarations` only, i.e. the same need solved once for one caller.
CREATE INDEX IF NOT EXISTS idx_ifs_source_seen
  ON ingest_first_seen (source, first_seen_at);

-- ── The backfill rule, defined ONCE ────────────────────────────────────────────────────────
--
-- „A backfill is not news" (§3.2 rule 3) says to REUSE `007_query_builders.sql`'s `summarised`
-- rule rather than re-derive it. An earlier draft of this file honoured the letter and broke the
-- spirit: it copied the predicate verbatim into both functions, literal `500` included, taking
-- the number of copies in the schema from two to four. A copied threshold is a re-derived
-- threshold — it drifts the first time one copy is tuned, and then the wire and /data/updates
-- disagree about what counted as news while both look right.
--
-- SQL cannot import 007's CTE, so this is the closest thing available: one function, called
-- everywhere, with the literal appearing exactly once on this side. Keep it in step with 007's
-- `summarised` — `funds_wire.data.test.ts` asserts both arms fire.
CREATE OR REPLACE FUNCTION funds_ingest_days(p_days int)
RETURNS TABLE (day date, rows_new int, is_backfill boolean)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT d.day, d.rows_new,
         (d.rows_new > 500
          OR EXISTS (SELECT 1 FROM ingest_batches b
                      WHERE b.source = d.source AND b.loaded_at::date = d.day
                        AND b.mode = 'summary'))
    FROM changelog_days d
   WHERE d.source = 'fund_project'
     AND d.day >= (now() - make_interval(days => GREATEST(p_days, 1)))::date;
$$;

-- What a window's backfills amount to. The RAIL needs this for its own window as well as the
-- wire for its own: the real 81,616-row load sits inside the rail's 60 days and outside the
-- wire's 30, so without a per-window figure the rail silently drops it and says nothing.
CREATE OR REPLACE FUNCTION funds_backfill(p_days int)
RETURNS TABLE (backfill_days int, backfill_rows int)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT COALESCE(count(*) FILTER (WHERE is_backfill), 0)::int,
         COALESCE(sum(rows_new) FILTER (WHERE is_backfill), 0)::int
    FROM funds_ingest_days(p_days);
$$;

-- ── The wire: one line, band 0 ─────────────────────────────────────────────────────────────
--
-- Deliberately cheap — this runs on every /funds view. All four figures come from indexed
-- lookups over `changelog_days`, `ingest_first_seen` and the open-calls view; there is no
-- aggregate over `fund_projects` here.
-- DROP first: `CREATE OR REPLACE` cannot change a function's OUT-parameter row type, and
-- `checked_on` moved from `date` to `text` (see the column comment). Without this the migration
-- fails on any database that already has the older shape — i.e. on re-apply.
DROP FUNCTION IF EXISTS funds_wire(int);
CREATE OR REPLACE FUNCTION funds_wire(p_days int DEFAULT 30)
RETURNS TABLE (
  -- The last day the funds ingest RAN, whether or not it found anything. „Обновено" means we
  -- looked, and a reader deserves to know that even on a day with no new rows.
  -- TEXT, not `date`. node-postgres converts a PG `date` to a JS Date in the SERVER PROCESS's
  -- timezone, so under TZ=Europe/Sofia „2026-08-09" leaves as „2026-08-08T21:00:00.000Z" and the
  -- client renders the day BEFORE — reproduced locally; prod is correct only because Cloud Run
  -- happens to leave TZ unset. A `date` has no timezone, so the fix belongs here: hand it over as
  -- the string it is and let no layer reinterpret it.
  checked_on          text,
  -- The last day it found something. NULL when nothing has landed inside the window.
  last_change_on      text,
  -- New rows on days that were NOT backfills, and the money on them. Both NULL-safe zeroes.
  new_projects        int,
  new_eur             double precision,
  -- Days inside the window that WERE backfills, and their row count. Reported rather than
  -- hidden: „82,011 при първоначално зареждане" is the honest way to say why the itemised
  -- number is small, and it is the difference between a quiet corpus and a broken pipeline.
  backfill_days       int,
  backfill_rows       int,
  -- What a reader can act on today. Query-time derived (142), so it can never show an expired
  -- call as open.
  open_calls          int
)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH days AS (SELECT * FROM funds_ingest_days(p_days))
  SELECT to_char((SELECT max(day) FROM changelog_days WHERE source = 'fund_project'), 'YYYY-MM-DD'),
         to_char((SELECT max(day) FROM days WHERE rows_new > 0 AND NOT is_backfill), 'YYYY-MM-DD'),
         COALESCE((SELECT sum(rows_new)::int FROM days WHERE NOT is_backfill), 0),
         -- SARGABLE. `first_seen_at::date IN (…)` alone is an EXPRESSION on the column, so
         -- `idx_ifs_seen` cannot serve it and the planner scans all 2.6M rows of
         -- `ingest_first_seen` — measured at 30,105 buffers for this one figure, on a function
         -- that runs on every /funds view. The range bounds give the index something to seek on;
         -- the day-set membership then prunes the backfill days inside that window.
         -- reference_pg_sargable_windows.
         COALESCE((
           SELECT sum(f.total_eur)
             FROM ingest_first_seen s
             JOIN fund_projects f ON f.contract_number = s.key
            WHERE s.source = 'fund_project'
              AND s.first_seen_at >= (SELECT min(day) FROM days WHERE NOT is_backfill)::timestamptz
              AND s.first_seen_at <  ((SELECT max(day) FROM days WHERE NOT is_backfill) + 1)::timestamptz
              AND s.first_seen_at::date IN (SELECT day FROM days WHERE NOT is_backfill)
         ), 0),
         COALESCE((SELECT count(*)::int FROM days WHERE is_backfill), 0),
         COALESCE((SELECT sum(rows_new)::int FROM days WHERE is_backfill), 0),
         -- Absent on a database without 142 — the caller degrades, and a wire missing one
         -- figure is better than no wire.
         COALESCE((SELECT count(*)::int FROM open_calls_table
                    WHERE status = 'open' AND kind = 'call'), 0);
$$;

-- ── The rail: three cards, band 2 ──────────────────────────────────────────────────────────
--
-- THREE, not the four §5.2 lists — see the header for why „приключили наскоро" is absent.
--
-- One function returning a tagged union rather than three, so the route makes one round trip and
-- the caller cannot render two of the three and silently drop the third.
CREATE OR REPLACE FUNCTION funds_news(p_days int DEFAULT 60, p_limit int DEFAULT 4)
RETURNS TABLE (
  card      text,   -- 'new_contracts' | 'by_place' | 'lowest_paid'
  rank      int,
  label     text,
  sublabel  text,
  href      text,
  amount_eur double precision,
  pct        double precision
)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH fresh_days AS (
    -- The same backfill exclusion as the wire, from the SAME function. Without it every card
    -- below is a description of the initial load.
    SELECT day FROM funds_ingest_days(p_days) WHERE NOT is_backfill
  ),
  fresh AS (
    -- Same sargable form as the wire's — the range seeks `idx_ifs_seen`, the day set prunes.
    SELECT f.*, s.first_seen_at
      FROM ingest_first_seen s
      JOIN fund_projects f ON f.contract_number = s.key
     WHERE s.source = 'fund_project'
       AND s.first_seen_at >= (SELECT min(day) FROM fresh_days)::timestamptz
       AND s.first_seen_at <  ((SELECT max(day) FROM fresh_days) + 1)::timestamptz
       AND s.first_seen_at::date IN (SELECT day FROM fresh_days)
  )
  -- 1. НОВИ В ИСУН, largest first. „New in ИСУН", never „newly signed": the corpus carries no
  --    signing date, so the only thing we know is when WE first saw the row.
  -- EACH BRANCH PARENTHESISED: a UNION arm carrying its own ORDER BY/LIMIT has to be, and the
  -- per-branch LIMIT is what keeps each card independent — one card running long cannot crowd
  -- another out of the result.
  (SELECT 'new_contracts'::text, row_number() OVER (ORDER BY total_eur DESC NULLS LAST, contract_number)::int,
         title, beneficiary_name, '/funds/contract/' || contract_number, total_eur, NULL::double precision
    FROM fresh
   WHERE title IS NOT NULL
   ORDER BY total_eur DESC NULLS LAST, contract_number
   LIMIT GREATEST(1, LEAST(p_limit, 10)))
  UNION ALL
  -- 2. КЪДЕ ОТИДОХА — over the same newly-seen set, so the label must say „новопоявили се" and
  --    not „този месец". `oblast` is folded to the canonical namespace (143's canon_oblast), so
  --    the capital is one place rather than four shards.
  --
  --    THE FOLD IS IN THE `GROUP BY`, not merely in the SELECT list, and that is what makes it
  --    structural rather than a convention: with `GROUP BY canon_oblast(oblast)` Postgres REFUSES
  --    a bare `oblast` in the output, so this branch cannot be edited into emitting a raw S22–S25
  --    shard without failing to compile. `funds_wire.data.test.ts` asserts the clause is present
  --    in the INSTALLED body — nothing APPLIES this file (it is a hand-run `apply_functions.ts`
  --    migration), so a database running a pre-fold body is the ordinary failure here, and the
  --    live rows alone cannot catch it on a quiet ingest window.
  --
  --    `COALESCE(…) <> ''` rather than `IS NOT NULL`: an empty oblast is not a place either, and
  --    it would render as a blank row in the card's place column rather than being dropped.
  (SELECT 'by_place'::text,
         row_number() OVER (ORDER BY sum(total_eur) DESC NULLS LAST, canon_oblast(oblast))::int,
         canon_oblast(oblast), count(*)::text, NULL::text,
         sum(total_eur), NULL::double precision
    FROM fresh
   WHERE COALESCE(oblast, '') <> ''
   GROUP BY canon_oblast(oblast)
   ORDER BY sum(total_eur) DESC NULLS LAST, canon_oblast(oblast)
   LIMIT GREATEST(1, LEAST(p_limit, 10)))
  UNION ALL
  -- 3. НАЙ-НИСЪК % ИЗПЛАТЕНИ — the one card that is NOT about the ingest window. It is a standing
  --    fact: procedures where a lot is contracted and little has been disbursed. Read from
  --    `fund_fit` (143), so it is a PK-cheap scan of 2,206 rows.
  --
  --    RESTRICTED TO THE CLOSED 2014-2020 PERIOD, and that restriction is what makes the card
  --    honest rather than insinuating. The corpus has no signing date, so on the full set a
  --    procedure at 0% is indistinguishable from one signed last month with nothing paid yet —
  --    and presenting recency as underperformance is exactly the „signal read as finding" failure
  --    (§3.2 rule 1). Measured: unrestricted, the top three were all 0% and all 2021-2027.
  --    `program_code` carries the period's start year as its prefix (`2014BG05SFOP001`,
  --    `2021BG-RRP`), so „2014%" selects the period that has ENDED — where nothing disbursed is
  --    a fact about the procedure rather than about the calendar. It excludes the ~65 procedures
  --    on the smaller instruments whose codes are not year-prefixed (BGCULTURE, BGENERGY …);
  --    they are a rounding error here and guessing their vintage would undo the point.
  --
  --    The floor of 20 projects and €1m keeps out the one-contract procedures where a small
  --    denominator is not evidence of anything.
  -- `sublabel` carries the PROGRAMME, and a leading „~" marks a label that is really one
  -- project's title rather than the procedure's own name. 110 of the 119 eligible procedures
  -- publish no name (ИСУН's export has no such column), so without the marker three of the top
  -- four rows present a single contract's title as the name of the scheme being criticised —
  -- which on a card about low disbursement misattributes the criticism. The sibling resolver
  -- tile already carries both the label and its gate.
  (SELECT 'lowest_paid'::text,
         row_number() OVER (ORDER BY paid_eur / NULLIF(total_eur, 0) ASC, procedure_code)::int,
         CASE WHEN procedure_name IS NOT NULL THEN procedure_name
              ELSE '~' || COALESCE(sample_title, procedure_code) END,
         program_name,
         '/funds/procedure/' || procedure_code,
         total_eur,
         100.0 * paid_eur / NULLIF(total_eur, 0)
    FROM fund_fit
   WHERE program_code LIKE '2014%'
     AND project_count >= 20 AND total_eur >= 1000000
   ORDER BY paid_eur / NULLIF(total_eur, 0) ASC, procedure_code
   LIMIT GREATEST(1, LEAST(p_limit, 10)));
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION funds_wire(int) TO app_readonly;
    GRANT EXECUTE ON FUNCTION funds_news(int, int) TO app_readonly;
  END IF;
END $$;
