-- ---------------------------------------------------------------------------
-- 159 — person_crypto_table: the declared-crypto register behind /declarations/crypto.
--
-- Plan: docs/plans/declared-crypto-v1.md (T2).
--
-- WHY A CROSS-TIER REGISTER RATHER THAN A SLICE OF /mp-cars. The holders are not one
-- population: Борис Михайлов filed as изпълнителен директор of НАП, Мария Недина and
-- Атанас Пеканов as служебен вицепремиери, and two are MPs. mp_cars_table (105) is
-- ns-scoped and MP-only by construction, so extending it would have published the MPs and
-- silently dropped the cabinet — which is the half the reader is actually looking for.
-- This follows officials_rankings_table (100) in kind instead: keyed on person, tier-blind.
--
-- ---------------------------------------------------------------------------
-- THE BASIS IS person_wealth_year's REPRESENTATIVE FILING, AND THAT IS LOAD-BEARING.
--
-- A declared holding is re-declared on every filing that covers it, so the raw
-- declaration_asset rows DOUBLE-COUNT: Борис Михайлов's 500 000 BUSD appears on both his
-- 2023 Annualy and his 2023 Vacate, and a naive sum over the corpus reads €1,960,489
-- against a true €1,649,180 — a 19% overstatement, on a page whose entire content is a
-- number beside a person's name.
--
-- person_wealth_year (090) already picks ONE declaration per (person, period_year), with
-- the has_valued_assets tier and the byRecency comparator, and it is what /person,
-- /persons, /officials/assets and the wealth chart all render. Joining through it rather
-- than re-deriving a pick here is what stops this register becoming a fifth opinion about
-- which filing counts.
--
-- IT HAS A COST, AND IT IS THE RIGHT ONE. Северин Върtigov filed TWICE for period 2019;
-- the later filing is the representative one and carries no crypto, while the superseded
-- one carries his 1 bitcoin. So he is absent here — and absent from the „Криптоактиви"
-- block on his own profile, for the same reason and by the same pick. Ten people have a
-- crypto row somewhere in the corpus; NINE have one on a filing the site considers
-- current. Agreeing with the profile matters more than the tenth name.
--
-- ---------------------------------------------------------------------------
-- THE ns-STYLE SCOPE FAN-OUT (see 105's header for the original reasoning).
--
--   scope = 'latest' — each person's most recent crypto-bearing period. „What is held."
--   scope = 'all'    — every period-year. „What has ever been declared."
--
-- Rows in a person's latest period are emitted TWICE, once per bucket. As with 105, the
-- registry entry MUST carry `defaultScope: { col: "scope", val: "latest" }`: an unscoped
-- query is otherwise the UNION of both buckets, which serves the double-count this whole
-- header is about, with the `count` and `sum` aggregates inflated to match and nothing
-- erroring. db_table.test.js fails an ns-style resource with no defaultScope.
-- ---------------------------------------------------------------------------

DROP MATERIALIZED VIEW IF EXISTS person_crypto_table;

CREATE MATERIALIZED VIEW person_crypto_table AS
WITH holding AS (
  SELECT
    w.person_id,
    w.period_year,
    w.declaration_id,
    a.seq,
    a.category,
    a.description,
    a.detail,
    a.is_spouse,
    a.value_eur,
    -- Resolved exactly as declaration_detail() resolves it, and for the same reason:
    -- WHICH column holds the count depends on the filing shape. Table 8 declares the coin
    -- AS the currency with the count in `amount`; table 9 puts the count in `share` and
    -- uses `amount` for the acquisition price in leva. The discriminator is is_crypto_asset
    -- with the text arms NULLed, which leaves only "is the declared unit a non-money one".
    CASE
      WHEN is_crypto_asset(a.category, NULL, NULL, a.currency) THEN a.amount
      WHEN a.category = 'security'
       AND a.share ~ '^[[:space:]]*[0-9]+([.,][0-9]+)?[[:space:]]*$'
        THEN replace(btrim(a.share), ',', '.')::numeric
    END AS quantity,
    CASE
      WHEN is_crypto_asset(a.category, NULL, NULL, a.currency) THEN a.currency
    END AS quantity_unit
  FROM person_wealth_year w
  JOIN declaration_asset a ON a.declaration_id = w.declaration_id
  WHERE is_crypto_asset(a.category, a.description, a.detail, a.currency)
), latest AS (
  SELECT person_id, max(period_year) AS period_year FROM holding GROUP BY person_id
), scoped AS (
  SELECT h.*, 'all'::text AS scope FROM holding h
  UNION ALL
  SELECT h.*, 'latest'::text FROM holding h JOIN latest l USING (person_id, period_year)
)
SELECT
  s.scope,
  -- Stable across a rebuild because both halves are: a declaration id and its row seq.
  -- Text rather than an arithmetic pack (declaration_id * 1000 + seq) so no assumption
  -- about the row count per filing can ever silently collide.
  s.declaration_id || '-' || s.seq AS holding_key,
  p.slug        AS person_slug,
  p.display_name AS person_name,
  d.tier,
  d.institution,
  d.position_title,
  d.declaration_type,
  d.source_url,
  s.period_year,
  s.declaration_id,
  s.category,
  s.description,
  s.detail,
  -- double precision for the same node-postgres reason as value_eur below: a `numeric`
  -- arrives at the client as a STRING, and „30" rendered from a string is fine right up
  -- until someone sorts or formats it. 0.017 BTC survives the type — it is the ROUNDING
  -- that would kill it, and nothing here rounds.
  s.quantity::double precision AS quantity,
  s.quantity_unit,
  s.is_spouse,
  -- double precision, NOT numeric. node-postgres serializes a PG `numeric` as a STRING,
  -- which renders every money cell on the page BLANK while the value is present and
  -- correct in the payload — invisible to every row count and to any assertion made
  -- through SQL. Same trap 120 documents for net_worth_eur / public_money_eur.
  round(s.value_eur)::double precision AS value_eur
FROM scoped s
JOIN person p ON p.person_id = s.person_id
JOIN declaration d ON d.declaration_id = s.declaration_id
WHERE p.status = 'active' AND p.is_public_figure;

CREATE UNIQUE INDEX IF NOT EXISTS ux_person_crypto_table
  ON person_crypto_table(scope, holding_key);
CREATE INDEX IF NOT EXISTS idx_person_crypto_scope_value
  ON person_crypto_table(scope, value_eur DESC);
CREATE INDEX IF NOT EXISTS idx_person_crypto_scope_person
  ON person_crypto_table(scope, person_slug);

-- Role-guarded because roles_readonly.sql may not have run on the target (117/130 shape):
-- a bare GRANT raises 42704 on a cold bootstrap and, exec() sending the file as one
-- transaction, rolls the whole migration back — leaving no matview at all.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON person_crypto_table TO app_readonly;
  END IF;
END $$;
