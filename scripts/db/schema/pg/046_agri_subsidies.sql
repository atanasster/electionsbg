-- ДФ „Земеделие" (CAP paying agency) subsidy corpus → PG, so the /subsidies
-- dashboard + the "Земеделски субсидии" tile on /company/:eik are DB-served, and
-- every recipient EIK joins the unified entity graph (agri_subsidies.eik =
-- contracts.contractor_eik = fund_beneficiaries.eik = tr_companies.uic).
--
-- Loaded directly by scripts/agri/ingest.ts (raw egov/СЕУ sheets → normalised →
-- PG; no JSON intermediary — there is no data/agri/ shard tree, the app serves
-- from PG only). All money is EUR (converted at ingest). Individuals carry no EIK
-- (name+oblast only); the detail table keeps them for the browse, but attributable
-- analytics (top recipients, concentration) are legal-entity-only and precomputed
-- in the ingest, stored verbatim below.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Per (year × beneficiary × scheme) detail row — the browse + per-EIK scope. --
CREATE TABLE IF NOT EXISTS agri_subsidies (
  id           bigserial PRIMARY KEY,
  year         integer NOT NULL,
  eik          text,               -- legal-entity id; NULL for individuals
  name         text NOT NULL,
  oblast       text,
  scheme       text,               -- Мярка (short measure code)
  scheme_desc  text,               -- Описание (full scheme name)
  dp_eur       double precision,   -- ЕФГЗ-ДП  (direct payments)
  market_eur   double precision,   -- ЕФГЗ     (market measures)
  rural_eur    double precision,   -- ЕЗФРСР-НБ (rural development)
  total_eur    double precision    -- Общо
);

-- Entity join (company/awarder pages) + the SCOPED browse (/company/:eik).
CREATE INDEX IF NOT EXISTS idx_agri_eik ON agri_subsidies (eik);
-- Scoped browse fast-path: filter eik, then sort by money with a stable tiebreak.
CREATE INDEX IF NOT EXISTS idx_agri_eik_total
  ON agri_subsidies (eik, total_eur DESC NULLS LAST, id);
-- UNSCOPED / global browse default sort (money desc) — index-only page walk.
CREATE INDEX IF NOT EXISTS idx_agri_total
  ON agri_subsidies (total_eur DESC NULLS LAST, id);
-- Facet filters (year / oblast are the browse toolbar facets). COVERING on
-- total_eur so a facet-filtered browse serves BOTH its page (WHERE col IN (…)
-- ORDER BY total_eur DESC, id → ordered index scan, no sort) AND its footer
-- aggregate (count + sum(total_eur) → index-only scan, no heap) from one index.
-- Measured: an oblast-filtered aggregate went 410ms (seq scan 2M) → ~10-23ms
-- (index-only); the unfiltered corpus sum went 374ms → ~72ms warm (parallel
-- index-only over idx_agri_year_total, which carries total_eur).
-- NB: only CREATE IF NOT EXISTS here (no DROP+CREATE) — the loader applies this
-- schema BEFORE it TRUNCATEs, so a rebuild on the still-populated table would
-- parallel-build the index and can exhaust the container's /dev/shm. On an empty
-- (fresh) table the index is created instantly and then maintained incrementally
-- as rows insert — same pattern as every other loader.
CREATE INDEX IF NOT EXISTS idx_agri_year_total
  ON agri_subsidies (year, total_eur DESC NULLS LAST, id);
CREATE INDEX IF NOT EXISTS idx_agri_oblast_total
  ON agri_subsidies (oblast, total_eur DESC NULLS LAST, id);
CREATE INDEX IF NOT EXISTS idx_agri_scheme ON agri_subsidies (scheme);
-- Free-text beneficiary search in the browse toolbar.
CREATE INDEX IF NOT EXISTS idx_agri_name_trgm
  ON agri_subsidies USING gin (name gin_trgm_ops);

