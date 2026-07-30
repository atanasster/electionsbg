# /procurement/contractors — "Топ изпълнители" redesign v1

Bring the contractors leaderboard up to the best-in-class procurement-page bar
(the `/procurement/contracts` + `/procurement/tenders` browsers): breadcrumb,
`?pscope` scope, KPI strip, filters, and **server-side** paging over the *full*
contractor set — not the top-1,000 blob it ships today.

## Why (grounded numbers, measured 2026-07-30)

- **29,475 distinct contractors** in `contracts` (`tag IN ('contract','award')`,
  non-empty `contractor_eik`). The page shows the **top 1,000** — ~28.5k
  contractors are unreachable, and there is no way to search for one by name.
- **30 scope windows** exist (`procurement_scopes`: `all` + 13 `ns:` + 16 `y:`).
  The page ignores `?pscope` entirely — it is hardwired to full-corpus.
- Only **333 MP-tied companies** (`company_politicians`) — a scarce,
  high-signal civic angle worth a headline KPI.
- The fan-out precedent already exists: **`procurement_settlement_rank`** (10,211
  rows keyed by `scope_key`, migration 119) is the exact template — a per-scope
  precomputed leaderboard served through `DbDataTable` (`resource:
  "procurement_settlements"`, `defaultScope {scope_key: "all"}`).

## Current state (the outlier)

`src/screens/TopContractorsScreen.tsx` (111 lines):
- Client-side `DataTable` (`@/ux/data_table/DataTable`), ships every row and
  sorts/filters/pages in the browser.
- Fed by `useTopContractors()` → `rankingsQueryKey(null, null)` → hardcoded
  full-corpus `procurement_rankings(NULL, NULL)`, served from the
  `procurement_rankings_cache` matview, **capped `LIMIT 1000`**
  (`scripts/db/schema/pg/031_procurement_rankings.sql`).
- **No** `ProcurementSectionHeader` (⇒ no breadcrumb, no scope control), **no**
  KPI strip, **no** filter toolbar, **no** `?pscope` awareness.
- Columns: rank · name (FollowStar + `/company/:eik` link + MP-tied badge) ·
  total (`formatEurWithOther`) · contractCount.

## Target composition (mirror contracts/tenders)

```
<Title>                                    page title + description
<ProcurementSectionHeader                  breadcrumb + ScopeControl (one block)
    current="procurement_index_top_contractors" scopeMode="toggle" />
<section>
  scope caption line (icon + "всички години / <year> / <from→to>")
  <ContractorsKpiStrip>                    4 StatCards (see §KPIs)
  <DbDataTable resource="contractor_rankings"
      scope={{ col: "scope_key", val: scopeKey }}
      extraFilters={cpv + mpTied}
      initialSearch={?q}
      toolbar={CpvFilterCombobox + MpTiedToggle + clear}
      renderAggregates={Σ€ + count footer}
      onData={feed reactive Σ€/count KPIs} />
</section>
```

---

## Backend — the substantive gap

`contracts`/`tenders` are row-level resources; "top contractors" is an
**aggregation**, so there is no registry resource for it today. Build a
scope-keyed fan-out matview + KPI companion, riding migration 119's loader.

### Migration `122_contractor_rank.sql`

**`contractor_rank`** — one row per `(scope_key × contractor_eik)`, aggregating
`contracts` inside each scope window (reuse the CTE shape of
`procurement_rankings()` but `GROUP BY contractor_eik` per window, driven off
`procurement_scopes` exactly like 119 drives `procurement_settlement_rank`):

| column | type | notes |
|---|---|---|
| `scope_key` | text | fan-out key; index leader |
| `eik` | text | `filter:"eq"` |
| `name` | text | COALESCE(`tr_companies.name`, contracts name) |
| `name_fold` | text | `translit_bg_latin(name)` for `searchFold` |
| `total_eur` | **double precision** | ⚠ NOT numeric — node-postgres serializes PG `numeric` as a STRING ⇒ every money cell renders BLANK (the `/persons` money-column bug). `filter:"range"`, `agg:"sum"`, sort |
| `contract_count` | int | `filter:"range"`, sort |
| `award_count` | int | display |
| `total_other` | jsonb | native-currency remainder (display-only passthrough) |
| `is_mp_tied` | bool | `filter:"eq"` |
| `mp_ids` | text[] | display-only badge passthrough |
| `cpv_divisions` | text[] | distinct `left(cpv,2)` they won in → `filter:"in"` membership ("won in sector X") |
| `id` | bigint | stable paging tiebreak (`row_number()`), or use `eik` |

