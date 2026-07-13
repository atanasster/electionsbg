-- Per-INN QUARTERLY drug-reimbursement series (2023-Q1 →) — the multi-period drug
-- trend line the single-year competitor (Диагноза България) structurally cannot
-- show. The annual roll-up (drug_reimbursement.json) already ships a YoY-movers
-- slice; this table is the full quarterly trajectory per molecule, so the pack can
-- draw a therapy's НЗОК spend climbing or falling quarter by quarter.
--
-- Source = the nhif.bg quarterly "Брутни разходи по INN" files (per-quarter, not
-- cumulative), parsed by scripts/nzok/write_drug_quarterly.ts. Money is euros
-- (BGN converted at 1.95583 through 2025; the 2026-Q1 file is EUR-native). Grain
-- is (INN × quarter); `quarter` is "YYYY-Qn" so byte order == chronological order.

CREATE TABLE IF NOT EXISTS nzok_drug_quarterly (
  inn      text NOT NULL,
  atc      text,
  quarter  text NOT NULL,          -- "YYYY-Qn"
  eur      double precision NOT NULL,
  PRIMARY KEY (inn, quarter)
);

-- One molecule's series (picker drill-down) + the leaderboard's per-INN series.
CREATE INDEX IF NOT EXISTS idx_nzok_drug_q_inn ON nzok_drug_quarterly (inn, quarter);
-- Per-quarter national rollup.
CREATE INDEX IF NOT EXISTS idx_nzok_drug_q_quarter ON nzok_drug_quarterly (quarter);

-- Overview: the quarter axis, the national total per quarter, and the top-N INNs
-- by total reimbursement — each with its full quarterly series + a latest-year-vs-
-- prior-year delta (four-quarter windows, so a partial newest quarter can't
-- distort the % the way a single-quarter YoY would). Determinism: ROUND before
-- ordering, COLLATE "C" text sort keys, explicit tiebreaks, NULL on empty.
CREATE OR REPLACE FUNCTION nzok_drug_quarterly_overview()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH q AS (SELECT DISTINCT quarter FROM nzok_drug_quarterly),
  qs AS (SELECT array_agg(quarter ORDER BY quarter COLLATE "C") AS arr FROM q),
  -- The four most recent quarters (latest year) and the four before them, for a
  -- rolling-year growth number per molecule.
  latest4 AS (SELECT quarter FROM q ORDER BY quarter COLLATE "C" DESC LIMIT 4),
  prev4   AS (SELECT quarter FROM q ORDER BY quarter COLLATE "C" DESC OFFSET 4 LIMIT 4),
  -- A rolling-year YoY needs BOTH four-quarter windows full. With < 8 quarters
  -- (a partial re-ingest, a fresh `--from` cut) prev4 sums only 1–3 quarters, so
  -- ly/py inflates every molecule's growth — and the `py_eur = 0` guard doesn't
  -- catch a short-but-nonzero prior window. Gate YoY on ≥ 8 distinct quarters.
  have_yoy AS (SELECT count(*) >= 8 AS ok FROM q),
  tot AS (
    SELECT inn,
           min(atc COLLATE "C") FILTER (WHERE atc IS NOT NULL AND atc <> '') AS atc,
           SUM(eur) AS total_eur,
           SUM(eur) FILTER (WHERE quarter IN (SELECT quarter FROM latest4)) AS ly_eur,
           SUM(eur) FILTER (WHERE quarter IN (SELECT quarter FROM prev4))   AS py_eur
    FROM nzok_drug_quarterly GROUP BY inn
  ),
  topn AS (
    SELECT * FROM tot ORDER BY ROUND(total_eur) DESC, inn COLLATE "C" LIMIT 24
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM q) THEN NULL ELSE jsonb_build_object(
    'quarters', (SELECT to_jsonb(arr) FROM qs),
    -- Every INN name (folded form as stored), ascending — the search list the
    -- picker filters client-side to drill into any molecule beyond the top-N.
    'allInns', (
      SELECT jsonb_agg(inn ORDER BY inn COLLATE "C")
      FROM (SELECT DISTINCT inn FROM nzok_drug_quarterly) d
    ),
    'national', (
      SELECT jsonb_agg(jsonb_build_object('quarter', quarter, 'eur', ROUND(e)::bigint)
                       ORDER BY quarter COLLATE "C")
      FROM (SELECT quarter, SUM(eur) AS e FROM nzok_drug_quarterly GROUP BY quarter) n
    ),
    'top', (
      SELECT jsonb_agg(jsonb_build_object(
               'inn',       t.inn,
               'atc',       t.atc,
               'atcGroup',  upper(left(coalesce(t.atc,''), 1)),
               'totalEur',  ROUND(t.total_eur)::bigint,
               'latestYearEur', ROUND(t.ly_eur)::bigint,
               'priorYearEur',  CASE WHEN NOT (SELECT ok FROM have_yoy)
                                          OR t.py_eur IS NULL OR t.py_eur = 0 THEN NULL
                                     ELSE ROUND(t.py_eur)::bigint END,
               'yoyDelta',  CASE WHEN NOT (SELECT ok FROM have_yoy)
                                      OR t.py_eur IS NULL OR t.py_eur = 0 THEN NULL
                                 ELSE ROUND((t.ly_eur / t.py_eur - 1)::numeric, 4) END,
               'series', (
                 SELECT jsonb_agg(jsonb_build_object('quarter', quarter, 'eur', ROUND(eur)::bigint)
                                  ORDER BY quarter COLLATE "C")
                 FROM nzok_drug_quarterly d WHERE d.inn = t.inn))
             ORDER BY ROUND(t.total_eur) DESC, t.inn COLLATE "C")
      FROM topn t)
  ) END;
$$;

-- One molecule's full quarterly series (the searchable picker drill-down). NULL
-- when the INN has no rows. Stored INNs are Cyrillic-homoglyph FOLDED (write_drug_
-- quarterly.ts normInn: upper-case + Cyrillic lookalikes → Latin), so the lookup
-- must apply the SAME fold — a bare upper() would miss a free-text query typed with
-- a Cyrillic "Р"/"С"/… . `translate()` mirrors normInn's CYR2LAT map.
CREATE OR REPLACE FUNCTION nzok_drug_quarterly_by_inn(p_inn text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH key AS (
    SELECT translate(upper(p_inn), 'АВЕКМНОРСТУХ', 'ABEKMHOPCTYX') AS k
  ),
  r AS (SELECT * FROM nzok_drug_quarterly WHERE inn = (SELECT k FROM key))
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM r) THEN NULL ELSE jsonb_build_object(
    'inn',      (SELECT k FROM key),
    'atc',      (SELECT min(atc COLLATE "C") FILTER (WHERE atc IS NOT NULL AND atc <> '') FROM r),
    'totalEur', (SELECT ROUND(SUM(eur))::bigint FROM r),
    'series',   (SELECT jsonb_agg(jsonb_build_object('quarter', quarter, 'eur', ROUND(eur)::bigint)
                                  ORDER BY quarter COLLATE "C") FROM r)
  ) END;
$$;
