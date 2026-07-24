-- 090_person_wealth.sql — the wealth series over the declarations (089).
--
-- A materialized view of one wealth snapshot per person per year, plus the
-- read-only serving functions the /person profile and the wealth-trajectory chart
-- (audit T3.1) read. STABLE jsonb functions, EXECUTE auto-granted to app_readonly
-- via the ALTER DEFAULT PRIVILEGES that 082 established. Idempotent.
--
-- Refreshed by scripts/db/load_declarations_pg.ts --resolve (audit G13 step 4),
-- AFTER person_id is filled — an unresolved declaration has no person_id and so
-- contributes to no person's series, which is correct.
--
-- NOTE the DROP … CASCADE below re-runs on every --resolve. Nothing depends on
-- person_wealth_year today; if a later view/matview ever does, switch the DROP to
-- a guarded CREATE … IF NOT EXISTS + separate REFRESH so a re-apply does not
-- silently drop the dependent.

-- ---------------------------------------------------------------------------
-- person_wealth_year — one row per (person_id, period_year).
--
-- WHICH YEAR IS THE X-AXIS. period_year = COALESCE(fiscal_year, declaration_year):
-- the period the filing COVERS, not the year it was lodged. The two are different
-- columns and they disagree by design — resolveDeclarationYear (parse_declaration)
-- derives declaration_year as an annual's fiscal_year + 1, and as fiscal_year
-- itself for Entry/Vacate — so an annual filed in May 2025 states the estate at
-- 31 Dec 2024 while an exit filing lodged that February states it as of February.
-- Keying on declaration_year publishes the 31-Dec-2024 estate against the year
-- 2025, which is a mislabel for all 34,238 annuals in the corpus; worse, it puts
-- both of those filings in ONE partition and then lets the annual win on filed_at:
--
--   Лучия Александрова Добрева (luchiya-aleksandrova-dobreva-d06438)
--     21571 Vacate  · covers 2025 · filed 2025-02-18 · 12 valued rows · net +€382,272
--     21570 Annualy · covers 2024 · filed 2025-06-13 ·  3 valued rows · net −€274,784
--
--   both declaration_year 2025 → the fiscal-2024 annual represented "2025", and her
--   published 2025 net worth was −€274,784. 877 person-years were represented by a
--   filing covering an earlier period than one available in the same year.
--
-- On period_year the collision does not arise: the annual is 2024's snapshot and
-- the exit filing is 2025's, and the series carries both (+180 person-years the
-- declaration_year partition was collapsing). This is the key 096_stake_procurement
-- already dates a declared shareholding by, and the one priorAssetDeclaration
-- (src/lib/declarations.ts) has always differenced on.
--
-- The 15 asset-bearing annuals with a NULL fiscal_year fall back to
-- declaration_year and so land one year late — the error the whole axis carried
-- before, now confined to 15 rows out of 28,630.
--
-- WHICH FILING REPRESENTS A YEAR. A person can file more than once in a year (an
-- annual plus a при-напускане vacate), and an incompatibility (Other) filing
-- carries no asset tables at all. The representative is the app's
-- `latestAssetDeclaration` restricted to the year: among the year's ASSET-BEARING
-- filings, the byRecency-first one. The ordering below is byRecency
-- (src/lib/declarations.ts) with the year already fixed by the PARTITION —
-- filed_at desc, then filing type (Vacate>Annualy>Other>Entry), then entry_number
-- asc, then source_url asc — so the matview picks the SAME filing the /person and
-- /officials pages pick, which is what stops those two pages disagreeing on a
-- person's net worth. That equivalence is what forces the PARTITION key to be
-- byRecency's own leading rung: partitioning on declaration_year while ranking on
-- the period would make this matview's newest point stop being latestAssetDeclaration's
-- answer for 269 declarants — reintroducing the /person-vs-/officials split at four
-- times its pre-existing size. has_assets sorts first so an empty incompatibility filing is
-- never chosen over a real one; a year with ONLY assetless filings drops out
-- entirely (rn-1 has no assets → filtered below) rather than showing a spurious €0.
--
-- has_valued_assets SORTS AHEAD OF has_assets, and that distinction is load-bearing.
-- "Has an asset row" is too weak a test for "is a wealth statement": the parser emits
-- a row for a blank table line, so an incompatibility filing can carry a single
-- category='bank' row with a NULL value and nothing else. Of 4,895 Other filings only
-- 450 have asset rows at all — and 449 of those 450 have NOT ONE valued row, against
-- 359/28,835 for annuals. Ranked on has_assets alone such a shell TIES with the real
-- annual and then wins on filed_at, because an annual's filed_at is sometimes NULL and
-- NULLS LAST puts it behind anything dated. That published €0 net worth for people who
-- had declared six figures — Анелия Атанасова Димитрова's 2025 went €610,451 → €0
-- behind one empty bank row.
--
-- It is a PREFERENCE, not a filter. A genuine annual whose assets are all unvalued
-- (359 of them; unvalued real estate is a real filing pattern that 092 rule 4 reports
-- as a caveat) still represents its year when nothing better exists. Adding the tier
-- changes WHICH filing speaks for a year, never WHETHER the year appears.
--
-- NET WORTH matches the app (src/lib/declarations.ts declarationTotals): every
-- non-debt category summed as assets, minus the debt category. Values are EUR at
-- the locked peg (089).
DROP MATERIALIZED VIEW IF EXISTS person_wealth_year CASCADE;
CREATE MATERIALIZED VIEW person_wealth_year AS
WITH ranked AS (
  SELECT
    d.declaration_id,
    d.person_id,
    -- The period covered — see WHICH YEAR IS THE X-AXIS above. Identical to
    -- declarationPeriod() in src/lib/declarations.ts and to 096's stake_year.
    COALESCE(d.fiscal_year, d.declaration_year) AS period_year,
    d.tier,
    d.declaration_type,
    EXISTS (SELECT 1 FROM declaration_asset a
             WHERE a.declaration_id = d.declaration_id) AS has_assets,
    row_number() OVER (
      PARTITION BY d.person_id, COALESCE(d.fiscal_year, d.declaration_year)
      ORDER BY
        (EXISTS (SELECT 1 FROM declaration_asset a
                  WHERE a.declaration_id = d.declaration_id
                    AND a.value_eur > 0)) DESC,
        (EXISTS (SELECT 1 FROM declaration_asset a
                  WHERE a.declaration_id = d.declaration_id)) DESC,
        d.filed_at DESC NULLS LAST,
        CASE d.declaration_type
          WHEN 'Vacate'  THEN 3
          WHEN 'Annualy' THEN 2
          WHEN 'Other'   THEN 1
          WHEN 'Entry'   THEN 0
          ELSE 1
        END DESC,
        d.entry_number ASC NULLS LAST,
        d.source_url ASC
    ) AS rn,
    -- how many filings cover this period (annual + vacate + …)
    count(*) OVER (
      PARTITION BY d.person_id, COALESCE(d.fiscal_year, d.declaration_year)
    ) AS filings
  FROM declaration d
  WHERE d.person_id IS NOT NULL
),
rep AS (  -- the representative filing per person-year; drop years with no
          -- asset-bearing filing so the series carries no spurious €0 point.
  SELECT * FROM ranked WHERE rn = 1 AND has_assets
)
SELECT
  rep.person_id,
  rep.period_year,
  rep.declaration_id,
  rep.tier,
  rep.filings,
  COALESCE(SUM(a.value_eur) FILTER (WHERE a.category <> 'debt'), 0) AS assets_eur,
  COALESCE(SUM(a.value_eur) FILTER (WHERE a.category =  'debt'), 0) AS debts_eur,
  COALESCE(SUM(a.value_eur) FILTER (WHERE a.category <> 'debt'), 0)
    - COALESCE(SUM(a.value_eur) FILTER (WHERE a.category = 'debt'), 0) AS net_eur,
  COALESCE((
    SELECT SUM(COALESCE(i.eur_declarant, 0))
      FROM declaration_income i WHERE i.declaration_id = rep.declaration_id
  ), 0) AS income_eur,
  -- per-category totals for the portfolio-composition view (T3.6)
  COALESCE((
    SELECT jsonb_object_agg(cat, total)
      FROM (
        -- Rounded HERE like every other figure in this payload. Leaving it raw made
        -- by_category the one field a consumer had to round itself, which is exactly the
        -- client-side arithmetic the rest of this migration removes.
        SELECT a2.category AS cat, round(SUM(a2.value_eur)) AS total
          FROM declaration_asset a2
         WHERE a2.declaration_id = rep.declaration_id
         GROUP BY a2.category
      ) c
  ), '{}'::jsonb) AS by_category
