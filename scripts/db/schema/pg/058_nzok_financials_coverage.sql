-- НЗОК reporting-coverage panel — the OpenPrescribing Hospitals "submission
-- history" idea: show, per hospital, which quarters of the МЗ financial forms
-- (ЕЕОФ) are present vs missing, so a REPORTING GAP is never misread as a real
-- drop in a metric. Coverage varies a lot across the 180-hospital corpus (many
-- appear only in recent quarters), which is exactly why the report card and the
-- decile fan need this context beside them.
--
-- Determinism: quarters ORDER BY quarter (a "YYYY-Qn" text key sorts correctly),
-- NULL when the hospital never reports.

CREATE OR REPLACE FUNCTION nzok_financials_coverage_by_eik(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH allq AS (SELECT DISTINCT quarter FROM nzok_hospital_financials),
  mine AS (SELECT DISTINCT quarter FROM nzok_hospital_financials WHERE eik = p_eik)
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM mine) THEN NULL ELSE jsonb_build_object(
    'eik',           p_eik,
    'totalQuarters', (SELECT COUNT(*)::int FROM allq),
    'presentCount',  (SELECT COUNT(*)::int FROM mine),
    'firstPresent',  (SELECT min(quarter) FROM mine),
    'lastPresent',   (SELECT max(quarter) FROM mine),
    'quarters', (
      SELECT jsonb_agg(jsonb_build_object(
               'quarter', a.quarter,
               'present', EXISTS (SELECT 1 FROM mine m WHERE m.quarter = a.quarter))
             ORDER BY a.quarter)
      FROM allq a)
  ) END;
$$;
