# Declared assets in a foreign currency — dated ECB conversion + a visible residue

Status: planned 2026-08-18. Source finding: `docs/audits/mediapool-mp-declarations-2026-08-18.md` §1–2.

## 1. The defect

`declaration_asset` rows whose `currency` is USD / GBP / CHF are stored with `amount` and
`currency` set and **`value_eur = NULL`**, so they drop out of every money aggregate —
`person_wealth_year.assets_eur` / `debts_eur` / `net_eur` / `by_category`, `/persons`,
`/officials/assets`, `/mp-assets`, `officials_rankings_table` — with nothing flagging it.

Measured on the current corpus (local Postgres, 2026-08-18):

| | rows | filings | people | person-years |
|---|---|---|---|---|
| all unvalued `amount`+`currency` rows | **462** | 354 | 163 | 294 |
| …of which land on the filing `person_wealth_year` PUBLISHES | **356** | — | **155** | **280** |

`excluded_asset_rows` reports **0** for all 280 of those published person-years.

Split by currency (all rows):

| currency | rows | units | note |
|---|---|---|---|
| USD | 370 | 54,131,484 | dated conversion |
| GBP | 34 | 407,515 | dated conversion |
| CHF | 28 | 932,445 | dated conversion |
| `евро` / `Евро` / `ЕВРО` | 30 | 914,455 | **normalisation miss** — the peg applies, no conversion needed |

### 1.1 It is not a caveat-sized error

| person | period | published net | missing | |
|---|---|---|---|---|
| Лъчезар Богомилов Иванов | 2021 | €254,294 | €3,463,671 | published figure is **7%** of the truth |
| Лъчезар Богомилов Иванов | 2024 | €820,494 | €3,099,667 | +378% |
| Делян Славчев Пеевски | 2017 | €2,503,406 | €2,764,283 | +110% |
| Семир Хусеин Абу Мелих | 2014 | €52,919 | €638,033 | +1206% |
| Владимир Славев Табутов | 2023 | **−€121,331** | €622,032 | **the sign is wrong** — published as net liabilities |

The largest single dropped row is Пеевски's 2017 bank balance of **4,481,442 USD**. These are
plausible declared balances, not misparses.

### 1.2 What is actually broken is a FALLBACK, not a missing feature

Each money table (4 налични, 5 банкови сметки, 8 вложения) carries a `<Cell Num="4">` headed
„Равностойност в лв." (older forms) / „Равностойност в евро." (2026 forms), **filled in by the
declarant**. `pickEurValue` prefers it, falls back to the peg for BGN/EUR, and returns null
otherwise.

Most foreign rows therefore already convert — **4,347 of 4,717 USD rows**. The 462 are only the
filings where the declarant left that cell blank. So this is a hole in a fallback that already
exists and already produces euro figures for the same currencies on the same pages.

### 1.3 Scope is `declaration_asset` alone

- `declaration_income` has no currency column (`eur_declarant` / `eur_spouse` only).
- `declaration_stake` has no currency column (`value_eur` only).
- No `security`, `real_estate` or `vehicle` row carries USD/GBP/CHF — all 15 (category,
  currency) combinations are money-shaped (`bank`, `cash`, `debt`, `credit_limit`,
  `investment`, `receivable`). So no row where `amount` is a *share count* is in range.
- All 462 pass `is_declared_holding(table_num)` — genuine own holdings (tables 4/5/7/8), not
  чуждо. They belong in the totals.
- **12 are `debt` rows** (5 USD, 1 GBP, 6 евро). Dropping a debt OVERSTATES net worth, which
  090's own header calls the one direction it must never fail in.

## 2. Why a dated ECB rate, and WHICH one

### 2.1 The declarants follow no single convention — so it cannot be reverse-engineered

The 4,347 declarant-valued USD rows imply a rate per (currency, period year). Compared against
the real ECB series (`eurofxref-hist.csv`, fetched 2026-08-18):

