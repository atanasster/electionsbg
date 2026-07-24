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
-- THE COHORT (the site owner's explicit list, 2026-07-24, refined after the T3.0 review):
-- members of parliament — sitting AND former; ministers and deputy ministers (incl. the PM
-- / caretaker cabinets); municipal mayors; and magistrates. Deputy mayors, councillors,
-- chief architects and appointed кметски наместници are excluded, as is everyone else —
-- the metric is simply not computed for them, and the feature must not render a gap for a
-- person this returns false for.
--
-- Кметове на кметства (village mayors) are IN scope by the same elected-executive
-- reasoning, but note this is forward-looking: the register's only mayor category covers
-- общини and райони, so no кметство mayor reaches official_muni today.
--
-- FORMER MPs. source='mp' already covers every MP in data/parliament/index.json — 2,122
-- people across NS 43-51, not only the ~240 sitting ones — so "former MPs are in scope" is
-- already largely satisfied. The candidate rung below closes the narrow remaining gap: a
-- person whose id has dropped OUT of that index (a stale by-slug shard outlives it) keeps
-- their candidate roles but loses source='mp', and would silently fall out of the cohort.
-- Candidate refs are "<election>:<slug>" and only a parliament.bg record ever mints an
-- "mp-<id>" slug (no candidate slug contains a colon), so the LIKE cannot admit a non-MP.
--
-- A person_role join, so it re-derives with the resolver; no data of its own.
-- §6 PRIVACY GATE, same as every other person-serving surface (082, 090): the
-- person must be ACTIVE and PUBLIC. status='review' is an identity merge nobody has
-- adjudicated (081) — publishing an enrichment figure built from two provisionally
-- merged people is precisely the harm this gate exists to prevent, so the flags are
-- checked HERE, in the function the methodology designates as the enforcement point,
-- not left to each caller.
DROP FUNCTION IF EXISTS person_is_accountability_senior(bigint);
CREATE OR REPLACE FUNCTION person_is_accountability_senior(p_person_id bigint)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM person_role r
      JOIN person p ON p.person_id = r.person_id
     WHERE r.person_id = p_person_id
       AND p.status = 'active' AND p.is_public_figure
       AND (
            r.source = 'mp'
         OR (r.source = 'candidate' AND r.ref LIKE '%:mp-%')  -- former MPs
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
    -- Without this branch a person admitted ONLY by the candidate rung falls through a
    -- CASE that has no ELSE and lands in the cohort with a NULL caption.
    WHEN r.source = 'candidate' THEN 'former_mp'
    WHEN r.source = 'official_exec' AND r.role = 'cabinet' THEN 'minister'
    WHEN r.source = 'official_exec' AND r.role = 'deputy_minister' THEN 'deputy_minister'
    WHEN r.source = 'official_muni' AND r.role = 'mayor' THEN 'mayor'
    WHEN r.source = 'magistrate' THEN 'magistrate'
  END AS qualifying_office
FROM person p
JOIN person_role r ON r.person_id = p.person_id
WHERE p.status = 'active' AND p.is_public_figure
  AND (
       r.source = 'mp'
    OR (r.source = 'candidate' AND r.ref LIKE '%:mp-%')  -- former MPs
    OR (r.source = 'official_exec' AND r.role IN ('cabinet', 'deputy_minister'))
    OR (r.source = 'official_muni' AND r.role = 'mayor')
    OR r.source = 'magistrate'
  )
ORDER BY p.person_id,
  -- highest authority wins the caption. Ranked by source THEN role THEN ref: two
  -- official_exec roles (deputy minister, later minister) tie on source, and without
  -- the role rung DISTINCT ON picks arbitrarily — the caption would flip between
  -- deploys with no data change.
  CASE r.source
    WHEN 'mp' THEN 1
    WHEN 'official_exec' THEN 2
    WHEN 'magistrate' THEN 3
    WHEN 'official_muni' THEN 4
    WHEN 'candidate' THEN 5   -- former MP: a sitting office outranks it for the caption
    ELSE 6
  END,
  CASE r.role WHEN 'cabinet' THEN 1 WHEN 'deputy_minister' THEN 2 ELSE 3 END,
  r.ref;

GRANT SELECT ON accountability_senior TO app_readonly;
