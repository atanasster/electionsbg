# Procurement settlement page → contracts browser (v1)

Bring `/procurement/settlement/:ekatte` up to the shape of the per-company
contracts page (`/company/:eik/contracts`): the same server-side `DbDataTable`,
the same filter row, the same reactive KPI strip, the same columns — scoped to
"every buyer seated in this settlement" instead of one EIK, and time-bounded by
the shared `?pscope` control instead of the company page's bespoke `?year`.

Status: **plan only, nothing implemented.**

---

## 1. Baseline — measured, 2026-07-29

### 1.1 What the page costs today

`/procurement/settlement/:ekatte` issues exactly **one** data request,
`/api/db/procurement-settlement?ekatte=…` (everything else on the waterfall is
the app shell: `canonical_parties.json` 83 KB, `governments.json` 10 KB,
`articles/index.json`). Measured with `performance.getEntriesByType('resource')`
in the dev browser and with `curl` against local + prod:

| EKATTE | Settlement | Payload | Local (warm) | **Prod** |
|---|---|---|---|---|
| 68134 | София | 87 KB | 248 ms | **6.6 s** |
| 56784 | Пловдив | 52 KB | 145 ms | — |
| 10135 | Варна | 44 KB | 230 ms | **4.1 s** |
| 07079 | Бургас | 35 KB | — | 1.8 s |

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

| EKATTE | Payload | `byYear` | Unused fields on `topContracts` | Unused fields on `awarders` | **Dead** |
|---|---|---|---|---|---|
| 10135 | 35.0 KB | 1.2 KB | 12.6 KB | 3.7 KB | **49.9%** |
| 68134 | 70.5 KB | 1.2 KB | 12.3 KB | 10.8 KB | **34.5%** |

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

### 1.3 What the company contracts page costs

Measured on `/awarder/000093442/contracts` (Община Варна): **7 requests, 1.41 MB**.

| Request | Size | Local |
|---|---|---|
| `/api/db/procurement-risk-indexes` | **1262 KB** | 45 ms (**3.7 s on prod**) |
| `/canonical_parties.json` | 83 KB | 3 ms |
| `/api/db/table` (25 rows + aggregates) | 47 KB | 15 ms |
| `/api/db/facets` ×2 | 1 KB each | 9 / 11 ms |

Copying this page verbatim would import that 1.29 MB. §3.5 says what we do instead.

### 1.4 What the target scope costs in Postgres

`EXPLAIN (ANALYZE)` against local Postgres, worst case = София (327 buyers,
64 609 contracts). Both scopes measured, because `?pscope` makes the **windowed**
query the default path and the full corpus the opt-in:

| Query | `?pscope=ns` (52nd NS window) | `?pscope=all` (corpus) |
|---|---|---|
| Page (25 rows, `ORDER BY date DESC`) | **1.9 ms** | **1.1 ms** |
| `count(*) + sum(amount_eur)` | **54 ms** | **18 ms** |
| `procurement_method` facet | **31 ms** | **20 ms** |
| `left(cpv,2)` facet | **30 ms** | **244 ms** ⚠ |
| `count(DISTINCT awarder_eik)` | **25 ms** | **45 ms** |

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

| Option | Verdict |
|---|---|
| **A. Pass the EIK set as `awarder_eik IN (…)`** — no backend change, the sector-pack seam already does this. | ✗ The client must fetch the detail blob first (a waterfall), and the София request URL reaches **6 199 chars** — inside a proxy's 8 KB header budget but not by much. |
| **B. Denormalise `contracts.awarder_ekatte`** | ✗ `contracts` is TRUNCATE+COPY loaded; a backfill step that must re-run after every reload is exactly the "invisible staleness" class this repo keeps getting bitten by. |
| **C. Join `awarder_seats` into the `contracts_list` view** | ✗ Taxes *every* contracts query with a join, and any filter on it makes `aggBaseFor()` fall back to the view — losing the migration-113 covering indexes for the global browser. |
| **D. A registry-declared semi-join filter** ✅ | Chosen. No view change, no new column, no reload-order hazard, and `aggBase` stays `contracts`. |

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
`>= / <=` pair, so it stays sargable. (Note this is *not* the
`(p_from IS NULL OR date >= p_from)` shape inside migration 030, which is the
non-sargable pattern flagged in the PG playbook; the browser path avoids it.)

Measured plans for exactly this SQL shape are in §1.4.

### 2.2 Slim the detail endpoint, and window it

`procurement_settlement_detail` keeps serving the header + buyers table, but the
contracts table takes over what `topContracts` was for. Changes:

- **Pass `from`/`to` from the client.** The SQL function and the
  `procurement-settlement` route already accept them
  (`procurement_settlement_detail(p_ekatte, p_from, p_to)`,
  functions/db_routes.js:748) — the hook simply never sends them. Making the hook
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

