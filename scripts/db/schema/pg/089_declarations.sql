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

-- ---------------------------------------------------------------------------
-- Asset rows — real estate, vehicles, cash, bank, receivables, debts, investments,
-- securities. category matches the parser's MpAssetCategory. value_eur is the
-- signed contribution the app already computes (a debt is negative in net worth,
-- but stored here as its declared magnitude; sign is applied by the matview).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS declaration_asset (
  declaration_id bigint NOT NULL REFERENCES declaration (declaration_id) ON DELETE CASCADE,
  seq            int NOT NULL,        -- position within the declaration, for stable order
  category       text NOT NULL CHECK (category IN (
                   'real_estate', 'vehicle', 'cash', 'bank',
                   'receivable', 'debt', 'investment', 'security')),
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
  value_eur      numeric,             -- converted at the locked peg
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
  company_name      text,
  uic               text,              -- RESERVED: EIK, resolved in a later step
  holder_name       text,              -- who holds it (table 10)
  transferee_name   text,              -- who it was transferred TO (table 11) — the
                                       --   substance of a disposal row; feeds T3.4/T3.8
  share_size        text,              -- raw ("100%", a numeric quantity)
  value_eur         numeric,
  registered_office text,
  company_slug      text,
  PRIMARY KEY (declaration_id, seq)
);
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
                   'third_party_expense', 'guarantee')),
  description    text,
  detail         text,
  location       text,
  municipality   text,
  area_sqm       numeric,
  built_area_sqm numeric,
  currency       text,
  value_eur      numeric,
  legal_basis    text,
  PRIMARY KEY (declaration_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_declaration_event_kind
  ON declaration_event (kind);
