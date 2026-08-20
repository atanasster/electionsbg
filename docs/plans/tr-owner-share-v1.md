# Ownership percentages on `/company/:eik` — v1

**Status:** in progress · **Opened:** 2026-08-20

## The report

`/company/104119056` (БИЛЯНА ООД) published **26%** and **8%** for its two
partners. The Commerce Registry says **75.5%** and **24.5%**.

## Diagnosis

The page shows the right ROW with the wrong DENOMINATOR. `share_percent` is
derived in `scripts/declarations/tr/sqlite_writer.ts` as
`share_amount ÷ (sum of every owner record with erased_at IS NULL) × 100`.

`erased_at IS NULL` does not mean "current". The TR daily feed re-lists the
whole partner set on every capital change and never erases the prior vintage —
`008_connections.sql` has always known this, which is why `company_officers()`
collapses the rows with a `DISTINCT ON`. The dedup fixes **who** is shown; the
percentage was already computed against the un-deduped set.

For this company the denominator was four rows across two cap tables:

| filing               | amount       |
| -------------------- | ------------ |
| ЛЕФТЕРОВ 2022-03-28  | 12 564 (лв)  |
| ЛЕФТЕРОВА 2022-03-28 | 4 068 (лв)   |
| ЛЕФТЕРОВ 2026-07-03  | 6 428.58 EUR |
| ЛЕФТЕРОВА 2026-07-03 | 2 081.46 EUR |

= 25 142.04, so 6 428.58 / 25 142.04 = 25.57% → "26%". All four stored rows
sum to 100.00%, which is why nothing ever looked internally inconsistent.

Two independent defects compound:

1. **Superseded filings in the denominator.**
2. **лв and EUR added as bare numbers.** A euro re-denomination is filed as a
   new vintage, so this arrived with the currency changeover and **grows** with
   every conversion.

### Scale (measured 2026-08-20, local corpus)

Of 352,964 companies displaying a percentage:

- **10,400 understate** — displayed shares sum to a mean of **50.4%**
- **777 overstate** — mean **200.8%**, all carrying an active `sole_owner`
  alongside active partners (a superseded ЕООД vintage)
- **6,953** of the understated are the euro pattern; only ~35% of the 19,989
  already-converted companies are hit so far

Blast radius is display-only: three surfaces read the stored `share` —
`company_officers()` and `person_roles()` (008) and the `company_person_roles`
matview (022) — and nothing gates on a threshold, so no link or attribution is
wrong.

## The rule

A company's current cap table is its **latest active owner vintage** — the rows
at `max(added_at)` among non-erased `partner`/`sole_owner` records. Each owner's
share is their amount over that vintage's total, normalised to EUR at 1.95583.

Chosen on evidence. Against the registered capital (`tr_companies.funds_amount`)
on the 11,502 multi-vintage companies that carry one:

| denominator                        | reconciles with registered capital |
| ---------------------------------- | ---------------------------------- |
| all active owner rows (the defect) | 130 (1.1%)                         |
| **latest active owner vintage**    | **7,753 (67.4%)**                  |
| latest row per person              | 6,491 (56.4%)                      |

Two refusals, both the safe direction:

- **Any owner in the current set with no `share_amount` → no percentage for that
  company.** Dropping the row instead would inflate everyone else against a short
  denominator — the same defect in new clothes.
- **`sole_owner` is 100% only when it is the company's only current owner row.**
  4,517 companies carry both; answering 100% there produced the 200.8% totals.

A row outside the vintage keeps its place on the page with a NULL share: a stake
we cannot express as a fraction of the current capital renders "—", never a
number.

**Outcome:** 348,452 of 356,221 companies get a percentage, and every one sums
to 100% **within the residue of `round(…, 4)`** — 345,105 land on exactly 100
and the other 3,347 inside 99.9945 … 100.0019 (±0.0055pp), because three equal
owners are 33.3333 × 3 = 99.9999. The gate asserts the tolerance, never equality.

The **7,769** that get no percentage are all the missing-`share_amount` refusal
(7,329 with several current owners, 440 with a single partner). 3,689 of them
also carry a `sole_owner` beside a partner in the current vintage, but none is
refused for that alone. Note 3,689 ≠ the 4,517 quoted above for the same shape:
that one is measured on the display dedup, this one on the current vintage.

## Steps

- **T1** — `tr_share_eur()` + the `tr_owner_share` view in `003_tr_search.sql`.
- **T2** — serve it: `company_officers()` and `person_roles()` (008), the
  `company_person_roles` matview (022). Join inside each dedup CTE on the full
  `(uic, name_fold, role)` key: the view exposes `name_fold` rather than `name`,
  and 55 `(uic, name_fold)` pairs hold both a `partner` and a `sole_owner` row in
  the current vintage, so a two-column join fans out.
- **T3** — `scripts/db/tests/tr_owner_share.data.test.ts`, with a mutation check.
- **T4** — the writer's stored `share_percent` (TS twin of the same rule).
- **T5** — CLAUDE.md + publish/ordering notes.

## Performance

`tr_owner_share` is a plain VIEW, not a matview: every window partitions by
`uic` and the CTE is referenced once, so a `WHERE uic = …` pushes below both and
rides `idx_tr_person_roles_uic`. On the corpus's largest company (204332614,
1,117 role rows) that is **28 buffers / 2.4 ms**. The first draft found the
vintage by self-joining a second reference of the same CTE, which materialises
it: **26,208 buffers / 252 ms**. Re-EXPLAIN that company before adding a second
reference.

## Known gap (out of scope)

This changes the percentage, never **who** is displayed. A displayed owner whose
latest row predates the current cap table now shows "—" instead of a wrong
number; whether they are still an owner at all is a separate question about the
dedup, not about this rule.

The population that renders "—" is bounded above by the 7,769 companies that get
no percentage at all — a different and larger set than the vintage-mixing one.
An earlier draft put the vintage-mixing count at ~1,262, derived from the gap
between the latest-vintage and latest-row-per-person reconciliation rates in the
table above (7,753 − 6,491); that is an inference, not a direct measurement, and
it is left unpinned deliberately rather than quoted as a fact.
