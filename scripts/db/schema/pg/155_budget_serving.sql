-- 155 — the /budget serving layer: eleven functions over 152, 153 and 154.
--
-- Plan: docs/plans/budget-hub-v1.md §6.2 and T3.
--
-- ── APPLIED BY db:load:budget-muni:pg ─────────────────────────────────────
--
-- Not by db:load:budget:pg, which is in REFRESH_EXCLUSIONS and therefore never
-- runs on a fresh clone or on CI. `LANGUAGE sql` bodies are validated at CREATE
-- time, so a function naming an absent table raises 42P01 and — exec() sending
-- the file as ONE transaction — rolls the whole migration back.
--
-- So the in-chain municipal loader applies the DDL for ALL of 152 + 153 + 154
-- before this file, and fills only its own. The state tables therefore EXIST
-- wherever this serving layer does and are EMPTY where the gitignored admin
-- shards were never available. That is the 147_tender_search_text shape, and it
-- is what closes T1's open gap: before this, NOTHING in db:refresh applied
-- 152/153 and a cold chain had no budget tables at all.
--
-- Everything downstream must read 0 rows as "not loaded here", never as "the
-- state appropriated nothing".
--
-- ── CREATE OR REPLACE ONLY, NEVER DROP ───────────────────────────────────
--
-- 077's lesson: a loader-applied migration that DROPs an object another
-- migration reads in a stored query aborts the load with 2BP01 — and with
-- CASCADE it silently deletes the dependent and exits 0.

-- ── The basis control ─────────────────────────────────────────────────────
--
-- Resolved HERE, in SQL, not in the screens. The plan's §7.1 requires it and
-- the skill's corollary is why: a figure computed in two places will drift, and
-- a denominator is exactly the kind of thing a second implementation gets
-- subtly wrong. Every money-returning function below takes `p_basis` and runs
-- its output through this.
--
-- `capita` is deliberately NOT the default anywhere. It is a legitimate basis
-- for a RANKING (a size-free comparator over places of wildly different size)
-- and the wrong one for a ramp or a headline, per 08bd7a6185.
CREATE OR REPLACE FUNCTION budget_apply_basis(
  p_amount     double precision,
  p_basis      text,
  p_gdp        double precision,
  p_parent     double precision,
  p_population int
) RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(coalesce(p_basis, 'eur'))
    -- % of GDP. NULL rather than 0 when no GDP is known: a share of an unknown
    -- denominator is not zero.
    WHEN 'gdp'    THEN CASE WHEN p_gdp        > 0 THEN p_amount / p_gdp        * 100 END
    -- % of the parent total at the same level.
    WHEN 'share'  THEN CASE WHEN p_parent     > 0 THEN p_amount / p_parent     * 100 END
    -- Per resident. The caller supplies the population AND must name its basis
    -- in the payload; see budget_fiscal_year.population_basis.
    WHEN 'capita' THEN CASE WHEN p_population > 0 THEN p_amount / p_population       END
    ELSE p_amount
  END
$$;

COMMENT ON FUNCTION budget_apply_basis(double precision, text, double precision, double precision, int) IS
  'The ?basis= control, resolved server-side so the denominator lives in ONE place. An '
  'unknown basis falls through to EUR rather than erroring: a mistyped param must not blank '
  'a page.';

-- ── 1. The hub headline cards ─────────────────────────────────────────────
--
-- The two-tier pick is the important part. A "latest" resolver must prefer the
-- newest row that actually HAS the figure, then fall back to the newest row of
-- any kind — because МФ freezes a column from time to time and the ingest
-- withholds it rather than carrying it forward. A NULL then reads as „nothing
-- collected", which is the opposite of the truth.
-- `municipal_fiscal_by_obshtina()` (149) is the worked precedent: 2025-Q3
-- suppressed commitments for all 265 municipalities.
CREATE OR REPLACE FUNCTION budget_year_summary(
  p_fy    int  DEFAULT NULL,
  p_basis text DEFAULT 'eur'
) RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH pick AS (
    SELECT * FROM (
      -- Tier 1: the newest year that has an actual revenue figure.
      SELECT y.*, 1 AS tier FROM budget_fiscal_year y
       WHERE (p_fy IS NULL OR y.fiscal_year = p_fy)
         AND EXISTS (SELECT 1 FROM budget_fiscal_year_figure f
                      WHERE f.fiscal_year = y.fiscal_year
                        AND f.basis = 'actual' AND f.series = 'revenue')
      UNION ALL
      -- Tier 2: the newest year at all, so a year whose figures are withheld
      -- still resolves rather than vanishing.
      SELECT y.*, 2 FROM budget_fiscal_year y
       WHERE (p_fy IS NULL OR y.fiscal_year = p_fy)
    ) t ORDER BY tier, fiscal_year DESC LIMIT 1
  )
  SELECT to_jsonb(row) FROM (
    SELECT p.fiscal_year        AS "fiscalYear",
           p.as_of              AS "asOf",
           p.complete,
           p.months_available   AS "monthsAvailable",
           p.gdp_eur            AS "gdpEur",
           p.population,
           p.population_basis   AS "populationBasis",
           p.projection_basis   AS "projectionBasis",
           -- `share` has no parent total at this level, so it would divide by
           -- NULL and blank every figure. Echo the basis actually USED rather
           -- than the one asked for: a client that sent `share` must not label
           -- euros as a percentage.
           CASE WHEN lower(coalesce(p_basis,'eur')) = 'share' THEN 'eur'
                ELSE lower(coalesce(p_basis, 'eur')) END AS basis,
           -- The pivot happens in the inner query and the basis is applied over
           -- it; doing both in one level nests an aggregate inside an aggregate,
           -- which Postgres refuses.
           (SELECT jsonb_object_agg(v.series, jsonb_build_object(
                     'actual',    budget_apply_basis(v.actual,    nullif(p_basis,'share'), p.gdp_eur, NULL, p.population),
                     'planned',   budget_apply_basis(v.planned,   nullif(p_basis,'share'), p.gdp_eur, NULL, p.population),
                     'projected', budget_apply_basis(v.projected, nullif(p_basis,'share'), p.gdp_eur, NULL, p.population)))
              FROM (SELECT f.series,
                           max(f.amount_eur) FILTER (WHERE f.basis = 'actual')    AS actual,
                           max(f.amount_eur) FILTER (WHERE f.basis = 'planned')   AS planned,
                           max(f.amount_eur) FILTER (WHERE f.basis = 'projected') AS projected
                      FROM budget_fiscal_year_figure f
                     WHERE f.fiscal_year = p.fiscal_year
                     GROUP BY f.series) v) AS figures,
           (SELECT array_agg(fiscal_year ORDER BY fiscal_year)
              FROM budget_fiscal_year) AS "yearsAvailable"
      FROM pick p
  ) row;
