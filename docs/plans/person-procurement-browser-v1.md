# Person procurement browser — v1

Bring the `/company/:eik` and `/procurement/settlement/:ekatte` procurement experience to the
person page: a shared filter bar + KPI strip on the standalone contracts browser, two new
breakdown tiles (**by company** / **by settlement**), and a standalone **"all contracts"** browser
reached from _Топ договори_. Everything is factored into shared components so **both** person
screens use it.

Status: PLAN ONLY — nothing coded yet. Rev 2 folds in the design audit (§9 records what the audit
confirmed; the fixes are inline in §2–§8, tagged **[audit]**).

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

> **[audit] Count basis is part of the reconciliation key, not just the EIK set.**
> `person_procurement.contractCount` **excludes** €0 consortium-`member` rows
> (`consortium_role IS DISTINCT FROM 'member'`, `024:47-48`). A plain `tag='contract'` scope
> **includes** them, so the browser footer and the breakdown sums would legitimately exceed the KPI.
> **Decision: the browser and both breakdowns adopt the KPI's basis** — every person-scoped
> contracts query carries `consortium_role IS DISTINCT FROM 'member'` in addition to
> `tag='contract'`. See §3.1 (the semi-join is not enough on its own — this predicate rides
> `fixedFilters`).

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
- **[audit] The two breakdown aggregates were NOT measured.** `byCompany` (a `GROUP BY
  contractor_eik` over the same `base`) and `bySettlement` (a join to `awarder_seats`, PK on
  `eik`) are both small-set aggregates over the already-cheap `base`; expected trivial, but this
  is an estimate, not a measurement — measure before shipping Tier 1.

Two consequences for the design:
1. The sentinel (and other mega-nominee folds) **must be excluded** from any person scope, or a
   "person" page for a redaction placeholder shows 12,967 contracts across 777 unrelated firms.
   `person_associates` already excludes mega-hubs (`officer_name_counts`, `008`); reuse that guard.
2. The sentinel's 1,966 firms **exceed `MAX_IN_VALUES = 1000`** (`db_table.js:1247`). Passing the
   EIK set as a client-side `contractor_eik IN (...)` array would silently truncate. → use a
   **server-resolved semi-join** instead (§3.1). (Confirmed: the semi-join subquery is not subject
   to `MAX_IN_VALUES` — that cap only applies to `filter:"in"` value arrays, `db_table.js:1299`.)

---

## 2. Goals

1. **Standalone contracts page** for a person — same filters, KPI strip and columns as
   `/company/:eik/contracts` and `/procurement/settlement/:ekatte`. _Топ договори_ "see all" → here.
   **This is the only surface that carries the per-column filter bar** (`?proc/?cpv/?grade/?single`).
2. **In-page portfolio upgrade** — add the `ContractsAnalysisStrip` KPI strip (single-bid % /
   direct % / procedure mix, facet-driven) above _Топ договори_.
   **[audit] NO per-column filter bar on the in-page portfolio.** `person_procurement` takes only a
   date window (`name, from, to`) — it cannot honor `?proc/?cpv/?grade/?single`, and the
   `/company/:eik` dashboard sets the precedent by having none either (scope pill only). Per-column
   filtering is a property of the standalone browser, not the rollup.
3. **Two breakdown tiles** on the person page:
   - **by company** — the person's own firms ranked by procurement € / contract count;
   - **by settlement** — the awarder settlements paying the person's firms, ranked (via
     `awarder_seats.ekatte`).
4. **DRY** — extract the ~90%-duplicated browser body (settlement/company/global) into one shared
   component; wire it into **both** person screens.
5. Keep the in-page KPIs, the breakdown tiles and the standalone browser on **one scope** so they
   cannot drift — **[audit] defaulting to `all` (whole portfolio), not the parliament window**
   (see §4.4).

---

## 3. Backend changes

**[audit] All new SQL goes in a NEW migration file — do not edit the applied `024`/`082`.** Add
`scripts/db/schema/pg/125_person_procurement_breakdowns.sql` with `CREATE OR REPLACE FUNCTION`
bodies (the person functions carry no data, so they are *applied*, never *loaded* — CLAUDE.md
"Person SQL functions — applied, never loaded"). Deploy = `apply_functions.ts
125_person_procurement_breakdowns.sql` against the target DB **before** `deploy:db` ships the route
reading the new arrays. `db_table.js` (the semi-join columns) ships with `deploy:db`.