⚠ `procurement_settlement_detail` has three dependent matviews and the file's own
comment warns that changing the **signature or return type** requires dropping
`procurement_by_settlement_cache`, `procurement_settlement_rank` and
`procurement_geo_payloads` in the same statement. Adding a parameter is a new
signature — so pass the slim flag through `db_routes.js`, not the SQL signature.
The `from`/`to` params already exist and need no signature change at all.

Projected result: header + buyers payload drops from **87 KB → ~40 KB** for
София (and less again under a non-`all` scope), and the tiles drop to **~3 KB**.

---

## 3. Frontend

New screen composed from parts that already exist. The closest template is
`ContractsBrowserDbScreen` (global browser) rather than
`CompanyContractsDbScreen` — it is already `?pscope`-aware via `useScopeWindow`
and it renders *both* the awarder and contractor columns, which a settlement
page needs.

### 3.1 Time scope — `?pscope`, replacing `?year`

**Decided: the page becomes scope-aware, and there is no second time control.**
`?pscope=y:2024` already expresses everything the company page's `?year` Select
does, so shipping both would put two overlapping time controls on one screen.

- Mount `ProcurementSectionHeader` with `scopeMode="toggle"` — it renders the
  shared `ScopeControl` under the title in the same position as every other
  `/procurement*` page.
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
   `buildProcurementSettlementBody` (scripts/prerender/bodyBuilders.ts:1309)
   bakes `contractCount` / `totalEur` / `awarderCount` for the full corpus into
   the static body Google indexes. Keep it corpus-scoped — a static page cannot
   track a URL param — and make its copy say so explicitly ("за целия период"
   / "all years on record"), so the indexed text is not contradicted by the
   default view. Do **not** change the numbers the prerender reads; the §2.2
   slim must preserve those three fields.

### 3.2 Filters — `useUrlProcurementFilters`

Otherwise identical to the company page, so a filtered settlement view stays
shareable:

| Control | URL param | Component |
|---|---|---|
| Time scope | `?pscope` | `ScopeControl` (§3.1) |
| Free-text (buyer / contractor / subject) | `?q` | `DbDataTable` search box |
| CPV division | `?cpv` | `CpvFilterCombobox`, reactive counts |
| Procedure bucket | `?proc` | `ProcedureBucketSelect` |
| Risk grade A–F | `?grade` | `RiskGradeFilter` (server-side, migration 112) |
| Single bidder | `?single` | `SingleBidderToggle` |
| Clear all | — | `hasActiveFilters` / `clearFilters` |

