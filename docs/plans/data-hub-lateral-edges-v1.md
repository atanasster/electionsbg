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
| **T0** | Add the `ds:interreg` node the corpus has been missing, so T1 has an endpoint to attach to (§10.1) |
| **T1** | Lateral `dataset ↔ dataset` edges on the data map, labelled by join key, weighted by measured overlap |
| **T2** | `/data` as a navigation hub — a browsable dataset directory, not just a canvas |
| **T3** | `/db` — hide the ~47 non-data relations, and replace the 10 sample queries with a purpose-organised library |
| **T4** | **EGN-hash person key** — make the `person_id` spine EXACT for TR company attribution, then retire the three stale GCS shard families it made obsolete (§11.1–§11.7) |
| **T5** | Retire the `connections*` family — 5,429 tracked files / 49.9 MB + a gitignored 78 MB frozen serving copy, all replaced by the PG graph engine months ago (§11.8) |

T0 is a prerequisite for three of T1's links and is worth shipping on its own regardless: the
current `src:keep_eu → ds:funds` edge makes a false claim about the corpus today (§8.4).
T1 and T3 are independent. T2 depends on T1 only for the "what links to what" surface;
it can ship without it.

T5 depends on nothing in this plan — its replacement shipped in `a8f07765d8` — and it is the
largest single cleanup in the repo by bytes. It rides here so the bucket-exclusion gate is
written once for both sweeps, and because one of its members (§11.8a) is not dead weight but a
**frozen serving surface** with a live AI reader.

T4 is independent of T0–T3 and is the largest of the four. It belongs in this plan because the
`person_id` spine in §1.3 is the map's weakest link claim: it is bridged on a **name fold**, and
§11.1 measures 12.0% of TR person rows sitting under a name that belongs to more than one human.
A lateral edge labelled „едно лице" over that join overstates what the corpus knows. T4 replaces
the fold with an identity key the source already publishes.

> **§6–§12 are the evidence log**, appended as the audits were run. Where a measurement changed
> a design decision, the decision has been folded into §1–§5 above and the section cross-refs
> the finding. §10.8 records one retraction: a claim in §6.4a that reached a commit message.
> **§12 audits §11** — it found the daily-refresh flow missing, a `/db` privilege hole, and three
> errors in §11 that are corrected in place. Read §12.9 before implementing anything.

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

Of the 33 dataset nodes, roughly a third have no Postgres representation at all
(`ds:elections`, `ds:polls`, `ds:macro`, `ds:budget`, `ds:demographics`, `ds:culture`,
`ds:local`, `ds:geo`, the four `ds:*` budget annex nodes …) — they are JSON trees under
`data/`. A generator that derived links from `pg_catalog` FK/column analysis would cover the
money half of the corpus and silently omit the elections half, which is precisely the half the
"one linked corpus" argument needs.