$$;

COMMENT ON FUNCTION budget_year_summary(int, text) IS
  'Every series carries all three bases (actual / planned / projected) rather than one '
  'resolved figure: they are all true and a consumer that receives one cannot say which.';

-- ── 2. The execution time series ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION budget_series(
  p_from   int  DEFAULT NULL,
  p_to     int  DEFAULT NULL,
  p_series text DEFAULT NULL,
  p_basis  text DEFAULT 'eur'
) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'basis', CASE WHEN lower(coalesce(p_basis,'eur')) = 'share' THEN 'eur'
                  ELSE lower(coalesce(p_basis, 'eur')) END,
    -- CUMULATIVE year-to-date, and the payload says so, because summing these
    -- double-counts by roughly n(n+1)/2.
    'cumulative', true,
    'points', coalesce(jsonb_agg(to_jsonb(row) ORDER BY row.period, row.series), '[]'::jsonb))
  FROM (
    SELECT o.fiscal_year AS "fiscalYear", o.period, o.series,
           budget_apply_basis(o.executed_eur, nullif(p_basis,'share'), y.gdp_eur, NULL, y.population)
             AS "executedEur",
           budget_apply_basis(o.planned_eur,  nullif(p_basis,'share'), y.gdp_eur, NULL, y.population)
             AS "plannedEur"
      FROM budget_kfp_observation o
      LEFT JOIN budget_fiscal_year y ON y.fiscal_year = o.fiscal_year
     WHERE (p_from   IS NULL OR o.fiscal_year >= p_from)
       AND (p_to     IS NULL OR o.fiscal_year <= p_to)
       AND (p_series IS NULL OR o.series = p_series)
  ) row;
$$;

-- ── 3. One period's snapshot ──────────────────────────────────────────────
--
-- Returns the SECTION frame and its lines. Sections III and IV publish a total
-- and zero lines, so a line-only payload makes the EU contribution and the
-- deficit disappear; `series` is what separates II from III, both of which are
-- kind = 'expenditure'.
CREATE OR REPLACE FUNCTION budget_snapshot(
  p_fy    int,
  p_kind  text DEFAULT NULL,
  p_basis text DEFAULT 'eur'
) RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH latest AS (
    SELECT max(period) AS period FROM budget_kfp_snapshot_section WHERE fiscal_year = p_fy
  ), y AS (
    SELECT gdp_eur, population FROM budget_fiscal_year WHERE fiscal_year = p_fy
  )
  SELECT jsonb_build_object(
    'fiscalYear', p_fy,
    'period', (SELECT period FROM latest),
    'basis', lower(coalesce(p_basis, 'eur')),
    'sections', coalesce((
      SELECT jsonb_agg(to_jsonb(sec) ORDER BY sec."sectionCode") FROM (
        SELECT s.section_code AS "sectionCode", s.kind, s.series,
               s.label_bg AS "labelBg", s.label_en AS "labelEn",
               budget_apply_basis(s.executed_eur, p_basis,
                 (SELECT gdp_eur FROM y), NULL, (SELECT population FROM y)) AS "executedEur",
               budget_apply_basis(s.planned_eur, p_basis,
                 (SELECT gdp_eur FROM y), NULL, (SELECT population FROM y)) AS "plannedEur",
               coalesce((
                 SELECT jsonb_agg(to_jsonb(ln) ORDER BY ln.ord) FROM (
                   SELECT l.line_ord AS ord, l.depth, l.is_subtotal AS "isSubtotal",
                          l.label_bg AS "labelBg", l.label_en AS "labelEn",
                          l.group_label_bg AS "groupLabelBg",
                          -- `share` here is of the SECTION total, which is the
                          -- parent at this level.
                          budget_apply_basis(l.executed_eur, p_basis,
                            (SELECT gdp_eur FROM y), s.executed_eur,
                            (SELECT population FROM y)) AS "executedEur"
                     FROM budget_kfp_snapshot_line l
                    WHERE l.fiscal_year = s.fiscal_year AND l.period = s.period
                      AND l.section_code = s.section_code
                 ) ln), '[]'::jsonb) AS lines
          FROM budget_kfp_snapshot_section s
         WHERE s.fiscal_year = p_fy AND s.period = (SELECT period FROM latest)
           AND (p_kind IS NULL OR s.kind = p_kind)
      ) sec), '[]'::jsonb));
