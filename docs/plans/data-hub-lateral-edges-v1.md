# Data hub v1 — lateral edges, `/data` as a navigation hub, `/db` curation

Status: **research plan**, not yet implemented. Drafted 2026-08-03.

Follows [cross-linking-strategy-v1.md](cross-linking-strategy-v1.md), whose closing
recommendation was: *"add lateral `dataset ↔ dataset` edges to `/data/map`, labelled by the
join column."* This plan takes that to an implementable design, and folds in two adjacent
asks: making `/data` a real navigation hub, and cleaning up the `/db` console.

Everything below marked **measured** was run against local Postgres and the committed
manifest on 2026-08-03. The three measurements in §1 are the ones that decide the design.

---

## 0. Scope

| Tier | Deliverable |
|---|---|
| **T1** | Lateral `dataset ↔ dataset` edges on the data map, labelled by join key, weighted by measured overlap |
| **T2** | `/data` as a navigation hub — a browsable dataset directory, not just a canvas |
| **T3** | `/db` — hide the 48 non-data relations, and replace the 10 sample queries with a purpose-organised library |

T1 and T3 are independent. T2 depends on T1 only for the "what links to what" surface;
it can ship without it.

---

## 1. Three measurements that decide the design

### 1.1 Lateral edges CANNOT go into the ELK layout graph — measured

