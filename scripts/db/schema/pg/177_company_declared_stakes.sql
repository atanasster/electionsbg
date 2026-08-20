-- 177_company_declared_stakes.sql — the declared-stake block on /company/:eik.
--
-- The company-keyed twin of 096's person_stake_procurement: "which people in public office
-- have declared a stake in, or a management role at, THIS company". It is what replaces the
-- retired /mp/company/:slug page, whose whole content this is.
-- Plan: docs/plans/company-page-consolidation-v1.md (Tier 1).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- WHY THIS IS NOT A PORT OF THE PAGE IT REPLACES, AND THE ANSWER CHANGES.
--
-- companies-index.json attached an EIK to a declared company NAME on a name-uniqueness check
-- alone (tr/integrate.ts). This reads declaration_stake_company, which additionally requires
-- the registry to place THE DECLARED HOLDER at that EIK and refuses a folded name shared by
-- two active people. Measured 2026-08-20: of the index's 2,120 UICs only 369 survive those
-- gates — and 096 resolves 966 UICs the index never had, because the index was MPs-only and
-- this covers every declarant tier.
--
-- So it NARROWS on attribution and WIDENS on population. Both are the point. A page saying
-- „X декларира дял" against a named EIK is a person↔company claim and must ride the same gate
-- /persons and the /person profile already ride.
--
-- ⚠️ NOTHING HERE MAY SAY „депутати". The population is public office-holders, of whom MPs are
-- a minority: this function is tier-blind by construction.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- WHY ITS OWN FILE RATHER THAN THE FOOT OF 096.
--
-- 096 opens with `DROP MATERIALIZED VIEW declaration_stake_company CASCADE`, so a one-line
-- body fix there costs a full matview rebuild. Local is ~6 s, which proves nothing: the local
-- tr_* tables have never been ANALYZEd, and this is the exact matview whose earlier form ran
-- 4 h 41 m on Cloud SQL holding an AccessExclusiveLock and 500ing
-- /api/db/person-stake-procurement throughout. Function changes stay off that path.
--
-- ⚠️ IT MUST BE APPLIED AFTER 096, IN THE SAME COMMAND. A `LANGUAGE sql` body is validated at
-- CREATE, so applying this to a database without declaration_stake_company raises 42P01, and
-- exec() sends a file as one transaction — the whole thing rolls back. The 081→082 trap.
--   npx tsx scripts/db/apply_functions.ts 096_stake_procurement.sql 177_company_declared_stakes.sql
--
-- ⚠️ THE BODY MUST STAY A STRING, NEVER `BEGIN ATOMIC`. A string body records no pg_depend
-- edge, which is what lets this function survive 096's CASCADE. The PG14+ atomic form DOES
-- record one, so converting it would make every 096 re-apply silently drop this function and
-- take the tile off the page at a 200. Same rule as dual_corpus_company_count() in 077.

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- SIX THINGS ABOUT THE PAYLOAD THAT ARE EASY TO GET BACKWARDS.
--
--  1. `stakeKind` IS LOAD-BEARING, NOT DECORATION. 54% of the интереси rows feeding the
--     matview are management ROLES, not holdings, and the two carry different footnotes and
--     different law (ЗПК чл. 35 bars a sitting MP from a directorship; owning shares is
--     lawful and common). Rendering a board seat under a „дялове" heading is a false claim
--     about a named person, and it is what the retired page did until it was split.
--
--  2. `table_num` IS NOT ON THE MATVIEW — it comes from declaration_stake, joined back on
--     (declaration_id, seq). It is the held/transferred distinction, and its reading DEPENDS
--     ON stakeKind: '11' means "transferred to someone" for a share and "held in the twelve
--     months before taking office, not since" for a role. Labelling a directorship
--     „прехвърлен" describes a share sale that never happened.
--
--  3. `holderIsDeclarant` IS PART OF THE GROUP KEY, not an aggregate over it. Tables 10/11
--     name a holder per row and it is frequently a spouse or a child. bool_or() over a group
--     mixing the two would publish somebody else's company as the office-holder's own — the
--     one direction 096's whole family arm exists to keep separate. Grouping on it instead
--     means an own row and a family row of the same size can never merge.
--
--  4. THE GROUP KEY IS (person, stakeKind, shareSize) AND DELIBERATELY NOT + value + basis.
--     A standing holding is re-declared on every entry into office and the value drifts
--     between filings — an unpriced интереси filing beside a valued asset one — so folding
--     those into the key splits ONE holding into a row per variant. Димитър Аврамов's single
--     50% arrives as 28 stake rows; on the value key that is still four rows of the same 50%.
--     Each varying field is taken from the most recent filing that stated one, so a year the
--     declarant left blank does not erase a figure they gave before.
--
--  5. ONE SOURCE LINK PER (year, body), NEWEST FIRST. Entering and leaving a mandate each
--     triggers a filing, so one unchanged holding produces up to four documents a year —
--     fifteen for Аврамов, eight of them labelled "2021", a wall of identical links that
--     helps nobody verify anything. Adding the body to the key keeps the distinction where
--     the register records one. It does NOT recover a distinction cacbg failed to record:
--     Ивайло Мирчев's two 2021 filings are the 45th and 46th National Assembly and the
--     register calls both „Народно събрание", so they collapse to one link — accepted, since
--     either document proves the same board seat. WHICH one survives is fixed by min(source_url)
--     rather than by scan order, so a REFRESH cannot silently swap the cited document.
--
--  6. `held` COMES FROM THE LATEST FILING, NOT FROM bool_or(). See the CTE comment — a
--     table-11 disposal is filed after the holding it ends, so "held anywhere wins" is
--     backwards, and it is the rule the retired page shipped.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- WHAT IS DELIBERATELY NOT HERE.
--
--   * `legalBasis` / `fundsOrigin`. The retired page rendered both, from the declarations
--     shards. Postgres has neither — declaration_stake carries no such column, and the values
--     exist only in the source XML — so this is a real narrowing, recorded rather than hidden.
--     Recovering them is a re-parse plus two columns on 089, which this plan does not do.
--
--   * A NEGATIVE FINDING. The function returns NULL, never a zero-count envelope, when no
--     gated stake resolves to this EIK. Absence here means „nothing survived the gates", which
--     is NOT „nobody declared a stake in this company" — 1,751 of the retired index's own UICs
--     are in exactly that state. A tile rendering „няма декларирани дялове" off this would be
--     asserting the second from the first. Same discipline as isun_clean_delivery_for_eik (175).

