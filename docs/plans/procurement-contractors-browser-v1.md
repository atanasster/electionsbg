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
| `total_other` | jsonb | native-currency remainder (display-only; the screen needs it for `formatEurWithOther`) |
| `is_mp_tied` | bool | `filter:"eq"` |
| `division` | text | 2-digit CPV division (`left(cpv,2)`), **or the sentinel `'ALL'`** — see below |
| `id` | bigint | stable paging tiebreak (`row_number()`) — must be `select[0]` |

> **AUDIT FIX (finding A) — CPV is a rollup dimension, NOT an array.** The
> DbDataTable engine has **zero** Postgres-array support: `filter:"in"` emits a
> scalar `col IN ($1,$2)`, so a `text[]` column throws `operator does not exist:
> text[] = text`. Array overlap (`&&`/`@>`/`ANY`) is unavailable. Instead, fan
> `contractor_rank` out by `(scope_key, division)` with a per-contractor **`'ALL'`
> rollup row** (built via `GROUPING SETS ((scope_key, eik, division),
> (scope_key, eik))`, `COALESCE(division,'ALL')`). The CPV filter is then a
> **single-division `filter:"eq"`** on `division`; the screen ALWAYS sends
> `division` (default `'ALL'` — the engine's `defaultScope` covers only the ONE
> scope column, so a "no CPV filter" default must be sent explicitly as an
> `extraFilter`). Consequence: the CPV UI is a **single-select** division picker,
> not the multi-select `CpvFilterCombobox` (a comma-set would return N rows per
> contractor and double-count the leaderboard). The `'ALL'` row totals **all**
> contracts including those with null/malformed CPV, so it is the true total, not
> the sum of division rows. `mp_ids` is **dropped** — the screen renders only the
> `is_mp_tied` boolean badge, never the ids (finding C).

> **AUDIT FIX (finding E) — no per-scope `LIMIT`.** Unlike the 031 function
> (capped `LIMIT 1000`), the matview keeps **every** contractor per scope — the
> whole point is exposing all ~29k, paged server-side.