$$;

-- ── 4. The explorer: ONE level per call ───────────────────────────────────
--
-- One level, not the whole tree. That is what keeps the buffer count flat as
-- the reader drills, and it is why the breadcrumb is cheap.
CREATE OR REPLACE FUNCTION budget_explorer(
  p_fy        int,
  p_dimension text DEFAULT 'admin',
  p_parent    text DEFAULT NULL,
  p_basis     text DEFAULT 'eur'
) RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH y AS (SELECT gdp_eur, population FROM budget_fiscal_year WHERE fiscal_year = p_fy),
  rows AS (
    -- admin: the spending units, or one unit's programmes when a parent is given.
    SELECT n.node_id AS key, n.name_bg AS "nameBg", n.name_en AS "nameEn",
           sum(f.planned_eur) AS amount,
           -- A unit HAS children only when its programmes are known.
           EXISTS (SELECT 1 FROM budget_program_fact pf
                    WHERE pf.node_id = n.node_id AND pf.fiscal_year = p_fy) AS "hasChildren"
      FROM budget_admin_fact f
      JOIN budget_admin_node n ON n.node_id = f.node_id
     WHERE p_dimension = 'admin' AND p_parent IS NULL
       AND f.fiscal_year = p_fy AND f.kind = 'expenditure'
     GROUP BY n.node_id, n.name_bg, n.name_en
    UNION ALL
    SELECT pf.program_code, pf.name_bg, pf.name_en, sum(pf.planned_eur), false
      FROM budget_program_fact pf
     WHERE p_dimension = 'admin' AND p_parent IS NOT NULL
       AND pf.fiscal_year = p_fy AND pf.node_id = p_parent
     GROUP BY pf.program_code, pf.name_bg, pf.name_en
    UNION ALL
    -- functional: COFOG. A different corpus from the admin grain above — see
    -- 153's header — so the payload names its source.
    -- `p_parent IS NULL` is not optional: COFOG is a FLAT list with no
    -- children, so without it a drilled URL carried over from the admin tree
    -- returns the whole S13 breakdown under a breadcrumb naming one ministry,
    -- at a 200.
    SELECT c.cofog_code, c.name_bg, c.name_en, c.amount_eur, false
      FROM budget_cofog c
     WHERE p_dimension = 'functional' AND p_parent IS NULL
       AND c.fiscal_year = p_fy AND c.cofog_code <> 'TOTAL'
  ), total AS (SELECT sum(amount) AS t FROM rows)
  SELECT jsonb_build_object(
    'fiscalYear', p_fy,
    'dimension', p_dimension,
    'parent', p_parent,
    -- The parent's NAME, so a shared link shows what it drilled into. Without
    -- it the node's Cyrillic name appears nowhere on the page for a reader who
    -- arrives cold — client-held labels only exist for the session that clicked.
    'parentName', CASE WHEN p_parent IS NULL THEN NULL ELSE coalesce(
      (SELECT n.name_bg FROM budget_admin_node n WHERE n.node_id = p_parent),
      (SELECT pf.name_bg FROM budget_program_fact pf
        WHERE pf.program_code = p_parent AND pf.fiscal_year = p_fy LIMIT 1)) END,
    'basis', lower(coalesce(p_basis, 'eur')),
    -- Named so a caption cannot silently describe the wrong aggregate.
    'source', CASE WHEN p_dimension = 'functional'
                   THEN 'Eurostat gov_10a_exp (S13, general government)'
                   ELSE 'МФ — държавен бюджет' END,
    -- THE TOTAL GOES THROUGH THE BASIS TOO. Left raw it was rendered as a
    -- percentage by the client: measured, ?basis=gdp printed 8934774699.0%
    -- where the truth is 8.5%. `share` is 100 by definition at every level —
    -- it is the denominator — so it is stated rather than divided by itself.
    'total', CASE
      WHEN lower(coalesce(p_basis,'eur')) = 'share' THEN 100
      ELSE budget_apply_basis((SELECT t FROM total), p_basis,
             (SELECT gdp_eur FROM y), (SELECT t FROM total),
             (SELECT population FROM y))
    END,
    -- The newest year THIS dimension can answer for. COFOG ends where Eurostat
    -- ends (2024 today) while the admin grain runs to the current budget year,
    -- so an empty level on FY2026 means „this corpus stops earlier" rather than
    -- „nothing was spent". Same lesson as 156's ipopLatestYear: a zero that
    -- reads as an absence has to carry its own coverage.
    'coverageLatestYear', CASE WHEN p_dimension = 'functional'
      THEN (SELECT max(fiscal_year) FROM budget_cofog)
      ELSE (SELECT max(fiscal_year) FROM budget_admin_fact) END,
    'rows', coalesce((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.amount DESC NULLS LAST) FROM (
        SELECT key, "nameBg", "nameEn", "hasChildren",
               budget_apply_basis(amount, p_basis, (SELECT gdp_eur FROM y),
                 (SELECT t FROM total), (SELECT population FROM y)) AS amount
          FROM rows
      ) r), '[]'::jsonb));
