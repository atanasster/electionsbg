-- 100_officials_rankings.sql — the officials asset leaderboard, served from PG.
--
-- Backs the `officials_rankings` db_table.js REGISTRY resource, which replaces the
-- static data/officials/assets-rankings.json(+-top) read by useOfficialsRankings /
-- OfficialsAssetsScreen / the /governance OfficialsAssetsTile and the AI tool
-- ai/tools/people.ts:officialsAssetsTop.
-- Plan: docs/plans/persons-pg-retirement-v1.md (Tier 0.1).
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS PERSON-KEYED, AND WHY IT DOES NOT ROW-MATCH THE JSON.
--
-- assets-rankings.json has 14,496 topOfficials rows — one per officials SLUG. This
-- matview has one row per PERSON holding an officials role. The two counts cannot
-- and should not agree, and the difference is the whole point of the person layer:
--
--   Делян Славчев Пеевски files ONE declaration. The JSON stores it twice — once
--   under his MP shard and once under officials slug delyan-slavchev-peevski-f0d3fe.
--   Postgres stores it once: declaration.source_url is UNIQUE, the loader walks the
--   tiers mp → exec → muni → magistrate, so the MP-tier row wins and the exec-tier
--   copy is one of the "2436 duplicate URLs skipped". 466 exec slugs are absent from
--   `declaration` for exactly this reason — they are people who ALSO sit in a
--   higher-priority tier, not people we are missing.
--
-- Two consequences this matview is built around:
--   1. The officials SET comes from person_role (the six OFFICIAL_DECLARATION_SOURCES —
--      see the CTE below), NOT from declaration — otherwise those 466 vanish from the
--      leaderboard the moment it moves to PG.
--   2. Their WEALTH is read from person_wealth_year at ANY tier, not tier='exec' —
--      an official who is also an MP has their representative filing under 'mp'.
--      Filtering the wealth join by tier would zero out precisely those 466.
--
-- So parity against the JSON is per-person (same figures for the same human), never
-- per-row. A row-count diff of ~466 is the correct, intended behaviour.
--
-- ---------------------------------------------------------------------------
-- WHICH FILING SPEAKS FOR A YEAR is not re-decided here: person_wealth_year (090)
-- already picks the representative filing with the byRecency/has_valued_assets rules
-- that keep /person and /officials from disagreeing about a person's net worth. This
-- matview only picks the newest year of that series and differences it against the
-- previous year PRESENT in the series (not latest-1, which would report a bogus zero
-- delta across a filing gap).
--
-- CATEGORY comes from person_role.role, which is populated for every official
-- including the 466; institution/position_title come from the newest officials-tier
-- declaration when one exists (NULL for the 466, whose filing sits in the mp tier).
--
-- ---------------------------------------------------------------------------
-- §6 PRIVACY GATE. Every serving path in 082 filters person on
-- `status = 'active' AND is_public_figure` (082 lines 17/202/230/238/298, three of them
-- annotated `-- §6 privacy gate`); 081 declares is_public_figure default FALSE and
-- documents status='review' as the aggressive-merge holding area "NEVER rendered
-- publicly until promoted". This matview is a serving surface — it is wired straight into
-- the public db_table.js REGISTRY — so it APPLIES the gate, in the join below.
--
-- Measured 2026-07-25: 19,187/19,187 rows are active public figures, so gated and ungated
-- are indistinguishable TODAY. That is exactly why the choice is written down instead of
-- being left to the row counts: the failure mode is a later resolver run parking someone
-- in status='review', or an officials category moving to a public_default=false source
-- (the scenario officialSources.ts discusses for `academic`). At that moment /person
-- hides them while an ungated leaderboard would keep ranking them by net worth.
--
-- REFRESH / DEPENDENCY ORDER. This reads person_wealth_year, so it MUST be applied
-- and refreshed after `REFRESH MATERIALIZED VIEW person_wealth_year` in
-- load_declarations_pg.ts --resolve — the same rule 097 documents for
-- person_cohort_wealth. It is also why this file DROPs and recreates rather than
-- CREATE IF NOT EXISTS: 090 re-runs `DROP MATERIALIZED VIEW person_wealth_year
-- CASCADE` on every --resolve, which would take this matview with it. Being
-- unconditionally recreated (and repopulated) immediately afterwards makes that
-- CASCADE harmless instead of a silent data loss. Do not "optimise" this into a
-- guarded create without first changing 090's DROP.