FROM rep
LEFT JOIN declaration_asset a ON a.declaration_id = rep.declaration_id
GROUP BY rep.person_id, rep.period_year, rep.declaration_id, rep.tier, rep.filings;

-- The series query is "everything for person N, oldest→newest"; the unique index
-- also lets the view be REFRESHed CONCURRENTLY later if the reload needs it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_person_wealth_year_pk
  ON person_wealth_year (person_id, period_year);

-- ---------------------------------------------------------------------------
-- person_wealth_series(slug) — the trajectory. One point per year (assets /
-- debts / net / income + category breakdown), plus every filing that year as a
-- marker (type + whether it bears assets) so the chart can mark entry/vacate.
-- PUBLIC-SAFE: only a public figure's series is served (§6), same gate as
-- person_by_slug.
DROP FUNCTION IF EXISTS person_wealth_series(text);
CREATE OR REPLACE FUNCTION person_wealth_series(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH pick AS (
    SELECT person_id FROM person
     WHERE slug = p_slug AND status = 'active' AND is_public_figure LIMIT 1
  )
  SELECT jsonb_build_object(
    'slug', p_slug,
    'series', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'year', w.period_year,
        'assetsEur', round(w.assets_eur),
        'debtsEur', round(w.debts_eur),
        'netEur', round(w.net_eur),
        'incomeEur', round(w.income_eur),
        'filings', w.filings,
        'tier', w.tier,
        'byCategory', w.by_category
      ) ORDER BY w.period_year)
      FROM person_wealth_year w JOIN pick ON pick.person_id = w.person_id
    ), '[]'::jsonb),
    -- Entry/Vacate markers: the individual filings, so "worth entering vs leaving
    -- office" reads off the chart even when both fall in one year. Dated on the
    -- SAME axis as the series (period_year) — a marker keyed on declaration_year
    -- would sit a year to the right of the point it annotates.
    'markers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'year', COALESCE(d.fiscal_year, d.declaration_year),
        'type', d.declaration_type,
        'filedAt', d.filed_at,
        'institution', d.institution,
        'positionTitle', d.position_title
      ) ORDER BY COALESCE(d.fiscal_year, d.declaration_year), d.declaration_id)
      FROM declaration d JOIN pick ON pick.person_id = d.person_id
      WHERE d.declaration_type IN ('Entry', 'Vacate')
    ), '[]'::jsonb)
  )
  FROM pick;
