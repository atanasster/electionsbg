-- 105_mp_serving.sql — the MP serving surfaces: two REGISTRY matviews and the three
-- person-keyed fns behind /api/db/mp-entry, /api/db/mp-declarations, /api/db/mp-assets.
-- Plan: docs/plans/persons-pg-retirement-v1.md (Tier 0.3). Reads the 104 roster tables.
--
-- Retires, once Tier 2 moves the hooks:
--   mp_assets_rankings_table  <- data/parliament/assets-rankings.json (960 KB) + -top
--   mp_cars_table             <- data/parliament/mp-cars.json (280 KB)
--   mp_entry()                <- data/parliament/by-id/<id>.json      (2,123 files)
--   mp_declarations()         <- data/parliament/declarations/<id>.json (782 files)
--   mp_assets()               <- data/parliament/mp-assets/<id>.json  (769 files)
--
-- ---------------------------------------------------------------------------
-- THE FIGURES CHANGE, AND THAT IS THE POINT — READ BEFORE COMPARING TO THE JSON.
--
-- build_assets_rankings.ts folds ownership stakes (declaration table 10, company
-- shares) into the `security` bucket and therefore into totalAssetsEur. The person
-- layer's person_wealth_year (090) does not: it sums declaration_asset only. So an MP
-- who declares company shares reads HIGHER in today's JSON than they will here.
--
-- This migration deliberately follows 090 rather than the JSON, for the same reason
-- 100_officials_rankings.sql did: person_wealth_year is what /person, /officials/assets
-- and the wealth chart already render, and having the MP leaderboard quote a fourth
-- number for the same human is worse than a one-off figure change. The wealth series,
-- the cohort benchmark and the accumulation gap all read person_wealth_year; an MP
-- leaderboard that disagreed with all three would be the outlier, not the standard.
--
-- Consequence for parity testing: assert per-MP that the FIGURES RECONCILE TO
-- person_wealth_year, never that they equal the JSON. mp_serving.data.test.ts pins the
-- divergence to stake-bearing filings, so a NEW divergence (a parser change, a category
-- remap) fails the test while this known one does not.
--
-- ---------------------------------------------------------------------------
-- WHY EVERY ROLLUP CARRIES AN `ns` COLUMN, INCLUDING A LITERAL 'all' BUCKET.
--
-- assets-rankings.json is two rollups in one — a national `topMps` and a per-parliament
-- `byNs['52'].topMps`, the latter being the former filtered to MPs who sat in that NS.
-- mp-cars.json has NO byNs key (it is a flat `cars` list); its per-parliament slice is
-- done CLIENT-side today, at MpCarsScreen.tsx:49 (`c.nsFolders.includes(folder)`). Both
-- become the same server-side scope here.
--
-- The db_table.js registry scopes with a plain `col = $n` equality (buildWhere), and an
-- MP sits in several parliaments, so the scope dimension has to be a row, not an array
-- column: each entity is emitted once per NS folder it belongs to, plus once under
-- ns = 'all' for the national view.
--
-- The alternative — a text[] column with an array-contains filter — would mean teaching
-- the shared registry engine a new filter mode for one resource. Thirteen other
-- resources ride that engine; a fan-out inside one matview is the cheaper blast radius.
-- Cost: ~2-3× the rows (2,122 MPs -> 4,329, 624 cars -> 2,021), which is nothing.
--
-- AN UNSCOPED QUERY IS THE NATIONAL LIST, not the union of every bucket. That is not a
-- property of the fan-out — it is enforced by `defaultScope: { col: "ns", val: "all" }`
-- on both registry entries, which buildWhere applies when the caller sends no scope.
-- Without it the union serves silently at 2.0×/3.2× inflation with the `count`
-- aggregate and every facet inflated to match: a wrong number on a page, not an error.
-- Do not add an `ns` fan-out resource without a defaultScope; db_table.test.js fails it.
--
-- ---------------------------------------------------------------------------
-- REFRESH / DEPENDENCY ORDER. mp_assets_rankings_table reads person_wealth_year, so —
-- exactly like 097 and 100 — it must be applied and refreshed AFTER
-- `REFRESH MATERIALIZED VIEW person_wealth_year` in load_declarations_pg.ts --resolve,
-- and it is recreated unconditionally rather than guarded, because 090 runs
-- `DROP MATERIALIZED VIEW person_wealth_year CASCADE` on every --resolve and would
-- otherwise take this matview with it. Both loaders apply this file:
--   * load_mp_roster_pg.ts        — after COPYing fresh roster/car rows
--   * load_declarations_pg.ts     — phase 2, after 090's refresh
-- Whichever ran last leaves both matviews populated.

