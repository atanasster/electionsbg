-- 089_declarations.sql — public-official asset declarations, consolidated.
--
-- The three declaration ingests (MP / executive officials / municipal officials,
-- all from register.cacbg.bg, plus magistrates from the ИВСС register) each write
-- their own per-person JSON tree. This migration brings the PARSED declarations
-- into one Postgres shape so declared wealth becomes queryable against everything
-- else keyed on person_id — contracts, fund_payloads, agri, company, tr_person_roles,
-- magistrate and the elections tables — which is the consolidation the audit asked
-- for (docs/plans/persons-declarations-audit-v1.md §2, Tier 2).
--
-- DDL only: the five base tables + their indexes. The person_wealth_year matview
-- and the serving functions land in 090 (audit T2.3); the loader that fills these
-- tables from the JSON tree is scripts/db/load_declarations_pg.ts (T2.2).
--
-- LOAD ORDER (audit G13 — a real circularity, stated so the cold bootstrap does not
-- deadlock). declaration.person_id REFERENCES person, but the resolver reads
-- official_roster, which the declaration ingest feeds — so person cannot exist when
-- the declarations first load. Therefore:
--   1. load declarations keyed on (tier, subject_ref), person_id LEFT NULL;
--   2. db:resolve:persons  (builds person / person_role from the sources);
--   3. an UPDATE joins declarations to person_role and fills person_id;
--   4. REFRESH person_wealth_year.
-- person_id is nullable BY DESIGN for exactly this window; step 3 closes it. A
-- declaration that never resolves (a subject the resolver could not place) keeps a
-- NULL person_id and simply does not appear on any /person page — never an error.
--
-- THE JOIN IN STEP 3 IS ON subject_ref = person_role.ref, NOT on tier = source.
-- subject_ref is what the resolver stores as person_role.ref (mpId for MPs, the
-- official slug for officials, the name for magistrates), and it is unique across
-- the corpus. `tier` is a COARSE label (four values) that does NOT equal
-- person_role.source: an official declaration is tier='exec' or 'muni', but the
-- resolver's source is 'official_exec' / 'official_muni' — and via
-- src/lib/officialSources.ts (CATEGORY_PERSON_SOURCE) some executive categories fan
-- out to 'president' / 'mep' / 'diplomat' / 'regulator'. So the loader (T2.2) maps
-- tier → a SET of candidate sources and joins
--   person_role.ref = declaration.subject_ref AND person_role.source = ANY(sources)
-- Keying the join on tier = source instead would strand every exec/muni declaration
-- at NULL forever, silently — the exact failure G13 exists to prevent.
--
-- Money is stored in EUR (value_eur), converted at the locked BGN peg at parse time
-- (1 EUR = 1.95583 BGN), matching every other money column on the site. The raw
-- amount + currency are kept alongside so a euro value can always be traced back to
-- what the declarant actually wrote.

