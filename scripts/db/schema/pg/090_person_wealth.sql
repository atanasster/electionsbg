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
-- person_wealth_year — one row per (person_id, declaration_year).
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
-- person's net worth. has_assets sorts first so an empty incompatibility filing is
-- never chosen over a real one; a year with ONLY assetless filings drops out
-- entirely (rn-1 has no assets → filtered below) rather than showing a spurious €0.
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
    d.declaration_year,
    d.tier,
    d.declaration_type,
    EXISTS (SELECT 1 FROM declaration_asset a
             WHERE a.declaration_id = d.declaration_id) AS has_assets,
    row_number() OVER (
      PARTITION BY d.person_id, d.declaration_year
      ORDER BY
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
    -- how many filings this person made this year (annual + vacate + …)
    count(*) OVER (PARTITION BY d.person_id, d.declaration_year) AS filings
  FROM declaration d
  WHERE d.person_id IS NOT NULL
),
rep AS (  -- the representative filing per person-year; drop years with no
          -- asset-bearing filing so the series carries no spurious €0 point.
  SELECT * FROM ranked WHERE rn = 1 AND has_assets
)
SELECT
  rep.person_id,
  rep.declaration_year,
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
GROUP BY rep.person_id, rep.declaration_year, rep.declaration_id, rep.tier, rep.filings;

-- The series query is "everything for person N, oldest→newest"; the unique index
-- also lets the view be REFRESHed CONCURRENTLY later if the reload needs it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_person_wealth_year_pk
  ON person_wealth_year (person_id, declaration_year);

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
        'year', w.declaration_year,
        'assetsEur', round(w.assets_eur),
        'debtsEur', round(w.debts_eur),
        'netEur', round(w.net_eur),
        'incomeEur', round(w.income_eur),
        'filings', w.filings,
        'tier', w.tier,
        'byCategory', w.by_category
      ) ORDER BY w.declaration_year)
      FROM person_wealth_year w JOIN pick ON pick.person_id = w.person_id
    ), '[]'::jsonb),
    -- Entry/Vacate markers: the individual filings, so "worth entering vs leaving
    -- office" reads off the chart even when both fall in one year.
    'markers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'year', d.declaration_year,
        'type', d.declaration_type,
        'filedAt', d.filed_at,
        'institution', d.institution,
        'positionTitle', d.position_title
      ) ORDER BY d.declaration_year, d.declaration_id)
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
      -- matview ranks by: year, then filed_at, then filing type, then the stable
      -- tie-breaks. The client takes the first asset-bearing row as the headline, so
      -- it never re-derives this comparator and cannot drift from the wealth chart.
      d.declaration_year DESC,
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