The manifest's positions come from one ELK `layered` + `partitioning` run in
[build_manifest.ts:344](../../scripts/data_map/build_manifest.ts#L344). Partitioning is what
makes the three tiers read as three vertical lanes. I added 15 representative lateral edges
to that graph and re-ran the layout:

```
[baseline]        273ms   extent 1602x3048
  source   distinct x: 12
  dataset  distinct x: 602
  feature  distinct x: 1362

[+15 lateral]    1147ms   extent 3192x3038
  source   distinct x: 12
  dataset  distinct x: 542, 1142, 1492, 1842, 2192     <-- five columns
  feature  distinct x: 2952
```

The dataset tier shatters from **one column into five**, total width **+99%** (1602 → 3192),
layout time **4.2×**. ELK routes an intra-partition edge by promoting one endpoint into a new
layer — which is exactly the lane metaphor the map is built on. `buildTiers()` would then
draw a dataset frame ~1,900px wide around a lane that no longer exists.

**Consequence, and it is the load-bearing decision in this plan:** lateral edges are a
*separate manifest array*, never an ELK input. Layout stays byte-identical to today.

```ts
// DataMapManifest
edges: { id, from, to }[];              // unchanged — lineage, drives ELK
links: {                                 // NEW — lateral, never sent to ELK
  id: string;
  a: string; b: string;                  // both `ds:*`, sorted (undirected)
  key: JoinKey;                          // "eik" | "person_id" | "ekatte" | "time" | "party"
  label: Lang;                           // the join COLUMN, e.g. "ЕИК" / "EIK"
  overlap?: number;                      // measured; absent when unmeasurable
  note?: Lang;                           // one line: what the join answers
}[];
```

Two more things fall out of that array being separate, both of which would otherwise be
silent regressions:

- **`validate()` rejects it anyway.** [build_manifest.ts:224](../../scripts/data_map/build_manifest.ts#L224)
  fails the build on any edge that is not `src:→ds:` or `ds:→f:`. A separate array needs its
  own validator (both endpoints exist, both are `ds:`, no self-link, no duplicate pair) rather
  than a loosened `tierOk` — loosening it would also let a genuine lineage typo through.
- **`dataMapClosure()` must not walk them.** [useDataMap.ts:148](../../src/data/dataMap/useDataMap.ts#L148)
  is an unweighted BFS over all edges in both directions. Feed it lateral links and selecting
  `ds:procurement` lights up ~half the graph — the closure highlight stops meaning "where this
  data comes from and goes". Lateral neighbours get their own single-hop set, rendered as a
  *different* visual state (see §2.3).

### 1.2 Handles — lateral edges have nowhere to attach

[DataMapNodeCard.tsx:83](../../src/screens/components/datamap/DataMapNodeCard.tsx#L83) declares
exactly two handles: `target` Left, `source` Right. Two dataset nodes in the same column are
vertically stacked, so a Right→Left lateral edge exits the right side, wraps back around, and
crosses every card between them.

Lateral links need **Top/Bottom handles** on dataset cards (`id="lat-t"` / `id="lat-b"`,
`isConnectable={false}`), with the edge picking top-vs-bottom by sign of `Δy`. Adding handles
to a React Flow node is additive — existing edges keep using the default Left/Right pair.

### 1.3 The map is wider than Postgres — so links must be curated, not derived

Of the 32 dataset nodes, roughly a third have no Postgres representation at all
(`ds:elections`, `ds:polls`, `ds:macro`, `ds:budget`, `ds:demographics`, `ds:culture`,
`ds:local`, `ds:geo`, the four `ds:*` budget annex nodes …) — they are JSON trees under
`data/`. A generator that derived links from `pg_catalog` FK/column analysis would cover the
money half of the corpus and silently omit the elections half, which is precisely the half the
"one linked corpus" argument needs.

So: **links are declared in `model.ts`** (like `EDGES`), each naming its join key. Where both
endpoints are PG-backed, the build *measures* the overlap and stamps it on the link. Where
they are not, the link ships without `overlap` and the UI omits the count rather than
inventing one.

**Measured overlaps** (distinct keys present on both sides, local PG, 2026-08-03):

| Link | Key | Overlap |
|---|---|---|
| `ds:funds` ↔ `ds:ngo` (`fund_beneficiaries` × `tr_companies`) | `eik` | 40,228 |
| `ds:ngo` ↔ `ds:connections` (`ngo_details` × `tr_companies`) | `eik` | 12,256 |
| `ds:procurement` ↔ `ds:connections` (`contracts` × `tr_companies`) | `eik` | 18,654 |
| `ds:procurement` ↔ `ds:funds` | `eik` | 5,685 |
| `ds:procurement` ↔ `ds:indicators` (awarder × `schools`) | `eik` | 916 |
| `ds:funds` ↔ `ds:ngo` (beneficiary × NGO) | `eik` | 323 |
| `ds:procurement` ↔ `ds:parliament` (`company_politicians`) | `eik` | 336 |
| `ds:procurement` ↔ `ds:water` (awarder × operators) | `eik` | 38 |
| `ds:procurement` ↔ `ds:prices` (contractor × retail chains) | `eik` | 24 |
| `ds:procurement` ↔ `ds:funds` (seated settlements) | `ekatte` | 897 |
| `ds:procurement` ↔ `ds:prices` (seats × stores) | `ekatte` | 203 |
| `ds:prices` ↔ `ds:funds` | `ekatte` | 242 |

And the `person_id` spine — people holding a role in **both** sources, top pairs:

```
candidate × tr        6,124     candidate × mp          2,120
local × official_muni 4,028     official_exec × tr      2,015
local × tr            3,779     local × ngo             1,849
candidate × ngo       2,730     candidate × official_muni 1,447
candidate × local     2,511     official_muni × tr      1,006
ngo × tr              2,132     ngo × official_exec       911
```

**One measurement earns the `overlap` field on its own.** `declaration_asset.ekatte` — a
declared place key on 258,723 rows — is **100% NULL**: 0 distinct values, 0 join to
`place_dim`. A curated link list with no measurement would have shipped
`ds:officials ↔ ds:geo · ЕКАТТЕ` as a confident claim about a join that returns nothing. The
build should therefore **fail** on a link whose declared key measures 0 overlap, the same way
it already fails on an unmapped AI data path.

---

## 2. T1 — lateral edges on the map

### 2.1 Model (`scripts/data_map/model.ts`)

```ts
export type JoinKey = "eik" | "person_id" | "ekatte" | "time" | "party";

export interface LinkDef {
  a: string; b: string;                  // dataset ids, no `ds:` prefix
  key: JoinKey;
  note: Lang;                            // "кой изпълнител е получил и евросредства"
  /** Both sides in PG → the build measures and stamps `overlap`. */
  measure?: { left: string; right: string };  // "contracts.contractor_eik" etc.
}
export const LINKS: LinkDef[] = [ /* ~25–30 */ ];
```

Target **25–30 links**, not 100. The map's job is to make the corpus legible; a complete
join graph over 32 datasets is a hairball. Selection rule: a link earns a place if it is
either already exploited by a shipped feature, or is one of the cross-linking-strategy
opportunities. Each is one line of `note` explaining what the join *answers*.

### 2.2 Build (`scripts/data_map/build_manifest.ts`)

1. `validateLinks()` — endpoints exist and are datasets, `a < b` normalised, no duplicate
   pair, no self-link, `key` in the enum.
2. `measureLinks()` — for links with `measure`, run one `SELECT count(*)` per pair over
   `SELECT DISTINCT` CTEs. **Postgres-optional**: the build already runs in `prebuild` on
   machines with no database. When PG is unreachable, reuse the `overlap` already in the
   committed `data/data_map.json` and log that it was carried forward; only a *new* link with
   no prior value and no database is an error. This keeps the churn-free write in
   [build_manifest.ts:436](../../scripts/data_map/build_manifest.ts#L436) honest — otherwise
   every no-PG build would rewrite the file with the overlaps stripped.
3. Fail on a measured `overlap` of 0 (the `declaration_asset.ekatte` class).
4. Emit `links` into the manifest. **Do not add them to the ELK graph** (§1.1).
5. Bump `version` to 2 and add `links: m.links ?? []` to the coercion in
   [useDataMap.ts:134](../../src/data/dataMap/useDataMap.ts#L134) — a returning visitor with a
   cached v1 manifest and a fresh bundle must not crash.

### 2.3 Render

- **Default state:** lateral links hidden. Showing 30 extra edges over a portrait graph by
  default would make the map *less* legible, which inverts the point.
- **A fourth lens.** The lens row already exists (`none | cadence | origin | fresh`). Add
  `links` — it draws every lateral link at low opacity, colour-coded by join key, with a
  legend naming the five keys. This is the "one linked corpus" screenshot.
- **On selection**, always: a selected dataset shows *its* lateral neighbours regardless of
  lens, drawn dashed + in the key colour, distinct from the solid animated lineage closure.
  Neighbours get a third node status between `hot` and `dim` (`linked`) — the existing
  `NodeStatus` union is `base | selected | hot | dim`.
- **Edge labels**: React Flow renders labels on edges natively, but 30 of them is noise.
  Label on hover/selection only; the persistent affordance is the key colour + legend.
- **Panel** ([DataMapPanel.tsx](../../src/screens/components/datamap/DataMapPanel.tsx)): a new
  "Свързва се с" / "Links to" section under the sources list — one row per lateral neighbour:
  key chip, dataset name (clickable → selects it), overlap count, `note`. On a dataset with no
  links, omit the section entirely rather than showing an empty state.
- A sixth **tour** ("Как се свързват данните") walking 4–5 hops along lateral links —
  `TOURS` already exists and is the cheapest way to make the feature discoverable.

### 2.4 Tests

- `build_manifest` gate: every `LINKS` endpoint resolves; no measured-0 links; `links` absent
  from the ELK input (assert the ELK edge count equals `EDGES.length + aiEdges.length`).
- A layout-stability test: the manifest's node positions before/after the change are
  identical. This is the regression §1.1 exists to prevent, and it is invisible to every
  other check.
- `dataMapClosure` unchanged-behaviour test: passing `links` in does not widen the closure.

---

## 3. T2 — `/data` as a navigation hub

### 3.1 Where the hub lives — a decision with an SEO constraint

`/data/map` **already 301s to `/data`** ([routes.tsx:1378](../../src/routes.tsx#L1378)) — the
map was moved to `/data` when `/data` became the hub's landing view. Moving the map back to
`/data/map` means deleting that redirect and re-pointing links that have been canonical since
the move; `tests/seo.spec.ts` gates that no declared canonical/`og:url`/`hreflang` redirects,
and CLAUDE.md records what a site-wide canonical-vs-redirect mismatch cost last time.

**Recommendation: keep the map at `/data` and build the hub above it on the same page.**
`/data` becomes: hero + join-key summary → dataset directory → the map (unchanged, below the
fold) → the sources/updates pills. No redirect churn, no new canonical, and the map stops
being the *only* way to navigate the corpus without ceasing to be the centrepiece.

The alternative (hub at `/data`, map at `/data/map`) is cleaner information architecture and
worth doing if we accept a redirect flip — but it is a separate decision, and it should be
made explicitly rather than as a side effect of this work.

### 3.2 What the hub adds

The manifest already carries everything needed; nothing new is fetched.

1. **Dataset directory** — the 32 datasets as cards grouped by the existing `views` tags
   (elections / parliament / public money / local / indicators / prices). Each card: label,
   `detail`, freshness dot, source count, feature links (`route`), lateral-link count, and a
   "open on the map" link (`/data?node=ds:x` — the deep link already works).
2. **Join-key strip** — five chips (ЕИК · person_id · ЕКАТТЕ · време/кабинет · партия), each
   with the measured scale from §1.3 and the datasets it spans. This is the corpus's actual
   argument, and today it is stated nowhere on the site.
3. **Corpus counters** — datasets / sources / features / lateral links, from the manifest.
4. **Entry points** — the existing DataNav pills, plus `/db` (today reachable only from the
   footer) and the download/bucket links currently buried on `/data/sources`.

`DataNav` stays as the sub-navigation; the hub is what `active="map"` renders above it.

### 3.3 SEO

`/data` is already prerendered. Adding the directory puts ~32 internal links with real anchor
text on a page that currently ships a canvas and almost no crawlable text — directly relevant
to `project_seo_discovery_gap`. Keep the directory in the server-rendered HTML (plain
`<Link>`s, not canvas-derived), or the gain is zero.

---

## 4. T3 — `/db` cleanup and a purpose-organised query library

### 4.1 The listing problem, measured

`readSchema` in [functions/sql_lib.js:11](../../functions/sql_lib.js#L11) selects every
`relkind IN ('r','v','m')` in `public` with no filter. Local Postgres today:

| Bucket | Count | Examples |
|---|---:|---|
| scratch / backup / temp | 5 | `_pp_bak`, `_pwy_before`, `tmp_all_slugs`, `tmp_rank_slugs`, `price_stage` |
| extension views | 2 | `pg_stat_statements`, `pg_stat_statements_info` |
| jsonb serving blobs | 9 | `procurement_payloads`, `price_payloads`, `graph_payloads`, … |
| precompute caches | 7 | `contract_risk_cache` (408k), `procurement_normalcy_cache` (405k), … |
| ingest / identity plumbing | 13 | `ingest_first_seen` (**17.2M rows**), `person_slug_lock`, `meta`, … |
| helper matviews | 3 | `officer_name_counts`, `owner_name_counts`, `company_officer_counts` |
| risk internals (views) | 6 | `risk_contract_base`, `risk_cpv_median`, … |
| search indexes | 3 | `contractor_search`, `awarder_search`, `person_search` |
| **real data** | **115** | `contracts`, `tenders`, `person`, `tr_companies`, … |

**48 of 163 relations are not data.** The first two entries a visitor sees today are
`_pp_bak` and `_pwy_before` — visible in the screenshot that prompted this work.

### 4.2 The trap: do not filter on row count

**26 of the 115 real relations are empty on local Postgres** — including all 13 `nzok_*`
tables, `agri_subsidies`, `ngo_funding`, `transport_facility_geo`, and 10 views (which report
`reltuples = -1` and are indistinguishable from empty in the current schema query). These are
real, populated datasets on Cloud SQL; the local database simply has not loaded them. A
"hide empty tables" rule would hide the health pack and the farm subsidies **on prod only if
prod ever lagged**, and hides them on every developer's machine today — the exact
green-locally / wrong-on-prod class this repo keeps getting bitten by.

> *(Corrected 2026-08-03: these "empty" readings were themselves `n_live_tup` artifacts —
> nearly all of the named relations are populated locally by `count(*)`; see §6.4a. The
> conclusion is unchanged and strengthened: an estimate-based "hide empty" rule would have
> hidden POPULATED tables.)*

**Filter by curated classification, never by row count.**

### 4.3 Design

A single shared registry — `functions/db_catalog.js`, imported by both `sql_lib.js` **and**
[vite/sql-browser.ts](../../vite/sql-browser.ts), which today carries a near-verbatim copy of
`readSchema` under a "keep the two in sync" comment. One copy, or dev and prod will drift.

```js
// visibility: "data" | "derived" | "internal"
//   data     — a real dataset, shown by default
//   derived  — precomputes, search indexes, serving blobs: shown under "Show derived"
//   internal — scratch, plumbing, extension views: never listed
```

Classification is **rule-first, exception-second**: a handful of regexes (`^_`, `^tmp_`,
`_payloads$`, `_cache$`, `^risk_`, `^pg_stat_statements`, `_name_counts$`, `_search$`) plus a
named list for the 13 plumbing tables that no pattern catches. Rules over a 163-name allowlist,
because a hand-maintained allowlist means every new loader ships a table that is invisible
until someone remembers to add it — the same failure mode as `SCOPED_MATVIEWS`.

**Exhaustiveness gate.** A new relation matching no rule and no exception defaults to
`data` (visible — fail open, so a new dataset is never silently hidden), and a
`node --test` case in `functions/` asserts the catalog classifies every relation the schema
query returns. That test needs a live database, so it follows the `*.data.test.ts` convention:
skip when Postgres is down.

Grouping in the sidebar follows the map's own tags (procurement / persons / registry /
prices / places / sectors) rather than alphabetical — 115 alphabetical names is a list, not a
browser.

**Note what this is not.** Hiding a relation from the *listing* does not block querying it.
`app_readonly` holds `SELECT` on everything ([roles_readonly.sql](../../scripts/db/schema/pg/roles_readonly.sql)),
and that should stay: the console's contract is "read anything, but be shown what matters".
Making the listing the security boundary would be a false one.

### 4.4 Query library by purpose

`SAMPLES` today is 10 queries in 4 groups (Contracts / Tenders / Registry / Search), rendered
as one flat pill row — [SqlBrowserScreen.tsx:72](../../src/screens/dev/SqlBrowserScreen.tsx#L72).
Its own comment already asks each new table to contribute a sample; that has not held, and 115
data relations are now represented by 10 queries.

Restructure to **purpose → question → SQL**:

| Purpose | Sample questions |
|---|---|
| Public money — who receives it | top contractors; all-corpora recipients via `company_public_money`; MP-tied contractors |
| Public money — who spends it | top awarders; spend by oblast via `awarder_seats`; budget vs contracted |
| Risk & competition | single-bidder share by buyer; `risk_grade` distribution; annex value inflation; upheld КЗК appeals |
| People & roles | a person's roles across all 17 sources; revolving door (`person_role.institution` → `contracts.awarder`); declared vs public money |
| Companies & ownership | ownership chain; co-ownership neighbours via `graph_edge`; founding date vs first contract |
| Places | money per capita by settlement; price basket vs oblast pension; awarder seats |
| Elections | party vote share by oblast; councillors by party; mayor party × money |
| Data quality / meta | freshness by dataset via `recent_updates`; row counts; coverage holes |

Each entry: a title, a **one-line "what this answers"**, and SQL carrying a leading comment
naming the join key and any trap (the `estimated_value_eur` forecast-vs-actual caveat already
in the tenders sample is the model). Group them in a collapsible left rail or a
`DropdownMenu`, not a growing pill row — 40 pills is worse than 10.

**The link back to T1.** Every query in the "Purpose" library exercises exactly one of the
five join keys. Tag each with its `JoinKey` and the two `ds:*` it joins, and:

- `/db` can show "this query walks the ЕИК link between Procurement and EU funds";
- the map's lateral-link panel row can carry a "run this query" deep link into `/db?q=…`.

That makes the map's claim ("these two datasets join on ЕИК") *executable* in one click, which
is the difference between a diagram and a product. It also gives the query library the
extensibility contract `SAMPLES` lacks: a link with no query, or a query naming a link that
does not exist, fails the build.

### 4.5 Smaller `/db` fixes worth folding in

- **Views report `rowCount: 0`** ([sql_lib.js:84](../../functions/sql_lib.js#L84)) — shown as
  "0" beside every view, indistinguishable from an empty table. Render `—` for views.
- **`/db` is reachable only from the footer.** It belongs in the T2 hub (§3.2.4).
- Row counts are `n_live_tup` estimates — label them as approximate.

---

## 5. Sequencing

| Step | Depends on | Notes |
|---|---|---|
| 1. `db_catalog.js` + schema filter + dev/prod de-duplication | — | Ships value immediately; nothing else needed |
| 2. Query library by purpose | 1 | Independent of the map |
| 3. `LINKS` model + build validation + measurement | — | Generator-only, no UI |
| 4. Manifest `links` + `version: 2` + client coercion | 3 | |
| 5. Handles, `links` lens, `linked` node status, panel section | 4 | |
| 6. Tour + query deep-links | 2, 5 | The join that makes both halves one feature |
| 7. `/data` hub | 4 | Reads `links` for counts; ships without 5 |

Steps 1–2 and 3–5 are two independent tracks.

---

## 6. `/db` console audit — measured findings

Everything here was run on 2026-08-03 against local Postgres and the LIVE
`https://electionsbg.com/api/sql/*` endpoints.

### 6.1 🔴 LIVE OUTAGE, unrelated to this plan but found by it

Four matviews the person layer serves from **do not exist on Cloud SQL**:

```
person_browse_table  officials_rankings_table  mp_assets_rankings_table  person_cohort_wealth
```

Consequence, verified against prod:

```
GET /api/db/table?q={"resource":"persons","limit":2}             → 500 {"error":"db error"}
GET /api/db/table?q={"resource":"officials_rankings","limit":2}  → 500 {"error":"db error"}
SELECT count(*) FROM person_browse_table  → relation "person_browse_table" does not exist
```

`/persons` and the officials rankings are down on production. This is exactly the
cloud-loader gap CLAUDE.md documents — `db:load:persons-browse:pg:cloud` and
`db:load:declarations:pg:cloud -- --resolve` were never run against Cloud SQL. **Fix this
independently of this plan; it should not wait on any of it.**

It is worth noting *how* it was found: by diffing the `/db` schema listing between local and
prod. Nothing else on the site reports it. A `/db` that listed only real data relations, with
a local-vs-prod parity view, would have surfaced it the day it happened — which is an argument
for T3 beyond tidiness.

Related drift in the same diff: prod carries `risk_upheld_ocid` (view) where local carries
`upheld_ocids` (matview); `_pp_bak` exists only locally.

### 6.2 🔴 `recent_updates()` — the timeout in the screenshot

`SELECT * FROM recent_updates(1, 100);` is sample #10 and fails on prod **and locally**:

```
   8009ms  Search / Recent updates   FAIL: canceling statement due to statement timeout
```

Root cause, from `EXPLAIN (ANALYZE, BUFFERS)`:

```
->  Index Scan using ingest_first_seen_pkey on ingest_first_seen fs
      Index Cond: (source = d_1.source)
      Filter: (d_1.day = (first_seen_at)::date)
      Rows Removed by Filter: 102195        (per loop, x 201 loops)
      Buffers: shared hit=10,863,669 read=2,870,088
```

`d.day = fs.first_seen_at::date` is **not sargable**. The planner joins `changelog_days`
(201 rows) to `ingest_first_seen` (**17.2M rows**) on the PK's leading `source` column alone
and applies the day as a post-filter — 13.7M buffers for a query that returns 104 rows. The
same non-sargable shape appears in the `contract_first_seen` branch.

**This is not `/db`-only.** `functions/db_routes.js:2010` (`/api/db/recent`, the `/data/updates`
feed) calls the same function; it survives only because its default window is narrower.

**Partial fix, measured but NOT sufficient.** Rewriting the day join as a half-open range
(`fs.first_seen_at >= d.day AND fs.first_seen_at < d.day + 1`) takes the isolated branch from
13.7M buffers to **10.2K (1,347× fewer)**, same 102 rows. But applied inside the full function
the 8s timeout **persists** — re-running the audit after applying it produced the identical
failure, and the plan still shows the `ingest_first_seen_pkey` scan with 102,195 rows removed
per loop. So the join rewrite alone does not survive inlining into the eight-branch `UNION ALL`
+ `ORDER BY … LIMIT`. Implementation must treat this as a query-shape problem (probably: push
the cutoff into each branch as a literal rather than a `CROSS JOIN cutoff` CTE, or materialise
the day set), and **re-measure end-to-end via the function, not the branch** — measuring the
branch in isolation is what made a non-fix look like a 1,347× win.

The reverted experiment is not in the tree; the numbers above are what it produced.

### 6.3 🟡 `recent_updates` ordering is plan-dependent

`ORDER BY changed_at DESC` carries **no tiebreak**, and 2,020,921 rows in `ingest_first_seen`
share a single microsecond timestamp (`2026-07-08 00:50:51.990468+00`; the next two are 1.53M
and 1.27M). Repeated identical calls are stable, but the 544-of-1000 row reshuffle observed when
the plan changed shows *which* 1,000 of 2M tied rows you get is arbitrary. Add a deterministic
tiebreak (`, kind, id`) — the row set was verified identical across the plan change (0 rows
differed by set comparison), so this is a stability fix, not a correctness one.

### 6.4 The listing problem — measured on BOTH databases

| Bucket | local | prod |
|---|---:|---:|
| scratch / backup / temp | 5 | 4 |
| extension views | 2 | 2 |
| jsonb serving blobs | 9 | 9 |
| precompute caches | 7 | 7 |
| ingest / identity plumbing | 13 | 13 |
| helper matviews | 3 | 2 |
| risk internals (views) | 6 | 7 |
| search indexes | 3 | 3 |
| **real data** | **115** | **111** |
| **total listed today** | **163** | **158** |

**47 of 158 relations on prod are not data.** And they are not empty — on prod
`_pwy_before` = 33,026 rows, `tmp_all_slugs` = 20,887, `tmp_rank_slugs` = 14,496,
`ingest_first_seen` = 17,199,204. `_pwy_before` is the first entry a visitor sees.

**The row-count trap is confirmed on both sides.** 26 relations *read* 0 (`n_live_tup`) on
local and 25 on prod — but *different ones*, and most of the local "0"s are estimate
artifacts over populated tables (§6.4a). Views report `reltuples = -1` → rendered as `0` today,
indistinguishable from empty. **Classify by curated rule, never by row count** (§4.2) — and
see §6.4a, which shows the trap is worse than "local hasn't loaded them yet".

### 6.4a The `db:refresh` defect is real — but the "26 empty relations" number was an artifact

> **CORRECTED 2026-08-03** — see `docs/plans/db-refresh-loader-gaps-v1.md` §0, which supersedes
> this section's classification table. The original table classified relations by
> `pg_stat_user_tables.n_live_tup`, the exact column consequence 1 below warns is stale. Re-read
> with `count(*)`, every relation the table attributed to a **missing load** is populated locally
> except `nzok_pathway_tariffs` (0 on both databases) — the four empty-by-design staging tables
> remain empty, as designed: `agri_subsidies` = 2,481,857 (= prod exactly),
> `agri_payloads` = 16,711 (= prod), `ngo_funding` = 3,179 (= prod), and the whole `nzok_*` family
> is loaded. `transport_facility_geo` holds 11 rows locally vs 0 on prod — the reverse of the
> original claim. The rule that survives: **a relation's population is `count(*)`; `n_live_tup`
> reads 0 until autovacuum analyzes, and no audit may classify on it.**

The repo defect itself stands, verified from `package.json` rather than row counts:
**`db:refresh` — the documented "full reload: schema + every loader" — omits 12 of the 38 local
loaders.**

```
db:load:nzok-activities:pg      db:load:nzok-drug-prices:pg     db:load:nzok-drug-quarterly:pg
db:load:nzok-financials:pg      db:load:nzok-hospital:pg        db:load:nzok-hospital-map:pg
db:load:nzok-tariffs:pg         db:load:ngo-funding:pg          db:load:tr:pg
db:load:cr-founding:pg          db:load:company-founded:pg      db:load:ngo-board-links
```

So the honest framing is not "26 datasets are missing locally" — it is: **the refresh command does
not do what it says, local↔prod parity is maintained by hand, and nothing detects when it lapses.**
Also verified (code facts, unaffected by the correction): agri has no `db:load:agri:pg` /
`:cloud` (`agri:ingest` combines fetch+load); `nzok_pathway_tariffs` was never ingested anywhere;
`data/ngo/foreign_grants.json` is absent and its `ned` source has never produced a row on prod
either; `transport_facility_geo` has zero code references.

Consequences that survive the correction:

1. **`/db` row counts are `n_live_tup` and go stale immediately.** After loading 258 rows into
   `nzok_hospital_geo`, `pg_stat_user_tables.n_live_tup` still read **0** while `count(*)` read
   **258**. So "0" in the console means *nothing* until autovacuum catches up. Either render a
   real `count(*)` for small relations, or label the number as an estimate and never let the UI
   act on it. (A "hide empty tables" rule keyed on `n_live_tup` would hide populated tables —
   curated rule, definitely.)
2. **The repo fixes are planned and tracked in `db-refresh-loader-gaps-v1.md`**: the omitted
   loaders join `db:refresh` or an explicit documented exclusion list (with a regression gate),
   and agri gets a `db:load:agri:pg` + `:cloud` pair so it stops being the one dataset that
   cannot be reloaded the way every other one is. One trap that plan documents: several of the
   omitted loaders read **gitignored** inputs and throw on absence, so adding them to the
   `&&`-chained refresh naively would abort a cold clone — present-on-this-machine ≠ committed.

> The local database was left with the nzok hospital tables populated — that moves local
> *toward* prod parity, so it was not reverted.

### 6.5 The query library already exists as SQL functions

Local Postgres exposes **221 callable functions** in `public`. `/db` surfaces **three** of them
(`search_companies`, `search_all`, `recent_updates`). The site's real "structured queries by
purpose" are already written and already performance-tuned:

```
awarder_group_model(eiks[], from, to)      awarder_kindex_top(limit)
awarder_risk_grade_top(scope, limit, min)  company_procurement(eik, from, to)
company_buyer_relationships(eik)           company_person_path(eik, name, depth)
contractor_ranks_windowed(from, to)        dual_corpus_rankings()
declaration_new_filings(limit)             fund_beneficiary_detail(eik)
kzk_recent_appeals(limit)                  magistrate_politician_links(norm, depth)
nzok_casemix_expected_vs_actual(eik)       nzok_drug_risk_by_inn()
connection_between(a, b)                   awarder_seat_place(eik)                 …
```

The library should be **built from these**, not hand-written. A function call is one line, is
already indexed, already carries the site's own definitions, and cannot drift from what the
pages serve. Hand-written joins are the right shape only where no function exists.

Companion source: the 17 `functions/db_table.js` resources (`contracts`, `tenders`,
`fund_projects`, `persons`, `contractor_rankings`, `kzk_appeals`, `agri_subsidies`, …) name the
exact base relation + filters behind every server-side browser on the site.

### 6.6 UI findings

- **Sample rendering does not scale.** `SAMPLES` is 10 entries in 4 groups rendered as one flat
  pill row (`SqlBrowserScreen.tsx:659`). At 40+ entries this is unusable — hence the ask to move
  to grouped selects. Use the shared Radix `Select` (`src/components/ui/select.tsx`), never a
  native `<select>`, per the project convention.
- **No URL state.** `useSearchParams` is not used anywhere in the screen (0 occurrences): a
  query cannot be linked, shared, or bookmarked. This is a hard blocker for the T1 ↔ T3 join in
  §4.4 (`/db?q=…` deep links from the map's lateral-link panel) and should be added with the
  library.
- **Views show `rowCount: 0`** (`sql_lib.js:84`) — render `—`, not `0`.
- **Row counts are `n_live_tup` estimates** presented as exact figures; label them approximate.
- **`toCsv` escapes `[",\n]` but not `\r`** — a cell containing CRLF breaks the row.
- **`download()` revokes the object URL synchronously after `a.click()`**, which can race the
  download in some browsers.
- `/db` is linked only from `src/layout/Footer.tsx:34` — it belongs in the T2 hub.

### 6.7 Sample timings (local; Cloud SQL `db-g1-small` is materially slower)

```
  889ms Top contractors      446ms Top awarders         4ms Single-bidder
    3ms Biggest tenders      640ms Forecast vs actual    5ms Name search
 1181ms Contractors x TR    289ms Contractor -> TR      24ms Unified search
 8009ms Recent updates  ← FAILS
```

`Contractors × TR officers` (1.18s) and `Forecast vs actual` (0.64s) are the next candidates to
exceed the 8s prod budget. Every new library entry needs a measured local timing, and the
library should carry a rough cost marker so a visitor knows before running.

---

## 7. README — measured

`README.md` is **550,683 bytes over 608 lines**. Section breakdown:

| Section | lines | bytes | share |
|---|---:|---:|---:|
| Data flow | 105 | 245,412 | **45%** |
| Maintenance skills | 38 | 112,772 | 21% |
| **Data sources** | **105** | **73,449** | **13%** |
| What's in here | 37 | 63,578 | 12% |
| Data pipeline | 66 | 32,950 | 6% |
| everything else | 257 | 22,522 | 4% |

The "Data sources" section is 9,296 words across 7 sub-headings. Removing it takes the README
from 550KB to **477KB — still enormous**. If the goal is a readable README, `## Data flow`
(45%) is the bigger target and is not covered by this ask; worth a separate call.

**The section is doing two different jobs, and only one of them belongs on `/data`.** Its
longest entries are not source lists at all — they are implementation notes:

```
11,264 bytes   Per-município capital programmes (26 municipalities, per-muni parser notes)
 8,769 bytes   Council resolutions + vote tallies (5 tally regex variants, PDF layouts, OCR)
 5,650 bytes   ИВСС magistrate declarations
 2,774 bytes   ВСС court statistics
```

The council-minutes bullet alone documents parser regexes, per-município file-path layouts,
Gemini OCR cost per session, and roster-match rates. **`/data` must not carry that** — it is
contributor documentation, and the source nodes' `desc` fields are deliberately reader-facing.

Recommended split, rather than a straight delete:
1. **Citations + links** (the actual source list) → already on `/data/sources`; replace with a
   pointer.
2. **Ingest implementation notes** → move to `docs/ingest/<family>.md`, or to the relevant
   `.claude/skills/update-*/SKILL.md`, which is where a contributor is already reading.
3. Keep in README only: the pointer to `/data`, `/data/sources`, `/data/updates`, and the
   "adding a new source" contract already in `## Contributing`.

A straight delete would lose (2) with no home. Verify before removing that each long bullet's
content exists in a skill file — spot-checking the council-minutes and capital-programmes
bullets suggests it does not.

---

## 8. Watcher / `/data` coverage audit — measured

### 8.1 What is already guaranteed

- **Every watcher source is on the map.** `build_manifest.ts` `validate()` fails the build on
  any `scripts/watch/sources` id not placed in a `SOURCE_GROUP`, and on any id placed twice.
  105 source modules → 39 source groups. ✅
- **Every `update-*` skill is on the map.** Cross-checking `.claude/skills/update-*` against
  the union of `SOURCE_GROUPS[].skills`: **0 skills missing from the map, 0 map skills without a
  skill directory.** ✅
- The `process-watch-report` mapping table (182 rows) references one skill that does not exist
  as a directory, `update-nzok-revenue` — likely shorthand for `update-nzok --revenue`, worth
  confirming. `update-census` is the only `update-*` skill absent from that table.

### 8.2 🟡 Freshness is attributed at source-GROUP grain, so it is wrong in the large groups

The runtime freshness overlay (`DataMapScreen.tsx:102`) maps `data-changes.json` entries to
nodes via `node.skills[]`. Because a group's skills are a **union**, any one skill running marks
the whole group — and therefore lights its entire lineage closure.

```
src:egov          8 datasets,  9 sources, 6 skills
                  [update-procurement, update-connections, update-budget,
                   update-indicators, update-schools, update-air-quality]
src:ministries    4 datasets, 22 sources, 5 skills
                  [update-budget, update-noi, update-nzok, update-macro,
                   update-municipal-contacts]
```

So an `update-schools` run marks **Water (ВиК)** and **Non-profit organisations** as freshly
updated, and an `update-nzok` run marks **Pensions (NSSI)**. The map cannot express "schools
refreshed, procurement did not". Fix direction: attribute freshness per *source*, not per
group — the per-source `cadence`/`freshness` is already carried in `ManifestSourceRef`, so the
data exists; only the node-level rollup discards it.

### 8.3 🟡 Eight source groups can never show runtime freshness

Groups with an empty `skills[]` — their freshness can only come from the build-time watcher
state, never from `data-changes.json`:

```
src:water   src:ec_fts   src:eu_policy_anchors   src:bg_fiscal_anchors
src:oil_bulletin   src:security   src:transport   src:geo
```

Two of those — **`src:water` and `src:geo`** — additionally have **no watcher members at all**
(only static `extras`), so they can never show freshness by any route.

### 8.4 🔴 Real datasets with no dataset node

`validate()` only requires a source to be in *some* group; it never checks that the group's
outgoing dataset edges have anything to do with that source. `src:egov` is the catch-all where
this bites:

| Watcher source | Group | Dataset it should feed |
|---|---|---|
| `iaos_air_quality` | `src:egov` | **none — there is no `ds:air`** |
| `indicators_mon_dzi` / `indicators_mon_nvo` / `mon_ri_register` | `src:egov` | folded into `ds:indicators` |
| `eurostat_tourism` | `src:eurostat` | **none — no `ds:tourism`** |
| `eurostat_env` | `src:eurostat` | **none — no `ds:environment`** |
| `nsi_landuse` | `src:nsi` | folded into `ds:indicators` / `ds:demographics` |
| `customs_revenue` / `customs_excise_register` | `src:ministries` | folded into `ds:budget` |

Air quality has a watcher, a skill (`update-air-quality`), committed data (`data/air/`) and a
product surface — and **no dataset node**, so `/data` cannot show it at all. Same for tourism
and environment.

Related mislabelling: **`ds:indicators` is labelled "Regional indicators" but its representative
path is `data/schools/index.json`** — it is silently absorbing the education corpus, the
land-use corpus and the MON registers.

**Proposed gate**, and it is the missing half of the extensibility contract: extend
`validate()` so that every `update-*` skill must reach **at least one dataset node** whose tags
overlap the skill's own domain, and add an explicit `datasets: string[]` to `SourceGroupDef`
members so a source declares *which* dataset it feeds rather than inheriting the whole group's
fan-out. Without that, "every source is on the map" stays technically true and practically
misleading.

---

## 9. Open decisions

1. **Hub URL** (§3.1) — recommendation is to keep the map at `/data` and build the hub above
   it, avoiding a redirect flip on a page whose `/data/map` → `/data` 301 is already live.
   Moving the map to `/data/map` is better IA and needs an explicit call.
2. **Link count** — 25–30 curated, or every measurable pair? Recommendation: curated. The
   argument is legibility, and a complete join graph over 32 nodes is unreadable.
3. **Directed or undirected links.** Modelled undirected above (`a < b`). `person_id`
   revolving-door links have a natural time direction; if we want the map to express that,
   `LinkDef` needs a `direction` field and the renderer an arrowhead.
4. **Should a measured 0-overlap link fail the build or ship greyed as "declared, no data"?**
   Recommendation: fail — a live map claiming a join that returns nothing is worse than a red
   build. But `declaration_asset.ekatte` shows the greyed variant is genuinely informative
   about ingest gaps, and that is a real product surface (§4.4, "Data quality").