-- ---------------------------------------------------------------------------
-- mp_person_link — the ONE definition of "which person holds this mp id".
--
-- Three surfaces below need this mapping (both matviews and mp_entry's personSlug), and
-- it carries three separable contracts that must not drift apart:
--   * source = 'mp' — the roster's own person_source;
--   * the `~ '^[0-9]+$'` cast guard — ref is text, and one malformed row would abort a
--     whole matview build rather than skipping itself;
--   * the §6 privacy gate (082, 100) — a person parked in the 'review' holding area or
--     not opted in as a public figure is never linked to.
-- Written out per site (as the first draft did), adding a fourth condition to the gate
-- means finding all of them, and a miss is SILENT: rows still serve, just linked to the
-- wrong person or leaking a non-public one.
--
-- DISTINCT ON because person_role's PK is (person_id, source, ref, role) — nothing stops
-- two person rows carrying the same mp ref, and a duplicate would double every car of
-- that MP. Lowest person_id wins: arbitrary but stable, and the resolver's merge (T0.1b)
-- is what actually prevents the case arising.
--
-- The reverse direction (person -> their mp id) lives in mp_assets' `roster` CTE and
-- uses a DIFFERENT tiebreak — sitting/newest wins, because the 2 people holding two mp
-- ids should render as the seat they hold now. Keep the two rules apart deliberately.
--
-- DROP … CASCADE, not CREATE OR REPLACE: replacing a view cannot change its column list,
-- and the CASCADE's dependents are exactly the two matviews recreated immediately below.
DROP VIEW IF EXISTS mp_person_link CASCADE;

CREATE VIEW mp_person_link AS
-- T3: `ref` is '<mpId>' for an MP with no roll-call coverage and '<mpId>:<ns>'
-- for one with it, so the id is ALWAYS `split_part(ref, ':', 1)` — which
-- returns the whole string when there is no colon. A bare `ref::integer` threw
-- 22P02 on the widened form, and the `^[0-9]+$` guard below silently emptied
-- this view, which is worse: it is "the ONE definition of which person holds
-- this mp id" and three functions join through it.
SELECT DISTINCT ON (split_part(r.ref, ':', 1))
       split_part(r.ref, ':', 1)::integer AS mp_id,
       r.person_id,
       p.slug         AS person_slug
FROM person_role r
JOIN person p ON p.person_id = r.person_id
             AND p.status = 'active'
             AND p.is_public_figure
WHERE r.source = 'mp' AND split_part(r.ref, ':', 1) ~ '^[0-9]+$'
ORDER BY split_part(r.ref, ':', 1), r.person_id;

-- ---------------------------------------------------------------------------
-- mp_cars_table — the declared-vehicle browser (REGISTRY `mp_cars`).

DROP MATERIALIZED VIEW IF EXISTS mp_cars_table CASCADE;

CREATE MATERIALIZED VIEW mp_cars_table AS
WITH base AS (
  SELECT c.car_id,
         c.mp_id,
         m.name                      AS mp_name,
         m.current_party_group_short AS party_group_short,
         m.is_current,
         m.ns_folders,
         -- NULL when the MP has not resolved to a public person. The row still serves
         -- (it is a declared vehicle either way); only the /person deep link is absent.
         mp.person_slug,
         c.make,
         c.detail,
         c.description,
         c.acquired_year,
         -- Rounded at rest so the sort key is stable across replicas and no consumer
         -- re-rounds (reference_pg_payload_determinism). Whole euros, matching
         -- declaration_detail() and person_wealth_series().
         round(c.value_eur)          AS value_eur,
         c.amount,
         c.currency,
         c.is_spouse,
         c.share,
         c.merged_from_count,
         c.declaration_year,
         c.source_url
  FROM mp_car c
  JOIN mp_profile m  ON m.mp_id = c.mp_id
  LEFT JOIN mp_person_link mp ON mp.mp_id = c.mp_id
)
SELECT 'all'::text AS ns, b.* FROM base b
UNION ALL
SELECT f AS ns, b.* FROM base b CROSS JOIN LATERAL unnest(b.ns_folders) AS f;

-- (ns, car_id) is the identity of a row here — car_id alone repeats across buckets.
-- UNIQUE because the registry appends it as the paging tiebreak.
CREATE UNIQUE INDEX idx_mp_cars_pk ON mp_cars_table (ns, car_id);
-- The default sort, inside a scope. NULLS LAST matches the registry's DESC ordering for
-- the unvalued rows (a declared car with no value is common), and a plain DESC index is
-- NULLS FIRST — the planner will not use it for that ordering (see 100's note).
CREATE INDEX idx_mp_cars_value ON mp_cars_table (ns, value_eur DESC NULLS LAST, car_id);
CREATE INDEX idx_mp_cars_make ON mp_cars_table (ns, make);
CREATE INDEX idx_mp_cars_mp ON mp_cars_table (mp_id);
-- Every search:true column needs its own trigram index: buildWhere ORs them into one
-- predicate, and one unindexed arm forces a seq scan over the whole OR — which does not
-- merely slow that column down, it stops the others' indexes being used at all (100).
CREATE INDEX idx_mp_cars_name_trgm ON mp_cars_table USING gin (mp_name gin_trgm_ops);
CREATE INDEX idx_mp_cars_detail_trgm ON mp_cars_table USING gin (detail gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- mp_assets_rankings_table — the MP wealth leaderboard (REGISTRY `mp_assets_rankings`).

DROP MATERIALIZED VIEW IF EXISTS mp_assets_rankings_table CASCADE;

CREATE MATERIALIZED VIEW mp_assets_rankings_table AS
WITH latest AS (
  -- Newest wealth year per person, ANY tier. Tier-filtering to 'mp' would drop every
  -- MP whose representative filing was lodged as a minister or a councillor — the
  -- loader keeps ONE copy per source_url and walks mp -> exec -> muni, so which tier
  -- holds a given human's filing is an ingest detail, not a fact about them (100).
  --
  -- TWO YEARS, DELIBERATELY, because they are different facts and conflating them
  -- silently shifts a figure by one year for every annual filing:
  --   period_year       = COALESCE(fiscal_year, declaration_year) — what the filing
  --                       COVERS. person_wealth_year keys on this, so it is the join
  --                       key for a wealth series and the correct sort for "newest".
  --   declaration_year  = when it was LODGED. An annual for fiscal N is filed in
  --                       May N+1, so this is period_year + 1 for most rows.
  -- The leaderboard labels a row with declaration_year (that is what "декларация от
  -- 2025" means to a reader) and keeps period_year for anything that has to line up
  -- with the wealth chart. Measured on this corpus: the two disagree for 421 of the
  -- 767 MPs the JSON ranks, which is why both ship rather than one.
  SELECT DISTINCT ON (w.person_id)
         w.person_id, w.period_year, w.declaration_id,
         d.declaration_year, d.fiscal_year,
         w.assets_eur, w.debts_eur, w.net_eur
  FROM person_wealth_year w
  JOIN declaration d ON d.declaration_id = w.declaration_id
  ORDER BY w.person_id, w.period_year DESC, w.declaration_id DESC
),
prev AS (
  -- The previous year PRESENT in the series, not latest-1 — an MP who skipped a year
  -- would otherwise report a delta against a year they never filed.
  --
  -- period_year here, not declaration_year: `delta_previous_year` labels the comparison
  -- point ("спрямо 2023"), and MpAssetsRollup.previous.year already documents that the
  -- covered period is the right thing to show there.
  SELECT DISTINCT ON (w.person_id)
         w.person_id, w.period_year, w.assets_eur, w.net_eur
  FROM person_wealth_year w
  JOIN latest l ON l.person_id = w.person_id AND w.period_year < l.period_year
  ORDER BY w.person_id, w.period_year DESC
),
re AS (
  -- Real-estate counts for the representative filing only; the join to `latest` prunes
  -- before aggregating. "Unvalued" is a real filing pattern (092 rule 4), so it is
  -- counted separately rather than filtered away.
  SELECT a.declaration_id,
         count(*)                                    AS real_estate_count,
         count(*) FILTER (WHERE a.value_eur IS NULL) AS real_estate_unvalued
  FROM declaration_asset a
  JOIN latest l ON l.declaration_id = a.declaration_id
  WHERE a.category = 'real_estate'
  GROUP BY a.declaration_id
),
filed AS (
  -- Filed ANYTHING, in any tier. Checked against `declaration` and not against
  -- `latest`, which is the WEALTH series and only carries years with valued assets —
  -- keying off it would merely restate `net_worth_eur IS NULL` (100).
  SELECT DISTINCT person_id FROM declaration WHERE person_id IS NOT NULL
),
base AS (
  -- EVERY MP in the roster, not only the 767 with an asset-bearing filing the JSON
  -- ships. Three states are distinguishable and must not be collapsed:
  --   person_slug IS NULL                     -> not resolved to a public person
  --   has_declaration = false                 -> resolved, nothing on record
  --   has_declaration, net_worth_eur IS NULL  -> filed, declared no valued assets
  -- The UI filters; the matview reports. The JSON could not express any of this,
  -- because it was built FROM declarations and a non-filer simply had no row.
  SELECT m.mp_id,
         mp.person_slug,
         m.name,
         m.current_party_group_short AS party_group_short,
         m.is_current,
         m.ns_folders,
         l.declaration_year                         AS latest_declaration_year,
         l.fiscal_year                              AS latest_fiscal_year,
         l.period_year                              AS period_year,
         (f.person_id IS NOT NULL)                  AS has_declaration,
         round(l.assets_eur)                        AS total_assets_eur,
         round(l.debts_eur)                         AS total_debts_eur,
         round(l.net_eur)                           AS net_worth_eur,
         COALESCE(re.real_estate_count, 0)::int     AS real_estate_count,
         COALESCE(re.real_estate_unvalued, 0)::int  AS real_estate_unvalued,
         pv.period_year                             AS delta_previous_year,
         round(l.net_eur - pv.net_eur)              AS delta_absolute_eur,
         -- Guarded: a previous net worth of 0 (or negative — the corpus has both)
         -- makes a percentage meaningless rather than infinite.
         CASE WHEN pv.net_eur > 0
              THEN round(((l.net_eur - pv.net_eur) / pv.net_eur) * 100, 2)
         END                                        AS delta_pct
  FROM mp_profile m
  LEFT JOIN mp_person_link mp ON mp.mp_id = m.mp_id
  LEFT JOIN latest l     ON l.person_id = mp.person_id
  LEFT JOIN prev pv      ON pv.person_id = mp.person_id
  LEFT JOIN re           ON re.declaration_id = l.declaration_id
  LEFT JOIN filed f      ON f.person_id = mp.person_id
)
SELECT 'all'::text AS ns, b.* FROM base b
UNION ALL
SELECT f AS ns, b.* FROM base b CROSS JOIN LATERAL unnest(b.ns_folders) AS f;

CREATE UNIQUE INDEX idx_mp_assets_rankings_pk ON mp_assets_rankings_table (ns, mp_id);
CREATE INDEX idx_mp_assets_rankings_net
  ON mp_assets_rankings_table (ns, net_worth_eur DESC NULLS LAST, mp_id);
CREATE INDEX idx_mp_assets_rankings_assets
  ON mp_assets_rankings_table (ns, total_assets_eur DESC NULLS LAST, mp_id);
CREATE INDEX idx_mp_assets_rankings_slug ON mp_assets_rankings_table (person_slug);
CREATE INDEX idx_mp_assets_rankings_name_trgm
  ON mp_assets_rankings_table USING gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- mp_entry(mp_id, slug) — one roster entry, the shape useMpEntry hydrates.
--
-- Keyed EITHER way on purpose. By mp_id it is a drop-in for the by-id/<id>.json shard
-- (the id is also the photo filename, so callers holding a photo hold an id). By person
-- slug it is what PersonDashboard has, and it is the reason this is a fn and not a
-- REGISTRY row: the person surface should never have to learn parliament.bg's id space.
--
-- Two of the 2,120 MP-holding people carry TWO mp ids (parliament.bg duplicates). A
-- slug lookup returns the sitting/newest one; the leaderboard above still lists both,
-- matching the JSON. Do not "fix" one without the other.
DROP FUNCTION IF EXISTS mp_entry(integer, text);
CREATE OR REPLACE FUNCTION mp_entry(p_mp_id integer, p_slug text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH target AS (
    SELECT m.*
    FROM mp_profile m
    WHERE (p_mp_id IS NOT NULL AND m.mp_id = p_mp_id)
       OR (p_mp_id IS NULL AND p_slug IS NOT NULL AND EXISTS (
             SELECT 1
             FROM person_role r
             JOIN person p ON p.person_id = r.person_id
                          AND p.status = 'active'
                          AND p.is_public_figure
             WHERE r.source = 'mp' AND split_part(r.ref, ':', 1) = m.mp_id::text AND p.slug = p_slug))
    ORDER BY m.is_current DESC, m.mp_id DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'id',                 t.mp_id,
    'name',               t.name,
    'name_en',            t.name_en,
    'normalizedName',     t.normalized_name,
    'normalizedName_en',  t.normalized_name_en,
    -- Relative for the bucket-hosted default, absolute for an external portrait. The
    -- client resolves it exactly as it does off the shard today (resolvePhoto).
    'photoUrl',           t.photo_url,
    'currentRegion',      CASE WHEN t.current_region_code IS NOT NULL
                               THEN jsonb_build_object('code', t.current_region_code,
                                                       'name', t.current_region_name)
                          END,
    -- Key order matters here only for readability; the parity gate compares parsed JSON.
    'seatedRegion',       CASE WHEN t.seated_region_code IS NOT NULL
                               THEN jsonb_build_object('code', t.seated_region_code,
                                                       'name', t.seated_region_name)
                          END,
    'currentPartyGroup',      t.current_party_group,
    'currentPartyGroupShort', t.current_party_group_short,
    -- The coalition the MP was ELECTED with. The two above are a CURRENT-NS roster
    -- lookup, so they are NULL for every former MP; this is the only party any of them
    -- carries. A career badge, not a per-parliament fact — see 104's column comment.
    'electedWith',            t.elected_with,
    'position',           t.position_title,
    'birthDate',          t.birth_date,
    'nsFolders',          to_jsonb(t.ns_folders),
    'isCurrent',          t.is_current,
    -- Rendered in Postgres' "+00:00" offset form, where the shard wrote "…Z". Same
    -- instant, and every consumer parses it with new Date(), so the difference is left
    -- rather than papered over with to_char() — but it IS a difference, and the parity
    -- test compares this field as an instant instead of as text for exactly that reason.
    'scrapedAt',          t.scraped_at,
    -- Not in the JSON shard: the person this MP resolved to, so a caller holding only
    -- an mp id can link to /person without a second round trip.
    'personSlug',         (SELECT l.person_slug FROM mp_person_link l
                            WHERE l.mp_id = t.mp_id),
    -- Is this MP anywhere in the roll-call corpus? The ONLY authoritative answer, and the
    -- reason it cannot be derived on the client: `nsFolders` is the ROSTER's view, and
    -- `mp_profile` and `mp_seat` are partly disjoint id spaces — 527 `mp_seat.mp_id`s have
    -- no profile row, and the same human is routinely one id in each. Measured: 293
    -- profiles have max(nsFolders) < 44, and 70 of them (24%) ARE in `mp_seat`, mostly at
    -- NS 44 — the parliament that straddles the corpus boundary. Жельо Иванов Бойчев is
    -- profile 2671 with ns_folders {42,43} and seat 779 at NS 44.
    --
    -- So a page that reasons from `nsFolders` alone tells those 70 we hold no roll-call
    -- for their terms while we are holding their votes — publishing OUR id-linking gap as
    -- the National Assembly's failure to publish.
    --
    -- The name arm is deliberate and is NOT an identity claim: it only ever SUPPRESSES a
    -- statement. A false positive (a namesake in the corpus) costs silence, which is the
    -- status quo; a false negative costs a published falsehood. That asymmetry is why a
    -- name match is admissible here and nowhere near an attribution.
    'hasRollcall', EXISTS (
      SELECT 1 FROM mp_seat s
       WHERE s.mp_id = t.mp_id
          OR upper(regexp_replace(btrim(s.name), '\s+', ' ', 'g'))
           = upper(regexp_replace(btrim(t.name), '\s+', ' ', 'g'))
    )
  )
  FROM target t;
$$;

-- ---------------------------------------------------------------------------
-- mp_declarations(slug) — every filing this person made, in full, newest first.
--
-- THIS IS THE useOfficial.tsx:76 TODO, discharged. The client-side
-- mergeDeclarationTimelines() exists because an officials slug is name+institution
-- hashed, so one human accumulates a new slug per post and the JSON tree splits their
-- filings across several files; the frontend re-merged them by sourceUrl. Keyed on the
-- person there is nothing to merge — declaration.person_id already IS the merge, and
-- source_url is UNIQUE at the table level, so the dedupe the client did by hand is a
-- constraint here.
--
-- Deliberately NOT restricted to tier = 'mp'. An MP who also served as a minister filed
-- under both; showing only the parliamentary half would hide years of their own wealth
-- history for no reason a reader could guess.
--
-- Payload vocabulary is declaration_detail()'s (090), arrayed — not the MpDeclaration
-- TS shape's. A second full-filing payload with different key names for the same rows
-- is exactly the drift this migration exists to remove; Tier 2 maps the components onto
-- this one vocabulary instead.
--
-- §6 privacy gate: an unresolved or non-public subject returns an empty array.
DROP FUNCTION IF EXISTS mp_declarations(text);
CREATE OR REPLACE FUNCTION mp_declarations(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(x.filing ORDER BY x.period DESC,
                                              x.filed_at DESC NULLS LAST,
                                              x.declaration_id DESC), '[]'::jsonb)
  FROM (
    SELECT d.declaration_id,
           COALESCE(d.fiscal_year, d.declaration_year) AS period,
           d.filed_at,
           jsonb_build_object(
             'id',             d.declaration_id,
             'tier',           d.tier,
             'declarantName',  d.declarant_name,
             'institution',    d.institution,
             'positionTitle',  d.position_title,
             'year',           d.declaration_year,
             'fiscalYear',     d.fiscal_year,
             'type',           d.declaration_type,
             'filedAt',        d.filed_at,
             'entryNumber',    d.entry_number,
             'controlHash',    d.control_hash,
             'sourceUrl',      d.source_url,
             'assets', COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                 'category', a.category, 'description', a.description, 'detail', a.detail,
                 'location', a.location, 'municipality', a.municipality,
                 'areaSqm', a.area_sqm, 'builtAreaSqm', a.built_area_sqm,
                 'acquiredYear', a.acquired_year, 'share', a.share,
                 'currency', a.currency, 'amount', a.amount,
                 'valueEur', round(a.value_eur), 'holderName', a.holder_name,
                 'isSpouse', a.is_spouse, 'legalBasis', a.legal_basis,
                 'fundsOrigin', a.funds_origin
               ) ORDER BY a.seq)
               FROM declaration_asset a WHERE a.declaration_id = d.declaration_id
             ), '[]'::jsonb),
             'income', COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                 'parent', i.parent, 'category', i.category,
                 'eurDeclarant', round(i.eur_declarant), 'eurSpouse', round(i.eur_spouse)
               ) ORDER BY i.seq)
               FROM declaration_income i WHERE i.declaration_id = d.declaration_id
             ), '[]'::jsonb),
             'stakes', COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                 'tableNum', s.table_num, 'companyName', s.company_name,
                 'companySlug', s.company_slug, 'uic', s.uic,
                 'holderName', s.holder_name, 'transfereeName', s.transferee_name,
                 'shareSize', s.share_size, 'valueEur', round(s.value_eur),
                 'registeredOffice', s.registered_office
               ) ORDER BY s.seq)
               FROM declaration_stake s WHERE s.declaration_id = d.declaration_id
             ), '[]'::jsonb),
             'events', COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                 'kind', e.kind, 'description', e.description, 'detail', e.detail,
                 'location', e.location, 'municipality', e.municipality,
                 'valueEur', round(e.value_eur), 'legalBasis', e.legal_basis
               ) ORDER BY e.seq)
               FROM declaration_event e WHERE e.declaration_id = d.declaration_id
             ), '[]'::jsonb)
           ) AS filing
    FROM declaration d
    JOIN person p ON p.person_id = d.person_id
                 AND p.status = 'active'
                 AND p.is_public_figure
    WHERE p.slug = p_slug
  ) x;
