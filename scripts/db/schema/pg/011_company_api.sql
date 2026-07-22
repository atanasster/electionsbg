-- Company procurement rollup for the DB-backed company page (/db/company/:eik).
-- Returns, in ONE jsonb, the same shape the static contractors/<eik>.json rollup
-- carries (ProcurementContractorRollup) so the DB page reuses the existing
-- procurement tiles unchanged: headline totals, per-awarder + per-year rollups,
-- top contracts, and the raw CPV-division / procedure-method aggregation the
-- breakdown tile buckets client-side (d = left(cpv,2), b = procedureBucket()).
--
-- Aggregations mirror the offline builder exactly (contract-only rule
-- tag='contract'; db:build already proves PG reproduces that rollup 0-diff), so
-- the DB page is at parity with the JSON page for contracts/awarders/charts.
-- Returns NULL when the EIK has no procurement rows (page hides the block).
--
-- Depends on `contracts` (001). EXECUTE auto-granted to app_readonly via ALTER
-- DEFAULT PRIVILEGES (roles_readonly.sql).

SET check_function_bodies = off;
DROP FUNCTION IF EXISTS company_procurement(text);
DROP FUNCTION IF EXISTS company_procurement(text, text, text);

-- p_from / p_to (YYYY-MM-DD, nullable) scope the WHOLE rollup to a date window
-- so the company dashboard can re-scope to a year / last-N-years. NULL = all time.
CREATE OR REPLACE FUNCTION company_procurement(
  p_eik text,
  p_from text DEFAULT NULL,
  p_to text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH base AS (
  SELECT * FROM contracts
  WHERE contractor_eik = p_eik
    AND (p_from IS NULL OR date >= p_from)
    AND (p_to IS NULL OR date <= p_to)
),
hd AS (
  SELECT
    COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract'), 0)   AS total_eur,
    -- Exclude €0 consortium member rows (migration 087): they are participation
    -- placeholders, not the firm's own contracts, so counting them would inflate
    -- the headline count and understate the avg (totalEur is already solo-only).
    (COUNT(*) FILTER (WHERE tag = 'contract'
       AND consortium_role IS DISTINCT FROM 'member'))::int        AS contract_count,
    -- awardCount = OCDS 'award' notices (matches the JSON rollup; corpus has none
    -- today). amendmentCount = 'contractAmendment' rows (анекси) — surfaced
    -- separately so they're labelled correctly, not lumped in as "awards".
    (COUNT(*) FILTER (WHERE tag = 'award'))::int                    AS award_count,
    (COUNT(*) FILTER (WHERE tag = 'contractAmendment'))::int        AS amendment_count,
    (COUNT(DISTINCT awarder_eik) FILTER (WHERE tag = 'contract'))::int AS awarder_count
  FROM base
),
-- Consortium / framework participation (stored model — migration 087). A joint
-- (обединение / ДЗЗД) award's full value sits on ONE consortium entity; this firm's
-- own member rows are €0, so the headline `totalEur` is now its SOLO work only.
-- Here we surface, SEPARATELY (never summed into the headline), the joint contracts
-- it took part in — at the FULL contract value, since the real per-member share
-- isn't public — each linking to its consortium entity. Framework rows (рамково
-- споразумение with many independent winners) keep their equal split and are only
-- labelled, so `frameworkEur` is a SUBSET of `totalEur`, not additive.
conshd AS (
  SELECT
    COALESCE(SUM(consortium_full_eur) FILTER (WHERE consortium_role = 'member'), 0) AS consortium_eur,
    (COUNT(*) FILTER (WHERE consortium_role = 'member'))::int AS consortium_count,
    COALESCE(SUM(amount_eur) FILTER (WHERE joint_kind = 'framework'), 0) AS framework_eur,
    (COUNT(*) FILTER (WHERE joint_kind = 'framework'))::int AS framework_count
  FROM base WHERE tag = 'contract'
),
conslist AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t."amountEur" DESC NULLS LAST), '[]'::jsonb) AS arr FROM (
    SELECT key, ocid, date,
           consortium_full_eur AS "amountEur",
           awarder_eik  AS "partyEik",
           awarder_name AS "partyName",
           title,
           consortium_eik AS "consortiumEik",
           source_url   AS "sourceUrl"
    FROM base
    WHERE tag = 'contract' AND consortium_role = 'member'
    ORDER BY consortium_full_eur DESC NULLS LAST
    LIMIT 25
  ) t
),
-- When THIS eik is a consortium entity (carrier), the member firms behind it — for
-- the "участници" list on the consortium-entity page. Scans the whole table (a
-- carrier's members carry contractor_eik ≠ p_eik), guarded by idx_contracts_consortium_eik.
membersof AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.name), '[]'::jsonb) AS arr FROM (
    SELECT DISTINCT contractor_eik AS eik, contractor_name AS name
    FROM contracts
    WHERE consortium_eik = p_eik AND consortium_role = 'member'
  ) m
),
other AS (
  SELECT COALESCE(jsonb_object_agg(cur, s), '{}'::jsonb) AS total_other FROM (
    SELECT currency AS cur, ROUND(SUM(amount)) AS s
    FROM base
    WHERE tag = 'contract' AND currency IS NOT NULL AND amount IS NOT NULL
    GROUP BY currency
  ) q
),
byaw AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a."totalEur" DESC NULLS LAST), '[]'::jsonb) AS arr FROM (
    SELECT awarder_eik AS eik, MIN(awarder_name) AS name,
           COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract'), 0) AS "totalEur",
           '{}'::jsonb AS "totalOther",
           (COUNT(*) FILTER (WHERE tag = 'contract'))::int AS "contractCount"
    FROM base
    GROUP BY awarder_eik
    HAVING COUNT(*) FILTER (WHERE tag = 'contract') > 0
    ORDER BY "totalEur" DESC NULLS LAST
    LIMIT 50
  ) a
),
byyr AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(y) ORDER BY y.year), '[]'::jsonb) AS arr FROM (
    SELECT left(date, 4) AS year,
           COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract'), 0) AS "totalEur",
           '{}'::jsonb AS "totalOther",
           (COUNT(*) FILTER (WHERE tag = 'contract'))::int AS "contractCount"
    FROM base
    WHERE tag = 'contract'
    GROUP BY left(date, 4)
  ) y
),
topc AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t."amountEur" DESC NULLS LAST), '[]'::jsonb) AS arr FROM (
    SELECT key, ocid, date, tag, amount, currency,
           amount_eur   AS "amountEur",
           awarder_eik  AS "partyEik",
           awarder_name AS "partyName",
           title,
           bundle_uuid  AS "bundleUuid",
           source_url   AS "sourceUrl",
           (consortium_role IS NOT NULL OR joint_kind IS NOT NULL) AS "inConsortium",
           joint_kind      AS "jointKind",
           consortium_role AS "consortiumRole",
           consortium_full_eur AS "consortiumFullEur"
    FROM base
    WHERE tag = 'contract'
    ORDER BY amount_eur DESC NULLS LAST
    LIMIT 25
  ) t
),
bd_cpv AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.eur DESC NULLS LAST), '[]'::jsonb) AS arr FROM (
    SELECT left(cpv, 2) AS d, ROUND(SUM(amount_eur)) AS eur, (COUNT(*))::int AS n
    FROM base
    WHERE tag = 'contract' AND cpv IS NOT NULL AND cpv <> ''
    GROUP BY left(cpv, 2)
  ) x
),
bd_proc AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.eur DESC NULLS LAST), '[]'::jsonb) AS arr FROM (
    SELECT procurement_method AS method, ROUND(SUM(amount_eur)) AS eur, (COUNT(*))::int AS n
    FROM base
    WHERE tag = 'contract' AND procurement_method IS NOT NULL AND procurement_method <> ''
    GROUP BY procurement_method
  ) x
),
bd AS (
  SELECT
    COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract'), 0) AS total_eur,
    COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract' AND cpv IS NOT NULL AND cpv <> ''), 0) AS cpv_known_eur,
    COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract' AND procurement_method IS NOT NULL AND procurement_method <> ''), 0) AS proc_known_eur,
    COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract' AND eu_funded = 1), 0) AS eu_eur,
    COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract' AND eu_funded IS NOT NULL), 0) AS eu_known_eur,
    -- Competition — IDENTICAL classification to procurement_benchmarks (037): the
    -- single-bidder denominator is competitive procedures only (excludes
    -- direct/no-call, method known) with a known bid count; no-call is the
    -- direct-method list. Feeds the entity-scoped ProcurementBenchmarksTile.
    (COUNT(*) FILTER (WHERE tag = 'contract' AND number_of_tenderers = 1
      AND NULLIF(TRIM(procurement_method), '') IS NOT NULL
      AND NULLIF(TRIM(procurement_method), '') NOT IN
        ('Пряко договаряне', 'Договаряне без предварително обявление',
         'Покана до определени лица', 'direct')))::int AS single_bid_n,
    (COUNT(*) FILTER (WHERE tag = 'contract' AND number_of_tenderers IS NOT NULL
      AND NULLIF(TRIM(procurement_method), '') IS NOT NULL
      AND NULLIF(TRIM(procurement_method), '') NOT IN
        ('Пряко договаряне', 'Договаряне без предварително обявление',
         'Покана до определени лица', 'direct')))::int AS bid_known_n,
    (COUNT(*) FILTER (WHERE tag = 'contract'
      AND NULLIF(TRIM(procurement_method), '') IN
        ('Пряко договаряне', 'Договаряне без предварително обявление',
         'Покана до определени лица', 'direct')))::int AS no_call_n,
    (COUNT(*) FILTER (WHERE tag = 'contract'
      AND NULLIF(TRIM(procurement_method), '') IS NOT NULL))::int AS method_known_n
  FROM base
)
SELECT CASE
  WHEN hd.contract_count = 0 AND hd.award_count = 0 AND hd.amendment_count = 0 THEN NULL
  ELSE jsonb_build_object(
    'totalEur', hd.total_eur,
    'totalOther', other.total_other,
    'contractCount', hd.contract_count,
    'awardCount', hd.award_count,
    'amendmentCount', hd.amendment_count,
    'awarderCount', hd.awarder_count,
    'consortiumEur', conshd.consortium_eur,
    'consortiumCount', conshd.consortium_count,
    'consortiumContracts', conslist.arr,
    'consortiumMembers', membersof.arr,
    'frameworkEur', conshd.framework_eur,
    'frameworkCount', conshd.framework_count,
    'byAwarder', byaw.arr,
    'byYear', byyr.arr,
    'topContracts', topc.arr,
    'breakdown', jsonb_build_object(
      'totalEur', bd.total_eur,
      'cpvKnownEur', bd.cpv_known_eur,
      'procKnownEur', bd.proc_known_eur,
      'euEur', bd.eu_eur,
      'euKnownEur', bd.eu_known_eur,
      'bidKnownN', bd.bid_known_n,
      'singleBidN', bd.single_bid_n,
      'noCallN', bd.no_call_n,
      'methodKnownN', bd.method_known_n,
      'cpvRaw', bd_cpv.arr,
      'procRaw', bd_proc.arr
    )
  )
END
FROM hd, other, byaw, byyr, topc, bd, bd_cpv, bd_proc, conshd, conslist, membersof;
$$;