$$;

-- ---------------------------------------------------------------------------
-- person_declarations(slug) — the filing list for the unified declaration block
-- (T3.3): every filing with its totals, newest first. The block renders off this
-- one payload instead of three divergent per-tier JSON trees.
DROP FUNCTION IF EXISTS person_declarations(text);
CREATE OR REPLACE FUNCTION person_declarations(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH pick AS (
    SELECT person_id FROM person
     WHERE slug = p_slug AND status = 'active' AND is_public_figure LIMIT 1
  )
  SELECT COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', d.declaration_id,
      'tier', d.tier,
      'year', d.declaration_year,
      'fiscalYear', d.fiscal_year,
      -- The year this filing SPEAKS FOR, on the same axis as the wealth chart, so
      -- the block labels a row with the period it describes rather than the year it
      -- was lodged. Served rather than re-derived client-side for the usual reason:
      -- a second copy of the COALESCE is a second thing that can drift.
      'periodYear', COALESCE(d.fiscal_year, d.declaration_year),
      'type', d.declaration_type,
      'institution', d.institution,
      'positionTitle', d.position_title,
      'filedAt', d.filed_at,
      'sourceUrl', d.source_url,
      'assetsEur', round(COALESCE(
        (SELECT SUM(a.value_eur) FILTER (WHERE a.category <> 'debt')
           FROM declaration_asset a WHERE a.declaration_id = d.declaration_id), 0)),
      'debtsEur', round(COALESCE(
        (SELECT SUM(a.value_eur) FILTER (WHERE a.category = 'debt')
           FROM declaration_asset a WHERE a.declaration_id = d.declaration_id), 0)),
      -- net is computed HERE, on the same basis as person_wealth_year, so the
      -- declaration block and the wealth chart cannot publish different net worths
      -- for one person-year.
      'netEur', round(COALESCE(
        (SELECT SUM(a.value_eur) FILTER (WHERE a.category <> 'debt')
           FROM declaration_asset a WHERE a.declaration_id = d.declaration_id), 0)
        - COALESCE(
        (SELECT SUM(a.value_eur) FILTER (WHERE a.category = 'debt')
           FROM declaration_asset a WHERE a.declaration_id = d.declaration_id), 0)),
      'assetCount', (SELECT count(*) FROM declaration_asset a
                       WHERE a.declaration_id = d.declaration_id),
      'stakeCount', (SELECT count(*) FROM declaration_stake s
                       WHERE s.declaration_id = d.declaration_id),
      'eventCount', (SELECT count(*) FROM declaration_event e
                       WHERE e.declaration_id = d.declaration_id)
    ) ORDER BY
      -- byRecency (src/lib/declarations.ts), verbatim and IN THE SAME ORDER the 090
      -- matview ranks by: the PERIOD COVERED, then filed_at, then filing type, then
      -- the stable tie-breaks. The client takes the first asset-bearing row as the
      -- headline, so it never re-derives this comparator and cannot drift from the
      -- wealth chart. The leading rung is the period for the reason the matview's
      -- partition key is: an annual for fiscal N is lodged the following May, so
      -- ordering on declaration_year hands "latest" to the filing describing the
      -- EARLIER state of affairs whenever an exit filing shares its filing year.
      COALESCE(d.fiscal_year, d.declaration_year) DESC,
      d.filed_at DESC NULLS LAST,
      CASE d.declaration_type
        WHEN 'Vacate'  THEN 3
        WHEN 'Annualy' THEN 2
        WHEN 'Other'   THEN 1
        WHEN 'Entry'   THEN 0
        ELSE 1
      END DESC,
      d.entry_number ASC NULLS LAST,
      d.source_url ASC)
    FROM declaration d JOIN pick ON pick.person_id = d.person_id
  ), '[]'::jsonb);