Indexes:
- **`UNIQUE (scope_key, division, eik)`** — required for `REFRESH CONCURRENTLY`
  (the 119 loader's primary path) and the natural key (finding D).
- `btree (scope_key, division, total_eur DESC, eik)` — the default-sort range
  scan (the `eik` tiebreak stops equal-valued rows swapping pages).
- `btree (scope_key, division, contract_count DESC, eik)` — the alternate sort.
- `gin (name_fold gin_trgm_ops)` — free-text name search (ILIKE fold path).

Build mechanics (mirror 119 exactly, finding D): create **`WITH NO DATA`**; drive
the fan-out `FROM procurement_scopes s JOIN contracts c ON c.date >=
COALESCE(s.date_from,'') AND c.date < COALESCE(s.date_to,'9999-99-99') AND c.tag
IN ('contract','award') AND c.contractor_eik <> ''` (no inline date-windowing —
`all`/`ns:`/`y:` are just `procurement_scopes` rows with different bounds).
`total_eur` is `SUM(amount_eur) FILTER (WHERE tag='contract')` (contracts.amount_eur
is `double precision`), with `ROUND` on both the emitted value and the sort key +
`eik` tiebreak (031 determinism rule). `name` = `COALESCE(tr_companies.name,
MIN(contractor_name))`; `name_fold = translit_bg_latin(name)`; `is_mp_tied` from
`company_politicians` (`kind='mp'`); `division` guarded `left(cpv,2)` where
`cpv ~ '^\d{2}$'`.

Estimated size: contractors × active-windows × (divisions-per-contractor + 1 ALL
row) ≈ ~0.5–1.5M rows. Still trivial for PG (the settlement fan-out proves the
shape at 10k). Confirm refresh time fits the scopes-loader budget.

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

> **AUDIT FIX (finding F) — build it `FROM contractor_rank`, not from a re-called
> function.** Aggregate `contractor_rank WHERE division='ALL'` GROUP BY
> `scope_key` (`top10_share` via `row_number() OVER (PARTITION BY scope_key ORDER
> BY total_eur DESC) <= 10`). Filtering to `division='ALL'` avoids double-counting
> the rollup rows. Because it reads the already-materialized `contractor_rank`
> (not a `STABLE` function referenced N times), it sidesteps the 119
> `AS MATERIALIZED` inlining trap — but it introduces a **refresh-order
> dependency**: `contractor_scope_kpis` must be refreshed AFTER `contractor_rank`
> (order them that way in `SCOPED_MATVIEWS`).

Served by a tiny bespoke route `/api/db/contractor-scope-kpis?scope=<key>` (one
indexed lookup) — mirrors how the overview blobs are served.

### Loader wiring (rides the existing scope loader)

`scripts/db/load_procurement_scopes_pg.ts` applies 119 and REFRESHes the scoped
matviews by iterating `SCOPED_MATVIEWS` (`= ["procurement_settlement_rank",
"procurement_geo_payloads"]`). Wiring (finding D/F):
- Add the `contractor_rank` + `contractor_scope_kpis` DDL to the migration file
  read at the `SCOPED` apply step (both `WITH NO DATA`).
- Append **`contractor_rank` then `contractor_scope_kpis`** to `SCOPED_MATVIEWS`
  (order matters — KPIs read the rank matview). The loader's REFRESH helper
  already does `REFRESH … CONCURRENTLY` with a narrowed `0A000` fallback to plain
  REFRESH for the first (unpopulated) run — the `UNIQUE (scope_key, division,
  eik)` index is what makes CONCURRENTLY legal thereafter.
- Also add the guarded re-REFRESH to `scripts/db/load_pg.ts` (next to the
  settlement-cache REFRESH at `load_pg.ts:520`) so a contracts reload cannot
  serve a stale leaderboard.

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

Corrected for the engine's real capabilities (findings A–C, verified against
`functions/db_table.js`):

```js
contractor_rankings: {
  base: "contractor_rank",
  scopeCols: ["scope_key"],
  defaultScope: { col: "scope_key", val: "all" },
  columns: {
    id: { type: "int" },                                  // select[0] tiebreak
    eik: { type: "text", filter: "eq" },
    // AUDIT FIX B: searchFold is a BOOLEAN; the physical fold column is named
    // by searchCol. `searchFold:"name_fold"` (a string) silently seq-scans the
    // raw Cyrillic column and matches almost nothing.
    name: { type: "text", sort: true, search: true,
            searchCol: "name_fold", searchFold: true },
    total_eur: { type: "number", sort: true, filter: "range", agg: "sum" },
    contract_count: { type: "number", sort: true, filter: "range" },
    award_count: { type: "number" },
    is_mp_tied: { type: "bool", filter: "eq" },           // verified: matches is_cancelled
    division: { type: "text", filter: "eq" },             // CPV rollup dim; screen always sends it
    total_other: { type: "json" },                        // display-only; see finding C
  },
  select: ["id","eik","name","total_eur","contract_count","award_count",
           "is_mp_tied","total_other"],                   // mp_ids dropped (finding C)
  defaultSort: [["total_eur","desc"],["eik","asc"]],
  aggregates: [{ fn: "count" }, { fn: "sum", col: "total_eur" }],
  maxPageSize: 1000,   // export ceiling, like procurement_settlements
}
```

Notes:
- `scope_key` and `division` must also appear as `columns` keys even though
  `scope_key` isn't projected — the engine rejects any client-addressed column
  not in the whitelist (`scope_key: { type: "text" }`).
- `total_other` (finding C): the `select` projection is type-blind and passes a
  jsonb value straight through as a JS object, but **there is no existing
  precedent** for a jsonb display column in the registry. Keep it display-only
  (never sort/filter/facet it — the facet `<> ''` guard and the `select[0]`
  tiebreaker both assume a scalar), and add a projection round-trip test. If it
  proves fragile, flatten the native remainder to a `total_other_text` column in
  the matview instead.

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

