-- By-place procurement for /procurement/by-settlement (+ the per-settlement
-- detail page). Local-tier buyers (municipalities, schools, hospitals,
-- universities, forestry, regional gov, utilities) are grouped by their seat
-- settlement; central ministries/agencies (geo-resolved but is_local_hq=false)
-- collapse into one "national" card; name-only-resolved awarders are dropped —
-- exactly the offline by_settlement.ts split, now that awarder_seats carries the
-- tier (030 depends on the is_local_hq column, load_awarder_seats_pg). Window
-- [from, to) or full corpus. oblast/settlement/obshtina are the awarder_seats
-- names; the client folds province → oblast for the choropleth (unchanged).
-- Depends on contracts (001) + awarder_seats (021 w/ tier). EXECUTE → app_readonly.

SET check_function_bodies = off;

-- Landing index: every settlement with ≥1 local-tier contract + the national card.
DROP FUNCTION IF EXISTS procurement_by_settlement(text, text);
CREATE OR REPLACE FUNCTION procurement_by_settlement(
  p_from text DEFAULT NULL,
  p_to text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH geo AS (
  SELECT eik, ekatte, settlement, municipality, oblast, is_local_hq
  FROM awarder_seats WHERE source = 'geo'
),
c AS (
  SELECT g.ekatte, g.settlement, g.municipality, g.oblast, g.is_local_hq, g.eik,
         ct.tag, ct.amount_eur, ct.amount, ct.currency
  FROM contracts ct JOIN geo g ON g.eik = ct.awarder_eik
  WHERE (p_from IS NULL OR ct.date >= p_from)
    AND (p_to   IS NULL OR ct.date <  p_to)
),
sett AS (
  SELECT ekatte, MIN(settlement) AS name, MIN(oblast) AS province,
         MIN(municipality) AS obshtina,
         (COUNT(*) FILTER (WHERE tag = 'contract'))::int AS contract_count,
         COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract'), 0) AS total_eur,
         (COUNT(DISTINCT eik) FILTER (WHERE tag = 'contract'))::int AS awarder_count
  FROM c WHERE is_local_hq GROUP BY ekatte
  HAVING COUNT(*) FILTER (WHERE tag = 'contract') > 0
),
nat AS (
  SELECT (COUNT(*) FILTER (WHERE tag = 'contract'))::int AS contract_count,
         (COUNT(*) FILTER (WHERE tag = 'award'))::int AS award_count,
         COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract'), 0) AS total_eur,
         (COUNT(DISTINCT eik) FILTER (WHERE tag = 'contract'))::int AS awarder_count
  FROM c WHERE NOT is_local_hq
),
nat_other AS (
  SELECT COALESCE(jsonb_object_agg(cur, s), '{}'::jsonb) AS o FROM (
    SELECT currency AS cur, ROUND(SUM(amount)) AS s FROM c
    WHERE NOT is_local_hq AND tag = 'contract'
      AND currency IS NOT NULL AND amount IS NOT NULL
    GROUP BY currency
  ) x
)
SELECT jsonb_build_object(
  'generatedAt', '',
  -- Headline totals are the LOCAL settlements only (= sum of settlements[]); the
  -- national card is reported separately, not folded into totalEur/Contracts.
  'totalContracts', (SELECT (COUNT(*) FILTER (WHERE tag = 'contract' AND is_local_hq))::int FROM c),
  'totalEur', (SELECT COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract' AND is_local_hq), 0) FROM c),
  'settlementCount', (SELECT count(*) FROM sett),
  'national', jsonb_build_object(
    'contractCount', nat.contract_count, 'awardCount', nat.award_count,
    'totalEur', nat.total_eur, 'totalOther', nat_other.o,
    'awarderCount', nat.awarder_count),
  'settlements', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'ekatte', ekatte, 'name', name, 'province', province, 'obshtina', obshtina,
      'contractCount', contract_count, 'totalEur', total_eur,
      'awarderCount', awarder_count) ORDER BY total_eur DESC)
    FROM sett), '[]'::jsonb)
) FROM nat, nat_other;
$$;