Indexes:
- `btree (scope_key, total_eur DESC, eik)` — the default-sort range scan.
- `gin (name_fold gin_trgm_ops)` — free-text name search (`%>` + ILIKE fold).
- `gin (scope_key, cpv_divisions)` or `gin (cpv_divisions)` — CPV membership.

Estimated size: ≤ 29,475 × 30 = 884k rows worst case; realistically ~200–400k
(a contractor only appears in windows it was active in). Trivial for PG;
refresh comparable to the settlement fan-out (~seconds).

**`contractor_scope_kpis`** — one row per `scope_key` (30 rows) for the headline
KPIs a per-row table can't compute:

| column | notes |
|---|---|
| `scope_key` | key |
| `contractor_count` | distinct contractors in window |
| `total_eur` (double) | Σ awarded value |
| `top10_share` | Σ(top-10 by value) / total — market concentration |
| `mp_tied_value_eur` (double), `mp_tied_share` | value flowing to MP-tied cos |
| `single_bid_value_eur` (double), `single_bid_share` | integrity signal |

Served by a tiny bespoke route `/api/db/contractor-scope-kpis?scope=<key>` (one
indexed lookup) — mirrors how the overview blobs are served.

### Loader wiring (rides the existing scope loader)

`scripts/db/load_procurement_scopes_pg.ts` already REFRESHes
`procurement_settlement_rank` per scope. Add `contractor_rank` +
`contractor_scope_kpis` to the same run so "scopes changed" and "the
contractor precompute matches the scopes" can never be two states. Also add the
guarded re-REFRESH to `scripts/db/load_pg.ts` (next to the settlement-cache
REFRESH at `load_pg.ts:520`) so a contracts reload cannot serve a stale
leaderboard.

**CLAUDE.md + memory follow-through (do not skip):**
- Cloud has no automatic runner — add `db:load:procurement-scopes:pg:cloud` as
  the publish step to the CLAUDE.md scopes paragraph (it already covers the
  January year-rollover + new-election triggers; this matview inherits them).
- Add `contractor_rank`/`contractor_scope_kpis` to the watch-skill reload list
  (the `reference_migrated_family_watch_reload` "tenders-stale" bug class) so a
  contracts refresh regenerates them live.
- The FIRST cloud deploy must run the loader **before** the `deploy:db` that
  ships the registry route reading `contractor_rank` (same rule as
  `cpv_catalog`) — the route must not degrade a missing matview to `[]`.

### Registry entry (`functions/db_table.js`)

Model on `procurement_settlements` (fan-out) + `agri_subsidies` (template):

```js
contractor_rankings: {
  base: "contractor_rank",
  scopeCols: ["scope_key"],
  defaultScope: { col: "scope_key", val: "all" },
  columns: {
    id: { type: "int" },
    eik: { type: "text", filter: "eq" },
    name: { type: "text", sort: true, search: true, searchFold: "name_fold" },
    total_eur: { type: "number", sort: true, filter: "range", agg: "sum" },
    contract_count: { type: "number", sort: true, filter: "range" },
    award_count: { type: "number" },
    is_mp_tied: { type: "bool", filter: "eq" },
    cpv_divisions: { type: "text[]", filter: "in", facet: true },
    mp_ids: { type: "text[]" },
    total_other: { type: "json" },
  },
  select: ["id","eik","name","total_eur","contract_count","award_count",
           "is_mp_tied","mp_ids","total_other"],
  defaultSort: [["total_eur","desc"],["eik","asc"]],
  aggregates: [{ fn: "count" }, { fn: "sum", col: "total_eur" }],
  maxPageSize: 1000,   // export ceiling, like procurement_settlements
}
```

(Confirm `searchFold` + `text[] filter:"in"` are already engine-supported for
the settlement/persons resources; if `text[]` membership needs a `facetExpr`
add it, else fall back to a `cpv_prefix`-style column.)

---

## KPIs — 3-up StatCard grid (DECIDED)

Lead with these three (contractor count is NOT a headline card — it lives in the
`DbDataTable` aggregates footer as the reactive row total):

1. **Обща стойност** — Σ€ awarded in scope. Reactive: rides the table's server
   `aggregates.sumTotalEur` via `onData`, so it moves with the search box.
