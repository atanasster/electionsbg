# Connections engine (Phase 3+4) — implementation spec v1

Status: **DRAFT (2026-08-02), implementation-ready.** Decomposes Phase 3 (the unified graph PG
engine) **and** Phase 4 (the `/connections` rebuild) of
[people-connections-consolidation-v1.md](people-connections-consolidation-v1.md) into drivable
steps for `/implement-plan`. Follows the S0–S5 Phase-1 run (search/browse/person layer, shipped).

## Locked decisions (2026-08-02)
1. **Approach A — three `graph_*` precompute tables** (`graph_person_node` / `graph_company_node` /
   `graph_edge`) + a loader, over extending `person_connections()` live. Decoupled serving store,
   matches the `direct-db-ingest` pattern, no live-perf risk on the ego path.
2. **Scope = P3 engine + P4 `/connections` rebuild** — re-point the screen + per-MP minis onto the
   new endpoints and retire the `build_connections_graph.ts` → `connections*.json` pipeline.

## The two lineages being unified (from the map)
- **Co-ownership (no money):** `person_role` (source `'tr'`/`'ngo'`, EIK-exact on `person_id`) —
  the spine of `person_connections()` (084). Plus the SEPARATE SQLite→JSON `build_connections_graph.ts`
  → `connections*.json` powering `/connections` + per-MP minis. Same graph, computed twice.
- **Procurement (has money):** `company_politicians` (008; `eik`, `ref`, `kind`, `total_eur`,
  `relations`) built by `cross_reference.ts`/`pep_connected.ts`, loaded by `load_tr_pg.ts`.
- **Both reconcile on `person_id` + `eik`** (`person_role.ref` and `company_politicians.eik` are the
  same `tr.uic` key space). **Per-eik broad money** (contracts ∪ agri_subsidies ∪ fund_beneficiaries,
  grouped by eik) is ALREADY shipped, inlined in `120_person_browse.sql` (`nf_company`) and
  `resolve_persons.ts` (`money_eik`) — Step P3.1 makes it reusable.
- **Post-S4:** `person_role` holds `source='tr'` for public figures AND the ~53k verified privates
  (`identity_confidence='verified'`, `is_public_figure=false`). `person_connections()`'s
  `is_public_figure` gate currently excludes them — the Tier-V toggle relaxes it.

---

## Phase 3 — the engine

### P3.1 — reusable per-eik broad money (`company_public_money`)
The contracts∪subsidies∪funds UNION is inlined twice. Extract it ONCE as a SQL source the graph
loader (and, later, anything else) reads:
- **New** `scripts/db/schema/pg/127_company_public_money.sql`: a MATERIALIZED VIEW
  `company_public_money (eik, public_money_eur)` = the shipped UNION, unique index on `eik`.
  (A matview, not a function — the loader scans it once for ~all EIKs; a per-eik function would be
  N correlated subqueries.) REFRESHed by `db:load:pg` (rides the contracts corpus).
- **Tests:** `company_public_money.data.test.ts` — reconciles a sample of eiks against the live
  `contracts`/`agri_subsidies`/`fund_beneficiaries` sums; asserts it matches 120's `nf_company` basis.
- **Gate/commit:** `p3 step 1: company_public_money reusable per-eik money matview`.

### P3.2 — the `graph_*` schema (migration 128)
- **New** `scripts/db/schema/pg/128_graph.sql`, three TABLEs (rebuilt-on-load, like `contractor_search`):
  - `graph_person_node(person_id bigint PK, slug text, name text, facet text, position_type text,
    identity_confidence text, is_public_figure bool, public_money_eur double precision, degree int)`
    — one row per person with ≥1 edge; `public_money_eur` = Σ over the person's linked company nodes.
  - `graph_company_node(eik text PK, name text, public_money_eur double precision, officer_count int)`
    — from `company_public_money` + `graph_edge`; `officer_count` = distinct linked persons (the
    association-noise signal, cf. `public_officer_count()` in 084).
  - `graph_edge(person_id bigint, eik text, kind text CHECK (kind IN
    ('tr_role','tr_owner','declared_stake','procurement')), is_current bool, confidence text,
    role text)` — PK/unique `(person_id, eik, kind, role)`; indexes on `person_id`, `eik`.
