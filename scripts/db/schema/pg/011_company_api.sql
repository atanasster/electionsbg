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
-- Returns NULL only when the EIK is absent from the corpus entirely — INCLUDING as a
-- consortium MEMBER (see the guard's note at the foot of this file). Whether the page
-- renders the block is a SEPARATE, stricter TSX gate on `contractCount > 0`, so a
-- non-NULL return is not sufficient to make anything appear.
--
-- Depends on `contracts` (001). EXECUTE auto-granted to app_readonly via ALTER
-- DEFAULT PRIVILEGES (roles_readonly.sql).
--
-- ⚠️ THIS FILE AND `024_person_api.sql` HAVE DIFFERENT AUTOMATIC APPLIERS AND CAN DRIFT:
--   011 rides `db:load:pg` (the contracts publish, load_pg.ts)
--   024 rides `db:load:tr:pg` (the TR publish — a REFRESH_EXCLUSIONS member `db:refresh`
--       never runs)
-- The NULL guard below is ONE rule living in both files, so a routine `db:load:pg:cloud`
-- lands the company half on prod and leaves `/person` on the old body indefinitely, with
-- every row count reconciling and nothing red. Ship a guard change with BOTH files named,
-- never by waiting for a loader:
--   npx tsx scripts/db/apply_functions.ts \
--     114_procurement_annexes.sql 011_company_api.sql 024_person_api.sql
--
-- ⚠️ 114 IS IN THAT COMMAND FOR A THIRD-LOADER REASON. `conslist`/`carannex` below read
-- `procurement_annexes`, whose only applier is `db:load:annexes:pg` — neither of the two
-- loaders above. `check_function_bodies = off` means a missing relation does NOT fail at
-- CREATE; it raises 42P01 on the first CALL, inside a ~30-way Promise.all that would 500
-- every /company AND /awarder page. `db_routes.js` degrades it to a null rollup and logs
-- once (db_routes.consortium_annex.test.js pins that), so this is a narrowed page rather
-- than an outage — but apply 114 and it is neither.

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
    -- ⚠️ `awarder_count` DELIBERATELY DOES NOT CARRY the member exclusion three lines
    -- above, and neither do `byaw`, `byyr`, `topc`, `other` or `bd*` — they all filter
    -- `tag = 'contract'` only, which member rows satisfy. That asymmetry was diluted
    -- inside a mixed company's real numbers until the guard at the foot of this file
    -- started serving MEMBER-ONLY companies, for whom it is the ENTIRE payload:
    -- measured 2026-09-21 over the 1,101 newly served, all 1,101 report
    -- `awarderCount >= 1` against `contractCount = 0`, 1,101 carry a non-empty
    -- `byAwarder`/`byYear`, and 285 carry `breakdown.singleBidN > 0` — a single-bidder
    -- statistic whose numerator and denominator are both €0 participation placeholders.
    -- DECIDED (plan §3, invariant 7): these fields are NOT narrowed, because doing so
    -- would move the per-row counts of 2,063 MIXED companies as a side effect. Instead
    -- the member-only BRANCH of the UI renders none of them — participation lives only
    -- in the `consortium*` fields. A new consumer reading `awarderCount` or `breakdown`
    -- must therefore check `contractCount > 0` first, or it will publish a competition
    -- claim about a firm that won nothing on its own.
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
-- The carrier row behind each of this firm's member rows, resolved ONCE. Both consumers
-- below need it — `consannex` for the unbounded headline and `conslist` for the per-contract
-- link — and doing the lookup twice doubled it: measured 2026-09-21 on the corpus's worst
-- case (835013079, 128 member rows) the lookup alone is 1,167 buffers, all index scans.
carannex AS MATERIALIZED (
  SELECT b.key AS member_key, car.key AS carrier_key, car.name AS carrier_name,
         COALESCE(car.annex_n, 0)::int AS annex_n
    FROM base b
    LEFT JOIN LATERAL (
      SELECT c.key, c.contractor_name AS name,
             (SELECT count(*) FROM procurement_annexes a WHERE a.contract_key = c.key) AS annex_n
        FROM contracts c
       WHERE c.ocid = b.ocid
         AND COALESCE(c.contract_id, '') = COALESCE(b.contract_id, '')
         AND c.tag = 'contract' AND c.consortium_role = 'carrier'
       -- ORDER BY for DETERMINISM only: `(ocid, contract_id)` carries at most one carrier by
       -- construction (087's `_named_carrier` is DISTINCT ON that key and `_synth` inserts one
       -- row per group), measured 0 multi-carrier groups. A bare LIMIT 1 would therefore be
       -- correct today and arbitrary the day 087 changed — and every per-row gate assertion
       -- would still pass, because each is satisfied by WHICHEVER carrier was picked. The gate
       -- asserts the uniqueness invariant separately; this is the belt.
       ORDER BY c.key
       LIMIT 1
    ) car ON true
   WHERE b.tag = 'contract' AND b.consortium_role = 'member'
),
-- Total annexes across every joint contract this firm is a member of — UNBOUNDED, unlike the
-- per-row `annexCount` in `conslist`, which stops at that list's LIMIT 25. A headline that
-- counted only the listed 25 would under-report exactly the firms with the most joint work.
consannex AS (
  SELECT COALESCE(SUM(annex_n), 0)::int AS consortium_annex_count FROM carannex
),
-- ⚠️ AN ANNEX BELONGS TO THE CARRIER ROW, NEVER TO THE MEMBER'S — which is why a member
-- page could not show the amendments that moved its own contract. `procurement_annexes`
-- resolves against `contracts.key`, and 087 puts the money (and therefore the annex trail)
-- on the carrier, so for МЛГ ЕООД all 5 annexes on РД-37-45 — the ones that took it from
-- 42,598,403 to 93,065,069.67 BGN, +118% — hang off `obed-abf3a70ed9bb` and none off the
-- member row. Measured 2026-09-21: member rows carry 0 annexes across the whole corpus.
--
-- The carrier is found on `(ocid, contract_id)`, which is exactly the grouping key
-- `rebuild_consortium()` (087) builds the group on, so a member row and its carrier always
-- agree on it — verified on the reference contract, where two carrier rows and six member
-- rows split cleanly across contract_id 61831/61839.
--
-- `annexCount` is reported PER JOINT CONTRACT and is deliberately NOT folded into the
-- member's own `amendmentCount`, which counts this EIK's own `contractAmendment` rows. They
-- are different claims: "this firm's contract was amended 5 times" vs "this firm filed 5
-- amendments". `carrierKey` rides along so the UI can link straight at the carrier's
-- contract instead of making a reader find it.
conslist AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t."amountEur" DESC NULLS LAST), '[]'::jsonb) AS arr FROM (
    SELECT b.key, b.ocid, b.date,
           b.consortium_full_eur AS "amountEur",
           b.awarder_eik  AS "partyEik",
           b.awarder_name AS "partyName",
           b.title,
           b.consortium_eik AS "consortiumEik",
           ca.carrier_key  AS "carrierKey",
           ca.carrier_name AS "consortiumName",
           COALESCE(ca.annex_n, 0) AS "annexCount",
           b.source_url   AS "sourceUrl"
    FROM base b
    LEFT JOIN carannex ca ON ca.member_key = b.key
    WHERE b.tag = 'contract' AND b.consortium_role = 'member'
    ORDER BY b.consortium_full_eur DESC NULLS LAST
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
-- ⚠️ THE NULL GUARD IS AN EXISTENCE TEST, AND `contract_count` IS NOT ONE.
-- `hd.contract_count` deliberately excludes `consortium_role = 'member'` rows (087 zeroes a
-- joint award's members onto its carrier), which is right for a COUNT and wrong as "does this
-- firm appear in the corpus at all": a firm whose ONLY procurement is consortium membership
-- scores 0 on all three of contract/award/amendment and returns NULL — so the page renders no
-- procurement body, while `conshd`/`conslist` a few lines above have ALREADY computed its
-- participation. Measured 2026-09-21: 1,172 companies are member-only, party to €7.48bn of
-- joint awards across 1,048 consortia. THIS GUARD NULLED 1,101 OF THEM — the other 71 carry
-- amendment rows and already got a payload — so do not read 1,172 as this line's reach.
-- `conshd.consortium_count` is therefore part of the test. It is NOT added to any count or
-- sum — see `consortiumEur`'s note above for why the joint value must never reach `totalEur`.
-- The same guard, the same fix and the same reasoning live in 024_person_api.sql; the two
-- have DIFFERENT automatic appliers and must be shipped by name together (see file header).
--
-- ⚠️ ON ITS OWN THIS CHANGES NOTHING A READER SEES. All 1,172 are ADDITIONALLY hidden by a
-- second gate in the UI — `rollup.contractCount > 0` wraps the whole procurement section in
-- CompanyDbScreen.tsx / PersonScreen.tsx, and the consortium sub-line is nested INSIDE it —
-- and `contractCount` stays 0 here. Do not read a green `company_procurement(…) IS NOT NULL`
-- as "the page now shows it".
-- Plan: docs/plans/consortium-member-visibility-v1.md
SELECT CASE
  WHEN hd.contract_count = 0 AND hd.award_count = 0 AND hd.amendment_count = 0
       AND conshd.consortium_count = 0 THEN NULL
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
    'consortiumAnnexCount', consannex.consortium_annex_count,
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
FROM hd, other, byaw, byyr, topc, bd, bd_cpv, bd_proc, conshd, conslist, consannex, membersof;
$$;