### 3.1 New semi-join columns on the `contracts` resource (`functions/db_table.js`)

Mirror the existing `awarder_ekatte` virtual column (`db_table.js:94-103`). Two variants, one per
person screen, so each browser's rows match its screen's KPI source exactly:

```js
// Legacy name-keyed page — matches person_procurement (024).
contractor_of_person_name: {
  type: "text", filter: "semijoin", required: true,
  semiJoinCol: "contractor_eik",
  // Excludes the redaction sentinel / mega-nominee folds — reuse the person_associates guard.
  semiJoinSql:
    "SELECT DISTINCT uic FROM tr_officers WHERE name_fold = translit_bg_latin(?) " +
    "AND name_fold <> 'zalicheno obstoyatelstvo.'",  // + any officer_name_counts mega-hub guard
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

**[audit] Template validity confirmed against `buildFilter` (`db_table.js:1352-1356`):** the engine
splits `semiJoinSql` on `?` and requires exactly two parts (one placeholder). Both strings above
carry exactly one `?` — the literal `IN ('exact_id',…)` in the slug variant contains none. Valid.

Why semi-join, not a client EIK array (both were viable — this is the deciding call):
- **Reconciliation** — the browser derives the EIK set from the *same* SQL as the KPI rollup.
- **No `MAX_IN_VALUES` cap** — the 1,966-firm sentinel and any real hub pass through.
- **Clean URL** — no giant `contractor_eik=…` array in the shareable link.
- **`required: true`** — an absent value throws (fails closed) instead of widening to the whole
  corpus, exactly like `awarder_ekatte`.

**The semi-join scopes the EIK set; it does NOT set the count basis.** The browser and both
breakdowns additionally pass `tag='contract'` **and** the member-row exclusion as `fixedFilters`
(see the §1 audit note):

```js
fixedFilters: [
  { id: "tag", value: ["contract"] },
  { id: "consortium_role", value: /* NOT 'member' */ … },  // exclude €0 consortium members
  scope,  // {id:"contractor_of_person_name"|"…_slug", value: name|slug}
]
```

`consortium_role` is already a `filter:"in"` column (`db_table.js:147`). An `in` filter cannot
express "≠ member"; either (a) enumerate the allowed values (`['carrier', null]` — but NULL in an
`IN` list won't match, so this needs care), or (b) add a small dedicated `filter:"neq"` mode, or
(c) declare a `not_consortium_member` boolean view column on `contracts_list`. **Recommend (c)** —
a generated/view column `is_consortium_member boolean` filtered `eq false`, so the exclusion is one
clean predicate the browser, both breakdowns, and the reconciliation test all share. Confirm the
mechanism in Tier 1.

### 3.2 Redaction-sentinel / mega-hub guard

Bake the guard into `contractor_of_person_name`'s semi-join (above) and the breakdown function.
Confirm the exact sentinel/mega-hub list against the existing `person_associates` exclusion
(`024_person_api.sql:251-281`, `officer_name_counts`, `008`) and reuse it rather than hard-coding a
single string. (The slug variant needs no such guard — `person_role` is identity-resolved, so a
redaction placeholder never resolves to a `person_id`.)

### 3.3 Breakdown aggregates — `byCompany` + `bySettlement`

New `125_person_procurement_breakdowns.sql`, two functions (keeping the hot `person_procurement`
payload lean rather than fattening it):

- **`person_procurement_by_company(p_name, p_from, p_to)`** — `GROUP BY contractor_eik` over the
  same guarded `base` CTE as `person_procurement`:
  `[{ eik, name, totalEur, contractCount, awarderCount }]`, ordered `totalEur DESC`, bounded (~25).
- **`person_procurement_by_settlement(p_name, p_from, p_to)`** — join
  `base.awarder_eik → awarder_seats (source='geo', is_local_hq) → ekatte, settlement`,
  `GROUP BY ekatte`: `[{ ekatte, settlement, totalEur, contractCount, awarderCount }]`, ordered
  `totalEur DESC`, bounded (~12). Buyers with no geo seat (`is_local_hq=false` / no row) roll into
  a "национални" bucket, mirroring `procurement_by_settlement` (030). **[audit] `awarder_seats.eik`
  is a PRIMARY KEY, so this join is 1:1 — no `DISTINCT`, no double-count.** (`company_geography()`,
  `021`, is a working precedent for the `awarder_seats` join, though it rolls up by oblast.)

Both use the **identical** guarded `base` (same EIK set, same `tag`/member basis, same date window)
as `person_procurement`, so `Σ byCompany.totalEur == Σ bySettlement.totalEur == portfolio total`.

For the **slug** screen: add `_by_company_slug(slug,…)` / `_by_settlement_slug(slug,…)` reading
`person_role.ref` (the `082` EIK set), same shape.

### 3.4 Route wiring

No new route for the browser — it flows through generic `/api/db/table` + `/api/db/facets` using the
new semi-join column. The breakdown arrays: add to `/api/db/person` (legacy) and a slug path
(extend `/api/db/person-profile`, or a new `/api/db/person-breakdowns?slug=`). **[audit] facets +
semi-join is already proven** — the settlement page passes `awarder_ekatte` through
`useContractsAnalytics` → `/api/db/facets` today, so the strip works over the person scope too.

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
  scope: DbColumnFilter;               // contractor_of_person_name|_slug | awarder_ekatte | …
  fixedExtra?: DbColumnFilter[];       // tag + member-exclusion, passed by each caller
  window?: [string|null, string|null]; // scopeRange(scope, selected) — INCLUSIVE bounds
  columns: ContractColumnId[];
  filters?: { withYear?; withRisk?; toggleParam? };
  reactiveCpv?: boolean;
  countLabel?: string;
  // …initialSearch, titleClamp, sortableNames, showAppealChip, disclosure banner slot
};
```