DROP MATERIALIZED VIEW IF EXISTS officials_rankings_table CASCADE;

CREATE MATERIALIZED VIEW officials_rankings_table AS
WITH officials AS (
  -- One row per person holding an officials role, plus flags for WHICH tiers they
  -- hold. The flags are not redundant with `source`: 504 people hold BOTH an executive
  -- and a municipal post (as of 2026-07 — these counts are snapshots, so a ±1 drift is
  -- expected rather than a symptom), so a single representative `source` cannot
  -- answer "is this an executive official?". Picking the representative arbitrarily
  -- (start_date alone, as the first cut did) bucketed 212 of those 504 as municipal
  -- and made a `source = 'official_exec'` filter under-report the executive
  -- leaderboard by exactly that many — 12,950 instead of 13,162. So:
  --   * source/category = the representative post, by the documented priority below
  --     (executive outranks public-sector outranks municipal, then newest, then ref);
  --   * is_exec / is_muni = the honest membership tests the UI filters on.
  -- /officials/assets reproduces its current contents with is_exec = true.
  --
  -- THE SOURCE LIST IS NOT `official_%`. It is the SQL mirror of
  -- OFFICIAL_DECLARATION_SOURCES in src/lib/officialSources.ts, which exists
  -- because `president`, `mep` and `diplomat` are Court-of-Audit officials whose
  -- source names do not start with "official". That file records what a prefix
  -- test cost last time: 179 people rendered a profile with the whole "Заемани
  -- длъжности" section missing. Restricting this matview to the three obvious
  -- sources reproduced the same class of bug — it dropped every diplomat, MEP and
  -- president (Станишев, Бареков, every ambassador) out of the leaderboard: 227 people
  -- hold such a role, and 229 assets-rankings.json rows resolved through them.
  -- Keep this list in lockstep with officialSources.ts; officials_rankings.data.test.ts
  -- fails if they drift.
  SELECT DISTINCT ON (r.person_id)
         r.person_id,
         r.ref  AS official_slug,
         r.role AS category,
         r.source,
         bool_or(r.source <> 'official_muni')
           OVER (PARTITION BY r.person_id) AS is_exec,
         bool_or(r.source = 'official_muni')
           OVER (PARTITION BY r.person_id) AS is_muni
  FROM person_role r
  WHERE r.source IN ('official_exec', 'official_muni', 'public_sector',
                     'president', 'mep', 'diplomat')
  ORDER BY r.person_id,
           CASE r.source
             WHEN 'official_exec'  THEN 1
             WHEN 'public_sector'  THEN 2
             WHEN 'president'      THEN 3
             WHEN 'mep'            THEN 4
             WHEN 'diplomat'       THEN 5
             WHEN 'official_muni'  THEN 6
           END,
           r.start_date DESC NULLS LAST,
           r.ref
),
latest AS (
  -- Newest wealth year per person, ANY tier (see the header: tier-filtering here
  -- would drop every official who also sits in a higher-priority tier).
  --
  -- The declaration_id tiebreak backstops 090's one-row-per-(person_id, period_year)
  -- invariant, which is asserted over in declaration_obligations.data.test.ts — a file
  -- with no other connection to this feature. Without it, a slip in that invariant makes
  -- latest.declaration_id non-deterministic and real_estate_count flip between refreshes
  -- with no error raised anywhere.
  SELECT DISTINCT ON (w.person_id)
         w.person_id, w.period_year, w.declaration_id,
         w.assets_eur, w.debts_eur, w.net_eur, w.excluded_asset_rows
  FROM person_wealth_year w
  ORDER BY w.person_id, w.period_year DESC, w.declaration_id DESC
),
prev AS (
  -- The previous year PRESENT in the series, not latest-1.
  SELECT DISTINCT ON (w.person_id)
         w.person_id, w.period_year, w.net_eur
  FROM person_wealth_year w
  JOIN latest l ON l.person_id = w.person_id AND w.period_year < l.period_year
  ORDER BY w.person_id, w.period_year DESC
),
re AS (
  -- Real-estate counts for the representative filing only. "Unvalued" is a real and
  -- reportable filing pattern (092 rule 4), so it is counted, not filtered.
  --
  -- The join to `latest` prunes BEFORE aggregating: without it this groups every
  -- real_estate row in the corpus (all tiers, MPs and magistrates included) and then
  -- throws ~85% of the result away on the LEFT JOIN below. Refresh-time only, but free.
  SELECT a.declaration_id,
         count(*)                                        AS real_estate_count,
         count(*) FILTER (WHERE a.value_eur IS NULL)     AS real_estate_unvalued
  FROM declaration_asset a
  JOIN latest l ON l.declaration_id = a.declaration_id
  WHERE a.category = 'real_estate'
  GROUP BY a.declaration_id
),
filed AS (
  -- Did this person file ANYTHING, in any tier? Deliberately checked against
  -- `declaration` and NOT against `latest`: `latest` is the WEALTH series, which 090
  -- only emits for years with valued assets, so keying has_declaration off it would
  -- merely restate `net_worth_eur IS NULL` and hide the very distinction the column
  -- exists to make.
  SELECT DISTINCT person_id FROM declaration WHERE person_id IS NOT NULL
),
decl AS (
  -- Institution / position from the newest officials-tier declaration. NULL for the
  -- 466 whose filing lives in the mp tier — the UI already tolerates a missing
  -- institution, and inventing one from the MP filing would misattribute the office.
  SELECT DISTINCT ON (d.person_id)
         d.person_id, d.institution, d.position_title
  FROM declaration d
  WHERE d.tier IN ('exec', 'muni') AND d.person_id IS NOT NULL
  ORDER BY d.person_id, d.declaration_year DESC, d.declaration_id DESC
)
SELECT
  p.slug,
  o.official_slug,
  p.display_name                                   AS name,
  o.category,
  o.source,
  o.is_exec,
  o.is_muni,
  dc.institution,
  dc.position_title,
  l.period_year                                    AS latest_declaration_year,
  -- Distinguishes the two very different facts that both render as a NULL net worth:
  --   has_declaration = true  -> filed, but declared no VALUED assets (2,466 rows)
  --   has_declaration = false -> no declaration on record at all        (0 rows today)
  -- The false population is empty since T0.1b: the 154 rows that looked like non-filers
  -- were duplicate person rows holding a role while their twin held the filings. The
  -- column stays because a newly appointed official who has not yet filed is a real state.
  -- The JSON never had to make this distinction: it was built FROM declarations, so a
  -- non-filer simply had no row. Sourcing the roster from person_role (correctly — see
  -- the header) introduces them, and "no declaration on record" for a sitting official is
  -- arguably the more newsworthy of the two. Do not let the UI label them the same way.
  (f.person_id IS NOT NULL)                        AS has_declaration,
  -- Rows 090 could not total (an implausible declared value — see its header). Carried out
  -- to the client so a row whose figures are INCOMPLETE can say so, instead of publishing a
  -- €0 net worth and a fabricated -100% year-on-year collapse as though they were facts.
  -- "No silent caps" is only true if the count reaches a reader.
  COALESCE(l.excluded_asset_rows, 0)               AS excluded_asset_rows,
  -- Rounded to cents at rest so the sort key is stable across replicas and the API
  -- never has to re-round (reference_pg_payload_determinism).
  ROUND(l.assets_eur, 2)                           AS total_assets_eur,
  ROUND(l.debts_eur, 2)                            AS total_debts_eur,
  ROUND(l.net_eur, 2)                              AS net_worth_eur,
  COALESCE(re.real_estate_count, 0)::int           AS real_estate_count,
  COALESCE(re.real_estate_unvalued, 0)::int        AS real_estate_unvalued,
  pv.period_year                                   AS delta_previous_year,
  ROUND(l.net_eur - pv.net_eur, 2)                 AS delta_absolute_eur,
  -- Guard the ratio: a previous net worth of exactly 0 (or a negative one, which the
  -- corpus does contain) makes a percentage meaningless rather than infinite.
  CASE WHEN pv.net_eur > 0
       THEN ROUND(((l.net_eur - pv.net_eur) / pv.net_eur) * 100, 2)
  END                                              AS delta_pct
