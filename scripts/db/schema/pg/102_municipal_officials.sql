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
-- WHERE THE OBSHTINA CODE COMES FROM. person_role.place_code (migration 115, place_kind
-- = 'obshtina'), filled by db:resolve:persons from
-- official_roster.obshtina, which the roster loader reads out of the emitted by_obshtina
-- shards (T0.2a, migration 080). It is NOT derivable here: the register names a
-- municipality in prose ("Гоце Делчев") and the name→code join lives in
-- scripts/officials/municipality_join.ts behind an alias file, four fallback strategies and
-- synthetic codes for Sofia's 24 district councils. Attempting it in SQL would be a second
-- source of truth. If place_code is ever NULL again this matview simply loses those rows —
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
  r.place_code                AS obshtina,
  ld.institution              AS municipality,
  ld.period_year              AS latest_declaration_year,
  o.district,
  -- Is this listing on the SITTING BENCH? See municipal_officials_current below.
  -- COALESCE to TRUE, deliberately: a listing with no official_roster row (the loader
  -- never ran on this database, or the ingest broke) errs toward being SHOWN. That
  -- degrades to the pre-column behaviour — everyone published — rather than blanking a
  -- municipality page, and municipal_officials.data.test.ts is what reports it.
  COALESCE(o.sitting, true)   AS is_sitting,
  (ld.listing_ref IS NOT NULL) AS has_declaration,
  -- candidateLink decoration (migration 108, T1.5): party / ballot / MP-photo enrichment
  -- the by_obshtina JSON shards carried. NULL for a listing with neither a local-election
  -- slate match nor an MP-photo match (and for chief_architect / other, which the loader
  -- never decorates). The frontend reassembles the OfficialCandidateLink object from these.
  cl.cycle                    AS candidate_cycle,
  cl.party_name               AS candidate_party_name,
  cl.party_canonical_id       AS candidate_party_canonical_id,
  cl.list_pos                 AS candidate_list_pos,
  cl.pref_votes               AS candidate_pref_votes,
  cl.is_elected               AS candidate_is_elected,
  cl.mp_id                    AS candidate_mp_id,
  cl.photo_url                AS candidate_photo_url
FROM person_role r
JOIN person p ON p.person_id = r.person_id
             -- §6 privacy gate (see the header).
             AND p.status = 'active'
             AND p.is_public_figure
LEFT JOIN latest_decl ld ON ld.listing_ref = r.ref
-- district lives on the roster for the same reason obshtina does — municipality_join.ts
-- derives both from the institution string in one pass and neither is reproducible here.
LEFT JOIN official_roster o ON o.slug = r.ref
-- candidateLink, keyed on the listing's official_slug. Populated by
-- load_official_candidate_links_pg.ts, which REFRESHes this matview after it COPYs; empty
-- (all NULLs) on a fresh DB until that loader runs.
LEFT JOIN official_candidate_link cl ON cl.official_slug = r.ref
WHERE r.source = 'official_muni'
  AND r.place_kind = 'obshtina';

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

-- ---------------------------------------------------------------------------
-- THE SITTING BENCH — what a municipality page actually serves.
--
-- The matview above is the WHOLE accumulated roster, and that is deliberate: two of its
-- three consumers need every official who ever served. `municipal-officials-name-index`
-- resolves a name out of a partial-election feed spanning earlier cycles, and
-- `municipal-officials-search-index` is the header search — a councillor who left still
-- cast the votes the minutes record, and still has a /person page to reach.
--
-- The third consumer must not. The `municipal_officials` db_table resource backs the
-- Mayor / Composition / Roster tiles, which answer "who represents me NOW", and it
-- replaced the by_obshtina shards — which carry only the bench (build_municipal_shards
-- .currentBench). So the split the shards make on disk has to exist here too, and this
-- view is where it lands: the resource reads it, the two index routes keep reading the
-- matview.
--
-- WHY THIS IS A VIEW AND NOT A `WHERE` IN THE MATVIEW. Filtering the matview would take
-- the retained cohort away from the other two consumers, which is the defect the roster's
-- retention exists to prevent (scripts/officials/municipal_roster_retention.test.ts).
-- Both facts have to be reachable; only one of them is the roster.
--
-- Measured on the 2025→2026 rollover: 6,647 listings, 6,313 sitting. Before this the
-- resource served all 6,647, so 334 officials who had left were rendered as sitting —
-- Царево published a departed deputy mayor beside its four real ones, and PAZ19 24 of them.
CREATE OR REPLACE VIEW municipal_officials_current AS
  SELECT * FROM municipal_officials_table WHERE is_sitting;

-- The page query is now `obshtina = $1 AND is_sitting ORDER BY name, official_slug`, so the
-- bench predicate belongs in the index or every municipality page filters after the seek.
CREATE INDEX idx_municipal_officials_obshtina_bench
  ON municipal_officials_table (obshtina, name, official_slug) WHERE is_sitting;
-- The /governance city-wide seek (see idx_municipal_officials_citywide) with the same
-- predicate — a departed mayor also has a NULL district and would otherwise win the pick.
CREATE INDEX idx_municipal_officials_citywide_bench
  ON municipal_officials_table (obshtina, role) WHERE district IS NULL AND is_sitting;