-- ---------------------------------------------------------------------------
-- One row per filed declaration. The natural key is source_url (every filing has a
-- unique register XML URL); declaration_id is a surrogate key for the child tables
-- to reference. (tier, subject_ref) is how the loader addresses a declaration before
-- person_id exists, and how the post-resolve UPDATE finds it again.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS declaration (
  declaration_id   bigserial PRIMARY KEY,
  -- Nullable until db:resolve:persons runs — see LOAD ORDER above. NOT a foreign
  -- key gap: the UPDATE in step 3 fills it, and an unresolved subject stays NULL.
  person_id        bigint REFERENCES person (person_id) ON DELETE SET NULL,
  -- Which ingest produced it — a coarse label, NOT a person_role.source value (see
  -- LOAD ORDER above for why, and how the join actually works).
  tier             text NOT NULL CHECK (tier IN ('mp', 'exec', 'muni', 'magistrate')),
  -- The subject's id WITHIN that tier: an MP id, an official slug, a magistrate name.
  -- This is exactly what the resolver stores as person_role.ref, and the key the
  -- step-3 UPDATE joins on.
  subject_ref      text NOT NULL,
  declarant_name   text NOT NULL,
  institution      text,
  position_title   text,
  -- ⚠️ institution / position_title / category come from the register's LISTING page, NOT
  -- from the filing. They are GROUP labels: `position_title` = 'Служебен министър-председател
  -- и министър' covers two different people, neither of whom was caretaker PM — both were
  -- DEPUTY PM and a minister — and the register has a separate 'Служебен заместник
  -- министър-председател и министър' bucket they were not put in. Rendering either as a
  -- person's job publishes a false claim about a named individual; that reached a card on
  -- 2026-08-16. Use filed_institution / filed_position below for anything a reader sees.
  category         text,               -- register category label (categorise.ts bucket)
  declaration_type text,               -- Annualy | Entry | Vacate | Other
  -- The effective snapshot year — the resolved `declarationYear` the app sorts
  -- filings by (parse_declaration.resolveDeclarationYear: an annual's fiscal+1,
  -- clamped to the folder). This is the wealth series' x-axis and the "latest
  -- filing" key; it is NOT the same as register_year for a genuinely late filing.
  declaration_year int NOT NULL,
  fiscal_year      int,                -- the year the filing COVERS (may be null)
  register_year    int NOT NULL,       -- the register folder it was published in
  -- (declaration_year is retrofitted below via ALTER for any DB that materialized
  --  this table before the column existed; CREATE keeps it NOT NULL for fresh DBs.)
  filed_at         date,
  entry_number     text,
  control_hash     text,
  -- The declarant's OWN institution and job, as stated in the filing's <Personal><Work>
  -- and <Personal><Position>. Per-filing and authoritative — this is the field that says
  -- Рашков was МВР's minister in 2021 and an MP from 2022, which no listing label does.
  -- NULL until backfilled: the parser only learned to read them on 2026-08-16, and the raw
  -- XML cache covers ~10% of the corpus, so the rest arrives via
  -- scripts/declarations/backfill_filed_position.ts.
  filed_institution text,
  filed_position    text,
  source_url       text NOT NULL UNIQUE
);

-- "Everything for person N" and "everything in register year Y" are the two hot
-- reads; the wealth series walks a person's filings newest-first.
CREATE INDEX IF NOT EXISTS idx_declaration_person ON declaration (person_id);
CREATE INDEX IF NOT EXISTS idx_declaration_subject ON declaration (tier, subject_ref);
CREATE INDEX IF NOT EXISTS idx_declaration_year ON declaration (register_year);

-- Retrofit declaration_year onto a table created before the column existed (the
-- CREATE above is a no-op then). Added nullable because ADD COLUMN NOT NULL fails
-- against a table that still holds rows; the loader always fills it, so a fresh DB
-- keeps the CREATE's NOT NULL and a retrofitted one is populated on the next load.
ALTER TABLE declaration ADD COLUMN IF NOT EXISTS declaration_year int;
-- Same retrofit for the per-filing job fields: CREATE TABLE IF NOT EXISTS is a no-op on a
-- warm database, so without these the columns reach a fresh clone and nowhere else.
ALTER TABLE declaration ADD COLUMN IF NOT EXISTS filed_institution text;
ALTER TABLE declaration ADD COLUMN IF NOT EXISTS filed_position text;