$$;

-- ── 5-6. The spending units ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION budget_admin_list(
  p_fy    int  DEFAULT NULL,
  p_q     text DEFAULT NULL,
  p_limit int  DEFAULT 300
) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'fiscalYear', p_fy,
    'rows', coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.amount DESC NULLS LAST), '[]'::jsonb))
  FROM (
    -- ORDER BY *inside*, with the LIMIT. Ranking in the outer jsonb_agg while
    -- limiting here returns an ARBITRARY n, sorted — which looks like a
    -- leaderboard and is not one.
    -- p_fy NULL sums ACROSS years, so the appropriation has to be read on one
    -- basis: planned_eur carries the Отчет's consolidated restatement in
    -- report-years only, which would inflate a unit's all-years total and its
    -- rank in this very list (МОСВ by EUR 43.9m). See planned_law_eur's comment.
    SELECT n.node_id AS "nodeId", n.name_bg AS "nameBg", n.name_en AS "nameEn", n.eik,
           sum(coalesce(f.planned_law_eur, f.planned_eur)) AS amount,
           count(*) FILTER (WHERE f.executed_eur IS NOT NULL) > 0 AS "hasExecution"
      FROM budget_admin_node n
      LEFT JOIN budget_admin_fact f
        ON f.node_id = n.node_id AND f.kind = 'expenditure'
       AND (p_fy IS NULL OR f.fiscal_year = p_fy)
     WHERE p_q IS NULL OR p_q = ''
        OR n.name_bg ILIKE '%' || replace(replace(p_q, '%', '\%'), '_', '\_') || '%'
        OR n.name_en ILIKE '%' || replace(replace(p_q, '%', '\%'), '_', '\_') || '%'
     GROUP BY n.node_id, n.name_bg, n.name_en, n.eik
     ORDER BY sum(coalesce(f.planned_law_eur, f.planned_eur)) DESC NULLS LAST
     LIMIT greatest(1, least(coalesce(p_limit, 300), 1000))
  ) r;
$$;

COMMENT ON FUNCTION budget_admin_list(int, text, int) IS
  'The free-text arms escape %% and _ — they are LIKE wildcards, and an unescaped one turns '
  'the search into a scan of everything (measured at 11.7s on the tenders corpus).';

CREATE OR REPLACE FUNCTION budget_admin_detail(
  p_node_id text,
  p_fy      int DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT to_jsonb(row) FROM (
    SELECT n.node_id AS "nodeId", n.name_bg AS "nameBg", n.name_en AS "nameEn", n.eik,
           coalesce((
             SELECT jsonb_agg(to_jsonb(f) ORDER BY f."fiscalYear" DESC, f.kind)
               -- `plannedEur` stays same-basis with amendedEur/executedEur, so a
               -- per-row variance is like-with-like. `seriesEur` is the one a
               -- caller must plot across years — with p_fy NULL this array IS a
               -- multi-year series. Same rule as ministrySeries.ts on the JSON side.
               FROM (SELECT fiscal_year AS "fiscalYear", kind,
                            planned_eur AS "plannedEur",
                            coalesce(planned_law_eur, planned_eur) AS "seriesEur",
                            amended_eur AS "amendedEur",
                            executed_eur AS "executedEur", completeness
                       FROM budget_admin_fact a
                      WHERE a.node_id = n.node_id
                        AND (p_fy IS NULL OR a.fiscal_year = p_fy)) f), '[]'::jsonb) AS facts,
           coalesce((
             SELECT jsonb_agg(to_jsonb(p) ORDER BY p."plannedEur" DESC NULLS LAST)
               FROM (SELECT program_code AS "programCode", name_bg AS "nameBg",
                            fiscal_year AS "fiscalYear",
                            planned_eur AS "plannedEur", executed_eur AS "executedEur"
                       FROM budget_program_fact pf
                      WHERE pf.node_id = n.node_id
                        AND (p_fy IS NULL OR pf.fiscal_year = p_fy)) p), '[]'::jsonb) AS programs
      FROM budget_admin_node n WHERE n.node_id = p_node_id
  ) row;
$$;

-- ── 7. COFOG ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION budget_cofog_list(
  p_fy    int,
  p_basis text DEFAULT 'eur'
) RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH y AS (SELECT gdp_eur, population FROM budget_fiscal_year WHERE fiscal_year = p_fy),
       tot AS (SELECT amount_eur AS t FROM budget_cofog
                WHERE fiscal_year = p_fy AND cofog_code = 'TOTAL')
  SELECT jsonb_build_object(
    'fiscalYear', p_fy,
    'basis', lower(coalesce(p_basis, 'eur')),
    -- The perimeter, in the payload, because it is NOT the state budget the
    -- rest of this module reports and a caption that says so is wrong.
    'perimeter', 'S13 — general government (state + municipalities + social funds)',
    'source', 'Eurostat gov_10a_exp',
    'totalEur', (SELECT t FROM tot),
    'rows', coalesce((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.amount DESC NULLS LAST) FROM (
        SELECT c.cofog_code AS code, c.name_bg AS "nameBg", c.name_en AS "nameEn",
               budget_apply_basis(c.amount_eur, p_basis, (SELECT gdp_eur FROM y),
                 (SELECT t FROM tot), (SELECT population FROM y)) AS amount,
               c.pct_of_total AS "pctOfTotal"
          FROM budget_cofog c
         WHERE c.fiscal_year = p_fy AND c.cofog_code <> 'TOTAL'
      ) r), '[]'::jsonb));
