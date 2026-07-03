# Direct-to-DB ingest — retiring the redundant JSON layer (v1)

**Status:** proposal (2026-07-03)
**Motivation:** stop regenerating + git-tracking thousands of JSON shards that are
either (a) already computed inside Postgres, or (b) a candidate to move into
Postgres. The 2026-07-03 connections rebuild alone produced a **3,401-file
commit**; `data/procurement/derived/` is **12,656 files / 151 MB** rewritten on
every ingest.

See also [postgres-migration-v1.md](postgres-migration-v1.md) and
[pg-datasets-roadmap.md](pg-datasets-roadmap.md). This plan is the *inverse* of
the roadmap: the roadmap adds new datasets to PG; this retires the JSON that PG
already (or soon will) subsumes.

---

## 1. Current lineage (what actually feeds what)

The procurement domain keeps **three** representations in sync — this is the
redundancy:

```
raw AOP feed
   │  scripts/procurement/ingest.ts
   ▼
data/procurement/                        (1) INGEST-WRITTEN JSON
   ├── contracts/{year}/*.json   ← 6,070 files, 686 MB   [PG load source]
   ├── tenders/**                ← 789 MB                 [PG load source]
   ├── by_ns/*.json              ← 78 files                [frontend-DEAD]
   └── derived/*.json            ← 12,656 files, 151 MB    [frontend-DEAD*]
         │
         │  scripts/db/load_pg.ts  (reads ONLY contracts/{year} + tenders + debarred)
         ▼
Postgres  contracts, tenders, tr_*, …    (2) BASE TABLES
         │  SQL 025–039 compute derived tables/views IN-DB
         ▼
   procurement_overview / _concentration / _flow / _risk_feed /
   _rankings / _scanner / _by_settlement / _risk_indexes / _sectors …
         │  functions/db_routes.js  →  /api/db/procurement-*
         ▼
   Frontend (src/data/procurement/*)      (3) LIVE PAGES

   [separate, legacy] scripts/db/gen_procurement/*.ts + golden_targets.ts
   read PG back OUT to regenerate/verify the by_ns + derived JSON (the
   "JSON verification net"). This is the ONLY consumer of the dead JSON.
```

`* frontend-DEAD` is family-by-family, **not** the whole `derived/` tree. Ground-
truth grep of `src/` (2026-07-03) splits `derived/` into:

- **Still frontend-LIVE** (must migrate before retiring — see Workstream D):
  `derived/breakdowns/{c,a}/*` (**12,373 files — the real churn**,
  `useProcurementBreakdown.tsx` → `/company/:eik` + `/awarder/:eik` sector tiles),
  `derived/per-mp/*` (44 files, `useMpScorecard.tsx`),
  `derived/mp_connected.json` (scorecard fallback), `derived/mp_party.json`
  (1 file, `useMpParty.tsx`), and `roads.json` (1 static GeoJSON, `useRoadGeometry.tsx`).
- **Frontend-DEAD** (Workstream A — ~320 files total):
  `by_ns/*` (78), `derived/pep-by-slug/*` (83), `derived/pep-by-eik/*` (82),
  `derived/by-eik/*` (42), `derived/contract_index/*` (16), and the single-file
  rollups `top_contractors`, `concentration_full`, `flow`, `flow_full`,
  `risk_feed`, `person_procurement_index`, `contractors_search`, `sector_totals`,
  `cpv_competition`, `ocds_party_geo_map`, `pep_connected`.

**Churn reality:** the 12,656-file `derived/` count is **98% the live
`breakdowns/` family**. Retiring only the dead files saves ~320 files — it barely
dents the churn. **Killing the churn requires migrating `breakdowns/` (Workstream
D), whose PG path already exists.**

**Connections domain** has no PG presence at all — 100% JSON, mostly still
frontend-live (see §3).