| period | declarant median | ECB year-end | ECB annual avg |
|---|---|---|---|
| 2018 | 0.8733 | **0.8734** | 0.8468 |
| 2019 | 0.8902 | **0.8902** | 0.8933 |
| 2021 | 0.8828 | **0.8829** | 0.8455 |
| 2025 | 0.8513 | **0.8511** | 0.8850 |
| 2016 | 0.8590 | 0.9487 | 0.9034 |
| 2020 | 0.8822 | 0.8149 | 0.8755 |
| 2022 | 0.9203 | 0.9376 | 0.9496 |

Four years match year-end to four decimal places; the rest match nothing in particular. Some
declarants clearly use the 31.12 fixing, others the rate at filing time, others a stale number.
**There is no convention to reproduce**, so the choice has to be defensible on its own terms
rather than imitative.

### 2.2 The rule: ECB reference rate on the last quoted day of the PERIOD year

`period_year = COALESCE(fiscal_year, declaration_year)` — the same expression 090, 096 and
`declarationPeriod()` already use for the x-axis.

Year-end rather than annual average because **tables 4/5/8 declare a STOCK** — a balance as of
31 December of the reporting period, not a flow across it. An annual average is the wrong
statistic for a point-in-time quantity regardless of which one happens to be closer.

Coverage is complete: every needed (currency, period year) pair falls in 2014–2026 and all
three currencies are quoted throughout. **There is no residue from a missing rate** — see §5 for
why the unvalued arm still has to exist anyway.

### 2.3 Three currency lists, deliberately kept apart

A currency can be asked three different questions and they have three different answers. Merging
any two is the defect this section exists to prevent:

| list | question | members |
|---|---|---|
| `EUR_RATE` (`src/lib/currency.ts`) | folds into euro at a **fixed** rate? | EUR, BGN + spellings |
| `FX_YEAR_END` (new) | convertible at a **dated** rate? | USD, GBP, CHF + spellings |
| `is_crypto_asset`'s fiat list (090) | is this money **at all**? | ~24 ISO codes + Cyrillic typos |

`ДОЛАРА` is fiat and is *not* fixed-rate. `ЕВРО` is fiat and *is* fixed-rate — and is already in
090's fiat list, so normalising it in `EUR_RATE` makes the two agree rather than diverge.

## 3. Storage: `value_eur` + a basis column

Decision (confirmed with the operator): the converted figure lands **in `value_eur`**, so all
nine existing wealth surfaces pick it up with no edits, and a new `value_basis` column records
how each figure was derived.

```
value_basis  'equiv'   the declarant's own Равностойност cell   (today's 4,347 USD rows)
             'peg'     BGN/EUR at the locked 1.95583
             'fx_ecb'  OUR conversion, ECB reference rate at 31.12 of the period year
             NULL      still unvalued — counted in excluded_asset_rows
```

The rate is never applied on top of a declarant-supplied figure: `equiv` wins, always. We are
filling a blank, not overriding a filing.

`person_wealth_year` gains `imputed_asset_rows` (int) and `imputed_eur` (numeric) beside
`excluded_asset_rows`, so any surface can say how much of a total is ours rather than declared.
That is the whole reason the basis column exists — an imputed euro that no page can distinguish
from a declared one is exactly the silent spot rate the design note rules out.

## 4. Changes

**T0 — the rate table (new committed artifact)**
- `scripts/declarations/fetch_fx_rates.ts` → `data/declarations/fx_year_end.json`
  `{ "USD": { "2014": 0.8237, … }, "GBP": …, "CHF": … }`, eurPerUnit, derived from the ECB
  `eurofxref-hist.zip`. **Committed**, so a re-parse in three years reproduces today's numbers
  byte-for-byte; a network fetch at parse time would make the corpus depend on when it was run.
- Operator-run, not in any chain — it only moves when a year closes.

