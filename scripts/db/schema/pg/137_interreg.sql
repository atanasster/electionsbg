-- 137_interreg.sql — the Interreg cross-border-cooperation corpus: programmes,
-- operations and their partners, from keep.eu (INTERACT).
--
-- WHY THIS IS NOT ROWS IN fund_projects, which is the obvious place for it.
-- `fund_projects` is one row per contract with ONE beneficiary and one
-- `total_eur` = the project's total cost. Interreg is one operation × N
-- partners × N budgets, and appending forces one of two lies: a row per
-- operation (whose beneficiary? whose money?) or a row per Bulgarian partner
-- carrying the OPERATION total — the €2m-for-a-€300k-partner inversion. On the
-- operation that started this, BSB00963, the operation total is €1,419,207.76
-- and Малко Търново's share is €357,183.12; storing the former would put ~4×
-- the true money on a 2,628-person municipality. Redefining `total_eur` for
-- 1.7% of rows is the failure class this repo has documented twice already
-- (`oblast = oblasts[0]`, and the €7.15bn phantom choropleth).
-- Full argument: docs/plans/interreg-funds-ingest-v1.md §4.
--
-- THE INVARIANT EVERY READER INHERITS: the OPERATION total lives on
-- interreg_operations, the PARTNER budget on interreg_partners, and NO MONEY
-- AGGREGATE EVER READS ACROSS THE JOIN. Summing `total_budget_eur` grouped by a
-- place- or beneficiary-keyed column is always wrong. `interreg.data.test.ts`
-- (T2.4, NOT YET LANDED) will read every shipped function body out of
-- pg_get_functiondef and fail on it.
--
-- Interreg does not run on ИСУН. keep.eu records each programme's provenance as
-- "retrieved from the programme's monitoring system (Jems)"; ИСУН 2020 is the
-- Bulgarian MIS. The two corpora are disjoint by construction, which is why
-- `fund_projects` holds zero Interreg rows and why no namespace collision is
-- possible (gate 8 asserts it anyway).
--
-- STAGE-MERGE CONTRACT — read this before writing load_interreg_pg.ts.
-- All three tables are on a serving path, so the loader stage-merges rather
-- than TRUNCATEs (`person_reload_locks.data.test.ts` records load_funds_pg.ts's
-- two TRUNCATEs as accepted debt; do not add a third). Two consequences:
--
--   * ORDER IS FORCED: programmes, then operations, then partners. Each FK
--     refuses a child whose parent is not yet present.
--   * THE STAGE MUST BE BUILT FROM THE WHOLE CORPUS, EVERY RUN.
--     `stageDeleteSql` is unscoped by construction — `DELETE FROM t WHERE NOT
--     EXISTS (SELECT 1 FROM stage …)`. A stage built from one programme (and
--     `ingest.ts` ships a `--programme` flag) deletes every other programme's
--     operations, `ON DELETE CASCADE` takes their partners too, and
--     `mergeFromStage`'s parity guard then compares live against staged, finds
--     them equal, and PASSES. That is structurally the fund_payloads anti-join
--     the plan rejects in §4, amplified across two tables. The loader must
--     refuse a scoped build outright.
--
-- Nothing on the cloud side is automatic: `npm run db:load:interreg:pg:cloud`
-- is a hand-run command. See CLAUDE.md.
--
-- SELECT is granted explicitly at the foot of this file, guarded on the role
-- existing so the migration still applies on a cold bootstrap where
-- roles_readonly.sql has never run (same shape as 117 / 130).