Key facts (verified 2026-07-03):
- `load_pg.ts:91` reads `PROC_DIR/contracts` (month shards) only. It never reads
  `by_ns/` or `derived/*` — those tables are built by SQL, not loaded.
- `schema/pg/025–039` compute every dead derived family from the base `contracts`
  table (`overview`, `concentration`, `flow`, `risk_feed`, `rankings`, `scanner`,
  `by_settlement`, `risk_indexes`, `sectors`, `benchmarks`).
- No MP-declaration / connections tables exist in `schema/pg/`.

---

## 2. Three independent workstreams

Classify every file family into one of three buckets, each with a different fix:

| Bucket | Families | Fix | Effort |
|---|---|---|---|
| **A. Redundant, frontend-dead** (PG already computes it) | `by_ns/*`, `derived/{pep-by-slug, pep-by-eik, by-eik, contract_index}/*`, and single-file `concentration_full, flow, flow_full, top_contractors, contractors_search, risk_feed, awarder_concentration, person_procurement_index, sector_totals, cpv_competition, ocds_party_geo_map, pep_connected` (~320 files) | **Stop generating + git-untrack.** No new PG work. | Low |
| **B. Not-yet-in-PG** (JSON is still the only source) | all `connections*`, `companies-index`, `companies-by-ekatte/*`, `companies-by-obshtina/*`, `mp-connections/*`, `mp-management/*`, `official-connections/*`, `company-connections/*` | **Build PG tables + API + migrate hooks, then retire JSON** (the real "ingest to DB"). | High |
| **C. Load source** (PG reads it) | `contracts/{year}/*`, `tenders/**` | Keep as-is, **or** optionally direct raw→PG (§4c). | — / High |
| **D. Frontend-LIVE derived** (PG has the data/fn, hook still reads JSON) | `derived/breakdowns/{c,a}/*` (12,373 — the churn), `derived/per-mp/*` (44), `derived/mp_connected.json`, `derived/mp_party.json`; **`roads.json` stays JSON** | **Repoint hooks to `/api/db/*`** (mostly serving, fns largely exist), then retire JSON. | Low–Med |

---

### Workstream A — retire the redundant procurement derived JSON  ⟵ do first

These 12.7k files are the churn engine and are **already reproduced in PG**. The
only thing reading them is the verification net, which was the SQLite-era safety
harness — no longer load-bearing now that PG serves live.

**Steps**
1. In `scripts/procurement/ingest.ts` (+ `rebuild_derived.ts`, `derived.ts`,
   `by_ns.ts`, `risk_feed.ts`, `build_contractors_search.ts`) gate the writes for
   the dead families behind a `--legacy-json` flag, **default off**. Keep writing
   the four live exceptions (`per-mp/*`, `mp_connected.json`, `roads.json`,
   `mp_party.json`).
2. Repoint `golden_targets.ts` from the dead JSON to **PG-vs-PG** parity (or drop
   the dead families from the golden set). The base-corpus + tenders goldens stay.
3. `db:build` / `gen_procurement/{by_ns,derived,index,rollups}.ts`: mark
   verify-only, remove from the default `db:refresh` path (they already aren't in
   it). Keep `contract_lists`, `by_settlement`, `month_shards`, `cross_reference`
   only if their outputs are still frontend-live — audit each (most are `/api/db`
   now).
4. `git rm -r --cached` the dead families; add to `.gitignore`. Optionally keep
   them locally as gitignored scratch, or delete outright.
5. **Do not** touch `data/procurement/contracts/**` or `tenders/**` (Workstream C).

**Payoff:** removes 12,656-file commits from the connections/procurement pipeline;
−151 MB tracked. Zero frontend impact (nothing fetches them). Reversible via the
flag.

**Risk:** low. The one gotcha is any *script* (not frontend) that reads a dead
family as an input — grep before cutting. Known cross-reads to check:
`scripts/funds/political_links.ts` reads `top_contractors`;
`scripts/budget/*` reads a `flow.json` (confirm it's the **budget** flow, not
procurement). Re-source these from PG or the base corpus.

