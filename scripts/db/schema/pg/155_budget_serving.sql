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
    SELECT n.node_id AS "nodeId", n.name_bg AS "nameBg", n.name_en AS "nameEn", n.eik,
           sum(f.planned_eur) AS amount,
           count(*) FILTER (WHERE f.executed_eur IS NOT NULL) > 0 AS "hasExecution"
      FROM budget_admin_node n
      LEFT JOIN budget_admin_fact f
        ON f.node_id = n.node_id AND f.kind = 'expenditure'
       AND (p_fy IS NULL OR f.fiscal_year = p_fy)
     WHERE p_q IS NULL OR p_q = ''
        OR n.name_bg ILIKE '%' || replace(replace(p_q, '%', '\%'), '_', '\_') || '%'
        OR n.name_en ILIKE '%' || replace(replace(p_q, '%', '\%'), '_', '\_') || '%'
     GROUP BY n.node_id, n.name_bg, n.name_en, n.eik
     ORDER BY sum(f.planned_eur) DESC NULLS LAST
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
               FROM (SELECT fiscal_year AS "fiscalYear", kind,
                            planned_eur AS "plannedEur", amended_eur AS "amendedEur",
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
           t.capital_eur AS "capitalEur", t.total_eur AS "totalEur"
      FROM budget_muni_transfer t
      LEFT JOIN place_dim p ON p.code = t.obshtina AND p.kind = 'obshtina'
     WHERE (p_fy IS NULL OR t.fiscal_year = p_fy)
       AND (p_q IS NULL OR p_q = ''
            OR coalesce(p.name_bg, t.name_bg) ILIKE
               '%' || replace(replace(p_q, '%', '\%'), '_', '\_') || '%')
     -- Measured before this line existed: budget_muni_list(2026, NULL, 5)
     -- returned Бургас-01 at EUR 19.98m as #1 and omitted Столична (EUR 718.26m)
     -- and Пловдив entirely.
     ORDER BY t.total_eur DESC NULLS LAST
     LIMIT greatest(1, least(coalesce(p_limit, 300), 1000))
  ) r;
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
    GRANT EXECUTE ON FUNCTION budget_muni_list(int, text, int)              TO app_readonly;
    GRANT EXECUTE ON FUNCTION budget_muni_detail(text, int)                 TO app_readonly;
  END IF;
END $$;
