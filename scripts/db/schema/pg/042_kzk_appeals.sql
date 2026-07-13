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
  outcome         text,                  -- уважена | отхвърлена | прекратена | частично
  decision_date   text,
  suspension      boolean,               -- спиране temporary measure granted
  source_url      text NOT NULL,
  fetched_at      text NOT NULL
);
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
GRANT SELECT ON kzk_appeals TO app_readonly;

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
    'outcome', outcome,
    'decisionDate', decision_date,
    -- Effective suspended state: the `suspension` column is TIER-2-ONLY (the
    -- decisions register); intake writes NULL. Fall back to the fresh intake
    -- status (спряно производство) so a live suspension shows without waiting for
    -- tier-2 — and, unlike a stored intake bool, updates false→true on re-scrape.
    'suspension', COALESCE(suspension, status ~* 'спрян'),
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
           a.outcome,
           -- effective suspended (tier-2 column OR fresh intake status) — see
           -- tender_appeals above.
           COALESCE(a.suspension, a.status ~* 'спрян') AS suspension,
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
          AND COALESCE(k.suspension, k.status ~* 'спрян')) AS appeal_suspended
FROM tenders t;
GRANT SELECT ON tenders_list TO app_readonly;

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
GRANT SELECT ON appealed_ocids TO app_readonly;

-- Ocids whose procedure had an appeal КЗК UPHELD (уважена = the buyer's decision
-- annulled) — the authoritative "found improper" signal that feeds the contract
-- Corruption Risk Index (procedureAppealUpheld component). Same refresh cadence.
DROP MATERIALIZED VIEW IF EXISTS upheld_ocids CASCADE;
CREATE MATERIALIZED VIEW upheld_ocids AS
  SELECT DISTINCT t.ocid FROM tenders t JOIN kzk_appeals k ON k.unp = t.unp
  WHERE k.outcome = 'уважена' AND t.ocid IS NOT NULL AND t.ocid <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_upheld_ocids ON upheld_ocids(ocid);
GRANT SELECT ON upheld_ocids TO app_readonly;

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
-- reapply-safety as tenders_list above.
DROP VIEW IF EXISTS kzk_appeals_list;
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
       a.outcome,
       a.decision_date,
       a.suspension,
       a.vm_requested,
       (t.unp IS NOT NULL) AS resolved
FROM kzk_appeals a
LEFT JOIN tenders t ON t.unp = a.unp;
GRANT SELECT ON kzk_appeals_list TO app_readonly;