- **Gate/commit:** `p3 step 2: graph_* schema (nodes + edges)`.

### P3.3 — the loader (`load_graph_pg.ts`)
- **New** `scripts/db/load_graph_pg.ts` (mirrors `load_persons_browse_pg.ts` shape): rebuild the three
  tables + the blob into UNLOGGED stage twins, then merge all four in one tx
  (`scripts/db/lib/stage_merge.ts`). Shipped as TRUNCATE+rebuild-in-one-tx, which
  `person_reload_locks.data.test.ts` correctly flagged: all four are served (084 + `/connections`), so
  the AccessExclusiveLock TRUNCATE holds until COMMIT would 500 those routes for the whole load.
  - `graph_edge`: co-ownership edges from `person_role WHERE source IN ('tr','ngo')`
    (kind `tr_role`/`tr_owner` by role) **∪** procurement edges from `company_politicians` joined
    to the person layer (`ref` → `person_id` via `person_role` source mp/official, kind `procurement`).
    Declared-stake edges (`declared_stake`) fold in if a PG stake source exists; else deferred.
  - `graph_company_node`: distinct `eik` in `graph_edge` ⨝ `company_public_money` (money) +
    `officer_count` = distinct `person_id` per eik.
  - `graph_person_node`: distinct `person_id` in `graph_edge` ⨝ `person_browse_table`
    (slug/name/facet/position_type/identity_confidence/is_public_figure) + `public_money_eur` rolled
    from the person's DISTINCT linked `graph_company_node`s + `degree`.
  - **Association-noise guard preserved:** exclude edges whose company `officer_count > 6` from the
    person-money rollup and the ego serving (the 084 `MAX_CO_OFFICERS=6` rule; keep the edge but
    flag/skip in serving) — decide in impl whether to filter at load or serve time.
- npm `db:load:graph:pg` + `:cloud`; wire into `db:refresh` AFTER `db:load:persons-browse:pg`
  (reads it) and `db:load:tr:pg` (company_politicians). Preflight asserts inputs present.
- **Tests:** `graph.data.test.ts` — every `graph_edge.person_id` ∈ person, `.eik` ∈ company node;
  money on company nodes reconciles with `company_public_money`; person money = Σ linked companies;
  both lineages present (a `procurement` and a `tr_role` edge exist); the >6-officer guard holds.
- **Gate/commit:** `p3 step 3: graph loader (co-ownership ∪ procurement, money on company nodes)`.

### P3.4 — the down-sampled global blob (migration 129 + loader step)
The full graph is too big to ship (15.6 MB `connections.json`). Precompute a top-N blob:
- **New** `scripts/db/schema/pg/129_graph_payloads.sql`: `graph_payloads (scope text PK, payload jsonb)`
  — a down-sampled node/edge set (top-N by money/degree) for the global `/connections` view, plus the
  facet×facet matrix aggregate. Built in `load_graph_pg.ts` (or a sibling step) after the tables.
- **Tests:** `graph_payloads.data.test.ts` — blob node count ≤ cap; every blob edge's endpoints are
  in the blob node set; facet×facet cells reconcile.
- **Gate/commit:** `p3 step 4: graph_payloads down-sampled global blob + facet×facet matrix`.

