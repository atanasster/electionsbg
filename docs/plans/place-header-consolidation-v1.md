# Place-header consolidation — implementation plan v1

Status: IMPLEMENTED (2026-07-30) via /implement-plan — Phases 1, 2, 4a, 4b, 5 landed as five
commits on main (Phase 3 deferred by design). Local verification only; the Cloud SQL + hosting
deploy is a HELD operator action — see the sequence in Phase 5 below. **Follow-up surfaced by
the Phase 5 parity gate:** Sofia PROVINCE is named inconsistently across the two label
dictionaries — `OBLAST_NAME["SFO"]="Софийска област"` (place_dim → procurement) vs
`regions.json["SFO"]="София област"` (parliamentary). Pre-existing (not introduced here),
pinned by `place_header_consolidation.data.test.ts`; reconciling to one canonical name is a
data-owner decision (it changes a visible label on one side).

Owner: TBD. Scope selected by the operator: **hybrid staged (option C)**
— consolidate the place-identity headers onto shared components, PG-backed where it pays off, WITHOUT
retiring the 940 KB `data/settlements.json` across its ~30 map/table/search consumers (that is a
separate effort — see [db-payload-diet-v1.md](db-payload-diet-v1.md) and §"Out of scope").

One-line thesis: today the same place wears three different identity headers — the mature shared
`PlaceHeader` Card hero (parliamentary/governance/local/consumption, screenshot 1: "Варна · Община
Варна, област Варна" + map thumbnail + view switcher), a bespoke procurement subline
(screenshot 2: "Варна · Варна · EKATTE 10135"), and a free-text awarder "seat" line. Unify them onto
**two** shared primitives — a place **hero** (`PlaceHeaderView`) for pages that ARE a place, and a
compact **seat line** (`PlaceSeatLine`) for pages about an ENTITY that HAS a seat — both fed from the
canonical PG place dictionary `place_dim` (migration 117), so a PG-served page renders the unified
header without pulling the 940 KB client JSON.

---

## 0. Pre-implementation audit — corrections that SUPERSEDE the text below

Where §0 conflicts with a later section, §0 wins. This section folds in the gap audit.

### 0a. THREE design decisions to CONFIRM before writing code (recommendations flagged)

- **D1 — Two shared primitives, not one. The awarder is an ENTITY, not a place.**
  `PlaceHeaderView`'s `<h1>` is the *place* name. On `/awarder/:eik` the primary identity is the
  *company* (`CompanyDbScreen.tsx:692-699`); the seat is one attribute rendered as a free-text line
  (`:734-738`). Putting the place hero there would demote the company. **Recommendation (confirm):**
  build **two** components — `PlaceHeaderView` (the hero) for place pages, and `PlaceSeatLine` (a
  compact, linked *settlement · obshtina · oblast* breadcrumb) for entity pages. Both read `place_dim`.
  In-scope adopter of `PlaceSeatLine` for v1 = the awarder page; follow-on adopters (not v1) =
  `CompaniesHqTile`, `/farm/:eik`, funds contractor rows.

- **D2 — Full hero (with view switcher) on the procurement settlement page.**
  The Card hero (accent border + eyebrow + `PlaceViewNav` switcher + thumbnail) is designed for
  top-level place dashboards; the procurement settlement page is a drill-down under its own
  `ProcurementBreadcrumb` + KPI strip, so a compact block is defensible. **Recommendation (confirm):**
  use the **full hero WITH the switcher**, keeping the existing `ProcurementBreadcrumb` section trail
  ABOVE it. Rationale: consolidation is the goal — the procurement-Варна page should be pivotable to
  parliamentary/governance/local/consumption Варна, folding procurement into the place-view family.
  (Grain note: screenshot 1 is Варна *município* `/settlement/VAR06`; screenshot 2 is Варна
  *settlement* `гр. Варна` EKATTE `10135` — both are legitimate `PlaceHeader` levels, `municipality`
  vs `settlement`, so this is consistent, not a mismatch.)

- **D3 — `place_dim` gains oblast NAMES via `kind='oblast'` rows (not a route-side static map).**
  The hero/seat need an oblast name; `place_dim` deliberately has no `kind='oblast'` (117 header:
  oblast_code is a pointer into `src/lib/regionalOblast.ts`, "adding that kind is the natural
  extension if one ever appears"). **Recommendation (confirm):** add the 28 `kind='oblast'` rows
  (name_bg/name_en from the same helpers `obshtinaLabels`/`regionalOblast.ts`), making identity
  resolution a pure self-join and future-proofing the standalone route (Phase 3). Cost: one
  `CHECK (kind IN …)` constraint change (NOT purely additive — see 0c). Alternative rejected: a
  28-row static map inside `functions/db_routes.js` avoids the schema change but duplicates the name
  source away from the canonical dictionary.

### 0b. Architectural corrections / reuse (don't reinvent)

- **`PlaceHeader.tsx` already exists and is mature** (`src/screens/components/PlaceHeader.tsx`,
  884 lines) — Card shell, `StaticOsmThumbnail` (3×3 OSM mosaic, lines 105-179), `renderNarrative()`
  (lines 353-747), `PlaceViewNav` switcher, `extra` + `navSlot` optional slots (already present,
  lines 67/75). The refactor EXTRACTS a pure view from it; it does not rewrite it.

- **`place_dim` (117) is the ready-made PG dictionary**: `(kind, code) → name_bg/name_en` +
  containment `oblast_code`/`obshtina_code`/`mir_code` + Sofia crosswalk (`shard_code`/
  `governance_code`/`price_code`, described in the 117 header as "scaffolding for a later
  consolidation" — this IS that consolidation). Loaded by `scripts/db/load_place_dim_pg.ts`
  (`db:load:place-dim:pg`) from `data/settlements.json` + `data/municipalities.json` via
  `scripts/person/places.ts` (`obshtinaLabels`/`mirLabels`). Already serves `name_en` to the
  procurement ranking matview (`119_procurement_settlement_scoped.sql:44,62`) and mir/obshtina labels
  to `/person` (`082_person_api.sql:60-66`).

- **The procurement settlement page is already PG-served and NEVER loads settlements.json.**
  `useSettlementProcurement` → `/api/db/procurement-settlement` → `procurement_settlement_detail()`
  (`functions/db_routes.js:748`). So the win is NOT "stop loading JSON" (it already doesn't) — it is
  "render the SAME hero as the parliamentary page, and fix its English localization" (see 0c).

- **The awarder already has place CODES** in `awarder_seats` (`021_awarder_seats.sql`:
  `eik → ekatte, settlement, municipality, oblast`). So `PlaceSeatLine` for the awarder is feasible
  from a self-join to `place_dim`; the current free-text `tr_companies.seat` (registered office) is a
  DIFFERENT, more-precise notion and stays as an optional secondary line.

- **Fold identity into the payloads the two pages already fetch — do NOT add a per-page place fetch.**
  `procurement_settlement_detail()` already LEFT JOINs `place_dim` (elsewhere in 119); the company
  payload already joins `awarder_seats`. Extending those returns identity for free. The standalone
  `/api/db/place` route (Phase 3) is therefore NOT needed for option C and is deferred.

### 0c. BLOCKERS / gotchas — resolve while coding

- **The narrative composer is the hard part, and it must be decoupled — not left in the wrapper.**
  `renderNarrative()` mixes data resolution (`findSettlement`/`findMunicipality`/`findRegion`) with
  branch logic (Sofia район, city-район, abroad, section, oblast-suffix stripping) and drill-up
  hrefs (`placeViewUrl`). If the extracted view "just renders `narrative: ReactNode`", the PG page
  can't reuse it. Phase 1 must lift narrative composition into a **pure function of structured
  containment** `{name, type, muniName, muniHref, oblastName, oblastHref, flags, lang}`. MITIGANT:
  the procurement hook enforces `/^\d{5}$/` on the ekatte, so ISO-diaspora rows and composite
  Sofia-район EKATTEs ("68134-2401") NEVER reach it — the PG resolver only reproduces the
  **plain-settlement branch**, not the full matrix.

- **English-localization bug on the procurement page (fix while here).** Its name comes from
  `awarder_seats.settlement` (Bulgarian only), not `place_dim` — so the page is BG-only even in EN
  mode. Switching the hero to `place_dim.name_bg/name_en` (COALESCE fallback, mirroring 119) fixes it.

- **Oblast-name divergence — the exact place consolidation must NOT disagree.** `place_dim.oblast_code`
  is the STATISTICAL oblast fold (PDV-00→PDV, S2x→SOFIA_CITY, per 117 header); `PlaceHeader`/
  `useRegions` resolves oblast from the settlement's МИР-namespace `oblast` field. They AGREE for
  Варна but DIVERGE for **гр. Пловдив** and **София-град**. Phase 5 carries a parity test asserting
  Варна + Пловдив-град + София-град render identical oblast wording across the parliamentary and
  procurement pages; reconcile in the resolver (prefer the МИР→region mapping the client already uses
  for the label, so the two pages match) rather than shipping two different oblast strings.

- **`place_dim` is NOT purely additive in Phase 2 — but amend 117 in place (VERIFIED).** 117 is
  `CREATE TABLE IF NOT EXISTS` and already on Cloud SQL (applied every `db:resolve:persons`,
  `resolve_persons.ts:1006`), so an amended CREATE won't alter the existing table. Evolve it like
  `021_awarder_seats.sql`: append `ALTER … ADD COLUMN IF NOT EXISTS loc/settlement_type` + a guarded
  `DO $$…$$` CHECK-swap to include `'oblast'` (no `ADD CONSTRAINT IF NOT EXISTS` in PG). The loader
  self-applies 117 before its TRUNCATE+COPY (`load_place_dim_pg.ts:232`→`:251`), so the constraint
  swap precedes the oblast-row COPY and `db:load:place-dim:pg:cloud` carries schema + data together
  (migration-before-writer satisfied — `reference_migrated_family_watch_reload`). Full detail: Phase 2.

- **GRAO must become an INJECTED slot.** `PlaceHeader` auto-fetches GRAO at settlement level
  (`useGraoMunicipalitySlice`, line 257) and renders a population row (804-828). If the extracted view
  keeps that internal, the procurement page silently gains an unwanted fetch + row. The view takes
  `grao?` as an optional prop; the JSON wrapper fills it, the PG resolver omits it.

- **SEO — gap + opportunity.** `/procurement/settlement/:id` IS prerendered / in the sitemap
  (`scripts/sitemap/route_defs.ts:391`, enumerated from PG at `index.ts:743`), but the page emits NO
  meta today (`<Title>` has no `description`, so no `<SEO>` fires). Moving to `PlaceHeaderView`
  preserves the status quo — but since these are indexed URLs (`project_seo_discovery_gap`), Phase 4a
  ALSO adds a proper `<SEO title description>` for the page.

---

## 1. Current-state inventory

| Surface | Route(s) | Header today | Identity source |
|---|---|---|---|
| `PlaceHeader` (shared, ~20 screens) | `/settlement/:id`, `/sections/:id`, `/municipality/:id`, `/sofia`, `/governance/*`, `/consumption/*`, `/local/:cycle/*` | Card hero: eyebrow + `<h1>` + breadcrumb + OSM thumbnail + `PlaceViewNav` | client JSON: `settlements.json` (940 KB) + `municipalities.json` (41 KB) + `regions.json` + GRAO |
| Procurement settlement | `/procurement/settlement/:ekatte` | bespoke `<Title>` + `province · obshtina · EKATTE` subline | PG `procurement_settlement_detail()` — name is `awarder_seats.settlement` (BG only) |
| Awarder seat | `/awarder/:eik` (`CompanyDbScreen`) | bespoke free-text `seat` line under company `<h1>` | PG payload `seat` string (`tr_companies.seat` / `institution.locality`) |

Only the two bespoke surfaces sit outside `PlaceHeader`. The awarder is an entity (D1); the
procurement settlement is a place.

## 2. Target architecture — two shared primitives, one PG dictionary

```
place_dim (117, PG)  ──►  place identity {name_bg/en, settlement_type, obshtina{code,name}, oblast{code,name}, loc}
        │                         │
        │                         ├──► PlaceHeaderView   (pure hero: eyebrow · h1 · narrative · thumbnail · nav · extra/grao slots)
        │                         │        ▲ JSON resolver (wrapper, unchanged 20 call sites)
        │                         │        ▲ PG resolver  (procurement settlement — folded into procurement_settlement_detail)
        │                         │
        │                         └──► PlaceSeatLine     (compact linked settlement · obshtina · oblast)
        │                                  ▲ awarder page (folded into the company payload via awarder_seats→place_dim)
        └─ containment self-join gives obshtina/oblast names
```

## Phase 1 — Extract `PlaceHeaderView` (pure) + decouple the narrative

1. New `src/screens/components/place/PlaceHeaderView.tsx`: takes a resolved `PlaceIdentity`
   (`titleText`, `settlementType`, `containment` for the narrative, `loc`, eyebrow `meta`, and
   OPTIONAL slots `grao?`, `extra?`, `navSlot?`, `switcher?`). Move `StaticOsmThumbnail` +
   Card/eyebrow/thumbnail/switcher layout here.
2. New `src/screens/components/place/placeNarrative.tsx`: pure `renderPlaceNarrative(containment, lang)`
   lifted from `renderNarrative()` — takes structured names + hrefs + flags, returns nodes. Covers the
   full existing matrix (Sofia район / city-район / abroad / section / município / settlement).
3. `PlaceHeader.tsx` becomes a thin JSON-backed wrapper: resolves via the existing hooks, builds
   `PlaceIdentity` (incl. `grao`), and renders `PlaceHeaderView`. **All 20 call sites and their
   rendered output are byte-identical.**
4. Tests: component snapshot parity for settlement / município / region / section / Sofia-район /
   abroad before any repoint (guards the extraction).

## Phase 2 — Make `place_dim` header-complete (amend 117 + loader together)

**Amend `117_place_dim.sql` in place** (VERIFIED 2026-07-30 — resolves open-question 3). Why not a
new 121: 117 is already applied on every `db:resolve:persons(:cloud)` (`resolve_persons.ts:1006`
`SCHEMA_FILES`) AND self-applied by the loader before its TRUNCATE+COPY
(`load_place_dim_pg.ts:232` → `:251`); the person layer is live so the cloud table exists. A new file
would need wiring into `SCHEMA_FILES`; 117 is already wired everywhere. But 117 is `CREATE TABLE IF
NOT EXISTS`, so an amended CREATE does NOT alter the existing table — evolve it the way
`021_awarder_seats.sql` does:
- append `ALTER TABLE place_dim ADD COLUMN IF NOT EXISTS loc text;` and `… settlement_type text;`
- swap the `CHECK` to include `'oblast'` via a **guarded `DO $$ … $$` block** (Postgres has no
  `ADD CONSTRAINT IF NOT EXISTS`): drop the existing `kind`-check constraint if present, re-add it
  with `kind IN ('settlement','obshtina','mir','oblast')`. Idempotent (re-applied every resolve).

Row content stays in the loader (not DML in the schema file): update `load_place_dim_pg.ts` to
populate `loc` (both source files carry `loc`) + `settlement_type` (`t_v_m`) for settlements, emit
the 28 `kind='oblast'` rows (name_bg/name_en from `obshtinaLabels`/`regionalOblast.ts`), and extend
the COPY column list. Because the loader self-applies 117 first, the constraint swap lands BEFORE the
oblast rows are COPYed — no separate migration-apply step. Extend `place_dim.data.test.ts`: every
settlement/obshtina row has `loc`; `settlement_type` present for settlements; 28 oblast rows resolve
name_bg/name_en.

## Phase 3 — (DEFERRED) standalone `/api/db/place` route

Not built for option C — both v1 pages fold identity into existing payloads (0b). Documented here as
the natural next step when migrating the JSON-backed pages off `settlements.json`
([db-payload-diet-v1.md](db-payload-diet-v1.md)). Shape when built: `place_identity(kind, code)` SQL
fn (self-join for obshtina name, oblast row for oblast name) + a `place` route + a `usePlaceIdentity`
hook, all app_readonly.

## Phase 4 — Repoint the two pages

**4a. Procurement settlement (place hero).**
- Extend `procurement_settlement_detail()` to also return `name_en` + `{obshtina_code, obshtina_name_bg/en}` + `{oblast_code, oblast_name_bg/en}` via `place_dim` (COALESCE fallback to the current BG name).
- Replace the bespoke `<Title>` + subline with `PlaceHeaderView` (full hero, D2, `active="governance"`), keeping `ProcurementBreadcrumb` above and the KPI strip + `FollowStar` (in the `extra` slot) below. Omit `grao`. **Drop the terse "EKATTE 10135" chip** (operator decision 2026-07-30) — the hero uses the same composed breadcrumb as the parliamentary page, no EKATTE code.
- Add `<SEO title description>` for the route (0c).

**4b. Awarder seat (entity seat line).**
- New `src/screens/components/place/PlaceSeatLine.tsx`: compact linked `settlement · obshtina · oblast` from resolved codes+names.
- Extend the company/awarder payload (`db_routes.js`) with `awarder_seats → place_dim` codes+names; render `PlaceSeatLine` in place of the free-text seat, keeping `tr_companies.seat` as an optional secondary "седалище по регистър" line where it differs.

## Phase 5 — Tests + deploy

- **Data tests** (auto-skip when PG down): `procurement_settlement_detail` returns `name_en` +
  obshtina/oblast names for `10135` (Варна), null-safe for a missing ekatte; the awarder payload
  returns place codes+names for a known EIK.
- **Parity test** (0c): Варна + Пловдив-град + София-град show identical oblast wording on the
  parliamentary and procurement pages.
- **Component tests**: `PlaceHeaderView` (all branches), `PlaceSeatLine`, both repointed pages.
- **Deploy ordering** (CLAUDE.md): `db:load:place-dim:pg:cloud` (self-applies the amended 117 —
  columns + constraint swap — then COPYs the new columns/oblast rows, so it is BOTH the migration and
  the data) → re-run the place-dim-dependent refreshes (`db:load:procurement-scopes:pg:cloud`,
  `db:load:persons-browse:pg:cloud` per CLAUDE.md) → apply the serving-fn changes to Cloud SQL
  (`procurement_settlement_detail` + the awarder payload SQL via `apply_functions.ts`) →
  `deploy:db` → `deploy` (hosting last). Run `functions:test` for the `db` function.

## Out of scope (explicitly)

- Retiring `settlements.json` / `municipalities.json` across the ~30 map/table/search consumers — a
  separate payload-diet effort. This plan removes NO existing JSON load; it only avoids ADDING one to
  the PG pages.
- Migrating the 20 JSON-backed `PlaceHeader` screens onto a PG place route (needs Phase 3 first).
- Follow-on `PlaceSeatLine` adopters beyond the awarder (`CompaniesHqTile`, `/farm/:eik`, funds
  contractor).

## Open questions

1. Confirm D1 / D2 / D3 (§0a). — *D1/D2/D3 recommendations accepted (operator, 2026-07-30).*
2. ~~EKATTE chip~~ — **RESOLVED: drop it** (operator, 2026-07-30). See Phase 4a.
3. ~~Amend 117 vs new 121~~ — **RESOLVED: amend 117 in place** (verified 2026-07-30). See Phase 2.
