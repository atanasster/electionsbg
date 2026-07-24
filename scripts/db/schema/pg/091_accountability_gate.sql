-- 091_accountability_gate.sql — the editorial gate for the accumulation-gap metric.
--
-- The accumulation gap (Δ net worth vs declared income between two filings — the metric
-- КПКОНПИ is statutorily meant to check) is, on a NAMED individual, the same class of
-- defamation risk as the sanctions / ДС facets. Per the audit's T3.0 decision it is
-- computed ONLY for a defined senior cohort — the highest public accountability, where
-- publishing a declared-vs-audited discrepancy is defensible — never for the ~4,700
-- municipal councillors or the long tail of lower officials. See the published
-- methodology: docs/methodology/accumulation-gap.md.
--
-- THE COHORT (the site owner's explicit list, 2026-07-24): members of parliament;
-- ministers and deputy ministers (incl. the PM / caretaker cabinets); municipal MAYORS
-- (not deputy mayors, not councillors, not chief architects); and magistrates. Everyone
-- else is excluded — the metric is simply not computed for them, and the feature must
-- not render a gap for a person this returns false for.
--
-- A person_role join, so it re-derives with the resolver; no data of its own.
DROP FUNCTION IF EXISTS person_is_accountability_senior(bigint);
CREATE OR REPLACE FUNCTION person_is_accountability_senior(p_person_id bigint)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM person_role r
     WHERE r.person_id = p_person_id
       AND (
            r.source = 'mp'
         OR (r.source = 'official_exec' AND r.role IN ('cabinet', 'deputy_minister'))
         OR (r.source = 'official_muni' AND r.role = 'mayor')
         OR r.source = 'magistrate'
       )
  );
$$;

-- A convenience view for the feature + its tests: every person the gap MAY be computed
-- for, with the single office label that qualified them (highest-authority first) so the
-- page can caption "as an MP" / "as a minister" without recomputing the gate.
DROP VIEW IF EXISTS accountability_senior;
CREATE VIEW accountability_senior AS
SELECT DISTINCT ON (p.person_id)
  p.person_id,
  p.slug,
  p.display_name,
  CASE
    WHEN r.source = 'mp' THEN 'mp'
    WHEN r.source = 'official_exec' AND r.role = 'cabinet' THEN 'minister'
    WHEN r.source = 'official_exec' AND r.role = 'deputy_minister' THEN 'deputy_minister'
    WHEN r.source = 'official_muni' AND r.role = 'mayor' THEN 'mayor'
    WHEN r.source = 'magistrate' THEN 'magistrate'
  END AS qualifying_office
FROM person p
JOIN person_role r ON r.person_id = p.person_id
WHERE p.is_public_figure
  AND (
       r.source = 'mp'
    OR (r.source = 'official_exec' AND r.role IN ('cabinet', 'deputy_minister'))
    OR (r.source = 'official_muni' AND r.role = 'mayor')
    OR r.source = 'magistrate'
  )
ORDER BY p.person_id,
  -- highest authority wins the caption
  CASE r.source
    WHEN 'mp' THEN 1
    WHEN 'official_exec' THEN 2
    WHEN 'magistrate' THEN 3
    WHEN 'official_muni' THEN 4
    ELSE 5
  END;

GRANT SELECT ON accountability_senior TO app_readonly;
