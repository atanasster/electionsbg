-- ⚠ DEPLOY ORDER: functions/db_routes.js (CONTRACT_SQL) and functions/db_table.js
-- (REGISTRY contracts→contracts_list, tenders→tenders_list) READ the views this
-- migration creates. Apply this migration to Cloud SQL BEFORE deploying functions
-- (functions:db) — via `db:load:tenders:pg:cloud` (load_tenders_pg.ts applies it) or
-- `apply_functions.ts 042_kzk_appeals.sql`; NOT `db:dump`, which only dumps a DB
-- outward to GCS — otherwise the browsers 500 with 42P01 (undefined_table). The
-- /contract/:key route has a base-table fallback; the browsers do NOT, so the
-- ordering is a hard requirement for them.
--
-- КЗК (Комисия за защита на конкуренцията) procurement-appeal records, joined
-- to the tender corpus. The КЗК public register (reg.cpc.bg/AllComplaints.aspx)
-- publishes each complaint with the procedure's УНП in STRUCTURED form — so the
-- join to tenders.unp is EXACT (verified: 00589-2026-0026 → Община Перник,
-- 00674-2026-0007 → Община Николаево both resolve 1:1). No fuzzy matching.
--
-- The intake record (complaint no, parties, УНП, status, ВМ-requested, subject)
-- comes from the Жалби list; the outcome (уважена/отхвърлена, спиране granted)
-- is a tier-2 enrichment from the Решения/Определения registers, backfilled by
-- the ingest (nullable until then).
--
-- Populated by scripts/procurement/kzk_appeals.ts (headed-Playwright crawl from
-- BG egress — reg.cpc.bg 403s non-BG / non-browser). Additive; the ingest also
-- writes data/procurement/kzk_appeals.json (no-JSON-from-PG rule). EXECUTE
-- auto-grants to app_readonly.

SET check_function_bodies = off;

CREATE TABLE IF NOT EXISTS kzk_appeals (
  complaint_no    text PRIMARY KEY,      -- "ВХР-2048-03.07.2026"
  complaint_id    text,                  -- Complaint.aspx?ID=<id>
  complaint_date  text,                  -- Дата на жалбата (YYYY-MM-DD)
  complainant     text,                  -- жалбоподател
  respondent      text,                  -- ответник (buyer, as printed by КЗК)
  appealed_act    text,                  -- обжалван акт №
  unp             text,                  -- УНП — the join key to tenders.unp
  buyer_eik       text,                  -- resolved from tenders by unp (nullable)
  vm_requested    boolean,               -- Искани временни мерки (a request was made)
  status          text,                  -- Статус (иницииран процес, …)
  subject         text,                  -- Предмет
  match           text NOT NULL DEFAULT 'exact',  -- exact | unresolved (unp not in tenders)
  -- tier-2 outcome (from Решения/Определения; null until backfilled)
  -- уважена | отхвърлена | прекратена  — the only codes classifyOutcome emits,
  -- and measured, the only three ever stored (983 / 2,091 / 4).
  --
  -- `частично` is RESERVED and deliberately unreachable: kzk_match.ts's
  -- classifyOutcome header explains that scoring a part-uphold as `уважена` is
  -- what keeps a part-upheld procedure INSIDE the risk index, so using the code
  -- would change what the index measures rather than fix anything.
  -- `без разглеждане` is mapped in src/lib/kzkLabels.ts but no writer produces it.
  --
  -- ⚠️ `отказана` is NOT in this list and must never be written here: it is
  -- DERIVED from `status` by kzk_effective_outcome() and deliberately not stored.
  -- See that function for why storing it would break 131's provenance rule.
  outcome         text,
  decision_date   text,
  suspension      boolean,               -- спиране temporary measure granted
  source_url      text NOT NULL,
  fetched_at      text NOT NULL
);
-- ⚠️ ORDERING, not decoration. `kzk_appeals_list` (below) SELECTs
-- `decision_act_no`, whose home is migration 131 — and 131 is applied ONLY by
-- kzk_rejoin.ts, which every path that applies THIS file runs before
-- (db:refresh orders db:load:tenders:pg ahead of kzk:rejoin; load_tenders_pg and
-- apply_functions never touch 131). Without this line, applying 042 to a database
-- that has not yet rejoined raises 42703 on the view — and since exec() sends the
-- file as ONE implicit transaction, the whole migration rolls back and the loader
-- aborts. Idempotent, so 131 remains the column's documented owner.
ALTER TABLE kzk_appeals ADD COLUMN IF NOT EXISTS decision_act_no text;

