-- Person page (DB-backed) analytics — rolls the person's whole PORTFOLIO up to
-- the individual. A TR person is identified only by folded name (no personal id),
-- so "the person's companies" = every company they are/were an officer of
-- (tr_officers by name_fold). Over that EIK set we aggregate:
--   • person_procurement  — the SAME jsonb shape company_procurement returns, so
--     the person page reuses the company dashboard tiles unchanged (top awarders,
--     top contracts, sectors, by-year, breakdown).
--   • person_by_cabinet   — awarded € per cabinet over the portfolio (mirror of
--     company_by_cabinet), for the "awards by government" bar chart.
--   • person_associates   — the person's inner circle: people who co-appear as
--     officers across the person's companies, ranked by shared-company count,
--     mega-hubs (mass nominees / registered agents) excluded.
-- Name-only match — treat every rollup as a lead, not proof (namesakes collapse).
-- Depends on tr_officers (003), contracts (001), cabinets (013),
-- officer_name_counts (008). EXECUTE auto-granted to app_readonly.

SET check_function_bodies = off;

-- Portfolio procurement rollup. Identical projection to company_procurement so
-- the client's DbRollup type + tiles are reused verbatim; only `base` differs
-- (contractor IN the person's company set, not a single EIK). No double-count:
-- each contract has exactly one contractor_eik.
DROP FUNCTION IF EXISTS person_procurement(text, text, text);
CREATE OR REPLACE FUNCTION person_procurement(
  p_name text,
  p_from text DEFAULT NULL,
  p_to text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
-- companies/base MATERIALIZED + indexed JOIN so a HUB name (in hundreds of
-- companies) probes contracts by contractor_eik instead of hash-joining a full
-- seq scan of the whole contracts table.
WITH me AS (SELECT translit_bg_latin(p_name) AS f),
companies AS MATERIALIZED (
  SELECT DISTINCT o.uic FROM tr_officers o CROSS JOIN me WHERE o.name_fold = me.f
),
base AS MATERIALIZED (
  SELECT ct.* FROM companies co JOIN contracts ct ON ct.contractor_eik = co.uic
  WHERE (p_from IS NULL OR ct.date >= p_from)
    AND (p_to IS NULL OR ct.date <= p_to)
),
hd AS (
  SELECT
    COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract'), 0)   AS total_eur,
    (COUNT(*) FILTER (WHERE tag = 'contract'))::int                AS contract_count,
    (COUNT(*) FILTER (WHERE tag = 'award'))::int                    AS award_count,
    (COUNT(*) FILTER (WHERE tag = 'contractAmendment'))::int        AS amendment_count,
    (COUNT(DISTINCT awarder_eik) FILTER (WHERE tag = 'contract'))::int AS awarder_count
  FROM base
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
  -- party = the AWARDER (state buyer); contractor* names WHICH of the person's
  -- companies won it (the portfolio spans several), for per-company attribution.
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t."amountEur" DESC NULLS LAST), '[]'::jsonb) AS arr FROM (
    SELECT key, ocid, date, tag, amount, currency,
           amount_eur      AS "amountEur",
           awarder_eik     AS "partyEik",
           awarder_name    AS "partyName",
           title,
           contractor_eik  AS "contractorEik",
           contractor_name AS "contractorName",
           bundle_uuid     AS "bundleUuid",
           source_url      AS "sourceUrl"
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
    COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract' AND eu_funded IS NOT NULL), 0) AS eu_known_eur
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
    'byAwarder', byaw.arr,
    'byYear', byyr.arr,
    'topContracts', topc.arr,
    'breakdown', jsonb_build_object(
      'totalEur', bd.total_eur,
      'cpvKnownEur', bd.cpv_known_eur,
      'procKnownEur', bd.proc_known_eur,
      'euEur', bd.eu_eur,
      'euKnownEur', bd.eu_known_eur,
      'cpvRaw', bd_cpv.arr,
      'procRaw', bd_proc.arr
    )
  )
END
FROM hd, other, byaw, byyr, topc, bd, bd_cpv, bd_proc;
$$;

-- Awarded € per cabinet over the person's portfolio (mirror company_by_cabinet).
-- Materialise the portfolio's contracts once, then bucket by tenure window.
DROP FUNCTION IF EXISTS person_by_cabinet(text);
CREATE OR REPLACE FUNCTION person_by_cabinet(p_name text)
RETURNS TABLE(
  id         text,
  pm         text,
  parties    text[],
  start_date text,
  end_date   text,
  type       text,
  contracts  integer,
  eur        double precision
) LANGUAGE sql STABLE AS $$
  WITH me AS (SELECT translit_bg_latin(p_name) AS f),
  companies AS MATERIALIZED (
    SELECT DISTINCT o.uic FROM tr_officers o CROSS JOIN me WHERE o.name_fold = me.f
  ),
  -- MATERIALIZED + indexed JOIN (not IN-subquery) so a hub name probes contracts
  -- by contractor_eik instead of seq-scanning the whole table before the range join.
  mine AS MATERIALIZED (
    SELECT ct.key, ct.date, ct.amount_eur
    FROM companies co JOIN contracts ct ON ct.contractor_eik = co.uic
    WHERE ct.tag = 'contract'
  )
  SELECT
    cab.id, cab.pm_bg AS pm, cab.parties, cab.start_date, cab.end_date, cab.type,
    (count(mc.key))::int AS contracts,
    coalesce(sum(mc.amount_eur), 0) AS eur
  FROM cabinets cab
  LEFT JOIN mine mc
    ON mc.date >= cab.start_date
   AND (cab.end_date IS NULL OR mc.date < cab.end_date)
  GROUP BY cab.id, cab.pm_bg, cab.parties, cab.start_date, cab.end_date, cab.type
  ORDER BY cab.start_date;
$$;

-- Inner circle: PEOPLE who co-appear as officers across the person's companies.
-- shared = number of the PERSON's companies the associate also sits on. Mega-hubs
-- (mass nominees / registered agents, in > 300 companies) are excluded so the
-- list reads as genuine business partners, not filing artefacts. `companies` is
-- the (bounded, ≤ portfolio size) list of the shared firms for a drill-in.
--
-- tr_officers has no person/entity flag, so company-officers (a firm owning /
-- sitting on the board of another) are filtered heuristically: drop names with
-- digits or quotes (brand names) and legal-form / company tokens. Word-boundary
-- anchors on short tokens (\mАД\M) so surnames like БАДИНСКИ aren't caught.
DROP FUNCTION IF EXISTS person_associates(text);
CREATE OR REPLACE FUNCTION person_associates(p_name text)
RETURNS TABLE(name text, shared integer, companies jsonb)
LANGUAGE sql STABLE AS $$
  WITH me AS (SELECT translit_bg_latin(p_name) AS f),
  mycos AS (
    SELECT DISTINCT o.uic FROM tr_officers o CROSS JOIN me WHERE o.name_fold = me.f
  ),
  co AS (  -- one row per (associate, shared company); self, mega-hubs, firms removed
    SELECT DISTINCT ob.name_fold, ob.uic
    FROM tr_officers ob
    JOIN mycos ON mycos.uic = ob.uic
    JOIN officer_name_counts c ON c.name_fold = ob.name_fold AND c.company_count <= 300
    CROSS JOIN me
    WHERE ob.name_fold <> me.f AND ob.name_fold <> ''
      AND ob.name !~ '[0-9"«»„”“]'
      AND ob.name !~* '\m(ООД|ЕООД|АД|ЕАД|АДСИЦ|ЕТ|ДЗЗД|КД|КДА|СД)\M'
      AND ob.name !~* '(ХОЛДИНГ|ГРУП|ИНВЕСТМ|КОНСОРЦИУМ|КОМПАНИЯ|ФОНДАЦИЯ|СДРУЖЕНИЕ|АСОЦИАЦИЯ|ТРЕЙДИНГ|ПРОПЪРТ|КАПИТАЛ|ЕНЕРДЖИ|ПРОДЖЕКТ)'
  )
  SELECT
    (SELECT MIN(t.name) FROM tr_officers t WHERE t.name_fold = co.name_fold) AS name,
    (count(*))::int AS shared,
    jsonb_agg(jsonb_build_object(
      'eik', co.uic,
      'name', (SELECT tc.name FROM tr_companies tc WHERE tc.uic = co.uic)
    ) ORDER BY co.uic) AS companies
  FROM co
  GROUP BY co.name_fold
  ORDER BY shared DESC, name
  LIMIT 20;
$$;