FROM officials o
-- §6 privacy gate (see the header): a person parked in the 'review' holding area, or not
-- opted in as a public figure, is never ranked. Same predicate as every serving fn in 082.
JOIN person p        ON p.person_id = o.person_id
                    AND p.status = 'active'
                    AND p.is_public_figure
-- LEFT, not INNER: 2,399 of the JSON's rows are officials who filed but declared no
-- valued assets, and 090 drops an all-unvalued year from the series entirely. An
-- INNER join here would silently delete them from the leaderboard (11,563 rows
-- instead of ~13,962) — "filed and declared nothing" is a reportable state, not an
-- absence. They carry NULL figures and sort last; the UI filters, the matview does not.
LEFT JOIN latest l   ON l.person_id = o.person_id
LEFT JOIN prev pv    ON pv.person_id = o.person_id
LEFT JOIN re         ON re.declaration_id = l.declaration_id
LEFT JOIN filed f    ON f.person_id = o.person_id
LEFT JOIN decl dc    ON dc.person_id = o.person_id;

-- Index BOTH sides of every join key and every sortable column the registry exposes
-- (reference_pg_query_performance). slug is the paging tiebreak appended by
-- buildOrder, so it must be unique for deterministic pagination.
CREATE UNIQUE INDEX idx_officials_rankings_slug ON officials_rankings_table (slug);
CREATE INDEX idx_officials_rankings_official_slug ON officials_rankings_table (official_slug);
-- NULLS LAST is not cosmetic: net_worth_eur is NULL for the 2,619 officials who filed
-- without valued assets, so the leaderboard sorts `DESC NULLS LAST` to keep them off
-- the top. A plain `DESC` index is NULLS FIRST and the planner will not use it for that
-- ordering — it fell back to a seq scan + top-N heapsort until these matched.
CREATE INDEX idx_officials_rankings_net ON officials_rankings_table (net_worth_eur DESC NULLS LAST, slug);
CREATE INDEX idx_officials_rankings_assets ON officials_rankings_table (total_assets_eur DESC NULLS LAST, slug);
CREATE INDEX idx_officials_rankings_year ON officials_rankings_table (latest_declaration_year);
CREATE INDEX idx_officials_rankings_category ON officials_rankings_table (category);
-- Partial indexes: the two membership filters the UI actually issues, each paired
-- with the default sort so /officials/assets is a single index scan, not a filter
-- over the whole 19k roster.
CREATE INDEX idx_officials_rankings_exec ON officials_rankings_table (net_worth_eur DESC NULLS LAST, slug) WHERE is_exec;
CREATE INDEX idx_officials_rankings_muni ON officials_rankings_table (net_worth_eur DESC NULLS LAST, slug) WHERE is_muni;
-- BOTH search:true columns need a trigram index, not just `name`. buildWhere ORs every
-- search column into one predicate, so an unindexed arm forces a seq scan over the whole
-- OR — which does not merely slow `institution` down, it stops the `name` index being used
-- at all (measured: 28.9ms seq scan with institution unindexed vs 4.4ms bitmap scan
-- without that arm). Adding a search:true column to the registry means adding its index here.
CREATE INDEX idx_officials_rankings_name_trgm ON officials_rankings_table USING gin (name gin_trgm_ops);
CREATE INDEX idx_officials_rankings_institution_trgm ON officials_rankings_table USING gin (institution gin_trgm_ops);