`useUrlProcurementFilters` is called **without** `withYear` (that flag exists for
the company page's bespoke Select).

### 3.3 KPIs — `ContractsAnalysisStrip`

Reactive to the active filters *and* the scope, fed by `DbDataTable`'s own
aggregates (`onData`) plus `useContractsAnalytics` facets — no extra requests
beyond the two the company page already makes:

- **Обща стойност** (Σ amount_eur over the filtered set)
- **Договори** (count)
- **Възложители** — the settlement-specific card. `DbDataTable` aggregates only
  do `count`/`sum`, so either take it from the detail payload or add a
  `countDistinct` aggregate to the registry. Measured at 25–45 ms; **recommend
  adding it** — otherwise the buyers count is the only card that ignores both the
  filters and the scope, which is precisely the mismatch this page is being
  rebuilt to remove.
- **1 оферта %** and **Пряко възлагане %** (facet-derived)
- **Вид процедура** clickable mix bar (`ProcedureMixBar`)

### 3.4 Layout

1. Breadcrumb + title + `FollowStar`.
2. `ProcurementSectionHeader` (`scopeMode="toggle"`) — the scope control.
3. KPI strip (§3.3) — replaces the three static cards.
4. **Възложители** — the existing buyers table, kept: it is what makes this page
   different from a filtered global browser. Collapse to the top 10 with a
   "покажи всички (327)" toggle so София stops rendering 327 rows on mount.
5. *(optional)* By-year bar from `byYear` — already fetched, never drawn. Under a
   `y:<year>` scope it degenerates to one bar; hide it there.
6. **`DbDataTable`** over `contracts`, `fixedFilters: [{tag: contract},
   {awarder_ekatte: <ekatte>}]` + the scope's `date` range,
   `defaultSort: date desc`, `pageSize: 25`, with `ContractsAggregatesFooter`.
7. Footnote (buyer-HQ methodology) — unchanged.

### 3.5 Columns

Both entity sides, since a settlement spans many buyers:

| Column | Sortable | Notes |
|---|---|---|
| Подписан | via `date` | `dateSigned ?? date` |
| Възложител | ✓ | → `/awarder/:eik` |
| Изпълнител | ✓ | → `/company/:eik` |
| Предмет | — | → `/procurement/contract/:key`, 2-line clamp |
| Стойност | ✓ | `ContractAmount` |
| Процедура | — | bucketed chip |
| Оферти | ✓ | `number_of_tenderers` |
| Обединение | — | `consortiumFullEur`, `hidden lg:` |
| Оценка (A–F) | ✓ | `risk_grade` badge — see §3.6 |

### 3.6 Risk — **decided: server grade only**

Do **not** mount `useContractRiskScorer` here. The A–F badge and the `?grade`
filter come from `risk_grade` / `risk_cri`, which the registry already projects
on every row, so the page ships **0 extra bytes** instead of inheriting the
1.29 MB / 3.7 s `procurement-risk-indexes` fetch.

The per-signal chip breakdown is lost until someone writes a
`risk_fired_mask` → components decoder (the masks are projected already). That
decoder is worth its own ticket — it would also let the company and global
browsers drop the 1.29 MB.

### 3.7 Not forgotten

- **`ProcurementBySettlementFile` type** (`src/data/dataTypes`) changes with the
  payload; `ProcurementWatchlistScreen` reads `awarder.totalOther`.
- **The two tiles must stay corpus-scoped.** `MyAreaProcurementTile` and
  `SettlementProcurementTile` live on pages that have no `?pscope` in the URL, so
  a scope-aware hook would silently re-anchor them to `ns` and change every
  My-Area number without anything failing. Pass an explicit corpus scope at those
  two call sites.

---

## 4. Steps

| # | Step | Files |
|---|---|---|
| 1 | `semijoin` filter mode + `contracts.awarder_ekatte` registry entry + `db_table.test.js` coverage | `functions/db_table.js`, `functions/db_table.test.js` |
| 2 | `countDistinct` aggregate for the buyers KPI (§3.3) | `functions/db_table.js` |
| 3 | Scope-aware `useSettlementProcurement` — pass `from`/`to`, put the scope key in the React Query key; explicit corpus scope at the two tile call sites | `useSettlementProcurement.tsx`, `MyAreaProcurementTile.tsx`, `SettlementProcurementTile.tsx` |
| 4 | Carry `?pscope` through the by-settlement drill-down (`useScopedHref`) | `ProcurementBySettlementScreen.tsx:217` |
| 5 | New `ProcurementSettlementContractsSection` — `DbDataTable` + filters + analysis strip, bounded by `useScopeWindow` | `src/screens/procurement/` |
| 6 | Rewrite `ProcurementSettlementDetailScreen` around it: `ProcurementSectionHeader` scope control, collapsed buyers table | `ProcurementSettlementDetailScreen.tsx` |
| 7 | Slim the detail payload (§2.2 — route-level flag, **not** a new SQL signature); keep the three fields the prerender reads | `functions/db_routes.js`, `useSettlementProcurement.tsx` |
| 8 | Prerender copy: state the static body is full-corpus (§3.1) | `scripts/prerender/bodyBuilders.ts:1309` |
| 9 | PG regression test: the semi-join + window returns the same count/Σ as `procurement_settlement_detail(ekatte, from, to)` across a sample of settlements and all three scope kinds | `scripts/db/tests/*.data.test.ts` |
| 10 | Component test: scope + filter changes produce the expected request shape | co-located `*.test.tsx` |
| 11 | Re-measure §1.1 and record the delta in this file | — |

Steps 1–2 are backend-only and independently shippable. 3–4 make the page
scope-aware and can land before the table exists (they are a visible fix on their
own — the drill-down stops dropping the scope). 5–6 are the main change; 7–8 the
payload/SEO cleanup; 9–11 the gates.

---

## 5. Follow-ups this surfaced (each its own ticket)

1. **`/api/db/*` is served uncompressed and uncached** (§1.1). Site-wide; the
   largest single beneficiary is the 1.29 MB risk-indexes payload.
2. **CPV facet, 244 ms on `?pscope=all`** (§1.4). Only the corpus scope is
   affected — the windowed scopes plan at ~30 ms. `idx_contracts_cpvdiv_date` is
   `(tag, left(cpv,2), date) INCLUDE (contractor_eik, amount_eur)` with no
   `awarder_eik`, so an awarder-scoped CPV facet over the whole corpus heap-scans.
   Adding `awarder_eik` to the INCLUDE list would make it index-only; verify with
   `EXPLAIN` before touching an index on a 300k-row table.
3. **`risk_fired_mask` decoder** (§3.6) — would let three browsers drop 1.29 MB.
4. **Cold-start 500 on `/api/db/procurement-settlement`** (§1.1) — reproduced
   once at 20.5 s; likely a statement timeout on a cold Cloud SQL connection.
5. **Migration 030's window predicates are the non-sargable
   `(p_from IS NULL OR date >= p_from)` shape.** It measures fine today
   (128 ms windowed), but now that windowed calls become the default path rather
   than dead code, it is worth a COALESCE-bounds pass per the PG playbook.
