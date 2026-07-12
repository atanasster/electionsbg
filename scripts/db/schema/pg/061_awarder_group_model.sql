-- Generic sector-pack MODEL over a SET of awarder EIKs — the server-side
-- replacement for the client-side fan-out that the six sector packs (Води/ВСС/
-- Отбрана/НОИ/НЗОК/Култура) do: instead of fetching every contract row for 25+
-- budget units (megabytes) and running buildAwarderModel in the browser, this
-- returns the COMPACT aggregates buildAwarderModelFromAggregates() folds back into
-- the identical AwarderModel — with all CPV→category classification kept in TS
-- (the packs' single source of truth), applied to these buckets, not raw rows.
--
-- Windowed [from, to) with sargable COALESCE bounds (matches scopeByWindow's
-- half-open, string-compared `date >= from && date < to`) so the date guard keeps
-- the awarder_eik index. tag='contract' only — every pack builds on
-- isSpendRow(c, true). Depends on contracts (001) + idx_contracts_awarder.
-- Sums are ROUNDed to whole € and sorts carry an eik/year tiebreak so the payload
-- is byte-deterministic across runs (see reference_pg_payload_determinism).
--
--   npx tsx scripts/db/apply_functions.ts 061_awarder_group_model.sql

SET check_function_bodies = off;
DROP FUNCTION IF EXISTS awarder_group_model(text[], text, text);

CREATE OR REPLACE FUNCTION awarder_group_model(
  p_eiks text[],
  p_from text DEFAULT NULL,
  p_to   text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH base AS (
  SELECT awarder_eik, contractor_eik, contractor_name, amount_eur, cpv,
         procurement_method, number_of_tenderers, date
  FROM contracts
  WHERE awarder_eik = ANY(p_eiks) AND tag = 'contract'
    AND date >= COALESCE(p_from, '')
    AND date <  COALESCE(p_to, '99999999')
),
head AS (
  SELECT
    ROUND(COALESCE(SUM(amount_eur), 0))::double precision           AS "totalEur",
    (COUNT(*))::int                                                 AS "contractCount",
    (COUNT(*) FILTER (WHERE number_of_tenderers IS NOT NULL))::int  AS "bidKnownN",
    (COUNT(*) FILTER (WHERE number_of_tenderers = 1))::int          AS "singleBidN"
  FROM base
),
-- COMPLETE per-contractor rollup — the HHI tile iterates every supplier (Σ share²
-- + the attributed-total denominator), so this is deliberately not top-N capped.
sup AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s."totalEur" DESC, s.eik), '[]'::jsonb) AS arr FROM (
    SELECT contractor_eik AS eik, MIN(contractor_name) AS name,
           ROUND(SUM(amount_eur))::double precision AS "totalEur",
           (COUNT(*))::int AS "contractCount",
           (COUNT(*) FILTER (WHERE number_of_tenderers IS NOT NULL))::int AS "bidKnownN",
           (COUNT(*) FILTER (WHERE number_of_tenderers = 1))::int AS "singleBidN"
    FROM base
    WHERE contractor_eik IS NOT NULL AND contractor_eik <> ''
    GROUP BY contractor_eik
  ) s
),
-- Per-CPV — folded into pack categories client-side (totalEur/count/bid stats).
-- No-CPV rows are kept under cpv='' (NOT dropped): buildAwarderModel classifies
-- EVERY row, and a no-CPV row folds to categoryOf('') = the pack's sink — often
-- a large share of value — so Σ byCpv must reconcile with the headline total.
bycpv AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.cpv), '[]'::jsonb) AS arr FROM (
    SELECT COALESCE(cpv, '') AS cpv,
           ROUND(SUM(amount_eur))::double precision AS "totalEur",
           (COUNT(*))::int AS "contractCount",
           (COUNT(*) FILTER (WHERE number_of_tenderers IS NOT NULL))::int AS "bidKnownN",
           (COUNT(*) FILTER (WHERE number_of_tenderers = 1))::int AS "singleBidN"
    FROM base
    GROUP BY COALESCE(cpv, '')
  ) c
),
-- Per (CPV, contractor) € — folded to a category's distinct-supplier count and
-- its top supplier (the name is looked up from `sup` by eik, not duplicated).
-- No-CPV rows kept under cpv='' too, so the sink category's suppliers are right.
bycpvcon AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.cpv, x.eik), '[]'::jsonb) AS arr FROM (
    SELECT COALESCE(cpv, '') AS cpv, contractor_eik AS eik,
           ROUND(SUM(amount_eur))::double precision AS eur
    FROM base
    WHERE contractor_eik IS NOT NULL AND contractor_eik <> ''
    GROUP BY COALESCE(cpv, ''), contractor_eik
  ) x
),
-- Per procurement method € — folded to directShare via procedureBucket() in TS
-- (its bucketing is substring logic, so it stays authoritative in the client).
bymethod AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.method), '[]'::jsonb) AS arr FROM (
    SELECT procurement_method AS method,
           ROUND(SUM(amount_eur))::double precision AS "totalEur"
    FROM base
    WHERE procurement_method IS NOT NULL AND procurement_method <> ''
    GROUP BY procurement_method
  ) m
),
-- Per year (parseable YYYY > 1990, matching buildAwarderModel's yearOf guard).
byyear AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(y) ORDER BY y.year), '[]'::jsonb) AS arr FROM (
    SELECT (left(date, 4))::int AS year,
           ROUND(SUM(amount_eur))::double precision AS "totalEur",
           (COUNT(*))::int AS "contractCount"
    FROM base
    WHERE date ~ '^\d{4}' AND (left(date, 4))::int > 1990
    GROUP BY left(date, 4)
  ) y
),
-- Per budget unit (awarder EIK) — the operators/units/competition tiles.
byunit AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(u) ORDER BY u."totalEur" DESC NULLS LAST, u.eik), '[]'::jsonb) AS arr FROM (
    SELECT awarder_eik AS eik,
           ROUND(SUM(amount_eur))::double precision AS "totalEur",
           (COUNT(*))::int AS "contractCount",
           (COUNT(*) FILTER (WHERE number_of_tenderers IS NOT NULL))::int AS "bidKnownN",
           (COUNT(*) FILTER (WHERE number_of_tenderers = 1))::int AS "singleBidN"
    FROM base
    GROUP BY awarder_eik
  ) u
)
SELECT jsonb_build_object(
  'totalEur',        head."totalEur",
  'contractCount',   head."contractCount",
  'bidKnownN',       head."bidKnownN",
  'singleBidN',      head."singleBidN",
  'suppliers',       sup.arr,
  'byCpv',           bycpv.arr,
  'byCpvContractor', bycpvcon.arr,
  'byMethod',        bymethod.arr,
  'byYear',          byyear.arr,
  'byUnit',          byunit.arr
)
FROM head, sup, bycpv, bycpvcon, bymethod, byyear, byunit;
$$;

GRANT EXECUTE ON FUNCTION awarder_group_model(text[], text, text) TO app_readonly;
