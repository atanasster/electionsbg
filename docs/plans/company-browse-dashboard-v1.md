# Company browse dashboard — v1

Status: Tiers 0–3, 6 and 7 SHIPPED 2026-08-25 (the matview, loader wiring, server registry,
client screen, retirement of `/governance/companies`, and the CLAUDE.md documentation
paragraph). Tier 4 (a tile on the top-level `/governance` hub itself — today `/companies` is
reachable from the `/governance/declarations` and `/parliament` sub-hubs, not from
`/governance` directly) and Tier 5 (the `/company/:eik` breadcrumb fix) are the remaining
open work. Brainstormed 2026-08-25 per user request: "Companies
should have a dashboard like persons — to search companies with criteria. We
should add it as a tile to the governance dashboard." Also folds in a follow-up
ask from the same conversation: the generic `/company/:eik` page should carry a
governance breadcrumb, the way `/person/:slug` does.

Scope decisions (asked and answered before drafting):

- **Population: full registry, enriched-first.** The new matview covers the
  whole `tr_companies` corpus (~1,020,707 rows as of 2026-08), not just the
  officials-linked subset. The default view/sort narrows to companies carrying
  at least one public-interest signal (public money, a political link, a
  contractor role, or an NGO entity class) — but the search box (name or EIK)
  can find ANY company in the corpus, the same way `/persons` has a public
  (`tier=P`) default with a `?sector=all` escape hatch to the private name-fold
  tier.
- **Relation to `/governance/companies`: merge.** `OfficialCompaniesScreen` and
  the `official_companies` matview (migration 178) are retired. "Linked to a
  public figure" becomes one filter toggle on the new browse
  (`?political=1`), and `/governance/companies` (+ its `/en` mirror) 301s to
  `/companies?political=1`.

## Why this shape (context from the existing codebase)

`/persons` is the precedent to copy, not invent from scratch: one Postgres
matview (`person_browse_table`, migration 120, one row per person) behind a
generic server-side `/api/db/table` registry resource (`functions/db_table.js`),
rendered by the ONE reusable `<DbDataTable>` React component
(`src/ux/data_table/DbDataTable.tsx`) with a bespoke screen supplying columns,
filters and a toolbar (`src/screens/persons/PersonsBrowserScreen.tsx` +
`src/data/persons/useUrlPersonFilters.ts`). Nothing about paging, sorting,
search-debounce or the aggregate footer gets reimplemented — `resource:
"companies"` is close to a one-line swap of that same component.

There is already a smaller precedent for exactly this shape on the company
side: `official_companies` (migration 178, resource `official_companies` in
`db_table.js`, screen `OfficialCompaniesScreen.tsx`) — companies linked to a
person in public life, 17,681 rows. It is the template for the new matview's
enrichment joins (money via a `plpgsql` wrapper to dodge a `CASCADE`
dependency trap, the registry/declared political-link union, `NULLS LAST`
sort indexes, trigram search indexes, role-guarded `GRANT`) — but its
population is a subset the new matview must strictly widen, not copy.

No existing table joins `tr_companies` to its money, place, political-link and
procurement-role signals in one row-per-company relation with FULL corpus
coverage. That join is the actual gap this plan fills.

## Tier 0 — the matview: `company_browse_table`

New migration, next number in sequence: `scripts/db/schema/pg/188_company_browse.sql`
(187 is the current highest — `187_nzok_payment_coverage.sql`).

**Base population**: `tr_companies` (003), ALL rows, `LEFT JOIN`ed against every
enrichment source — never `INNER JOIN`, or the corpus stops being "full
registry." One row per `uic`.

**Enrichment arms** (each `LEFT JOIN`, so absence is a real NULL/false/0, never
an error):