-- The curated programme register, mirrored from
-- scripts/funds/interreg/programmes.ts — the ONLY place a keep.eu programme is
-- admitted.
--
-- It exists as a table rather than as two denormalized name columns on
-- interreg_operations for two reasons. The register lives under `scripts/`,
-- which neither `src/` nor `functions/db_routes.js` can import, so without it
-- there is no SQL-side source for the programme label every T3 surface needs
-- (/funds' Interreg section, /funds/interreg/:keepId, the SSR page family).
-- And it lets `interreg_operations.programme_code` carry a foreign key, which
-- makes plan §9 gate 11 ("every programme_code exists in the curated map")
-- structural instead of a test that has to be remembered.
CREATE TABLE IF NOT EXISTS interreg_programmes (
  code           text PRIMARY KEY,
  keep_programme_id integer NOT NULL UNIQUE,
  period         text NOT NULL CHECK (period IN ('2014-2020', '2021-2027')),
  -- Curated, never machine-translated — the rule programmeNamesEn.ts states.
  name_bg        text NOT NULL,
  name_en        text NOT NULL,
  -- keep.eu's own title, ONLY where it differs from name_en (one row: the
  -- 2014-2020 BG-North Macedonia programme, which keep.eu still files under
  -- "Former Yugoslav Republic of Macedonia"). Lets a registry-vs-keep.eu
  -- consistency check tell a deliberate divergence from a wrong keep id.
  keep_title     text,
  -- 2021-2027 publishes a CCI; 2014-2020 does not.
  cci            text,
  -- Bulgarian eligible area as NUTS codes, read from keep.eu's own
  -- `eligible_geographical_area`. MIXED LEVEL on purpose: the Black Sea Basin
  -- programmes are eligible at NUTS2 (BG33, BG34) while the land borders are
  -- NUTS3, so membership is a PREFIX test, not equality. NULL = nationwide.
  eligible_nuts  text[],
  -- What keep.eu actually holds, so a thin arm is a stated gap and not a
  -- silent one. Two programmes yield zero operations (BG-Serbia 21-27, ESPON
  -- 2030) and are registered anyway — a missing row and a zero row mean
  -- opposite things.
  coverage_note  text
);

