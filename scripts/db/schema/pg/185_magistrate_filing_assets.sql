-- 185_magistrate_filing_assets.sql — the per-FILING property rows parsed out of the ИВСС
-- declarations (чл. 175б ЗСВ), and the three facts about a filing that are readable only
-- from the document itself.
--
-- Source: raw_data/judiciary/filing_cache.json, written by the operator-run
-- scripts/judiciary/crawl_declarations.ts; loaded by scripts/db/load_magistrate_filing_
-- assets_pg.ts. Parsed by scripts/judiciary/declarationTables.ts, whose refusals are what
-- make this safe to store at all.
--
-- ⚠️ TWO BASES IN ONE TABLE, AND CONFLATING THEM PUBLISHES A FALSE ESTATE.
--   table_num = '1'  Таблица 1 — on an ANNUAL filing, property ACQUIRED during the declared
--                    period; on an ENTRY filing, the WHOLE estate at the date of taking
--                    office. The two are distinguished ONLY by magistrate_filing.kind.
--   table_num = '2'  Таблица 2 — property TRANSFERRED AWAY during the period.
--
-- So `SUM` over table 1 is not what a magistrate owns, and never can be on its own. The
-- accounting that closes is
--     estate = entry snapshot + Σ table-1 acquisitions − Σ table-2 disposals
-- and it requires an entry/exit filing inside the register's window. Measured over a
-- 40-magistrate sample: only 4 have one (95% CI [2.8%, 23.7%]). For everyone else the
-- register holds movements with no opening balance and NO arithmetic over these rows yields
-- an estate. See docs/plans/magistrate-declaration-detail-v1.md, Findings 0 and 0b.
--
-- ⚠️ THE FORM-VERSION GUARD REFUSES FORWARD AS WELL AS BACK. declarationTables.ts maps v3.0
-- and v4.0; the register's older years are largely pre-v3.0 (61% of the 51,040-filing index),
-- order their same 12 columns differently, and stay refused — a static backlog.
--
-- **v4.0 was the FORWARD half and is now mapped (2026-08-25).** It is not a new layout: it is
-- v3.0 re-denominated for Bulgaria's 2026-01-01 euro adoption, verified across 6 v4.0 and 2
-- v3.0 filings as the same 12 columns at the same x-positions, with „Цена на сделката /лева/"
-- becoming „…/евро/" on both tables 1 and 2. Mapping it took the refusals from 21,589 to
-- 21,388 and the magistrates carrying a read property count from 3,497 to 3,587.
--
-- The lesson it leaves is the one in price_currency below: a version guard protects the
-- COLUMN ORDER and says nothing about what the numbers MEAN. Sharing a map was the easy half.
--
-- Nothing serves these rows yet. This is storage; what may be PUBLISHED about a named judge
-- is a separate, evidence-led decision recorded in that plan.

-- ---------------------------------------------------------------- the filing's own facts --
-- These three come from the document and from nowhere else: the register's index carries no
-- declaration type, and its directory (`register_dir`) is not one — the ИВСС files some
-- ANNUAL declarations into the `-1` „change" directory.
ALTER TABLE magistrate_filing
  -- annual | entry | exit | post-exit | interests | unknown.
  -- ⚠️ `unknown` IS AN ANSWER — 34.6% of sampled filings state no kind at all (older forms
  -- whose marker row the ИВСС does not print). It must never be rounded to `annual`: doing
  -- so reads an entry filing's whole-estate snapshot as one year's acquisitions.
  ADD COLUMN IF NOT EXISTS kind text,
  -- The calendar year the filing COVERS. NULL where the form leaves it blank, which is the
  -- document's own answer on 38.9% of filings — entry/exit filings are anchored to a DATE by
  -- design, and plenty of annuals simply are not filled in. Nothing may substitute
  -- `magistrate_filing.year`, which is the year the filing was LODGED and differs by one on
  -- every annual.
  ADD COLUMN IF NOT EXISTS period_year int,
  -- „3.0" for the current form, NULL for pre-v3.0. Decides whether the tables were readable:
  -- the older form has the SAME twelve columns in a DIFFERENT ORDER, so the parser refuses it
  -- rather than publishing every value under the wrong heading.
  ADD COLUMN IF NOT EXISTS form_version text,
  -- Why a table could not be read, when it could not — `form-version`, `no-header`,
  -- `column-count`. A refusal is a FACT about the document and is stored, so a surface can
  -- say „not readable" instead of „nothing declared". Those are different claims about a
  -- named judge and only one of them is true.
  ADD COLUMN IF NOT EXISTS table1_refused text,
  ADD COLUMN IF NOT EXISTS table2_refused text;