CREATE OR REPLACE FUNCTION company_declared_stakes(p_uic text)
RETURNS jsonb LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH src AS (
    SELECT sc.person_id,
           p.slug,
           p.display_name,
           COALESCE(sc.stake_kind, 'share') AS stake_kind,
           sc.share_size,
           -- Mirrors the client fold this replaces: case- and whitespace-insensitive, so
           -- "50 %" and "50%" are one holding. Nothing else is folded — a DIFFERENT declared
           -- size is a different holding and keeps its own row.
           lower(btrim(regexp_replace(COALESCE(sc.share_size, ''), '\s+', ' ', 'g')))
             AS size_key,
           sc.value_eur,
           sc.item_type,
           sc.stake_year,
           sc.holder_is_declarant,
           sc.holder_name,
           ds.table_num,
           sc.declaration_id,
           sc.seq,
           d.declaration_year,
           -- The rendered body label, so the filing links can be told apart. declared_label()
           -- (089) is the ONE definition of filed-over-listing and must never be restated as
           -- a COALESCE at a call site — twelve hand-copied copies is what produced the
           -- six-way magistrate_current duplication.
           declared_label(d.filed_institution, d.institution) AS institution,
           -- ⚠️ THE DEDUP KEY IS THE FOLDED LABEL, NEVER THE RAW ONE. The register does not
           -- normalise this field, and declared_label prefers the declarant's own free-text
           -- `filed_institution`, so the variance is worse here than on the listing side. Keyed
           -- raw, Имрен Мехмедова's two 2021 National Assembly filings survive as two links
           -- purely because one says „Народно Събрание" and the other „Народно събрание" —
           -- restoring the identical-link wall note 5 exists to prevent.
           --
           -- Case + whitespace ONLY, matching idx_declaration_filed_institution_fold's
           -- expression (089) including its NBSP→space replace. Nothing else is folded:
           -- erring toward MORE links can only over-cite, while folding harder — punctuation,
           -- tokens — would silently drop a genuinely different body a person filed under in
           -- the same year, which is a lost source.
           lower(regexp_replace(
                   btrim(replace(declared_label(d.filed_institution, d.institution), ' ', ' ')),
                   '\s+', ' ', 'g')) AS inst_key,
           d.source_url
      FROM declaration_stake_company sc
      JOIN declaration d
        ON d.declaration_id = sc.declaration_id
      -- table_num lives on the base table, not the matview. See note 2 above.
      JOIN declaration_stake ds
        ON ds.declaration_id = sc.declaration_id AND ds.seq = sc.seq
      JOIN person p
        ON p.person_id = sc.person_id
     WHERE sc.uic = p_uic
       -- §6 privacy gate, identical to 096's: this is a verbatim register fact about a person
       -- in public life, and it is published on those terms or not at all.
       AND p.status = 'active'
       AND p.is_public_figure
  ),
  -- The group's own latest declared period, as a window so `held` below can ask what the
  -- MOST RECENT filing said rather than what any filing ever said. See note 6.
  --
  -- stake_year, not declaration_year: it is COALESCE(fiscal_year, declaration_year), the only
  -- reading that puts a filing's stake on the year it was actually held (096's comment), and
  -- it is what 096 orders on. Ordering on declaration_year here instead made /person and
  -- /company disagree about which filing is the most recent one for the SAME holding on 152
  -- of 1,950 groups. The filing LABELS below still carry declaration_year, because that is
  -- the year the register stamps on the document a reader is about to open.
  keyed AS (
    SELECT s.*,
           max(s.stake_year) OVER (
             PARTITION BY s.person_id, s.stake_kind, s.size_key, s.holder_is_declarant
           ) AS grp_last_stake_year
      FROM src s
  ),
  -- One row per (year, body) per group. min(source_url) is the tiebreak, so the surviving
  -- link is a property of the data rather than of the scan order. See note 5.
  fil AS (
    SELECT person_id, stake_kind, size_key, holder_is_declarant,
           declaration_year AS year,
           -- The label SHOWN comes from the same row the surviving link does, so the tooltip
           -- and the document can never describe different filings. Taking it from the folded
           -- group by min(source_url) rather than by min(institution) is what guarantees that.
           (array_agg(institution ORDER BY source_url))[1] AS institution,
           min(source_url) AS source_url
      FROM keyed
     GROUP BY person_id, stake_kind, size_key, holder_is_declarant,
              declaration_year, inst_key
  ),
  grp AS (
    SELECT person_id, slug, display_name, stake_kind, size_key, holder_is_declarant,
           -- ⚠️ THE LATEST FILING DECIDES — `bool_or(table_num = '10')` IS BACKWARDS, and it
           -- is what the retired page did. `11` is a DISPOSAL, and a disposal is filed AFTER
           -- the holding it ends, so "held anywhere wins" resolves to „still holds it"
           -- precisely when the most recent filing says the opposite. Measured 2026-08-20:
           -- 55 groups whose latest declared period is entirely table-11 rendered as held,
           -- 2 of them ROLES — i.e. asserting a sitting official currently holds a
           -- directorship, the ЗПК чл. 35 claim note 1 exists to prevent. `ORDER BY held DESC`
           -- then ranked those first. It was also the only varying field in this CTE not taken
           -- from the most recent filing, so a row composed the newest share size with an
           -- ever-held flag.
           --
           -- An intra-filing tie (one filing declaring both a holding and a partial transfer)
           -- resolves toward held: they do still hold the remainder.
           bool_or(table_num = '10'
                   AND stake_year IS NOT DISTINCT FROM grp_last_stake_year) AS held,
           max(grp_last_stake_year) AS last_year,
           -- "The most recent filing that stated one." The sort key is total —
           -- (stake_year, declaration_id, seq) — because one filing can list the same company
           -- on several seq rows, and an unresolved tie makes the rendered value a property
           -- of the matview's physical heap order, which every REFRESH rewrites. 096's
           -- person_stake_procurement carries the same rule for the same reason.
           (array_agg(share_size ORDER BY stake_year DESC NULLS LAST, declaration_id DESC, seq)
              FILTER (WHERE share_size IS NOT NULL))[1] AS share_size,
           (array_agg(value_eur ORDER BY stake_year DESC NULLS LAST, declaration_id DESC, seq)
              FILTER (WHERE value_eur IS NOT NULL))[1] AS value_eur,
           (array_agg(item_type ORDER BY stake_year DESC NULLS LAST, declaration_id DESC, seq)
              FILTER (WHERE item_type IS NOT NULL))[1] AS item_type,
           (array_agg(holder_name ORDER BY stake_year DESC NULLS LAST, declaration_id DESC, seq)
              FILTER (WHERE holder_name IS NOT NULL))[1] AS holder_name
      FROM keyed
     GROUP BY person_id, slug, display_name, stake_kind, size_key, holder_is_declarant
  ),
  payload AS (
    SELECT g.*,
           (SELECT jsonb_agg(jsonb_build_object(
                     'year', f.year,
                     'institution', f.institution,
                     'sourceUrl', f.source_url)
                   ORDER BY f.year DESC, f.source_url)
              FROM fil f
             WHERE f.person_id = g.person_id
               AND f.stake_kind = g.stake_kind
               AND f.size_key = g.size_key
               -- ⚠️ IS NOT DISTINCT FROM, never `=`. stake_holder_is_declarant() returns
               -- NULL when the filing names a holder and the person carries no name_fold, and
               -- GROUP BY treats NULLs as equal — so such a row forms a group normally and
               -- then an equijoin here matches NOTHING, leaving a rendered stake with no
               -- filing links and no years. A holding asserted while citing no document is
               -- the one thing a verbatim-register surface must never publish.
               AND f.holder_is_declarant IS NOT DISTINCT FROM g.holder_is_declarant)
             AS filings,
           (SELECT jsonb_agg(DISTINCT f.year ORDER BY f.year DESC)
              FROM fil f
             WHERE f.person_id = g.person_id
               AND f.stake_kind = g.stake_kind
               AND f.size_key = g.size_key
               AND f.holder_is_declarant IS NOT DISTINCT FROM g.holder_is_declarant)
             AS years
      FROM grp g
  )
  -- NULL, not an empty envelope, when nothing resolved. See "WHAT IS DELIBERATELY NOT HERE".
  SELECT CASE WHEN count(*) = 0 THEN NULL ELSE jsonb_build_object(
    'uic', p_uic,
    -- `total` counts GROUPS, not people: one person can hold two differently-sized stakes,
    -- or a stake and a board seat, and 32% of served companies have more groups than people.
    -- A surface captioning „N лица" off `total` would over-count them, so the person count is
    -- published beside it rather than left to be inferred.
    'total', count(*),
    'personCount', count(DISTINCT person_id),
    -- ⚠️ THREE KINDS, NOT TWO. 089's CHECK is (share | role | sole_trader) and its comment is
    -- explicit that the column is the only thing telling them apart. Counting roles as the
    -- complement of shares files every едноличен търговец under „ръководни роли" — 5 rows in
    -- the matview today, and a sole tradership is the declarant's OWN business, closer to a
    -- holding than to a board seat. Each kind is counted by name so a fourth cannot arrive
    -- and be silently absorbed.
    'shareCount',      count(*) FILTER (WHERE stake_kind = 'share'),
    'roleCount',       count(*) FILTER (WHERE stake_kind = 'role'),
    'soleTraderCount', count(*) FILTER (WHERE stake_kind = 'sole_trader'),
    'groups', jsonb_agg(jsonb_build_object(
        'personId', person_id,
        'slug', slug,
        'name', display_name,
        'stakeKind', stake_kind,
        'held', held,
        'shareSize', share_size,
        'valueEur', round(value_eur, 2)::double precision,
        'itemType', item_type,
        -- WHOSE holding this is. false means the filing names a spouse or a child, and the
        -- surface must attribute it to them — „по данни на декларатора", never „негови фирми".
        'holderIsDeclarant', holder_is_declarant,
        'holderName', holder_name,
        'years', COALESCE(years, '[]'::jsonb),
        'filings', COALESCE(filings, '[]'::jsonb))
      -- Still-held first, then the most recent filing, then name. A former director must not
      -- outrank a sitting one because their row was scanned first.
      -- Every group-key column is in the sort, so the order is TOTAL: without
      -- holder_is_declarant, an own row and a family row of the same person, kind and size
      -- tie completely (10 such pairs today) and their order becomes the scan's, which a
      -- REFRESH rewrites.
      ORDER BY held DESC, last_year DESC NULLS LAST, display_name, person_id,
               stake_kind, size_key, holder_is_declarant DESC)
  ) END
  FROM payload;
$$;

COMMENT ON FUNCTION company_declared_stakes(text) IS
  'Public office-holders who declared a stake in, or a role at, this company — from the '
  'gated declaration_stake_company (096), never a company-name match. NULL means nothing '
  'survived the gates, NOT that no stake was declared.';

-- No GRANT, following 096: EXECUTE on a function is PUBLIC by default and the matview this
-- reads is covered by the readonly role's blanket grant rather than per-file. A bare GRANT
-- here would reintroduce the 42704-on-cold-bootstrap shape the role-guard sweep removed from
-- 48 other files.
