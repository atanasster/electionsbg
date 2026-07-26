-- 102_municipal_officials.sql — the per-obshtina municipal roster, served from PG.
--
-- Backs the `municipal_officials` db_table.js REGISTRY resource, which replaces the static
-- data/officials/municipal/by_obshtina/<code>.json shards read by useMunicipalOfficials
-- (the Mayor / Composition / Roster tiles on a municipality page) and the
-- municipal/search_index.json read by useMunicipalOfficialsByName.
-- Plan: docs/plans/persons-pg-retirement-v1.md (Tier 0.2).
--
-- ---------------------------------------------------------------------------
-- ONE ROW PER ROSTER LISTING, NOT PER PERSON — the opposite of 100.
--
-- officials_rankings_table is person-keyed and its `slug` is UNIQUE, because a leaderboard
-- ranks humans. This is a ROSTER: it answers "who sits in обштина X", and 46 people sit in
-- more than one. Keying it on the person would silently drop one of their seats and make
-- the two municipalities disagree about their own council. So the grain is the roster
-- listing, the key is official_slug (6,391 rows, 6,391 distinct refs — one per listing),
-- and person_slug is a non-unique attribute used only to link out to /person.
--
-- ---------------------------------------------------------------------------
-- WHERE THE OBSHTINA CODE COMES FROM. person_role.place, filled by db:resolve:persons from
-- official_roster.obshtina, which the roster loader reads out of the emitted by_obshtina
-- shards (T0.2a, migration 080). It is NOT derivable here: the register names a
-- municipality in prose ("Гоце Делчев") and the name→code join lives in
-- scripts/officials/municipality_join.ts behind an alias file, four fallback strategies and
-- synthetic codes for Sofia's 24 district councils. Attempting it in SQL would be a second
-- source of truth. If place is ever NULL again this matview simply loses those rows —
-- official_roster_obshtina.data.test.ts is what catches that.
--
-- role_raw / municipality come from the person's newest MUNICIPAL declaration
-- (position_title / institution). They are display strings, so a roster listing without a
-- matching filing keeps its normalized `role` and renders those as NULL rather than being
-- dropped — being on the council is the fact, filing is a separate one.
--
-- §6 PRIVACY GATE. Applied, same as 100 and every serving fn in 082: a person parked in the
-- 'review' holding area or not opted in as a public figure is never listed.
--
-- REFRESH / DEPENDENCY ORDER. Reads person_role + declaration only (not person_wealth_year),
-- so it has no ordering constraint against 090's DROP ... CASCADE. It is still applied and
-- repopulated on every load_declarations_pg --resolve so it can never serve a roster older
-- than the corpus it describes.

DROP MATERIALIZED VIEW IF EXISTS municipal_officials_table CASCADE;

CREATE MATERIALIZED VIEW municipal_officials_table AS
WITH latest_decl AS (
  -- The newest municipal filing per person, for the display strings only.
  SELECT DISTINCT ON (d.person_id)
         d.person_id, d.institution, d.position_title,
         COALESCE(d.fiscal_year, d.declaration_year) AS period_year
  FROM declaration d
  WHERE d.tier = 'muni' AND d.person_id IS NOT NULL
  ORDER BY d.person_id, d.declaration_year DESC, d.declaration_id DESC
)
SELECT
  r.ref                       AS official_slug,
  p.slug                      AS person_slug,
  p.display_name              AS name,
  r.role,
  ld.position_title           AS role_raw,
  r.place                     AS obshtina,
  ld.institution              AS municipality,
  ld.period_year              AS latest_declaration_year,
  (ld.person_id IS NOT NULL)  AS has_declaration
FROM person_role r
JOIN person p ON p.person_id = r.person_id
             -- §6 privacy gate (see the header).
             AND p.status = 'active'
             AND p.is_public_figure
LEFT JOIN latest_decl ld ON ld.person_id = r.person_id
WHERE r.source = 'official_muni'
  AND r.place IS NOT NULL;

-- official_slug is the paging tiebreak buildOrder appends, so it must be unique.
CREATE UNIQUE INDEX idx_municipal_officials_slug ON municipal_officials_table (official_slug);
-- The page query: every listing for one obshtina, in the registry's DEFAULT SORT order
-- (name asc, then the official_slug tiebreak). The column order has to match that sort or
-- the planner scans and re-sorts — leading with `role` instead of `name` did exactly that.
CREATE INDEX idx_municipal_officials_obshtina
  ON municipal_officials_table (obshtina, name, official_slug);
CREATE INDEX idx_municipal_officials_person ON municipal_officials_table (person_slug);
CREATE INDEX idx_municipal_officials_role ON municipal_officials_table (role);
-- Backs the cross-municipality name search that replaces search_index.json. Both
-- search:true columns are indexed — an unindexed OR arm makes the planner ignore the other.
CREATE INDEX idx_municipal_officials_name_trgm
  ON municipal_officials_table USING gin (name gin_trgm_ops);
CREATE INDEX idx_municipal_officials_muni_trgm
  ON municipal_officials_table USING gin (municipality gin_trgm_ops);
