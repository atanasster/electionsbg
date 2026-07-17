-- Entity risk GRADE (A–F) — a Hlídač-státu-style composite over the risk
-- components we can compute cleanly from PG, for a body acting as a BUYER
-- (awarder_risk_grade) and as a SUPPLIER (supplier_risk_grade). Extends the
-- single-component awarder_kindex (039, political-connection share) into a
-- multi-component, share-of-value-weighted grade.
--
-- Components (each a 0..1 share of the entity's contracted value; a component is
-- "unavailable" and dropped from the weighted mean when its denominator is 0):
--   BUYER:    connection (value to politically-linked suppliers) · singleBid
--             (value on 1-bidder awards, over bid-known value) · direct (value on
--             direct/negotiated-without-notice procedures) · concentration
--             (top-1 supplier's share of the buyer's spend).
--   SUPPLIER: connectedSelf (0/1 — the company is itself politically linked) ·
--             singleBid · direct · buyerConcentration (top-1 buyer's share of the
--             company's revenue — dependence on one client).
--
-- Grade bands on the 0..100 composite: A <10, B <25, C <40, D <55, E <70, F ≥70.
-- The grade is EXPOSURE, not proof — a documentation/pattern signal, footnoted
-- as such in the UI. "open" = procedureBucket()'s definition (Открита процедура
-- / OCDS "open"); everything else with a rationale or a пряко/без-обявление
-- method counts as direct award — mirrors src/lib/cpvSectors.ts.
--
-- Depends on contracts (001) + company_politicians (008). EXECUTE auto-granted
-- to app_readonly via ALTER DEFAULT PRIVILEGES.

SET check_function_bodies = off;

