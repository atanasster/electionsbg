# Ownership percentages on `/company/:eik` — v1

**Status:** complete (T1-T5) · **Opened:** 2026-08-20

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

The gate measures the rule AS IMPLEMENTED against the defect AS SHIPPED — the
view's own denominator versus a raw sum of every active owner amount:

| denominator                                     | reconciles         |
| ----------------------------------------------- | ------------------ |
| all active owner rows, raw sum (**the defect**) | 130 (1.1%)         |
| **`tr_owner_share.share_eur` (the rule)**       | **10,923 (95.0%)** |

The three-way comparison below isolates the DENOMINATOR choice with the currency
fold applied to all three rows, which is why its baseline is 413 rather than 130 —
the defect did not fold currency, so 130 is the honest figure for it:

| denominator (currency folded throughout) | reconciles         |
| ---------------------------------------- | ------------------ |
| all active owner rows                    | 413 (3.6%)         |
| **latest active owner vintage**          | **10,951 (95.2%)** |
| latest row per person                    | 8,685 (75.5%)      |

Two refusals, both the safe direction:

- **Any owner in the current set with no `share_amount` → no percentage for that
  company.** Dropping the row instead would inflate everyone else against a short
  denominator — the same defect in new clothes.
- **`sole_owner` is 100% only when it is the company's only current owner row.**
  4,517 companies carry both; answering 100% there produced the 200.8% totals.

A row outside the vintage keeps its place on the page with a NULL share: a stake
we cannot express as a fraction of the current capital renders "—", never a
number.

A third refusal joined them once the gate was written: **one person's stake
restated in both лв and EUR inside a single vintage** is a holding carried
across the re-denomination, not two holdings, and summing them publishes a
doubled stake — the same лв+EUR addition this whole change removes, one level
down. 161 groups over 85 companies were publishing on that basis.

A fourth exclusion came out of T4: **„Заличено обстоятелство."** is the
register's deleted-fact placeholder, not a person. 4,356 owner rows carry it and
not one has an amount, so counting it as an owner made a two-owner company out of
a one-owner one — refusing 4,299 companies whose lone sole owner really was the
only owner. Both implementations exclude it.

**Outcome:** 351,981 of 356,209 companies get a percentage, and every one sums
to 100% **within the residue of `round(…, 4)`** — 348,637 land on exactly 100
and the other 3,344 inside ±0.0055pp, because three equal owners are
33.3333 × 3 = 99.9999. The gate asserts the tolerance, never equality.

The **4,228** that get no percentage are each attributable: 4,143 a missing
`share_amount` (3,725 with several current owners, 418 with a single partner)
and 85 the restated-stake refusal.

## Steps

- **T1** ✅ — `tr_share_eur()` + the `tr_owner_share` view in `003_tr_search.sql`.
- **T2** ✅ — serve it: `company_officers()` and `person_roles()` (008), the
  `company_person_roles` matview (022), and `mp_tr_roles()` (150 — a fourth
  consumer the first draft missed). Join inside each dedup CTE on the full
  `(uic, name_fold, role)` key: the view exposes `name_fold` rather than `name`,
  and 55 `(uic, name_fold)` pairs hold both a `partner` and a `sole_owner` row in
  the current vintage, so a two-column join fans out. Also removed the client-side
  `sole_owner && share == null → "100%"` fallback from three call sites, which
  would have re-manufactured the 200.8% totals the server now refuses.
- **T3** ✅ — `scripts/db/tests/tr_owner_share.data.test.ts`, with a mutation check
  that reconciles against registered capital rather than asserting sums-to-100.
- **T4** ✅ — the writer's stored `share_percent` (`owner_share.ts`, the TS twin).
- **T5** ✅ — CLAUDE.md + publish/ordering notes.

## Publishing

`npm run db:load:tr:pg:cloud` applies 003 → 008 → 022 in order and refreshes the
matview, so an ordinary TR publish carries the whole change. For a body-only fix:

```bash
DATABASE_URL=<target> npx tsx scripts/db/apply_functions.ts \
  003_tr_search.sql 008_connections.sql 022_company_officers.sql \
  148_person_company_basis.sql 150_mp_tr_roles.sql
```

then `REFRESH MATERIALIZED VIEW CONCURRENTLY company_person_roles;` — a change to
the VIEW alone leaves the matview serving the previous rule at a 200, and the
concurrent form avoids the 500s that re-applying 022 causes (it DROPs the matview,
which the DbDataTable resource reads with no degrade).

⚠️ **`db:load:tr:pg[:cloud]` does NOT apply 150.** Its only applier is
`db:resolve:persons`, so a TR publish on its own leaves `mp_tr_roles()` on the old
body and `/api/db/mp-management` publishing the defect beside a corrected
`/company/:eik`. 148 precedes 150 because 150's body SELECTs
`person_company_bridge_a`, which only 148 creates.

Then `npm run deploy:db` (the `share_eur` column on the `company_person_roles`
registry resource) and `npm run deploy` (`formatOwnerShare`).

⚠️ **003 must precede 008 and 022 in that command.** 008 does not set
`check_function_bodies = off`, so its two `LANGUAGE sql` bodies are validated at
CREATE and raise 42P01 against a database whose 003 predates the view, rolling the
whole file back; and a matview resolves its query at creation regardless of that
setting, so 022 has no cover either.

⚠️ **The TS twin is INERT until the SQLite corpus is rebuilt** — `npm run
tr:daily-refresh` then `db:load:tr:pg`. Until then `/mp-company/:eik` keeps
rendering the old percentages, and the twin-agreement gate skips with a distinct
reason rather than passing.

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

The population that renders "—" is bounded above by the 4,228 companies that get
no percentage at all — a different and larger set than the vintage-mixing one.
An earlier draft put the vintage-mixing count at ~1,262, derived from the gap
between the latest-vintage and latest-row-per-person reconciliation rates in the
table above; that is an inference, not a direct measurement, and it is left
unpinned deliberately rather than quoted as a fact.