$$;

-- ── 8. The variance, WITH its coverage ────────────────────────────────────
--
-- The coverage pair travels with the ranking, always. Measured on the corpus,
-- 8 of 48 spending units carry an executed figure in the best year and none do
-- in six of nine — so a top-N alone asserts it ranks the government's
-- ministries, which it does not. A consumer that receives only rows CANNOT
-- render this honestly, which is why the shape forces it.
CREATE OR REPLACE FUNCTION budget_variance(
  p_fy    int,
  p_limit int DEFAULT 20
) RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH scoped AS (
    SELECT f.*, n.name_bg, n.name_en
      FROM budget_admin_fact f
      JOIN budget_admin_node n ON n.node_id = f.node_id
     WHERE f.fiscal_year = p_fy AND f.kind = 'expenditure'
  )
  SELECT jsonb_build_object(
    'fiscalYear', p_fy,
    -- Whether the FISCAL YEAR has closed, from budget_fiscal_year — not
    -- inferred client-side from „is this the newest year we have". Those two
    -- disagree every January, when the just-closed year is still the newest
    -- and a consumer would tell the reader it is still running. NULL when the
    -- year is not in the dimension at all.
    'complete', (SELECT complete FROM budget_fiscal_year WHERE fiscal_year = p_fy),
    -- UNITS, not rows. by-admin rows are (nodeId × kind), so a row count read
    -- as a number of ministries over-states by 1.8x-2.9x.
    'coveredUnits', (SELECT count(DISTINCT node_id) FROM scoped WHERE executed_eur IS NOT NULL),
    'totalUnits',   (SELECT count(DISTINCT node_id) FROM scoped),
    'rows', coalesce((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY abs(r."deltaVsLawEur") DESC NULLS LAST) FROM (
        SELECT node_id AS "nodeId", name_bg AS "nameBg", name_en AS "nameEn",
               planned_eur AS "plannedEur", amended_eur AS "amendedEur",
               executed_eur AS "executedEur",
               -- BOTH deltas, named. „A ministry overspent its appropriation"
               -- and „parliament re-voted the appropriation" are different
               -- findings that a single „отклонение" collapses.
               executed_eur - planned_eur AS "deltaVsLawEur",
               executed_eur - coalesce(amended_eur, planned_eur) AS "deltaVsAmendedEur"
          FROM scoped WHERE executed_eur IS NOT NULL
         -- ORDER BY with the LIMIT, not in the outer agg: otherwise this is an
         -- arbitrary n sorted, and the „largest deviation" is whichever rows
         -- the scan happened to reach.
         ORDER BY abs(executed_eur - planned_eur) DESC NULLS LAST
         LIMIT greatest(1, least(coalesce(p_limit, 20), 200))
      ) r), '[]'::jsonb));
$$;

-- ── 8b. The administration's establishment ────────────────────────────────
--
-- One row per year, national, from the Доклад за състоянието на администрацията.
--
-- TWO HEADCOUNTS THAT ARE NOT COMPARABLE, and the whole reason this function
-- returns both rather than one. `positions_*` are budgeted POSTS (щатни
-- бройки) in the bodies the Доклад covers; `nsi_headcount` is НСИ's count of
-- PERSONS EMPLOYED at December, from a separate table inside the same
-- document. It EXCLUDES МВР and МО and INCLUDES staff engaged outside the
-- approved establishment, so neither series is a subset of the other — the
-- Доклад itself calls them несъпоставими. They differ by ~35 000 on every recent
-- year. Subtracting them yields nothing — it is not „unfilled posts", which is
-- `positions_vacant`, a number the source publishes directly.
CREATE OR REPLACE FUNCTION budget_personnel_series()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    -- The BASIS of each series, in the payload, so a consumer cannot present
    -- one as the other.
    'positionsBasis', 'Щатни бройки по Доклада за състоянието на администрацията',
    'headcountBasis', 'НСИ, наети лица (списъчен брой) към декември — отделна справка в същия доклад',
    'points', coalesce((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r."fiscalYear")
        FROM (SELECT fiscal_year AS "fiscalYear",
                     positions_total  AS "positionsTotal",
                     positions_filled AS "positionsFilled",
                     positions_vacant AS "positionsVacant",
                     nsi_headcount    AS "nsiHeadcount",
                     payroll_eur      AS "payrollEur"
                FROM budget_personnel
               -- National only. `node_id` is NULL on every row today; a
               -- per-body arm would double every national figure if folded in.
               WHERE node_id IS NULL) r), '[]'::jsonb));
$$;

