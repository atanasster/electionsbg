-- The КЗК decisions (Решения/Определения) corpus — tier 2 of the appeals pack.
--
-- WHY THIS EXISTS: until now this corpus lived ONLY in
-- data/procurement/kzk_decisions.json, which is gitignored and had NO committed
-- generator. 4,836 rows produced interactively on 2026-07-04, on one machine,
-- with no table, no changelog and no gate — the exact "irreplaceable artifact
-- with no code behind it" failure class the freshness work exists to end. It is
-- also what let the arm freeze silently: `max(kzk_appeals.decision_date)` stopped
-- at 2026-06-25 and nothing in the repo could tell.
--
-- WHY IT IS NOT ENOUGH TO GATE ON kzk_appeals.decision_date: the join from a
-- decision to a complaint is lossy by nature — MEASURED 1,838 of 4,836 decision
-- rows match no appeal at all (КЗК consolidates several complaints into one act,
-- and the register carries acts for cases we never ingested). So the register's
-- newest act can legitimately never appear in `kzk_appeals`, and a freshness gate
-- anchored there fails on a perfectly current table. The gate anchors HERE
-- instead — see scripts/db/tests/kzk_decisions.data.test.ts.
--
-- SHAPE. One row per act. `act_no` ("АКТ-608-25.06.2026") is the natural key and
-- is unique in the register. `kzk_case_no` ("КЗК/417/2026") is the КЗК case
-- number — carried because it is the join key an EXACT complaint↔decision link
-- would use if the per-complaint detail page turns out to publish it (the T8
-- spike); it costs one column to keep the option open.
--
-- `initiators` is stored AS PRINTED — a ';'-joined party list, because one act
-- can resolve several joined complaints. Splitting it is the matcher's job
-- (scripts/procurement/kzk_match.ts), not the schema's: the register's own text
-- is the record, and a pre-split column would bake one parse into the store.
--
-- TWO REGISTERS, ONE TABLE. `ot=2` publishes решения (the merits ruling) and
-- `ot=6` определения (the temporary-measure ruling) — verified 2026-08-02; the
-- latter is the only authoritative source for `kzk_appeals.suspension` and had
-- never been crawled. Act numbers are unique across both, so they share the
-- table and the `kind` column keeps them apart where it matters.
--
-- ⚠️ Populated by scripts/db/load_kzk_decisions_pg.ts
-- (`npm run db:load:kzk-decisions:pg` / `:cloud`) from the JSON corpus, and by
-- scripts/procurement/kzk_decisions.ts --apply on a live crawl. There is no
-- automatic cloud path: `db:refresh` runs the local equivalent, the cloud side
-- needs the `:cloud` command by hand.
--
-- SELECT is granted explicitly at the foot of this file — there are no functions
-- here, so nothing rides roles_readonly.sql's ALTER DEFAULT PRIVILEGES. The
-- grant is guarded on the role existing so this migration still applies on a cold
-- bootstrap where roles_readonly.sql has never run (same reason, same shape as
-- 117_place_dim.sql).

CREATE TABLE IF NOT EXISTS kzk_decisions (
  act_no        text PRIMARY KEY,   -- "АКТ-608-25.06.2026"
  decision_date text NOT NULL,      -- Дата (YYYY-MM-DD; ISO so lexical == chronological)
  pronouncement text,               -- Произнасяне — the free-text ruling
  kzk_case_no   text,               -- "КЗК/417/2026"
  initiators    text,               -- жалбоподател(и), ';'-joined AS PRINTED
  respondent    text,               -- ответник (buyer, as printed by КЗК)
  source_url    text NOT NULL,
  fetched_at    text NOT NULL,
  -- Which register the act came from: 'решения' (the merits ruling) or
  -- 'определения' (the temporary-measure ruling). NULL on the 2026-07-04 corpus,
  -- which predates the ot-parameter enumeration.
  --
  -- ⚠️ ONLY 'определения' IS EXCLUDED FROM MERITS MATCHING — a NULL kind counts as
  -- eligible. Those legacy rows are the source of every outcome served today, so
  -- treating unknown as ineligible would silently drop ~2,860 matches. See
  -- setsMeritsOutcome() in scripts/procurement/kzk_decisions_store.ts.
  kind          text
);

-- Idempotent for a database created before the column existed.
ALTER TABLE kzk_decisions ADD COLUMN IF NOT EXISTS kind text;

-- The gate reads max(decision_date); the matcher scans by year. Both want this.
CREATE INDEX IF NOT EXISTS idx_kzk_decisions_date
  ON kzk_decisions(decision_date DESC);
-- Reserved for the exact-join spike (T8) and for auditing a match by case number.
CREATE INDEX IF NOT EXISTS idx_kzk_decisions_case
  ON kzk_decisions(kzk_case_no) WHERE kzk_case_no IS NOT NULL;
-- The matcher scans the merits-eligible subset on every rejoin.
CREATE INDEX IF NOT EXISTS idx_kzk_decisions_kind
  ON kzk_decisions(kind) WHERE kind IS DISTINCT FROM 'решения';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON kzk_decisions TO app_readonly;
  END IF;
END $$;