### P3.5 — serving routes + re-point `person_connections()`
- **`functions/db_routes.js`:** `graph-global` (reads `graph_payloads` for the whole-graph view) +
  `graph-ego?slug=` (reads `graph_*` for one person's neighborhood — nodes + edges + money).
- **`084_person_connections.sql`:** re-point `person_connections()` to read `graph_edge`/`graph_*`
  (so `/person` "Свързани лица" and the ego endpoint share one lineage) AND now carry **procurement
  money on company nodes** — the visible P3 deliverable on the existing tile. Add the **Tier-V toggle**
  (`p_include_private` bool: default false = is_public_figure only; true relaxes to admit
  `identity_confidence='verified'`, still suppressing `name_fold`/degree>guard). 084 is
  applied-not-loaded (ship via `apply_functions.ts`). Keep its buffer-ceiling perf test green.
- **Tests:** extend `person_connections.data.test.ts` — money now present on company nodes; the
  toggle admits/suppresses Tier-V; buffer ceiling still holds (reading `graph_*` should be CHEAPER).
- **Gate/commit:** `p3 step 5: graph serving routes + person_connections re-pointed (money + Tier-V toggle)`.

### P3.6 — cloud + changelog wiring
- `recent_updates` entry + both changelogs ([reference_two_changelogs]); `db:load:graph:pg:cloud`;
  the migrated-family watch-reload entry ([reference_migrated_family_watch_reload]) so a
  tr/procurement/person reload re-derives the graph on prod. Document the cloud order in CLAUDE.md
  next to the other person-layer `:cloud` loaders (graph loads AFTER persons-browse + tr).
- **Gate/commit:** `p3 step 6: graph cloud-reload + changelog wiring`.

---

## Phase 4 — the `/connections` rebuild

### P4.1 — `/connections` screen onto the new endpoints
- Re-point `ConnectionsScreen.tsx` off `useConnectionsGraph`/`useConnectionsStats`/`…PartyMatrix`/
  `…TopPairs`/`…Rankings` (static JSON) onto `graph-global` (blob) — node population = all governance
  facets + Tier-V toggle ("включи частен сектор"); money on company nodes; the orbital graph + BFS
  path-finder re-sourced from the blob; **facet×facet matrix** generalizing party×party (party×party
  stays the default slice when facet=политик). Keep node-click → `graph-ego` drill-in.
- **Tests:** component tests for the new hooks + the facet×facet matrix builder (pure helper).
- **Gate/commit:** `p4 step 1: /connections screen on the graph engine (facet×facet + Tier-V toggle)`.

### P4.2 — per-MP mini graphs onto the ego endpoint
- Re-point `MpConnectionsMini`/`MpConnectionsTile`/`useMpConnections` (static `mp-connections/*.json`)
  onto `graph-ego` (by the MP's person slug). Same shape, live.
- **Gate/commit:** `p4 step 2: per-MP mini graphs on graph-ego`.

### P4.3 — retire the static pipeline
- Delete `build_connections_graph.ts` + the `connections*.json` / `mp-connections/*` /
  `official-connections/*` outputs + the now-orphaned hooks; drop the pipeline from the
  update-connections skill + `db:refresh`/data pipeline. Keep `company_politicians`
  (a live PG source the graph loader reads).
- **Tests:** a guard that no screen imports the retired hooks; the update-connections skill no longer
  references the JSON builder.
- **Gate/commit:** `p4 step 3: retire build_connections_graph.ts + connections*.json`.

---

## Risks
1. **Ego perf.** person_connections now reads `graph_edge` — should be CHEAPER than its live scan, but
   the buffer-ceiling test must stay green ([person_connections.data.test.ts]).
2. **Declared-stake edges** may have no PG source (they live in the declarations/SQLite pipeline). If
   so, `declared_stake` folds in only when that lands on PG — note it, don't block P3 on it.
3. **Cloud staleness.** Three-ish new objects (`company_public_money`, `graph_*`, `graph_payloads`)
   need `:cloud` reloads after every upstream — the watch-reload entry (P3.6) is load-bearing.
4. **The `/connections` orbital-graph rebuild (P4.1)** is a substantial UI change; the down-sampled
   blob must stay renderable (node cap) and the BFS path-finder re-sourced correctly.
5. **`company_politicians` → person_id join.** `ref` is `/candidate/mp-<id>` | `/officials/<slug>`;
   the loader must map it to `person_id` via `person_role` (source mp/official ref), like 120's
   `bridge_a`. A miss drops a procurement edge silently — the loader preflight must count mapped vs total.

## Success criteria
- One PG graph engine (`graph_*`) unifying co-ownership ∪ procurement, money on company nodes.
- `/person` "Свързани лица" and `/connections` + per-MP minis all read the SAME engine; the static
  `connections*.json` pipeline is retired.
- Procurement money now visible on connection company nodes; Tier-V private toggle works; the
  facet×facet matrix generalizes party×party.
- No cloud staleness (watch-reload wired); ego perf under the existing ceiling.
