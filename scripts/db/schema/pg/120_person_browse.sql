-- 120_person_browse.sql — the global persons browser (`/persons`), served from PG.
--
-- Backs the `persons` db_table.js REGISTRY resource. Plan: docs/plans/persons-browser-v1.md.
-- Applied + REFRESHed by scripts/db/load_persons_browse_pg.ts
-- (`npm run db:load:persons-browse:pg`).
--
-- ---------------------------------------------------------------------------
-- ONE ROW PER PERSON. NOT ONE ROW PER ROLE. This is the single most likely
-- regression in this file, so it is the first thing written down.
--
-- person_role holds 143,253 rows for 56,801 public persons — Пеевски alone appears
-- seven times. Browsing that table directly would list him seven times AND inflate
-- the `count` aggregate and every facet identically, with no error anywhere. It is
-- the same fan-out 100_officials_rankings.sql documents at length and the
-- `defaultScope` note on mp_assets_rankings guards against. Every multi-valued fact
-- (roles, parties, oblasts, companies) is therefore FOLDED into this row — as a
-- count, a space-padded code set, or a representative scalar — never as extra rows.
--
-- ---------------------------------------------------------------------------
-- §6 PRIVACY GATE, APPLIED HERE. `status = 'active' AND is_public_figure`, and roles
-- restricted to confidence IN ('exact_id','high','manual') — the same predicate every
-- serving function in 082_person_api.sql uses. This is a serving surface wired straight
-- into the public registry, so it applies the gate itself rather than trusting that
-- today's data (all 58,084 persons active; 56,801 public) makes it a no-op. See the
-- same argument, at length, in 100_officials_rankings.sql.
--
-- ---------------------------------------------------------------------------
-- PROMINENCE — the ordering, and why it is SOURCE-based.
--
-- `role_prominence()` scores a role row; the representative role is the highest score,
-- tie-broken by `start_date DESC NULLS LAST, ref` — the SAME tiebreak
-- 100_officials_rankings.sql uses.
--
-- Among the six Court-of-Audit officials sources the score order is IDENTICAL to 100's
-- CASE (official_exec > public_sector > president > mep > diplomat > official_muni), so
-- restricted to those sources this file and 100 pick the SAME role. That is not a
-- coincidence to be preserved by luck — person_browse.data.test.ts asserts it, because
-- two disagreeing "primary post" rules would have /persons and /officials/assets label
-- the same human differently. 100's header records what an arbitrary pick cost last
-- time: 212 of 504 dual-post people bucketed as municipal.
--
-- THE GUARANTEE IS *WITHIN* THOSE SIX SOURCES, and `primary_role` is picked across ALL of
-- them, so the two columns DO differ for 494 people — every one of them an MP, because
-- `mp` deliberately outranks every officials source. Дeputy-minister-and-MP leads with the
-- MP seat here and with the ministerial category on /officials/assets. That is the product
-- decision, not a drift: the test pins it by asserting the divergence set is exactly the
-- MPs (non-MP divergence must be 0), which is the assertion that would actually break if
-- the ordering slipped.
--
-- Consequently the score does NOT vary by role WITHIN any of those six sources — a bump
-- there would change which row wins a tie and break the equality. Role bumps are allowed
-- only outside that set, and exactly one exists: `local` mayor above `local` councillor,
-- which matters for 921 mayors and cannot affect the officials comparison.
--
-- ---------------------------------------------------------------------------
-- "REPRESENTATIVE" IS PER-ATTRIBUTE, NOT ONE GLOBAL ROLE. A single winning role cannot
-- supply everything: an `official_exec` role (a deputy minister) carries NEITHER a party
-- NOR a place, so sourcing party and place strictly from the top role would blank both
-- for most of the executive. Each scalar therefore comes from the highest-prominence
-- role that HAS that attribute, under the identical ordering. The invariant that
-- survives — and that the test asserts — is the useful one: when the top role itself
-- carries the attribute, the scalar comes from it.
--
-- ---------------------------------------------------------------------------
-- MONEY. public_money_eur is Σ contracts.amount_eur over the person's DISTINCT TR
-- companies, on the established basis: tag='contract' AND consortium_role IS DISTINCT
-- FROM 'member' — the post-annex SIGMA-matching basis (078) that person_by_slug uses for
-- `procuredEur`. Do NOT invent a second basis: a browser figure disagreeing with the
-- profile figure for the same person is the worst bug this table can carry, and
-- person_browse.data.test.ts reconciles the two.
--
-- IT IS NOT ADDITIVE ACROSS ROWS. Two co-officers of one company each carry that
-- company's full sum, so Σ public_money_eur down the table double-counts. The registry
-- entry declares `count` only and says so; do not add `agg: "sum"` here or there.
--
-- tr_link_basis records HOW the TR link was established, because that is what the reader
-- needs caveated — never `namesake_risk`, which counts a name's COMPANIES, not its
-- PEOPLE, and which the resolver explicitly deprecated as a namesake proxy. Gating the
-- money on it would blank 523 of the 1,070 money-carrying persons (€29bn) — precisely
-- the multi-company footprints. See the plan §3 for the measurement.
--
-- IT HAS THREE VALUES, not two, and the third is the reason: a person can hold ONE curated
-- company alongside SEVERAL name-matched ones (8 people do). Collapsing that to 'declared'
-- on the strength of the curated one drops the namesake caveat from a figure that is partly
-- name-derived — rounding toward the reassuring answer on exactly the rows that need the
-- warning. So: 'declared' means EVERY contributing company is curated, 'mixed' means some
-- are, 'name_match' means none are. The UI caveats anything that is not 'declared'.