-- 2. Precomputed page payloads (verbatim), keyed by (kind, key). ----------------
--    'overview' (key '')      → the national /subsidies dashboard payload
--    'recipient' (key = eik)  → per-legal-entity rollup (/farm/:eik + company tile)
-- Storing them verbatim (computed once in the ingest against the full corpus)
-- makes local↔cloud parity byte-exact and every fetch an O(1) PK seek — same
-- rationale as fund_payloads (043).
CREATE TABLE IF NOT EXISTS agri_payloads (
  kind    text  NOT NULL,
  key     text  NOT NULL DEFAULT '',
  payload jsonb NOT NULL,
  PRIMARY KEY (kind, key)
);

-- ==========================================================================
-- Beneficiary DIMENSION + typeahead for the /subsidies search box.
--
-- SERVER-SIDE, unlike every other sector group, because 16,702 distinct EIKs is
-- past the ~5k point where shipping a client index stops being free.
--
-- THE DIMENSION IS THE POINT. The obvious form — GROUP BY eik over
-- agri_subsidies with an ILIKE — measured **2,152 ms** for "агро" on the local
-- corpus, because it aggregates every matching row of ~2M before it can rank.
-- That is a per-KEYSTROKE query. Rolled up once into 16.7k rows it is an index
-- scan over a table that fits in cache.
--
-- Only EIK-bearing rows: /farm/:eik is the destination, so a beneficiary
-- without one (a natural person — `eik` is NULL for those) cannot be a result.
-- Same per-row landing rule the НЗОК hospital group applies.
--
-- DROP+CREATE, not IF NOT EXISTS — see the fuller note in 017_company_relationships.sql.
-- `IF NOT EXISTS` is a no-op once the matview exists, so an edit to any of the rules
-- written down above — the LONGEST-spelling pick, the EIK-only restriction, the stored
-- Latin fold — would reach a fresh clone and nothing else, while ingest.ts kept
-- REFRESHing it (scripts/agri/ingest.ts). Those rules each exist because a previous
-- spelling was wrong on thousands of rows, which is exactly the kind of change that must
-- propagate. Verified before changing: no stored-query dependent (so no CASCADE), and the
-- added populate is 1.78 s over agri_subsidies' ~2.5M rows.
--
-- ⚠️ THAT "no stored-query dependent" CLAUSE IS NO LONGER TRUE — `agri_beneficiary_year`
-- below SELECTs from this matview, which records a pg_depend edge. The DROP therefore has
-- to take the dependent first, which is the line immediately beneath this comment. Both
-- live in THIS file, so the ordering is under one author's control and the generic gate
-- (migration_drop_dependents.data.test.ts) only fails on a dependent owned by a DIFFERENT
-- file. Never make it `DROP … CASCADE`: that succeeds, deletes the dependent and exits 0,
-- which is the silent half of the 003 defect CLAUDE.md records.
-- ==========================================================================
DROP MATERIALIZED VIEW IF EXISTS agri_scheme_year;
DROP MATERIALIZED VIEW IF EXISTS agri_beneficiary_year;
DROP MATERIALIZED VIEW IF EXISTS agri_beneficiary;
CREATE MATERIALIZED VIEW agri_beneficiary AS
  SELECT eik,
         -- The LONGEST spelling, matching what the ingest stores on the
         -- /farm page. min() picked a different one for 1,379 of 16,702
         -- beneficiaries (8.3%), so the row said one name and the page it
         -- opened said another.
         (array_agg(name ORDER BY length(name) DESC, name COLLATE "C"))[1]
           AS name,
         min(oblast COLLATE "C") AS oblast,
         sum(total_eur)          AS total_eur,
         -- The Latin fold, STORED. This is the one server-backed search group
         -- that can afford it: 16.7k rows, so the fold costs a column rather
         -- than a per-request expression. Without it "zlatiya" returns nothing
         -- against "Златия Агро" — the same gap /sector/administration has to
         -- state in its copy, closed here instead.
         translit_bg_latin(
           (array_agg(name ORDER BY length(name) DESC, name COLLATE "C"))[1]
         ) AS name_fold
  FROM agri_subsidies
  WHERE eik IS NOT NULL
    -- ДФ „Земеделие" itself. It appears in the corpus as a counterparty, is #2
    -- by money, and has NO /farm page — so without this it is the first result
    -- for "земеделие" and the single row in 16,702 that cannot land. Kept in
    -- sync with PAYER_EIKS in scripts/agri/ingest.ts.
    AND eik <> '121100421'
  GROUP BY eik;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agri_beneficiary_eik
  ON agri_beneficiary (eik);
