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
-- role_raw / municipality / latest_declaration_year are the LISTING's own labels, resolved
-- per roster listing (see listing_decl below) and never per person. A listing with no
-- filing on either route keeps its normalized `role` and renders these NULL rather than
-- being dropped — sitting on the council is the fact, filing is a separate one.
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
WITH listing_decl AS (
  -- Every filing that belongs to THIS roster listing, by two exact routes and no guessing:
  --   (a) the filing loaded under this subject_ref, and
  --   (b) the filing this listing shares with another slug but LOST to the source_url
  --       dedup — recovered through declaration_subject_alias (migration 101), which
  --       exists precisely because that dedup discards the link.
  -- Route (b) is not optional: 277 listings (831 field values) have no filing of their
  -- own because an official holding two posts files once, and keying on subject_ref alone
  -- rendered their role_raw / municipality / year as NULL.
  --
  -- What is deliberately NOT done here is falling back to the PERSON's newest municipal
  -- filing. That is what the first cut did, and for the 47 people holding two seats it
  -- stamped one seat's labels onto the other — a Добрич councillor rendered
  -- role_raw='Главен архитект', municipality='Тервел'.
  SELECT r.ref AS listing_ref, d.declaration_id,
         d.institution, d.position_title, d.declaration_year
  FROM person_role r
  JOIN declaration d ON d.tier = 'muni' AND d.subject_ref = r.ref
  WHERE r.source = 'official_muni'

  UNION ALL

  -- Route (b): this listing's filing was DROPPED by the source_url dedup, so the surviving
  -- row belongs to whichever listing won — and carries that listing's office, not this one.
  -- Чанка Иванова Коралска is "Заместник кмет / Бургас" here and "Процедури по ЗОП" on the
  -- executive listing that won; reading the survivor's labels would publish the wrong
  -- office on a municipal roster. So the labels come from the ALIAS row, which preserves
  -- the dropped listing's own institution / position_title / year (migration 101).
  -- Only for listings with no filing of their own, so route (a) always wins.
  SELECT r.ref, NULL::bigint,
         a.institution, a.position_title, a.declaration_year
  FROM person_role r
  JOIN declaration_subject_alias a ON a.subject_ref = r.ref
  WHERE r.source = 'official_muni'
    AND NOT EXISTS (SELECT 1 FROM declaration d2
                     WHERE d2.tier = 'muni' AND d2.subject_ref = r.ref)
),
latest_decl AS (
  SELECT DISTINCT ON (listing_ref)
         listing_ref, institution, position_title,
         declaration_year AS period_year
  FROM listing_decl
  ORDER BY listing_ref, declaration_year DESC, declaration_id DESC NULLS LAST
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
  o.district,
  (ld.listing_ref IS NOT NULL) AS has_declaration
FROM person_role r
JOIN person p ON p.person_id = r.person_id
             -- §6 privacy gate (see the header).
             AND p.status = 'active'
             AND p.is_public_figure
LEFT JOIN latest_decl ld ON ld.listing_ref = r.ref
-- district lives on the roster for the same reason obshtina does — municipality_join.ts
-- derives both from the institution string in one pass and neither is reproducible here.
LEFT JOIN official_roster o ON o.slug = r.ref
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
-- The /governance card picks a city-wide official by "has no district", so that test must
-- be an index seek and not a scan over every listing in a city with райони.
CREATE INDEX idx_municipal_officials_citywide
  ON municipal_officials_table (obshtina, role) WHERE district IS NULL;
-- Backs the cross-municipality name search that replaces search_index.json. Both
-- search:true columns are indexed — an unindexed OR arm makes the planner ignore the other.
CREATE INDEX idx_municipal_officials_name_trgm
  ON municipal_officials_table USING gin (name gin_trgm_ops);
CREATE INDEX idx_municipal_officials_muni_trgm
  ON municipal_officials_table USING gin (municipality gin_trgm_ops);