-- ── 9. The legislative path ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION budget_documents(
  p_fy int DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'fiscalYear', p_fy,
    'rows', coalesce((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r."publishedOn" DESC NULLS LAST, r."documentId")
        FROM (SELECT document_id AS "documentId", fiscal_year AS "fiscalYear", kind,
                     title_bg AS "titleBg", published_on AS "publishedOn", url,
                     obs_category AS "obsCategory",
                     adopted_by_item_id AS "adoptedByItemId"
                FROM budget_document d
               WHERE p_fy IS NULL OR d.fiscal_year = p_fy) r), '[]'::jsonb),
    -- Which of the OGP/IBP eight are published AT ALL, across every year. The
    -- page's claim is „N от 8", so the denominator is the frame, not the corpus.
    'obsCategoriesPresent', coalesce((
      SELECT jsonb_agg(DISTINCT obs_category) FROM budget_document
       WHERE obs_category IS NOT NULL), '[]'::jsonb));
$$;

-- ── 10-11. The municipal tier ─────────────────────────────────────────────
--
-- WHAT THE STATE SENDS. Neither function reads `municipal_fiscal` (149) — that
-- is what municipalities OWE, a different corpus with a different grain, and
-- combining them is the defect 154's header exists to prevent.
CREATE OR REPLACE FUNCTION budget_muni_list(
  p_fy    int  DEFAULT NULL,
  p_q     text DEFAULT NULL,
  p_limit int  DEFAULT 300
) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'fiscalYear', p_fy,
    'rows', coalesce(jsonb_agg(to_jsonb(r) ORDER BY r."totalEur" DESC NULLS LAST), '[]'::jsonb))
  FROM (
    SELECT t.obshtina, coalesce(p.name_bg, t.name_bg) AS "nameBg", p.name_en AS "nameEn",
           t.fiscal_year AS "fiscalYear",
           t.delegated_eur AS "delegatedEur", t.equalization_eur AS "equalizationEur",
           t.capital_eur AS "capitalEur", t.winter_eur AS "winterEur",
           t.other_targeted_eur AS "otherTargetedEur", t.total_eur AS "totalEur",
           pop.population AS "population", pop.census_year AS "censusYear",
           CASE WHEN pop.population > 0
                THEN t.total_eur / pop.population END AS "totalPerCapitaEur"
      FROM budget_muni_transfer t
      LEFT JOIN place_dim p ON p.code = t.obshtina AND p.kind = 'obshtina'
      -- ⚠️ THE CAPITAL IS KEYED DIFFERENTLY IN THE TWO TABLES. `budget_muni_transfer`
      -- calls it SFO_CITY (the МФ denomination) and `obshtina_population` calls it
      -- SOF00 (the census one), so a plain equi-join drops the LARGEST municipality —
      -- EUR 718.26m and 1 274 290 residents — leaving Sofia as the one row on the page
      -- with no per-resident figure, which is also the row every reader checks first.
      -- Measured: exactly one of 265 rows fails the naive join, and it is that one.
      --
      -- Resolved through `place_dim.governance_code`, the declared canonical
      -- crosswalk (the idiom 021 and 149 already use), NOT a CASE on the one
      -- code that happens to differ today. Verified byte-equivalent across all
      -- 2 385 rows.
      LEFT JOIN obshtina_population pop
             ON pop.obshtina = coalesce(p.governance_code, t.obshtina)
     WHERE (p_fy IS NULL OR t.fiscal_year = p_fy)
       -- BOTH names. Matching name_bg alone made /en/budget/municipal?q=Plovdiv
       -- render „No municipalities found" above a list containing Plovdiv: the
       -- reader searches in the language the page is written in, and the server
       -- was only ever looking at the other one.
       AND (p_q IS NULL OR p_q = ''
            OR coalesce(p.name_bg, t.name_bg) ILIKE
               '%' || replace(replace(p_q, '%', '\%'), '_', '\_') || '%'
            OR p.name_en ILIKE
               '%' || replace(replace(p_q, '%', '\%'), '_', '\_') || '%')
     -- Measured before this line existed: budget_muni_list(2026, NULL, 5)
     -- returned Бургас-01 at EUR 19.98m as #1 and omitted Столична (EUR 718.26m)
     -- and Пловдив entirely.
     ORDER BY t.total_eur DESC NULLS LAST
     LIMIT greatest(1, least(coalesce(p_limit, 300), 1000))
  ) r;
$$;