CREATE INDEX IF NOT EXISTS idx_kzk_appeals_unp    ON kzk_appeals(unp);
CREATE INDEX IF NOT EXISTS idx_kzk_appeals_buyer  ON kzk_appeals(buyer_eik);
-- Match the serving sorts (tender_appeals / kzk_recent_appeals order by
-- complaint_date DESC NULLS LAST, complaint_no DESC) so the index can serve them
-- — a plain DESC index (NULLS FIRST) cannot. DROP first to replace the old shape.
-- NB: the DbDataTable appeals browse appends `complaint_no ASC` (buildOrder), so
-- its sort still needs a Sort node — this index targets the jsonb functions, not
-- the browser (harmless at ~8k rows).
DROP INDEX IF EXISTS idx_kzk_appeals_date;
CREATE INDEX IF NOT EXISTS idx_kzk_appeals_date
  ON kzk_appeals(complaint_date DESC NULLS LAST, complaint_no DESC);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON kzk_appeals TO app_readonly;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The ONE definition of "is this appeal suspended".
--
-- `suspension` is TIER-2-ONLY: it can be set authoritatively only by the
-- Решения/Определения registers, and the определения arm has never been crawled,
-- so intake writes NULL. The fallback reads the fresh intake status instead, and
-- — unlike a stored bool — it updates false→true on a re-scrape.
--
-- ⚠️ THIS EXISTS BECAUSE THE EXPRESSION WAS INLINED FIVE TIMES AND ONE COPY WAS
-- WRONG. `kzk_appeals_list` selected the RAW column, so /procurement/appeals (the
-- DbDataTable resource built on that view) rendered its "suspended" chip off a
-- value every other surface treated as merely a hint. When the frozen column was
-- released to NULL, that page silently went from 4 chips to 0 while all four
-- other consumers correctly showed 4. A shared function makes the next divergence
-- impossible rather than merely unlikely.
--
-- IMMUTABLE so it can be used in an index or a matview predicate if ever needed.
CREATE OR REPLACE FUNCTION kzk_effective_suspension(
  p_suspension boolean,
  p_status     text
) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_suspension, p_status ~* 'спрян');
$$;