2. **Концентрация — топ-10 дял** — `top10_share` (market concentration; "how few
   companies take how much"). Scope-level, from `contractor_scope_kpis`.
3. **Свързани с депутати** — `mp_tied_share` of value + the count of MP-tied cos.
   Scope-level, from `contractor_scope_kpis`. Scarce (333 cos) ⇒ high-impact.

Reuse `StatCard` from `src/screens/dashboard/StatCard.tsx`. The distinct
contractor count surfaces via `renderAggregates` (table footer), reactive to
search/filters. `single_bid_share` stays in the KPI blob for a possible v2
column but is not shown in v1.

---

## Filters (toolbar) + URL contract

Reuse the shared controls; keep everything in the documented `?pscope` +
procurement-filter URL contract:

- **CpvFilterCombobox** (`?cpv`) — filters `cpv_divisions` membership
  ("contractors who won in construction / pharma / …").
- **MpTiedToggle** (`?mp`) — new small toggle (clone `SingleBidderToggle`) →
  `is_mp_tied = true`.
- **`?q`** — free-text name search, seeds `initialSearch` (combined-search
  "see all" deep links land here, like `/procurement/contracts?q=`).
- **Clear filters** button gated on `hasActiveFilters`.

Add `?mp` and this page's `?cpv`/`?q` scope to the CLAUDE.md URL-contract
section. `?pscope` is already shared/documented.

---

## Performance analysis

**Today**
- Full-corpus: single-row JSONB blob from `procurement_rankings_cache`, ~instant
  server-side, but **ships all 1,000 rows** and the client `DataTable` does all
  sort/filter/page in-browser. Not scoped, not full-set.
- If we naively made the *current* screen scope-aware without a matview: every
  scope change runs `procurement_rankings(from,to)` **live** = ~530ms cold
  (re-aggregates the whole `contracts` table), CDN-cached ~1h, still capped
  1,000, still ships the whole blob. Rejected.

**Proposed (DbDataTable + fan-out matview)**
- Every page / sort / filter / search = one query against `contractor_rank`
  filtered by `scope_key` = **index range scan, LIMIT 25** ≈ few ms. Covered by
  the `(scope_key, total_eur DESC, eik)` index; the engine's **OFFSET-0 search
  fence** (`db_table.js`) handles the free-text case so a name search doesn't
  walk the ordered index.
- Aggregates run over the base with the covering index (the `aggBase` guard is
  moot here — the matview has no heavy joins).
- Client ships **25 rows/page** vs the current 1,000-row blob — large payload
  cut and no client-side aggregation.
- KPI blob: a 30-row `contractor_scope_kpis`, single indexed lookup per scope.
- Cost lands **offline**: one matview refresh at load, riding migration 119's
  loader. Duplication across ≤30 windows is the only trade-off and is small for
  PG (the settlement fan-out proves the shape at 10k rows).

**Must-verify before ship** (`reference_pg_query_performance` / `feedback_db_query_perf`):
- `EXPLAIN ANALYZE` the default page (`scope_key='all'`, sort `total_eur DESC`,
  LIMIT 25) → index scan, no seq scan.
- `EXPLAIN ANALYZE` a name search (`?q=софарма`) with the OFFSET-0 wrap → trigram
  bitmap scan first, then sort+limit.
- `EXPLAIN ANALYZE` CPV membership (`cpv_divisions && '{45}'`) on the worst-case
  window (`all`).
- Time the matview REFRESH; confirm it's within the existing scopes-loader budget.

---

## Tiers

- **T1 — chrome only (ships value immediately, no backend):** add
  `<ProcurementSectionHeader current="procurement_index_top_contractors"
  scopeMode="toggle" />` and switch `useTopContractors()` to the scope-windowed
  `useProcurementRankings(from,to)` so `?pscope` works against the *existing*
  route. Still capped 1,000 & client-side, but breadcrumb + scope land now.
- **T2 — backend:** migration 122 (`contractor_rank` + `contractor_scope_kpis`),
  loader wiring, registry entry, EXPLAIN gate, `*.data.test.ts` regression
  (row-count + join-key + money-type guard, per the persons-browse lesson).
- **T3 — frontend swap:** `DbDataTable resource="contractor_rankings"`, KPI
  strip, CPV + MP-tied filters, `?q`/`?mp` URL contract, aggregates footer.
- **T4 — docs/memory:** CLAUDE.md scopes paragraph + URL contract; watch-skill
  reload list; new memory pointer.

## Open decisions (confirm before T2)

1. **Scope of the swap** — T1-only (breadcrumb + scope on the existing blob, cap
   1,000) vs full T2+T3 (full 29k set, server-side). Recommend full; T1 is the
   fallback if we want to ship chrome this week.
2. **CPV-membership filter** — `text[]` `&&` vs a flattened `cpv_prefix` column.
   Pick whichever the engine already supports cleanly.
3. **5th KPI** — include single-bidder share, or keep it a clean 4-up?
4. **Risk at contractor level** (worst/avg `risk_grade` column + filter) —
   defer to v2 or fold into 122 now?