CREATE TABLE IF NOT EXISTS magistrate_filing_asset (
  -- The filing this row was parsed from. Keyed on the register's own URL, the same key
  -- magistrate_filing uses, so the two cannot drift.
  source_url      text NOT NULL,
  magistrate_name text NOT NULL,
  -- '1' (acquisitions / entry snapshot) or '2' (disposals) — see the header.
  table_num       text NOT NULL CHECK (table_num IN ('1', '2')),
  -- Position within its table, as printed.
  ord             int NOT NULL,

  -- The declared cells, verbatim. Everything here is what the magistrate WROTE; nothing is
  -- normalised, resolved or inferred, because a tidied value cannot be checked against the
  -- document a reader opens.
  kind_of_property text,   -- „вила", „апартамент със склад - груб строеж"
  location         text,   -- „гр. София", „Балчик - …"
  municipality     text,
  area            text,    -- kept as TEXT: the column mixes кв.м. and декара across tables
  built_area      text,
  -- ⚠️ THE AMOUNT AS WRITTEN, AND NOT ALWAYS IN LEVA — read price_currency beside it.
  -- The column keeps its name for continuity, but „лв" is no longer implied: Bulgaria adopted
  -- the euro on 2026-01-01 and the ИВСС reissued the form as v4.0 with „Цена на сделката
  -- /евро/". Nothing is converted at ingest, deliberately — the figure a row shows must be
  -- the figure printed on the document it links to.
  price_lv         numeric, -- the price as written; NULL when the cell is blank
  acquired_year    int,
  holder_name      text,   -- „Собственик" — often the declarant, sometimes a spouse
  share            text,   -- идеална част: „1/1", „1/2", „СИО", „Изцяло", „6,448"
  legal_basis      text,   -- „покупко-продажба", „брачен договор", „дарение"
  funds_origin     text,   -- „банков кредит, наеми" — table 1 only

  -- ⚠️ FALSE means the row was SPARSE and its cells were assigned by nearest column header
  -- rather than positionally, which can merge two adjacent runs into one cell — „2023 Теодора
  -- Асио Доненчева" arrived in „година на придобиване", the year and the owner together.
  -- A surface that publishes cell VALUES should require this; one that counts rows need not.
  exact           boolean NOT NULL DEFAULT false,
  PRIMARY KEY (source_url, table_num, ord)
);

-- The unit `price_lv` is denominated in, read from the price column's OWN header on each
-- document — never inferred from the form version and above all never from the year.
--
-- ⚠️ 2026 CARRIES BOTH FORMS. Measured on the full corpus: 3,483 of that year's filings are
-- v3.0 in лева beside 201 v4.0 in евро. A year-based rule would restate 3,483 filings' prices
-- at 1.95583× against named judges, and a version-based one is right today and one reissue
-- from being wrong. declarationTables.priceCurrency() reads the label, and readTable REFUSES
-- a document that states no unit — so a stored row always knows what its number means.
--
-- Nullable only because a row loaded before this column existed cannot know; the loader
-- always writes it, and magistrate_filing_assets.data.test.ts fails on a NULL.
--
-- ⚠️⚠️ THERE IS A THIRD DENOMINATION AND IT IS NOT EXPRESSIBLE HERE — DELIBERATELY.
-- Bulgaria redenominated the lev on 1999-07-05 at 1000:1, and declarations list property
-- acquired long before that under a header that says only „лева". Measured on the full
-- corpus: **42 positionally-exact rows are pre-1999 acquisitions priced at 100,000 or more,
-- 13 of them above a million** — an apartment bought in 1997 for „241 872", another in 1996
-- for „450 600". Those are almost certainly OLD leva, and they render today as modern ones.
--
-- The CHECK admits only BGN and EUR because the unit of those rows is genuinely UNKNOWABLE
-- per row: the header states „лева" either way, and declarants split between writing the
-- historical figure and restating it in modern leva. Adding a 'BGL' value would create a
-- slot that only a guess could ever fill — and a guessed 1000× is far worse than a visible
-- oddity. The acquisition YEAR is not evidence: a restating declarant and a historical one
-- produce the same row.
--
-- So this is recorded, not resolved — the same treatment as the „Площ /декара/" ambiguity in
-- the Сметна палата corpus. Any future surface that AGGREGATES these prices (a total, a
-- ranking, an average) must exclude or flag pre-1999 acquisitions first; rendering a single
-- row as the document wrote it is honest, summing it is not.
ALTER TABLE magistrate_filing_asset
  ADD COLUMN IF NOT EXISTS price_currency text
    CHECK (price_currency IN ('BGN', 'EUR'));
CREATE INDEX IF NOT EXISTS idx_mfa_magistrate
  ON magistrate_filing_asset (magistrate_name, table_num);

-- Warm databases get the columns only through the ALTERs above; CREATE TABLE IF NOT EXISTS is
-- a no-op there.
--
-- ⚠️ EACH ALTER SITS BETWEEN ITS OWN TABLE'S CREATE AND THE FIRST FUNCTION THAT READS IT —
-- NOT „at the top of the file", which an earlier version of this note claimed and which would
-- break the file in the other direction. Both bounds bind, and they bind on opposite sides:
--   • BELOW its CREATE TABLE, or on a cold database the ALTER hits a table that does not
--     exist yet (42P01). `magistrate_filing_asset` is created in THIS file, so its
--     `price_currency` ALTER must follow it — putting that one at the top fails every fresh
--     clone while passing on the machine that wrote it.
--   • ABOVE any LANGUAGE sql body that selects the column, which Postgres validates at CREATE
--     time (42703).
-- exec() sends this file as ONE transaction, so either mistake rolls back the whole
-- migration. `magistrate_filing`'s ALTERs are near the top because 070 creates that table;
-- `magistrate_filing_asset`'s is at line ~113 because this file creates it at ~63.

-- What a filing actually yielded, per filing. The refusal reasons ride along so a caller can
-- tell „no property declared" from „this document could not be read" without a second query.
CREATE OR REPLACE FUNCTION magistrate_filing_assets_json(p_source_url text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'tableNum', table_num, 'ord', ord,
    'kind', kind_of_property, 'location', location, 'municipality', municipality,
    'area', area, 'builtArea', built_area,
    'priceLv', price_lv, 'priceCurrency', price_currency,
    'acquiredYear', acquired_year,
    'holderName', holder_name, 'share', share,
    'legalBasis', legal_basis, 'fundsOrigin', funds_origin,
    'exact', exact
  ) ORDER BY table_num, ord), '[]'::jsonb)
  FROM magistrate_filing_asset WHERE source_url = p_source_url;
$$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON magistrate_filing_asset TO app_readonly;
  END IF;
END $$;