| source | what it contributes | coverage caveat |
| --- | --- | --- |
| `company_public_money` (127) | `public_money_eur` | via a `plpgsql` wrapper function reading `company_public_money`, same escape 178 already uses — 127 is `DROP`ped and rebuilt by `db:load:graph:pg`, a different loader, so a direct `LANGUAGE sql`/matview read would record a `pg_depend` edge that CASCADE-deletes this matview on every graph reload |
| `tr_company_place` (133) | `settlement`, `obshtina` (code), `oblast` (NAME — 133 has no oblast code; see 178's own comment on this), `is_village` | ~32% of ALL `tr_companies` resolve a seat (133 itself is closer to 100% of *seated* companies — the shortfall is upstream, at seat resolution). Most rows will carry NULL place. Never define the population by this join. |
| person-layer registry/declared arms (same CTEs as 178, generalized: drop 178's implicit population filter, keep the `is_public_figure` + `tr_name_fold_people` confidence gate) | `person_count`, `has_registry_link`, `has_declared_stake`, `has_current_role`, and a derived `is_official_linked := has_registry_link OR has_declared_stake` (this is the `?political=1` filter target and the entire reason `official_companies` existed) | Same privacy/confidence gate 178 already enforces — do not loosen it for the wider corpus. |
| `contractor_rank` (122), `scope_key='all', division='ALL'` | `contract_count`, `award_count`, `total_eur` (rename to avoid colliding with `public_money_eur` — e.g. `contractor_total_eur`), `is_mp_tied` | Only companies that won at least one public contract appear; everyone else NULL/0. |
| `tr_companies.entity_class` (generated column, already on the base row) | `entity_class` (company / ngo_assoc / ngo_found / chitalishte / coop / foreign_branch / state_enterprise) | Full coverage — it's derived from `tr_companies` itself. |

Deliberately **excluded from v1**: `company_nkid` (033/140, NKID/CPV sector —
bounded to the CR-Deeds-capture subset) and `company_founded` (033, ~28k-EIK
backfill). Both are legitimate future facets but are partial enough that
adding them now would either misrepresent coverage or need their own
"unknown vs. absent" column pair on day one. Flagged as Tier 8 below.

**`has_signal` (the default-view floor, NOT a hard population cut)**:

```sql
has_signal := COALESCE(public_money_eur, 0) > 0
           OR is_official_linked
           OR COALESCE(contract_count, 0) > 0
           OR entity_class IN ('ngo_assoc', 'ngo_found', 'chitalishte')
```

Mirrors `person_browse_table.tier = 'P'` as a `defaultFilters` floor in the
resource registration (below), overridable by a `?scope=all` control in the
UI — never baked into the matview's row set. A company with zero signal is
still IN the table (so an exact-EIK/exact-name search always finds it); it
just doesn't surface in the unfiltered default listing or count toward the
default aggregate.

**Search**: `name` (Cyrillic, `gin_trgm`) + `name_fold` (via
`translit_bg_latin`, gin_trgm) exactly as 178 already indexes, PLUS `uic` with
`search: true, searchEq: true, searchWhen: "[0-9]{8,14}"` — this is not a new
mechanism, it's the identical pattern `contractor_rank`/`awarder_search` (`122`,
`functions/db_table.js:1809-1810` and `:1887-1888`) already use to route a
digit-shaped query straight to an exact EIK match instead of a trigram scan.
A query typed as an EIK never needs the name index at all.

**Indexes** — copy 178's shape exactly, and get the direction right the first
time (`db_table_sort_indexes.data.test.ts` gates this house-wide): every
`sort:true` column gets a `(col DESC NULLS LAST, uic)` index matching
`buildOrder`'s emitted SQL, not a bare `DESC` index (NULLS FIRST by default —
looks identical on a fully-populated column, silently seq-scans on a sparse
one, which most of this matview's enrichment columns are).

**Retire `official_companies`**: `DROP MATERIALIZED VIEW official_companies`
in the same migration (no `CASCADE` needed — grep confirms its only readers
are the two loaders and `db_table.js`'s JS-side registry, nothing in a stored
SQL query). `company_public_money_rows()`, the plpgsql wrapper 178 defines, is
reusable as-is — don't redefine it.

**Publish wiring** — reuse 178's exact call sites rather than inventing a
standalone loader, since the widened matview keeps the same core dependency
(the resolved person layer) plus two NEW ones:

- `scripts/db/load_declarations_pg.ts` — replace the `178_official_companies.sql`
  entry in its schema-files list with `188_company_browse.sql` (same slot: it
  needs the person layer resolved, same as today).
- `scripts/db/load_graph_pg.ts` — replace its `refreshMatviewConcurrently("official_companies")`
  call with `"company_browse_table"` (money arm, same reason as today).
- **NEW**: `scripts/db/load_tr_company_place_pg.ts` (133's loader) must also
  refresh `company_browse_table` concurrently — the widened matview reads
  place, 178 never did.
- **NEW**: `db:load:pg` (contracts loader, which already refreshes
  `contractor_rank` per its existing six-matview list in `scripts/db/lib/scopedMatviews.ts`
  — verify whether `company_browse_table` belongs in `SCOPED_MATVIEWS` or needs
  its own explicit refresh call there) must also refresh
  `company_browse_table` after `contractor_rank` — the widened matview reads
  it, 178 never did.

Cloud side: apply `188_company_browse.sql` via the usual `apply_functions.ts`
hatch for a first ship, then confirm all three refreshers above run their
`:cloud` twin in the standard order (tr → graph → tr-company-place → contracts
→ declarations resolve). This needs its own CLAUDE.md paragraph once shipped,
same shape as every other migrated-family entry in that file (the project's
memory already flags "Migrated family → watch skill" as a recurring
gotcha — a new PG family that isn't wired into a watch/refresh chain goes
stale silently).

## Tier 1 — server registry (`functions/db_table.js`)

Add a `companies` resource (remove `official_companies`), modeled directly on
the `persons` block (`:1100`) for shape and on `contractor_rankings`/`official_companies`
for the EIK-search + money-index conventions:

```js
companies: {
  base: "company_browse_table",
  scopeCols: [],
  columns: {
    uic: { type: "text", filter: "in", search: true, searchEq: true, searchWhen: "[0-9]{8,14}" },
    name: { type: "text", sort: true, filter: "text", search: true, searchCol: "name_fold", searchFold: true },
    name_fold: { type: "text" },
    legal_form: { type: "text", filter: "in" },
    status: { type: "text", filter: "in" },
    entity_class: { type: "text", sort: true, filter: "in" },
    settlement: { type: "text" },
    obshtina_code: { type: "text", filter: "in" },
    oblast_name: { type: "text", filter: "in" }, // NAME column, per 178's own note — no oblast CODE source here
    public_money_eur: { type: "number", sort: true, filter: "range" },
    contractor_total_eur: { type: "number", sort: true, filter: "range" },
    contract_count: { type: "int", sort: true, filter: "range" },
    is_mp_tied: { type: "bool", filter: "eq" },
    person_count: { type: "int", sort: true, filter: "range" },
    has_registry_link: { type: "bool", filter: "eq" },
    has_declared_stake: { type: "bool", filter: "eq" },
    has_current_role: { type: "bool", filter: "eq" },
    is_official_linked: { type: "bool", filter: "eq" },   // the ?political=1 target
    has_signal: { type: "bool", filter: "eq" },
  },
  select: [ /* camelCase projection, same list */ ],
  defaultSort: [["has_signal", "desc"], ["public_money_eur", "desc"], ["name", "asc"]],
  defaultFilters: [{ col: "has_signal", val: true }],   // the ?scope=all control removes this
  aggregates: [{ fn: "count" }],   // NO sum — same reasoning persons carries: a co-officer
                                   // duplicates a company's full money onto every row it
                                   // touches only in the PERSON table, not here (this is
                                   // one row per company), so a sum here is actually safe —
                                   // VERIFY against the join cardinality before enabling it,
                                   // don't assume either way from the persons precedent.
  maxPageSize: 50,
},
```

The `aggregates`/sum caveat is flagged rather than decided because it depends
on whether any of the LEFT JOINs can multiply rows (they shouldn't — every arm
above is written as one-row-per-`uic` — but this needs an explicit row-count
assertion in the data test, not an assumption carried over from `persons`,
where the sum WAS unsafe for an unrelated reason specific to that table's
shape).

## Tier 2 — client screen

- `src/screens/companies/CompaniesBrowserScreen.tsx` — modeled on
  `PersonsBrowserScreen.tsx`'s layout (title/breadcrumb, intro line, a KPI
  strip, `<DbDataTable resource="companies" .../>`), but with a MUCH smaller
  filter toolbar for v1: entity-class select, oblast select (labeled with the
  ~32%-coverage caveat, e.g. "с известно седалище"), an "публични пари"
  numeric-range or presence toggle, and the merged-in "свързана с публично
  лице" toggle (`?political`). Money/entity-class facet options come from
  `/api/db/facets`, same as persons' `usePersonFacets`.
- `src/data/companies/useUrlCompanyFilters.ts` — owns `?q`, `?entity_class`,
  `?oblast`, `?political`, `?money` (or a `?scope=all` override of the
  `has_signal` floor), `?sort`. Same validation shape as
  `useUrlPersonFilters` (a `CODE` regex for code-like params, closed
  whitelists, silent fallback to "all" on garbage input — never throw a bad
  URL param into the query).
- Route: `src/routes.tsx`, path `companies` (top-level, mirroring `/persons`
  sitting at top level rather than under `/governance/`). Detail route
  `/company/:eik` is unchanged.

## Tier 3 — retire `/governance/companies`

Every touch point the research found, all need updating together:

- `src/routes.tsx` — drop the `governance/companies` route + the
  `OfficialCompaniesScreen` lazy import.
- `firebase.json` — the 8 existing redirect rules that currently point
  `/mp/company/**` (+ `/en` mirror) at `/governance/companies` should point
  straight at `/companies?political=1` instead of chaining through the
  retired page (avoid a double 301). ADD a new rule(s) so
  `/governance/companies` (+ `/en` mirror) itself also 301s to
  `/companies?political=1`, since it may still carry inbound links/bookmarks
  from before this change.
- `scripts/sitemap/route_defs.ts` (`:140`, `:551`) — remove the
  `governance/companies` entry; the sitemap `<loc>` becomes `/companies`
  (need to decide: does the sitemap carry `?political=1` variants at all, or
  just the bare `/companies` — almost certainly just the bare URL, per this
  repo's general practice of not minting `<loc>`s for filtered views).
- `scripts/prerender/routes.ts` — `:4655`, `:4674`, `:4684` (the
  `governance/companies` prerendered page itself) and the two "outside the
  chamber" footer links at `:5704`/`:5790` (BG/EN) — repoint prose links from
  "фирмите, свързани с депутати" / "companies linked to MPs" →
  `/companies?political=1`, and retire the standalone prerendered page in
  favor of the new `/companies` one.
- `src/screens/governance/GovernanceDeclarationsScreen.tsx` +
  `src/data/governance/useDeclarationsHubStats.tsx` — whatever stat tile
  currently links to `/governance/companies` should link to
  `/companies?political=1` and keep its existing count/caption (person_count
  or company_count off the merged matview should reproduce the same number —
  verify in the data test).

## Tier 4 — governance hub tile

`src/screens/governance/governanceRegistry.ts` — add a `GovHubTile` to the
`gov_hub_cluster_accountability` cluster (fits beside `persons`/`connections`
— the third "who/what is in the registry" browse tool):

```ts
{
  id: "companies",
  titleKey: "companies_browse_title",
  descKey: "gov_hub_companies_desc",
  to: "/companies",
  accent: TILE_ACCENTS.<pick an unused token>,
},
```

Plus a matching `id → SVG scene` entry in
`src/screens/governance/governanceScenes.tsx` (a dev-time guard in
`GovernanceScreen.tsx:39-48` throws if a tile has no scene — this is not
optional), two new i18n keys (`companies_browse_title`, `gov_hub_companies_desc`
— note `descKey` must be WRITTEN OUT, never templated, per the i18n
reachability-analysis warning already in that file), and `hubRegistry.test.ts`
will need its tile-count/contract assertions updated.

## Tier 5 — company detail page breadcrumb (the mid-turn follow-up ask)

Today `CompanyDbScreen.tsx` (`:920-932`) only shows a breadcrumb on two of
three cases:

```tsx
{isAwarderRoute ? (
  <AwarderBreadcrumb current={displayName} />
) : (
  SectorPack && <SectorBreadcrumb current={displayName} />
)}
```

A generic `/company/:eik` page with no packed sector (the common case) shows
NO breadcrumb — the comment above it says so explicitly ("generic company
pages skip it"). `/person/:slug` never has this gap: `PersonProfileScreen.tsx`
always passes a `<GovernanceBreadcrumb sectionKey="persons_title" sectionTo="/persons" current={state.profile.name} />`
into `<PersonDashboard breadcrumb={...} />`.

Fix, once `/companies` exists as a real destination: add the missing third
branch —

```tsx
{isAwarderRoute ? (
  <AwarderBreadcrumb current={displayName} />
) : SectorPack ? (
  <SectorBreadcrumb current={displayName} />
) : (
  <GovernanceBreadcrumb sectionKey="companies_browse_title" sectionTo="/companies" current={displayName} />
)}
```

`displayName` is always defined (falls back to the bare EIK — confirmed at
`:646-651`), so this is safe unconditionally, including on the `corpusOnly`
branch (procurement-only entity, no TR record) and on an entity this repo has
no record of at all. This closes the same gap `PersonProfileScreen` already
closed for people, and reuses the exact same `GovernanceBreadcrumb` primitive
— no new breadcrumb component needed.

Add/update a test alongside `CompanyDbScreen`'s existing tests asserting the
breadcrumb renders on a plain `/company/:eik` with no sector pack (the branch
that's currently silently empty).

## Tier 6 — tests / gates

- `scripts/db/tests/company_browse.data.test.ts` (new) — row-count sanity
  (matches `tr_companies` exactly, LEFT JOIN never drops/duplicates rows),
  `has_signal` floor is non-vacuous in both directions, `is_official_linked`
  count reconciles against the retired `official_companies`'s old population
  (17,681, as a regression check that the merge didn't silently narrow or
  widen that specific claim), NULLS LAST index/sort-direction match, and a
  search-arm test for the `searchWhen` EIK-shaped-query routing.
- `functions/db_table.test.js` — registry contract test for the new
  `companies` resource (same shape every other resource gets).
- `hubRegistry.test.ts` — tile/scene pairing for the new `companies` tile.
- `scripts/sitemap/families.data.test.ts` / prerender heading tests — the
  retired `/governance/companies` prerender entry and the new `/companies`
  one.
- `CompanyDbScreen` component test — breadcrumb renders on the generic path.
- `scripts/bucket_sync_paths.test.ts` — not expected to need changes (nothing
  here is bucket-served), but worth a quick check since this migration
  retires a table with two loader call sites.

## Tier 7 — CLAUDE.md documentation

Once shipped, this needs a paragraph in `CLAUDE.md` in the same style as
every other PG-migrated family — the loader trigger list (four call sites:
declarations-resolve, graph, tr-company-place, contracts), the `has_signal`
default-floor semantics, and the `~32%` place-coverage caveat — because the
project's own memory explicitly flags "a migrated family that isn't wired
into CLAUDE.md's chain documentation goes stale on prod silently" as a
recurring failure mode in this repo.

## Tier 8 — deferred / explicitly out of v1

- `company_nkid` (declared sector/NKID facet) and `company_founded` (founding
  date) — both bounded/partial sources; add once there's a clear "unknown vs.
  absent" story for each, not bundled into the v1 cut.
- Free-text search relevance beyond name/EIK (e.g. matching a director's
  name) — `person_search` already indexes the inverse direction (person →
  companies); a company → "who runs this" search-time join is a bigger,
  separate feature.
- Any `?sum` aggregate on money columns until Tier 1's join-cardinality
  caveat is verified.

## Open questions to settle before Tier 0 starts

1. Exact accent token for the new governance tile (pick an unused
   `TILE_ACCENTS` value — check `governanceRegistry.ts` for what's already
   claimed across all clusters).
2. Whether `SCOPED_MATVIEWS` (`scripts/db/lib/scopedMatviews.ts`) is the right
   place to declare `company_browse_table`'s dependency on `contractor_rank`,
   or whether a standalone refresh call in `db:load:pg` is cleaner — needs a
   read of that file's exact contract before Tier 0's migration is written.
3. Confirm no other consumer beyond the six touch points found in Tier 3 reads
   `governance/companies` or `official_companies` before deleting either (the
   grep in this plan's research is a snapshot, not a gate).