$$;

-- ---------------------------------------------------------------------------
-- mp_assets(slug) — the per-MP wealth rollup. A WIDENED MpAssetsRollup, NOT the shard
-- shape: the mp-assets/<id>.json tree only ever held MPs who had FILED, so a non-filer
-- simply had no file. This answers for everyone, which means six fields the TS type
-- declares required are nullable here —
--   latestDeclarationYear · periodYear · declarationType · sourceUrl ·
--   totalAssetsEur · totalDebtsEur · netWorthEur
-- — and they are NULL for every person with no wealth row (1,168 of the 2,122 rostered
-- MPs). mp_assets_rankings_table widens identically. byCategory is still zero-filled so
-- a chart renders, but the header figures MUST be null-guarded: casting this to
-- MpAssetsRollup without widening the type in src/data/dataTypes.ts first is a Tier-2
-- runtime crash, not a type-level complaint. Tier 2 widens both that type and
-- MpAssetsRankingEntry.
--
-- Totals come from person_wealth_year, so this and the leaderboard above can never
-- disagree about the same human — see the stake-fold note in the header for how both
-- differ from today's JSON.
--
-- Answers for non-MPs too (a minister on PersonDashboard): mpId is null and the wealth
-- is still there.
--
-- byCategory is zero-filled across all eight MpAssetCategory buckets, as the JSON is:
-- a missing key and a zero mean the same thing to a reader but different things to a
-- chart, and the client should not have to know which categories exist.
DROP FUNCTION IF EXISTS mp_assets(text);
CREATE OR REPLACE FUNCTION mp_assets(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH subject AS (
    SELECT p.person_id, p.slug
    FROM person p
    WHERE p.slug = p_slug AND p.status = 'active' AND p.is_public_figure
  ),
  roster AS (
    -- The MP identity, when there is one. NULL-safe: this fn also answers for a person
    -- who never sat in parliament (a minister on PersonDashboard), and the caller gets
    -- the wealth rollup without an mpId rather than nothing at all.
    SELECT m.mp_id, m.name, m.current_party_group_short, m.is_current, m.ns_folders
    FROM subject s
    JOIN person_role r ON r.person_id = s.person_id AND r.source = 'mp'
                      AND split_part(r.ref, ':', 1) ~ '^[0-9]+$'
    JOIN mp_profile m ON m.mp_id = split_part(r.ref, ':', 1)::integer
    ORDER BY m.is_current DESC, m.mp_id DESC
    LIMIT 1
  ),
  latest AS (
    SELECT w.*
    FROM person_wealth_year w
    JOIN subject s ON s.person_id = w.person_id
    ORDER BY w.period_year DESC, w.declaration_id DESC
    LIMIT 1
  ),
  prev AS (
    SELECT w.period_year, w.assets_eur, w.net_eur
    FROM person_wealth_year w, latest l
    WHERE w.person_id = l.person_id AND w.period_year < l.period_year
    ORDER BY w.period_year DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'mpId',                  r.mp_id,
    'personSlug',            s.slug,
    'name',                  COALESCE(r.name, pp.display_name),
    'partyGroupShort',       r.current_party_group_short,
    'isCurrent',             COALESCE(r.is_current, false),
    'nsFolders',             to_jsonb(COALESCE(r.ns_folders, '{}'::text[])),
    -- The year the filing was LODGED, matching MpAssetsRollup's documented meaning.
    -- `periodYear` is what it COVERS and what the wealth chart keys on — see the
    -- two-years note in mp_assets_rankings_table above.
    'latestDeclarationYear', d.declaration_year,
    'periodYear',            l.period_year,
    'fiscalYear',            d.fiscal_year,
    'declarationType',       d.declaration_type,
    'sourceUrl',             d.source_url,
    'totalAssetsEur',        round(l.assets_eur),
    'totalDebtsEur',         round(l.debts_eur),
    'netWorthEur',           round(l.net_eur),
    'previous',              CASE WHEN pv.period_year IS NOT NULL
                                  THEN jsonb_build_object(
                                    'year',           pv.period_year,
                                    'totalAssetsEur', round(pv.assets_eur),
                                    'netWorthEur',    round(pv.net_eur))
                             END,
    -- Each bucket's total is rounded on its own, so the seven non-debt buckets need not
    -- sum to totalAssetsEur (which rounds the whole filing once) — up to a few euros
    -- apart. Same policy as 090's by_category, per reference_pg_payload_determinism.
    -- Do not render the split as a reconciliation of the header; it is a composition.
    'byCategory', (
      SELECT jsonb_object_agg(x.cat, jsonb_build_object(
               'count', x.cnt, 'valuedCount', x.valued, 'totalEur', x.total))
      FROM (
        SELECT c.cat,
               count(a.declaration_id)                 AS cnt,
               count(a.value_eur)                      AS valued,
               -- Weighted: the declared amount is the WHOLE property and a co-owned
               -- one is filed once per co-owner. See asset_share_multiplier (090).
               COALESCE(round(SUM(a.value_eur
                 * asset_share_multiplier(a.share, a.category))), 0) AS total
        FROM unnest(ARRAY['real_estate','vehicle','cash','bank',
                          'receivable','debt','credit_limit','investment','security']) AS c(cat)
        -- LEFT so a category the declarant left empty still emits its zero row.
        -- The ceiling matches 090's: these header figures come from person_wealth_year,
        -- which excludes implausible asset rows, so a composition summed without it would
        -- exceed its own header by billions.
        LEFT JOIN declaration_asset a ON a.declaration_id = l.declaration_id
                                     AND a.category = c.cat
                                     -- `value_eur IS NULL` FIRST: an unvalued row is a
                                     -- real filing pattern (092 rule 4) and must still be
                                     -- COUNTED. `NULL <= n` is NULL, not true, so omitting
                                     -- this drops every unvalued item from `count` — it
                                     -- reported 3 properties where the declarant filed 4.
                                     AND (a.category IN ('debt', 'credit_limit')
                                          OR a.value_eur IS NULL
                                          OR a.value_eur <= asset_row_ceiling_eur())
        GROUP BY c.cat
      ) x
    )
  )
  FROM subject s
  JOIN person pp ON pp.person_id = s.person_id
  LEFT JOIN roster r ON true
  LEFT JOIN latest l ON true
  LEFT JOIN prev pv  ON true
  LEFT JOIN declaration d ON d.declaration_id = l.declaration_id;
$$;
