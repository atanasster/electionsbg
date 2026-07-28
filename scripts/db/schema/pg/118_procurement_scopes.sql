-- 118_procurement_scopes.sql — the pscope windows, as rows.
--
-- WHY A TABLE. The scoped procurement precomputes (the per-settlement ranking and the
-- per-oblast payload) have to iterate "every window the UI can request" IN SQL, so a matview
-- can drive itself off it with a LATERAL join instead of the loader issuing one statement
-- per scope. The window definitions themselves are NOT authored here: they are written by
-- load_procurement_scopes_pg.ts from src/data/scope/windows.ts — the same function the React
-- hook calls — because a precompute keyed on a window the UI computes differently does not
-- fail, it serves the wrong period's numbers under the right label.
--
-- KEYS mirror the UI vocabulary exactly (useScope):
--   'all'              the whole corpus            → both bounds NULL
--   'y:<year>'         one calendar year           → [YYYY-01-01, YYYY+1-01-01)
--   'ns:<YYYY_MM_DD>'  one parliament's tenure     → [election, next-newer election)
-- 'ns' carries the election date because the default scope means a different window per
-- selected election.
--
-- date_to is EXCLUSIVE, matching the half-open [from, to) convention every windowed
-- procurement function already uses. A NULL bound means "unbounded on that side", which is
-- why the sargable windowed queries COALESCE rather than compare against NULL.

CREATE TABLE IF NOT EXISTS procurement_scopes (
  scope_key text PRIMARY KEY,
  date_from text,          -- inclusive; NULL = from the start of the corpus
  date_to   text,          -- EXCLUSIVE; NULL = to the end of the corpus
  -- Ordering hint so a precompute's output is deterministic across instances rather than
  -- depending on insert order (same determinism rule as the jsonb payload sorts).
  sort_ord  int NOT NULL,
  CONSTRAINT procurement_scopes_window CHECK (
    date_from IS NULL OR date_to IS NULL OR date_from < date_to
  )
);

GRANT SELECT ON procurement_scopes TO app_readonly;
