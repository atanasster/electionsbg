-- myarea_alerts — the per-município "Recent activity" feed.
-- Plan: docs/plans/json-retirement-v2.md Tier 4b (revised — see the design note below).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ THIS STORES A COMPOSED FEED; IT DOES NOT COMPOSE ONE. The plan said "move the fold into
-- SQL", and that is the wrong shape for this artifact.
--
-- `build_alerts.ts` is TEN heterogeneous builders — procurement, tenders, EU funds, Interreg,
-- funds changes, local elections, extraordinary elections, capital programmes, plenary
-- keyword matches, council resolutions — and each one composes a BILINGUAL HEADLINE:
--
--     „Общината обяви поръчка за 1,2 млн. лв." / "The municipality announced a €1.2M tender"
--
-- Those are translated user-facing sentences with pluralisation and money formatting. Moving
-- them into a migration means a second copy of the site's prose living in SQL, updated by
-- whoever next edits a string — the "rule copied by hand into SQL" hazard CLAUDE.md records,
-- with the failure showing up as a sentence rather than a number.
--
-- Four of the ten already read Postgres (council, Interreg, open-calls, municipal awarders);
-- three read committed files (chmi history, capital programmes, funds by-muni). The
-- composition is the part that must stay in TypeScript.
--
-- So the WIN here is storage, not computation: 290 files rebuilt and re-uploaded to the
-- bucket every single day become 290 rows written by a loader. data/myarea/ was measured at
-- 14,746 file-touches over 300 commits — the highest churn-per-byte tree in the repo — and
-- none of that churn was ever a serving artifact anyone diffed.
--
-- ⚠️ THE EVENTS ARE `jsonb`, ON PURPOSE. Ten kinds with genuinely different optional fields
-- (`programPeriod` on EU rows, `noticeKind` on procurement, `amountEur` on some) would be a
-- 15-column table that is NULL almost everywhere, and every new event kind would be a
-- migration. Nothing queries INSIDE an event — the tile renders the list as composed — so
-- the column is a payload, not a model. `generated_at` and the counts are promoted OUT of it
-- because those are the things a gate and an operator ask about.

CREATE TABLE IF NOT EXISTS myarea_alerts (
  obshtina     text PRIMARY KEY,
  -- The composed feed, newest first, already capped by the builder.
  events       jsonb       NOT NULL,
  -- Promoted so a staleness check does not have to parse the payload.
  event_count  int         NOT NULL,
  -- The newest event's date, NOT the write time — a município whose feed is all from March
  -- is a fact about the município, and `refreshed_at` below is the fact about us.
  newest_event date,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE myarea_alerts IS
  'Per-município composed activity feed, written by scripts/myarea/build_alerts.ts. Replaces '
  'the 290-file data/myarea/alerts/ tree that was rebuilt and re-uploaded daily. The events '
  'are composed in TypeScript — they carry bilingual prose — and only STORED here.';

COMMENT ON COLUMN myarea_alerts.newest_event IS
  'Date of the newest event in the feed. A fact about the município (its feed may legitimately '
  'be months old); refreshed_at is the fact about the last write.';

CREATE OR REPLACE FUNCTION myarea_alerts_for(p_obshtina text)
RETURNS TABLE (obshtina text, events jsonb, refreshed_at timestamptz)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT a.obshtina, a.events, a.refreshed_at
    FROM myarea_alerts a
   WHERE a.obshtina = p_obshtina
$$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON myarea_alerts TO app_readonly;
    GRANT EXECUTE ON FUNCTION myarea_alerts_for(text) TO app_readonly;
  ELSE
    RAISE WARNING 'app_readonly is absent — myarea_alerts has no ACL; run roles_readonly.sql then re-apply 184';
  END IF;
END $$;
