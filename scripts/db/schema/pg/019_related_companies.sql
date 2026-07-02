-- "Related companies (same owners)" for the DB company page (/db/company/:eik).
-- Finds OTHER companies that share an owner with this one, via tr_person_roles
-- (TR partners/owners), matched on the normalised name_fold.
--
-- NAMESAKE DISCIPLINE (critical): TR carries no personal ID, so owner identity
-- is name-only — and common names collide massively (one owner name maps to 286
-- distinct companies; see project_procurement_namesake_fix). So a plain name
-- match produces garbage clusters. We gate on a HIGH-CONFIDENCE rule:
--   * the shared owner has a DECLARED STAKE (share_amount) in BOTH companies, OR
--   * the owner name is globally RARE (appears in <= RARE_MAX companies).
-- Owner names above USABLE_MAX companies are dropped entirely unless they carry a
-- declared stake here (nominee / namesake noise). Every result also carries the
-- owner's global company_count so the UI can show "owns N companies" for context.
--
-- owner_name_counts (matview, REFRESHed in load_tr_pg.ts) gives namesake severity
-- per name; name_fold is btree-indexed on tr_person_roles so the self-join is
-- bounded. Depends on tr_person_roles + tr_companies. SELECT/EXECUTE → app_readonly.

SET check_function_bodies = off;

CREATE MATERIALIZED VIEW IF NOT EXISTS owner_name_counts AS
  SELECT name_fold, (COUNT(DISTINCT uic))::int AS company_count
  FROM tr_person_roles
  WHERE name_fold IS NOT NULL AND name_fold <> ''
  GROUP BY name_fold;
CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_name_counts_fold
  ON owner_name_counts(name_fold);
GRANT SELECT ON owner_name_counts TO app_readonly;

DROP FUNCTION IF EXISTS company_related(text);
CREATE OR REPLACE FUNCTION company_related(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH my_owners AS (
  SELECT pr.name_fold,
         MAX(pr.name)                              AS person_name,
         bool_or(pr.share_amount IS NOT NULL)      AS stake_here,
         MAX(c.company_count)                      AS company_count
  FROM tr_person_roles pr
  JOIN owner_name_counts c USING (name_fold)
  WHERE pr.uic = p_eik AND pr.name_fold <> ''
  GROUP BY pr.name_fold
),
-- Drop hopelessly-common owner names unless they hold a declared stake here.
usable AS (
  SELECT * FROM my_owners WHERE company_count <= 50 OR stake_here
),
sibs AS (
  SELECT pr.uic                                     AS other_eik,
         u.person_name,
         u.name_fold,
         u.company_count                            AS namesake_count,
         (u.company_count <= 6
          OR (u.stake_here AND pr.share_amount IS NOT NULL)) AS high_conf
  FROM usable u
  JOIN tr_person_roles pr ON pr.name_fold = u.name_fold
  WHERE pr.uic <> p_eik
),
agg AS (
  SELECT s.other_eik,
         bool_or(s.high_conf)                        AS high_conf,
         (COUNT(DISTINCT s.name_fold))::int          AS shared_count,
         MIN(s.namesake_count)                       AS min_namesake,
         jsonb_agg(DISTINCT s.person_name)           AS persons
  FROM sibs s
  GROUP BY s.other_eik
)
SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x."sharedCount" DESC, x."namesakeCount" ASC), '[]'::jsonb)
FROM (
  SELECT a.other_eik                 AS "eik",
         tc.name                     AS "name",
         tc.status                   AS "status",
         a.persons                   AS "sharedOwners",
         a.shared_count              AS "sharedCount",
         a.min_namesake              AS "namesakeCount"
  FROM agg a
  LEFT JOIN tr_companies tc ON tc.uic = a.other_eik
  WHERE a.high_conf          -- only high-confidence relations surface
  ORDER BY a.shared_count DESC, a.min_namesake ASC
  LIMIT 30
) x;
$$;