-- ── 10b. ИПОП, the municipal investment programme ──────────────────────────
--
-- One snapshot (FY2025): 3 492 projects across 264 municipalities, EUR 2.98bn
-- agreed against EUR 0.99bn paid.
--
-- ⚠️ `stalled` IS A THRESHOLD, NOT A VERDICT — agreement >= EUR 100 000 AND
-- paid < 5% (scripts/budget/ipop/ingest.ts). Two facts qualify the count, and
-- both are returned so no consumer can present it as „769 abandoned projects":
--
--   * THE COHORT. There IS a vintage after all, encoded in the project id as
--     OP-<yy>. OP-24 is 35.4% paid and OP-25 is 5.5%; 91 of the 769 flags are
--     the youngest cohort, where under 5% paid is unremarkable. An earlier
--     version of this comment said the corpus carried no date at all — true of
--     the columns, false of the ids, and it invited exactly the inference the
--     rest of the note exists to prevent.
--   * THE CLAIM. 306 of the 769 (39.8%, EUR 343.4m) already have money
--     submitted or awaiting payment, so „nothing has been paid" is not
--     „nothing is happening".
CREATE OR REPLACE FUNCTION budget_muni_ipop(
  p_q     text DEFAULT NULL,
  p_limit int  DEFAULT 300
) RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH scoped AS (
    SELECT i.*, coalesce(p.name_bg, i.obshtina) AS name_bg, p.name_en
      FROM budget_muni_ipop_project i
      LEFT JOIN place_dim p ON p.code = i.obshtina AND p.kind = 'obshtina'
  )
  SELECT jsonb_build_object(
    'fiscalYear', (SELECT max(fiscal_year) FROM scoped),
    -- The flag's own definition, in the payload.
    'stalledRule', jsonb_build_object('minAgreementEur', 100000, 'maxPaidPct', 5),
    'national', (SELECT jsonb_build_object(
        'projectCount', count(*), 'municipalityCount', count(DISTINCT obshtina),
        'agreementEur', sum(agreement_eur), 'paidEur', sum(paid_eur),
        'stalledCount', count(*) FILTER (WHERE stalled),
        'stalledAgreementEur', sum(agreement_eur) FILTER (WHERE stalled),
        -- Of the flagged, how many already have a claim in the pipeline.
        'stalledWithClaimCount', count(*) FILTER (
           WHERE stalled AND coalesce(submitted_eur,0) + coalesce(awaiting_eur,0) > 0),
        'stalledWithClaimEur', sum(agreement_eur) FILTER (
           WHERE stalled AND coalesce(submitted_eur,0) + coalesce(awaiting_eur,0) > 0),
        -- Per cohort, so „5% paid" can be read against its own vintage.
        'cohorts', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.cohort) FROM (
             SELECT substring(project_id from 'OP-(\d{2})') AS cohort,
                    count(*) AS "projectCount",
                    sum(agreement_eur) AS "agreementEur",
                    sum(paid_eur) AS "paidEur",
                    count(*) FILTER (WHERE stalled) AS "stalledCount"
               FROM scoped
              WHERE substring(project_id from 'OP-(\d{2})') IS NOT NULL
              GROUP BY 1) c))
      FROM scoped),
    'rows', coalesce((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r."agreementEur" DESC NULLS LAST) FROM (
        SELECT obshtina, name_bg AS "nameBg", name_en AS "nameEn",
               count(*) AS "projectCount",
               sum(agreement_eur) AS "agreementEur",
               sum(paid_eur) AS "paidEur",
               CASE WHEN sum(agreement_eur) > 0
                    THEN 100 * sum(paid_eur) / sum(agreement_eur) END AS "paidPct",
               count(*) FILTER (WHERE stalled) AS "stalledCount"
          FROM scoped
         WHERE (p_q IS NULL OR p_q = ''
                OR name_bg ILIKE '%' || replace(replace(p_q, '%', '\%'), '_', '\_') || '%'
                OR name_en ILIKE '%' || replace(replace(p_q, '%', '\%'), '_', '\_') || '%')
         GROUP BY obshtina, name_bg, name_en
         ORDER BY sum(agreement_eur) DESC NULLS LAST
         LIMIT greatest(1, least(coalesce(p_limit, 300), 1000))
      ) r), '[]'::jsonb));
$$;