> **Re-measure this ratio before citing it.** The counts below were taken before six PG
> families landed — `interreg_*` (137), `open_calls` (142), `fund_fit` (143), `bill` (136),
> `vote_item`/`vote_cast` (134, 16,741 / 4,017,519 rows) and `tr_company_place` (133, 324,039).
> `vote_cast` alone moves the PG-vs-JSON balance the argument rests on, and `tr_company_place`
> is a company→EKATTE spine that would change every `ekatte` overlap in the table below. The
> *conclusion* (curate, don't derive) is unaffected — it turns on the JSON-only third, which is
> still JSON-only. See §10.4.

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
| `ds:opencalls` ↔ `ds:funds` (`open_calls.code` × `fund_fit.procedure_code`) | `procedure` | **27 of 66** coded calls |
| `ds:opencalls` ↔ `ds:funds` (`open_calls.programme_code` × `fund_projects.program_code`) | `programme` | **12 of 14** — needs normalisation, see below |
| `ds:interreg` ↔ `ds:geo` (`interreg_partners.ekatte` × `place_dim`) | `ekatte` | 1,469 of 1,469 placed rows (160 places) |
| `ds:interreg` ↔ `ds:connections` (`interreg_partners` × `tr_companies`) | `eik` | 176 of 829 EIK-carrying rows |
| `ds:interreg` ↔ `ds:procurement` (partner × contractor) | `eik` | 42 of 554 distinct EIKs |

The last five are new in the second pass (§10.2, §10.6) and require **two model changes**
(§2.1): a `procedure` / `programme` join key, and a `ds:interreg` node that does not exist yet
(§10.1). The Interreg place link is 100% clean **on the rows that carry a key** — but only
1,469 of 12,141 partner rows do, so its `overlap` must be rendered against the placed subset,
never against the corpus (a §4.2-class error).

And the `person_id` spine — people holding a role in **both** sources, top pairs:

```
candidate × tr        6,124     candidate × mp          2,120
local × official_muni 4,028     official_exec × tr      2,015
local × tr            3,779     local × ngo             1,849
candidate × ngo       2,730     candidate × official_muni 1,447
candidate × local     2,511     official_muni × tr      1,006
ngo × tr              2,132     ngo × official_exec       911
```

> **Every pair above involving `tr` or `ngo` is bridged on a NAME FOLD, and §11.1 measures how
> much that costs**: 22,074 TR names (4.2%) are shared by more than one real human, covering
> 12.0% of person rows — „ГЕОРГИ ИВАНОВ ГЕОРГИЕВ" is **135 distinct people**. So `candidate × tr
> 6,124` is not 6,124 verified identities; it is 6,124 fold matches of which an unmeasured share
> are namesakes, held down by Bridge B's ≤5-company footprint rule rather than by evidence. T4
> (§11) replaces the fold with the registry's own person key and makes this row honest. Until it
> lands, the `person_id` link's `note` must say *bridged by name*, not *same person*.

**One measurement earns the `overlap` field on its own.** `declaration_asset.ekatte` — a
declared place key on 258,723 rows — is **100% NULL**: 0 distinct values, 0 join to
`place_dim`. A curated link list with no measurement would have shipped
`ds:officials ↔ ds:geo · ЕКАТТЕ` as a confident claim about a join that returns nothing.

**But "fail on 0 overlap" is the wrong rule, and the second pass proved it.**
`open_calls.programme_code` × `fund_projects.program_code` also measures **0** — not because
the link is false, but because ИСУН's awarded corpus prefixes the 4-digit period
(`2021BG16RFPR001`) while the open-calls crawl does not (`BG16FFPR002`). Strip the prefix and
it is **12 of 14**. A blanket 0-overlap failure would have rejected a real link and taught the
next author to delete it (§10.3).

So the build must separate two different zeroes:

| Shape | Diagnosis | Build behaviour |
|---|---|---|
| Key column absent, or 100% NULL on either side | **Dead link** — the join cannot exist (`declaration_asset.ekatte`) | **Fail** |
| Both sides populated, intersection empty | **Probable normalisation gap** (`programme_code`) | **Fail with a different message**, naming sample values from each side |

Both fail — a live map must not claim a join that returns nothing either way. What differs is
the message, because the fixes are opposite: the first means *remove the link or fix the
ingest*, the second means *declare a normaliser*. Hence `LinkDef.normalise` in §2.1: the rule
is not "allow 0", it is "make the two zeroes distinguishable so the author fixes the right
thing".

---

## 2. T1 — lateral edges on the map

### 2.1 Model (`scripts/data_map/model.ts`)

```ts
export type JoinKey =
  | "eik" | "person_id" | "ekatte" | "time" | "party"
  | "procedure" | "programme"            // NEW — open_calls ↔ funds (§10.2)
  | "person_key";                        // NEW — exact TR person identity (§11)

export interface LinkDef {
  a: string; b: string;                  // dataset ids, no `ds:` prefix
  note: Lang;                            // "кой изпълнител е получил и евросредства"

  /** How the two datasets relate. Default "join". */
  kind?: "join" | "boundary";

  /** Required when kind is "join" (the default). Absent for "boundary". */
  key?: JoinKey;

  /** Both sides in PG → the build measures and stamps `overlap`. */
  measure?: {
    left: string; right: string;         // "contracts.contractor_eik" etc.
    /** SQL applied to BOTH sides before comparing. See §1.3's two-zeroes rule. */
    normalise?: string;                  // e.g. "regexp_replace($1,'^[0-9]{4}','')"
    /** Denominator for the rendered ratio when the key is sparse (§10.6). */
    of?: string;                         // "rows carrying an EKATTE", not the corpus
  };
}
export const LINKS: LinkDef[] = [ /* ~25–30 */ ];
```

Three additions over the first pass, each forced by a measurement:

- **`normalise`** — `programme_code` measures 0 only because of a period prefix (§10.3).
  Without it the honest options are "ship a link the build says is dead" or "drop a real link".
- **`of`** — Interreg's place link resolves 1,469 of 1,469 *placed* rows, but only 12.1% of
  partnerships carry a place key at all. `overlap` beside a corpus-sized dataset name reads as
  coverage it does not have.
- **`person_key`** — `person_id` and `person_key` are deliberately two keys, not one. `person_id`
  is *our* resolution (bridged, revisable, spans all 17 people sources); `person_key` is the
  Registry Agency's own identity on the TR side only. A link rendered as `person_key` is making a
  much stronger claim than one rendered as `person_id`, and the map must not launder the second
  into the first. §11.3's rule: a link may carry `person_key` only where **both** endpoints are
  TR-derived — anything crossing into declarations, CIK or the officials roster is `person_id`,
  however good the anchor.
- **`kind: "boundary"`** — the one relation on this map that is real and is **not** a join.
  `ds:interreg` ↔ `ds:funds` share no key by construction: Interreg runs on Jems, ИСУН's
  `fund_projects` holds zero Interreg rows, and the two are never summed because an ИСУН figure
  is a contract's value and an Interreg figure one partner's budget (§10.1). A boundary link
  renders differently (no key chip, no overlap count) and its `note` states the separation —
  *"cross-border money, published separately; never add the two totals"*. Modelling it as a
  join with `overlap: 0` would say the opposite of the truth.

Target **25–30 links**, not 100. The map's job is to make the corpus legible; a complete
join graph over 33 datasets is a hairball. Selection rule: a link earns a place if it is
either already exploited by a shipped feature, or is one of the cross-linking-strategy
opportunities. Each is one line of `note` explaining what the join *answers*.

**Prerequisite: `ds:interreg` does not exist yet** (§10.1). Adding the node — edged from the
already-correct `src:keep_eu` — is T1 step zero, not a follow-up: until it lands, the corpus
is folded into `ds:funds` and three of the links above have no endpoint to attach to.

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
3. Fail on a measured `overlap` of 0 — with **two distinct messages** (§1.3): *dead link* when
   the key is absent or 100% NULL on either side, *normalisation gap* when both sides are
   populated but disjoint, the latter printing sample values from each side so the author can
   write the `normalise` expression. `kind: "boundary"` links are skipped by this step entirely
   — they declare no key to measure.
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
- **The two-zeroes gate discriminates.** Assert a fixture with a 100%-NULL key reports *dead
  link*, and one with populated-but-disjoint sides reports *normalisation gap* — then assert
  the `programme_code` pair passes **only** with its `normalise` applied. Without that last
  step the test is satisfied by any rule that happens to accept everything, which is exactly
  how the original blanket rule looked correct (§10.3).
- **A `kind: "boundary"` link ships no `key` and no `overlap`**, and the renderer omits both.
  Assert it, because the failure mode is silent: a boundary link that acquires an `overlap: 0`
  through a default renders as "these two datasets share nothing", when the truth is "these
  two must never be added together" (§10.1).
- **Sparse-key links render against their declared `of` denominator**, not the dataset's row
  count — assert the Interreg place link reports 1,469, never 12,141 (§10.6).
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
| People & roles | a person's roles across all 17 sources; revolving door (`person_role.institution` → `contracts.awarder`); declared vs public money; **how many real people share a name** (`person_name_ambiguity`, §11.4) |
| Companies & ownership | ownership chain; co-ownership neighbours via `graph_edge`; founding date vs first contract |
| Places | money per capita by settlement; price basket vs oblast pension; awarder seats |
| Elections | party vote share by oblast; councillors by party; mayor party × money |
| EU money — can I apply | what is open now (`open_calls_list`); base rates for a procedure (`funds_fit_procedure`); grant median + quartiles; disbursed share |
| Cross-border (Interreg) | operations by place (`interreg_by_place`); Bulgarian partners (`interreg_by_eik`); programme overview — **never summed with ИСУН** |
| Parliament roll-call | attendance and dissent; party cohesion; voting twins (`mp_similarity`) |
| Data quality / meta | freshness by dataset via `recent_updates`; row counts; coverage holes |

The three new rows are the second pass's finding (§10.5): `grep -c "interreg\|open_calls\|fund_fit"`
over `SqlBrowserScreen.tsx` returns **0** today, while those corpora hold 1,954 operations,
12,141 partnerships, 71 open calls and 2,206 procedure rollups. Three traps the entries must
carry in their leading comment, all documented in CLAUDE.md and none discoverable from the
schema:

- **`open_calls_list`'s NULL limit means unbounded.** A library entry must pass a bound, or the
  console's row cap is the only thing between a visitor and a full scan.
- **`vote_item` needs `WHERE superseded_by IS NULL`** on every aggregate — 1,645 of 16,741 items
  are re-votes, so omitting it over-counts by 9.8% at a 200. And party affiliation lives on
  `vote_cast.party_id` (affiliation at cast time), not `mp_seat.party_id`.
- **`paid_project_count` is disbursement, not approval.** ИСУН publishes no rejected
  applications, so no approval rate is computable; any entry implying one makes a claim the
  corpus cannot support.

Each entry: a title, a **one-line "what this answers"**, and SQL carrying a leading comment
naming the join key and any trap (the `estimated_value_eur` forecast-vs-actual caveat already
in the tenders sample is the model). Group them in a collapsible left rail or a
`DropdownMenu`, not a growing pill row — 40 pills is worse than 10.

**The link back to T1.** Every query in the "Purpose" library exercises exactly one of the
seven join keys (§2.1 — `procedure` and `programme` were added in the second pass). Tag each
with its `JoinKey` and the two `ds:*` it joins, and:

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
| 0. `ds:interreg` node; re-point `src:keep_eu` at it | — | Corrects a false claim live today (§8.4); unblocks 3 links |
| 1. `db_catalog.js` + schema filter + dev/prod de-duplication | — | Ships value immediately; nothing else needed |
| 2. Query library by purpose | 1 | Independent of the map |
| 3. `LINKS` model + build validation + measurement | 0 | Generator-only, no UI |
| 4. Manifest `links` + `version: 2` + client coercion | 3 | |
| 5. Handles, `links` lens, `linked` node status, panel section | 4 | |
| 6. Tour + query deep-links | 2, 5 | The join that makes both halves one feature |
| 7. `/data` hub | 4 | Reads `links` for counts; ships without 5 |
| 8. T4.1 parser — extract + re-key `Indent`; privacy gates flipped | — | §11.3; the one step that changes a standing policy — settle it before writing code |
| 9. T4.2 PG key columns + `tr_person` + indexes | 8 | §11.4 |
| 10. T4.3 anchors + `mp_tr_role` rebuilt on the key | 9 | §11.5; parity-gated against the 896 committed files |
| 11. T4.4 perf pass + buffer-ceiling gates | 10 | §11.6 — not optional; the key changes the cardinality of every person→company query |
| 12. T4.5 retire the three GCS shard families | 11 | §11.7 — **last** of the T4 chain, and only after prod is verified |
| 13. `person_key` links on the map, `person_id` notes corrected | 3, 10 | Closes the §1.3 caveat |
| 14. Migrate the 3 surviving `connections*` readers (2 AI ranking tools, `companyConnections`) | — | §11.8b 1–2; harness-verified. **Independent of T4** |
| 15. Delete the unreachable `useCompanyConnections` pair; extend `retired.test.ts` | 14 | §11.8b 3 — removes the exemption that hid it |
| 16. Resolve the `connections.json` `/data` catalogue entry | 14, and T2 if re-pointing | §11.8b 4 — a published download; **may not be silently deleted** |
| 17. Retire `connections*` + `company-connections/` from the bucket and git | 15, 16 | §11.8b 5–8; `gsutil`-verify 11.8a first |

Steps 1–2 and 0/3–5 are two independent tracks; 8–13 are a third, and it is the long one.
**14–17 are a fourth and depend on none of the others** — the graph engine that replaces those
artifacts shipped in `a8f07765d8`. They are sequenced here so the `bucket_sync_paths` gate in
step 8 of §11.8b is written once, covering both sweeps.

Steps 12 and 17 are the only steps in this plan that delete anything, and both are deliberately
last within their track.

**Two prerequisites sit outside this plan and both are cheap to get wrong by ignoring.**
Step 6's deep links need `/db` to read a query off the URL — `useSearchParams` is used **zero**
times in `SqlBrowserScreen.tsx` today (§6.6), so that is net-new work inside step 2, not a
free consequence of it. And the `/db` samples cannot be trusted as library seeds until
`recent_updates()` is fixed (§6.2) — it is shipped as sample #10 and fails on both databases.

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
| `keep_eu_interreg` | `src:keep_eu` | **none — no `ds:interreg`**; folded into `ds:funds` |

Air quality has a watcher, a skill (`update-air-quality`), committed data (`data/air/`) and a
product surface — and **no dataset node**, so `/data` cannot show it at all. Same for tourism
and environment.

**Interreg is the worst instance, and unlike the others the fold is actively wrong** rather
than merely coarse. `src:keep_eu` edges into `ds:funds`, presenting the Jems corpus as part of
ИСУН — two corpora that share no rows, are never summed, and whose serving layer ships a basis
declaration inside every payload precisely to stop a consumer merging them (§10.1). The other
rows in this table under-describe; this one asserts something false.

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

---

## 10. Second-pass gap audit — evidence (2026-08-03)

Re-audited after the corpus grew. Everything below is measured against local Postgres, and the
map file as it stands now (100 nodes: 33 datasets, 41 sources, 163 edges).

**These gaps are now folded into the design above** — this section is the evidence, kept
because the numbers are what justify the decisions and the next author should be able to
re-run them. Where each finding landed:

| Finding | Folded into |
|---|---|
| §10.1 Interreg has no dataset node, and the `ds:funds` fold is false | §0 (new T0), §2.1 `kind: "boundary"`, §8.4 |
| §10.2 `ds:opencalls` has no lateral edges | §1.3 table, §2.1 `procedure`/`programme` keys |
| §10.3 A 0-overlap measurement is not proof of no join | §1.3 two-zeroes rule, §2.1 `normalise`, §2.2 step 3, §2.4 |
| §10.4 The §1.3 baseline predates six PG families | §1.3 re-measure note |
| §10.5 No `/db` samples for any new corpus | §4.4 (three new purpose rows + their traps) |
| §10.6 Interreg's edges are real but sparse | §1.3 table, §2.1 `of` denominator, §2.4 |
| §10.7 §8 is stale in the reader's favour | left in place; §8.1's guarantees still hold |
| §10.8 §6.4a retraction | §0 pointer; §6.4a carries the correction |

### 10.1 🔴 Interreg is in the database and on the map as a SOURCE, but has no dataset node

```
interreg_operations   1,954      interreg_partners  12,141      interreg_programmes  22
```

`src:keep_eu` exists and carries the right watchers (`keep_eu_interreg`, `interreg_calls`), and
`update-funds` covers the ingest legs (15 references). But its only outgoing edge is:

```
src:keep_eu  ->  ds:funds   "EU funds"
```

**That fold is the one thing the corpus documentation forbids.** Interreg runs on Jems, not
ИСУН, so `fund_projects` holds **zero** Interreg rows — a system boundary, not a filter. The two
arms are never summed (an ИСУН figure is a contract's own value, an Interreg figure one
partner's published budget), and `funds_fit_basis()` returns the basis declaration *inside the
payload* specifically so a consumer cannot render one arm as the whole corpus. The map presents
them as one dataset, which is exactly the claim the serving layer is built to prevent.

Compounding it: Interreg money lands almost entirely on **border** municipalities, so a reader
on the border sees `ds:funds` and is told, in effect, that the ИСУН corpus is what exists there.

**Recommendation:** a `ds:interreg` node, edged from `src:keep_eu`, with a lateral link to
`ds:funds` labelled with the basis difference rather than a shared join key. This is the case
the lateral-edge feature exists for — two corpora that are related and must not be merged.

### 10.2 🔴 `ds:opencalls` has a node and zero lateral edges — including the most valuable one

`ds:opencalls` / `src:opencalls` exist (good — added since §8 was written). But §1.3's
measured-overlap table has **12 links and not one touches it**. Two real joins, measured:

| Candidate link | Key | Measured |
|---|---|---|
| `ds:opencalls` ↔ `ds:funds` (`open_calls.code` × `fund_fit.procedure_code`) | procedure code | **27 of 66** coded calls match exactly |
| `ds:opencalls` ↔ `ds:funds` (`open_calls.programme_code` × `fund_projects.program_code`) | programme code | **0 of 14** exact — **12 of 14** after normalisation (below) |

The first is the highest-value edge available on this map for the funds audience, and it needs
no normalisation. It connects **"this call is open now"** to **"here is what happened to
everyone who applied to this exact procedure before"** — `fund_fit` carries beneficiary count,
grant median + quartiles, org-form mix and disbursed share per procedure. That is the measured
demand (`can I get money`), not the supply-side question (`who got it`) the rest of the funds
tree answers.

### 10.3 🟡 The programme join is hidden by an encoding mismatch, not absent

```
open_calls.programme_code     BG16FFPR002    BG05SFPR001    SP2023
fund_projects.program_code    2021BG16RFPR001    2014BG05M9OP001    2021BG-RRP
```

ИСУН's awarded corpus prefixes the 4-digit period; the open-calls crawl does not.
`regexp_replace(program_code,'^[0-9]{4}','')` lifts the match from **0/14 to 12/14**.

This is worth stating as a rule, because it generalises past this pair: **a 0-overlap
measurement is not proof that no join exists.** §1.3 proposes failing the build on a declared
link that measures 0 overlap — correct for `declaration_asset.ekatte` (genuinely 100% NULL
across 258,723 rows), but it would also have rejected this real link. The build should
distinguish *"key absent/NULL on one side"* (a true dead link) from *"both sides populated, no
intersection"* (a probable normalisation gap), and report the second differently.

### 10.4 🟡 The §1.3 baseline predates six PG families

None of these existed when the overlap table was measured, and none appear in it:

```
interreg_* (137)   open_calls (142)   fund_fit (143)   bill (136)
vote_item / vote_cast (134, 16,741 items / 4,017,519 casts)
tr_company_place (133, 324,039)   procurement_annexes (114, 24,135)
```

`tr_company_place` matters most to this plan's own thesis: it is a company→EKATTE crosswalk at
324k rows, i.e. a **place spine** joining the registry to every place-keyed dataset. §1.3's
`ekatte` links (897 / 242 / 203) were measured without it. `vote_cast` at 4M rows changes the
"map is wider than Postgres" ratio the section's whole argument rests on — re-measure before
citing "roughly a third".

### 10.5 🟡 The query library (§4.4) and `/db` samples have nothing for any of it

`grep -c "interreg|open_calls|fund_fit" src/screens/dev/SqlBrowserScreen.tsx` → **0**. The
serving functions already exist and are the natural library entries:

```
funds_fit_procedure(code)   funds_fit_interreg(...)   funds_wire()   funds_news()
open_calls_list(status, kind, audience, q, limit)     interreg_by_place / _by_eik
interreg_overview / interreg_operation / search_interreg_operations
```

Note `open_calls_list`'s **NULL limit means unbounded** — a library entry must show a bound, or
the console's row cap becomes the only thing between a visitor and a full scan.

### 10.6 Interreg's own lateral edges, measured

| Link | Key | Measured |
|---|---|---|
| `ds:interreg` ↔ `ds:connections` (`interreg_partners` × `tr_companies`) | `eik` | 176 of 829 EIK-carrying rows |
| `ds:interreg` ↔ `ds:procurement` (partner × contractor) | `eik` | 42 of 554 distinct EIKs |
| `ds:interreg` ↔ `ds:geo` (`interreg_partners.ekatte` × `place_dim`) | `ekatte` | 1,469 of 1,469 resolve (160 distinct places) |

The place link is **100% clean on the rows that carry a key** — but only 1,469 of 12,141
partner rows carry one (12.1%), because keep.eu publishes no structured place and the loader
resolves via `awarder_seats` / `tr_company_place`. A link labelled "12,141 partnerships" beside
a place edge would be a §4.2-class error: the honest denominator is the placed subset, and the
UI must show which.

### 10.7 §8 is stale in the reader's favour

The map has moved from 39 to 41 source groups since §8 was measured. `src:opencalls` and
`src:keep_eu` were added, `update-open-calls` and `enrich-open-calls` are both in
`process-watch-report`'s mapping, and `interreg_calls` / `isun_procedures` / `sp2023_indicative`
are all placed. So §8.1's guarantees still hold and coverage is *better* than §8 describes.

What survives unchanged, re-verified against the current file:

- **§8.2** — `src:egov` still fans 9 sources → 6 skills → 8 datasets; `src:ministries` 23 → 5.
  Freshness is still attributed at group grain, so `update-schools` still marks Water (ВиК).
- **§8.3** — still exactly 8 groups with no skills. Note two of them (`src:ec_fts`,
  `src:oil_bulletin`) carry `skills: null` rather than `[]`; the other six carry `[]`. Worth
  normalising, since consumers must currently handle both.
- **§8.4** — `ds:air`, `ds:tourism`, `ds:environment`, `ds:landuse` still have no dataset node.

### 10.8 Correction to §6.4a, recorded here because it changed a committed claim

§6.4a's classification table was built on `pg_stat_user_tables.n_live_tup` and was wrong; the
`db-refresh-loader-gaps-v1.md` T0 pass retracted it, and re-measurement with `count(*)`
confirms that retraction: `agri_subsidies` = 2,481,857, `agri_payloads` = 16,711,
`ngo_funding` = 3,179, the `nzok_*` family loaded, `nzok_pathway_tariffs` = 410 (not 0),
`transport_facility_geo` = 11 locally vs 0 on prod.

The "proof" offered for the omitted-loader claim — running `db:load:nzok-hospital:pg` and
watching 0 → 17,391 — was a **reload of already-populated data** read through a stale
statistic, not a first population. Commit `b5c0847408`'s message asserts it and is wrong on
that point.

What survives is the code fact, which never depended on row counts: **`db:refresh` calls 26 of
38 loaders**, agri has no `db:load:agri:pg`, `data/ngo/foreign_grants.json` is absent, and
`transport_facility_geo` has zero code references. The rule to carry forward: **population is
`count(*)`; `n_live_tup` is an estimate that reads 0 until autovacuum analyzes, and no audit —
and no UI — may classify on it.**

---

## 11. T4 — EGN-hash person key for TR attribution · T5 — retiring the stale GCS trees
### (evidence + design, 2026-08-11)

> ## ⚠️ §11.3–§11.5 ARE SUPERSEDED — shipped differently, and better (2026-08-12)
>
> [tr-attribution-basis-v1.md](tr-attribution-basis-v1.md) shipped this work as its §2 while
> this section was being written. **The measurements in §11.1–§11.2 stand and were confirmed
> independently.** The DESIGN in §11.3–§11.5 did not survive contact, and the difference is not
> a matter of taste:
>
> **1. It persists a COUNT, not a key.** `scripts/declarations/tr/count_registry_people.ts`
> digests each `Indent` with a **per-run** salt at read time, counts distinct digests per name
> fold in memory, and writes only the integer to `data/person/tr_name_fold_people.tsv`
> (456,398 folds, 23,174 shared). No hash, no cluster id, no pseudonymous column — so §11.3's
> HMAC re-key, its secret provisioning, its `dist/` grep gate and §12.6 are all **moot**, and
> the four privacy gates are untouched rather than "changed in shape". That is a strictly
> better posture than the one §11.3 recommended.
>
> **2. §11.4's anchor design is REFUTED, on a measured case.** I claimed one declared-stake
> anchor could split a footprint. Their §2.2 checks it: the `Indent` on „Иван Георгиев Такучев"
> in a 2022 filing is byte-identical to the one in a 2025 filing, so the registry's key does
> say the two Plovdiv companies are one person — **and nothing bridges that person to the
> public figure**, because no officials, declarations or CACBG source carries an EGN or its
> hash. The registry→public-figure bridge stays a name match whatever we do. Their conclusion
> is the correct one and I had it backwards: *"the right use of it is refusal — it tells you
> when to stop attributing, not who to attribute to."* So there is no identity/candidate/
> **EVICTED** triple; there is `people_n = 1` → attribute, anything else → refuse.
>
> **3. Most of §11.5 already exists under other names.** `person_name_ambiguity` shipped as
> `tr_name_fold_people` (migration 148 + `db:load:tr-name-fold-people:pg`); `person_egn_anchor`
> is not built and must not be — which also retires **§12.3's `/db` privilege hole**, since
> there is no key and no anchor table to enumerate. §12.2's "15 GB backfill the daily flip
> cannot produce" is real but already solved: `npm run tr:count-people` scans the whole feed in
> **5.6 s** and commits a ~14 MB artifact every other machine reads.
>
> **What remains live in §11:** §11.1/§11.2's measurements, §11.6's perf work, §11.7/§11.8's
> retirement, §12.1's watcher wiring (still required — see §11.10), §12.4's three corrections,
> §12.5's column-population point (now about `fold_people_n`, not `person_key`), and §12.7's
> AI-harness re-run. `person_key` as a `JoinKey` in §2.1 is **withdrawn**: no such key is
> persisted, so no link can carry it. §11.10 records what the shipped work leaves undone.

Everything in §11.1–§11.2 was measured against `raw_data/tr/daily/` (1,666 day files, the whole
2021-01-01→ window), `raw_data/tr/state.sqlite`, `raw_data/tr/cr_deeds.sqlite` and local
Postgres.

### 11.1 🔴 The TR feed publishes a stable person identity, and we throw it away

Every `Person` subject in the daily filings feed carries an `Indent` element with a sibling
`IndentType` discriminator, at
`/Message/Body/Deeds/Deed/SubDeed/{Managers,Partners,…}/Person`:

```json
{"Indent": [{"_": "ec0917d7e1c6439cd9eff865513fcfc23bd1aa71322dfc145946b99c02b47c49"}],
 "Name":   [{"_": "СТАНИСЛАВА ГЕОРГИЕВА КРЪСТЕВА"}],
 "IndentType": [{"_": "EGN"}], "CountryName": [{"_": "БЪЛГАРИЯ"}]}
```

64 hex = SHA-256. `IndentType` over 25 sampled days (28,449 person nodes):
**EGN 22,540 · BirthDate 2,855 · UIC 2,028 · Undefined 690 · LNCH 336** — so the type must be
read, not assumed: a `UIC` indent is a corporate officer and an `LNCH`/`BirthDate` indent is a
foreign person, and neither is an EGN hash.

**It is stable across filings and across years, which is the property that makes it usable.**
Over 25 days spanning 2022-05 and 2024-03, of 6,457 names appearing more than once only **84**
carried more than one hash — and those are the namesakes, which is the discrimination we want.
It is a person key, not a per-filing nonce.

**Full-feed measurement — 1,666 days, 1,468,207 EGN-typed person rows (23 s):**

| | |
|---|---|
| distinct names | 528,895 |
| **distinct people (hashes)** | **483,642** |
| names shared by >1 real human | **22,074 (4.2% of names)** |
| **person rows sitting under such a name** | **176,774 — 12.0%** |

Worst offenders, in real humans per name:

```
ГЕОРГИ ИВАНОВ ГЕОРГИЕВ   135      ИВАН ГЕОРГИЕВ ИВАНОВ      88
ДИМИТЪР ИВАНОВ ДИМИТРОВ  105      ГЕОРГИ ДИМИТРОВ ГЕОРГИЕВ  88
ДИМИТЪР ГЕОРГИЕВ ДИМИТРОВ 102     ПЕТЪР ИВАНОВ ПЕТРОВ       69
ИВАН ДИМИТРОВ ИВАНОВ      96      ГЕОРГИ ИВАНОВ ИВАНОВ      69
```

**The top row is not a hypothetical — it is the case that already shipped a defect.**
`c97af171c7` ("TR name matches: stop letting one corroborated company certify 319 namesakes")
was about mpId 5113, „Георги Иванов Георгиев", whose bare name matched 320 TR officer rows and
whose page attributed 319 unrelated companies across the country to him. The feed says that name
belongs to **135 different people**. The fix we shipped was the name-frequency guard, which
*suppresses* the whole medium set for a common name; the hash *resolves* it. The guard's cost is
recall nobody has measured — it is deleting real roles alongside the false ones, and it cannot
tell which is which.

**MP exposure:** 98 of the 896 MPs with an `mp-management` file (11%) carry a name shared by more
than one real human. Those MPs hold **527 of 3,023 roles, 420 of them `medium`**.

### 11.2 🟡 Coverage ceiling — the hash is in the daily feed ONLY

The CR Deeds full-capture API (`raw_data/tr/cr_deeds.sqlite`, the `project_cr_deeds.ts` source)
returns an `htmlData`-shaped payload with **no `Indent` at all** — sampled 40 deeds at
`http_status = 200`, zero hits, and no `IndentType` either.

`company_persons` provenance: **1,276,304 rows `daily` (95.2%) · 64,492 rows `cr` (4.8%)**.

So ~4.8% of person rows can never carry a key and must stay on the name-fold path indefinitely.
Two consequences the design has to carry rather than hide:

- **The fold path does not get deleted, it gets demoted.** Any surface that answers "who is this
  person" needs both arms and must label which one answered — a `person_key` match is an
  identity, a fold match is a candidate.
- **A pre-2021 role that was never re-filed has no key**, even for a person whose other roles do.
  So an MP's key set is complete over the daily window and partial before it, and the "companies
  this person holds" count is a floor. Say so in the payload; do not let the UI read it as total.

### 11.3 🔴 This changes a standing, machine-enforced privacy policy — settle it first

Four gates currently assert the `Indent` never reaches an event, SQLite, a fixture, or `/public`:

| Gate | What it asserts |
|---|---|
| [parse_daily_filing.ts:134](../../scripts/declarations/tr/parse_daily_filing.ts#L134) | the parser deliberately does not extract `Indent` |
| [types.ts:55](../../scripts/declarations/tr/types.ts#L55) | the event type carries the policy note |
| [sqlite_writer.ts:41](../../scripts/declarations/tr/sqlite_writer.ts#L41) + [smoke_test.ts:249](../../scripts/declarations/tr/smoke_test.ts#L249) | `company_persons` has no `person_hash` / `egn` / `personHash` column |
| [parse_share_transfer.test.ts:55](../../scripts/declarations/tr/parse_share_transfer.test.ts#L55) | parser OUTPUT carries no `Indent` **and** the committed fixture does not either |

Implementing T4 necessarily changes the first three. That is a decision for the repo owner, not
a consequence of an infrastructure plan, so it is called out here rather than buried in a tier.

**Why the policy exists, and why it is right about the risk.** The hash is a *pseudonym*, not an
anonymisation — under GDPR it stays personal data. And the EGN keyspace is small: YYMMDD + serial
+ checksum is on the order of 10⁸ realistic living values. A stable digest over a keyspace that
size is reversible to the EGN by anyone who obtains the Registry Agency's salt or who can
enumerate against a known construction. Storing the raw TR hash would put a national-scale
person key, and a plausible path to EGNs, into a database whose whole purpose is to be widely
readable.

**The design that keeps the intent and still gets the join — never store the TR hash.**

```
person_key = HMAC-SHA256(TR_PERSON_KEY_SECRET, indent)   truncated to 128 bits
```

computed **in the parser**, at the moment of extraction; the raw `indent` is never returned, never
written, never logged. `TR_PERSON_KEY_SECRET` lives in `.env` / Secret Manager and is never
committed. Properties:

- **Joins are unaffected** — it is a deterministic function of a stable input, so equality still
  means "same person".
- **A database leak yields nothing joinable.** The values match no other holder of the TR dump,
  and an EGN brute-force needs both the Registry's salt and ours.
- **Rotatable.** Rotating the secret re-keys the corpus on the next full rebuild; a raw hash could
  never be rotated.
- **Never served.** No `/api/db` route may return `person_key`, and no `/public` artifact may
  carry it. It is a build- and serve-side surrogate id, in the same class as `person_id`.

The gates change shape rather than disappearing — and the fixture gate does not change at all:

| Gate | After T4 |
|---|---|
| fixture gate | **unchanged** — raw `Indent` still never enters the repo |
| parser gate | asserts no RAW `indent` in output; asserts `personKey` is present and is 32 hex |
| sqlite gate | asserts no `person_hash` / `egn` / `indent` column; asserts `person_key` **is** present and that every value is HMAC-shaped |
| **NEW** route gate | no `/api/db` response body and no `/public` artifact contains a `person_key`; runs over the route registry, not a sample |
| **NEW** secret gate | the build fails if `TR_PERSON_KEY_SECRET` is absent, empty, or equal to any value committed in the repo — otherwise a missing secret silently degrades to a constant salt, which is the raw hash again under another name |

### 11.4 Design — the anchor, not the salt

We cannot compute an MP's hash: we have neither their EGN nor the Registry's salt, and we should
not want either. **We do not need them.** One corroborated (person, company) pair yields the key
from the feed, and every other row carrying that key is the same human with certainty.

```
anchor:  MP declared a stake in EIK X   →   read person_key at (X, name)   →   fan out
```

Anchor sources, strongest first:

1. **Declared stake** — `declaration_stake_company` (2,147 rows). The EIK is *stated in the
   declaration*; no name matching is involved, which is what makes it an anchor rather than
   another guess.
2. The existing `high` tier's other two arms (TR seat ∈ MP region; same-party MP declared the
   same UIC) — weaker. Use to seed, then require the key to agree; a seed that disagrees with an
   established key is evidence of a namesake and is evicted, not kept.
3. A curated override file, sibling to the existing `tr_match_suppressions.json`.

The resolution pass then has three outcomes per candidate row, and the third is new and the whole
point:

| | |
|---|---|
| key matches the anchor | **identity** — publish, no confidence badge needed |
| no key (pre-2021 / `cr` row / non-EGN indent) | **fold candidate** — the current confidence model, unchanged |
| key present and ≠ anchor | **EVICT** — provably a different human |

Today's model has no third outcome. It cannot distinguish "different person" from "unproven", so
it grades both `medium` and shows them side by side.

### 11.5 Where the tables go

New objects, and what each is for:

| Object | Shape | Why |
|---|---|---|
| `company_persons.person_key` (SQLite) | `TEXT NULL`, 32 hex | the projection source; NULL for the 4.8% `cr` rows and every non-EGN indent |
| `tr_person_roles.person_key` (PG, mig 147) | `text NULL` | the serving base — 1,340,793 rows today |
| `tr_person` (PG, mig 147) | `person_key PK, name_norm, first_seen, last_seen, company_n` | one row per real human; the thing `person_profile()` should key on |
| `person_name_ambiguity` (matview, mig 147) | `name_norm PK, person_n int` | 528,895 rows; lets any surface answer "is this name safe to fold?" in one PK seek instead of re-deriving §11.1 |
| `person_egn_anchor` (PG, mig 147) | `person_id, person_key, basis, evidence_ref` | the bridge from *our* identity to the registry's; `basis` names which anchor rule fired |
| `mp_tr_role` (PG, mig 147) | as in [mp-tr-edges-pg-v1.md](mp-tr-edges-pg-v1.md) §4, plus `person_key`, `match_basis` | rebuilt on the key |

`person_name_ambiguity` earns its place twice: it is the eviction pass's input, **and** it is the
honest input to a UI disclaimer — a fold-matched row on a name shared by 135 people should say so,
and today nothing on the page can know that number.

### 11.6 Performance — what to add, and what to measure it against

The key changes the cardinality of every person→company query, so this is a required tier, not a
garnish. Two of these are already-measured needs, not speculative.

**Indexes**

| Index | On | Measured need |
|---|---|---|
| `idx_tr_person_roles_key` | `tr_person_roles(person_key)` | replaces the `name_fold` trigram path for the 95.2% that have a key — 32-byte equality vs a GIN probe |
| `idx_tr_person_roles_key_uic` | `(person_key, uic)` | the per-person fan-out, index-only |
| `idx_company_persons_key` (SQLite) | `company_persons(person_key)` | the projection pass |
| `idx_person_egn_anchor_key` | `person_egn_anchor(person_key)` | reverse lookup: "whose key is this" |
| `idx_tr_company_place_{ekatte,obshtina}_person` | partial `WHERE person_link_n > 0` | **measured**: the naive place query is **121 ms / 13,459 buffers on Sofia (`ekatte=68134`)** because it sorts ~110k rows before the semi-join. Mirrors the two `political_n` partials already on that table |
| `mp_tr_role(uic)` | secondary | the place inversion reads (company → MPs), the PK reads (MP → companies) |

**Denormalized column** — `tr_company_place.person_link_n integer NOT NULL DEFAULT 0`, filled from
`person_role(tr,ngo) ⨝ person(active, is_public_figure)` exactly as `political_n` is filled from
`company_politicians`. Follow 003's rule: **declare the column twice** (CREATE + reconcile
`ADD COLUMN IF NOT EXISTS`), because `load_tr_company_place_pg.ts` applies 133 on every run and
`CREATE TABLE IF NOT EXISTS` is a no-op on a warm database.

Note what this fixes: `place_companies()`'s existing `politicalCount` reads `political_n`, which
is `company_politicians`-derived and therefore **money-restricted** — only **113 companies at 43
places** carry `political_n > 0`, against **13,567 companies at 1,548 places** for the person-role
basis. The place surface has been answering a much narrower question than its label implies.

**Matviews** — only two, and each has to justify itself against a live query:

- `person_name_ambiguity` — 528,895 rows, rebuilt with the TR load. A live `GROUP BY` over 1.34M
  rows per request is not servable; a PK seek is.
- `mp_tr_role` stays a **table**, not a matview, because it has a curated arm (the override file)
  and a matview cannot carry one.

Everything else stays live. Resist a per-person precompute until a measurement asks for one — 124
exists because two routes exceeded the 10 s `statement_timeout` on prod, which is the bar.

**Gates, mandatory**

- A buffer ceiling per new serving path in a `.data.test.ts`, on the model of
  `person_connections.data.test.ts` — which also **proves the ceiling still discriminates** by
  restoring the old body in a rolled-back transaction. A ceiling that cannot fail is not a gate.
- **Measure `person_profile()`, `person_roles()` and `magistrate_by_name()` before AND after.**
  The fold path survives for the 4.8%, so both arms must be timed; timing only the new one hides a
  regression in the arm that still serves every pre-2021 role.
- `vacuumAfterReload()` after every TRUNCATE-reload of the new tables. Skipping it leaves
  `relallvisible = 0` permanently, and then none of the indexes above can plan an index-only scan —
  the plan still *says* Index Only Scan and reports `Heap Fetches: <every row>`. See CLAUDE.md's
  visibility-map section; `reload_visibility_map.data.test.ts` reads the loaders' own call sites,
  so a new vacuumed table must be added to its list.
- Re-run §1.3's overlap measurements after T4 and update the table. The `person_id` numbers will
  move, and a stale overlap on a live map is exactly the §4.2 class of error this plan exists to
  prevent.

### 11.7 Retiring the stale GCS JSON — last, and in this order

Three families are still uploaded by every `bucket:sync` (verified against
`scripts/bucket_sync_paths.ts` — none is in `isExcluded`), and T4 is what makes all three
redundant:

| Path | Files | Bytes |
|---|---|---|
| `parliament/mp-management/` | 896 | 3.6 MB |
| `parliament/companies-by-ekatte/` | 376 | 2.2 MB |
| `parliament/companies-by-obshtina/` | 270 | 1.5 MB |

Order matters, and step 1 is the one that is easy to skip:

1. ~~**Cut the build-time loop first.** `augment_mp_roles.ts` reads `mp-management/*.json` back
   off disk to write `mpRoles` onto `companies-index.json`, which `build_companies_by_*` then
   read (`index.ts:432`). Repoint it at `mp_tr_role`. Until this lands, deleting the files
   breaks a pipeline step that has nothing to do with serving.~~

   ⚠️ **[2026-08-21] NOT A STEP ANY MORE — every module it names is deleted**, and the line
   number no longer points at the phase it cited. `augment_mp_roles.ts`, `mpRoles` and
   `companies-index.json` were retired with the name-keyed company page
   (`docs/plans/company-page-consolidation-v1.md` Tier 5.2); the loop it describes cannot be
   cut because it no longer runs. Kept struck rather than removed because steps 2–8 below are
   numbered against it and step 4 refers back to it.
2. Repoint every reader (`useMpManagement`, `useCompaniesHqSummary`, `useCompaniesHqPage`) and
   **verify on prod**, not locally.
3. Drop the gate fetch: `PlaceCompaniesTile` calls `useCompaniesHqSummary` only to decide whether
   to render a link — one bucket round-trip on every governance dashboard. Return the gate as a
   field on the tile's own call.
4. Delete the writers — `buildCompaniesBySettlement`, `buildCompaniesByObshtina`, and the
   `mp-management` write in `integrate.ts`. ~~**Keep** `companies-index.json`: it is a declared
   load source (§6 of connections-pg-migration-v1) and its `tr` block is unrelated.~~
   **[2026-08-21] SUPERSEDED — it is deleted, and so is `integrate.ts`.** The `tr` block was
   that module's last remaining output, so the two died together
   (`docs/plans/company-page-consolidation-v1.md` Tier 5.2). Its load-source role is taken by
   `company_politicians` / `scripts/lib/mp_linkage.ts`, and its bucket exclusion follows the
   three-place rule in step 5 below.
5. **Three places in lockstep, not two** (corrected in §12.4): an `isExcluded` refusal **and** a
   `CHILD_EXCLUDES` entry in `bucket_sync_paths.ts`, **and** the `-x` regex in *both*
   `bucket:sync` and `bucket:sync:dry` in `package.json`.
   [bucket_sync_paths.test.ts:30](../../scripts/bucket_sync_paths.test.ts#L30) asserts the
   lockstep and that the two `-x` regexes stay byte-identical. Missing `CHILD_EXCLUDES` still
   lets `bucket:sync:paths -- parliament` re-upload all 1,542 files, because `parliament/` stays
   synced for `photos/`; missing the `-x` regex lets the full `bucket:sync` do it.
6. Scoped `bucket:sync:paths -- parliament --delete`, then git-untrack.
7. A test that fails if any of the three paths reappears in a sync manifest.

### 11.8 Retiring the `connections*` family — bigger than T4.5, and a live hazard

The person↔person static pipeline was retired in code (`a8f07765d8`, connections-engine-v1 §P4)
and `/connections` + the `/person` tile now read the live PG graph engine. **The artifacts were
never retired.** They are still tracked in git and still uploaded by every `bucket:sync` — none
of them is in `isExcluded`:

| Path | Files | Bytes | Reader |
|---|---|---|---|
| `parliament/connections.json` | 1 | **15.6 MB** | none in code — **but listed as a `/data` download** ([routes.ts:1013](../../scripts/prerender/routes.ts#L1013)) |
| `parliament/connections-rankings.json` | 1 | 4.8 MB | **live** — [ai/tools/people.ts:238](../../ai/tools/people.ts#L238) |
| `parliament/connections-rankings-top.json` | 1 | 0.3 MB | **live** — [ai/tools/people.ts:91](../../ai/tools/people.ts#L91) |
| `parliament/connections-search.json` | 1 | 2.6 MB | none |
| `parliament/connections-top-pairs.json` | 1 | 1.5 MB | none |
| `parliament/connections-party-matrix.json` | 1 | 0.4 MB | none |
| `parliament/connections-stats.json` | 1 | 2 KB | none |
| `parliament/mp-connections/` | 939 | 12 MB | none |
| `parliament/official-connections/` | 4,483 | 25 MB | none |
| **tracked total** | **5,429** | **49.9 MB** | |

**"None" here is machine-asserted, not eyeballed.**
[retired.test.ts](../../src/screens/components/connections/retired.test.ts) walks `src/**` and
fails if any of 17 retired symbols is re-imported — `useConnectionsGraph`, `useConnectionsStats`,
`useConnectionsPartyMatrix`, `useConnectionsTopPairs`, `useConnectionsRankings`,
`useConnectionsSearch`, `useMpConnections` … So the front end genuinely cannot read these. What
the guard does **not** cover is `ai/`, `functions/` and the prerender catalogue, which is exactly
where the three surviving readers are.

**Their replacements already exist and are shipped:** `graph_edge` / `graph_company_node` /
`graph_person_node` + the down-sampled `graph_payloads` blob (migrations 127–129,
`db:load:graph:pg`), served through `person_connections()`, `person_graph_ego()` and
`/api/db/connections-graph`. `graphBlob.ts` derives the hero stats and the top-pairs list from
the blob, in comments that say so verbatim ("replacing `connections-stats.json`",
"replacing `connections-top-pairs.json`"). Nothing needs to be built to retire these seven; only
the two AI tools and the catalogue entry need repointing.

#### 11.8a 🔴 `company-connections/` is a frozen serving surface — the one that is not merely dead

`parliament/company-connections/` is **78 MB across 18,340 files** and behaves differently from
everything above, in a way worth stating precisely because each fact on its own looks benign:

- It is **gitignored** ([.gitignore:271](../../.gitignore#L271)) — so it is not in the tracked
  total.
- It is **excluded from `bucket:sync`** since `9e96137c9c` (2026-07-29), as *"PG-served"*.
- Its front-end reader, `CompanyConnectionsSection` / `useCompanyConnections`, is **imported by
  nothing outside its own folder** — unreachable code. `retired.test.ts` explicitly exempts it
  ("a separate company-page pipeline"), so no guard has ever looked at it.
- Its hook nonetheless fetches `dataUrl('/parliament/company-connections/{eik}.json')` — the
  **bucket**, not the PG route.
- [ai/tools/people.ts:715](../../ai/tools/people.ts#L715) fetches the same bucket path through
  `fetchData`, whose browser fetcher resolves `VITE_DATA_BASE_URL`
  ([dataClient.ts:31](../../ai/tools/dataClient.ts#L31)) — i.e. the bucket. Its own comment says
  "GCS-only".

**An exclusion stops re-upload; it does not delete.** So whatever is on GCS is frozen at the
2026-07-29 exclusion, while the local tree has been rebuilt since (mtime 2026-08-10) — a serving
copy that can only diverge, which is the hazard the `opencalls/` exclusion comment in the same
file warns about in as many words ("a spare serving surface free to go stale"). The AI
`companyConnections` tool is the one live consumer, and it is answering "no political links" or
answering from a stale snapshot depending on what is actually still in the bucket.

**Verify before acting** — `gsutil ls gs://<bucket>/parliament/company-connections/ | head` and
check an object's `Update time`. Do not write the outage into a commit message on the strength of
the reasoning above; that is the §10.8 mistake.

The replacement is already live and better: `/api/db/company-connection?eik=&name=` (direct roles
+ 1-hop bridges via `company_connection()`, plus a shortest path up to 3 degrees via
`company_person_path()`), already consumed by `CompanyConnectionCheck.tsx` on the procurement
side.

#### 11.8b Order

Same discipline as §11.7 — repoint every reader and verify on prod *before* anything is deleted.

1. **Migrate the two AI ranking tools** ([people.ts:91,238](../../ai/tools/people.ts#L91)) from
   `fetchData` to `fetchDb` against the graph routes, and verify through the AI correctness
   harness — the node harness swaps in a fetcher that runs the **same route handlers** against
   local Postgres, so tool numbers are checked against the exact code prod serves.
2. **Migrate `companyConnections`** (people.ts:715) to `/api/db/company-connection`. Its payload
   shape changes (`directLinks`/`bridgedLinks` → `direct`/`shared`/`path`), so this is a rewrite
   of the tool's formatter, not a URL swap. Keep the "name-match only — identity is never
   asserted" disclaimer: the PG route is name-keyed too.
3. **Delete the unreachable front-end pair** — `useCompanyConnections.ts` +
   `CompanyConnectionsSection.tsx` — and **add both to `retired.test.ts`'s `RETIRED` list**,
   removing the exemption. That exemption is why this tree went a year unexamined; leaving it in
   place after deleting the files invites the same re-creation the guard exists to prevent.
4. **Resolve the `/data` catalogue entry for `connections.json`.** It has no code reader but is
   *advertised as a published dataset*, so deleting it 404s a link we published. Two honest
   options, and this is a T2 hub decision rather than a sweep decision: re-point the entry at a
   PG-derived export (the `graph_payloads` blob is the natural candidate — it is what the site
   itself now renders), or de-list it and say in the catalogue that the graph moved to the API.
   **Silently deleting it is the one option that is not available.**
5. `bucket_sync_paths.ts` gains an `isExcluded` refusal **and** a `CHILD_EXCLUDES` entry for each
   of the seven files and two directories, **and** both `package.json` `-x` regexes — the same
   three-place lockstep as §11.7 step 5. `parliament/company-connections` is already in the `-x`
   regex, which is precisely why its bucket copy is frozen rather than current (§11.8a).
6. Scoped `bucket:sync:paths -- parliament --delete`, which is also what finally removes the
   frozen `company-connections/` objects.
7. Git-untrack the 5,429 tracked files. Check first whether any is a **load source** the way
   `companies-index.json` was (deleted 2026-08-21) — `build_company_connections.ts` and the
   graph loader read from
   `state.sqlite` and PG respectively, so the expectation is none, but the check is cheap and the
   failure (a `db:refresh` that breaks on a fresh clone) is not.
8. Extend the §11.7 test so it fails if **any** of these paths reappears in a sync manifest.

#### 11.8c Sizing

| Sweep | Files | Bytes | Risk |
|---|---|---|---|
| §11.7 — the three MP↔TR shard families | 1,542 | 7.3 MB | build-time loop must be cut first |
| §11.8 — `connections*`, tracked | 5,429 | 49.9 MB | 3 live readers + 1 published-dataset entry |
| §11.8a — `company-connections/`, gitignored | 18,340 | 78 MB | frozen bucket copy; verify with `gsutil` first |
| **total** | **25,311** | **135.2 MB** | |

The bigger win is the one that needs the more careful check, which is the usual shape and the
reason this is sequenced after T4 rather than folded into it. Note §11.8 and §11.8a do **not**
depend on T4 at all — their replacements shipped months ago. They are here because they are the
same class of debt and the same retirement discipline, and because doing them together means
writing the `bucket_sync_paths` gate once.

### 11.10 🔴 What the shipped guard leaves undone — mp-management is now the last surface still making the retracted claim

Measured 2026-08-12, after `tr-attribution-basis-v1` steps 1–7 landed. The guard was applied to
the person layer (`resolve_persons.ts`, `bridgeB.ts`, `person_search`, `person_browse_table`) —
`person_role` at `source='tr'` fell from 200,849 to **192,214** as it refused shared and
unmeasured folds. **The three static shard families were not in that plan's scope and did not
move.**

Re-running §3's overlap against the guarded person layer:

| | |
|---|---|
| `mp-management` (MP, company) pairs | 2,014 |
| still reproduced by `person_role` tr/ngo | **1,112** (was 1,294 — the guard removed 182) |
| MPs whose fold the registry says holds **more than one** person | **121 of 896** |
| MPs whose fold is unmeasured | 14 |
| **file pairs held by a shared-fold MP** | **410** |
| of those, graded `medium` | **337** |

So `parliament/mp-management/*.json` — served from the bucket, read by `MpManagementRoles` and
`MpProfileSections` on every `/candidate/:id` and `/person/:slug` — currently publishes **410
(person, company) attributions that the registry's own key says rest on a name belonging to more
than one human**, while `/persons`, `person_search` and the `/person` companies list have already
stopped. Two surfaces disagreeing about one named person is exactly the defect
[tr-attribution-basis-v1 §0.2](tr-attribution-basis-v1.md) calls the worst this family can carry;
the guard closed it on one side only.

**This is now the strongest argument for the migration in
[mp-tr-edges-pg-v1.md](mp-tr-edges-pg-v1.md), and it changes that plan's Tier 1 design a third
time.** Tier 1 is neither the verbatim confidence-model port (its original draft) nor the
key-based triple (§11.4, refuted above). It is: build `mp_tr_role` from `tr_person_roles`,
**gated on `tr_name_fold_people.people_n = 1` — the same table, the same one definition the
person layer already reads.** The old `COMMON_NAME_TR_ROWS = 11` row-count heuristic is a proxy
for precisely what that table now measures directly, and it should be deleted rather than ported:
it both over-suppresses (it drops a rare-name MP's whole medium set on a busy registered agent)
and under-suppresses (11 officer rows is not the same question as 11 people).

The corroboration arms (TR seat ∈ MP region, self-declared stake, same-party witness) survive as
what they always were — evidence that *raises* confidence — but they no longer carry the load,
and no arm may promote a shared fold. That is the §2.2 rule: corroboration cannot tell you which
of 135 people the row belongs to.

### 11.9 What this does NOT do

- **It does not make the whole person layer exact.** Only TR↔TR. Declarations, CIK candidates,
  the officials roster and the ИВСС register publish no EGN hash, so `person_id` stays a bridge
  across those and §11.2's fold arm stays live. `person_key` is not a replacement for `person_id`
  and the model keeps them separate on purpose (§2.1).
- **It does not settle the `medium` tier question.** [mp-tr-edges-pg-v1.md](mp-tr-edges-pg-v1.md)
  §5 asks whether uncorroborated fold matches should be published at all. T4 shrinks that
  population — 95.2% of rows can be decided by key — but the residue is a publishing decision,
  and a smaller residue is easier to decide, not self-deciding.
- **It does not recover pre-2021 roles.** A role entered before the feed window and never
  re-filed is invisible to the key. The CR Deeds capture fills those rows but carries no identity
  (§11.2), so that gap closes only if the Registry exposes an indent on that API.

---

## 12. Audit of §11 (2026-08-11) — gaps found, and three corrections to §11 itself

Read after §11. Everything here was checked against the repo, not recalled. §12.1 is the largest
gap: **§11 as first written never touched the daily-refresh flow at all**, which for a corpus that
moves every weekday is not a detail.

### 12.1 🔴 Watcher / `process-watch-report` wiring — missing entirely from §11

The new flow rides an **existing** watcher source. `egov_commerce` → `tr-daily-refresh`, and that
npm script already chains the Postgres half
([package.json:239](../../package.json#L239)):

```
tsx daily_refresh.ts && db:pg:up && db:load:tr:pg && db:load:cr-founding:pg
                                 && db:load:cr-nkid:pg && db:load:tr-company-place:pg
```

So most of T4 needs no new watcher source and no new ingest marker — it needs the existing chain
extended. What has to change, and none of it is inferable from the migration list:

**(a) `db:load:tr:pg` carries three more outputs.** `tr_person_roles.person_key` is filled in the
same COPY; `tr_person` and `person_name_ambiguity` are rebuilt immediately after, inside the same
loader. They must **not** be a separate `db:load:*` — they are a pure function of the table the
loader just replaced, and splitting them creates a window where the ambiguity matview disagrees
with the roles it summarises.

**(b) `mp_tr_role` is a FAN-IN, and the mapping table has no shape for that.** It needs
`tr_person_roles` (from `egov_commerce` → `tr-daily-refresh`), `declaration_stake_company` (from
`cacbg_declarations` → `update-connections`) and `person_role` (from `update-persons`). A source
row cannot express "re-run when any of three moved". Use the pattern the table already has for
exactly this problem — the `_person-layer re-derivation (downstream of ANY people source)_` row —
and add a sibling:

> `_MP↔TR attribution (downstream of egov_commerce OR any anchor source)_` → run
> `db:load:mp-tr-roles:pg` **after** whichever of `tr-daily-refresh` / `update-connections` /
> `update-persons` ran, last in the queue.

**(c) 🔴 `db:load:tr-company-place:pg` ends the daily chain, and after T4 that is the wrong
place.** `person_link_n` is denormalized from `person_role(tr,ngo)`, which `update-persons`
rebuilds — and `update-persons` runs *after* `tr-daily-refresh` in the orchestrator queue. So the
daily flip would refresh the place counter from the **previous** resolve, and every governance
dashboard's "фирми, регистрирани тук" political count would sit one vintage behind at a 200. Two
options, and the second is better: either move `db:load:tr-company-place:pg` out of the
`tr:daily-refresh` script into the orchestrator's post-`update-persons` step, or have the
orchestrator re-run it there. Note this is a **pre-existing latent issue that T4 makes real** —
the column it denormalizes today (`political_n`, from `company_politicians`) *is* rebuilt by
`db:load:tr:pg` in the same chain, so the ordering has been correct by accident.

**(d) The cloud publish list grows.** SKILL.md's `tr-daily-refresh` cloud row is currently
`db:load:tr:pg:cloud && db:load:graph:pg:cloud && db:load:tr-company-place:pg:cloud &&
db:refresh:risk:cloud`. Add `db:load:mp-tr-roles:pg:cloud` after the graph step, and keep
`tr-company-place` last for the same reason as (c). The `update-persons` cloud chain gains
`person_egn_anchor` — it is written by the resolver, so it rides `db:resolve:persons:cloud` with
no new command, but the plan must say so or someone will add one.

**(e) Ingest markers: reuse, do not add.** `state/ingest/tr-daily-refresh.json` and
`state/ingest/update-persons.json` already exist and already gate these skills. A new marker would
create a second answer to "has this been ingested?" for one source movement. The `summary` string
in the marker should name the key coverage (`person_key on N of M rows`) — that string is what the
orchestrator narrates, and it is the only place a coverage regression would be visible day to day.

### 12.2 🔴 The one-off backfill the daily flip cannot produce

`tr:daily-refresh` is **incremental** — it fetches new day files and replays them onto
`state.sqlite`. A parser that starts extracting `Indent` therefore keys only rows arriving *after*
the change. The 1,468,207 historical rows get `person_key` only if the whole archive is re-parsed.

Consequences the plan has to carry:

- **A one-off full rebuild is a separate, manual step**, behind an explicit flag — the repo's
  standing rule for backfills. It re-reads `raw_data/tr/daily/` (1,666 files, **15 GB**) and
  rebuilds `state.sqlite` from scratch; budget accordingly and do not chain it to anything.
- **`raw_data/tr/daily/` is gitignored host state.** Only a machine holding it can produce the
  column. A fresh clone gets `person_key` NULL on every row, every surface silently falls back to
  the fold arm, and nothing fails — the safe degradation, and an invisible one. The loader must
  log the coverage ratio on every run, and a `.data.test.ts` must fail below a floor (say 90% of
  `daily`-sourced rows) rather than only on an empty column.
- **Ordering inside the one-off:** re-parse → rebuild `state.sqlite` → `db:load:tr:pg` →
  anchors → `mp_tr_role`. Anchors before `mp_tr_role`, obviously; but also **after**
  `db:resolve:persons`, since the anchor row is keyed on `person_id`.

### 12.3 🔴 `person_egn_anchor` must not be readable from `/db` — and a route gate does not cover it

§11.3's "never served" rule was written against `/api/db` routes and `/public` artifacts. It has a
hole: **`/db` runs an arbitrary read-only `SELECT` over the open schema**
([sql_lib.js:3](../../functions/sql_lib.js#L3)). An exposed `person_egn_anchor` therefore lets any
visitor enumerate `person_id ↔ person_key` in one query, and from there join the key back across
the whole TR corpus — which is the identity mapping the re-keying exists to protect.

T3's schema filter is not the fix. That is a *display* filter over a catalogue; the SQL surface is
still open, so hiding the table from the listing hides it from the honest user only.

**The fix is a privilege boundary, not a convention.** Put the anchor table (and `person_key`
itself, if it can be kept off the public tables) in a schema `app_readonly` cannot see — the
`/db` console connects as that role, so an unprivileged relation is unreadable regardless of what
the catalogue shows. Then assert it:

- a `.data.test.ts` that connects **as `app_readonly`** and expects `42501` on
  `SELECT * FROM person_egn_anchor` — asserting the grant, not the filter;
- extend the §11.3 route gate to cover the `/db` catalogue as well, so the table cannot reappear
  in the listing either.

Note the role-guard interaction: `roles_readonly.sql` is a one-time manual step, so a migration
that `REVOKE`s or `GRANT`s against `app_readonly` must be guarded the way 117/130 are, or it
raises `42704` on a cold bootstrap and rolls the whole file back.

### 12.4 Three corrections to §11

**(a) The changelog rule was stated backwards.** [mp-tr-edges-pg-v1.md](mp-tr-edges-pg-v1.md)'s
ops section said both surfaces need a `recent_updates` row. They need **none**. `mp_tr_role`,
`tr_person` and `person_name_ambiguity` are derived serving layers and follow the
`db:load:graph:pg` precedent: no `recent_updates` row, no `data/data-changes.json` entry. The
`/data/updates` feed is stamped per-skill by `process-watch-report`, and `tr-daily-refresh`
already stamps it — a row here reports one TR movement twice under two names. Corrected in that
file.

**(b) Bucket retirement needs THREE places in lockstep, not two.** §11.7 and §11.8b said
`isExcluded` + `CHILD_EXCLUDES`. They also need the `-x` regex in **both** `bucket:sync` and
`bucket:sync:dry` in `package.json`, which
[bucket_sync_paths.test.ts:30](../../scripts/bucket_sync_paths.test.ts#L30) asserts stay
byte-identical. Corrected in both sections.

**(c) A missing `ORDER_PAIRS` entry.** §11.6 named `person_link_n` as a schema change but not as
an ordering change. `db:load:tr-company-place:pg` must now follow `db:resolve:persons`
(see §12.1c) — that is a fourth entry for
[refresh_coverage.test.ts:85](../../scripts/db/refresh_coverage.test.ts#L85)'s table, alongside
the two §11 already names. Its `why` should say what breaks: the governance tile's political
count publishes the previous resolve's link set with every row count reconciling.

### 12.5 The parity check that passes while the column is empty

`sync_cloud.ts`'s `CRITICAL_TABLES` already contains `tr_person_roles` — but it compares
**row counts**, and every row can carry a NULL `person_key` while the count matches exactly. This
is the `place_dim`/`nuts3` trap in CLAUDE.md repeating verbatim: prod had the right row count
(5,720, matching local) and the wrong columns, and a count-based preflight passed it.

So:

- add `tr_person` and `person_egn_anchor` to `CRITICAL_TABLES` — they qualify on the same axis as
  `agri_subsidies` and `kzk_decisions`: derived from **gitignored host state**, so a dropped table
  is only re-derivable from a machine that still holds `raw_data/tr/daily/`, and a restore that
  loses them looks green;
- add a **column-population** check beside the count check for `tr_person_roles.person_key`, since
  that is the failure mode a count cannot see.

### 12.6 Secret handling — the one-line leak

`vite.config.ts` calls `loadEnv(mode, ".", "")` with an **empty prefix**, which reads every
variable in `.env`, and then injects exactly one into the bundle via `define`
([vite.config.ts:93](../../vite.config.ts#L93)). So `TR_PERSON_KEY_SECRET` is safe today by virtue
of one `define` entry, and would be exposed by a one-line edit — a shape worth a gate rather than
a comment:

- a test that greps `dist/**` for the secret's **value** and for the literal string
  `TR_PERSON_KEY_SECRET`, and fails on either;
- the §11.3 secret gate (build fails on absent/empty/committed value) already covers the other
  direction — a missing secret silently degrading to a constant salt, which is the raw hash under
  another name.

### 12.7 The AI harness is a second consumer, and its numbers will move

`personProfile` / `personConnections` / `person_elections` read the person layer, and T4 changes
which companies attach to a person — 720 fold pairs evicted or confirmed, 257 already-PG pairs
unaffected, plus whatever the anchors add. The node correctness harness swaps in a fetcher that
runs the **same route handlers** against local Postgres, so expectations move with the data rather
than with the code.

Re-run the harness after T4.3 and **record the diff in this plan**, not just in a commit message.
An AI tool that quietly starts returning a different company set for the same MP is exactly the
kind of change that should be visible in the evidence log.

### 12.8 What the audit did NOT find

Stated so the absence is a checked result rather than an omission:

- **No migration-number collision.** 146 is the highest committed; 147/148 are free.
- **No `pg_roundtrip` exposure.** That gate asserts Postgres is a lossless capture of the
  procurement **shards**; `company_persons` is SQLite and outside it.
- **No prerender or sitemap impact.** None of the affected surfaces is prerendered and none emits
  a `<loc>`; `/settlement/:id/companies` and `/sofia/companies` are SPA-only.
- **No `db:refresh` cycle.** tr → declarations → resolve:persons → anchors → `mp_tr_role` is a
  chain, not a loop. The one existing cycle in this area (graph → tr-company-place → interreg,
  documented in CLAUDE.md) is untouched: `person_link_n` reads `person_role`, which is upstream
  of all three.
- **`tr_search_shape.test.ts` already covers the new column** — it fails when 003's CREATE list
  and its reconcile list disagree, so `person_key` on `tr_person_roles` cannot land on a fresh
  clone only. It does **not** cover new tables, so `tr_person` needs its own shape assertion.

### 12.9 Pre-implementation checklist

Settle these before the first line of code; each changes what gets built.

| # | Decision | Owner |
|---|---|---|
| 1 | Extract the EGN hash at all — §11.3 changes a standing, gated policy | repo owner |
| 2 | Re-key with HMAC vs store the TR hash verbatim | repo owner (§11.3 recommends HMAC) |
| 3 | Publish the residual keyless fold matches, or only count them (§5 of mp-tr-edges) | repo owner |
| 4 | Private schema for `person_egn_anchor` vs catalogue filter (§12.3 says schema) | repo owner |
| 5 | Verify `gs://…/parliament/company-connections/` before writing §11.8a as an outage | anyone, `gsutil` |
| 6 | Confirm the 15 GB re-parse can run on the machine that will do it (§12.2) | operator |
