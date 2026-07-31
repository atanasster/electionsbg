# Person procurement browser — v1

Bring the `/company/:eik` and `/procurement/settlement/:ekatte` procurement experience to the
person page: a shared filter bar + KPI strip on the in-page portfolio, two new breakdown tiles
(**by company** / **by settlement**), and a standalone **"all contracts"** browser reached from
_Топ договори_. Everything is factored into shared components so **both** person screens use it.

Status: PLAN ONLY — nothing coded yet.

---

## 1. Current state (measured)

There are **two** person screens; the procurement portfolio lives on the legacy one.

| Screen | Route | Keyed by | Portfolio? | Data source |
|---|---|---|---|---|
| `PersonProfileScreen` → `PersonDashboard` | `/person/:name` (+ `/candidate/:id`) | resolved `slug` | No rich portfolio (only a `procuredEur` KPI + `PersonMoneyTimeline`) | `person_by_slug` (`082_person_api.sql`) via `/api/db/person-profile` |
| `PersonScreen` (legacy, `src/screens/dev/PersonScreen.tsx`) | `/person/:name` **fallback** when the slug misses | folded **name** | **Yes** — the "Обществени поръчки (портфейл)" section in the screenshot | `person_procurement(name,from,to)` (`024_person_api.sql`) via `/api/db/person` |

`PersonProfileScreen` renders `<PersonDashboard>` for a resolved public figure and falls back to
`<PersonScreen>` (legacy) on a `null` profile — which is what the screenshot person
(`ЯВОР ЧАВДАРОВ СТЕФАНОВ`, a TR-only "ЛИЦЕ (ТЪРГОВСКИ РЕГИСТЪР)") hits.

**The reconciliation key.** `person_procurement` aggregates over
`SELECT DISTINCT uic FROM tr_officers WHERE name_fold = translit_bg_latin(p_name)`
then `JOIN contracts ct ON ct.contractor_eik = uic` (`024_person_api.sql:33-41`). Any new
contracts browser or breakdown for the legacy screen **must** derive its EIK set the identical
way, or the rows will disagree with the KPIs above them (the exact hazard documented in
`ProcurementSettlementContractsSection.tsx`). The new slug screen resolves firms differently —
`person_role.ref WHERE source='tr' AND confidence IN ('exact_id','high','manual')`
(`082_person_api.sql:91-97`) — so its browser/breakdowns must key off **that** set.

### Data-load measurement — current portfolio (`/api/db/person`)

`ЯВОР ЧАВДАРОВ СТЕФАНОВ` (87 contracts, 8 firms), local dev:

```
HTTP 200 · 45.4 KB wire (37.2 KB JSON) · 30 ms total
  procurement {}  30.4 KB   ← dominates
    .topContracts[25]  23.2 KB   ← 76% of the rollup
    .byAwarder[50]      6.1 KB
    .byYear[5]          0.4 KB
  cabinets[18] 2.9 KB · associates[15] 1.9 KB · roles[9] 1.9 KB
```

The rollup is **already bounded** (top 25 contracts, top 50 awarders) — it does not grow with
portfolio size, so the in-page portfolio stays cheap. The unbounded surface is the *new*
standalone browser, which is why it must be **server-side paginated** (never a full dump).

### Data-load measurement — planned standalone browser (semi-join, worst case)

`EXPLAIN ANALYZE` of the exact queries the browser would issue, over the person's firm set:

- **Worst case is a data artifact, not a person.** The densest `name_fold` is
  `"zalicheno obstoyatelstvo."` = _заличено обстоятелство_ (a TR **redaction sentinel**),
  covering **1,966 firms / 12,967 contracts**. Real people top out at ~15 firms
  (`kamen simeonov peshov` etc.).
- Page-1 (`contracts_list … contractor_eik IN (set) ORDER BY date DESC LIMIT 25`):
  **170 ms** for the 1,966-firm sentinel; **sub-20 ms** for a real ~15-firm person.
- Count + Σ€ (KPI strip): **25 ms** for the sentinel (index-only scan
  `idx_contracts_contractor_tag_amt`).
- **No new index required** — `idx_tr_officers_fold_eq`, `idx_contracts_contractor_tag_amt`,
  `idx_contracts_order` already cover it.