CREATE TABLE IF NOT EXISTS interreg_operations (
  -- keep.eu's project id. THE PRIMARY KEY, and the only always-present unique
  -- key: `operation_id` is NULL on 1,282 of 1,954 — every 2014-2020 operation
  -- (1,251) PLUS 31 of 2021-2027 (30 URBACT IV, 1 Interreg Europe), so it is
  -- not a period marker either. Where present it is heterogeneous — BSB00963,
  -- BGTR0200037, and bare numerics like 6028519 — so it cannot be assumed
  -- unique across programmes or periods.
  keep_id           integer PRIMARY KEY,
  operation_id      text,
  programme_code    text NOT NULL REFERENCES interreg_programmes(code),
  period            text NOT NULL CHECK (period IN ('2014-2020', '2021-2027')),
  -- keep.eu publishes titles in English only (0 of 1,954 carry a `bg`), and its
  -- language DETECTION is unreliable — two plainly-English titles are filed
  -- under `mt` and `it`. `title_lang` says which key the title came from, so
  -- the honesty marker on the BG side (plan §7) can be precise.
  title_en          text NOT NULL,
  title_lang        text NOT NULL,
  -- NULL until a Bulgarian source exists. NEVER machine-translated: inventing a
  -- plausible translation is the fabrication programmeNamesEn.ts refuses.
  title_bg          text,
  summary_en        text,
  status            text,
  start_date        date,
  end_date          date,
  -- The OPERATION total. Never a partner's. See the header.
  total_budget_eur  double precision,
  eu_funding_eur    double precision,
  -- PERCENT (61.38–92 observed), not a 0–1 fraction.
  co_financing_rate double precision,
  partner_count     integer,
  -- Σ of the partners' own budgets, and the count that Σ is over.
  --
  -- partner_budget_sum_eur NEED NOT EQUAL total_budget_eur: on 68 of 1,954
  -- operations (3.5%) it exceeds it, by 2% to 66%, median 12%, concentrated in
  -- the transnational programmes (39 Danube, 18 Euro-MED, 8 Black Sea Basin)
  -- and explained by neither eu_funding_eur nor rounding. keep.eu does not
  -- guarantee the two levels reconcile. An earlier draft REFUSED those
  -- operations and thereby dropped 64 Bulgarian partner rows and €9.47m.
  --
  -- The count is what stops a sum short of the total being mistaken for a
  -- partnership we can only half see (plan §3.1's "N of which M"). NOT NULL
  -- because a NULL there would mean neither.
  partner_budget_sum_eur         double precision,
  partner_budget_published_count integer NOT NULL DEFAULT 0,
  -- Every participating country as keep.eu NAMES them, verbatim. Not ISO2:
  -- keep.eu's country id is its own internal key, so an ISO2 column would have
  -- to be minted from a curated map — a second thing to maintain and a second
  -- place to be wrong — and the only question this corpus asks of a country is
  -- "is this partner Bulgarian".
  countries         text[] NOT NULL DEFAULT '{}',
  -- Stamped by the loader from data/funds/interreg/index.json's one `fetchedAt`.
  -- Deliberately not carried per row in the committed tree: a per-row stamp made
  -- every re-ingest a 4.6 MB diff with nothing changed.
  source_fetched_at timestamptz NOT NULL
);

-- Unique WHERE NOT NULL, not a plain UNIQUE: 1,282 rows share a NULL
-- operation_id. Scoped by programme because a bare numeric like 6028519 cannot
-- be assumed globally unique across 22 programmes. (Measured: 0 operation_ids
-- span more than one programme today, so the global form would also hold — this
-- is the defensive choice, not the forced one.)
CREATE UNIQUE INDEX IF NOT EXISTS ux_interreg_operations_op
  ON interreg_operations (programme_code, operation_id)
  WHERE operation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_interreg_operations_programme
  ON interreg_operations (programme_code);
-- No index on `period`: two values over 1,954 rows selects 64% or 36%, which no
-- index improves, and every period-split surface is a full aggregate anyway.

CREATE TABLE IF NOT EXISTS interreg_partners (
  keep_id        integer NOT NULL
                   REFERENCES interreg_operations(keep_id) ON DELETE CASCADE,
  -- Position within the operation, ordered by keep.eu's own partnership id.
  -- Half the PK, so it must be a function of the DATA and not of the order
  -- keep.eu happened to serialise the array in: a re-crawl reordering would
  -- otherwise shift every key and make the stage-merge rewrite budgets, EIKs
  -- and places onto the wrong partner, with every row count reconciling.
  partner_seq    integer NOT NULL,
  -- keep.eu's stable partnership id (present and globally unique on all 12,141
  -- rows). Kept so a reorder is detectable, not merely survivable.
  keep_partnership_id integer,
  -- The partner ORGANISATION's id, which repeats across operations. Not a key.
  keep_partner_id integer,
  is_lead        boolean NOT NULL,
  -- keep.eu's country NAME, verbatim ("Bulgaria"). See interreg_operations.countries.
  country        text NOT NULL,
  -- The department's country where it differs from the organisation's seat.
  -- A row is Bulgarian if EITHER is 'Bulgaria' — see isBulgarianPartner() in
  -- scripts/funds/interreg/types.ts, and the index note below.
  country_department text,
  -- As published — Cyrillic on 129 of 136 sampled Bulgarian rows.
  partner_name   text NOT NULL,
  partner_name_en text,
  -- TIER L, and 2021-2027 ONLY. The 2014-2020 template has no identity column
  -- at all: 0 of 1,080 Bulgarian rows carry one, against 336 of 413 (81.4%) in
  -- 2021-2027. keep.eu fills `beneficiary_id` on 413 of 413, but 54 are the
  -- literal "N.a." and 23 more are shapes canonicalEik() correctly refuses
  -- ("U24230CT2012PTC000465", "BG0006706800015", "98000025") — so 413 − 54 =
  -- 359 counts the RAW FIELD, not this column, and any gate calibrated on 359
  -- will go red for the wrong reason.
  --
  -- That asymmetry governs everything downstream: roughly two-thirds of the
  -- recovered money can be attributed to a PLACE but not to a legal entity,
  -- which is why the company page and company_public_money see only Tier L.
  --
  -- The CHECK is the ЕГН guard made structural: canonicalEik() already refuses
  -- 10-digit values because a legacy BULSTAT and a personal identity number
  -- cannot be told apart, and this stops one being stored even if it does not.
  eik            text CHECK (eik ~ '^[0-9]{9}$'),
  pic            text,
  -- keep.eu's own 11-value organisation vocabulary, verbatim. NOT a mapping of
  -- ИСУН's `org_kind`: they do not correspond, so the municipal ranking filters
  -- the closed 265-municipality roster instead of an org-type string.
  org_type       text,
  legal_status   text,
  -- THE PARTNER's own budget. Never the operation's.
  budget_eur     double precision,
  -- 2021-2027 only, like `eik` — NULL on every 2014-2020 row. keep.eu also
  -- publishes negative corrections here (2 rows: Menorca −€50,360, Andalucía
  -- −€26,060, both non-Bulgarian), so a future sum() surface should expect them
  -- rather than read them as a parse bug.
  eu_funding_eur double precision,
  -- Three states, all distinct, none inferred. `published_zero` is a literal
  -- 0.00 — a co-beneficiary carrying no budget line, which is a real
  -- arrangement (70 rows table-wide: 15 in 2014-2020, 55 in 2021-2027; of the
  -- 1,493 Bulgarian rows, 7, all 2014-2020) — while `unpublished` means the
  -- programme published no figure. We NEVER equal-split an operation total to
  -- fill one: that would invent a number the source never stated.
  budget_basis   text NOT NULL
                   CHECK (budget_basis IN ('published', 'published_zero', 'unpublished')),
  location_raw   text,
  postcode       text,
  lat            double precision,
  lng            double precision,
  -- Resolved LOADER-side (not in the committed tree, which reaches no database).
  --
  -- RESOLUTION MUST BE TOTAL ON EVERY RUN. The stage-merge upsert SETs these
  -- from the stage like any other column, and the `IS DISTINCT FROM` guard does
  -- not protect them — a stage row with a NULL place against a live row with a
  -- real EKATTE is DISTINCT, so the update writes the NULL. A stage built
  -- without resolution therefore de-places the whole corpus, and the IFF CHECK
  -- below still passes because ekatte and place_basis go NULL together.
  --
  -- place_basis records HOW, so a consumer can filter by confidence exactly as
  -- tr_company_place.confidence does. The vocabulary is the closed PLACE_BASES
  -- union in scripts/funds/interreg/types.ts — keep the two in step.
  ekatte         text,
  obshtina       text,
  oblast         text,
  place_basis    text
                   CHECK (place_basis IN ('eik:awarder_seats', 'eik:tr',
                     'postal+name+province', 'postal+name', 'postal_only',
                     'name+province', 'name_only', 'roster')),
  PRIMARY KEY (keep_id, partner_seq),
  -- A place with no stated basis is a fact nobody can audit; an obshtina or
  -- oblast without an ekatte is a place the municipal ranking would count with
  -- nothing to audit it by.
  CONSTRAINT interreg_partners_place_basis_iff_ekatte CHECK (
    (ekatte IS NULL) = (place_basis IS NULL)
    AND (ekatte IS NOT NULL OR (obshtina IS NULL AND oblast IS NULL))),
  -- The basis and the amount must agree. Structural rather than a test, for the
  -- same reason the IFF above is: a row claiming `published` with a NULL budget
  -- contributes 0 to the money while counting as published in §3.1's "N of
  -- which M" denominator.
  CONSTRAINT interreg_partners_budget_basis_matches_amount CHECK (
    CASE budget_basis
      WHEN 'published'      THEN budget_eur IS NOT NULL AND budget_eur <> 0
      WHEN 'published_zero' THEN budget_eur = 0
      WHEN 'unpublished'    THEN budget_eur IS NULL
    END)
);