---

### Workstream B — connections (MP-declaration graph) → Postgres  ⟵ the real migration

This is the domain the user means by "ingest directly to DB." It mirrors exactly
the path procurement/TR/funds already took. Two distinct graphs live under
"connections" — only the **MP-declaration** one is unmigrated:

- **Already in PG:** the TR/company-officer graph (`tr_companies`, `tr_officers`,
  `company_politicians`, `company_officers()`, `008_connections.sql`) → serves
  `/company/:eik`, `/awarder/:eik`.
- **JSON-only (this workstream):** the Сметна-палата MP-declared business-interest
  graph → serves `/connections`, `/candidate/:id/connections`, `/mp/company/*`,
  the settlement "Companies HQ'd here" tiles.

**Source of truth today:** `scripts/declarations/build_company_index.ts` +
`build_officials_connections.ts` emit `companies-index.json` and the
`connections*` rollups; `build_companies_by_settlement.ts` /
`_by_obshtina.ts` shard them; per-MP/official shards come from the same build.

**Schema sketch** (`schema/pg/041_connections.sql`):
- `decl_companies` (eik PK, name, registered_office, ekatte_hq, obshtina_hq,
  hq_match_quality, …) — the enriched company index.
- `decl_company_mps` (eik, mp_id, role, is_current, stake_source) — the MP↔company
  edges (both declared stakes and TR roles), the join that powers rankings +
  party matrix + per-MP + per-settlement.
- `decl_official_links` (slug, eik, role, …) for the officials variant.
- Indexes: `(mp_id)`, `(eik)`, `(ekatte_hq)`, `(obshtina_hq)`, GIN-trgm on
  `name_fold` for `connections-search`. Follow
  [pg-query-performance.md](pg-query-performance.md): index **both** sides of
  every join key.

**API** (`schema/pg/042_connections_api.sql` + `functions/db_routes.js`): SQL
functions for each current JSON payload — `connections_rankings()`,
`connections_party_matrix()`, `connections_stats()`, `connections_top_pairs()`,
`companies_at_settlement(ekatte)`, `mp_connections(mpId)`, `mp_management(id)`,
`official_connections(slug)`, plus `connections-search` via the trgm index. Most
are small aggregates → cheap. Register the browsable ones (companies list) in the
`db_table.js` REGISTRY rather than bespoke routes where the shape fits.

**Frontend:** repoint the 11 hooks in `src/data/parliament/` +
`src/data/officials/useOfficialConnections.tsx` from `fetch(dataUrl(...))` to
`/api/db/*`, matching the procurement hook pattern (`useProcurementOverview.tsx`
is the template). The full-graph `connections.json` (force-directed graph on
`/connections`) is the one payload that may stay a single JSON blob — a live
graph query is higher risk/lower payoff; decide per-payload.

**Retire JSON:** once hooks are on `/api/db`, apply Workstream-A treatment to the
connections families (stop generating, untrack).

**Effort:** high (new schema + ~13 SQL fns + ~12 hook migrations + prod push).
**Sequence within B:** ship schema+loader first (verify parity vs current JSON
via a golden), then API, then migrate hooks one screen at a time behind the
existing data-hook seam, then retire JSON last.

---

### Workstream D — migrate the still-frontend-live derived families  ⟵ where the churn actually is