Two consequences for the design:
1. The sentinel (and other mega-nominee folds) **must be excluded** from any person scope, or a
   "person" page for a redaction placeholder shows 12,967 contracts across 777 unrelated firms.
   `person_associates` already excludes mega-hubs (`officer_name_counts`, `008`); reuse that guard.
2. The sentinel's 1,966 firms **exceed `MAX_IN_VALUES = 1000`** (`db_table.js:1247`). Passing the
   EIK set as a client-side `contractor_eik IN (...)` array would silently truncate. → use a
   **server-resolved semi-join** instead (§3.1).

---

## 2. Goals

1. **Standalone contracts page** for a person — same filters, KPI strip and columns as
   `/company/:eik/contracts` and `/procurement/settlement/:ekatte`. _Топ договори_ "see all" → here.
2. **In-page portfolio upgrade** — add the shared filter bar (`?proc/?cpv/?grade/?single`) + the
   `ContractsAnalysisStrip` KPI strip to the portfolio section.
3. **Two breakdown tiles** on the person page:
   - **by company** — the person's own firms ranked by procurement € / contract count;
   - **by settlement** — the awarder settlements paying the person's firms, ranked (via
     `awarder_seats.ekatte`).
4. **DRY** — extract the ~90%-duplicated browser body (settlement/company/global) into one shared
   component; wire it into **both** person screens.
5. Keep the in-page KPIs and the standalone browser on **one scope** so they cannot drift.

---

## 3. Backend changes

### 3.1 New semi-join columns on the `contracts` resource (`functions/db_table.js`)

Mirror the existing `awarder_ekatte` virtual column (`db_table.js:94-103`). Two variants, one per
person screen, so each browser's rows match its screen's KPI source exactly:

```js
// Legacy name-keyed page — matches person_procurement (024).
contractor_of_person_name: {
  type: "text", filter: "semijoin", required: true,
  semiJoinCol: "contractor_eik",
  semiJoinSql: "SELECT DISTINCT uic FROM tr_officers WHERE name_fold = translit_bg_latin(?)",
},
// New slug page — matches person_by_slug / person_money (082).
contractor_of_person_slug: {
  type: "text", filter: "semijoin", required: true,
  semiJoinCol: "contractor_eik",
  semiJoinSql:
    "SELECT r.ref FROM person_role r JOIN person p ON p.person_id = r.person_id " +
    "WHERE p.slug = ? AND r.source = 'tr' AND r.confidence IN ('exact_id','high','manual')",
},
```

Why semi-join, not a client EIK array (both were viable — this is the deciding call):
- **Reconciliation** — the browser derives the EIK set from the *same* SQL as the KPI rollup;
  they cannot disagree.
- **No `MAX_IN_VALUES` cap** — the 1,966-firm sentinel and any real hub pass through.
- **Clean URL** — no giant `contractor_eik=…` array in the shareable link.
- **`required: true`** — an absent value throws (fails closed) instead of widening to the whole
  corpus, exactly like `awarder_ekatte`.

`translit_bg_latin` is already an installed function (used by `person_procurement`); the semi-join
folds the name server-side, so the client passes the raw display name.

### 3.2 Redaction-sentinel / mega-hub guard

Add a `WHERE name_fold NOT IN (<sentinels>)` (or `AND NOT EXISTS` against `officer_name_counts`
above a threshold) to `contractor_of_person_name`'s semi-join and to the breakdown function, so a
redaction placeholder never resolves to a 777-firm "portfolio". Confirm the exact sentinel list
with the existing `person_associates` mega-hub exclusion (`024_person_api.sql:251-281`) and reuse it.

### 3.3 Breakdown aggregates — `byCompany` + `bySettlement`

Extend `person_procurement` (024) to emit two more arrays (kept bounded, e.g. LIMIT 25/12), OR add
a sibling `person_procurement_breakdowns(name, from, to)` if we want to keep the hot portfolio
payload lean:

- **`byCompany[]`** — `GROUP BY contractor_eik` over the same `base` CTE:
  `{ eik, name, totalEur, contractCount, awarderCount }`, ordered by `totalEur DESC`.
  (The `Участия` tables already show a per-firm value bar, but that is ownership-vs-management
  framing; this is a clean procurement ranking.)