It owns the strip + toolbar (`CpvFilterCombobox`, `ProcedureBucketSelect`, `RiskGradeFilter`,
`SingleBidderToggle`, clear button) + `DbDataTable` + footer — i.e. exactly the body of
`ProcurementSettlementContractsSection`. Then:
- `ProcurementSettlementContractsSection` becomes a thin wrapper passing the `awarder_ekatte` scope
  (**its existing tests must still pass** — that is the extraction's fidelity check).
- The person browser passes the `contractor_of_person_*` scope + the member-exclusion `fixedExtra`.
- (Follow-up, out of v1 scope) `CompanyContractsDbScreen` / `ContractsBrowserDbScreen` re-expressed
  on it.

### 4.2 Standalone page `/person/:name/contracts`

New screen **`src/screens/person/PersonContractsScreen.tsx`** — shell (SEO, breadcrumb back to
`/person/:name`, `ScopeControl`, title, **namesake disclosure banner** — §8) wrapping
`<ContractsBrowserSection>`. Columns: `date, awarder_name, contractor_name, title, amount_eur,
procedure, number_of_tenderers, consortium_full_eur, risk_cri` (both parties, like the settlement
browser). `titleClamp="sm"`, `showAppealChip`, `sortableNames` (a person's row set is small).

**[audit] The screen must resolve name-vs-slug before choosing the scope column.** `:name` is a
**slug** for public figures but a **raw TR name** for the fallback persons. Call
`usePersonProfile(name)`:
- profile hit (has `slug`) → scope = `{ id:"contractor_of_person_slug", value: profile.slug }`;
- profile miss (`null`) → scope = `{ id:"contractor_of_person_name", value: decodeURIComponent(name) }`.

This mirrors how `PersonProfileScreen` itself decides between `PersonDashboard` and the legacy
`PersonScreen`, so the contracts page and the profile page always agree on which EIK set they mean.

Register in `src/routes.tsx`, `path="person/:name/contracts"` — same shape as
`/company/:eik/contracts`.

### 4.3 Two breakdown tiles

New **`PersonByCompanyTile.tsx`** and **`PersonBySettlementTile.tsx`** (reuse
`CompanyTopAwardersTile`'s ranked bar-row layout — it already renders `{name, totalEur, share}`
rows with bars + a `seeAllHref`). Feed them `byCompany` / `bySettlement`. Settlement rows link to
`/procurement/settlement/:ekatte` (via `SettlementProcurementLink`); company rows to
`/company/:eik`. **[audit] Both tiles self-hide when their array is empty** (the guard
`CompanyTopContractsTile` already has) — most people have no procurement.

### 4.4 In-page portfolio upgrade + scope unification

In the portfolio section (legacy `PersonScreen` first, then `PersonDashboard`):
- Replace the bespoke **Период** `<Select>` (`PersonScreen.tsx:125-136, 467-485`) with shared
  **`ScopeControl` + `useScope`** so the portfolio KPIs, the breakdown tiles and the standalone
  browser read **one** scope.
  **[audit] Default the person scope to `all`, not `ns`.** `useScope`'s default is the selected
  parliament window (`ns`); adopting it blind would silently narrow the portfolio from all-time
  ("Всички години") to one parliament — a regression. Use `useScope({ allowAll })` and default to
  `all`. Note the vocabulary change: `pscope` offers `all` / `y:<year>` / `ns:<election>` but **not**
  "last 4 years" — confirm dropping that option (§8).
- **[audit] Date convention (the settlement-page hazard):** `person_procurement` is **inclusive**
  (`date <= p_to`, `024:39-40`); `useScopeWindow` is half-open (`date < to`). The `/api/db/person`
  call must receive `scopeRange`'s **inclusive** bounds (upper = `to − 1 day`), NOT
  `useScopeWindow`'s exclusive `to` — otherwise the KPI admits one extra day vs the browser.
- Add `<ContractsAnalysisStrip>` above _Топ договори_, fed by
  `useContractsAnalytics({ resource:"contracts", fixedFilters:[scope, memberExclusion, tag, window] })`.
  Σ€/count still come from the `person_procurement` rollup; single-bid%/direct%/mix come from facets
  over the identical scope, so they describe the same rows. **No per-column filter bar here** (§2).

### 4.5 Wire "Топ договори" → standalone page

`CompanyTopContractsTile` already accepts `seeAllHref` (`CompanyTopContractsTile.tsx:29`); the
person screen passes `seeAllHref={null}` today (`PersonScreen.tsx:548`). Change to
`` seeAllHref={`/person/${encodeURIComponent(name)}/contracts`} `` (carry `?pscope`).

### 4.6 Both screens

Because the browser section, tiles and (post-refactor) portfolio are shared components taking a
`scope` prop, wiring them into `PersonDashboard` (slug) is: pass `contractor_of_person_slug` + the
slug breakdown arrays. **[audit] `/candidate/:id` also renders `PersonDashboard`** — so it inherits
the portfolio + tiles automatically once they mount there. Decision: candidates **do** get them
(a candidate resolves to a person slug via `useCandidatePerson`); the standalone-page link from a
candidate uses that resolved slug. Confirm the candidate → slug resolution is present before Tier 5.

---

## 5. Suggested sequencing

- **Tier 1 — backend seam.** `125_…breakdowns.sql` (both breakdown fns + the member-exclusion
  mechanism, §3.1c); the two semi-join columns + sentinel guard in `db_table.js`. **Measure the two
  breakdown aggregates** (§1 audit). PG data tests (§6). No UI yet.
- **Tier 2 — DRY extraction.** Extract `ContractsBrowserSection`; re-express
  `ProcurementSettlementContractsSection` on it (its existing tests must stay green).
- **Tier 3 — standalone page.** `PersonContractsScreen` (with the name/slug resolution, §4.2) +
  route + `seeAllHref` wiring + namesake banner.
- **Tier 4 — in-page upgrade.** Scope unification (default `all`, inclusive bounds) +
  `ContractsAnalysisStrip` + the two breakdown tiles, on the legacy `PersonScreen`.
- **Tier 5 — slug screen.** Slug semi-join + slug breakdowns; mount the shared components on
  `PersonDashboard` (and thereby `/candidate/:id`).

---

## 6. Testing

- **PG data test** (`scripts/db/tests/*.data.test.ts`, auto-skips when PG is down): for a known
  person, assert the `contractor_of_person_name` semi-join row set **under the same
  tag+member-exclusion basis** == `person_procurement`'s `contractCount` / `totalEur`
  (reconciliation — this is why the basis fix in §1/§3.1 is load-bearing); assert the redaction
  sentinel resolves to **zero** rows; assert `Σ byCompany == Σ bySettlement == portfolio total`.
- **Component tests** for the two tiles (empty-state self-hide), `ContractsBrowserSection` (renders
  strip + table, applies scope), and `PersonContractsScreen`'s name-vs-slug branch (slug hit →
  slug column; miss → name column).
- Keep `ProcurementSettlementContractsSection.test.tsx` green after the extraction.

## 7. Deploy / ops

- Order: apply `125_person_procurement_breakdowns.sql` (via `apply_functions.ts`) to the target DB
  **first**, then `deploy:db` (ships `db_table.js` semi-join columns + the route reading the new
  arrays), then `deploy` (hosting: the new screen + route). Hosting-last so a linked
  `/person/:name/contracts` never points at a route the function can't serve.
- No new matview, no new loader. The semi-join reads `awarder_seats` (already current on prod for
  `awarder_ekatte`), `tr_officers` and `person_role` (already loaded).

## 8. Open decisions / risks

- **[audit] Scope vocabulary.** Moving the portfolio to `?pscope` (default `all`) drops "last 4
  years" and swaps arbitrary-year for `y:<year>`. Confirm acceptable, or add a scope option. The
  upside is one scope across KPIs + tiles + browser (no drift).
- **[audit] SEO / sitemap.** `/person/:name/contracts` is a server-side browser, not indexable
  content: confirm it is covered by the Firebase SPA rewrite but **excluded** from the sitemap /
  `prerender_slugs` set (per the sitemap-validity constraint — every `<loc>` needs a real
  prerendered `index.html`). Add a `noindex` canonical to the profile page if crawlers reach it.
- **[audit] i18n.** New tiles / page / labels need EN + BG `t()` keys (`src/locales` +
  `public/locales`). Reuse existing procurement keys (`company_contracts`,
  `procurement_contracts_word`, …) where they fit.
- **[audit] Namesake collapse is worse at browser scale.** The legacy name-keyed set collapses
  namesakes (`tr_officers` has no person id); a common name can span multiple real people across
  hundreds of rows. Keep the `person_namesake_disclosure` banner on the standalone browser page and
  the tiles, not only on the profile. The slug path is identity-resolved and does not have this
  issue.
- **[audit] `byCompany` vs `Участия`.** The `Участия` owns/manages tables already show a per-firm
  value bar; frame the new by-company tile explicitly as a **procurement ranking** (ordered by €
  won), not a duplicate of Участия.
- **Two semi-join columns** is mild duplication; acceptable because each guarantees reconciliation
  with a different KPI source (a single column can't take both a name and a slug — one placeholder).

---

## 9. Audit ledger — assumptions confirmed against the code

Recorded so the fixes above aren't re-litigated:

- Semi-join template mechanics valid: `translit_bg_latin(?)` and the slug SQL each carry exactly one
  `?` (`buildFilter` requires 2 split-parts, `db_table.js:1352-1356`). ✓
- `awarder_seats.eik` is `PRIMARY KEY` → `bySettlement` GROUP BY is 1:1, no double-count
  (verified: max rows per eik under `source='geo' AND is_local_hq` = 1, 0 dupes). ✓
- `translit_bg_latin` exists and is callable under `app_readonly`. ✓
- `MAX_IN_VALUES` (1000) applies only to `filter:"in"` value arrays, **not** the semi-join subquery
  (`db_table.js:1299` vs `1352-1360`). ✓
- facets + semi-join already work in production (the settlement page threads `awarder_ekatte`
  through `useContractsAnalytics`). ✓
- `company_geography(eik)` (`021`) already joins `awarder_seats` for contractor-side geography — a
  concrete precedent for `person_procurement_by_settlement`. ✓
</content>
