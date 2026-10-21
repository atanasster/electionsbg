-- 202_magistrate_filing_money.sql — the ИВСС declaration MONEY tables, per filing: № 10
-- налични парични средства, № 11 банкови сметки, № 13 задължения и кредити над 10 000 лева.
--
-- Source: raw_data/judiciary/filing_cache.json (`money`), written by the operator-run
-- scripts/judiciary/crawl_declarations.ts (`--backfill-money` for a cache crawled before it);
-- loaded by scripts/db/load_magistrate_filing_assets_pg.ts beside 185. Parsed by
-- scripts/judiciary/moneyTables.ts.
--
-- ⚠️⚠️ STORAGE ONLY — THERE IS DELIBERATELY NO GRANT TO app_readonly. Owner decision
-- 2026-10-21 (deferred-followups-verification-fixes-v1 T4.8, „precondition only"): these rows
-- may not reach `person_wealth_year`, a page, a route or the AI chat until a rule exists for
-- which register wins when one person has BOTH an ИВСС filing and a КПКОНПИ / Сметна палата
-- one for the same year. 090 keeps ONE declaration per (person, period_year), so wiring this
-- in would arbitrate between two registers silently. The missing GRANT is what makes that
-- structural rather than a convention: the serving pool connects as app_readonly, so a route
-- that selected from here would 42501 rather than publish. Adding the GRANT IS the decision —
-- do it in the same change that writes the arbitration rule down.
--
-- WHAT THE ROWS ARE. All three tables are STOCKS — the balance at 31.12 of the declared year
-- (verified on a 2026 filing), unlike Таблица 1 in 185, which is a FLOW. So a single annual
-- filing does state a money position, which is why these were the first candidates for a
-- wealth figure at all.
--
-- `value_eur` RULE (moneyTables.ts, one definition): a EUR row is its amount; a BGN row is its
-- amount at the 1.95583 peg; a third currency takes the declarant's own equivalence cell in
-- the unit the column's header states — the only figure in лева/евро the document gives for
-- it — and NULL when that cell is blank. The equivalence is NOT used for BGN/EUR rows: the
-- validation measured declarants getting it wrong (a rate of 2.0 on „3400 EUR → 6800", a
-- typo „35000 BGN → 30000"), and both readings come straight off the printed page.
--
-- VALIDATION (scripts/judiciary/validate_money_tables.ts, 2026-10-21): 160 random current-form
-- filings over four seeds, every table read, 450 rows whose own redundancy (equivalence vs
-- amount × rate) checks out, 2 that do not — and both are printed that way in the PDF (Гешева
-- 2024 „850 EUR → 1467", Георгиев 2025 „35000 BGN → 30000"), i.e. declarant errors, not
-- misreads. Hand-checked: Ковачев 2025 (cash + bank = 267,374 лв, the figure Phase 6's reader
-- fell 24% short of), Шутова 2025 (Phase 6's „false positive" 6,854 лв is her real 3,500 EUR
-- deposit), Цацаров 2026, Адамова-Петкова 2026.
--
-- ⚠️ A TABLE RUNS ONTO THE NEXT PAGE, often — the overleaf page has no caption and no header,
-- only the ordinals (Георгиева-Димитрова 2025: Таблица № 13 rows 1-4 on page 6, the spouse's
-- five debts 5-9 on page 7). The reader's first cut stopped at the page footer and stored a
-- truncated table with NO refusal and a matching row_count — invisible to every gate here. On
-- the validation sample the fix added 29 rows to № 13 alone. moneyTables.ts follows a
-- continuation only while the ordinals keep counting up, the readTable rule.
--
-- ⚠️ v3.0 / v4.0 ONLY. Pre-v3.0 forms lay these tables out differently and are refused — and
-- a refusal is stored in magistrate_filing_money_read, never as zero rows, because „this
-- document could not be read" and „declared no money" are different claims about a named
-- judge.

CREATE TABLE IF NOT EXISTS magistrate_filing_money (
  source_url      text NOT NULL,
  magistrate_name text NOT NULL,
  table_num       text NOT NULL CHECK (table_num IN ('10', '11', '13')),
  ord             int NOT NULL,
  -- As declared, in `currency` — BGN, EUR or another ISO code as written.
  amount          numeric NOT NULL,
  currency        text NOT NULL,
  -- The declarant's own equivalence cell, in `equiv_unit`; NULL when left blank (common on a
  -- лев row, whose amount already IS the лев value).
  equiv           numeric,
  -- The equivalence column's unit, read from its own header label („в лв."). NULL on a v4.0
  -- filing: the euro reissue DROPPED the equivalence column from all three tables, so a v4.0
  -- row in a third currency carries no euro value at all rather than one at a rate the
  -- document does not state.
  equiv_unit      text CHECK (equiv_unit IN ('BGN', 'EUR')),
  value_basis     text CHECK (value_basis IN ('amount-eur', 'amount-bgn', 'equiv')),
  value_eur       numeric,
  -- The text printed BEFORE the amount — on № 13 the kind of debt („кредитна карта",
  -- „финансов лизинг"); NULL on № 10/11, whose amount is the first cell.
  lead            text,
  -- Holder, origin and the domestic/abroad flags as one verbatim string — not split, because
  -- nothing reads them yet and a split is a claim about column positions this reader does
  -- not verify.
  rest            text,
  PRIMARY KEY (source_url, table_num, ord),
  CHECK ((value_eur IS NULL) = (value_basis IS NULL)),
  CHECK (equiv_unit IS NOT NULL OR equiv IS NULL)
);

-- One row per (filing, table) the crawl PARSED: `refused` NULL = read (its rows, possibly
-- none, are above); non-NULL = the reason it could not be. A filing with no row here was
-- never parsed for money at all — the third state, and the reason this is a table rather
-- than a nullable column.
CREATE TABLE IF NOT EXISTS magistrate_filing_money_read (
  source_url text NOT NULL,
  table_num  text NOT NULL CHECK (table_num IN ('10', '11', '13')),
  refused    text,
  row_count  int NOT NULL DEFAULT 0,
  PRIMARY KEY (source_url, table_num)
);

-- No GRANT — see the header. Revoke defensively too, so a database where somebody granted it
-- by hand is brought back to the storage-only state on the next load.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    REVOKE ALL ON magistrate_filing_money, magistrate_filing_money_read FROM app_readonly;
  END IF;
END $$;
