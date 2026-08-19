-- ---------------------------------------------------------------------------
-- 169 — „Пари в чужбина": the declared money officials say sits outside Bulgaria.
--
-- The per-filing lens shipped first (PersonHeldAbroad on /person, and the „Къде се държат"
-- column on the MP assets page). This is the corpus-level answer to the question that lens
-- cannot reach: how much of the money declared by officials is held abroad, and where.
--
-- Shape and privacy gate mirror 159 (person_crypto_table), deliberately — same producer,
-- same double-count hazard, same `scope` fan-out, same `status = 'active' AND
-- is_public_figure` filter.
--
-- ---------------------------------------------------------------------------
-- WHY IT JOINS person_wealth_year AND NOT declaration_asset DIRECTLY
--
-- A holding is re-declared on every filing that covers it, so the raw rows are not a
-- population — they are the same accounts counted once per filing. Measured 2026-08-19:
--
--   raw declaration_asset rows           3,196 rows   EUR 168,515,251
--   joined through person_wealth_year    2,788 rows   EUR 143,052,685   (-17.8%)
--
-- 090 already picks ONE declaration per (person, period_year); joining through it is what
-- stops this register becoming a fifth opinion about which filing counts. /declarations/crypto
-- shipped the raw version once and published EUR 1,960,489 against a true EUR 1,649,180.
--
-- ---------------------------------------------------------------------------
-- COVERAGE IS NARROWER THAN "MONEY", AND EVERY CONSUMER MUST SAY SO
--
-- `held_scope` exists only on tables 5 („Банкови влогове") and 8 („Вложения в … фондове") —
-- table 4 („Налични парични средства") has no such column at all, and its Cell Num=7 is
-- „Произход на средствата". So this register spans EUR 2.26bn of the EUR 5.67bn in declared
-- assets. „5.9% of declared money is abroad" is true on the bank+investment basis and false
-- as a statement about declared wealth: on the SAME latest-filing, privacy-gated basis, against
-- all declared holdings less debt (EUR 2.01bn), the figure is 2.3%. One numerator, two
-- denominators — which is exactly why person_abroad_overview() returns the denominator beside
-- it and nothing here publishes a bare percentage.
--
-- ⚠️ Do NOT compare across bases. Dividing the latest-filing numerator by the corpus-wide
-- EUR 5.67bn gives 0.8% and understates the caveat ~2.8x; the corpus-wide framing needs the
-- corpus-wide numerator too (143,052,755 / 5,662,326,818 = 2.5%).
--
-- Magistrates are absent entirely — that tier is derived from ВСС PDFs with no cacbg XML
-- behind it, so it has zero rows with a held_scope, not zero holdings abroad.
--
-- ---------------------------------------------------------------------------
-- THE scope FAN-OUT, AND THE ONE PLACE THIS DIVERGES FROM 159
--
--   scope = 'latest' — rows on each person's most recent FILING. „What is held."
--   scope = 'all'    — every period-year. „What has ever been declared."
--
-- ⚠️ 159 anchors 'latest' on each person's most recent CRYPTO-BEARING period, because its
-- job is to agree with the „Криптоактиви" block on that person's own profile. This one
-- anchors on the most recent filing FULL STOP, because its job is a corpus aggregate: a
-- person who declared a Belgian account in 2023 and none in 2025 has stopped declaring one,
-- and carrying their 2023 row forward would overstate the total by exactly the holdings
-- people no longer report. The two rules give different sets and both are right for their
-- own page — do not "unify" them without re-reading both headers.
--
-- The consequence to respect: person_abroad_overview() and the 'latest' rows of this table
-- MUST share that anchor, or the page's headline will not equal the sum of the rows beneath
-- it. Both read `latest_filing` below.
--
-- ⚠️ The registry entry, WHEN ADDED, must carry `defaultScope: { col: "scope", val: "latest" }`
-- — functions/db_table.js has no person_abroad resource yet, so nothing fires before then. An
-- unscoped query is otherwise the UNION of both buckets, serving the double-count this
-- header is about with `count` and `sum` inflated to match and nothing erroring.
-- ---------------------------------------------------------------------------

DROP MATERIALIZED VIEW IF EXISTS person_abroad_table;

CREATE MATERIALIZED VIEW person_abroad_table AS
WITH latest_filing AS (
  -- Each person's most recent period, and the declaration 090 picked for it.
  SELECT DISTINCT ON (person_id) person_id, period_year, declaration_id
    FROM person_wealth_year
   ORDER BY person_id, period_year DESC
), holding AS (
  SELECT
    w.person_id,
    w.period_year,
    w.declaration_id,
    a.seq,
    a.category,
    a.description,
    a.is_spouse,
    a.value_eur,
    a.held_country,
    -- „да" in the „В чужбина" column says abroad and names nowhere: a country is named on
    -- 415 of 2,788 rows, 11.7% of the money. Carried as an explicit flag so a consumer
    -- filtering or grouping by country cannot silently present that subset as the whole —
    -- and so the gate can assert it stays a minority.
    (a.held_country IS NOT NULL) AS country_named
  FROM person_wealth_year w
  JOIN declaration_asset a ON a.declaration_id = w.declaration_id
  WHERE a.held_scope = 'abroad'
), scoped AS (
  SELECT h.*, 'all'::text AS scope FROM holding h
  UNION ALL
  SELECT h.*, 'latest'::text
    FROM holding h
    JOIN latest_filing l
      ON l.person_id = h.person_id AND l.declaration_id = h.declaration_id
)
SELECT
  s.scope,
  -- Stable across a rebuild because both halves are: a declaration id and its row seq.
  -- Text rather than an arithmetic pack so no assumption about rows-per-filing can collide.
  s.declaration_id || '-' || s.seq AS holding_key,
  p.slug         AS person_slug,
  p.display_name AS person_name,
  d.tier,
  -- Per-filing job and institution; see declared_label() in 089. This register names a
  -- person beside a foreign holding, so the label is a claim about that individual.
  declared_label(d.filed_institution, d.institution) AS institution,
  declared_label(d.filed_position, d.position_title) AS position_title,
  d.declaration_type,
  d.source_url,
  s.period_year,
  s.declaration_id,
  s.category,
  s.description,
  s.held_country,
  s.country_named,
  s.is_spouse,
  -- double precision, NOT numeric. node-postgres serializes a PG `numeric` as a STRING,
  -- which renders every money cell BLANK while the value is present and correct in the
  -- payload — invisible to every row count and to any assertion made through SQL. Same
  -- trap 120 documents for net_worth_eur and 159 for its own value_eur.
  --
  -- NULL survives on purpose: an unvalued row must not become 0. One filing in the corpus
  -- has no valued abroad row at all, and „EUR 0" is a figure that filing does not state.
  round(s.value_eur)::double precision AS value_eur
FROM scoped s
JOIN person p ON p.person_id = s.person_id
JOIN declaration d ON d.declaration_id = s.declaration_id
WHERE p.status = 'active' AND p.is_public_figure;

CREATE UNIQUE INDEX IF NOT EXISTS ux_person_abroad_table
  ON person_abroad_table(scope, holding_key);
CREATE INDEX IF NOT EXISTS idx_person_abroad_scope_value
  ON person_abroad_table(scope, value_eur DESC NULLS LAST);
-- Deliberately NOT 159's (scope, person_slug): this is a corpus-level register read by
-- country and by value, and the matview is ~165 pages so a per-person scan is cheap. Add the
-- person index if a per-person surface ever reads this table.
CREATE INDEX IF NOT EXISTS idx_person_abroad_country
  ON person_abroad_table(scope, held_country) WHERE held_country IS NOT NULL;

-- Role-guarded, matching 159: roles_readonly.sql may not have run on the target, and a
-- bare GRANT raises 42704 on a cold bootstrap. exec() sends the file as ONE transaction, so
-- here that would roll back the matview, all three indexes AND person_abroad_overview()
-- below — leaving no register at all on a virgin pgdata volume or an unbootstrapped Cloud
-- SQL target. grant_role_guard.test.ts is the gate.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON person_abroad_table TO app_readonly;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The headline, with its own denominator attached.
--
-- Returns the 'latest'-filing basis — the same anchor person_abroad_table uses — so the
-- page's figure equals the sum of the rows it renders.
--
-- ⚠️ EVERY MONEY KEY NAMES ITS BASIS, per the repo's convention (see funds_hub_stats'
-- absorptionPctOfGrant / absorptionPctOfContracted, 12.7 points apart and both true).
-- `pct_of_in_scope` is a share of bank+investment money only. There is deliberately NO
-- „pct of declared wealth" key: it would be 0.8% against the same numerator, and a consumer
-- picking a denominator by accident is the failure this shape prevents.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION person_abroad_overview()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH latest_filing AS (
    SELECT DISTINCT ON (person_id) person_id, period_year, declaration_id
      FROM person_wealth_year ORDER BY person_id, period_year DESC
  ), rows AS (
    -- ⚠️ ROUND PER ROW, THEN SUM — never round(sum(...)). person_abroad_table rounds each
    -- row for display, so `round(sum())` here disagrees with the sum of the rows the page
    -- renders: measured at EUR 46,815,072 against 46,815,104, a 32-euro gap that no row
    -- count can see. The repo's rule is that a total is the sum of the per-row figures it
    -- is a total OF.
    SELECT a.held_scope, round(a.value_eur) AS value_eur, a.held_country, l.person_id
      FROM latest_filing l
      JOIN declaration_asset a ON a.declaration_id = l.declaration_id
      JOIN person p ON p.person_id = l.person_id
     WHERE a.held_scope IS NOT NULL
       -- A no-op today — every held_scope row is table 5 or 8 and both are holdings — and
       -- kept so it stays one if a чуждо table ever gains the „В страната" / „В чужбина"
       -- pair. declaration_foreign_assets.data.test.ts sweeps every object that SUMs
       -- declaration_asset and requires this predicate or a named exception.
       AND is_declared_holding(a.table_num)
       AND p.status = 'active' AND p.is_public_figure
  )
  SELECT jsonb_build_object(
    'peopleAbroad',   count(DISTINCT person_id) FILTER (WHERE held_scope = 'abroad'),
    'rowsAbroad',     count(*)                  FILTER (WHERE held_scope = 'abroad'),
    'eurAbroad',      sum(value_eur)            FILTER (WHERE held_scope = 'abroad'),
    -- The denominator, named: bank + investment money on the same filings, NOT declared
    -- wealth. See the header.
    'eurInScope',     sum(value_eur),
    'pctOfInScope',   round(100.0 * sum(value_eur) FILTER (WHERE held_scope = 'abroad')
                            / nullif(sum(value_eur), 0), 1),
    -- Counted, never hidden. `unresolvedRows` is the filing answering unintelligibly (both
    -- cells blank, both ticked, or one amount split across them); `unvaluedRowsAbroad` is an
    -- abroad row with no euro figure, which is excluded from eurAbroad rather than read as 0.
    'unresolvedRows', count(*) FILTER (WHERE held_scope NOT IN ('domestic','abroad')),
    'unvaluedRowsAbroad', count(*) FILTER (WHERE held_scope = 'abroad' AND value_eur IS NULL),
    -- „Where" is answerable only over the named subset — declare its size beside it.
    'countryNamedRows', count(*) FILTER (WHERE held_scope = 'abroad' AND held_country IS NOT NULL),
    'eurCountryNamed',  sum(value_eur) FILTER (WHERE held_scope = 'abroad'
                                                    AND held_country IS NOT NULL)
  ) FROM rows;
$$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION person_abroad_overview() TO app_readonly;
  END IF;
END $$;