- **`bySettlement[]`** — join `base.awarder_eik → awarder_seats (source='geo', is_local_hq) →
  ekatte, settlement`, `GROUP BY ekatte`:
  `{ ekatte, settlement, totalEur, contractCount, awarderCount }`, ordered by `totalEur DESC`.
  National buyers (`is_local_hq = false`) roll into a "национални" bucket, mirroring
  `procurement_by_settlement` (030).

For the **slug** screen, add the same two arrays to a slug-keyed path (extend `person_money` /
`person_by_slug`, or a `person_procurement_breakdowns_slug(slug)` reading `person_role.ref`).

### 3.4 Route wiring

No new route needed for the browser — it flows through the generic `/api/db/table` + `/api/db/facets`
using the new semi-join column. The breakdown arrays ride the existing `/api/db/person`
(and, for the slug screen, `/api/db/person-profile` or a new `/api/db/person-breakdowns`).

---

## 4. Frontend changes

### 4.1 Extract the shared contracts-browser section (the core DRY win)

`ProcurementSettlementContractsSection.tsx`, `ContractsBrowserDbScreen.tsx` and
`CompanyContractsDbScreen.tsx` are ~90% identical: `ContractsAnalysisStrip` +
`useUrlProcurementFilters` + `useContractsAnalytics` + `DbDataTable resource="contracts"` +
`useContractColumns` + `ContractsAggregatesFooter`, differing only in the **scope filter**, the
**column set**, and a few flags.

Create **`src/screens/components/procurement/ContractsBrowserSection.tsx`**:

```ts
type ContractsBrowserSectionProps = {
  scope: DbColumnFilter;              // {id:"contractor_of_person_name", value:name} | awarder_ekatte | …
  window?: [string|null, string|null];// scopeRange(scope, selected) — INCLUSIVE bounds
  columns: ContractColumnId[];        // which of the 10 shared columns to show
  filters?: { withYear?; withRisk?; toggleParam? };
  reactiveCpv?: boolean;
  countLabel?: string;
  // …passes through initialSearch, titleClamp, sortableNames, showAppealChip
};
```

It owns the strip + toolbar (`CpvFilterCombobox`, `ProcedureBucketSelect`, `RiskGradeFilter`,
`SingleBidderToggle`, clear button) + `DbDataTable` + footer — i.e. exactly the body of
`ProcurementSettlementContractsSection`. Then:
- `ProcurementSettlementContractsSection` becomes a thin wrapper passing the `awarder_ekatte` scope.
- The person browser passes the `contractor_of_person_*` scope.
- (Optional follow-up) `CompanyContractsDbScreen` / `ContractsBrowserDbScreen` re-expressed on top of
  it — out of scope for v1 but the extraction makes it a one-liner later.

This is the "extract shared code, DRY" deliverable.

### 4.2 Standalone page `/person/:name/contracts`

New screen **`src/screens/person/PersonContractsScreen.tsx`** — the shell (SEO, breadcrumb back to
`/person/:name`, `ScopeControl`, title) wrapping `<ContractsBrowserSection>` with the person scope.
Columns: `date, awarder_name, contractor_name, title, amount_eur, procedure, number_of_tenderers,
consortium_full_eur, risk_cri` (both parties shown — like the settlement browser, since the person
spans many buyers and firms). `titleClamp="sm"`, `showAppealChip`, `sortableNames` (a person's row
set is small).

Register in `src/routes.tsx` under the person route group, `path="person/:name/contracts"` — same
shape as `/company/:eik/contracts`.

### 4.3 Two breakdown tiles

New **`src/screens/components/procurement/PersonByCompanyTile.tsx`** and
**`PersonBySettlementTile.tsx`** (or reuse/generalize `CompanyTopAwardersTile`'s bar-row layout —
it already renders a ranked `{name, totalEur, share}` list with bars and a `seeAllHref`). Feed them
`byCompany` / `bySettlement`. The settlement tile's rows link to `/procurement/settlement/:ekatte`
(via `SettlementProcurementLink`); the company tile's rows link to `/company/:eik`. Each tile's
"see all" points at the standalone browser pre-filtered where sensible.

### 4.4 In-page portfolio upgrade + scope unification