-- The effective OUTCOME. Same shape, same reason, one register field over.
--
-- `отказано производство` — КЗК refused to open proceedings — is a DETERMINATE
-- TERMINAL STATE, not a missing value: the filing was denied and will never be
-- reviewed on the merits. 1,661 of 7,998 appeals (20.8%) carry it, and every
-- surface rendered them as a blank outcome.
--
-- ⚠️⚠️ THIS IS DERIVED AT QUERY TIME AND MUST NEVER BE STORED, and the reason is
-- not obvious. The obvious implementation — `UPDATE kzk_appeals SET outcome = …
-- WHERE status = 'отказано производство'` — SILENTLY DESTROYS THE PROVENANCE
-- GUARD that protects the ~2,098 irreplaceable hand-seeded rows. 131's rule is
-- the ONLY test of provenance:
--
--     decision_act_no IS NOT NULL  → machine-derived, may be overwritten
--     decision_act_no IS NULL      → hand-seeded, NEVER written
--
-- A status-derived outcome has a THIRD provenance — neither hand-made nor
-- act-derived — and carries no act number, so it lands in the protected bucket.
-- Measured: the guarded population would go 2,098 → 3,759, and
-- kzk_appeals_provenance.data.test.ts would STAY GREEN, because its floor is a
-- `>=`. That is exactly the laundering hazard kzk_baselines.ts's
-- HAND_SEEDED_FLOOR comment describes. It would also freeze those 1,661 rows
-- against every future matcher improvement, since the rule refuses to overwrite
-- them.
--
-- Deriving it stores nothing, so `decision_act_no IS NULL` keeps meaning what it
-- has always meant, and `kzk_baselines.outcomes` (which counts the stored column)
-- does not move — correct, because 1,661 outcomes appearing from a re-reading of
-- `status` is not the matcher getting better, and letting it raise the ratchet
-- would mask a later real regression.
--
-- THE STORED VALUE WINS. 12 appeals carry BOTH this status and a merits outcome
-- (9 уважена, 3 отхвърлена) — all 12 hand-seeded. Either the status is stale or
-- the seeding was wrong; either way COALESCE keeps the human's answer, the same
-- precedence kzk_effective_suspension uses.
--
-- ⚠️ WHAT MUST *NOT* USE THIS, and why each one:
--
--   * `upheld_ocids` (below) and `buyer_appeal_stats` — they filter `outcome =
--     'уважена'` on the RAW column. A refusal is not an uphold, and that matview
--     feeds the contract Corruption Risk Index.
--   * `partitionByProvenance()` (kzk_provenance.ts) — it reasons about the
--     STORED value; feeding it a derived one would make 1,661 rows look
--     hand-seeded, which is the defect this whole design avoids.
--   * `kzk_appeals_summary()`'s `upheld` / `rejected` counters (044) — merits
--     verdicts, same reason as upheld_ocids. Its `with_outcome` DOES use this
--     one: that counter asks "has a published ending", which a refusal is.
--     ⚠️ 044 was missed on the first pass of this change and answered 3,078
--     where /procurement/appeals published 4,727; it has a TypeScript twin in
--     build_kzk_summary.ts that must move with it.
--
-- No writer reads `kzk_appeals_list`, so the derived value cannot launder itself
-- back into storage: kzk_rejoin.ts, kzk_appeals.ts, kzk_dependents.ts and the
-- provenance rule all select FROM kzk_appeals. Keep it that way.
--
-- NOT STRICT, for the reason declared_label() in 089 is not: STRICT returns NULL
-- for a NULL first argument, which is every row this exists for.
--
-- Plan: docs/plans/kzk-columnshift-and-cloud-parity-v1.md §7.1.
CREATE OR REPLACE FUNCTION kzk_effective_outcome(
  p_outcome text,
  p_status  text
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    p_outcome,
    CASE WHEN p_status ~* 'отказано' THEN 'отказана' END
  );
$$;

-- Appeals for one procedure (by УНП; the tender page passes its unp). Ordered
-- newest complaint first.
DROP FUNCTION IF EXISTS tender_appeals(text);
CREATE OR REPLACE FUNCTION tender_appeals(p_unp text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'complaintNo', complaint_no,
    'complaintDate', complaint_date,
    'complainant', complainant,
    'respondent', respondent,
    'appealedAct', appealed_act,
    'vmRequested', vm_requested,
    'status', status,
    'subject', subject,
    -- Effective outcome, NOT the raw column: a refused proceeding is a terminal
    -- state the register publishes, and rendering it blank hid it on 1,661 rows.
    'outcome', kzk_effective_outcome(outcome, status),
    'decisionDate', decision_date,
    -- Effective suspended state: the `suspension` column is TIER-2-ONLY (the
    -- decisions register); intake writes NULL. Fall back to the fresh intake
    -- status (спряно производство) so a live suspension shows without waiting for
    -- tier-2 — and, unlike a stored intake bool, updates false→true on re-scrape.
    'suspension', kzk_effective_suspension(suspension, status),
    'sourceUrl', source_url
  ) ORDER BY complaint_date DESC NULLS LAST, complaint_no DESC), '[]'::jsonb)
  FROM kzk_appeals
  WHERE p_unp IS NOT NULL AND p_unp <> '' AND unp = p_unp;
$$;

-- National "recent appeals" feed (the low-risk MVP surface — no per-procedure
-- pin needed). Joins tenders for the canonical buyer name + value when resolved.
DROP FUNCTION IF EXISTS kzk_recent_appeals(int);
CREATE OR REPLACE FUNCTION kzk_recent_appeals(p_limit int DEFAULT 30)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
  FROM (
    SELECT a.complaint_no AS "complaintNo",
           a.complaint_date AS "complaintDate",
           a.unp,
           a.buyer_eik AS "buyerEik",
           COALESCE(t.buyer_name, a.respondent) AS "buyerName",
           a.complainant,
           a.subject,
           a.vm_requested AS "vmRequested",
           a.status,
           -- effective outcome (tier-2 column OR a refused proceeding) — see
           -- kzk_effective_outcome.
           kzk_effective_outcome(a.outcome, a.status) AS outcome,
           -- effective suspended (tier-2 column OR fresh intake status) — see
           -- tender_appeals above.
           kzk_effective_suspension(a.suspension, a.status) AS suspension,
           (t.unp IS NOT NULL) AS "resolved"
    FROM kzk_appeals a
    LEFT JOIN tenders t ON t.unp = a.unp
    ORDER BY a.complaint_date DESC NULLS LAST, a.complaint_no DESC
    LIMIT GREATEST(1, LEAST(p_limit, 200))
  ) x;