$$;

-- ---------------------------------------------------------------------------
-- declaration_detail(id) — one filing in full: every asset, income, stake and
-- event row. Backs the drill-down.
--
-- §6 PRIVACY GATE, same as every other serving fn here: declaration_id is a dense
-- bigserial (089), so it is trivially enumerable — the id being "opaque" is not a
-- gate. A filing is served ONLY when it resolved to a person who is active and
-- public. An unresolved (person_id NULL) or non-public subject returns SQL NULL.
DROP FUNCTION IF EXISTS declaration_detail(bigint);
CREATE OR REPLACE FUNCTION declaration_detail(p_id bigint)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id', d.declaration_id,
    'tier', d.tier,
    'declarantName', d.declarant_name,
    'year', d.declaration_year,
    'fiscalYear', d.fiscal_year,
    'type', d.declaration_type,
    'institution', d.institution,
    'positionTitle', d.position_title,
    'filedAt', d.filed_at,
    'sourceUrl', d.source_url,
    'assets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'category', a.category, 'description', a.description, 'detail', a.detail,
        'location', a.location, 'municipality', a.municipality,
        'areaSqm', a.area_sqm, 'acquiredYear', a.acquired_year, 'share', a.share,
        'valueEur', round(a.value_eur), 'holderName', a.holder_name,
        'isSpouse', a.is_spouse
      ) ORDER BY a.seq) FROM declaration_asset a WHERE a.declaration_id = d.declaration_id
    ), '[]'::jsonb),
    'income', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'category', i.category, 'eurDeclarant', round(i.eur_declarant),
        'eurSpouse', round(i.eur_spouse)
      ) ORDER BY i.seq) FROM declaration_income i WHERE i.declaration_id = d.declaration_id
    ), '[]'::jsonb),
    'stakes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'tableNum', s.table_num, 'companyName', s.company_name,
        'companySlug', s.company_slug, 'holderName', s.holder_name,
        'transfereeName', s.transferee_name, 'shareSize', s.share_size,
        'valueEur', round(s.value_eur), 'registeredOffice', s.registered_office
      ) ORDER BY s.seq) FROM declaration_stake s WHERE s.declaration_id = d.declaration_id
    ), '[]'::jsonb),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', e.kind, 'description', e.description, 'detail', e.detail,
        'location', e.location, 'municipality', e.municipality,
        'valueEur', round(e.value_eur), 'legalBasis', e.legal_basis
      ) ORDER BY e.seq) FROM declaration_event e WHERE e.declaration_id = d.declaration_id
    ), '[]'::jsonb)
  )
  FROM declaration d
  JOIN person p ON p.person_id = d.person_id
                AND p.status = 'active' AND p.is_public_figure
  WHERE d.declaration_id = p_id;
$$;

-- Views (unlike functions) are not covered by the ALTER DEFAULT PRIVILEGES that
-- auto-grants functions, so grant the matview read explicitly.
GRANT SELECT ON person_wealth_year TO app_readonly;
