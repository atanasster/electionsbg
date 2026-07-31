# Procurement settlement page → contracts browser (v1)

Bring `/procurement/settlement/:ekatte` up to the shape of the per-company
contracts page (`/company/:eik/contracts`): the same server-side `DbDataTable`,
the same filter row, the same reactive KPI strip, the same columns — scoped to
"every buyer seated in this settlement" instead of one EIK, and time-bounded by
the shared `?pscope` control instead of the company page's bespoke `?year`.

Status: **plan only, nothing implemented.** Audited against the tree on
2026-07-30 — §0 records what that audit changed.

---

## 0. Relationship to `db-payload-diet-v1` — read this first

[db-payload-diet-v1.md](docs/plans/db-payload-diet-v1.md) is an active,
partly-landed plan that overlaps this one on both ends, and three of its tiers
shipped **while this plan was being written**. The two are coupled deliberately;
neither should re-litigate the other's ground.

| Overlap                                                                | Owner                                                                             |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `/api/db` compression + caching (was follow-up #1 here)                | **its T0** — better data than this plan had (nine routes, 5.28 MB → 0.94 MB)      |
| Retiring the 1.29 MB client risk scorer (was §3.6 + follow-up #3 here) | **its T1/T2 — already landed**, see §1.3 and §3.6                                 |
| `cpv_catalog` (migration 121)                                          | **its T3 — already landed** (`c4a7e7ca00`)                                        |
| The dead-payload method in §1.2 below                                  | this plan; **its T4 cites §1.2** and applies the same method to eight more routes |

What the audit changed here:

1. **§1.3 was measured before T1/T2 landed and is replaced.** The company
   contracts page no longer ships 1.29 MB — it ships **170 KB**.
2. **§3.6's "server grade only" decision is superseded.** T1/T2 delivered
   something strictly better than the compromise this plan settled for: _full_
   chips at zero bytes. The constraint behind that decision (do not import a
   1.29 MB payload) is still honoured — the reason to accept degraded chips is
   gone.
3. **§3.1's `ProcurementSectionHeader` mount does not compile as written** — see
   the correction there.
4. Two line citations moved; the CPV filter changed component.

---

## 1. Baseline — measured 2026-07-29, re-verified 2026-07-30

### 1.1 What the page costs today

`/procurement/settlement/:ekatte` issues exactly **one** data request,
`/api/db/procurement-settlement?ekatte=…` (everything else on the waterfall is
the app shell: `canonical_parties.json` 83 KB, `governments.json` 10 KB,
`articles/index.json`). Measured with `performance.getEntriesByType('resource')`
in the dev browser and with `curl` against local + prod:

| EKATTE | Settlement | Payload | Local (warm) | **Prod**  |
| ------ | ---------- | ------- | ------------ | --------- |
| 68134  | София      | 87 KB   | 248 ms       | **6.6 s** |
| 56784  | Пловдив    | 52 KB   | 145 ms       | —         |
| 10135  | Варна      | 44 KB   | 230 ms       | **4.1 s** |
| 07079  | Бургас     | 35 KB   | —            | 1.8 s     |

Two prod-only facts fall out of the same measurement and are not settlement-specific:

- **`/api/db/*` responses go out uncompressed.** `curl -H 'Accept-Encoding: gzip, br'`
  against `electionsbg.com` returns no `content-encoding` and `content-length:
43763` — the identical raw byte count. The София blob gzips to ~24 KB, so
  compression alone would cut ~72% off the wire.
- **`cache-control: no-cache, max-age=0, must-revalidate`**, so nothing is edge-cached
  (`x-cache: MISS`). One cold София call returned **HTTP 500 after 20.5 s**; the
  retry succeeded in 6.6 s.

Both belong in a separate ticket — they are pre-existing and affect every DB-backed
page — but they set the bar: the fix below turns one 6.6 s / 87 KB request into
several sub-200 ms / ≤45 KB ones, which is the bigger win regardless.

### 1.2 How much of that payload is rendered

Roughly a third to a half is fetched and never drawn:

| EKATTE | Payload | `byYear` | Unused fields on `topContracts` | Unused fields on `awarders` | **Dead**  |
| ------ | ------- | -------- | ------------------------------- | --------------------------- | --------- |
| 10135  | 35.0 KB | 1.2 KB   | 12.6 KB                         | 3.7 KB                      | **49.9%** |
| 68134  | 70.5 KB | 1.2 KB   | 12.3 KB                         | 10.8 KB                     | **34.5%** |

`byYear`, `totalOther`, per-awarder `awardCount`/`totalOther`, and nine of the
fourteen fields on each of the 20 `topContracts` rows (`ocid`, `tag`, `amount`,
`currency`, `title`, `awarderEik`, `awarderName`, `bundleUuid`, `sourceUrl`)
have no consumer on this screen.

The **buyers table renders every row unpaginated** — 327 `<tr>` for София,
153 for Пловдив.

The same endpoint also backs `MyAreaProcurementTile` and
`SettlementProcurementTile`, both of which use only the three totals and
`awarders.slice(0, 5)` — so a София resident's My-Area page downloads 87 KB to
draw five rows.

### 1.3 What the company contracts page costs — **re-measured 2026-07-30**

`/awarder/000093442/contracts` (Община Варна) now costs **7 requests, 170 KB**:

| Request                                | Size      | Local      |
| -------------------------------------- | --------- | ---------- |
| `/canonical_parties.json`              | 83 KB     | 1 ms       |
| `/api/db/table` (25 rows + aggregates) | 47 KB     | 25 ms      |
| `/articles/index.json`                 | 21 KB     | 2 ms       |
| `/governments.json`                    | 10 KB     | 1 ms       |
| `/api/db/procurement-ngo-foreign`      | 7 KB      | 6 ms       |
| `/api/db/facets` ×2                    | 1 KB each | 18 / 33 ms |

The **1262 KB `procurement-risk-indexes` fetch is gone** — payload-diet T1/T2
(`22cc6edc1e`) switched this screen to decoding the server's per-row masks, and
the 7 KB `procurement-ngo-foreign` is the one input the masks do not carry.
Measured at 1.41 MB on 2026-07-29, 170 KB on 2026-07-30; this plan's earlier
figure described a tree that no longer exists.

**The consequence for this plan is the good kind:** the page it is copying is no
longer expensive, so there is nothing left to refuse to import. Note the
settlement page (178 KB, §1.1) is now _heavier_ than the contracts browser it is
being rebuilt into.

### 1.4 What the target scope costs in Postgres

`EXPLAIN (ANALYZE)` against local Postgres, worst case = София (327 buyers,
64 609 contracts). Both scopes measured, because `?pscope` makes the **windowed**
query the default path and the full corpus the opt-in:

| Query                                | `?pscope=ns` (52nd NS window) | `?pscope=all` (corpus) |
| ------------------------------------ | ----------------------------- | ---------------------- |
| Page (25 rows, `ORDER BY date DESC`) | **1.9 ms**                    | **1.1 ms**             |
| `count(*) + sum(amount_eur)`         | **54 ms**                     | **18 ms**              |
| `procurement_method` facet           | **31 ms**                     | **20 ms**              |
| `left(cpv,2)` facet                  | **30 ms**                     | **244 ms** ⚠          |
| `count(DISTINCT awarder_eik)`        | **25 ms**                     | **45 ms**              |

Two things worth reading off this table:

- **The window makes the worst call 8× faster.** The CPV facet's 244 ms on the
  full corpus is a heap scan; adding the date bound lets it ride
  `idx_contracts_cpvdiv_date` (`tag, left(cpv,2), date`). So `?pscope` is not a
  cost — on the default scope it is the fastest configuration this page has.
- Count+sum moves the other way (18 → 54 ms) because the date predicate isn't in
  `idx_contracts_awarder_tag_cover`, so the index-only scan degrades. Still well
  inside budget.

Sparse settlements are safe: EKATTE 00045 (one contract) plans seats-first and
runs in **1.0 ms**.

**The table above is the DEFAULT sort only.** Every sortable column and the
search box were measured separately, end-to-end through `/api/db/table` with the
София scope, because a 1.9 ms headline that only holds until the user clicks a
header is not a performance budget:

| Interaction                 | End-to-end |
| --------------------------- | ---------- |
| default (`date` desc)       | **26 ms**  |
| sort `amount_eur` desc      | **16 ms**  |
| sort `risk_cri` desc        | **169 ms** |
| sort `contractor_name` asc  | **254 ms** |
| free-text search ("ремонт") | **289 ms** |

So the honest envelope is **~290 ms worst-case interaction**, not 1.9 ms — still
an order of magnitude better than the 6.6 s single blob it replaces, and no
interaction regresses.

Two asymmetries worth knowing before someone "optimises" the wrong one:

- **`risk_cri` is the one column the window makes WORSE** (242 ms corpus →
  266 ms windowed at the SQL layer). It is `viewOnly` — a LEFT JOIN to
  `contract_risk_cache` — so the sort cannot ride a base-table index and the
  extra date predicate only adds work. Sorting `risk_grade` instead does not
  help; both come through the same join.
- **Do not apply the `OFFSET 0` search fence here.** The known trap
  (search + ORDER BY + LIMIT seq-scans, fixed by an OFFSET-0 subquery) is a
  _global-browser_ shape. Under the settlement semi-join the naive form plans at
  **7.6 ms** and the fenced form at **249 ms** — the fence is 33× worse. The
  engine already emits the fast shape; measure before importing that workaround.

The existing detail function benefits from the window too —
`procurement_settlement_detail('68134')` runs **283 ms** unwindowed vs **128 ms**
for the ns window.

**Conclusion:** the browser shape is 5–10× cheaper per interaction than the
single blob it replaces, and under the default scope nothing exceeds ~55 ms.

---

## 2. Backend — how to scope `contracts` to a settlement

The `contracts` registry has no place column, and `awarder_seats` (3 847 rows,
`idx_awarder_seats_local` on `(is_local_hq, source, ekatte)`) is where the
settlement lives. Four ways to bridge that; measurements decide it.

| Option                                                                                                       | Verdict                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Pass the EIK set as `awarder_eik IN (…)`** — no backend change, the sector-pack seam already does this. | ✗ The client must fetch the detail blob first (a waterfall), and the София request URL reaches **6 199 chars** — inside a proxy's 8 KB header budget but not by much.            |
| **B. Denormalise `contracts.awarder_ekatte`**                                                                | ✗ `contracts` is TRUNCATE+COPY loaded; a backfill step that must re-run after every reload is exactly the "invisible staleness" class this repo keeps getting bitten by.         |
| **C. Join `awarder_seats` into the `contracts_list` view**                                                   | ✗ Taxes _every_ contracts query with a join, and any filter on it makes `aggBaseFor()` fall back to the view — losing the migration-113 covering indexes for the global browser. |
| **D. A registry-declared semi-join filter** ✅                                                               | Chosen. No view change, no new column, no reload-order hazard, and `aggBase` stays `contracts`.                                                                                  |

### 2.1 Option D in detail

Add one filter mode to the shared engine (`functions/db_table.js` — used by both
prod `functions/index.js` and dev `vite/db-api.ts`, so one edit covers both):

```js
// registry: contracts.columns
awarder_ekatte: {
  type: "text",
  filter: "semijoin",
  semiJoinCol: "awarder_eik",
  semiJoinSql:
    "SELECT eik FROM awarder_seats WHERE source = 'geo' AND is_local_hq AND ekatte = ?",
},
```

and one branch in `buildFilter` (functions/db_table.js:1151) that emits
`awarder_eik IN (<template with ? → $n>)`. The template is registry-sourced —
never client input — and the value is a bound parameter, so the security
contract in the file header holds unchanged.

Not a `scopeCol` and not `viewOnly`: declaring it a plain filterable column lets
it ride `fixedFilters`, which is what every caller (table, facets, aggregates)
already threads, and keeps aggregates on the fast `contracts` base.

The pscope window rides the existing `date` range filter (`{id:"date", min:from,
max:to}`), exactly as `ContractsBrowserDbScreen` already does — a real
`>= / <=` pair, so it stays sargable. (Note this is _not_ the
`(p_from IS NULL OR date >= p_from)` shape inside migration 030, which is the
non-sargable pattern flagged in the PG playbook; the browser path avoids it.)

Measured plans for exactly this SQL shape are in §1.4.

### 2.2 Slim the detail endpoint, and window it

`procurement_settlement_detail` keeps serving the header + buyers table, but the
contracts table takes over what `topContracts` was for. Changes:

- **Pass `from`/`to` from the client.** The SQL function and the
  `procurement-settlement` route already accept them
  (`procurement_settlement_detail(p_ekatte, p_from, p_to)`,
  `functions/db_routes.js:785`) — the hook simply never sends them. Making the hook
  scope-aware is a client change only: no migration, and it is *faster*
  (283 → 128 ms, §1.4).
- **`useSettlementProcurement`'s React Query key must include the scope key.**
  Today it is `["procurement","settlement_detail",ekatte]`; without the scope in
  the key, flipping the control re-renders the previous window's numbers under
  the new label and never refetches.
- Drop `topContracts` from the default response — the new table supersedes it
  (~13 KB, the single biggest dead-weight item).
- Keep `byYear` (1.2 KB, and §3.3 finally renders it) — or drop it if the by-year
  tile is deferred.
- Add a slim mode (top-N awarders + totals only) for `MyAreaProcurementTile` /
  `SettlementProcurementTile`.

⚠ **CORRECTED after implementation.** This plan claimed `procurement_settlement_detail`
has three dependent matviews. It does not — `pg_depend` shows all three
(`procurement_by_settlement_cache`, `procurement_settlement_rank`,
`procurement_geo_payloads`) hang off `procurement_by_settlement`, the *list* function, and
030 already `DROP FUNCTION`s the detail one outright on every load. The detail function is
freely changeable; it is the LIST function that is fragile.

The slim flag still went through `db_routes.js`, for a different and better reason:
**rollout**. A route-level trim applies to whatever database it is pointed at, so the
saving lands when the function deploys rather than waiting for a Cloud SQL reload. The
dead `topContracts` CTE was removed from the SQL as well, since nothing prevented it.

Projected **87 KB → ~40 KB**; **measured 87 KB → 69 KB** for София, and 44 KB → 24 KB for
Варна. The projection was too optimistic: `topContracts` was only ~13 KB, and the
remaining bulk is the 327-row `awarders` array the page actually renders. The tiles land
at **2.9 KB** (София) / **2.7 KB** (Варна) — a 30× cut, which is where the real saving is.

### 2.3 Reuse — what to share rather than copy

This page is the **third** contracts browser. `CompanyContractsDbScreen` (487
lines) and `ContractsBrowserDbScreen` (498 lines) already share fifteen imports —
every _component_ is shared (`ContractsAnalysisStrip`, `ContractsAggregatesFooter`,
`ProcedureBucketSelect`, `RiskGradeFilter`, `SingleBidderToggle`, `RiskBadges`,
`ContractAmount`, `DbDataTable`, `useContractsAnalytics`,
`useUrlProcurementFilters`, `contractRiskMask`). What is duplicated is the
**wiring**, and the biggest block is the column array:

| Column ids                                                                                           | Company                | Global | Settlement needs |
| ---------------------------------------------------------------------------------------------------- | ---------------------- | ------ | ---------------- |
| `date`, `title`, `amount_eur`, `procedure`, `number_of_tenderers`, `consortium_full_eur`, `risk_cri` | ✓                      | ✓      | ✓                |
| `awarder_name` / `contractor_name`                                                                   | one, swapped by `side` | both   | **both**         |
| `source`                                                                                             | —                      | ✓      | —                |

The global browser's set is a strict superset of the company one. **Extract a
shared `contractColumns({ show, lang, t })` factory** and have all three screens
call it, rather than writing the array a third time — otherwise the next change
to the consortium column or the risk cell has to be made in three places, which
is exactly the drift `AwarderListSection`'s header documents for awarder lists.
Do the extraction as part of step 5; it is a refactor of two working screens, so
it wants its own commit ahead of the new one.

**Route every `/awarder/:eik` link through `AwarderLink`.** The buyers table
currently hand-rolls `<Link to={`/awarder/${a.eik}`}>`
(ProcurementSettlementDetailScreen.tsx:216). `AwarderLink` exists specifically
because such links dropped the scope carry and "rendered an empty page" — its
header says so. Today that is only a convention violation; **once §3.1 makes this
page scope-aware it becomes a live bug**, since every buyer link would silently
reset the reader's window.

**The same applies in the other direction, and it is wider than this page.** Five
call sites hand-roll `/procurement/settlement/:ekatte`:
`ProcurementWatchlistScreen.tsx:60`, `SettlementProcurementTile.tsx:33,106`,
`PlaceSeatLine.tsx:76`, `MyAreaProcurementTile.tsx:43` — plus the by-settlement
list (§3.1). Once the destination honours `?pscope`, each one enters at the
default scope and drops whatever the reader had. Add a `useSettlementHref` /
`SettlementLink` sibling to `useAwarderHref` / `AwarderLink` and convert all six,
rather than patching the one link this plan happens to touch.

**`AwarderListSection` is NOT the component for the buyers table.** It looks like
a fit and is not: its `roster` variant carries name + badge + note + EIK and has
no numeric columns, while the buyers table is a _ranked_ table (€1.3 bn, 5 084
contracts, sorted by spend). Keep the bespoke table; take only `AwarderLink` from
that neighbourhood.

---

## 3. Frontend

New screen composed from parts that already exist. The closest template is
`ContractsBrowserDbScreen` (global browser) rather than
`CompanyContractsDbScreen` — it is already `?pscope`-aware via `useScopeWindow`
and it renders _both_ the awarder and contractor columns, which a settlement
page needs.

### 3.1 Time scope — `?pscope`, replacing `?year`

**Decided: the page becomes scope-aware, and there is no second time control.**
`?pscope=y:2024` already expresses everything the company page's `?year` Select
does, so shipping both would put two overlapping time controls on one screen.

- Render **`<ScopeControl mode="toggle" />`** directly under the existing
  breadcrumb, in the slot every other `/procurement*` page puts it.

  ⚠ **Not `ProcurementSectionHeader`**, which an earlier draft of this plan
  specified. That wrapper takes `current?: string` and forwards it as
  `ProcurementBreadcrumb currentKey={current}` — an **i18n key** for a
  single-level leaf. This page needs the two-level crumb it already builds
  (`По място › Варна`) with a _dynamic settlement name_, which the wrapper
  cannot express. Keep the page's own `ProcurementBreadcrumb section={…}
current={data.name}` and drop `ScopeControl` (`src/screens/components/ScopeControl.tsx`)
  in beneath it. Extending the wrapper to take a `section` + literal leaf is the
  alternative, and worth doing if a second detail page needs the same shape.

  `ScopeControl mode="toggle"` renders "this parliament" vs a **years picker** in
  one control — which is why `?pscope` genuinely subsumes the company page's
  `?year` Select rather than merely replacing it.

- `useScopeWindow()` gives `{from, to, all}`; feed it to the table and to every
  facet as a `date` range filter (§2.1), and to the detail hook as `from`/`to`
  (§2.2).
- **Carry the scope through the drill-down.**
  `ProcurementBySettlementScreen.tsx:217` links with a bare
  `/procurement/settlement/${ekatte}`, so today the scope is silently dropped on
  entry. Switch it to `useScopedHref` (the same helper the procurement nav pills
  and `AwarderLink` use). This is the inconsistency the previous draft deferred;
  it is now in scope.

**Two consequences to handle, not defer:**

1. **The default scope changes the page's headline numbers.** Today the page is
   corpus-wide; under `ns` it will show one parliament's window by default. That
   is the correct, consistent behaviour, but it means the KPI cards must render
   under the scope label (`ScopeControl` provides it) so "€3.6 bn → €1.1 bn" reads
   as a narrower window rather than as lost data.
2. **The prerendered HTML is corpus-scoped.**
   `buildProcurementSettlementBody` (scripts/prerender/bodyBuilders.ts:1323)
   bakes `contractCount` / `totalEur` / `awarderCount` for the full corpus into
   the static body Google indexes. Keep it corpus-scoped — a static page cannot
   track a URL param — and make its copy say so explicitly ("за целия период"
   / "all years on record"), so the indexed text is not contradicted by the
   default view. Do **not** change the numbers the prerender reads; the §2.2
   slim must preserve those three fields.

### 3.1a Two date conventions — the page must use BOTH

The page asks the same question through two different SQL paths, and they take opposite
bound conventions. Getting this wrong shows one period's total above another period's
rows, with nothing failing:

| Consumer                 | SQL                                                          | Helper           |
| ------------------------ | ------------------------------------------------------------ | ---------------- |
| KPI cards / buyers table | `procurement_settlement_detail`, `date < to` — **half-open** | `useScopeWindow` |
| Contracts table          | DbDataTable `date` range, `date <= max` — **inclusive**      | `scopeRange`     |

Both helpers derive from the SAME `?pscope` value, so they cannot drift apart — but they
are not interchangeable. Handing `useScopeWindow`'s exclusive `to` to the table admits
1 January of the next year; handing `scopeRange`'s inclusive `to` to the endpoint drops
31 December. `procurement_settlement_scope.data.test.ts` pins the SQL side and
`ProcurementSettlementContractsSection.test.tsx` pins the client side.

### 3.2 Filters — `useUrlProcurementFilters`

Otherwise identical to the company page, so a filtered settlement view stays
shareable:

| Control                                  | URL param | Component                                         |
| ---------------------------------------- | --------- | ------------------------------------------------- |
| Time scope                               | `?pscope` | `ScopeControl` (§3.1)                             |
| Free-text (buyer / contractor / subject) | `?q`      | `DbDataTable` search box                          |
| CPV division                             | `?cpv`    | `CpvFilterCombobox` + `useCpvCatalog` — see below |
| Procedure bucket                         | `?proc`   | `ProcedureBucketSelect`                           |
| Risk grade A–F                           | `?grade`  | `RiskGradeFilter` (server-side, migration 112)    |
| Single bidder                            | `?single` | `SingleBidderToggle`                              |
| Clear all                                | —         | `hasActiveFilters` / `clearFilters`               |

`useUrlProcurementFilters` is called **without** `withYear` (that flag exists for
the company page's bespoke Select).

**Take the CPV control from the global browser, not the company page.** The
company page still renders a plain `Select` over `cpvOptions` from the facet;
`ContractsBrowserDbScreen` uses `CpvFilterCombobox` backed by `useCpvCatalog`
(the `cpv_catalog` table, migration 121, landed 2026-07-30 as payload-diet T3).
The combobox is the better control on a page whose CPV spread is wide, which a
whole settlement's is. **Deploy dependency:** per CLAUDE.md the route reading
`cpv_catalog` no longer degrades a missing table to an empty array, so
`db:load:tenders:pg:cloud` must have run on Cloud SQL before any `deploy:db`
that ships this page.

### 3.3 KPIs — `ContractsAnalysisStrip`

Reactive to the active filters _and_ the scope, fed by `DbDataTable`'s own
aggregates (`onData`) plus `useContractsAnalytics` facets — no extra requests
beyond the two the company page already makes:

- **Обща стойност** (Σ amount_eur over the filtered set)
- **Договори** (count)
- **Възложители** — the settlement-specific card. **Take it from the detail
  payload; do not add a `countDistinct` aggregate.** The earlier draft
  recommended the opposite, before checking: the engine has _no_ distinct
  aggregate anywhere in the registry, and the one place that needed a distinct
  count (`mp_cars`, "a distinct-MP count over these rows, never `count`",
  db_table.js:945) routed the question to a different tile rather than add one.
  Since §2.2 makes the detail payload window-scoped, its `awarders.length` is
  **scope-reactive for free** — which was the actual complaint. It remains
  filter-inert (it ignores CPV/procedure/grade). Accept that, label the card so
  it reads as "buyers in this settlement" rather than "buyers matching your
  filters", and add the engine surface only if the filter-reactive version is
  genuinely wanted (measured at 25–45 ms if so).
- **1 оферта %** and **Пряко възлагане %** (facet-derived)
- **Вид процедура** clickable mix bar (`ProcedureMixBar`)

### 3.4 Layout

1. Breadcrumb + title + `FollowStar`.
2. `<ScopeControl mode="toggle" />` under the breadcrumb (§3.1).
3. ~~KPI strip~~ — **the three static cards are GONE**, not relocated. The contracts
   section brings a reactive strip (Σ€, count, single-bid %, direct %), and a second set
   of the same figures that ignored the filters is exactly the disagreement this page was
   rebuilt to remove. The one number the strip cannot produce — the buyer count, which is
   distinct buyers rather than rows — moved into the buyers card's own header, where it
   reads as the length of that list.
4. **Възложители** — the existing buyers table, kept: it is what makes this page
   different from a filtered global browser. Collapse to the top 10 with a
   "покажи всички (327)" toggle so София stops rendering 327 rows on mount, and
   route its rows through `AwarderLink` (§2.3).
5. _(optional)_ By-year bar from `byYear` — already fetched, never drawn. Under a
   `y:<year>` scope it degenerates to one bar; hide it there.
6. **`DbDataTable`** over `contracts`, `fixedFilters: [{tag: contract},
{awarder_ekatte: <ekatte>}]` + the scope's `date` range,
   `defaultSort: date desc`, `pageSize: 25`, with `ContractsAggregatesFooter`.
   Items 3 and 6 ship as one component (`ProcurementSettlementContractsSection`) for
   the reason in item 3.
7. Footnote (buyer-HQ methodology) — unchanged.

### 3.5 Columns

Both entity sides, since a settlement spans many buyers:

From the shared factory of §2.3 — `show: [date, awarder_name, contractor_name,
title, amount_eur, procedure, number_of_tenderers, consortium_full_eur,
risk_cri]`, i.e. the global browser's set without `source`:

| Column       | Sortable   | Notes                                        |
| ------------ | ---------- | -------------------------------------------- |
| Подписан     | via `date` | `dateSigned ?? date`                         |
| Възложител   | ✓ (254 ms) | `AwarderLink`, **not** a raw `<Link>` (§2.3) |
| Изпълнител   | ✓ (254 ms) | → `/company/:eik`                            |
| Предмет      | —          | → `/procurement/contract/:key`, 2-line clamp |
| Стойност     | ✓          | `ContractAmount`                             |
| Процедура    | —          | bucketed chip                                |
| Оферти       | ✓          | `number_of_tenderers`                        |
| Обединение   | —          | `consortiumFullEur`, `hidden lg:`            |
| Оценка (A–F) | ✓ (169 ms) | `risk_grade` badge + mask chips — see §3.6   |

Sort timings are the measured worst case (§1.4). All three are `viewOnly` or
unindexed under this scope; none regresses against today, and none is worth an
index until someone shows the header actually gets clicked.

### 3.6 Risk — **superseded: full chips, still zero bytes**

The decision recorded here was "server grade only, accept losing the per-signal
chips, because the alternative costs 1.29 MB". **Payload-diet T1/T2 landed the
decoder that made the trade-off unnecessary**, so this page takes the better
outcome — the constraint (no 1.29 MB) is unchanged; only the price of full chips
is.

Do **not** mount `useContractRiskScorer`. Instead, exactly as
`CompanyContractsDbScreen` and `ContractsBrowserDbScreen` now do:

- `contractRiskFromMasks(row)` (`src/lib/contractRiskMask.ts`) decodes the row's
  `risk_fired_mask` / `risk_available_mask` — already projected by the registry —
  into the same `ContractRiskResult` the browser scorer produced. Synchronous,
  correct on first paint, and it agrees with the adjacent `?grade` filter **by
  construction** rather than by two scorers staying in step.
- `<RiskBadges result={…} contractKey={row.key} />` fetches per-flag tooltip
  detail lazily via `useContractRiskDetail`, armed on pointer **dwell** so a
  crossed row never fires (see the rate-limit note in §3.7).
- Keep the 7 KB `procurement-ngo-foreign` fetch — the one input the masks do not
  carry.
- **A NULL mask means unknown, never zero.** T1's rule: render an explicit
  unknown state, not a clean `—`. Needs the `bg`/`en` locale keys T1 added.

The A–F badge and `?grade` filter still come from `risk_grade` server-side, so
that half of the original decision stands.

### 3.7 Not forgotten

- **`/api/db` is rate-limited to 120 requests per IP per minute**
  (`DB_RATE_MAX`, functions/index.js:440), shared across every route. This page
  fires one table query plus up to three facet queries per interaction, and
  `RiskBadges` can add one detail fetch per hovered row. That budget is why the
  detail fetch arms on dwell rather than `onMouseEnter` — **do not add an eager
  per-row fetch anywhere on this page**, and re-check the count if the buyers
  table ever gains its own server query.
- **`ProcurementBySettlementFile` type** (`src/data/dataTypes`) changes with the
  payload; `ProcurementWatchlistScreen` reads `awarder.totalOther`.
- **The two tiles must stay corpus-scoped.** `MyAreaProcurementTile` and
  `SettlementProcurementTile` live on pages that have no `?pscope` in the URL, so
  a scope-aware hook would silently re-anchor them to `ns` and change every
  My-Area number without anything failing. Pass an explicit corpus scope at those
  two call sites.

---

## 4. Steps

| #   | Step                                                                                                                                                                                                                                                                     | Files                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `semijoin` filter mode + `contracts.awarder_ekatte` registry entry + `db_table.test.js` coverage                                                                                                                                                                         | `functions/db_table.js`, `functions/db_table.test.js`                                                                                                                        |
| 2   | ~~`countDistinct` aggregate~~ — **dropped by the reuse audit** (§3.3): the buyers KPI comes from the window-scoped detail payload, no new engine surface                                                                                                                 | —                                                                                                                                                                            |
| 2a  | Extract the shared `contractColumns({show, lang, t})` factory; switch `CompanyContractsDbScreen` + `ContractsBrowserDbScreen` onto it (§2.3). Own commit, ahead of the new screen                                                                                        | `src/screens/components/procurement/`, both existing screens                                                                                                                 |
| 2b  | Add `useSettlementHref` / `SettlementLink` beside `useAwarderHref` / `AwarderLink`; convert the six hand-rolled `/procurement/settlement/:ekatte` call sites (§2.3) — this is what keeps `?pscope` alive on entry from the watchlist, My-Area, place pages and the tiles | `ProcurementWatchlistScreen.tsx:60`, `SettlementProcurementTile.tsx:33,106`, `PlaceSeatLine.tsx:76`, `MyAreaProcurementTile.tsx:43`, `ProcurementBySettlementScreen.tsx:217` |
| 3   | Scope-aware `useSettlementProcurement` — pass `from`/`to`, put the scope key in the React Query key; explicit corpus scope at the two tile call sites                                                                                                                    | `useSettlementProcurement.tsx`, `MyAreaProcurementTile.tsx`, `SettlementProcurementTile.tsx`                                                                                 |
| 4   | ~~Carry `?pscope` through the by-settlement drill-down~~ — **folded into 2b**, which fixes all six entry points rather than one                                                                                                                                          |
| 5   | New `ProcurementSettlementContractsSection` — `DbDataTable` + the 2a factory + filters + analysis strip, bounded by **`scopeRange`** (see §3.1a); risk via `contractRiskFromMasks` + `RiskBadges contractKey` (§3.6)                                                     | `src/screens/procurement/`                                                                                                                                                   |
| 6   | Rewrite `ProcurementSettlementDetailScreen` around it: `ScopeControl` under the existing two-level breadcrumb (**not** `ProcurementSectionHeader`, §3.1), buyers table collapsed to 10 and on `AwarderLink`                                                              | `ProcurementSettlementDetailScreen.tsx`                                                                                                                                      |
| 7   | Slim the detail payload (§2.2 — route-level flag, **not** a new SQL signature); keep the three fields the prerender reads                                                                                                                                                | `functions/db_routes.js`, `useSettlementProcurement.tsx`                                                                                                                     |
| 8   | Prerender copy: state the static body is full-corpus (§3.1)                                                                                                                                                                                                              | `scripts/prerender/bodyBuilders.ts:1323`                                                                                                                                     |
| 9   | PG regression test: the semi-join + window returns the same count/Σ as `procurement_settlement_detail(ekatte, from, to)` across a sample of settlements and all three scope kinds                                                                                        | `scripts/db/tests/*.data.test.ts`                                                                                                                                            |
| 10  | Component test: scope + filter changes produce the expected request shape; risk cell populated on first paint (no `—`-then-chips flip — payload-diet T5's assertion, extended to this route)                                                                             | co-located `*.test.tsx`                                                                                                                                                      |
| 11  | Re-measure §1.1 and record the delta in this file                                                                                                                                                                                                                        | —                                                                                                                                                                            |

Step 1 is backend-only and independently shippable. 2a and 2b are pure refactors
of working code and should land first, each in its own commit — 2b is a visible
fix on its own (six entry points stop dropping the reader's scope), and doing it
before step 3 means the scope-aware page never ships with links that defeat it.
5–6 are the main change; 7–8 the payload/SEO cleanup; 9–11 the gates.

**Performance acceptance:** re-measure the §1.4 interaction envelope after step 6
— default sort, `amount_eur`, `contractor_name`, `risk_cri`, and a free-text
search — not just first paint. The budget is "no interaction regresses against
the 6.6 s blob", and the number to watch is the ~290 ms search.

---

## 5. Follow-ups this surfaced (each its own ticket)

1. ~~`/api/db/*` is served uncompressed and uncached~~ — **owned by
   payload-diet T0**, which measured it across nine routes (5.28 MB → 0.94 MB)
   and pinned down the `firebase.json` `**` header rule that was clobbering the
   `Cache-Control` the code already sets. Nothing to do here beyond re-measuring
   §1.1 after it lands: the prod figures in this plan are all pre-T0.
2. **CPV facet, 244 ms on `?pscope=all`** (§1.4). Only the corpus scope is
   affected — the windowed scopes plan at ~30 ms. `idx_contracts_cpvdiv_date` is
   `(tag, left(cpv,2), date) INCLUDE (contractor_eik, amount_eur)` with no
   `awarder_eik`, so an awarder-scoped CPV facet over the whole corpus heap-scans.
   Adding `awarder_eik` to the INCLUDE list would make it index-only; verify with
   `EXPLAIN` before touching an index on a 300k-row table.
3. ~~`risk_fired_mask` decoder~~ — **shipped** as payload-diet T1/T2
   (`src/lib/contractRiskMask.ts` + `useContractRiskDetail`). Four screens over
   six routes stopped downloading the 1.29 MB. It is **not retired**: that plan's
   2026-07-30 correction records that `TenderDetailScreen` scores _synthetic_
   contracts assembled from tender award rows, which have no
   `contract_risk_cache` entry and therefore no masks — so the payload survives
   on `/procurement/tender/*` until a per-tender risk index exists. Nothing this
   plan touches is on that path.
4. **Cold-start 500 on `/api/db/procurement-settlement`** (§1.1) — reproduced
   once at 20.5 s; likely a statement timeout on a cold Cloud SQL connection.
5. **Migration 030's window predicates are the non-sargable
   `(p_from IS NULL OR date >= p_from)` shape.** It measures fine today
   (128 ms windowed), but now that windowed calls become the default path rather
   than dead code, it is worth a COALESCE-bounds pass per the PG playbook.
