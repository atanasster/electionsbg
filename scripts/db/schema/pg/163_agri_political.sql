-- The politically-linked farm recipients behind /subsidies/political.
-- Plan: docs/plans/subsidies-hub-v1.md §2.4 and §6.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- THE GATE IS THE CANONICAL ONE, AND WHICH GATE IS NOT A DETAIL — IT IS A FACTOR OF 10.
--
-- Three predicates for „is a public figure attached to this company" already ship in this
-- repo, and they disagree on this corpus:
--
--     company_politicians (008)                         11 EIKs   €17.6m
--     person_role source='tr'  + gate (082)            504 EIKs  €170.0m
--     person_role source IN ('tr','ngo') + gate         568 EIKs  €184.4m   ← this one
--
-- `company_politicians` is money-restricted AND procurement-derived — 113 companies
-- site-wide — so building on it would tell a reader that 0.11% of farm money touches a
-- public figure when the site's own person layer knows 1.67%.
--
-- The third is what `person_link_n` (133's loader) and `place_mp_companies` (151) already
-- use, so a reader who reaches the same company from a governance place page and from here
-- is told the same thing. It is spelled out once, below, and nowhere else in this file.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ IT REPORTS A REGISTRY ROLE. NOT OWNERSHIP, NOT CONTROL, NOT WRONGDOING.
-- `person_role(tr|ngo)` means the Commerce Registry or the ЮЛНЦ register records this person
-- in a role at this company. 568 of 16,701 recipients is 3.4%, and the honest sentence is
-- „публична фигура заема вписана роля" — the wording /funds/political and place_mp_companies
-- already use. The identity itself is gated upstream by `resolve_persons`, which REFUSES a
-- name the registry records for more than one person rather than grading it
-- (`tr_name_fold_people`, 148) — so a shared name produces no row here at all.
--
-- ⚠️ THE TWO ARMS ARE KEPT APART, and that is the point rather than a nicety. An ЕООД whose
-- manager is an MP and a местна инициативна група (МИГ) whose board includes a mayor are not
-- the same kind of fact: 64 of the 568 are reached ONLY through the `ngo` arm — €14.4m,
-- overwhelmingly сдружения, and the LEADER local action groups among them are the statutory
-- delivery vehicle for ЕЗФРСР money rather than a business interest. Merging them into one
-- „политически свързани фирми" list would make a читалище read like a company.
--
-- Note /person/:slug's own `subsidiesEur` (082) uses the NARROWER `tr`-only set, deliberately:
-- there a civic board seat renders in its own section with no money columns. So the two pages
-- differ by those 64 companies BY DESIGN, which is why this one splits rather than hides it.

DROP MATERIALIZED VIEW IF EXISTS agri_cross_programme;
DROP MATERIALIZED VIEW IF EXISTS agri_political_link;

CREATE MATERIALIZED VIEW agri_political_link AS
  WITH gated AS (
    -- THE canonical gate. Spelled once.
    SELECT r.ref AS eik, r.person_id, r.source, r.role
    FROM person_role r
    JOIN person pe ON pe.person_id = r.person_id
    WHERE r.source IN ('tr', 'ngo')
      AND r.confidence IN ('exact_id', 'high', 'manual')
      AND pe.status = 'active' AND pe.is_public_figure
  ),
  -- ⚠️ DERIVED FROM `agri_subsidies` DIRECTLY, never from `agri_beneficiary_year`,
  -- even though that matview is exactly this rollup and reading it would be free.
  -- 046 DROPs it unconditionally on every apply and `scripts/agri/ingest.ts` applies
  -- 046 at the TOP of every run — so a pg_depend edge from here turns every
  -- `db:load:agri:pg`, every `agri:ingest` and step 14 of `db:refresh` into a 2BP01
  -- in the APPLY phase, before the COPY, leaving the corpus silently on its previous
  -- vintage. 162's header documents this trap; this file hit it anyway, and
  -- `migration_drop_dependents.data.test.ts` is what caught it.
  --
  -- The basis is provably identical: same three partitions, same payer and NULL-EIK
  -- exclusions, same coalesce.
  money AS (
    SELECT year::text AS scope_key, eik,
           sum(coalesce(total_eur, 0)::numeric)::double precision AS total_eur,
           count(*) AS payment_count
      FROM agri_subsidies WHERE eik IS NOT NULL AND eik <> '121100421'
     GROUP BY year, eik
    UNION ALL
    SELECT 'all', eik,
           sum(coalesce(total_eur, 0)::numeric)::double precision, count(*)
      FROM agri_subsidies WHERE eik IS NOT NULL AND eik <> '121100421'
     GROUP BY eik
    UNION ALL
    SELECT '', eik,
           sum(coalesce(total_eur, 0)::numeric)::double precision, count(*)
      FROM agri_subsidies
     WHERE eik IS NOT NULL AND eik <> '121100421'
       AND year = (SELECT max(year) FROM agri_subsidies)
     GROUP BY eik
  ),
  -- The label, from the same LONGEST-spelling rule agri_beneficiary applies, so a
  -- recipient is spelled the same here as in every other ranking.
  label AS (
    SELECT eik,
           (array_agg(name ORDER BY length(name) DESC, name COLLATE "C"))[1] AS name,
           min(oblast COLLATE "C") AS oblast
      FROM agri_subsidies WHERE eik IS NOT NULL AND eik <> '121100421'
     GROUP BY eik
  ),
  arms AS (
    SELECT eik,
           bool_or(source = 'tr')  AS via_company,
           bool_or(source = 'ngo') AS via_association
    FROM gated GROUP BY eik
  ),
  people AS (
    SELECT g.eik,
           jsonb_agg(DISTINCT jsonb_build_object(
             'slug', pe.slug, 'name', pe.display_name
           )) AS people,
           count(DISTINCT g.person_id) AS person_count
    FROM gated g JOIN person pe ON pe.person_id = g.person_id
    GROUP BY g.eik
  )
  SELECT m.scope_key,
         m.eik,
         l.name,
         l.oblast,
         m.total_eur,
         m.payment_count,
         CASE WHEN a.via_company AND a.via_association THEN 'both'
              WHEN a.via_company THEN 'company'
              ELSE 'association' END AS arm,
         p.person_count,
         p.people
  FROM money m
  JOIN label l  ON l.eik = m.eik
  JOIN arms a   ON a.eik = m.eik
  JOIN people p ON p.eik = m.eik
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agri_political_link_key
  ON agri_political_link (scope_key, eik);
-- The ranked page walk, matching agri_beneficiary_year's NULLS LAST so the consuming
-- ORDER BY can be served by the index rather than sorting the partition.
CREATE INDEX IF NOT EXISTS idx_agri_political_link_rank
  ON agri_political_link (scope_key, total_eur DESC NULLS LAST, eik);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON agri_political_link TO app_readonly;
  END IF;
END $$;


-- ==========================================================================
-- The same recipients seen across the OTHER public-money programmes, behind
-- /subsidies/cross-programme.
--
-- One row per (scope × EIK) for every farm recipient that ALSO holds a public
-- contract or an ИСУН grant. Measured on the corpus: 3,910 of 16,701 are ИСУН
-- beneficiaries and 772 hold ЗОП contracts.
--
-- ⚠️ THE THREE COLUMNS ARE ON DIFFERENT BASES AND ARE NEVER SUMMED. Their units
-- genuinely differ:
--
--   agri_eur       PAID by ДФЗ in this scope        — cash out, this window
--   contracts_eur  post-annex CONTRACT VALUE, ЗОП   — awarded, all time, not
--                                                     necessarily paid
--   funds_grant_eur the ИСУН GRANT (public part)     — contracted, all time; the
--                                                     paid figure is lower, and the
--                                                     project TOTAL is higher because
--                                                     it includes own co-financing
--
-- Adding them produces a number that describes nothing. The page therefore shows
-- three columns and no total, and says which is which.
--
-- ⚠️ AND ONLY THE AGRI COLUMN IS SCOPED. `contracts` and `fund_projects` are not
-- partitioned by CAP financial year and their windows do not line up with one, so
-- the two right-hand columns are ALL-TIME on every scope. That is stated on the
-- page rather than left for a reader to assume the row is one window.
-- ==========================================================================
CREATE MATERIALIZED VIEW agri_cross_programme AS
  WITH money AS (
    -- Same derivation as agri_political_link above, and for the same reason: reading
    -- agri_beneficiary_year would make 046's DROP of it a 2BP01 on every agri load.
    SELECT year::text AS scope_key, eik,
           sum(coalesce(total_eur, 0)::numeric)::double precision AS total_eur
      FROM agri_subsidies WHERE eik IS NOT NULL AND eik <> '121100421'
     GROUP BY year, eik
    UNION ALL
    SELECT 'all', eik, sum(coalesce(total_eur, 0)::numeric)::double precision
      FROM agri_subsidies WHERE eik IS NOT NULL AND eik <> '121100421'
     GROUP BY eik
    UNION ALL
    SELECT '', eik, sum(coalesce(total_eur, 0)::numeric)::double precision
      FROM agri_subsidies
     WHERE eik IS NOT NULL AND eik <> '121100421'
       AND year = (SELECT max(year) FROM agri_subsidies)
     GROUP BY eik
  ),
  label AS (
    SELECT eik,
           (array_agg(name ORDER BY length(name) DESC, name COLLATE "C"))[1] AS name,
           min(oblast COLLATE "C") AS oblast
      FROM agri_subsidies WHERE eik IS NOT NULL AND eik <> '121100421'
     GROUP BY eik
  ),
  contracts_by_eik AS (
    SELECT contractor_eik AS eik, sum(amount_eur::numeric) AS eur, count(*) AS n
    FROM contracts
    WHERE contractor_eik IS NOT NULL
      AND tag = 'contract'
      -- €0 consortium member rows would inflate the count without money (087).
      AND consortium_role IS DISTINCT FROM 'member'
    GROUP BY contractor_eik
  ),
  funds_by_eik AS (
    -- `grant_eur`, NOT `total_eur`. A project's total includes the beneficiary's
    -- OWN co-financing, which is not public money at all — putting it in a column
    -- beside ЗОП contract value and ДФЗ cash would overstate what the state gave
    -- this recipient, on the page whose whole subject is what the state gave them.
    SELECT beneficiary_eik AS eik, sum(grant_eur::numeric) AS eur, count(*) AS n
    FROM fund_projects WHERE beneficiary_eik IS NOT NULL
    GROUP BY beneficiary_eik
  )
  SELECT m.scope_key,
         m.eik,
         l.name,
         l.oblast,
         m.total_eur                        AS agri_eur,
         coalesce(c.eur, 0)::double precision AS contracts_eur,
         c.n                                AS contract_count,
         coalesce(f.eur, 0)::double precision AS funds_grant_eur,
         f.n                                AS fund_project_count,
         -- How many of the three this recipient appears in. Always >= 2 here: a
         -- farm with agri money only is not a cross-programme row.
         (1 + CASE WHEN c.eik IS NOT NULL THEN 1 ELSE 0 END
            + CASE WHEN f.eik IS NOT NULL THEN 1 ELSE 0 END) AS programme_count
  FROM money m
  JOIN label l                 ON l.eik = m.eik
  LEFT JOIN contracts_by_eik c ON c.eik = m.eik
  LEFT JOIN funds_by_eik f     ON f.eik = m.eik
  WHERE c.eik IS NOT NULL OR f.eik IS NOT NULL
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agri_cross_programme_key
  ON agri_cross_programme (scope_key, eik);
CREATE INDEX IF NOT EXISTS idx_agri_cross_programme_rank
  ON agri_cross_programme (scope_key, agri_eur DESC NULLS LAST, eik);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON agri_cross_programme TO app_readonly;
  END IF;
END $$;