> **AUDIT NOTE (finding J) — KPI reactivity is split, on purpose.** KPI #1 (Σ€)
> is reactive (table aggregates via `onData`); KPIs #2–3 are **window-fixed**
> (the `contractor_scope_kpis` blob is keyed by `scope_key` only, not by the
> active `division`/MP filter). This matches the exemplar `ContractsAnalysisStrip`,
> whose integrity facets are deliberately pinned to the window, not the user
> filters. So when a CPV or MP-tied filter is active, #2–3 must carry a caption
> like *"за целия обхват"* ("for the whole scope") so they don't read as stale.
> The base i18n keys `procurement_scope_all` / `procurement_scope_year` already
> exist for the scope caption line and can be reused.

---

## Filters (toolbar) + URL contract

Keep everything in the documented `?pscope` + procurement-filter URL contract:

- **Single-division CPV picker** (`?cpv`) → the screen sends `{ id: "division",
  value: cpvSel ?? "ALL" }` as an `extraFilter`. **NOT** the multi-select
  `CpvFilterCombobox** — the `'ALL'`-rollup design (finding A) requires a single
  division so the leaderboard isn't double-counted. Use a single Radix `Select`
  (label each division via `121_cpv_catalog`), or a single-select variant of the
  combobox. Validate `?cpv` on read against the known divisions; unknown → `ALL`.
- **MpTiedToggle** (`?mp`) — new small toggle (clone `SingleBidderToggle`) →
  `{ id: "is_mp_tied", value: true }` (verified: `filter:"eq"` on a bool works).
- **`?q`** — free-text name search, seeds `initialSearch` (combined-search
  "see all" deep links land here, like `/procurement/contracts?q=`).
- **Clear filters** button gated on `hasActiveFilters`.

`useUrlProcurementFilters` doesn't own `?mp` or a single-division `?cpv`; add a
small local `useUrlContractorFilters` hook (same validate-on-read + stable-empty
-identity discipline, so `extraFilters` identity changes don't spuriously reset
pagination). Add `?mp` + this page's single-division `?cpv` + `?q` to the
CLAUDE.md URL-contract section. `?pscope` is already shared/documented.

### Two regressions the migration must not silently cause

- **Export (finding G).** The current client `DataTable` ships CSV/JSON/PDF
  export (`src/ux/data_table/DataTable.tsx`, `exportToCsv`/`exportToJSON`/
  `exportToPDF`). `DbDataTable` ships **no** exporter. Its props were designed to
  allow one (`initialSearch` + `pageSize` let an external button re-issue the
  same query at a larger page), but nothing renders it. Decide: (a) add a
  "download" affordance that re-issues at `maxPageSize` (1000), or (b) accept the
  loss. Recommend (a) — export is a real operator affordance on the current page.
- **Rank `#` column (finding H).** Preservable: `DbDataTable` exposes
  `pagination` in the table state, so a cell can compute `pageIndex*pageSize +
  row.index + 1` exactly like the current screen. Note it's a within-page ordinal
  reflecting the current sort — correct for a leaderboard.

### i18n (finding I)

Base keys exist (`procurement_index_top_contractors`, `procurement_index_col_*`,
`procurement_index_mp_tag`). New keys needed in **both** `src/locales/en` and
`src/locales/bg`: the three KPI labels + hints (Обща стойност / Концентрация —
топ-10 дял / Свързани с депутати), the "за целия обхват" caption, the division
picker label, and the MP-tied toggle label.

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
  filtered by `scope_key` + `division` = **index range scan, LIMIT 25** ≈ few ms.
  Covered by the `(scope_key, division, total_eur DESC, eik)` index; the engine's
  **OFFSET-0 search fence** (`db_table.js`) handles the free-text case so a name
  search doesn't walk the ordered index.
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
- `EXPLAIN ANALYZE` a name search (`?q=софарма`) with the OFFSET-0 wrap → GIN
  trigram scan on `name_fold` first, then sort+limit (confirms finding B is fixed
  — the fold column is actually hit).