In the portfolio section (legacy `PersonScreen` first, then `PersonDashboard`):
- Replace the bespoke **Период** `<Select>` (`PERIOD_ALL/PERIOD_LAST4/year`, `PersonScreen.tsx:125-136,
  467-485`) with the shared **`ScopeControl` + `useScope`** (`?pscope`) so the portfolio KPIs, the
  breakdown tiles and the standalone browser all read **one** scope value — the drift guarantee the
  settlement page documents. (Note the scope vocabularies differ: `pscope` has `all` / `y:<year>` /
  `ns:<election>`, not "last 4 years"; confirm we're OK dropping "last 4 г." or add it as a scope.)
- Add `<ContractsAnalysisStrip>` above _Топ договори_ (single-bid % / direct % / procedure mix),
  fed by `useContractsAnalytics({ resource:"contracts", fixedFilters:[scope, window] })`.
- Add the shared filter bar so the portfolio itself is filterable, matching company/settlement.

### 4.5 Wire "Топ договори" → standalone page

`CompanyTopContractsTile` already accepts `seeAllHref` (`CompanyTopContractsTile.tsx:29`). The
person screen currently passes `seeAllHref={null}` (`PersonScreen.tsx:548`). Change to
`` seeAllHref={`/person/${encodeURIComponent(name)}/contracts`} `` (carry `?pscope`).

### 4.6 Both screens

Because the browser section, tiles and (post-refactor) portfolio are shared components taking a
`scope` prop, wiring them into `PersonDashboard` (slug) is: pass `contractor_of_person_slug` +
the slug breakdown arrays. Sequence: land on the legacy screen (where the portfolio exists), then
mount the same components on `PersonDashboard` with the slug scope.

---

## 5. Suggested sequencing

- **Tier 1 — backend seam.** Add the two semi-join columns + sentinel guard; add `byCompany` /
  `bySettlement` to `person_procurement`. PG data tests (§6). No UI yet.
- **Tier 2 — DRY extraction.** Extract `ContractsBrowserSection`; re-express
  `ProcurementSettlementContractsSection` on it (proves the extraction is faithful — its existing
  tests must still pass).
- **Tier 3 — standalone page.** `PersonContractsScreen` + route + `seeAllHref` wiring.
- **Tier 4 — in-page upgrade.** Scope unification + `ContractsAnalysisStrip` + filter bar +
  the two breakdown tiles, on the legacy `PersonScreen`.
- **Tier 5 — slug screen.** Slug semi-join + slug breakdowns; mount the shared components on
  `PersonDashboard`.

---

## 6. Testing

- **PG data test** (`scripts/db/tests/*.data.test.ts`, auto-skips when PG is down): for a known
  person, assert the `contractor_of_person_name` semi-join row set == `person_procurement`'s
  `contractCount` / `totalEur` (reconciliation), and that the redaction sentinel resolves to **zero**
  rows. Assert `byCompany`/`bySettlement` sums == the portfolio total.
- **Component tests** for the two tiles (empty state self-hides) and `ContractsBrowserSection`
  (renders strip + table, applies scope).
- Keep `ProcurementSettlementContractsSection.test.tsx` green after the extraction.

## 7. Deploy / ops

- `db_table.js` (semi-join columns) + `024_person_api.sql` (breakdowns) ship with `deploy:db` +
  the migration to Cloud SQL. `024` is `CREATE OR REPLACE FUNCTION` → re-run
  `apply_functions.ts 024_person_api.sql` (or the person-resolve path that applies it) on the target
  DB **before** `deploy:db` ships the route reading the new arrays. No new matview, no new loader.
- Semi-join reads `awarder_seats` (already current on prod for `awarder_ekatte`) and `tr_officers`
  / `person_role` (already loaded).

## 8. Open decisions / risks

- **Scope vocabulary.** Moving the portfolio from the free "Период" (any year / last-4) to shared
  `?pscope` drops "last 4 years" and swaps arbitrary-year for `y:<year>`. Confirm acceptable, or add
  a scope option. The upside is one scope across KPIs + tiles + browser (no drift).
- **Namesake caveat.** The legacy name-keyed portfolio already collapses namesakes (`tr_officers`
  has no person id). The standalone browser inherits this — keep the existing disclosure banner.
- **`byCompany` vs `Участия`.** The Участия owns/manages tables already show per-firm value; make
  sure the new by-company tile reads as a procurement ranking, not a duplicate of Участия (different
  framing, ordered by € won).
- **Two semi-join columns** is mild duplication; acceptable because each guarantees reconciliation
  with a different KPI source. A single column can't take both a name and a slug (one placeholder).
</content>
</invoke>