**T1 — parser**
- `src/lib/currency.ts`: add the Cyrillic euro/lev spellings to `EUR_RATE`, and align
  `normCurrency` with 090's `asset_unit_norm` (strip non-alnum) so the two stop being able to
  drift. Fixes the 30 `евро` rows with no imputation at all.
- `scripts/declarations/parse_declaration.ts`: a **post-pass** over the assembled `assets`
  array, placed after `resolveDeclarationYear` and before the return — one site, rather than
  threading the year through `pickEurValue`'s three call sites. Fills `valueEur` + stamps
  `valueBasis`.
- `src/data/dataTypes.ts`: `valueBasis` on `MpAsset`.

**T2 — database**
- `089_declarations.sql`: `value_basis text` (`ADD COLUMN IF NOT EXISTS` — warm databases).
- `scripts/db/load_declarations_pg.ts`: carry the column.
- `090_person_wealth.sql`: `excluded_asset_rows` gains the currency-unresolvable arm
  (**including `debt`** — the existing ceiling arm excludes it, and that filter must not be
  copied); new `imputed_asset_rows` / `imputed_eur`.
- `100`, `120`, `functions/db_table.js`: expose the two new fields.

**T3 — gate** — `scripts/db/tests/declaration_fx_conversion.data.test.ts`:
1. **The invariant the audit asked for**: no money-category row has a non-null `amount` with a
   null `value_eur` unless it is counted in `excluded_asset_rows`.
2. `value_basis` is non-null wherever `value_eur` is, and `'fx_ecb'` never appears on a row the
   declarant valued.
3. **Direction / inversion guard** — an inverted rate is the killer bug here (1/0.9 = 1.11 vs
   0.9) and is invisible to a row count. Each imputed row's implied rate must sit within 25% of
   the declarant-implied median for the same (currency, period year) where that median has
   n ≥ 20.
4. Exhaustiveness, in the `declared_crypto` style: every distinct currency in the corpus is in
   exactly one of the three lists of §2.3 or deliberately residual.
5. Mutation check — recompute with the FX arm disabled and assert the figures move, so an
   assertion satisfied by an implementation that forgot the conversion cannot pass.

**T4 — re-parse + reload.** The XML is cached locally (`raw_data/declarations` 251 MB,
`raw_data/officials` 2.5 GB), so this is offline. Cloud SQL then needs
`db:load:declarations:pg:cloud` (phase 1 — `--resolve` alone does NOT rewrite asset rows), then
the matview refresh, per CLAUDE.md's `is_declared_holding` note.

## 5. Expected diffs, stated rather than discovered

- **The unvalued arm survives even at 100% rate coverage.** A future filing in a currency the
  ECB does not quote, or a period year past the committed table, must degrade to
  `value_basis = NULL` + counted — not to a guessed rate. The residue path is the design, not a
  gap in it.
- **Some person-years will change which filing represents them.** 090's `has_valued_assets`
  ranking tier asks "has assets we can actually total"; a filing whose only valued row was a USD
  row now qualifies. Correct, and it will move rows.
- **`delta_pct` will re-appear** on person-years that currently suppress it, and disappear on
  others — 100 and 120 both guard it on `excluded_asset_rows = 0` at BOTH ends, and that count
  is changing in both directions (down where we now convert, up where we now count).
- The €100M `asset_row_ceiling_eur()` is not in play: the largest imputed row is ~€3.9M.

## 6. Deliberately NOT done

- **No spot or transaction-date rate.** The form records no acquisition date for a bank balance,
  so anything finer than the period year would be invented precision.
- **No back-fixing of declarant-supplied equivalents.** Where the declarant filled the cell we
  keep their number even when it implies an absurd rate (the corpus contains 10× and 0.1×
  errors). `pickEurValue`'s existing separator-typo guard is the only override, and it stays as
  is — this plan adds no new authority over a filed figure.
- **No conversion for `security` rows**, where `amount` is a count of shares rather than money.
  None carries a foreign currency today; the FX table is keyed on currency, so crypto units and
  share counts are excluded by construction rather than by a category list that could go stale.