-- ---------------------------------------------------------------------------
-- role_prominence — the one ordering, as a function so the matview and its test cannot
-- drift. IMMUTABLE: it is a pure lookup, and the planner may fold it into the sort.
-- ---------------------------------------------------------------------------
-- PARALLEL SAFE is not decorative: IMMUTABLE alone leaves a function PARALLEL UNSAFE by
-- default, which blocks a parallel plan for the very sorts this drives.
CREATE OR REPLACE FUNCTION role_prominence(p_source text, p_role text)
RETURNS smallint LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE p_source
    WHEN 'mp'            THEN 100  -- outside 100's set, so free to sit on top
    -- ↓ the six sources 100_officials_rankings.sql ranks. Relative order is LOAD-BEARING.
    WHEN 'official_exec' THEN 90
    WHEN 'public_sector' THEN 85
    WHEN 'president'     THEN 80
    WHEN 'mep'           THEN 75
    WHEN 'diplomat'      THEN 70
    WHEN 'official_muni' THEN 65
    -- ↑ end of the locked block.
    WHEN 'magistrate'    THEN 60
    WHEN 'regulator'     THEN 55
    WHEN 'local'         THEN CASE WHEN p_role = 'mayor' THEN 50 ELSE 45 END
    -- historic_mp is an OFFICE and outranks the two registers below it, which are facts
    -- ABOUT a person rather than posts they held. (Empty today — the source is planned —
    -- but the ordering is what `held_office` reads, so it has to be right before it lands.)
    WHEN 'historic_mp'   THEN 42
    WHEN 'ds'            THEN 40
    WHEN 'sanctions'     THEN 38
    WHEN 'candidate'     THEN 30
    WHEN 'ngo'           THEN 20
    WHEN 'tr'            THEN 10
    WHEN 'donor'         THEN 5
    ELSE 1                        -- an unranked future source sorts last, never errors
  END::smallint;
$$;