CREATE INDEX IF NOT EXISTS idx_agri_beneficiary_name_trgm
  ON agri_beneficiary USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_agri_beneficiary_fold_trgm
  ON agri_beneficiary USING gin (name_fold gin_trgm_ops);
-- The ranking the typeahead orders by, so a broad term stops at the cap.
CREATE INDEX IF NOT EXISTS idx_agri_beneficiary_total
  ON agri_beneficiary (total_eur DESC);

-- ==========================================================================
-- The SCOPED twin — one row per (scope × beneficiary), behind the ranked
-- /subsidies/recipients page.
--
-- WHY A SECOND MATVIEW RATHER THAN A YEAR COLUMN ON THE FIRST. Two consumers
-- want different things from the same rollup and merging them breaks the cheaper
-- one. `agri_beneficiary` is keyed UNIQUE (eik) and backs the per-keystroke
-- typeahead (3 ms, against 2,152 ms for the GROUP-BY form) — a year dimension
-- destroys that key and multiplies every search hit by the number of years the
-- farm appears in. And search must FIND a farm whatever year the reader has
-- selected: „вашата фирма не съществува" is a far worse answer than „вашата
-- фирма няма плащания през 2025", so the finder stays on the all-time view and
-- only the ranked PAGE is scoped (scope ranks, it never filters).
--
-- `scope_key` IS THE `agri_payloads` KEY, not a year. Same ten values the
-- overview payloads use — '' (the latest financial year, i.e. the default
-- scope), each covered year as text, and 'all' — so a scope the hub can resolve
-- is a scope this ranking can serve, by construction rather than by agreement.
-- `agri_beneficiary_year.data.test.ts` asserts the two key sets are equal; the
-- '' partition is a deliberate duplicate of the latest year for that reason.
--
-- THE NAME AND OBLAST COME FROM `agri_beneficiary`, NOT from a per-scope
-- re-derivation. Deriving them per scope would let one EIK show a different
-- spelling on 2015 than on 2025 — the exact defect the LONGEST-spelling rule
-- above exists to prevent, reintroduced one table over. Joining the sibling also
-- makes the 'all' partition's money equal the typeahead's by construction, so
-- those two can never drift.
--
-- Consequences of that join, both real and both handled: the DROP above must
-- take this matview FIRST (pg_depend), and `scripts/agri/ingest.ts` must REFRESH
-- `agri_beneficiary` BEFORE this one or the labels are a vintage behind.
--
-- ⚠️ WHAT THE JOIN DOES AND DOES NOT GUARANTEE. It fixes the LABEL — one EIK, one
-- spelling, one oblast, whatever scope you read. It does NOT make the money agree
-- with the typeahead "by construction": `total_eur` below is re-aggregated from
-- `src`, and the 'all' partition matches `agri_beneficiary` only because the two
-- WHERE clauses are duplicated. Re-derive the name per scope and every money
-- assertion still passes while the label defect ships, which is why
-- `agri_beneficiary_year.data.test.ts` gates the name property directly.
--
-- SIZE: 8 years × ~9k entities + 16.7k all-time + ~8.4k for '' ≈ 101k rows.
-- COST: the body is 1.56 s (387,598 rows through `src`, hash-joined against
-- 16,701 `agri_beneficiary` rows) plus two index builds — and it is paid TWICE
-- per `db:load:agri:pg`, once here (exec(schemaSql) runs at the top of
-- runAgriIngest, so the CREATE populates against the PRE-load corpus) and once
-- at the REFRESH after the publish. That is the same double cost
-- `agri_beneficiary` carries, and the reason neither REFRESH in ingest.ts can be
-- deleted on the grounds that "the apply builds it now".
--
-- Same (scope_key × dimension) shape as `contractor_rank` (122), which is where
-- the index layout and the 'ALL'-sentinel idea come from.
-- ==========================================================================
CREATE MATERIALIZED VIEW agri_beneficiary_year AS
  WITH src AS (
    SELECT year, eik, total_eur
    FROM agri_subsidies
    -- Same two restrictions as `agri_beneficiary`: /farm/:eik is the only
    -- destination (so a row with no EIK cannot land) and ДФ „Земеделие" itself
    -- is a counterparty rather than a recipient. Kept in sync with PAYER_EIKS in
    -- scripts/agri/ingest.ts.
    WHERE eik IS NOT NULL
      AND eik <> '121100421'
  ),
  -- ⚠️ OVER THE WHOLE TABLE, not over `src`. This must be the SAME year
  -- `scripts/agri/ingest.ts` calls `latestYear` when it keys the `''` overview
  -- payload — and that one is `max(year)` across every row, individuals
  -- included. Narrowing it to EIK-bearing non-payer rows reads as tidier and
  -- silently forks the definition: the first financial year whose only rows are
  -- individual payments would advance the payload's `''` and not this one, so
  -- the hub's „Последна година" pill would name one year while the ranking
  -- beneath it counted another — both at 200, every row count reconciling. The
  -- corpus already skips 2018-2020, so irregular years are not hypothetical.
  -- An empty `''` partition is the CORRECT outcome in that case: the payload
  -- describes a year with no company payments, and the ranking says so.
  latest AS (SELECT max(year) AS y FROM agri_subsidies),
  scoped AS (
    -- coalesce, so `total_eur` is NEVER NULL here. `agri_subsidies.total_eur` is
    -- nullable, and a NULL sum would sort FIRST under PostgreSQL's `DESC`
    -- default — putting a farm with no money at the top of a page whose entire
    -- content is a money ranking. The index below spells `NULLS LAST` to match
    -- its four `agri_subsidies` siblings; between them the ordering is pinned
    -- from both ends.
    SELECT year::text AS scope_key, eik,
           sum(coalesce(total_eur, 0)) AS total_eur, count(*) AS payment_count
    FROM src GROUP BY year, eik
    UNION ALL
    SELECT 'all', eik, sum(coalesce(total_eur, 0)), count(*)
    FROM src GROUP BY eik
    UNION ALL
    -- The DEFAULT scope. `agri_payloads` keys the latest financial year twice —
    -- once under its own number and once under '' — because `agriScopeToKey`
    -- maps the default `ns` scope to ''. This mirrors that exactly.
    SELECT '', s.eik, sum(coalesce(s.total_eur, 0)), count(*)
    FROM src s, latest l WHERE s.year = l.y GROUP BY s.eik
  )
  SELECT sc.scope_key,
         sc.eik,
         b.name,
         b.oblast,
         sc.total_eur,
         sc.payment_count
  FROM scoped sc
  JOIN agri_beneficiary b ON b.eik = sc.eik;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agri_beneficiary_year_key
  ON agri_beneficiary_year (scope_key, eik);