-- Per-settlement detail (SettlementProcurementFile): the local-tier awarders
-- seated in this EKATTE, their spend, top contracts + by-year.
DROP FUNCTION IF EXISTS procurement_settlement_detail(text, text, text);
CREATE OR REPLACE FUNCTION procurement_settlement_detail(
  p_ekatte text, p_from text DEFAULT NULL, p_to text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH seats AS (
  SELECT eik, tier, settlement, municipality, oblast
  FROM awarder_seats
  WHERE source = 'geo' AND is_local_hq AND ekatte = p_ekatte
),
c AS (
  SELECT ct.* FROM contracts ct JOIN seats s ON s.eik = ct.awarder_eik
  WHERE (p_from IS NULL OR ct.date >= p_from)
    AND (p_to   IS NULL OR ct.date <  p_to)
),
aw AS (
  SELECT c.awarder_eik AS eik, MIN(c.awarder_name) AS name,
         (SELECT tier FROM seats s WHERE s.eik = c.awarder_eik) AS tier,
         COALESCE(SUM(c.amount_eur) FILTER (WHERE c.tag = 'contract'), 0) AS total_eur,
         (COUNT(*) FILTER (WHERE c.tag = 'contract'))::int AS contract_count,
         (COUNT(*) FILTER (WHERE c.tag = 'award'))::int AS award_count
  FROM c GROUP BY c.awarder_eik
),
byyr AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(y) ORDER BY y.year), '[]'::jsonb) AS arr FROM (
    SELECT left(date, 4) AS year,
           COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract'), 0) AS "totalEur",
           '{}'::jsonb AS "totalOther",
           (COUNT(*) FILTER (WHERE tag = 'contract'))::int AS "contractCount"
    FROM c WHERE tag = 'contract' GROUP BY left(date, 4)
  ) y
),
topc AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t."amountEur" DESC NULLS LAST), '[]'::jsonb) AS arr FROM (
    SELECT key, ocid, date, tag, amount, currency, amount_eur AS "amountEur",
           contractor_eik AS "partyEik", contractor_name AS "partyName",
           title, awarder_eik AS "awarderEik", awarder_name AS "awarderName",
           bundle_uuid AS "bundleUuid", source_url AS "sourceUrl"
    FROM c WHERE tag = 'contract' ORDER BY amount_eur DESC NULLS LAST LIMIT 20
  ) t
)
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM seats) THEN NULL ELSE jsonb_build_object(
  'ekatte', p_ekatte,
  'name', (SELECT MIN(settlement) FROM seats),
  'province', (SELECT MIN(oblast) FROM seats),
  'obshtina', (SELECT MIN(municipality) FROM seats),
  'generatedAt', '',
  'contractCount', (SELECT (COUNT(*) FILTER (WHERE tag = 'contract'))::int FROM c),
  'awardCount', (SELECT (COUNT(*) FILTER (WHERE tag = 'award'))::int FROM c),
  'totalEur', (SELECT COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract'), 0) FROM c),
  'totalOther', COALESCE((SELECT jsonb_object_agg(cur, s) FROM (
     SELECT currency AS cur, ROUND(SUM(amount)) AS s FROM c
     WHERE tag = 'contract' AND currency IS NOT NULL AND amount IS NOT NULL
     GROUP BY currency) x), '{}'::jsonb),
  'awarders', COALESCE((SELECT jsonb_agg(jsonb_build_object(
     'eik', eik, 'name', name, 'tier', tier, 'totalEur', total_eur,
     'totalOther', '{}'::jsonb, 'contractCount', contract_count,
     'awardCount', award_count) ORDER BY total_eur DESC) FROM aw), '[]'::jsonb),
  'topContracts', (SELECT arr FROM topc),
  'byYear', (SELECT arr FROM byyr)
) END;
$$;