$$;

-- ---------------------------------------------------------------------------
-- List-view helpers: expose a per-row КЗК-appeal flag for the DbDataTable
-- browsers (/procurement/tenders + /procurement/contracts) so appealed rows
-- carry a badge. The flags are correlated EXISTS in the SELECT list only —
-- count(*) over the view ignores unused SELECT exprs (so the browser's exact
-- count stays as fast as the base table), and the row query evaluates them for
-- just the page's ≤100 rows (each an index probe on kzk_appeals.unp).
-- ---------------------------------------------------------------------------
-- DROP first (not CREATE OR REPLACE): `SELECT t.*` freezes the column list, so a
-- plain replace throws "cannot change name of view column" once `tenders` gains a
-- column. Dropping lets the view re-derive its shape on reapply.
DROP VIEW IF EXISTS tenders_list;
CREATE VIEW tenders_list AS
SELECT t.*,
  EXISTS (SELECT 1 FROM kzk_appeals k WHERE k.unp = t.unp) AS has_appeal,
  EXISTS (SELECT 1 FROM kzk_appeals k WHERE k.unp = t.unp
          AND kzk_effective_suspension(k.suspension, k.status)) AS appeal_suspended
FROM tenders t;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON tenders_list TO app_readonly;
  END IF;
END $$;

-- Contracts join to an appeal via their procedure: contracts.ocid → tenders.unp
-- → kzk_appeals. A correlated EXISTS ballooned to ~480ms on the amount-sorted
-- contracts page (the planner evaluated it across the pre-LIMIT set), so the set
-- of appealed ocids is precomputed into a tiny matview and LEFT JOINed instead —
-- a hash semi-join over ~4.5k rows keeps the page ~110ms. REFRESH after contract
-- + kzk loads (load_pg.ts, guarded). Only OCDS-ocid contracts can match.
DROP MATERIALIZED VIEW IF EXISTS appealed_ocids CASCADE;
CREATE MATERIALIZED VIEW appealed_ocids AS
  SELECT DISTINCT t.ocid FROM tenders t JOIN kzk_appeals k ON k.unp = t.unp
  WHERE t.ocid IS NOT NULL AND t.ocid <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_appealed_ocids ON appealed_ocids(ocid);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON appealed_ocids TO app_readonly;
  END IF;
END $$;

-- Ocids whose procedure had an appeal КЗК UPHELD (уважена = the buyer's decision
-- annulled) — the authoritative "found improper" signal that feeds the contract
-- Corruption Risk Index (procedureAppealUpheld component). Same refresh cadence.
DROP MATERIALIZED VIEW IF EXISTS upheld_ocids CASCADE;
CREATE MATERIALIZED VIEW upheld_ocids AS
  SELECT DISTINCT t.ocid FROM tenders t JOIN kzk_appeals k ON k.unp = t.unp
  WHERE k.outcome = 'уважена' AND t.ocid IS NOT NULL AND t.ocid <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_upheld_ocids ON upheld_ocids(ocid);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON upheld_ocids TO app_readonly;
  END IF;
END $$;