-- CASCADE like its siblings (090, 100), so a future view built on top of this one does not
-- turn a re-apply into a dependency error mid-publish. Note this matview is ITSELF a
-- cascade victim: 090's `DROP MATERIALIZED VIEW person_wealth_year CASCADE` takes it down
-- on every declarations `--resolve`, which is why load_declarations_pg.ts re-applies this
-- file in the same run (alongside 097/100/105).
DROP MATERIALIZED VIEW IF EXISTS person_browse_table CASCADE;
CREATE MATERIALIZED VIEW person_browse_table AS
WITH pub AS (
  -- The gate, once. Everything below joins through this. It admits the public population AND the
  -- S4 verified private owners (is_public_figure=false, identity_confidence='verified') — the
  -- latter render as tier V частен сектор below (never in the public default), with a REAL slug.
  -- A gated person (review status, or non-public-non-verified) is still withheld.
  SELECT person_id, slug, display_name, name_fold, namesake_risk,
         is_public_figure, identity_confidence
  FROM person
  WHERE status = 'active'
    AND (is_public_figure OR identity_confidence = 'verified')
),
roles AS (
  -- Public-safe roles only, decorated with their facet + score. This is the ONLY place
  -- the confidence predicate appears, so no fold below can accidentally widen it.
  SELECT r.person_id, r.source, r.ref, r.role, r.party, r.start_date,
         r.place_kind, r.place_code, r.place_raw,
         s.facet,
         role_prominence(r.source, r.role) AS prom
  FROM person_role r
  JOIN pub          ON pub.person_id = r.person_id
  JOIN person_source s ON s.key = r.source
  WHERE r.confidence IN ('exact_id', 'high', 'manual')
),
-- The representative ROLE: identity of the person's most prominent post.
top_role AS (
  SELECT DISTINCT ON (person_id) person_id, source, role, facet, prom
  FROM roles
  ORDER BY person_id, prom DESC, start_date DESC NULLS LAST, ref
),
-- The representative PARTY — highest-prominence role that HAS one (see the header:
-- an executive role carries no party, so this cannot be the same DISTINCT ON).
top_party AS (
  SELECT DISTINCT ON (person_id) person_id, party
  FROM roles WHERE party IS NOT NULL
  ORDER BY person_id, prom DESC, start_date DESC NULLS LAST, ref
),
-- The representative PLACE, same shape. place_raw rides along for the label COALESCE:
-- the CHECK on person_role guarantees raw and code are mutually exclusive, so a row
-- reaching here with a code has raw NULL and vice versa.
top_place AS (
  SELECT DISTINCT ON (person_id) person_id, place_kind, place_code, place_raw
  FROM roles WHERE place_code IS NOT NULL OR place_raw IS NOT NULL
  ORDER BY person_id, prom DESC, start_date DESC NULLS LAST, ref
),
-- Folded multi-valued facts. Space-PADDED so an ILIKE '% mp %' cannot also match
-- 'mp_something' and a '% ngo %' cannot match 'ngo_board' — the filter over-selects
-- silently otherwise (plan F6).
folds AS (
  SELECT person_id,
         ' ' || string_agg(DISTINCT role, ' ' ORDER BY role)   || ' ' AS role_codes,
         ' ' || string_agg(DISTINCT facet, ' ' ORDER BY facet) || ' ' AS facet_codes,
         count(*)::smallint                                          AS roles_n,
         count(DISTINCT source)::smallint                            AS sources_n,
         -- Membership tests, NOT the representative source: 503 people hold both an
         -- executive and a municipal post, so `source` cannot answer either question.
         -- is_exec/is_muni mirror 100_officials_rankings.sql exactly — and the source
         -- list is the SQL mirror of OFFICIAL_DECLARATION_SOURCES (src/lib/officialSources.ts),
         -- NOT a `source LIKE 'official%'` test: president/mep/diplomat do not start with
         -- "official" and a prefix test drops 227 of them (Станишев, Бареков, every
         -- ambassador). person_browse.data.test.ts asserts the lockstep.
         bool_or(source IN ('official_exec', 'public_sector', 'president', 'mep',
                            'diplomat'))                             AS is_exec,
         bool_or(source = 'official_muni')                           AS is_muni,
         bool_or(source = 'mp')                                      AS is_mp,
         bool_or(source = 'magistrate')                              AS is_magistrate,
         bool_or(source = 'ngo')                                     AS is_ngo,
         bool_or(source = 'tr')                                      AS is_company,
         bool_or(source = 'candidate')                               AS is_candidate,
         bool_or(source = 'donor')                                   AS is_donor,
         -- Did this person ever actually HOLD a post? 52% of the corpus is candidate-only
         -- — people who stood for office and did not take one — so the browser needs to be
         -- able to set them aside without pretending they are not in the register.
         --
         -- A DENY-list of the four non-office sources, not an allow-list of offices: a new
         -- officials category (the way president/mep/diplomat were added) should count as
         -- office by DEFAULT. An allow-list would silently exclude it, which is the exact
         -- failure officialSources.ts documents costing 227 people their place.
         bool_or(source NOT IN ('candidate', 'tr', 'ngo', 'donor'))  AS held_office
  FROM roles GROUP BY person_id
),
party_fold AS (
  SELECT person_id,
         count(DISTINCT party)::smallint AS parties_n,
         ' ' || string_agg(DISTINCT party, ' ' ORDER BY party) || ' ' AS party_codes
  FROM roles WHERE party IS NOT NULL GROUP BY person_id
),
-- Every oblast the person holds ANY role in — the FILTER target. Filtering on the
-- representative scalar instead drops 1,851 people from an oblast they genuinely serve
-- (a candidate in Варна who is also a councillor in Бургас), which reads as "no such
-- people" rather than as a narrowed view. Plan F10.
--
-- The judicial arm is a TWO-HOP: a judicial place_code is a judicial_body.body_code, not
-- a place, so a single join to place_dim leaves oblast NULL for all 2,676 magistrates.
-- All 284 bodies carry their own place_code resolving to an obshtina with an oblast.
role_oblast AS (
  SELECT r.person_id,
         COALESCE(pd.oblast_code, jpd.oblast_code) AS oblast_code
  FROM roles r
  LEFT JOIN place_dim pd
    ON pd.kind = r.place_kind AND pd.code = r.place_code
  LEFT JOIN judicial_body jb
    ON r.place_kind = 'judicial' AND jb.body_code = r.place_code
  LEFT JOIN place_dim jpd
    ON jpd.kind = 'obshtina' AND jpd.code = jb.place_code
  WHERE COALESCE(pd.oblast_code, jpd.oblast_code) IS NOT NULL
),
oblast_fold AS (
  SELECT person_id,
         ' ' || string_agg(DISTINCT oblast_code, ' ' ORDER BY oblast_code) || ' '
           AS oblast_codes
  FROM role_oblast GROUP BY person_id
),
-- Photos: two sources, two DIFFERENT join keys, coalesced MP-first.
--   mp_profile        keyed by mp_id      → person_role(source='mp').ref   (2,120 people)
--   official_candidate_link keyed by official_slug → person_role(officials).ref (≤192)
-- mp_roster, despite the name, carries no photo at all.
photo AS (
  SELECT DISTINCT ON (r.person_id) r.person_id, m.photo_url
  FROM roles r
  JOIN mp_profile m ON r.source = 'mp' AND m.mp_id::text = r.ref
  WHERE m.photo_url IS NOT NULL
  ORDER BY r.person_id, m.mp_id
),
photo_official AS (
  SELECT DISTINCT ON (r.person_id) r.person_id, l.photo_url
  FROM roles r
  JOIN official_candidate_link l ON l.official_slug = r.ref
  WHERE r.source IN ('official_exec', 'official_muni', 'public_sector',
                     'president', 'mep', 'diplomat')
    AND l.photo_url IS NOT NULL
  ORDER BY r.person_id, l.official_slug
),
-- Wealth: newest year at ANY tier, and the previous year PRESENT in the series (not
-- latest-1, which reports a bogus zero delta across a filing gap). Same rules as 100 —
-- person_wealth_year (090) already decided which filing speaks for a year, and
-- re-deciding it here would make /persons and /person disagree about a net worth.
latest AS (
  SELECT DISTINCT ON (w.person_id)
         w.person_id, w.period_year, w.net_eur, w.excluded_asset_rows
  FROM person_wealth_year w
  JOIN pub ON pub.person_id = w.person_id
  ORDER BY w.person_id, w.period_year DESC, w.declaration_id DESC
),
prev AS (
  -- excluded_asset_rows rides along so the delta can be guarded at BOTH ends — see the
  -- delta_pct CASE. Selecting only net_eur discards the information before the guard can
  -- use it, which is the shape of the asymmetry 100_officials_rankings.sql still carries.
  SELECT DISTINCT ON (w.person_id) w.person_id, w.net_eur, w.excluded_asset_rows
  FROM person_wealth_year w
  JOIN latest l ON l.person_id = w.person_id AND w.period_year < l.period_year
  ORDER BY w.person_id, w.period_year DESC
),
filed AS (
  -- Filed ANYTHING, any tier — deliberately against `declaration`, not the wealth
  -- series, which only carries years with valued assets. Keying this off `latest` would
  -- merely restate `net_worth_eur IS NULL` and erase the distinction the column exists
  -- to make: "filed, declared nothing of value" vs "nothing on record".
  SELECT DISTINCT person_id FROM declaration WHERE person_id IS NOT NULL
),
-- Institution: the magistrate's court, else the newest officials-tier declaration's.
inst AS (
  SELECT DISTINCT ON (r.person_id) r.person_id, jb.name AS institution,
         jb.kind AS judicial_kind, jb.tier AS judicial_tier
  FROM roles r
  JOIN judicial_body jb ON r.place_kind = 'judicial' AND jb.body_code = r.place_code
  ORDER BY r.person_id, r.prom DESC, jb.body_code
),
decl_inst AS (
  SELECT DISTINCT ON (d.person_id) d.person_id, d.institution
  FROM declaration d
  WHERE d.tier IN ('exec', 'muni') AND d.person_id IS NOT NULL
    AND d.institution IS NOT NULL
  ORDER BY d.person_id, d.declaration_year DESC, d.declaration_id DESC
),
-- Bridge A: the (person, company) pair is reachable from a CURATED table — the declared
-- links (company_politicians) and the ИВСС чл.175а magistrate holdings. Everything else
-- a person holds in TR got there through Bridge B (name discovery, gated at resolve time
-- on fold people-uniqueness + a 3-part name + a ≤5-company footprint), which is what the
-- 'name_match' caveat on the page is about.
bridge_a AS (
  SELECT DISTINCT pr.person_id, cp.eik AS uic
    FROM company_politicians cp
    JOIN person_role pr
      ON (cp.kind = 'mp' AND pr.source = 'mp'
          AND pr.ref = replace(cp.ref, '/candidate/mp-', ''))
      OR (cp.kind = 'official'
          AND pr.source IN ('official_exec', 'official_muni', 'public_sector')
          AND pr.ref = replace(cp.ref, '/officials/', ''))
  UNION
  SELECT DISTINCT pr.person_id, mc.eik
    FROM magistrate_company mc
    JOIN person_role pr ON pr.source = 'magistrate' AND pr.ref = mc.magistrate_name
   WHERE mc.eik IS NOT NULL AND NOT mc.eik_ambiguous
),
companies AS (
  SELECT person_id, ref AS uic FROM roles WHERE source = 'tr' GROUP BY 1, 2
),
company_money AS (
  -- Per (person, company) first, so a person holding several companies sums each once. `eur` is
  -- the contracts-only figure (public persons, must equal the profile's procuredEur); `broad_eur`
  -- adds subsidies + funds and is used for VERIFIED PRIVATE owners (S4), whose money-link boundary
  -- is broad — else a subsidy/fund-only owner shows €0 despite being selected on that money.
  SELECT c.person_id, c.uic,
         (SELECT round(sum(ct.amount_eur)::numeric, 2)
            FROM contracts ct
           WHERE ct.contractor_eik = c.uic
             AND ct.tag = 'contract'
             AND ct.consortium_role IS DISTINCT FROM 'member') AS eur,
         coalesce((SELECT round(sum(ct.amount_eur)::numeric, 2) FROM contracts ct
                    WHERE ct.contractor_eik = c.uic AND ct.tag = 'contract'
                      AND ct.consortium_role IS DISTINCT FROM 'member'), 0)
       + coalesce((SELECT round(sum(a.total_eur)::numeric, 2)
                     FROM agri_subsidies a WHERE a.eik = c.uic), 0)
       + coalesce((SELECT round(sum(fb.paid_eur)::numeric, 2)
                     FROM fund_beneficiaries fb WHERE fb.eik = c.uic), 0) AS broad_eur
  FROM companies c
),
money AS (
  SELECT m.person_id,
         count(*)::smallint                       AS companies_n,
         -- contracts-only for public figures (profile reconciliation); broad for verified privates.
         round(sum(CASE WHEN pub.is_public_figure THEN m.eur ELSE m.broad_eur END)::numeric, 2)
           ::double precision                      AS public_money_eur,
         -- bool_AND for 'declared', not bool_or: one curated company among several
         -- name-matched ones is 'mixed', which still earns the caveat. See the header.
         CASE WHEN bool_and(a.uic IS NOT NULL) THEN 'declared'
              WHEN bool_or(a.uic IS NOT NULL)  THEN 'mixed'
              ELSE 'name_match' END
           AS tr_link_basis
  FROM company_money m
  JOIN pub ON pub.person_id = m.person_id
  LEFT JOIN bridge_a a ON a.person_id = m.person_id AND a.uic = m.uic
  GROUP BY m.person_id
),
-- ── NAME-FOLD PRIVATE ARM (S3) ──────────────────────────────────────────────
-- Money-linked TR officers/owners who are NOT already a public person, browseable as частен
-- сектор WITHOUT the resolver (identity is name-fold only).
-- NOTE — DUAL MONEY BASIS: public_money_eur is contracts-ONLY on the person arm (it must equal the
-- profile's procuredEur, see the MONEY header) but BROAD here (contracts ∪ subsidies ∪ funds — an
-- owner reachable only through a subsidy still counts, matching person_search's tier boundary). So
-- under ?sector=all the money column mixes two bases; the S3b UI caveats it per row (name_fold →
-- broad). This is the same intentional split person_search carries. Anti-joined
-- against the public folds so a fold already a public person is served by the person arm alone.
-- Money-linked ONLY (tier V): the long-tail non-money owners (N) are search-only, never browsed.
nf_money_eik AS (
  SELECT eik, sum(eur) AS eur FROM (
    SELECT contractor_eik AS eik, amount_eur AS eur
      FROM contracts
     WHERE contractor_eik <> '' AND tag = 'contract'
       AND consortium_role IS DISTINCT FROM 'member'   -- same basis as the person arm
    UNION ALL SELECT eik, total_eur FROM agri_subsidies     WHERE eik IS NOT NULL
    UNION ALL SELECT eik, paid_eur  FROM fund_beneficiaries WHERE eik IS NOT NULL
  ) x WHERE eur IS NOT NULL GROUP BY eik
),
nf_company AS (
  -- Per (fold, company): the company's money once, so a multi-company owner sums each once.
  SELECT o.name_fold, o.uic, min(o.name) AS name, max(coalesce(m.eur, 0)) AS eur
  FROM tr_officers o
  LEFT JOIN nf_money_eik m ON m.eik = o.uic
  GROUP BY o.name_fold, o.uic
),
nf_owner AS (
  SELECT name_fold,
         min(name)                                          AS name,
         count(*)::smallint                                 AS companies_n,
         round(sum(eur)::numeric, 2)::double precision      AS public_money_eur
  FROM nf_company
  -- Anti-join against ALL persons, not just `pub`: a fold already a PUBLIC person is served by
  -- the person arm, AND a fold matching a GATED person (inactive / is_public_figure=false) must
  -- NOT surface here either — that person is deliberately withheld, so the §6 gate extends to the
  -- name-fold arm this way. (Name-fold identity is a NAME match, so this cannot be perfect — a
  -- genuine namesake of a gated person is also dropped — but it never LEAKS a gated person.)
  WHERE name_fold NOT IN (SELECT name_fold FROM person WHERE name_fold IS NOT NULL)
    -- Person-shape gate: EXACTLY 3 all-LETTER folded tokens (a Bulgarian first-patronymic-family
    -- name), and no company legal-form token. translit_bg_latin lowercases + maps Cyrillic to a-z
    -- and collapses hyphens/whitespace, so the fold is over [a-z ]. In order of how badly each led
    -- the money/name sort, this drops: the 2-token redaction placeholder "Заличено обстоятелство."
    -- (2,986 companies, €2.85bn); the many-token "…ЕООД, представлявано в УС от …" officer strings;
    -- digit/quote company names like „17 Инвестмънтс" ЕООД (non-letter chars fail [a-z ]); and
    -- legal entities that are THEMSELVES owners, "Х Y ЕООД" (3 letter tokens but a company form).
    -- A 3-token company with no legal-form word still slips through — badged name_fold like the
    -- rest. Mirrors the Tier-V verified rule minus the uniqueness/≤5-firm cap. (Search —
    -- person_search N/V — deliberately stays broader; browse is where a junk row leads a sort.)
    AND name_fold ~ '^[a-z]+ [a-z]+ [a-z]+$'
    AND name_fold !~ '(^| )(eood|ood|ad|ead|et|dzzd|kd|sd|zad|ndp|zzd)( |$)'
  GROUP BY name_fold
  HAVING sum(eur) > 0
)
SELECT
  'slug:' || pub.slug                                AS key,
  -- tier follows is_public_figure, NOT the arm: a verified private (S4) is in this person arm but
  -- is_public_figure=false, so it is tier V and ?sector=public (tier=P) still excludes it.
  CASE WHEN pub.is_public_figure THEN 'P' ELSE 'V' END::char(1)  AS tier,
  -- position_type CODE: the six governance buckets keep their facet; company/concession collapse
  -- to private_sector; every other facet keeps its own code (all 'public' for the ?sector toggle).
  CASE WHEN tr.facet IN ('company', 'concession') THEN 'private_sector'
       ELSE tr.facet END                             AS position_type,
  pub.identity_confidence                            AS identity_confidence,
  pub.slug,
  pub.display_name                                   AS name,
  pub.name_fold,
  COALESCE(ph.photo_url, pho.photo_url)              AS photo_url,
  pub.namesake_risk,
  tr.role                                            AS primary_role,
  tr.facet                                           AS primary_facet,
  tr.prom                                            AS prominence,
  f.role_codes,
  f.facet_codes,
  f.roles_n,
  f.sources_n,
  f.is_exec, f.is_muni, f.is_mp, f.is_magistrate,
  f.is_ngo, f.is_company, f.is_candidate, f.is_donor, f.held_office,
  tp.party                                           AS party_primary,
  pf.parties_n,
  pf.party_codes,
  pl.place_kind,
  pl.place_code,
  -- The label expression is COPIED VERBATIM from 082_person_api.sql (the /person role
  -- tile). A different one here means the browser and the profile print different place
  -- names for the same seat. `name_en` is pd-only ON PURPOSE — judicial_body carries no
  -- English name — so mirror that asymmetry rather than inventing a fallback.
  COALESCE(
    CASE WHEN pd.kind = 'settlement' AND pd.settlement_type IS NOT NULL
         THEN pd.settlement_type || ' ' || pd.name_bg END,
    pd.name_bg, jb.name, pl.place_raw)               AS place_label,
  pd.name_en                                         AS place_label_en,
  COALESCE(pd.oblast_code, jpd.oblast_code)          AS oblast_code,
  ob.oblast_codes,
  -- NOT place_dim.obshtina_code: that column is a settlement's PARENT obshtina and is NULL
  -- on the 295 obshtina rows themselves (where the code IS the obshtina) and on all 31 mir
  -- rows. Reading it here made this column NULL for every person — a filter that silently
  -- matched nobody. A мир spans several obshtini, so it correctly has none.
  --
  -- The 'settlement' arm is the exception, and it is exactly why the column is a CASE: a
  -- village mayor's place IS a settlement, whose parent obshtina is the thing ?obshtina
  -- filters on. Without this arm the 10,721 village-mayor roles that gained a settlement
  -- place in §T2 would silently drop out of that filter — green everywhere, wrong on one
  -- control.
  CASE
    WHEN pl.place_kind = 'obshtina'   THEN pl.place_code
    WHEN pl.place_kind = 'settlement' THEN pd.obshtina_code
    WHEN pl.place_kind = 'judicial'   THEN jb.place_code
  END                                                AS obshtina_code,
  COALESCE(i.institution, di.institution)            AS institution,
  i.judicial_kind,
  i.judicial_tier,
  l.period_year                                      AS latest_declaration_year,
  (fl.person_id IS NOT NULL)                         AS has_declaration,
  -- ::double precision, NOT bare numeric. node-postgres serializes PG `numeric` as a
  -- STRING to preserve arbitrary precision, so a numeric column arrives in the browser as
  -- "211682.40" and every downstream `formatEurCompact` / arithmetic silently produces an
  -- empty cell or NaN. `contracts.amount_eur` is double precision for exactly this reason,
  -- which is why the contracts browser never hit it. Round FIRST (determinism at rest,
  -- reference_pg_payload_determinism), then cast.
  round(l.net_eur, 2)::double precision              AS net_worth_eur,
  COALESCE(l.excluded_asset_rows, 0)                 AS excluded_asset_rows,
  -- Guard the ratio: a previous net worth of 0 (or negative — the corpus has both) makes
  -- a percentage meaningless rather than infinite. Suppressed when EITHER end is
  -- INCOMPLETE, not just the latest one: a partial latest over a whole base manufactures a
  -- collapse, and a whole latest over a partial base manufactures a SURGE — the more
  -- newsworthy direction, and so the more damaging one to publish about a named person.
  -- (Zero rows are affected today; the asymmetry is latent, which is why it is written
  -- down rather than left to be rediscovered.) The UI shows an asterisk instead.
  CASE WHEN pv.net_eur > 0
        AND COALESCE(l.excluded_asset_rows, 0) = 0
        AND COALESCE(pv.excluded_asset_rows, 0) = 0
       THEN round(((l.net_eur - pv.net_eur) / pv.net_eur) * 100, 2)::double precision
  END                                                AS delta_pct,
  mo.companies_n,
  mo.public_money_eur,
  mo.tr_link_basis
FROM pub
-- INNER: a person with no public-safe role has nothing to show and nothing to filter on.
JOIN top_role tr        ON tr.person_id  = pub.person_id
JOIN folds f            ON f.person_id   = pub.person_id
LEFT JOIN top_party tp  ON tp.person_id  = pub.person_id
LEFT JOIN party_fold pf ON pf.person_id  = pub.person_id
LEFT JOIN top_place pl  ON pl.person_id  = pub.person_id
LEFT JOIN place_dim pd  ON pd.kind = pl.place_kind AND pd.code = pl.place_code
LEFT JOIN judicial_body jb  ON pl.place_kind = 'judicial' AND jb.body_code = pl.place_code
LEFT JOIN place_dim jpd ON jpd.kind = 'obshtina' AND jpd.code = jb.place_code
LEFT JOIN oblast_fold ob ON ob.person_id = pub.person_id
LEFT JOIN photo ph      ON ph.person_id  = pub.person_id
LEFT JOIN photo_official pho ON pho.person_id = pub.person_id
LEFT JOIN latest l      ON l.person_id   = pub.person_id
LEFT JOIN prev pv       ON pv.person_id  = pub.person_id
LEFT JOIN filed fl      ON fl.person_id  = pub.person_id
LEFT JOIN inst i        ON i.person_id   = pub.person_id
LEFT JOIN decl_inst di  ON di.person_id  = pub.person_id
LEFT JOIN money mo      ON mo.person_id  = pub.person_id
UNION ALL
-- The name-fold private arm. Same 46 columns; governance-only fields are NULL (their columns are
-- nullable, and the untyped NULLs adopt the person arm's types). These rows carry NO slug — they
-- route by name (href built client-side from `name`) — so `key` is the unique paging identity.
SELECT
  'fold:' || nf.name_fold,                           -- key
  'V'::char(1),                                      -- tier
  'private_sector',                                  -- position_type
  'name_fold',                                       -- identity_confidence
  NULL,                                              -- slug
  nf.name,                                           -- name
  nf.name_fold,                                      -- name_fold
  NULL,                                              -- photo_url
  NULL,                                              -- namesake_risk
  NULL,                                              -- primary_role
  'company',                                         -- primary_facet
  10::smallint,                                      -- prominence (below every public post)
  NULL,                                              -- role_codes
  ' company ',                                       -- facet_codes
  NULL, NULL,                                        -- roles_n, sources_n
  false, false, false, false,                        -- is_exec, is_muni, is_mp, is_magistrate
  false, true, false, false, false,                  -- is_ngo, is_company, is_candidate, is_donor, held_office
  NULL, NULL, NULL,                                  -- party_primary, parties_n, party_codes
  NULL, NULL, NULL, NULL,                            -- place_kind, place_code, place_label, place_label_en
  NULL, NULL, NULL,                                  -- oblast_code, oblast_codes, obshtina_code
  NULL, NULL, NULL,                                  -- institution, judicial_kind, judicial_tier
  NULL,                                              -- latest_declaration_year
  false,                                             -- has_declaration
  NULL,                                              -- net_worth_eur
  0,                                                 -- excluded_asset_rows
  NULL,                                              -- delta_pct
  nf.companies_n,                                    -- companies_n
  nf.public_money_eur,                               -- public_money_eur
  'name_match'                                       -- tr_link_basis
FROM nf_owner nf;

-- Index BOTH sides of every join key and every sortable column the registry exposes
-- (reference_pg_query_performance). `key` is the paging tiebreak buildOrder appends (it replaced
-- slug when the name-fold arm — which has NO slug — landed), so it must be UNIQUE. `slug` stays a
-- plain index for /person lookups; it is UNIQUE among the public rows and NULL on name-fold rows.
CREATE UNIQUE INDEX idx_person_browse_key ON person_browse_table (key);
CREATE INDEX idx_person_browse_slug ON person_browse_table (slug);
-- The default sort. DESC on prominence, ASC on name — matching the registry exactly, or
-- the planner sorts instead of scanning.
CREATE INDEX idx_person_browse_prominence
  ON person_browse_table (prominence DESC, name, key);
-- NULLS LAST is not cosmetic: both figures are NULL for most of the corpus (39,764 have
-- no declared net worth, 55,731 no ЗОП money), so the browser sorts DESC NULLS LAST to
-- keep them off the top — and a plain DESC index is NULLS FIRST, which the planner will
-- not use for that ordering.
CREATE INDEX idx_person_browse_net
  ON person_browse_table (net_worth_eur DESC NULLS LAST, key);
CREATE INDEX idx_person_browse_money
  ON person_browse_table (public_money_eur DESC NULLS LAST, key);
CREATE INDEX idx_person_browse_parties
  ON person_browse_table (parties_n DESC NULLS LAST, key);
-- BOTH search:true columns need a trigram index, not just `name_fold`. buildWhere ORs
-- every search column into ONE predicate, so an unindexed arm forces a seq scan over the
-- whole OR — which does not merely slow `institution` down, it stops the name index being
-- used at all. Adding a search:true column to the registry means adding its index here.
CREATE INDEX idx_person_browse_name_trgm
  ON person_browse_table USING gin (name_fold gin_trgm_ops);
CREATE INDEX idx_person_browse_institution_trgm
  ON person_browse_table USING gin (institution gin_trgm_ops);
-- The space-padded code sets are matched with ILIKE '% code %' — a leading wildcard, so
-- only a trigram index can serve them.
CREATE INDEX idx_person_browse_role_codes_trgm
  ON person_browse_table USING gin (role_codes gin_trgm_ops);
CREATE INDEX idx_person_browse_party_codes_trgm
  ON person_browse_table USING gin (party_codes gin_trgm_ops);
CREATE INDEX idx_person_browse_facet_codes_trgm
  ON person_browse_table USING gin (facet_codes gin_trgm_ops);
CREATE INDEX idx_person_browse_oblast_codes_trgm
  ON person_browse_table USING gin (oblast_codes gin_trgm_ops);
-- Equality filters + facet GROUP BYs.
CREATE INDEX idx_person_browse_facet ON person_browse_table (primary_facet);
-- position_type (the ?position filter + mix-bar partition).
CREATE INDEX idx_person_browse_position ON person_browse_table (position_type);
-- The ?sector control filters `tier` (public→P, private→V, all→P,V), and P is the default floor,
-- so the default page is `tier='P'` + the default sort. Lead with tier so that page is a single
-- index scan over the public arm, not a scan-and-filter over all 118k. (NB: `tier`, not
-- `position_type <> 'private_sector'` — those are DIFFERENT sets: a public figure whose top role
-- is a company is tier='P' yet position_type='private_sector', and must stay on the public page.)
CREATE INDEX idx_person_browse_tier_default
  ON person_browse_table (tier, prominence DESC, name, key);
-- Money sort on the default (public) population: the name-fold V arm's broad-basis figures are the
-- largest and would otherwise dominate the head of the un-tiered money index, so a public
-- money-sorted page scans past them. Partial on the default floor keeps it an index scan.
CREATE INDEX idx_person_browse_money_public
  ON person_browse_table (public_money_eur DESC NULLS LAST, key) WHERE tier = 'P';
CREATE INDEX idx_person_browse_role ON person_browse_table (primary_role);
CREATE INDEX idx_person_browse_party ON person_browse_table (party_primary);
CREATE INDEX idx_person_browse_oblast ON person_browse_table (oblast_code);
CREATE INDEX idx_person_browse_obshtina ON person_browse_table (obshtina_code);
CREATE INDEX idx_person_browse_place ON person_browse_table (place_kind, place_code);
CREATE INDEX idx_person_browse_year ON person_browse_table (latest_declaration_year);
-- Partial indexes: the membership filters the UI issues, each paired with the DEFAULT
-- sort so a facet-scoped first page is one index scan rather than a filter over 56.8k.
CREATE INDEX idx_person_browse_exec
  ON person_browse_table (prominence DESC, name, key) WHERE is_exec;
CREATE INDEX idx_person_browse_muni
  ON person_browse_table (prominence DESC, name, key) WHERE is_muni;
CREATE INDEX idx_person_browse_decl
  ON person_browse_table (prominence DESC, name, key) WHERE has_declaration;
CREATE INDEX idx_person_browse_company
  ON person_browse_table (prominence DESC, name, key) WHERE is_company;
CREATE INDEX idx_person_browse_held
  ON person_browse_table (prominence DESC, name, key) WHERE held_office;