-- ---------------------------------------------------------------------------
-- declared_label(filed, listed) — the ONE definition of "which label does a reader see".
--
-- Prefer the filing's own value; fall back to the register's LISTING label.
--
-- WHY THE FILED VALUE WINS. Measured 2026-08-17, after backfill_filed_position.ts finished
-- (61,740 of 61,743 filings carry a filed_position; the 3 exceptions are filings whose
-- <Position> the register itself leaves empty):
--
--   * The mp tier has NO listing position at all — position_title is NULL on all 6,296 mp
--     rows — so filed_position is the only source there. Those surfaces render an empty
--     position today and can only gain.
--   * Where both exist (55,444 rows) they disagree on 36,199 exactly and on 21,906 once
--     case and whitespace are folded (39.5%): exec 20,583 of 48,831, muni 1,323 of 6,613.
--     That disagreement is the whole defect — the listing bucket 'Служебен министър-
--     председател и министър' held two men and described neither, both being a DEPUTY PM
--     plus a minister, and it reached a published card on 2026-08-16.
--
-- WHY THE FALLBACK IS STILL LOAD-BEARING, now that the local corpus is ~fully backfilled
-- and only 3 rows would blank here. The reason is structural rather than statistical, and
-- it is about the OTHER databases:
--
--   * Cloud SQL has neither these columns nor any backfill. With filed_* uniformly NULL
--     every caller below degrades to exactly the label it serves today — which is what
--     lets 089 and its eight dependents ship there ahead of any crawl, with nothing a
--     reader sees changing until the values arrive.
--   * A fresh clone, a partial reload, or a newly ingested filing the backfill has not
--     reached yet is the same shape. The listing label is coarse but TRUE where it is all
--     we have: the five municipal labels are genuine roles, and the exec tier's 8,078
--     distinct 'Директор' declarants really are directors.
--
-- So the fallback is not a hedge against the filed value — it is what makes the swap safe
-- to apply to a database that has not been backfilled, which is every database except this
-- one.
--
-- nullif(btrim(...), '') rather than a bare COALESCE. No filing carries an empty capture
-- today (the 3 filings whose <Position> the register leaves empty are NULL, not ''), so
-- this guards the shape rather than an observed row: a future parser that writes '' for a
-- present-but-blank element must fall THROUGH to the listing label, not blank the cell.
-- Note the btrim is not only a guard — the filed value is returned TRIMMED, so a stored
-- ' министър ' serves as 'министър'. That is deliberate: these values are rendered, and
-- they back equality filters on three matview columns, where a stray edge space is an
-- invisible miss. The listing-label branch is passed through untouched, since it is
-- already the value every one of those surfaces filters on today.
--
-- ⚠️ Do NOT restate this COALESCE at a call site. Twelve hand-copied copies is the shape
-- that produced the six-way `magistrate_current` duplication, where "someone missed one"
-- fired twice in one day. The precedent to follow is kzk_effective_suspension(suspension,
-- status) in 042: name the rule once, read it everywhere.
--
-- Every dependent below is a LANGUAGE sql body, validated at CREATE time — so this
-- function must exist BEFORE 090/093/098/100/102/105/120/159 are applied, or each of them
-- raises 42883 and rolls its whole file back. 089 is the phase-1 SCHEMA file, applied
-- before all of them by load_declarations_pg.ts, which is why it lives here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION declared_label(p_filed text, p_listed text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(nullif(btrim(p_filed), ''), p_listed)
$$;

-- ---------------------------------------------------------------------------
-- is_declared_holding(table_num) — the ONE definition of "is this row part of the
-- declarant's estate", read by every surface that sums a net worth.
--
-- FALSE for exactly two tables, and the register's own column headers are the reason:
--
--   1.2  „Чуждо недвижимо имущество"                    money col „Цена ПО ДОГОВОР"
--   3.4  „Чужди моторни сухопътни, водни и въздухоплавателни …"   basis col „…за ПОЛЗВАНЕ"
--
-- against table 1/3's „Цена на ПРИДОБИВАНЕ" / „Правно основание за ПРИДОБИВАНЕ". These are
-- assets someone ELSE owns that the declarant rents or has been provided with, and the
-- figure beside them is what the use costs — so it is not a mis-attributed asset value at
-- all. Пеевски's 2025 annual files Table 1 and Table 3 as Declared="False" and declares
-- eight rented houses and five provided cars; before this function his published estate was
-- €10,070,563 against a real €9,760,147.
--
-- ⚠️ Do NOT restate the `NOT IN ('1.2','3.4')` at a call site — same rule as declared_label
-- above, and the same reason. Five surfaces read this (090 ×2, 092, 100, 105) and a sixth
-- added without it publishes the old figure with every row count reconciling.
--
-- NULL RETURNS TRUE, and that is load-bearing rather than lenient. table_num is filled only
-- by a re-parse of the source XML (the provenance exists nowhere else), so every row on a
-- database that has not reloaded is NULL — and reading NULL as "not a holding" would delete
-- every real estate from every published figure at once. NOT STRICT for that reason: STRICT
-- would return NULL, which `WHERE is_declared_holding(...)` filters out, i.e. exactly the
-- catastrophic reading. The migration is inert until the corpus can answer the question.
--
-- NOT restricted to real_estate/vehicle either. The predicate is about the TABLE, and a
-- future form revision that adds a чуждо subtable in the money family must be excludable
-- here without also having to find every caller.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_declared_holding(p_table_num text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT p_table_num IS DISTINCT FROM '1.2' AND p_table_num IS DISTINCT FROM '3.4'
$$;

-- ---------------------------------------------------------------------------
-- Asset rows — real estate, vehicles, cash, bank, receivables, debts, investments,
-- securities. category matches the parser's MpAssetCategory. value_eur is the
-- signed contribution the app already computes (a debt is negative in net worth,
-- but stored here as its declared magnitude; sign is applied by the matview).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS declaration_asset (
  declaration_id bigint NOT NULL REFERENCES declaration (declaration_id) ON DELETE CASCADE,
  seq            int NOT NULL,        -- position within the declaration, for stable order
  -- Which table of the form the row came from, as the CANONICAL (2018-form) number:
  -- '1', '1.1', '1.2', '3'…'3.4', '4'…'9'. Same convention as declaration_stake.table_num,
  -- which stores '10'/'11' for both form versions — the PRINTED number is version-dependent
  -- and ambiguous (the pre-2018 form's '4' is boats, the current one's is cash).
  --
  -- ⚠️ THIS IS THE ONLY THING SEPARATING A HOLDING FROM SOMETHING MERELY USED, and every
  -- net-worth sum must go through is_declared_holding() above. Tables 1.2 („Чуждо недвижимо
  -- имущество") and 3.4 („Чужди … превозни средства") are property and vehicles owned by
  -- SOMEBODY ELSE that the declarant rents or is provided with. The register's own headers
  -- say so: their money column is „Цена по договор" against table 1/3's „Цена на
  -- придобиване", and their basis column „Правно основание за ползване" against „…за
  -- придобиване" — so the figure is what the USE costs, not a value the declarant holds.
  --
  -- Neither `category` nor `legal_basis` can stand in. A чуждо flat is still real_estate;
  -- and Пеевски's чужди cars carry legal_basis = 'договор', which is also what Румен Радев's
  -- OWN car carries. Measured before this column existed: €69.5m across 5,183 rows was
  -- published as declared wealth, €58.7m of it reaching person_wealth_year — 106 people
  -- whose published estate was ≥90% other people's property, and one at 100%.
  --
  -- NO CHECK CONSTRAINT ON PURPOSE: a subtable added by a future form revision must land as
  -- data, not abort the whole COPY. NULL = parsed before the column existed, and
  -- is_declared_holding() reads that as a holding — the pre-existing behaviour, and the
  -- safe direction (the other way silently deletes real estates from every figure).
  table_num      text,
  -- 'credit_limit' is Table 7 like 'debt', but an available credit LINE rather than money
  -- owed — see creditLimitRow in scripts/declarations/parse_declaration.ts. Separate so the
  -- `category = 'debt'` filters in 090/105 exclude it without restating the rule: a declared
  -- limit is what the holder COULD draw, and subtracting it asserts a debt nobody declared.
  category       text NOT NULL CHECK (category IN (
                   'real_estate', 'vehicle', 'cash', 'bank',
                   'receivable', 'debt', 'credit_limit', 'investment', 'security')),
  description    text,
  detail         text,
  location       text,
  municipality   text,
  ekatte         text,                -- RESERVED: settlement code for the T3.7 AVM join;
                                      --   not populated yet (needs the settlement
                                      --   resolver over location/municipality text)
  area_sqm       numeric,
  built_area_sqm numeric,
  acquired_year  int,
  share          text,                -- ideal part, raw ("1/2", "100%")
  currency       text,
  amount         numeric,             -- as declared, in `currency`
  value_eur      numeric,             -- see value_basis for HOW
  -- HOW value_eur was arrived at — 'equiv' | 'peg' | 'fx_ecb' | NULL.
  --
  -- 'equiv'  the declarant's own „Равностойност в лв./в евро." cell (Cell Num=4)
  -- 'peg'    BGN/EUR at the locked 1.95583, or EUR identity
  -- 'fx_ecb' OURS — the ECB reference rate at the end of the period the filing covers,
  --          applied only because the declarant left that cell blank
  -- NULL     no euro figure at all; person_wealth_year.excluded_asset_rows counts the row
  --
  -- ⚠️ THE POINT IS THAT 'fx_ecb' IS DISTINGUISHABLE. Before this column, a USD row with no
  -- declarant equivalent was stored with amount + currency and a NULL value_eur, and dropped
  -- out of every wealth aggregate silently — 462 rows over 155 published people, including a
  -- 4,481,442 USD bank balance, and one person published at −€121,331 net whose true position
  -- was positive. Converting them fixes that; converting them WITHOUT saying so would replace
  -- a silent omission with a silent invention. See docs/plans/declaration-fx-conversion-v1.md.
  --
  -- NO CHECK CONSTRAINT, for the same reason table_num has none: a basis a future parser adds
  -- must land as data rather than abort the whole COPY. The vocabulary is gated in the data
  -- test instead.
  --
  -- NULL also means "parsed before the column existed", which is why nothing may read a NULL
  -- basis as evidence about the value beside it — only `value_eur IS NULL` says that.
  value_basis    text,
  holder_name    text,
  is_spouse      boolean NOT NULL DEFAULT false,
  legal_basis    text,
  funds_origin   text,
  PRIMARY KEY (declaration_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_declaration_asset_category
  ON declaration_asset (category);
-- ekatte is loader-derived so declared real estate can join the property AVM by
-- settlement (T3.7 declared-vs-market). Partial — only a minority of rows resolve.
CREATE INDEX IF NOT EXISTS idx_declaration_asset_ekatte
  ON declaration_asset (ekatte) WHERE ekatte IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Income rows — table 12 (v2) / 13 (v1). Declarant and spouse amounts are already
-- in EUR at the peg. parent groups sub-rows the register nests under a heading.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS declaration_income (
  declaration_id bigint NOT NULL REFERENCES declaration (declaration_id) ON DELETE CASCADE,
  seq            int NOT NULL,
  parent         text,
  category       text,
  eur_declarant  numeric,
  eur_spouse     numeric,
  PRIMARY KEY (declaration_id, seq)
);

-- ---------------------------------------------------------------------------
-- Ownership stakes — ООД/shares held (logical table 10) and transferred (11). uic
-- is filled by the loader where the company resolves in TR; company_slug lets the
-- /person page link straight to the company page (the derived tree already carries
-- both). This is the row that makes "which officials own a stake in a company that
-- won a contract" a single join.
-- ---------------------------------------------------------------------------
-- company_slug is the live company link today (the MP enrichment chain resolves it;
-- officials/municipal stakes carry it once that chain is extended). uic is RESERVED
-- for a later EIK resolution (name_fold match against tr_companies) — the
-- stake↔contract join (T3.8) needs it, but the derived tree does not carry it yet.
CREATE TABLE IF NOT EXISTS declaration_stake (
  declaration_id    bigint NOT NULL REFERENCES declaration (declaration_id) ON DELETE CASCADE,
  seq               int NOT NULL,
  table_num         text NOT NULL CHECK (table_num IN ('10', '11')),  -- held | transferred
  -- WHAT the row is, as opposed to WHEN (table_num). Since the две интереси forms
  -- are parsed this table holds three different things, and only this column tells
  -- them apart: a shareholding, a MANAGEMENT ROLE ("Съм управител или член на орган
  -- на управление или контрол" — explicitly not a holding) and a sole-tradership.
  -- ANY consumer presenting a row as ownership must filter on it. NULL only on rows
  -- loaded before the column existed; those are all asset-form shareholdings.
  stake_kind        text CHECK (stake_kind IN ('share', 'role', 'sole_trader')),
  -- The register's own heading for the row, for DISPLAY. Never branch on it: it is
  -- free text on the asset form and a Bulgarian sentence on the интереси ones, so a
  -- SQL predicate matching it breaks the day the phrasing is improved.
  item_type         text,
  company_name      text,
  uic               text,              -- RESERVED: EIK, resolved in a later step
  holder_name       text,              -- who holds it (table 10)
  transferee_name   text,              -- who it was transferred TO (table 11) — the
                                       --   substance of a disposal row; feeds T3.4/T3.8
  share_size        text,              -- raw ("100%", a numeric quantity). On a ROLE
                                       --   row this is the role itself ("Управител"),
                                       --   which is why stake_kind and not a regex
                                       --   over this column is the discriminator.
  value_eur         numeric,
  registered_office text,
  company_slug      text,
  PRIMARY KEY (declaration_id, seq)
);
-- Same reason as the declaration_event CHECK below: CREATE TABLE IF NOT EXISTS is a
-- no-op on a database that already has the table, so neither new column would ever
-- reach one — and the loader's COPY, which names them, fails with 42703. Restating
-- them is the idempotent form.
ALTER TABLE declaration_stake ADD COLUMN IF NOT EXISTS stake_kind text;
ALTER TABLE declaration_stake ADD COLUMN IF NOT EXISTS item_type  text;
ALTER TABLE declaration_stake DROP CONSTRAINT IF EXISTS declaration_stake_stake_kind_check;
ALTER TABLE declaration_stake ADD CONSTRAINT declaration_stake_stake_kind_check
  CHECK (stake_kind IN ('share', 'role', 'sole_trader'));
-- Forward declaration for the T3.8 company join — empty until uic is resolved.
CREATE INDEX IF NOT EXISTS idx_declaration_stake_uic
  ON declaration_stake (uic) WHERE uic IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Events — the disposal / third-party tables that are NOT part of net worth at
-- filing time (parser tables 2, 3.5, 13/14 → the `events` array, audit T1.6).
-- Excluded from wealth totals by construction; this is the disposals feed (T3.4).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS declaration_event (
  declaration_id bigint NOT NULL REFERENCES declaration (declaration_id) ON DELETE CASCADE,
  seq            int NOT NULL,
  kind           text NOT NULL CHECK (kind IN (
                   'disposal_property', 'disposal_vehicle',
                   'third_party_expense', 'guarantee',
                   -- The three INTERESTS-form kinds (Dekl2 / Dekl3). Same rule:
                   -- recorded by a filing, not a holding, never in a net worth.
                   'interest_contract', 'related_person', 'early_repayment')),
  description    text,
  detail         text,
  location       text,
  municipality   text,
  area_sqm       numeric,
  built_area_sqm numeric,
  currency       text,
  value_eur      numeric,
  -- MEANS TWO THINGS, by kind. On the four asset-form kinds it is the правно
  -- основание ("възмездно", "дарение", …). On `early_repayment` it is cell 10,
  -- ПРОИЗХОД НА СРЕДСТВАТА — where the money to settle the debt came from, which
  -- is the only reason that table exists. That row's actual правно основание
  -- (cell 7) is free text and deliberately never read: a declarant typing their
  -- loan CONTRACT NUMBER into it is what the old misparse published as a €3.58bn
  -- holding. So do not label this column "правно основание" in a payload.
  legal_basis    text,
  PRIMARY KEY (declaration_id, seq)
);
-- CREATE TABLE IF NOT EXISTS above is a no-op on a database that already has the
-- table, so a widened CHECK never reaches it — and the loader then fails the
-- whole declarations COPY with a constraint violation on the first interests
-- row. Restate it explicitly. DROP … IF EXISTS + ADD is the idempotent form;
-- the ADD re-validates the existing rows, which is cheap at this table's size
-- and is the point (it proves nothing already stored falls outside the list).
ALTER TABLE declaration_event DROP CONSTRAINT IF EXISTS declaration_event_kind_check;
ALTER TABLE declaration_event ADD CONSTRAINT declaration_event_kind_check
  CHECK (kind IN ('disposal_property', 'disposal_vehicle',
                  'third_party_expense', 'guarantee',
                  'interest_contract', 'related_person', 'early_repayment'));
CREATE INDEX IF NOT EXISTS idx_declaration_event_kind
  ON declaration_event (kind);

-- Reconcile table_num onto a warm database — CREATE TABLE IF NOT EXISTS above is a no-op
-- once the table exists, so without this the column reaches a fresh clone and nowhere else.
-- Backfilling it is NOT possible in SQL: the provenance exists only in the source XML, so
-- warm rows stay NULL until scripts/declarations/rebuild_all_from_cache.ts re-parses the
-- corpus and the loader re-COPYs it. See docs/plans/declaration-foreign-assets-v1.md.
ALTER TABLE declaration_asset ADD COLUMN IF NOT EXISTS table_num text;

-- Same reconcile, same reason, for value_basis — and with the same caveat: no SQL can
-- backfill it, because whether a figure came from the declarant's Равностойност cell or from
-- the peg is only recoverable by re-parsing the source XML. Warm rows stay NULL until
-- scripts/declarations/backfill_asset_fx.ts has run and the loader has re-COPYed.
ALTER TABLE declaration_asset ADD COLUMN IF NOT EXISTS value_basis text;

-- Reconcile the category CHECK on a warm database: CREATE TABLE IF NOT EXISTS above is a
-- no-op once the table exists, so a running database would keep the pre-credit_limit
-- vocabulary and the loader's first credit_limit row would abort the whole COPY.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'declaration_asset'::regclass
       AND conname  = 'declaration_asset_category_check'
       AND pg_get_constraintdef(oid) NOT LIKE '%credit_limit%'
  ) THEN
    ALTER TABLE declaration_asset DROP CONSTRAINT declaration_asset_category_check;
    ALTER TABLE declaration_asset ADD CONSTRAINT declaration_asset_category_check
      CHECK (category IN ('real_estate', 'vehicle', 'cash', 'bank',
                          'receivable', 'debt', 'credit_limit', 'investment', 'security'));
  END IF;
END $$;