- `EXPLAIN ANALYZE` a CPV filter (`scope_key='all' AND division='45'`, sort
  `total_eur DESC`, LIMIT 25) → index range scan on the composite index.
- Time the matview REFRESH (both `contractor_rank` and the dependent
  `contractor_scope_kpis`); confirm it fits the existing scopes-loader budget.

---

## Tiers

- **T1 — chrome only (ships value immediately, no backend):** add
  `<ProcurementSectionHeader current="procurement_index_top_contractors"
  scopeMode="toggle" />` and switch `useTopContractors()` to the scope-windowed
  `useProcurementRankings(from,to)` so `?pscope` works against the *existing*
  route. Still capped 1,000 & client-side, but breadcrumb + scope land now.
- **T2 — backend:** migration 122 — `contractor_rank` (fan-out by `(scope_key,
  division)` with the `'ALL'` rollup, `WITH NO DATA`, `UNIQUE (scope_key,
  division, eik)` + composite sort + `name_fold` GIN trgm indexes) and
  `contractor_scope_kpis` (`FROM contractor_rank WHERE division='ALL'`); wire both
  into `SCOPED_MATVIEWS` (rank before kpis) + the `load_pg.ts` guarded re-REFRESH;
  registry entry; EXPLAIN gate; `*.data.test.ts` regression (row-count +
  join-key + money-type + `total_other` projection round-trip, per the
  persons-browse lesson).
- **T3 — frontend swap:** `DbDataTable resource="contractor_rankings"`, 3-KPI
  strip, single-division CPV picker + MP-tied toggle, rank column, export
  affordance, `?q`/`?mp`/`?cpv` via `useUrlContractorFilters`, aggregates footer.
- **T4 — docs/memory:** CLAUDE.md scopes paragraph + URL contract; watch-skill
  reload list; new memory pointer.

## Open decisions (confirm before T2)

1. **Scope of the swap** — DECIDED: full T2+T3 (full 29k set, server-side). T1
   (breadcrumb + scope on the existing capped blob) remains the fallback if we
   need chrome shipped before the backend lands.
2. **CPV filter** — RESOLVED by audit finding A: the engine can't do array
   overlap, so it's a single-division `filter:"eq"` on a `(scope_key, division)`
   rollup matview with an `'ALL'` sentinel. Confirm we're OK with **single**
   division select in v1 (multi-select would double-count) — else drop CPV to v2.
3. **Export (finding G)** — add a download affordance to the DbDataTable page
   (re-issue at `maxPageSize`) or accept losing CSV/JSON/PDF? Recommend add.
4. **Risk at contractor level** (worst/avg `risk_grade` column + filter) —
   defer to v2 or fold into 122 now?
5. **KPI count** — the 3 chosen are locked; `single_bid_share` sits in the KPI
   blob unused (v2 column candidate).

## Audit trail (v1 → v1.1)

Full engine/migration audit run against the codebase before implementation.
Corrections applied above, keyed by finding: **A** (CPV can't be a `text[]`
overlap → `(scope_key, division)` rollup with `'ALL'` sentinel + single-select),
**B** (`searchFold` is boolean; needs `searchCol:"name_fold"`), **C** (`mp_ids`
dropped; `total_other` display-only + tested), **D** (`WITH NO DATA` + UNIQUE
index for CONCURRENTLY + `0A000` fallback + `SCOPED_MATVIEWS`), **E** (no
per-scope LIMIT), **F** (KPIs built `FROM contractor_rank`, refreshed after it),
**G** (export regression), **H** (rank column preservable), **I** (new i18n
keys), **J** (window-fixed KPIs need a scope caption). Only findings #2 (bool
`filter:"eq"`) and #5 (client `scope` overrides `defaultScope`) confirmed the
original plan as-written.