-- ── 10c. Municipal capital programmes (поименни списъци) ───────────────────
--
-- ⚠️ COVERAGE IS THE HEADLINE, NOT A FOOTNOTE. This is not a national return:
-- it is whichever municipalities published a поименен списък and had it
-- parsed. Measured — 2022: 9 of 265. 2023: 9. 2024: 13. 2025: 24. 2026: 1.
-- A national total from a 9% sample is the defect this function exists to
-- prevent, so `municipalityCount` travels with every figure and there is no
-- „national" block at all.
CREATE OR REPLACE FUNCTION budget_muni_capital(
  p_fy int DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH scoped AS (
    -- Aliased `muni_name`, not `name_bg`: the project table has a `name_bg` of
    -- its own (the PROJECT's name), so `c.*` already carries one and the CTE
    -- would expose two columns under one label.
    SELECT c.*, coalesce(p.name_bg, c.obshtina) AS muni_name, p.name_en AS muni_name_en
      FROM budget_muni_capital_project c
      LEFT JOIN place_dim p ON p.code = c.obshtina AND p.kind = 'obshtina'
     WHERE p_fy IS NULL OR c.fiscal_year = p_fy
  )
  SELECT jsonb_build_object(
    'fiscalYear', p_fy,
    'yearsAvailable', (SELECT array_agg(DISTINCT fiscal_year ORDER BY fiscal_year)
                         FROM budget_muni_capital_project),
    -- The denominator every figure below must be read against.
    'totalMunicipalities', (SELECT count(*) FROM obshtina_population),
    'covered', jsonb_build_object(
      'municipalityCount', (SELECT count(DISTINCT obshtina) FROM scoped),
      'projectCount',      (SELECT count(*) FROM scoped),
      'totalEur',          (SELECT sum(total_eur) FROM scoped)),
    -- The funding mix, and ITS OWN much smaller coverage. Only two
    -- municipalities in the whole corpus (Бургас, Столична) publish any source
    -- breakdown at all, so on FY2023 a mix labelled „за 9 общини" is Бургас
    -- alone — €41.8m of €589.4m, 7.1% of the money — printed above a list
    -- topped by Столична, which contributes nothing to it. The mix therefore
    -- carries its own denominators and never borrows the page's.
    'sources', (SELECT jsonb_build_object(
        'stateSubsidyEur', sum(state_subsidy_eur), 'ownFundsEur', sum(own_funds_eur),
        'debtEur', sum(debt_eur), 'euFundsEur', sum(eu_funds_eur),
        'otherEur', sum(other_eur), 'carryOverEur', sum(carry_over_eur),
        'municipalityCount', count(DISTINCT obshtina),
        'projectCount', count(*),
        'totalEur', sum(total_eur))
      FROM scoped
      -- Rows that actually carry a breakdown.
     WHERE coalesce(state_subsidy_eur,0) + coalesce(own_funds_eur,0)
         + coalesce(debt_eur,0) + coalesce(eu_funds_eur,0)
         + coalesce(other_eur,0) + coalesce(carry_over_eur,0) > 0),
    'rows', coalesce((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r."totalEur" DESC NULLS LAST) FROM (
        SELECT obshtina, muni_name AS "nameBg", muni_name_en AS "nameEn",
               count(*) AS "projectCount", sum(total_eur) AS "totalEur",
               sum(state_subsidy_eur) AS "stateSubsidyEur",
               sum(own_funds_eur) AS "ownFundsEur", sum(debt_eur) AS "debtEur",
               sum(eu_funds_eur) AS "euFundsEur", sum(other_eur) AS "otherEur",
               sum(carry_over_eur) AS "carryOverEur"
          FROM scoped GROUP BY obshtina, muni_name, muni_name_en
         ORDER BY sum(total_eur) DESC NULLS LAST
      ) r), '[]'::jsonb));
$$;

CREATE OR REPLACE FUNCTION budget_muni_detail(
  p_obshtina text,
  p_fy       int DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT to_jsonb(row) FROM (
    SELECT p_obshtina AS obshtina,
           (SELECT name_bg FROM place_dim
             WHERE code = p_obshtina AND kind = 'obshtina') AS "nameBg",
           coalesce((
             SELECT jsonb_agg(to_jsonb(t) ORDER BY t."fiscalYear" DESC)
               FROM (SELECT fiscal_year AS "fiscalYear",
                            delegated_eur AS "delegatedEur",
                            equalization_eur AS "equalizationEur",
                            capital_eur AS "capitalEur", winter_eur AS "winterEur",
                            other_targeted_eur AS "otherTargetedEur",
                            total_eur AS "totalEur"
                       FROM budget_muni_transfer
                      WHERE obshtina = p_obshtina
                        AND (p_fy IS NULL OR fiscal_year = p_fy)) t), '[]'::jsonb) AS transfers,
           coalesce((
             SELECT jsonb_agg(to_jsonb(i) ORDER BY i."agreementEur" DESC NULLS LAST)
               FROM (SELECT project_id AS "projectId", description,
                            agreement_eur AS "agreementEur", paid_eur AS "paidEur",
                            paid_pct AS "paidPct", stalled
                       FROM budget_muni_ipop_project
                      WHERE obshtina = p_obshtina) i), '[]'::jsonb) AS ipop,
           -- The two partial-coverage tables carry their coverage WITH them, so
           -- a caller cannot render „26 общини" as a national figure or read an
           -- empty capital array as „this town builds nothing".
           (SELECT count(DISTINCT obshtina) FROM budget_muni_capital_project)
             AS "capitalProgrammeMunicipalities",
           (SELECT count(*) FROM budget_muni_capital_project
             WHERE obshtina = p_obshtina) AS "capitalProjectCount"
  ) row;
$$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION budget_apply_basis(double precision, text, double precision, double precision, int) TO app_readonly;
    GRANT EXECUTE ON FUNCTION budget_year_summary(int, text)                TO app_readonly;
    GRANT EXECUTE ON FUNCTION budget_series(int, int, text, text)           TO app_readonly;
    GRANT EXECUTE ON FUNCTION budget_snapshot(int, text, text)              TO app_readonly;
    GRANT EXECUTE ON FUNCTION budget_explorer(int, text, text, text)        TO app_readonly;
    GRANT EXECUTE ON FUNCTION budget_admin_list(int, text, int)             TO app_readonly;
    GRANT EXECUTE ON FUNCTION budget_admin_detail(text, int)                TO app_readonly;
    GRANT EXECUTE ON FUNCTION budget_cofog_list(int, text)                  TO app_readonly;
    GRANT EXECUTE ON FUNCTION budget_variance(int, int)                     TO app_readonly;
    GRANT EXECUTE ON FUNCTION budget_documents(int)                         TO app_readonly;
    GRANT EXECUTE ON FUNCTION budget_personnel_series()                     TO app_readonly;
    GRANT EXECUTE ON FUNCTION budget_muni_list(int, text, int)              TO app_readonly;
    GRANT EXECUTE ON FUNCTION budget_muni_ipop(text, int)                   TO app_readonly;
    GRANT EXECUTE ON FUNCTION budget_muni_capital(int)                      TO app_readonly;
    GRANT EXECUTE ON FUNCTION budget_muni_detail(text, int)                 TO app_readonly;
  END IF;
END $$;