-- The ranked page walk: filter one scope, then read money-desc straight off the
-- index with a stable tiebreak, no sort. `NULLS LAST` matches the four
-- `agri_subsidies` indexes above — and the CONSUMING QUERY MUST SPELL IT TOO
-- (`ORDER BY total_eur DESC NULLS LAST, eik`), because an ORDER BY whose null
-- ordering differs from the index's cannot be served by it and silently
-- reintroduces a Sort over every row in the scope.
CREATE INDEX IF NOT EXISTS idx_agri_beneficiary_year_rank
  ON agri_beneficiary_year (scope_key, total_eur DESC NULLS LAST, eik);

-- ==========================================================================
-- The SCHEME rollup — one row per (scope × мярка), behind /subsidies/schemes.
--
-- WHY IT EXISTS: measured, the live form is a full seq scan of agri_subsidies on
-- EVERY request — 189,458 buffers and 726 ms for one year, ~95x the ~2,000 the
-- dashboard-hub skill allows for anything served live. `agri_payloads` carries
-- only a TOP-12 `byScheme`, so a page that lists all 481 schemes cannot read it.
--
-- IT ALSO CARRIES THE THREE CAP FUNDS, which nothing else in this schema exposes
-- per scheme: ЕФГЗ-ДП (direct payments), ЕФГЗ (market measures) and ЕЗФРСР
-- (rural development). Corpus-wide they are €6.17bn / €0.16bn / €4.71bn and they
-- sum exactly to the total, so a page can partition by them without a residual.
--
-- ⚠️ SCHEME LABELS ARE NOT COMPARABLE ACROSS CAP PERIODS, and no fold here tries
-- to make them so. „СЕПП" (2015-2022, €2.33bn) and „I.А.1-1 основно подпомагане
-- на доходите за устойчивост" (2023+, €382.7m) are basic income support under two
-- names; a ranking that mixes them reports a rename as a collapse. The corpus has
-- 481 distinct labels for that reason. The PERIOD is derivable from the year with
-- no guessing at all, so the page groups by period and says so — rather than
-- inventing a label fold that would be wrong in ways nobody could see.
-- ==========================================================================
CREATE MATERIALIZED VIEW agri_scheme_year AS
  WITH src AS (
    SELECT year, scheme, scheme_desc, eik, total_eur, dp_eur, market_eur, rural_eur
    FROM agri_subsidies WHERE scheme IS NOT NULL
  ),
  latest AS (SELECT max(year) AS y FROM agri_subsidies),
  -- ⚠️ THE PERIOD IS A PROPERTY OF THE SCHEME, NOT OF THE SCOPE, so it is derived
  -- ONCE over the whole corpus and joined in. Derived per (scope, scheme) it says
  -- something false and self-contradicting: in the 2023 scope every carried-over
  -- 2014-2022 measure has min(year) = max(year) = 2023 and is labelled 2023-2027 —
  -- 53 schemes and €1.11bn, 97.7% of that year, „СЕПП" among them — directly under
  -- a warning that „СЕПП" is the OLD name. The „2014-2022" filter then returns no
  -- rows for money that plainly exists.
  scheme_period AS (
    SELECT scheme,
           CASE WHEN min(year) >= 2023 THEN '2023-2027'
                WHEN max(year) <= 2022 THEN '2014-2022'
                ELSE 'mixed' END AS cap_period,
           min(year) AS corpus_first_year,
           max(year) AS corpus_last_year
    FROM src GROUP BY scheme
  ),
  scoped AS (
    SELECT year::text AS scope_key, year, scheme, scheme_desc, eik,
           total_eur, dp_eur, market_eur, rural_eur
      FROM src
    UNION ALL
    SELECT 'all', year, scheme, scheme_desc, eik,
           total_eur, dp_eur, market_eur, rural_eur
      FROM src
    UNION ALL
    SELECT '', year, scheme, scheme_desc, eik,
           total_eur, dp_eur, market_eur, rural_eur
      FROM src, latest l WHERE src.year = l.y
  )
  SELECT sc.scope_key,
         sc.scheme,
         -- The LONGEST descriptive spelling, the same rule agri_beneficiary uses
         -- for names: the register writes the same measure several ways and the
         -- shortest is often a bare code.
         (array_agg(sc.scheme_desc ORDER BY length(coalesce(sc.scheme_desc, '')) DESC,
                    sc.scheme_desc COLLATE "C"))[1]              AS scheme_desc,
         sp.cap_period,
         -- The scheme's own span across the WHOLE corpus, so a row in the 2023
         -- scope still reports that the measure started in 2015.
         sp.corpus_first_year                                    AS first_year,
         sp.corpus_last_year                                     AS last_year,
         -- ⚠️ ACCUMULATED in numeric (order-independent — the served figure must not
         -- move between two identical requests) but CAST BACK to double precision.
         -- node-postgres returns a PG `numeric` as a STRING, `Number.isFinite("…")`
         -- is false, and formatEur then renders "" — which blanked the money column
         -- on every row of /subsidies/schemes while the page looked otherwise fine.
         -- The table engine coerces AGGREGATES to numbers but never row values,
         -- which is why the three-fund cards were right and the rows were empty.
         -- `agri_beneficiary_year` is double precision throughout and unaffected.
         sum(coalesce(sc.total_eur, 0)::numeric)::double precision  AS total_eur,
         sum(coalesce(sc.dp_eur, 0)::numeric)::double precision     AS dp_eur,
         sum(coalesce(sc.market_eur, 0)::numeric)::double precision AS market_eur,
         sum(coalesce(sc.rural_eur, 0)::numeric)::double precision  AS rural_eur,
         count(*)                                                AS payment_count,
         -- EIK-bearing recipients only: a natural person has no stable id, so a
         -- distinct count over them would be a namesake count, not a people count.
         count(DISTINCT sc.eik) FILTER (WHERE sc.eik IS NOT NULL) AS recipient_count,
         -- How many of the three CAP funds this scheme actually draws on. Usually
         -- one — but 49 of 481 schemes (€202m across 51,953 rows) span two or
         -- three, so „every scheme belongs to exactly one fund" is FALSE and no
         -- surface may say it. The three funds still PARTITION THE MONEY exactly;
         -- what they do not partition is the schemes.
         (CASE WHEN sum(coalesce(sc.dp_eur, 0)) <> 0 THEN 1 ELSE 0 END
        + CASE WHEN sum(coalesce(sc.market_eur, 0)) <> 0 THEN 1 ELSE 0 END
        + CASE WHEN sum(coalesce(sc.rural_eur, 0)) <> 0 THEN 1 ELSE 0 END)
                                                                 AS fund_count
  FROM scoped sc
  JOIN scheme_period sp ON sp.scheme = sc.scheme
  GROUP BY sc.scope_key, sc.scheme, sp.cap_period, sp.corpus_first_year, sp.corpus_last_year;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agri_scheme_year_key
  ON agri_scheme_year (scope_key, scheme);