-- Put back what the DROP … CASCADE above just took. `risk_upheld_ocid` (112) is a view
-- over upheld_ocids, so every apply of this file destroys it — the same "you break it,
-- you restore it" contract `rebuild_contracts_list()` discharges twenty lines below, and
-- migration_drop_dependents.data.test.ts sanctions this CASCADE on exactly that promise.
--
-- The promise was only half kept: 112 recreates the view inside
-- rebuild_contract_risk_cache(), and load_tenders_pg.ts applies this file WITHOUT calling
-- that function. db:refresh hides it (kzk:rejoin rebuilds two steps later), so the gap is
-- only visible after a STANDALONE db:load:tenders:pg — which is the documented way to
-- publish a tenders reload, on Cloud SQL as well as locally. Nothing breaks while the view
-- is missing (its only reader is the rebuild, which recreates it first), but the database
-- is left without an object its migration says it has, and the ACL gate reads that as a
-- broken GRANT.
--
-- Kept a plain view rather than calling rebuild_contract_risk_cache() here: the rebuild is
-- a 409k-row DELETE+INSERT and this file is applied by a loader. Restoring the object is
-- this file's debt; refreshing the cache's CONTENT stays kzk_dependents.ts's job.
DO $$ BEGIN
  EXECUTE 'CREATE OR REPLACE VIEW risk_upheld_ocid AS SELECT ocid FROM upheld_ocids';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    EXECUTE 'GRANT SELECT ON risk_upheld_ocid TO app_readonly';
  END IF;
END $$;

-- contracts_list (SELECT c.* + appeal flags) is rebuilt by the shared
-- rebuild_contracts_list() (000_search_fns.sql) so this migration and 050
-- (lot_name) never drift. It guards on `contracts` existing (a tenders-only load
-- applies this file before any contract load — CREATE VIEW validates its body
-- eagerly, so a bare statement would roll back the whole file on a contracts-less
-- DB) and DROP-first rebuilds for `SELECT c.*` reapply-safety. Now that the
-- appeals matviews above exist, it picks the branch with the real appeal flags.
SELECT rebuild_contracts_list();

-- Browse view for the /procurement/appeals DbDataTable (resource kzk_appeals in
-- functions/db_table.js). The whole appeals corpus + the tender-derived
-- canonical buyer name and a `resolved` flag — same LEFT JOIN as
-- kzk_recent_appeals, so the paginated table matches the dashboard feed. The
-- text `complaint_date` (ISO YYYY-MM-DD, so lexical order == chronological)
-- drives the section-scope window filter (?pscope), mirroring the tenders
-- browser's publication_date range. DROP-first for the same `SELECT`-shape
-- reapply-safety as tenders_list above; CASCADE because a dependent view would
-- otherwise turn a reapply into a 2BP01 that rolls the whole file back.
DROP VIEW IF EXISTS kzk_appeals_list CASCADE;
CREATE VIEW kzk_appeals_list AS
SELECT a.complaint_no,
       a.complaint_date,
       a.unp,
       a.buyer_eik,
       COALESCE(t.buyer_name, a.respondent) AS buyer_name,
       -- Base-table buyer text kept as its own column so the free-text search
       -- targets it (not the COALESCE above): a filter that references only
       -- kzk_appeals columns lets Postgres eliminate the LEFT JOIN to tenders on
       -- the count path (tenders.unp is unique), turning the search COUNT from a
       -- ~90ms 7.7k-row nested-loop into a ~2ms seq scan.
       a.respondent,
       a.complainant,
       a.subject,
       a.status,
       -- The effective outcome, NOT the raw column — the same rule as
       -- `suspension` below, and this view is where that one was got wrong once.
       -- /procurement/appeals filters `outcome` as a facet, so a refused
       -- proceeding must be a value there rather than an empty cell.
       kzk_effective_outcome(a.outcome, a.status) AS outcome,
       a.decision_date,
       -- WHICH act produced that outcome (131). Exposed so a classification can be
       -- traced back to its ruling from /procurement/appeals rather than only from
       -- psql — and so the two provenances are distinguishable in the UI: a NULL
       -- here marks one of the ~2,098 interactively-produced rows that no writer
       -- may overwrite.
       a.decision_act_no,
       -- The effective state, NOT the raw column: this view backs the
       -- /procurement/appeals DbDataTable, whose chip and `suspension = true`
       -- filter must agree with every other surface.
       kzk_effective_suspension(a.suspension, a.status) AS suspension,
       a.vm_requested,
       (t.unp IS NOT NULL) AS resolved
FROM kzk_appeals a
LEFT JOIN tenders t ON t.unp = a.unp;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON kzk_appeals_list TO app_readonly;
  END IF;
END $$;
