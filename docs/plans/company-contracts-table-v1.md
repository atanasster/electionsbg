# Company / Awarder Contracts Table — UX Overhaul (v1)

Redesign the server-side contracts/annexes table that backs `/company/:eik/contracts`,
`/company/:eik/annexes` and `/awarder/:eik/contracts`. One component renders all
three: [`src/screens/dev/CompanyContractsDbScreen.tsx`](../../src/screens/dev/CompanyContractsDbScreen.tsx),
a [`DbDataTable`](../../src/ux/data_table/DbDataTable.tsx) over the `contracts`
resource (`functions/db_table.js` registry → `/api/db/table`).

## Goals

1. Remove the redundant/verbose columns the current table carries.
2. Fix the procurement-procedure vocabulary at the root (untranslated enums,
   over-long names, feed-duplicated options).
3. Add a filter-scoped procedure-mix chart and a reactive KPI strip.
4. Make filtered views shareable (URL-backed) and readable on mobile.

## Decisions (locked with product owner)

- **Date:** do NOT collapse the two date columns. Instead, guarantee `date_signed`
  is **always populated** at ingestion (`contractDate ?? publicationDate`), and
  render that single always-present field in the table. `date` (the "became
  public" date) stays unchanged — so no date-indexed aggregate, matview, or
  scope-window is affected.
- **Bids ("N оферти"):** move the bid count out of the risk-pill cluster into its
  own sortable numeric column (colored when the low-competition flag fires).
  Confirmed.
- **Procedure-mix chart:** must be **filter-scoped** — it reflects the active
  year / CPV / single-bid filters (but not the procedure selection itself, so all
  buckets stay visible).

## Vocabulary spine

`procedureBucket()` + `PROCEDURE_LABEL` + `procedureLabel()` in
[`src/lib/cpvSectors.ts`](../../src/lib/cpvSectors.ts) (7 buckets: open, competition,
collection, direct, framework, other, unknown) become the single procedure
vocabulary for the new column, the filter, and the chart. This is what fixes all
three procedure problems at once — including that `Открита процедура` (АОП feed)
and `open` (ЦАИС ЕОП feed) are the *same* procedure showing as two options today.

---

## Tier 0 — Data: always-populated `date_signed`

**Why:** the table shows one date = the signing date, but `date_signed` is
currently nullable ([normalize_eop.ts:283](../../scripts/procurement/normalize_eop.ts)
sets `dateSigned = parseBgDate(rec.contractDate)`, which can be null). Populate it
in data so the UI never needs a fallback and downstream queries can rely on it.

- **0.1 — Ingestion fallback (all feeds).** Ensure `dateSigned` is always set:
  - `normalize_eop.ts` (~line 283): `dateSigned = parseBgDate(rec.contractDate) ?? parseBgDate(rec.publicationDate) ?? day`.
  - `legacy_csv.ts` (~line 496): `dateSigned: contractDate || publishedDate || \`${yearOnly}-12-31\``.
  - `normalize_rop.ts` (~line 83/318): set `dateSigned = row.contractDate ?? row.publishedDate ?? \`${unpYear}-12-31\``.
  - `normalize.ts` (АОП OCDS, ~line 273): this feed has **no signing date** — set
    `dateSigned = date` (the release date). Documented mixed semantics: for the
    pre-2024 OCDS corpus the "signed" date equals the award/publication date. This
    is inherent to the source and acceptable because `date` is retained separately.
- **0.2 — Backfill existing rows.** New migration
  `scripts/db/schema/pg/NNN_contract_date_signed_backfill.sql`:
  `UPDATE contracts SET date_signed = date WHERE date_signed IS NULL OR date_signed = '';`
  Idempotent; re-runnable. No matview/aggregate rebuild needed (they key off `date`,
  which is unchanged).
- **0.3 — No loader/schema/type changes.** `procurement_schema.ts:31` already maps
  `dateSigned → date_signed`; the column already exists; `ProcurementContract.dateSigned`
  stays. Loader untouched.
- **0.4 — Detail-screen redundancy guard.** After backfill, `date_signed` on old
  AОП rows equals `date`. Keep [ContractDetailScreen.tsx:107](../../src/screens/ContractDetailScreen.tsx)
  showing the separate "Signed" line only when `c.dateSigned !== c.date` (it already
  guards on truthiness; tighten to `!==`).

**Regression test:** extend `scripts/db/tests/procurement_ingestion_regression.data.test.ts`
to assert every `contracts` row has a non-empty `date_signed`.

---

## Tier A — Table UI (the four named fixes)

All in `CompanyContractsDbScreen.tsx`.

- **A1 — Single date column.** Replace the double-stacked date cell
  ([lines 108–124](../../src/screens/dev/CompanyContractsDbScreen.tsx)) with one
  value = `row.original.dateSigned` (guaranteed populated by Tier 0), no subline.
  Header key `company_contract_signed` → "Подписан" / "Signed".
  - **Sort (perf-critical):** `date_signed` is **unindexed** — `date` carries all
    four indexes ([001_procurement.sql:53–86](../../scripts/db/schema/pg/001_procurement.sql)).
    Keep the registry/`defaultSort` sorting on the indexed `date` column
    (id stays `date`, `desc:true`) while the cell renders `dateSigned`. Since the
    two differ by days, order is effectively monotonic; this avoids the
    search+ORDER BY seq-scan trap (see `docs/plans/pg-query-performance.md`).
    Make the column non-user-resortable (`enableSorting:false`) so no one triggers
    an unindexed sort. *(Optional upgrade, not in v1: add
    `idx_contracts_*_date_signed` and flip sort to `date_signed`.)*
- **A2 — Remove the ИЗТОЧНИК column** ([lines 220–247](../../src/screens/dev/CompanyContractsDbScreen.tsx)).
  "Детайли" duplicates the subject link (both → `/procurement/contract/:key`), and
  the external ЕОП/egov link already lives on the detail screen
  ([ContractDetailScreen.tsx:343](../../src/screens/ContractDetailScreen.tsx)).
  Delete the column and the now-unused `resolveContractSource` / `ExternalLink`
  imports.
- **A3 — New "Процедура" column** in the freed space. Chip rendering
  `procedureLabel(procedureBucket(row.procurementMethod), lang)` — short,
  translated, deduplicated. `enableSorting:false` (bucket ≠ raw-string order).
  Give freed width back to ПРЕДМЕТ (raise its `max-w-md` clamp).
- **A4 — Bucketed procedure filter.** Replace the raw-value dropdown
  ([lines 318–334](../../src/screens/dev/CompanyContractsDbScreen.tsx)): feed the
  facet rows through a new `groupMethodFacet()` helper (G1) → one `SelectItem` per
  bucket with `procedureLabel` + summed count. On select, push
  `{ id: "procurement_method", value: bucket.methods }` (the registry
  `procurement_method` filter is `"in"` → accepts the array of raw methods in the
  bucket). State becomes the bucket key.
- **A5 — Procedure-mix chart (filter-scoped, clickable).** New component
  `src/screens/components/procurement/ProcedureMixBar.tsx`: a 100%-stacked
  horizontal segmented bar (pure flex/divs — matches the "infographic bars, no
  sparklines" convention; no Recharts), palette from
  [`procurementPalette.ts`](../../src/screens/components/procurement/procurementPalette.ts).
  Each segment is a `<button>` that sets the same bucket filter as A4 (chart *is* a
  filter); the active bucket is highlighted. Placed in a card above the filter row
  (layout modeled on [ConsumptionCategoryScreen.tsx](../../src/screens/consumption/ConsumptionCategoryScreen.tsx)).
  Fed by the **filter-scoped** procedure facet (see Backend §F1). Co-located
  `ProcedureMixBar.test.tsx`.

---

## Tier B — Polish

- **B1 — Reactive KPI strip + inverted header.** Above the table, a `StatCard`
  row: **Total €** and **# contracts**, sourced from the table's own aggregates
  (`aggregates.sumAmountEur`, `aggregates.count`) captured via the existing
  `onData` callback ([handleData, line 62](../../src/screens/dev/CompanyContractsDbScreen.tsx)) —
  so they react to active filters (`DbDataTable` computes Σ/count over the whole
  filtered set, not just the page). Make the **entity** the H1 and demote
  "Договори" to a kicker (today the serif title dominates and the entity is tiny).
  Fold **single-bid %** and **direct-award %** into the ProcedureMixBar card
  (both derivable from the filter-scoped facets: single-bid from a
  `number_of_tenderers` facet, direct from the `direct` bucket share).
- **B2 — URL-backed filters.** Lift `year` / `proc` / `cpv` / `singleBidder` from
  `useState` to `useSearchParams` (params `year`, `proc`, `cpv`, `single`;
  precedent: [ProcurementSectorsScreen.tsx](../../src/screens/ProcurementSectorsScreen.tsx),
  [SubsidiesDashboardScreen.tsx](../../src/screens/SubsidiesDashboardScreen.tsx)).
  No collision with the global `?elections` / `?pscope` (this page reads neither
  for the table). Seed the search box from `?q` via the already-supported
  `initialSearch` prop (currently unused here). Add a **"Изчисти филтрите"** reset.
  *(Two-way sync of the free-text box into the URL is out of scope — `DbDataTable`
  owns that state internally with no change callback; `?q` seeding is the
  established pattern.)*
- **B3 — Sortable "Оферти" column.** Add a numeric `number_of_tenderers` column
  (already `sort:true, filter:"range"` in the registry — no backend change).
  Render the count, colored rose when the row's low-competition flag fires (reuse
  `scoreRow`). СИГНАЛИ then sheds the bid pill and is reserved for
  debarred / upheld-appeal / MP-linked / no-call flags.
- **B4 — Mobile readability.** `DbDataTable` is a shared component that renders a
  fixed `<Table>`; a full card layout would require extending it. For v1, use
  **responsive column hiding** via per-column `className` (Tailwind `hidden sm:table-cell`)
  to drop Процедура / Оферти / Сигнали below `sm`, keeping Подписан / Възложител /
  Предмет / Стойност. *(Follow-up option: add a `renderMobileRow` prop to
  `DbDataTable` for a true stacked-card layout — flagged, not in v1.)*

---

## Backend / shared

- **G1 — `groupMethodFacet()`** in `cpvSectors.ts`: collapse
  `{value, count}[]` facet rows into
  `{ bucket, label, count, methods: string[] }[]` (merges АОП + ЕОП variants, sums
  counts, keeps raw method strings for the `"in"` filter). Pure; unit-tested in
  `cpvSectors.test.ts`.
- **F1 — Filter-scoped facets.** `runDbFacets` currently applies only
  `scope` + `fixedFilters` ([db_table.js ~1136](../../functions/db_table.js)).
  Extend it to merge an optional `req.filters` (extra column filters) into
  `buildWhere`. The screen then issues facets that **exclude their own dimension**:
  - procedure facet ← apply `{year, cpv, single-bid}` (exclude `proc`);
  - CPV facet ← apply `{year, proc, single-bid}` (exclude `cpv`).
  This needs **per-column facet requests** (two React-Query calls with distinct
  filter subsets) instead of today's single two-column call. Existing callers that
  omit `req.filters` are unchanged (backward compatible). Perf: GROUP BY on
  entity-scoped rows is cheap and cached by React Query.
- **Registry:** no schema change. `procurement_method` (`in`),
  `number_of_tenderers` (`range`, facetable), and the `count` / `sum(amount_eur)`
  aggregates already exist.

## i18n (bg + en)

New keys in `src/locales/{bg,en}/translation.json`:
`company_contract_signed`, `company_contract_procedure`,
`company_contracts_all_procedures`, `company_contracts_bids`,
`contracts_procedure_mix`, `contracts_kpi_total`, `contracts_kpi_contracts`,
`contracts_stat_single_bid`, `contracts_stat_direct`, `contracts_clear_filters`.
The 7 bucket labels already carry bg/en in `PROCEDURE_LABEL`, so procedure names
never hit a missing key again. Unused legacy keys
(`company_contract_source`, `company_contract_details`) can stay (harmless).

## Testing

- `cpvSectors.test.ts`: `groupMethodFacet` (merges enum+BG variants, sums,
  preserves `methods`).
- `ProcedureMixBar.test.tsx`: segment %, empty state, click → bucket callback.
- `procurement_ingestion_regression.data.test.ts`: every contract row has a
  non-empty `date_signed` (Tier 0).
- Browser-preview smoke on `/company/103267194/contracts`: no untranslated
  procedure strings; source column gone; procedure chips render; bar click filters
  and updates the URL; KPI reacts to filters; single date column.
- `npm run test:unit`; then `npx tsc -b` (root `tsc --noEmit` checks nothing —
  references stub).

## Deployment / sequencing

Local: `npm run db:refresh` picks up 0.1 + 0.2 automatically.
Cloud: run the 0.2 backfill migration (`db:*:cloud`) — a plain `UPDATE` (row
locks, not `AccessExclusive`; no TRUNCATE, no staging swap needed). No matview or
rollup rebuild (they key off the unchanged `date`). Frontend ships via
`npm run deploy` (hosting only); the `runDbFacets` change (F1) rides the `db`
Cloud Function → `npm run deploy:db` before hosting.

## Gap-audit notes / risks

1. **Sort vs display date** (A1): displaying `date_signed` while sorting the
   indexed `date` is a deliberate perf trade-off; ordering is monotonic in
   practice. Only edge cases where signing/publication cross-order look slightly
   off. Optional index upgrade documented.
2. **Mixed "signed" semantics** (0.1): pre-2024 АОП OCDS rows have no true signing
   date, so `date_signed = date` there. Acceptable because `date` is retained; the
   detail screen's "Signed" line self-suppresses when equal (0.4).
3. **Exclude-own-dimension facets** (F1): the two-call split is required for the
   chart/filter counts to be correct under active filters — a single combined call
   cannot apply different where-clauses per column.
4. **Type boundary:** only `ProcurementContract.dateSigned` and its consumers are
   in scope. The tender-lineage / `useTender` `dateSigned` fields
   ([useTenderLineage.tsx:27](../../src/data/procurement/useTenderLineage.tsx),
   [useTender.tsx:19](../../src/data/procurement/useTender.tsx)) are a different
   domain — untouched.
5. **`DbDataTable` is shared:** B4 uses column hiding rather than modifying the
   shared component; a `renderMobileRow` extension is a flagged follow-up.

## Out of scope (v1)

- True stacked-card mobile layout (needs a `DbDataTable` prop).
- Two-way URL sync of the free-text search box.
- CSV export.
- `date_signed` index + true sort-by-signed.

## Commit plan

Straight to `main`, no branch, no Co-Authored-By trailer (per workflow).

- Commit 1 — Tier 0: ingestion fallback + backfill migration + regression test.
- Commit 2 — Tier A: G1, F1, A1–A5 + i18n + component tests.
- Commit 3 — Tier B: B1–B4.