CREATE INDEX IF NOT EXISTS idx_agri_scheme_year_rank
  ON agri_scheme_year (scope_key, total_eur DESC NULLS LAST, scheme);

-- Explicit, rather than left to the ALTER DEFAULT PRIVILEGES in roles_readonly.sql:
-- that is a one-time MANUAL step, and now that the matview is recreated on every
-- apply the ACL is re-derived on every db:load:agri:pg[:cloud] rather than once per
-- database. It also silently requires the loader to connect as the role those
-- defaults were declared for. The failure shape if that assumption is ever wrong is
-- 42501 on the /subsidies typeahead, with the corpus fully loaded and every row count
-- reconciling.
--
-- ROLE-GUARDED (the 117/130 shape), unlike the bare GRANTs in 017/018 — and the
-- difference is not cosmetic. This is the ONLY grant in 046, so before it the file
-- applied fine on a database where roles_readonly.sql had never run. Unguarded it
-- would raise 42704 there and roll back the WHOLE file (exec() sends it as one
-- implicit transaction), taking agri_subsidies, agri_payloads and every index with
-- it — i.e. adding this line would have broken db:load:agri:pg on a fresh clone.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON agri_beneficiary TO app_readonly;
    GRANT SELECT ON agri_beneficiary_year TO app_readonly;
    GRANT SELECT ON agri_scheme_year TO app_readonly;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION agri_beneficiary_search(p_term text, p_limit int DEFAULT 8)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  -- LIKE metacharacters are STRIPPED, not escaped. Escaping them through this
  -- many quoting layers is easy to get subtly wrong, and a search term
  -- containing a literal % or _ is not a real query — whereas an UNescaped '%'
  -- matches everything and returns the global top-8, which the client then
  -- filters away, so the box silently says "no matches" while the server sent
  -- eight rows. A term that is nothing BUT metacharacters yields [].
  WITH t AS (SELECT btrim(regexp_replace(p_term, '[%_\\]', '', 'g')) AS q)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'eik',      eik,
           'name',     name,
           'oblast',   oblast,
           'totalEur', ROUND(total_eur)::bigint)
         ORDER BY total_eur DESC, eik), '[]'::jsonb)
  FROM (
    SELECT b.eik, b.name, b.oblast, b.total_eur
    FROM agri_beneficiary b, t
    WHERE t.q <> ''
      AND (b.name ILIKE '%' || t.q || '%'
           -- The fold arm: a Latin-typed query against a Cyrillic register.
           OR b.name_fold ILIKE '%' || translit_bg_latin(t.q) || '%'
           -- The oblast arm the hint promises. Without it "Кърджали" found 4
           -- of its 139 beneficiaries — the four carrying it in their NAME.
           OR b.oblast ILIKE '%' || t.q || '%'
           OR b.eik LIKE t.q || '%')
    ORDER BY b.total_eur DESC, b.eik
    LIMIT greatest(p_limit, 1)
  ) h;
$$;
