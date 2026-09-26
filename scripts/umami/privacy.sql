-- Privacy hardening + retention for the self-hosted Umami database (docs/plans/gdpr-consent-v1.md).
--
-- Applied to the `umami` DATABASE (not `electionsbg`), as its owner, once after Umami's own
-- migrations have created the tables — and again after any Umami upgrade, since it is idempotent:
--
--   psql "$UMAMI_DATABASE_URL" -f scripts/umami/privacy.sql
--
-- Why this lives in the database rather than in the tracker config or a scheduled job:
--   • The tracker settings (`data-exclude-search`, the before-send hook in src/lib/analytics.ts)
--     are enforced by the CLIENT. The /privacy page makes promises about what is STORED, so the
--     store enforces them too — an old bundle, a hand-built request or a future tracker default
--     cannot put a query string, a page title or a city into these tables.
--   • Self-hosted Umami has no retention setting, and Cloud SQL only offers pg_cron behind an
--     instance flag (= a restart of the serving database). A statement-level trigger that runs
--     the delete at most once per day needs no scheduler, no secret and no extra service.
--
-- What /privacy promises, and the line here that keeps it true:
--   "country and region, never the city"          → umami_strip_session
--   "the page, without the parameters after ?"    → umami_strip_event (url_query, click ids, utm)
--   (page title is not stored — it names people)  → umami_strip_event (page_title)
--   "kept for up to 25 months"                    → umami_retention

CREATE OR REPLACE FUNCTION umami_strip_session() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.city := NULL;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS umami_strip_session ON session;
CREATE TRIGGER umami_strip_session BEFORE INSERT OR UPDATE ON session
  FOR EACH ROW EXECUTE FUNCTION umami_strip_session();

CREATE OR REPLACE FUNCTION umami_strip_event() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.page_title     := NULL;
  NEW.url_query      := NULL;
  NEW.referrer_query := NULL;
  NEW.fbclid := NULL; NEW.gclid := NULL; NEW.li_fat_id := NULL;
  NEW.msclkid := NULL; NEW.ttclid := NULL; NEW.twclid := NULL;
  NEW.utm_campaign := NULL; NEW.utm_content := NULL; NEW.utm_medium := NULL;
  NEW.utm_source := NULL; NEW.utm_term := NULL;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS umami_strip_event ON website_event;
CREATE TRIGGER umami_strip_event BEFORE INSERT OR UPDATE ON website_event
  FOR EACH ROW EXECUTE FUNCTION umami_strip_event();

-- Retention. One row records the last day the sweep ran, so the delete happens on the first
-- new session of each day and never more often.
CREATE TABLE IF NOT EXISTS umami_retention_state (
  id       boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_run date NOT NULL
);

CREATE OR REPLACE FUNCTION umami_retention_sweep() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  cutoff timestamptz := now() - interval '25 months';
BEGIN
  DELETE FROM event_data    WHERE created_at < cutoff;
  DELETE FROM revenue       WHERE created_at < cutoff;
  DELETE FROM website_event WHERE created_at < cutoff;
  DELETE FROM session_data  WHERE created_at < cutoff;
  DELETE FROM session s
   WHERE s.created_at < cutoff
     AND NOT EXISTS (SELECT 1 FROM website_event e WHERE e.session_id = s.session_id);
END $$;

CREATE OR REPLACE FUNCTION umami_retention() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- The upsert claims today's run; a concurrent session insert that loses the race does nothing.
  INSERT INTO umami_retention_state (id, last_run) VALUES (true, current_date)
  ON CONFLICT (id) DO UPDATE SET last_run = EXCLUDED.last_run
    WHERE umami_retention_state.last_run < EXCLUDED.last_run;
  IF FOUND THEN
    PERFORM umami_retention_sweep();
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS umami_retention ON session;
CREATE TRIGGER umami_retention AFTER INSERT ON session
  FOR EACH STATEMENT EXECUTE FUNCTION umami_retention();

-- Scrub anything stored before this file was applied, and run the sweep now.
UPDATE session SET city = NULL WHERE city IS NOT NULL;
UPDATE website_event SET page_title = NULL
 WHERE page_title IS NOT NULL OR url_query IS NOT NULL OR referrer_query IS NOT NULL;
SELECT umami_retention_sweep();
