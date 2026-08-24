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
-- ⚠️ THE FORM-VERSION GUARD REFUSES FORWARD AS WELL AS BACK, and the forward half is the one
-- that grows. declarationTables.ts accepts v3.0 and nothing else. The register's older years
-- are largely pre-v3.0 (61% of the 51,040-filing index) — a static backlog — but the ИВСС
-- began issuing **v4.0 in 2026**, and measured over the first 9,124 loaded filings ALL 201
-- form-version refusals are v4.0 and ALL are from 2026: 5.5% of that year against 0% in 2024
-- and 2025, with 90 magistrates' own records refused. That share rises every filing season,
-- it lands on the most current declarations, and nothing goes red when it does — refusing is
-- the designed behaviour. See the plan's Tier-2 validation section.
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
  price_lv         numeric, -- „Цена на сделката /лева/"; NULL when the cell is blank
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
CREATE INDEX IF NOT EXISTS idx_mfa_magistrate
  ON magistrate_filing_asset (magistrate_name, table_num);

-- Warm databases get the columns only through the ALTERs above; CREATE TABLE IF NOT EXISTS is
-- a no-op there. Placed at the TOP of the file for the same reason 070's `source_url` ALTER is
-- — a LANGUAGE sql body below would be validated at CREATE time against a table that does not
-- yet have them, raising 42703 and rolling the whole file back on every database except the
-- one that wrote it.

-- What a filing actually yielded, per filing. The refusal reasons ride along so a caller can
-- tell „no property declared" from „this document could not be read" without a second query.
CREATE OR REPLACE FUNCTION magistrate_filing_assets_json(p_source_url text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'tableNum', table_num, 'ord', ord,
    'kind', kind_of_property, 'location', location, 'municipality', municipality,
    'area', area, 'builtArea', built_area,
    'priceLv', price_lv, 'acquiredYear', acquired_year,
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