The earlier "four live exceptions" framing undercounted: the biggest live family
is `breakdowns/` (12,373 files), which the first-pass audit missed. The good news
— **the PG data/functions for all of these already exist**, so D is mostly a
*serving repoint* (change the hook's URL), not new schema.

**D1. `derived/breakdowns/{c,a}/*` — 12,373 files, THE churn engine → serving repoint.**
- Content: per-entity CPV-sector / procedure-method / EU-funding breakdown, one
  shard per company (`c`) and per awarder (`a`). Read by `useProcurementBreakdown.tsx`
  → `CompanySectorsTile`, `ProcurementSectorsTile`, `ProcurementBreakdownTile` on
  `/company/:eik` + `/awarder/:eik`.
- **PG already has it:** `company_sectors(eik)` (`schema/pg/036`/`018`; served at
  `db_routes.js:130`) — and `CompanyDbScreen.tsx:402` **already** assembles the
  identical `ProcurementBreakdown` object from that PG response. So the payload
  shape is proven to reproduce from SQL.
- **Migration:** (a) confirm/extend an awarder-side variant (`awarder_sectors(eik)`
  or reuse `company_sectors` with the awarder index) for `kind:"a"`; (b) repoint
  `useProcurementBreakdown.tsx` from `fetch(dataUrl('/procurement/derived/breakdowns/…'))`
  to `/api/db/company-sectors` / the awarder route; (c) golden-diff a sample of
  eiks JSON-vs-PG; (d) stop generating the shards in `cross_reference.ts`, untrack.
- **Effort: Low–Med** (one hook, maybe one new SQL fn). **Payoff: eliminates 98% of
  the derived churn** — the single highest-impact item in this whole plan.

**D2. `derived/per-mp/*` (44) + `mp_connected.json` fallback → tiny serving repoint.**
- Read by `useMpScorecard.tsx` (candidate-page scorecard tile).
- **PG already has it:** `ref_procurement('/candidate/mp-<id>')` — its own header
  states it "Replaces the derived/per-mp/ and derived/pep-by-slug/ JSON shard
  readers" (`schema/pg/034`, served at `db_routes.js:582`). It returns the per-MP
  total + per-company + per-year detail.
- **The one gap:** the scorecard needs the **cohort rank/median** (this MP's rank
  among all connected MPs in the NS). `ref_procurement` returns the value, not the
  rank. Add a small `mp_scorecard_cohort()` fn (window over `company_politicians`
  grouped by ref, `SUM(contractor total)`, `RANK() OVER (ORDER BY … DESC)`), or
  extend `ref_procurement` to include `rank/cohortSize/cohortMedian`.
- **Migration:** repoint `useMpScorecard.tsx` to `/api/db/ref-procurement` +
  the cohort fn; drop the shard + fallback fetch; stop generating in
  `cross_reference.ts`. **Effort: Low.**

**D3. `derived/mp_party.json` (1 file, ~40 KB, mpId→party) → fold in or keep.**
- Read by `useMpParty.tsx` → `TopMpsTile`, `TopConnectedPeopleTile` (chip colour/
  label). Regenerated rarely (last change 2026-05-13) — **single file, negligible
  churn.**
- The MP→party map isn't in PG today (roster is JSON). Options: (a) add `party` to
  the `company_politicians` / connected-people PG responses and drop the separate
  fetch; (b) **leave as one small static JSON** — cheapest, no churn cost.
  Recommend (b) unless it falls out of D2/Workstream-B for free.

**D4. `roads.json` (1 file, 727 KB static GeoJSON) → KEEP as JSON.**
- OSM road geometry for the `/procurement/roads` map, produced by the one-off
  `ingest_osm_roads.ts` (not part of any daily churn; roads don't change).
  Leaflet consumes GeoJSON directly and there is no PostGIS in the stack.
  Migrating geometry to PG is pure overhead → **not a candidate.**

**Net for D:** D1 alone removes ~12.4k files of churn for one hook change + a
possible awarder SQL variant. D2 is a second small repoint. D3/D4 stay JSON.

## 3. Dead-dead files (remove now, independent of A/B)

Confirmed no live reader anywhere (frontend or pipeline consumer):
- `data/parliament/company-connections-stats.json` — only *written* (by
  `build_company_connections.ts`); nothing reads it. Drop the writer's emit.
- `data/parliament/companies-by-ekatte/index.json` — read only by
  `useCompaniesHqIndex` (`useCompaniesAtSettlement.tsx:100`), which no screen
  calls. Remove hook + stop emitting the index (keep the summary/page shards).
- `data/officials/derived/connections.json` — an **intermediate** artifact of
  `build_officials_connections.ts` that it then shards into
  `official-connections/{slug}.json`. Not truly deletable without refactoring that
  script to shard in-memory; low priority, fold into Workstream B.

---

## 4. The "local SQL intermediary" question

The user asked whether an intermediary local SQL could sit between ingest and the
DB. Three framings, with a recommendation:

**(a) You already have it — local Docker Postgres.** The established pattern
(`db:refresh` → `db:load:*` → `db:push`) is: ingest → **local PG** → `pg_dump`
snapshot → Cloud SQL. "Local == cloud, single engine" is the explicit design
(postgres-migration-v1). There is no need to introduce SQLite as a new
intermediary — the project already **pivoted off SQLite to Postgres** for exactly
this (see [sql-migration-v1.md](sql-migration-v1.md)). Recommendation: treat local
PG as the staging/source-of-truth; the durable git artifact becomes the `pg_dump`
(or the existing snapshot), **not** JSON shards.

**(b) Keep the base corpus JSON as the durable, diffable source.** The month
shards (`contracts/{year}/*.json`, `tenders/**`) are worth keeping in git even
after A/B: they're human-greppable, diff cleanly per-day, and are the replayable
input if PG is ever rebuilt from scratch. This is the sweet spot — **JSON for the
base corpus (small, diffable per-day), PG for everything derived** (no JSON).

**(c) Optional stretch — direct raw→PG for the base corpus (eliminate month
shards).** Only if the 686 MB + 789 MB corpus itself is the pain. Change
`ingest.ts` to `COPY` straight into `contracts`/`tenders`, snapshot PG to git
instead of shards. **Not recommended now:** loses the diffable per-day corpus and
the cheap replay, for a one-time size win. Revisit only if repo size becomes the
binding constraint.

---

## 5. The legacy verification net — retire, keep, or migrate?

**What it is.** A *local, operator-run* harness (confirmed **not in CI** — `test.yml`
runs only lint + build + playwright; `test:data`/`db:verify`/`db:build` are manual).
It was built for the SQLite→PG + JSON→SQL migration (sql-migration-v1 Phase 1,
postgres-migration-v1 Phase 4) to prove **byte-for-byte that PG reproduces the
ingest JSON** — the confidence to flip the frontend onto PG. That flip has
**already happened** for procurement, so the net's original mission is largely
complete. It has two halves with opposite fates:

**Half 1 — the JSON-mirror machinery → RETIRE (in lockstep with the JSON it mirrors).**
Its entire job is "prove PG can regenerate the on-disk JSON." As each family is
retired (Workstreams A + D1), its mirror dies with it:
- `scripts/db/gen_procurement/*.ts` + `scripts/db/build.ts` + `db:build` /
  `db:gen-*` — the PG→JSON regenerator/flip. This **is** the "generate JSON from
  PG" machine the `[No JSON-from-PG]` policy already says not to extend. Drop the
  gen step for every retired family; keep only steps whose output is still a live
  JSON artifact (none, once D1 lands).
- **Tier 2 goldens** — `goldens.data.test.ts`, `scripts/db/__golden__/` (17 fixtures),
  `golden_targets.ts`, `snapshot_goldens.ts`, `db:goldens`. Golden fixtures **are**
  on-disk JSON snapshots of derived files (`derived/top_contractors`, `flow_full`,
  `cpv_competition`, `by_ns/…`). When those files go, the fixtures point at nothing.
- **Tier 1 manifest** — the `by_ns` + `derived` **categories** in
  `data/db/procurement.manifest.json` (`manifest.ts`, `db:manifest`). Drop those
  categories; the checksum of a deleted family is meaningless.

**Half 2 — the PG-native integrity checks → KEEP (and migrate one onto PG).**
These test *data correctness*, not *JSON parity*, so they outlive the JSON:
- `pg_roundtrip.data.test.ts` — proves the PG load is a **lossless** representation
  of the base corpus. As long as `contracts/` + `tenders/` stay JSON (Workstream C),
  this is the real load-integrity guarantee → **keep, scoped to the base corpus**.
  Its manifest counterpart (`contracts`, `tenders` categories) stays meaningful too.
- `invariants.data.test.ts` — key uniqueness, the EUR peg, twin dedup, headline
  reconciliation. Today it computes these from the **on-disk** corpus. All four are
  expressible as SQL over `contracts` → **migrate to query PG**, drop the on-disk
  read. This becomes the durable, data-version-independent regression net that
  should exist permanently.
- `db_routes.data.test.ts` (route SQL-injection invariant, pure mock) +
  `search.data.test.ts` (PG search fns) — already PG/independent → **keep as-is.**

**Bottom line.** *Retire the mirror, keep-and-migrate the integrity net.* Do it
**family-by-family in lockstep** with A/D1 — when a family stops generating, delete
its gen step, its golden, and its manifest category in the same change (don't leave
`golden_targets.ts` pointing at deleted paths; it warns-and-skips today, but clean
it). What remains afterward is a lean PG-native suite: `pg_roundtrip` (base corpus
lossless) + `invariants` (PG data integrity) + `db_routes`/`search` — no JSON-mirror
step, no `db:build`, no goldens. That's the standing net worth keeping; the rest was
migration scaffolding whose job is done.

## 6. Recommended sequence

Ordered by value-to-effort (churn removed ÷ work). **The verification-net teardown
(§5 Half 1) is not a separate step — it rides along with each family's retirement:**
whenever a step below stops generating a family, delete that family's gen step,
golden, and manifest category in the same change.

1. **§3 dead-dead files** — trivial, do immediately (~3 files, no deps).
2. **Workstream D1 — `breakdowns/` repoint.** *Highest value-to-effort in the plan.*
   One hook (`useProcurementBreakdown`) + a possible `awarder_sectors` SQL variant
   → **removes ~12.4k files (98%) of the derived churn.** The PG fn already exists
   and `CompanyDbScreen` already proves the payload reproduces. Low risk.
3. **Workstream A** — retire the ~320 frontend-dead files behind a `--legacy-json`
   flag; **drop their gen steps + goldens + manifest categories** (§5 Half 1). Low
   risk, no new PG code.
4. **Workstream D2 — `per-mp` scorecard repoint.** Add the cohort-rank fn, point
   `useMpScorecard` at `/api/db/ref-procurement`; drop the shards + fallback. Low
   effort.
5. **Migrate `invariants.data.test.ts` onto PG** (§5 Half 2) and retire the
   remaining JSON-mirror machinery (`db:build`, `gen_procurement/*`, `db:goldens`,
   derived manifest categories). Leaves the lean standing net: `pg_roundtrip`
   (base corpus) + `invariants` (PG) + `db_routes` + `search`.
6. **Workstream B** — connections → PG, the genuine "ingest to DB" migration.
   Schema+loader → API → hook migration → retire JSON. Do it in the funds/tenders
   mould. High effort, high payoff (removes the 3,342-shard connections churn +
   unifies the MP graph into the entity DB).
7. **D3/D4, Workstream C** — leave as JSON (recommendations §2 D3/D4 and §4b).
   Revisit direct raw→PG (§4c) only under repo-size pressure.

**Net effect once D1 + A + D2 + B land:** the procurement + connections pipelines
stop producing the ~16k-file commits entirely. What remains tracked is only: the
small diffable base corpus (`contracts/`, `tenders/`), two tiny static files
(`mp_party.json`, `roads.json`), and nothing derived — everything derived is
computed in Postgres and served via `/api/db/*`. **D1 alone captures ~75% of the
total churn reduction for a fraction of the effort — start there.**