-- Place indexes are predicated on the PLACE being present, NOT on
-- `country = 'Bulgaria'`.
--
-- The canonical Bulgarian predicate is `country = 'Bulgaria' OR
-- country_department = 'Bulgaria'` (isBulgarianPartner), and an OR does not
-- IMPLY either arm — so a partial index carrying the country test is unusable
-- by the very query that must use it, and Postgres seq-scans. Measured: with
-- `country = 'Bulgaria'` in the predicate the canonical query planned a Seq
-- Scan and the country-only query an Index Scan, which would have left T3 a
-- choice between a slow correct query and a fast one that silently drops
-- department-only Bulgarian rows.
--
-- `ekatte IS NOT NULL` selects the same subset anyway, because place resolution
-- only ever runs on the rows isBulgarianPartner() admits.
CREATE INDEX IF NOT EXISTS idx_interreg_partners_bg_place
  ON interreg_partners (ekatte) WHERE ekatte IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_interreg_partners_bg_obshtina
  ON interreg_partners (obshtina) WHERE obshtina IS NOT NULL;
-- Tier L lookups: /company/:eik and the company_public_money arm.
CREATE INDEX IF NOT EXISTS idx_interreg_partners_eik
  ON interreg_partners (eik) WHERE eik IS NOT NULL;
-- No separate index on the FK column: the PK (keep_id, partner_seq) is a btree,
-- so `WHERE keep_id = $1` and the ON DELETE CASCADE scan both ride its
-- leading-column prefix. Verified: Index Scan using interreg_partners_pkey.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON interreg_programmes TO app_readonly;
    GRANT SELECT ON interreg_operations TO app_readonly;
    GRANT SELECT ON interreg_partners TO app_readonly;
  END IF;
END $$;
