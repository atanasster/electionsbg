-- 205 — the Commerce Registry's index of ANNOUNCED ACTS (обявени актове):
-- one row per document a company has published (ГФО, доклад за дейността, the
-- чл. 38 no-activity declaration, устав, покани …), keyed by the register's own
-- 32-hex ActID. docs/plans/tr-gfo-ingest-v1.md, Phase 0.
--
-- Loader: scripts/db/load_tr_announced_acts_pg.ts (db:load:tr-announced-acts:pg),
-- the last step of tr:daily-refresh. Two sources, merged per ActID:
--   • the TR daily feed archive (raw_data/tr/daily, gitignored) — G1_ActAnnouncement
--     Statements*. ⚠️ The feed stopped carrying the ГФО family (StatementsB / BH / BI)
--     on 2026-10-12 (ДВ бр. 92/2026 moved ГФО into a separate stream), so the
--     feed-based ГФО index ends there; tr_announced_act_feed_file records each day's
--     ГФО count so the cutover — and any return — is visible.
--   • CR portal deed captures (raw_data/tr/cr_deeds.sqlite, gitignored) — the same
--     list rendered per company, with the announcement date the feed leaves blank and
--     acts announced after the cutover.
--
-- ⚠️ UPSERT-ONLY. The daily files and the captures are both host state; an act that
-- drops out of a later capture is still a document that was published. The loader
-- never deletes, and a column a source does not carry (NULL) never overwrites one
-- another source did.
--
-- An act's presence here means the register ANNOUNCED a document — never that we
-- hold its content. No figure from a statement lives in this table.

CREATE TABLE IF NOT EXISTS tr_announced_act (
  act_id               text PRIMARY KEY CHECK (act_id ~ '^[0-9a-f]{32}$'),
  uic                  text NOT NULL,
  -- the feed's ActModeValue (2 = ГФО, 60 = доклад, 61 = декларация, 36 = устав …);
  -- a CR-only act gets one through tr_act_mode by its label, else stays NULL.
  act_mode             smallint,
  act_mode_text        text NOT NULL,
  -- the section key both sources share (ГФО '10019B', доклад '1001BH', декларация
  -- '1001BI', устав '1001AJ').
  field_ident          text,
  description          text,
  -- the register's own year field; fiscal_year adds the year parsed out of a ГФО-family
  -- description („… за 2008 г.") and is NULL for every other kind of act.
  act_year             smallint,
  fiscal_year          smallint,
  announced_at         timestamptz,
  erased_personal_data boolean,
  in_feed              boolean NOT NULL DEFAULT false,
  in_cr                boolean NOT NULL DEFAULT false,
  first_seen_feed_day  date,
  first_seen_at        timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tr_announced_act_uic
  ON tr_announced_act (uic, fiscal_year);
CREATE INDEX IF NOT EXISTS idx_tr_announced_act_mode_year
  ON tr_announced_act (field_ident, fiscal_year);
CREATE INDEX IF NOT EXISTS idx_tr_announced_act_announced
  ON tr_announced_act (announced_at);
CREATE INDEX IF NOT EXISTS idx_tr_announced_act_feed_day
  ON tr_announced_act (first_seen_feed_day);

-- Mode ↔ label dictionary, learnt from the feed (which carries both).
CREATE TABLE IF NOT EXISTS tr_act_mode (
  act_mode      smallint PRIMARY KEY,
  act_mode_text text NOT NULL
);

-- One row per scanned daily feed file: the progress ledger that makes the loader
-- incremental, and the canary for the 2026-10-12 cutover (gfo_acts).
CREATE TABLE IF NOT EXISTS tr_announced_act_feed_file (
  day        date PRIMARY KEY,
  file_name  text NOT NULL,
  file_bytes bigint NOT NULL,
  acts       integer NOT NULL,
  gfo_acts   integer NOT NULL,
  scanned_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON tr_announced_act, tr_act_mode, tr_announced_act_feed_file
      TO app_readonly;
  ELSE
    RAISE WARNING 'app_readonly absent — 205 granted nothing. Run db:pg:bootstrap.';
  END IF;
END $$;