-- Shared band helper: 0..100 composite → letter grade.
CREATE OR REPLACE FUNCTION risk_grade_letter(p_score numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_score IS NULL THEN NULL
    WHEN p_score < 10 THEN 'A'
    WHEN p_score < 25 THEN 'B'
    WHEN p_score < 40 THEN 'C'
    WHEN p_score < 55 THEN 'D'
    WHEN p_score < 70 THEN 'E'
    ELSE 'F'
  END;
$$;

-- A method string is a "direct award" (no open advert) — SQL mirror of
-- procedureBucket()==='direct': OCDS limited/direct, an explicit rationale, or a
-- пряко / без обявление / без публикуване / договаряне без phrase.
CREATE OR REPLACE FUNCTION is_direct_award(p_method text, p_rationale text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_rationale IS NOT NULL AND p_rationale <> ''
      OR lower(coalesce(p_method,'')) IN ('limited','direct')
      OR lower(coalesce(p_method,'')) ~ 'пряко|без обявление|без публикуване|договаряне без';
$$;

-- Per-buyer КЗК merits-appeal rollup — the ONLY authoritative (regulator-ruled)
-- integrity signal, folded into the buyer grade. Kept in a dedicated table (NOT
-- a direct kzk_appeals reference) so the ranking matview + the per-entity
-- function can both read it WITHOUT a cross-loader ordering hazard (kzk_appeals
-- lives in migration 042, a different loader). Created here, empty by default →
-- zero effect until the manual КЗК ingest (kzk_appeals.ts --apply) populates it
-- and refreshes the ranking. `decided` = merits rulings (уважена+отхвърлена),
-- `upheld` = уважена (buyer's decision annulled).
CREATE TABLE IF NOT EXISTS buyer_appeal_stats (
  buyer_eik text PRIMARY KEY,
  decided   int NOT NULL DEFAULT 0,
  upheld    int NOT NULL DEFAULT 0
);
GRANT SELECT ON buyer_appeal_stats TO app_readonly;

-- Smoothed upheld rate: upheld / max(decided, 3) — a 3-appeal prior so a lone
-- 1-of-1 upheld reads 0.33, not a noisy 1.0; a systematic pattern still →1.0.
-- Available only when the buyer has ≥1 merits ruling (else the component is
-- dropped from the weighted mean, like single-bid when bid counts are unknown).
CREATE OR REPLACE FUNCTION upheld_appeal_share(p_decided int, p_upheld int)
RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN COALESCE(p_decided,0) >= 1
    THEN p_upheld::double precision / GREATEST(p_decided, 3) END;
$$;

-- ===========================================================================
-- CANONICAL BUYER-GRADE WEIGHTS — the single source of truth, and the ONLY copy.
--   connection .35 · singleBid .25 · direct .20 · concentration .20 · upheldAppeal .30
--
-- Both consumers call this helper: awarder_risk_grade(text) [per-entity] and
-- awarder_risk_grade_window(text,text) [the windowed ranking — the matview AND
-- the per-scope table both derive from it]. Change a weight HERE and both move
-- together; there is nothing to keep in lockstep by hand.
--
-- (An earlier revision inlined these five numerics in both bodies, on the
-- premise that "no way to share an expression across a STABLE fn and a
-- set-returning fn" — that was wrong. A scalar SQL function over scalars is
-- exactly what risk_grade_letter() and upheld_appeal_share() already are, and
-- both bodies already call those. IMMUTABLE + LANGUAGE sql means PG inlines it,
-- so the query plans are unchanged.)
--
-- Availability-weighted MEAN, not a sum: the denominator only counts weights
-- whose component is non-NULL, so an unavailable component is DROPPED, not
-- scored 0. Weights total 1.30 when all five are present. Band cutoffs are
-- centralized in risk_grade_letter(); the kzk.harness.ts parity test locks
-- fn==matview.
--
-- All five args are double precision — every share is a
-- double-precision/double-precision ratio (contracts.amount_eur is double
-- precision, 001) and upheld_appeal_share() returns double precision. The
-- numeric weight literals promote to double precision in the numerator and stay
-- numeric in the denominator, exactly as when this was inlined.
-- ===========================================================================
CREATE OR REPLACE FUNCTION awarder_risk_grade_frac(
  p_connection double precision,
  p_single     double precision,
  p_direct     double precision,
  p_conc       double precision,
  p_upheld     double precision
) RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT
    ( 0.35 * COALESCE(p_connection, 0)
    + 0.25 * COALESCE(p_single, 0)
    + 0.20 * COALESCE(p_direct, 0)
    + 0.20 * COALESCE(p_conc, 0)
    + 0.30 * COALESCE(p_upheld, 0)
    ) / NULLIF(
      0.35 * (p_connection IS NOT NULL)::int
    + 0.25 * (p_single IS NOT NULL)::int
    + 0.20 * (p_direct IS NOT NULL)::int
    + 0.20 * (p_conc IS NOT NULL)::int
    + 0.30 * (p_upheld IS NOT NULL)::int, 0);
$$;
-- ===========================================================================
-- BUYER grade.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS awarder_risk_grade(text);
CREATE OR REPLACE FUNCTION awarder_risk_grade(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH base AS (
  SELECT contractor_eik, amount_eur, number_of_tenderers,
         procurement_method, procurement_method_rationale
  FROM contracts
  WHERE awarder_eik = p_eik AND tag = 'contract'
    AND contractor_eik IS NOT NULL AND amount_eur IS NOT NULL AND amount_eur > 0
),
agg AS (
  SELECT
    COALESCE(SUM(amount_eur), 0)                                   AS total_eur,
    COUNT(*)::int                                                  AS n,
    COALESCE(SUM(amount_eur) FILTER (
      WHERE is_direct_award(procurement_method, procurement_method_rationale)), 0) AS direct_eur,
    COALESCE(SUM(amount_eur) FILTER (WHERE number_of_tenderers = 1), 0)            AS single_eur,
    COALESCE(SUM(amount_eur) FILTER (WHERE number_of_tenderers IS NOT NULL), 0)    AS bidknown_eur
  FROM base
),
by_supplier AS (
  SELECT contractor_eik, SUM(amount_eur) AS eur FROM base GROUP BY contractor_eik
),
conc AS (
  SELECT COALESCE(MAX(eur), 0) AS top1_eur, COUNT(*)::int AS supplier_count FROM by_supplier
),
linked AS (
  SELECT COALESCE(SUM(b.amount_eur), 0) AS linked_eur,
         COUNT(DISTINCT b.contractor_eik)::int AS linked_n
  FROM base b
  WHERE EXISTS (SELECT 1 FROM company_politicians cp WHERE cp.eik = b.contractor_eik)
),
appeal AS (
  SELECT upheld_appeal_share(bs.decided, bs.upheld) AS upheld_share,
         COALESCE(bs.decided, 0) AS decided, COALESCE(bs.upheld, 0) AS upheld
  FROM (SELECT 1) one
  LEFT JOIN buyer_appeal_stats bs ON bs.buyer_eik = p_eik
),
comp AS (
  SELECT
    a.total_eur, a.n, c.supplier_count, l.linked_eur, l.linked_n,
    ap.upheld_share, ap.decided, ap.upheld,
    CASE WHEN a.total_eur > 0 THEN l.linked_eur   / a.total_eur END AS connection_share,
    CASE WHEN a.bidknown_eur > 0 THEN a.single_eur / a.bidknown_eur END AS single_share,
    CASE WHEN a.total_eur > 0 THEN a.direct_eur   / a.total_eur END AS direct_share,
    CASE WHEN a.total_eur > 0 THEN c.top1_eur      / a.total_eur END AS conc_share
  FROM agg a, conc c, linked l, appeal ap
),
scored AS (
  -- Canonical weights + availability-weighted mean: awarder_risk_grade_frac().
  -- КЗК-upheld appeals are authoritative but sparse, so that component only
  -- enters when the buyer has a ruling (NULL ⇒ dropped from the mean).
  SELECT *, awarder_risk_grade_frac(
    connection_share, single_share, direct_share, conc_share, upheld_share
  ) AS frac
  FROM comp
)
SELECT CASE WHEN total_eur <= 0 THEN NULL ELSE jsonb_build_object(
  'role', 'buyer',
  'totalEur', ROUND(total_eur),
  'contractCount', n,
  'supplierCount', supplier_count,
  'linkedEur', ROUND(linked_eur),
  'linkedSupplierCount', linked_n,
  'appealsDecided', decided,
  'appealsUpheld', upheld,
  'score', ROUND(100 * frac),
  'grade', risk_grade_letter(ROUND(100 * frac)::numeric),  -- band the DISPLAYED (rounded) score
  'components', jsonb_build_array(
    jsonb_build_object('key','connection','share', ROUND(connection_share::numeric,4),'available', connection_share IS NOT NULL),
    jsonb_build_object('key','singleBid','share', ROUND(single_share::numeric,4),'available', single_share IS NOT NULL),
    jsonb_build_object('key','direct','share', ROUND(direct_share::numeric,4),'available', direct_share IS NOT NULL),
    jsonb_build_object('key','concentration','share', ROUND(conc_share::numeric,4),'available', conc_share IS NOT NULL),
    jsonb_build_object('key','upheldAppeal','share', ROUND(upheld_share::numeric,4),'available', upheld_share IS NOT NULL)
  )
) END
FROM scored;
$$;

-- ---------------------------------------------------------------------------
-- SUPPLIER grade.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS supplier_risk_grade(text);
CREATE OR REPLACE FUNCTION supplier_risk_grade(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH base AS (
  SELECT awarder_eik, amount_eur, number_of_tenderers,
         procurement_method, procurement_method_rationale
  FROM contracts
  WHERE contractor_eik = p_eik AND tag = 'contract'
    AND awarder_eik IS NOT NULL AND amount_eur IS NOT NULL AND amount_eur > 0
),
agg AS (
  SELECT
    COALESCE(SUM(amount_eur), 0)                                   AS total_eur,
    COUNT(*)::int                                                  AS n,
    COALESCE(SUM(amount_eur) FILTER (
      WHERE is_direct_award(procurement_method, procurement_method_rationale)), 0) AS direct_eur,
    COALESCE(SUM(amount_eur) FILTER (WHERE number_of_tenderers = 1), 0)            AS single_eur,
    COALESCE(SUM(amount_eur) FILTER (WHERE number_of_tenderers IS NOT NULL), 0)    AS bidknown_eur
  FROM base
),
by_buyer AS (
  SELECT awarder_eik, SUM(amount_eur) AS eur FROM base GROUP BY awarder_eik
),
conc AS (
  SELECT COALESCE(MAX(eur), 0) AS top1_eur, COUNT(*)::int AS buyer_count FROM by_buyer
),
self_linked AS (
  SELECT EXISTS (SELECT 1 FROM company_politicians cp WHERE cp.eik = p_eik) AS is_linked
),
comp AS (
  SELECT
    a.total_eur, a.n, c.buyer_count, s.is_linked,
    CASE WHEN s.is_linked THEN 1.0 ELSE 0.0 END::double precision AS connected_share,
    CASE WHEN a.bidknown_eur > 0 THEN a.single_eur / a.bidknown_eur END AS single_share,
    CASE WHEN a.total_eur > 0 THEN a.direct_eur   / a.total_eur END AS direct_share,
    CASE WHEN a.total_eur > 0 THEN c.top1_eur      / a.total_eur END AS conc_share
  FROM agg a, conc c, self_linked s
),
scored AS (
  SELECT *,
    ( 0.30 * connected_share
    + 0.25 * COALESCE(single_share, 0)
    + 0.20 * COALESCE(direct_share, 0)
    + 0.25 * COALESCE(conc_share, 0)
    ) / NULLIF(
      0.30
    + 0.25 * (single_share IS NOT NULL)::int
    + 0.20 * (direct_share IS NOT NULL)::int
    + 0.25 * (conc_share IS NOT NULL)::int, 0) AS frac
  FROM comp
)
SELECT CASE WHEN total_eur <= 0 THEN NULL ELSE jsonb_build_object(
  'role', 'supplier',
  'totalEur', ROUND(total_eur),
  'contractCount', n,
  'buyerCount', buyer_count,
  'connected', is_linked,
  'score', ROUND(100 * frac),
  'grade', risk_grade_letter(ROUND(100 * frac)::numeric),  -- band the DISPLAYED (rounded) score
  'components', jsonb_build_array(
    jsonb_build_object('key','connectedSelf','share', ROUND(connected_share::numeric,4),'available', true),
    jsonb_build_object('key','singleBid','share', ROUND(single_share::numeric,4),'available', single_share IS NOT NULL),
    jsonb_build_object('key','direct','share', ROUND(direct_share::numeric,4),'available', direct_share IS NOT NULL),
    jsonb_build_object('key','buyerConcentration','share', ROUND(conc_share::numeric,4),'available', conc_share IS NOT NULL)
  )
) END
FROM scored;
$$;

-- ---------------------------------------------------------------------------
-- BUYER risk-grade RANKING — the corpus-wide "riskiest institutions" leaderboard.
-- Same components + weights as awarder_risk_grade() (kept in lockstep — a change
-- there must change here). A volume floor keeps tiny buyers (whose one contract
-- is trivially 100% concentrated) out of the top. Materialised: a full grouped
-- scan of contracts is too heavy for a live page — REFRESHed after contract +
-- link loads (load_pg.ts), exactly like awarder_kindex_ranking.
-- ---------------------------------------------------------------------------
-- The ranking FORMULA as a windowed function — the single source for BOTH the
-- corpus matview and the per-scope precompute table (p_from/p_to NULL = the full
-- corpus). Keeping it in one place also removes the fn-vs-matview weight copy.
DROP MATERIALIZED VIEW IF EXISTS awarder_risk_grade_ranking CASCADE;
-- p_from/p_to are ISO date TEXT (contracts.date is text) — lexical compare is
-- equivalent to a date compare for YYYY-MM-DD. NULL = unbounded.
DROP FUNCTION IF EXISTS awarder_risk_grade_window(date, date) CASCADE;
DROP FUNCTION IF EXISTS awarder_risk_grade_window(text, text) CASCADE;
CREATE FUNCTION awarder_risk_grade_window(p_from text, p_to text)
RETURNS TABLE (
  eik text, name text, total_eur numeric, supplier_count int, linked_eur numeric,
  score int, grade text, connection_share numeric, single_share numeric,
  direct_share numeric, conc_share numeric, upheld_share numeric
) LANGUAGE sql STABLE AS $fn$
WITH linked_eiks AS (SELECT DISTINCT eik FROM company_politicians),
rows AS (
  SELECT c.awarder_eik, c.awarder_name, c.contractor_eik, c.amount_eur,
         c.number_of_tenderers,
         is_direct_award(c.procurement_method, c.procurement_method_rationale) AS is_direct,
         (le.eik IS NOT NULL) AS linked
  FROM contracts c
  LEFT JOIN linked_eiks le ON le.eik = c.contractor_eik
  WHERE c.tag = 'contract' AND c.amount_eur > 0
    AND c.awarder_eik IS NOT NULL AND c.contractor_eik IS NOT NULL
    AND (p_from IS NULL OR c.date >= p_from)
    AND (p_to   IS NULL OR c.date <  p_to)
),
per_pair AS (
  SELECT awarder_eik, contractor_eik, SUM(amount_eur) AS pair_eur FROM rows GROUP BY 1, 2
),
conc AS (
  SELECT awarder_eik, SUM(pair_eur) AS total_eur, MAX(pair_eur) AS top1_eur,
         COUNT(*)::int AS supplier_count
  FROM per_pair GROUP BY awarder_eik
),
metrics AS (
  -- COALESCE the filtered sums to 0 (a FILTER SUM with no matching rows is NULL,
  -- not 0) so connection/direct/concentration are always "available" — exactly
  -- as awarder_risk_grade() does. Without this a data-poor buyer would drop those
  -- components and score 100 off its one known signal.
  SELECT awarder_eik, MIN(awarder_name COLLATE "C") AS name,
    COALESCE(SUM(amount_eur), 0)                                          AS total_eur,
    COALESCE(SUM(amount_eur) FILTER (WHERE is_direct), 0)                 AS direct_eur,
    COALESCE(SUM(amount_eur) FILTER (WHERE number_of_tenderers = 1), 0)   AS single_eur,
    COALESCE(SUM(amount_eur) FILTER (WHERE number_of_tenderers IS NOT NULL), 0) AS bidknown_eur,
    COALESCE(SUM(amount_eur) FILTER (WHERE linked), 0)                    AS linked_eur
  FROM rows GROUP BY awarder_eik
),
computed AS (
  SELECT m.awarder_eik AS eik, m.name, m.total_eur, c.supplier_count, m.linked_eur,
    -- upheld-appeal share is an ALL-TIME signal (buyer_appeal_stats isn't
    -- windowed — appeals are sparse); the contract-based components DO window.
    upheld_appeal_share(bs.decided, bs.upheld) AS upheld_share,
    CASE WHEN m.total_eur > 0 THEN m.linked_eur   / m.total_eur END AS connection_share,
    CASE WHEN m.bidknown_eur > 0 THEN m.single_eur / m.bidknown_eur END AS single_share,
    CASE WHEN m.total_eur > 0 THEN m.direct_eur   / m.total_eur END AS direct_share,
    CASE WHEN c.total_eur > 0 THEN c.top1_eur      / c.total_eur END AS conc_share
  FROM metrics m JOIN conc c USING (awarder_eik)
  LEFT JOIN buyer_appeal_stats bs ON bs.buyer_eik = m.awarder_eik
),
scored AS (
  -- Same canonical weights as awarder_risk_grade() — literally the same helper.
  SELECT *, awarder_risk_grade_frac(
    connection_share, single_share, direct_share, conc_share, upheld_share
  ) AS frac
  FROM computed
)
SELECT eik, name,
       ROUND(total_eur)                       AS total_eur,
       supplier_count,
       ROUND(linked_eur)                      AS linked_eur,
       ROUND((100 * frac))::int               AS score,
       risk_grade_letter(ROUND(100 * frac)::numeric) AS grade,  -- band the DISPLAYED (rounded) score
       ROUND(connection_share::numeric, 4)    AS connection_share,
       ROUND(single_share::numeric, 4)        AS single_share,
       ROUND(direct_share::numeric, 4)        AS direct_share,
       ROUND(conc_share::numeric, 4)          AS conc_share,
       ROUND(upheld_share::numeric, 4)        AS upheld_share
FROM scored
WHERE total_eur >= 1000000        -- €1M volume floor (bigger than the kindex €500k;
  AND frac IS NOT NULL            -- the grade leaderboard is about material buyers)
ORDER BY frac DESC NULLS LAST, total_eur DESC, eik;  -- eik tiebreak = deterministic order
$fn$;

-- Corpus-wide leaderboard (all-years), materialised + REFRESHed on contract load.
CREATE MATERIALIZED VIEW awarder_risk_grade_ranking AS
  SELECT * FROM awarder_risk_grade_window(NULL, NULL);

CREATE INDEX IF NOT EXISTS idx_awarder_risk_grade_score
  ON awarder_risk_grade_ranking (score DESC);
GRANT SELECT ON awarder_risk_grade_ranking TO app_readonly;

-- Per-scope precomputed leaderboards so the tile follows the /procurement pscope
-- selector (all / y:<year> / ns:<election>) WITHOUT a ~330ms live windowed scan
-- per view. Populated by the loader (load_pg), which enumerates the exact scope
-- windows the UI's useScopeWindow produces and runs awarder_risk_grade_window
-- for each. scope_key: 'all' | 'y:2024' | 'ns:2026_04_19'.
CREATE TABLE IF NOT EXISTS awarder_risk_grade_scoped (
  scope_key text NOT NULL,
  eik text NOT NULL,
  name text,
  total_eur numeric,
  supplier_count int,
  linked_eur numeric,
  score int,
  grade text,
  connection_share numeric,
  single_share numeric,
  direct_share numeric,
  conc_share numeric,
  upheld_share numeric,
  PRIMARY KEY (scope_key, eik)
);
CREATE INDEX IF NOT EXISTS idx_arg_scoped_key_score
  ON awarder_risk_grade_scoped (scope_key, score DESC);
GRANT SELECT ON awarder_risk_grade_scoped TO app_readonly;

-- Top-N getter for the leaderboard tile (jsonb, one round-trip). p_scope selects
-- the precomputed window ('all' default); optional grade floor via p_min_score.
DROP FUNCTION IF EXISTS awarder_risk_grade_top(int, int);
DROP FUNCTION IF EXISTS awarder_risk_grade_top(text, int, int);
CREATE FUNCTION awarder_risk_grade_top(p_scope text DEFAULT 'all', p_limit int DEFAULT 20, p_min_score int DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  -- Scope keys are precomputed at load time; a NEW election (default pscope
  -- ns:<new>) or a year rollover (y:2027) has no key until the next load. Fall
  -- back to 'all' when the requested key isn't present so the tile shows the
  -- corpus leaderboard instead of silently rendering empty (FINDING-009).
  -- Returns { requested, scope, rows } — `scope` is the EFFECTIVE key served;
  -- when it differs from `requested` the FE knows a fallback happened and can
  -- badge/hide rather than mislabel corpus leaders as the selected scope (F-008).
  WITH eff AS (
    SELECT CASE
             WHEN EXISTS (SELECT 1 FROM awarder_risk_grade_scoped WHERE scope_key = p_scope)
             THEN p_scope ELSE 'all' END AS k
  )
  SELECT jsonb_build_object(
    'requested', p_scope,
    'scope', (SELECT k FROM eff),
    'rows', COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
  )
  FROM (
    SELECT eik, name,
           total_eur AS "totalEur",
           supplier_count AS "supplierCount",
           linked_eur AS "linkedEur",
           score, grade,
           connection_share AS "connectionShare",
           single_share AS "singleShare",
           direct_share AS "directShare",
           conc_share AS "concShare",
           upheld_share AS "upheldShare"
    FROM awarder_risk_grade_scoped, eff
    WHERE scope_key = eff.k AND score >= GREATEST(0, p_min_score)
    ORDER BY score DESC, total_eur DESC, eik   -- eik tiebreak = deterministic top-N
    LIMIT GREATEST(1, LEAST(p_limit, 200))
  ) x;
$$;
