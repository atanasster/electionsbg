-- Lightweight scoped counts for the /procurement HUB stat tiles that aren't in
-- the procurement_overview payload. Kept OUT of procurement_overview (a hot,
-- cached function) so the hub can fetch these independently and the overview
-- stays lean.
--
--   tenders — windowed by publication_date; idx_tenders_order
--             (publication_date, unp) makes the range sargable.
--   appeals — windowed by kzk_appeals.complaint_date (small table).
--   ngos    — all-time distinct funded NGOs: ngo_funding has NO date column
--             (external NGO funding isn't parliament-scoped), so this ignores
--             the window by construction.
--
-- Deliberately EXCLUDES flags + by-place: the risk feed (029) and settlement
-- rollup (030) are heavy per-window aggregations with no cheap windowed cache,
-- so counting them here would tax every hub load (worst case ?pscope=all).
-- Sargable COALESCE bounds (NOT `p_from IS NULL OR …`) — same rule as
-- procurement_overview (025). Depends on tenders (009), kzk_appeals (042),
-- ngo_funding (040). EXECUTE → app_readonly.

SET check_function_bodies = off;
DROP FUNCTION IF EXISTS procurement_hub_counts(text, text);
CREATE OR REPLACE FUNCTION procurement_hub_counts(
  p_from text DEFAULT NULL,
  p_to   text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'tenders', (
      SELECT count(*)::int FROM tenders
      WHERE publication_date >= COALESCE(p_from, '')
        AND publication_date <  COALESCE(p_to, '9999-99-99')
    ),
    'appeals', (
      SELECT count(*)::int FROM kzk_appeals
      WHERE complaint_date >= COALESCE(p_from, '')
        AND complaint_date <  COALESCE(p_to, '9999-99-99')
    ),
    'ngos', (
      SELECT count(DISTINCT eik)::int FROM ngo_funding WHERE eik IS NOT NULL
    )
  );
$$;
GRANT EXECUTE ON FUNCTION procurement_hub_counts(text, text) TO app_readonly;
