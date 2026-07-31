# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**electionsbg.com** — A single-page application for visualizing and analyzing Bulgarian parliamentary elections since 2005. Live at [electionsbg.com](https://electionsbg.com).

The app is a JAMstack SPA: data is pre-processed offline into static JSON files in `/public`, then fetched client-side with React Query. There is no backend server.

## Commands

```bash
npm run dev          # Start Vite dev server
npm run build        # TypeScript check + production Vite build
npm run lint         # ESLint (prettier runs as an eslint rule, not a separate step)
npm run preview      # Preview the production build locally

# Tests
npm run test:unit    # Vitest — unit + component tests (src/** jsdom, scripts/** node)
npm test             # Playwright — E2E / SEO / perf / UI smoke (needs a built dist/)
npm run test:coverage # Vitest v8 coverage report

# Data pipeline (offline processing)
npm run data         # Process election data (tsx ./scripts/main.ts)
npm run prod         # Full pipeline with --all --prod flags
npm run sitemap      # Generate sitemap

# Postgres (local Docker; db:refresh runs the whole load in order)
npm run db:pg:up     # Start local Postgres (port 5433)
npm run db:refresh   # Full reload: schema + every loader + resolve + test:data

# Deployment
npm run deploy       # Deploy to Firebase (elections-bg project) — HOSTING ONLY
npm run deploy:db    # Deploy the `db` Cloud Function (/api/db + the /officials 301)
npm run staging      # Deploy to Firebase staging (electionsbg-staging)
```

**`npm run deploy` ships hosting only.** When a change spans hosting and the `db` function
— a new `/api/db` route, a new hosting rewrite pointing at it — deploy in this order:

1. the Cloud SQL migration (`npm run db:*:cloud`),
2. `npm run deploy:db`,
3. `npm run deploy`.

Hosting first means the rewrite is live against a function that cannot serve it yet.

The same migration-before-writer rule applies to the hand-run ingests that have no
`db:load:*:cloud` wrapper. `company_founded` writes `http_status`/`attempts`, so
`033_procurement_risk_indexes.sql` must be applied to the target database first:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts 033_procurement_risk_indexes.sql
```

The founding-date writer (`upsertFoundingDates`) preflights and throws with that command in
the message if the columns are missing.

**CR Deeds full-capture** (`docs/plans/cr-deeds-capture-v1.md`) supersedes the old
`fetch_company_founded` crawl. The rate-limited crawl is an operator action — `npm run
tr:cr-deeds` (tiers 0/1/2a/2b/3; `--probe` first to gauge the block state); it writes the
durable raw store `raw_data/tr/cr_deeds.sqlite` (gitignored, never uploaded). Two projections
read that cache offline, no re-fetch:
- **owners** → `tr:daily-refresh` runs the persons projection automatically (inside
  `daily_refresh.ts`, additive into `company_persons`), then `db:load:cr-founding:pg` folds
  the founding dates into local `company_founded`. To publish owners + founding to prod, run
  `npm run db:load:tr:pg:cloud` and `npm run db:load:company-founded:pg:cloud` (the latter
  ships local `company_founded` → Cloud SQL, 033 applied there first). Nothing on the cloud
  side is automatic.

`procurement_annexes` (migration 114, `db:load:annexes:pg`) is the same shape: it resolves
against the `contracts` table and reads the raw ЦАИС ЕОП annex cache, so on the cloud side run
`npm run db:load:annexes:pg:cloud` **after** the contracts corpus is loaded and whenever
`ingest_anexi` refreshes the cache — otherwise the per-annex breakdown (and the чл.116 ал.2
vs ал.3 labeling on the contract page) goes stale on prod while local is current. `db:refresh`
runs the local equivalent automatically (after `db:load:pg`); nothing runs it on the cloud side.

The data pipeline CLI (`scripts/main.ts`) accepts flags: `--all`, `--prod`, `--date`, `--election`, `--reports`, `--stats`, `--search`, `--financing`, `--parties`, `--machines`, `--candidates`.

### Person layer — the one step `db:refresh` cannot infer

Deploying the person layer to **Cloud SQL** needs one extra command after
`db:resolve:persons:cloud`:

```bash
npm run person:slug-redirects:cloud -- raw_data/person/officials_reslug_2026_07_24.json
npm run person:slug-redirects:cloud -- raw_data/person/officials_reslug_2026_07_29.json
```

They load the officials re-slug maps into `person_slug_retired`, so the ~20.8k `/person` URLs
minted under pre-2026-07-24 officials slugs 301 instead of 404. The loader upserts, so each
dated map composes; add a line here whenever a new one lands (2026-07-29 is the collision-fold
drop — see `raw_data/person/README.md`). `db:refresh` runs the local equivalent automatically;
nothing runs it on the cloud side. See `raw_data/person/README.md` and
`docs/plans/persons-pg-retirement-v1.md` (T1.0).

**"Composes" means rows accumulate — NOT that older targets stay valid.** When a later map
retires a slug an earlier map already pointed somebody at, that earlier row becomes a 301 into
a 404 (`…ivanov1-da0219 → …ivanov1-94805e → …ivanov-b85a89` is the one that got caught). Both
writers — the loader and `db:resolve:persons` — now call `collapseSlugRedirectChains()` after
their write, so flattening is automatic and `db:resolve:persons` carries "redirect chains are
flat" as a post-condition. That matters for the cloud flows above that re-run the resolver
**without** a following `person:slug-redirects:cloud` (the judicial-bodies rerun): they stay
correct only because the resolver does it itself. The collapse only ever re-points at an
`active` + public-figure person, so a chain with no servable end is left broken and reported
rather than quietly made to look healthy — `person_slug_retired.data.test.ts` fails on it.

Likewise, after `db:load:declarations:pg:cloud -- --resolve` (which creates the municipal
roster matview), run the candidateLink loader so the Cloud SQL municipal roster carries the
party colours / councillor avatars the /governance + My-Area tiles render:

```bash
npm run db:load:official-candidate-links:pg:cloud
```

It populates `official_candidate_link` and REFRESHes `municipal_officials_table`. `db:refresh`
runs the local equivalent automatically; the cloud side does not. See
`docs/plans/persons-pg-retirement-v1.md` (T1.5).

Same shape, and it must run **BEFORE** `db:resolve:persons:cloud` rather than after: the
judicial dimension (migration 116) is what gives every magistrate their court on `/person`.

```bash
npm run db:load:judicial-bodies:pg:cloud
```

It rebuilds `judicial_body` + `judicial_body_alias` from `magistrate.court` ∪
`court_load.name`, so re-run it whenever **either** of those is reloaded on the cloud side
(`db:load:magistrates:pg:cloud`, `db:load:court-load:pg:cloud`) — then re-run
`db:resolve:persons:cloud`, which reads the alias table. Skipping it does not fail: the
resolve simply finds an empty alias table and ~2,700 magistrate roles publish with no
court, green locally and blank on prod. See
`docs/plans/person-role-place-consolidation-v1.md` (T2).

Same shape again, and also **BEFORE** `db:resolve:persons:cloud`: the canonical place
dimension (migration 117) is the code→name dictionary `082_person_api.sql` JOINs for the
`mir` / `obshtina` label on every `/person` role, and `/procurement/by-settlement` joins
for settlement names.

```bash
npm run db:load:place-dim:pg:cloud
```

It is built from `data/settlements.json` + `data/municipalities.json` (labels via
`scripts/person/places.ts`), so re-run it whenever either file changes. `db:refresh` runs
the local equivalent automatically; the cloud side does not.

Related, and the only loader whose trigger is a **calendar rollover** rather than a source
change — the pscope windows (migration 118) **and the per-scope precomputes they drive**
(migration 119, `procurement_settlement_rank` + `procurement_geo_payloads` behind
`/procurement/by-settlement`; migration 122, `contractor_rank` + `contractor_scope_kpis`
behind `/procurement/contractors`; migration 123, `procurement_settlement_payloads` behind
every `/procurement/settlement/:ekatte` page and My-Area procurement tile; migration 124,
`procurement_payloads` behind the six `/api/db/procurement-*` dashboard routes):

```bash
npm run db:load:procurement-scopes:pg:cloud
```

It writes the window rows, applies 119 + 122 + 123 + 124 and REFRESHes all six matviews
(**46 s** local, measured end to end; `contractor_rank` fans ~29.5k contractors × ~30 windows ×
CPV-division rollup ≈ 9 s, 123 fans 869 settlements × 30 windows ≈ 10 s, and 124 fans 6 kinds ×
30 windows ≈ 10 s) — so "the scopes changed" and "the precomputes match the scopes" can never
be two separate states.
`contractor_scope_kpis` reads `contractor_rank`, so it is refreshed after it. **Cloud SQL is
unmeasured and will be materially slower** — the whole reason 123 exists is that the same
per-settlement call is 401 ms locally and had not finished at the 10 s `statement_timeout`
that aborted it on a cold `db-g1-small` — so expect minutes, not seconds. Re-run it:

- whenever a new election lands in `src/data/json/elections.json` (a new `ns:` window);
- **every January** — the year windows are enumerated `SCOPE_FIRST_YEAR..currentYear`, so on
  1 January the `?pscope=y:<new year>` option appears in the UI while the table still stops
  at the old year, and that scope serves an empty page;
- after a standalone `db:load:place-dim:pg:cloud` **only when it reports that it skipped its
  own refresh** — it changes the English settlement names the ranking joins, and it now
  refreshes them itself whenever the dimension actually moved (see the side loaders
  below). Re-running this loader after it already did that is a needless multi-minute cloud
  rebuild.

The refresh list, its ORDER, **what each matview is built FROM** and the not-populated
fallback live in ONE place — `scripts/db/lib/scopedMatviews.ts`. A migration that adds a
per-scope matview must join `SCOPED_MATVIEWS` there or no loader will ever refresh it;
`procurement_settlement_payloads.data.test.ts` fails on any matview that reads
`procurement_scopes` and is missing from the list.

**The `inputs` array on each entry is as load-bearing as the name, and it fails differently.**
A missing NAME means nothing ever refreshes that matview; a wrong `inputs` means the loader for
the undeclared table skips it, so one page keeps the previous attribution while the rest of the
site has moved on. That is invisible to a row count and to the exhaustiveness gate above, which
only checks presence. `procurement_payloads.data.test.ts` closes it for 124: it reads that matview's six
function bodies out of `pg_get_functiondef` and fails if it reads a table it does not declare.
(For 124 only — no gate does this for the other entries yet.) It is not a hypothetical: 124's
first committed draft declared `["contracts", "awarder_seats"]` and missed `company_politicians`
and `tr_companies`, which four of its six aggregates read.

**Three loaders outside this one also refresh part of the list**, because they change what
those matviews are built FROM, and skipping them is invisible:

```bash
npm run db:load:awarder-seats:pg:cloud   # WHICH buyers are seated in a settlement (119+123+124)
npm run db:load:place-dim:pg:cloud       # the place hero 123 STORES in its payload (119+123)
npm run db:load:tr:pg:cloud              # company_politicians / tr_companies (122+124)
```

All three now do it themselves, and each gets only the matviews its input can actually move.
`place-dim` fingerprints the table either side of its rewrite and skips the refresh when the
rows are byte-identical, which is the usual case, so it stays cheap to run blind — it says
which it did. Without these, a standalone reload moves a buyer between settlements, blanks a
place hero, or leaves every MP-tied figure on the previous link set, everywhere on the site
**except the precomputed pages**, which keep serving the old attribution at a 200.

Two of those pairings are worth stating because they look wrong:

- **`awarder-seats` refreshes 124**, which has no settlement dimension — because one of its six
  aggregates, `procurement_concentration`, resolves each row's `oblast` from `awarder_seats`
  (86.6% of the `all` scope's 2,755 rows carry one).
- **`tr:pg` refreshes 122 and 124** but neither settlement matview. It TRUNCATEs and reloads
  `company_politicians`, the politician↔company link set every MP-tied figure derives from —
  so before this it was already leaving `/procurement/contractors`' MP-tied KPIs on the
  previous vintage, with nothing red anywhere.

`cpv_catalog` (migration 121) is the same shape but rides the TENDERS loader: `db:load:tenders:pg`
applies it and calls `rebuild_cpv_catalog()` right after the corpus commits, so on the cloud side
`npm run db:load:tenders:pg:cloud` keeps it in step with no extra command. The only ordering that
matters is the FIRST deploy — the loader must run **before** the `deploy:db` that ships the route
reading it, because that route no longer degrades a missing table to an empty array (an empty CPV
picker served with a 200 is exactly the failure it was created to end). `cpv_catalog.data.test.ts`
fails on an empty or stale table.

`contractor_rank` (migration 122) is the same first-deploy shape as `cpv_catalog`: the
`contractor_rankings` DbDataTable resource + the `/api/db/contractor-scope-kpis` route read
it and do NOT degrade a missing matview to an empty result, so on the FIRST cloud deploy the
loader must run **before** the `deploy:db` that ships them. `contractor_rank.data.test.ts`
fails on an empty or stale matview.

`procurement_settlement_payloads` (migration 123) is the deliberate OPPOSITE of those two on
first deploy. `/api/db/procurement-settlement` maps the requested window to a scope and reads
the matview, but **falls back to the live `procurement_settlement_detail()` when the
precompute cannot answer** — no stored row, or a narrow set of SQLSTATEs meaning the
matview is absent, unreadable or locked (a pool error still throws). Degrading is correct here in a
way it is not for `cpv_catalog`: it yields the RIGHT answer slowly (today's behaviour) rather
than a wrong one, so the route ships in any order, to any database. The cost is that every
reason the fast path was skipped is otherwise silent, which is why the route logs a
`psp:not-built` / `psp:read-failed` warning once per process — **that log, not latency, is the
signal that the cloud loader never ran.** `procurement_settlement_payloads.data.test.ts` fails
on a stale, partial or place-blank matview.

`procurement_payloads` (migration 124) is the same degrade-don't-fail shape as 123, applied to
the six `/api/db/procurement-*` dashboard routes — `overview`, `flow`, `rankings`,
`concentration`, `sectors`, `benchmarks` — via one shared `scopedPayload()` helper in
`functions/db_routes.js`. It exists because TWO of them exceeded the 10 s `statement_timeout`
and returned 500 on prod — `procurement-overview` on a windowed scope at 10.010 s and
`procurement-flow` with no window at 10.006 s. The other FOUR were the same shape and had
simply not been unlucky; `procurement_concentration` touches more pages than either
(411,245 vs 393,851 on the full corpus) and had no cache at all. (The third 500 in that Cloud
Run window was `/api/db/person-profile`, a different defect entirely — a point lookup that
full-scanned `person` — fixed by rewriting `person_by_name` in 082, not by a precompute.) Same log contract, different prefix: `pp:not-built` / `pp:read-failed`,
once per process per (kind, scope) — so an unbuilt `flow/all` and an unbuilt `overview/all` are
two separate lines, and a second request for either is silent. `pp:no-scope` is EXEMPT — a caller may legitimately ask for a window
that is not one of the thirty, and serving that live is designed behaviour, not a defect.

**Two SQLSTATE details on that fallback are easy to get backwards, and 123 had both wrong
until 124 was built:**

- **`55000` must be in the degrade set.** Reading a matview created `WITH NO DATA` does not
  return zero rows — it raises `object_not_in_prerequisite_state`. That is exactly a database
  where the DDL was applied and the REFRESH never ran, i.e. the first cloud deploy, which is
  the case the orderless-deploy property is about. Without it that case is a 500.
- **`57014` must NOT be.** It looks like the "locked by a REFRESH" code; that is `55P03`.
  `57014` is the pool's own `statement_timeout`, so the probe has already burned the full 10 s
  budget and falling back to an aggregate touching 199k–411k buffers cannot finish either — it
  turns a 10 s failure into a ~20 s one holding a pooled connection, under exactly the
  saturation that caused the timeout. Degrading is only correct when it beats failing.

`procurement_payloads.data.test.ts` fails on a stale matview, on a `concentration` payload whose
stored `oblast` has drifted from `awarder_seats`, and — uniquely in this repo — on a
`SCOPED_MATVIEWS` entry whose declared `inputs` do not cover what the matview reads. It
deliberately does NOT skip when the matview is absent or unpopulated: those are the two states
it exists to catch, so they are assertions, not a green skip.

**124 RETIRED two older cache matviews**, `procurement_overview_cache` (025) and
`procurement_rankings_cache` (031). Each answered exactly ONE of the thirty windows — the full
corpus — which is why every parliament window fell through to the live aggregate and 500'd.
Their migrations now carry a tombstone `DROP` and no `CREATE`; `load_pg` no longer refreshes
them; the routes no longer read them.

**The tombstone only fires when the file is APPLIED, so the cloud side needs one command** —
`deploy:db` ships function code only, and the only other cloud path that applies 025/031 is a
~68-minute full contracts reload. Without this, prod keeps two orphan matviews for ever:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts 025_procurement_overview.sql 031_procurement_rankings.sql
```

Safe to run at any time and idempotent: both files `CREATE OR REPLACE` their function (they do
NOT `DROP` it — 124 depends on it), and the `DROP … IF EXISTS` is a no-op once the matview is
gone. **Do not add `122_contractor_rank.sql` to that command** — 122 DROPs and recreates
`contractor_rank` WITH NO DATA, and `/procurement/contractors` reads it WITHOUT degrading, so
applying it would blank that page until a multi-minute refresh finished.

Of the full-corpus cache matviews on this pattern, `procurement_by_settlement_cache` (030) is
the only procurement one left — its route serves a different shape from 119/123, so it still
has a job. (`procurement_risk_indexes_cache` (033), `dual_corpus_rankings_cache` (077) and the
044 cache are unrelated and unaffected.)

`db:load:pg` also re-REFRESHes all six (guarded on existence, `contractor_rank` before
`contractor_scope_kpis`), so a contracts reload cannot leave `/procurement/by-settlement`,
`/procurement/contractors`, the settlement pages or the `/procurement` dashboard serving the
previous corpus. `db:refresh` runs the local equivalent automatically; the cloud side does not.

**Skipping it does not fail — it blanks.** `db:resolve:persons` applies 117 with
`CREATE TABLE IF NOT EXISTS`, so a cloud database that never ran this loader gets an EMPTY
dimension, `person_by_slug()` still compiles, and all ~76.5k `mir`/`obshtina` roles publish
`placeLabel: null` — green locally, blank on prod, and baked into the prerendered `/person`
HTML. The ~2.7k judicial roles keep their label (they resolve via `judicial_body`), so the
damage looks partial rather than total and is easy to miss.

Last in the person chain, and the only loader with **two** independent triggers — the
persons browser matview (migration 120) behind `/persons`:

```bash
npm run db:load:persons-browse:pg:cloud
```

It folds six upstream datasets, so it must run **after all of them**: `db:resolve:persons`,
`db:load:declarations:pg:cloud -- --resolve` (net worth **and** `declaration.person_id`),
`db:load:official-candidate-links:pg:cloud`
(the non-MP photos), `db:load:judicial-bodies:pg:cloud` + `db:load:place-dim:pg:cloud` (every
place label and the magistrates' oblast), and the contracts corpus. Re-run it:

- whenever any of those is reloaded on the cloud side — the person half is the obvious case;
- **after a contracts reload**, which is the non-obvious one: `public_money_eur` is computed
  from `contracts`, so a procurement refresh without this one lets the money column drift
  away from `/procurement/contracts` with nothing failing.

**`--resolve` is not optional, and skipping it is invisible to a row count.** Phase 2 is what
fills `declaration.person_id`; without it that column is NULL on every row, the table is still
present and full, and `person_browse_table` publishes `has_declaration = false` for all 56,801
people — the "с декларация" filter matches nobody and its KPI reads 0%, while net worth keeps
rendering from `person_wealth_year`, so the page looks healthy. This shipped to prod once; the
loader's preflight now checks join-key population, not just row counts.

Skipping it after a *place* loader blanks the same way `/person` does — the loader itself
throws if any placed row lost its label, but only for the rows it can see at build time.
`db:refresh` runs the local equivalent automatically; nothing runs it on the cloud side.

**A COLUMN-TYPE change in 120 also needs this run on the cloud.** The file is DROP + CREATE,
so Cloud SQL keeps the previous column types until the loader executes there — and a type
change is the one edit whose staleness is invisible to a row count. `net_worth_eur` /
`public_money_eur` / `delta_pct` are `double precision` for a reason: node-postgres
serializes PG `numeric` as a STRING, so on a stale cloud matview the API response looks
perfectly correct while every money cell on `/persons` renders BLANK.

## Testing

Two layers: **Vitest** for unit + component tests (`npm run test:unit`), **Playwright** for E2E/SEO/perf smoke (`npm test`). Co-locate tests as `*.test.ts(x)` next to the module. Unit tests never touch the network (an unstubbed `fetch` throws in jsdom) or a live DB; the `scripts/db/tests/*.data.test.ts` Postgres gates are the exception and auto-skip when Postgres is down. The `functions/` package keeps its own `node --test` gate (`npm run functions:test`). Full convention — what to unit- vs component-test, fixtures, determinism, coverage, CI placement — is in [docs/testing-standards.md](docs/testing-standards.md).

## Architecture

### Tech Stack

- **React 19** + **TypeScript** (strict mode)
- **Vite 6** with SWC
- **React Router v7** — 58 routes, all wrapped in a `<Layout>` component
- **TanStack React Query v5** — all data fetching, `staleTime: Infinity`, no refetch on focus
- **Tailwind CSS** + CSS Modules — HSL color system via CSS variables
- **Radix UI** primitives with shadcn-style wrappers in `src/components/ui/`
- **Recharts**, **React D3 Library**, **Leaflet** — charts and maps
- **i18next** — English/Bulgarian, preference stored in localStorage
- **Firebase Hosting** — SPA rewrites configured in `firebase.json`

### Data Flow

1. **Raw data** lives in `/raw_data/` (CSVs, ZIPs from the electoral commission)
2. **Data pipeline** (`scripts/`) transforms raw data → static JSON files in `/public/YYYY_MM_DD/`
3. **Frontend** fetches JSON from `/public/YYYY_MM_DD/*.json` based on the election date selected in `ElectionContext`

### Key Source Areas

- `src/routes.tsx` — All route definitions
- `src/data/ElectionContext.tsx` — Central state: selected election date, aggregate stats. All data hooks read the selected date from this context.
- `src/data/macro/cabinetAnchorContext.tsx` — Global cabinet anchor mounted on the `/governments*` and `/indicators*` route group. URL-encoded via `?cabinet=<id>`; every quarterly/annual snapshot hook (`useElectionAsOf`, `useElectionYear`) consults the override and re-anchors to the cabinet's tenure end. Cleared via the header pill ×.
- `src/data/` subdirectories (`regions/`, `municipalities/`, `settlements/`, `sections/`, `parties/`, etc.) — React Query hooks per domain; each exports typed `useXxx()` hooks
- `src/screens/` — Page-level components matching the route structure
- `src/screens/components/` — Reusable components shared across screens
- `src/components/ui/` — Low-level UI primitives (22 components)
- `src/ux/` — UX utilities: data tables, tooltips, touch handling, media queries
- `src/locales/` — i18n strings; `public/locales/` — runtime-loaded translations

### URL contract (cross-page state)

- `?elections=YYYY_MM_DD` — selected election (read by `ElectionContext`)
- `?cabinet=<id>` — global cabinet anchor on `/governments*` and `/indicators*` (read by `cabinetAnchorContext`)
- `?peers=RO,GR,HU,HR` — peer-country selection on `/indicators/compare` (read by `usePeerSelection`)
- `?pscope=all` / `?pscope=y:2024` — the shared time-scope on `/procurement*`, the sector views (water/defense/culture/judiciary), the farm-subsidy pages `/subsidies*`, and the sectors hub (all read by `useScope` in `src/data/scope/`; the param name stays `pscope`); default `ns` (the selected parliament's contract window) is omitted from the URL, `all` pivots to the full corpus, `y:<year>` to one calendar year. On `/culture` `ns` means "all years" (relabeled) and `y:<year>` re-aggregates the film KPIs / discipline split / concentration / awards to that year client-side from `films.json` — the time-spine (a historical trend) stays full-history (`scopeCultureOverview`). The procurement nav pills + the subsidies dashboard's tile links carry the current search forward (`useScopedHref` / a local `browseTo`) so the scope survives sub-page navigation. On `/subsidies` (which has no per-parliament slice) `ns` resolves to the latest financial year via `agriScopeToKey`, and each scope is served as its own precomputed `agri_payloads` overview blob (kind='overview', key=`<year>`|`all`|`''`); the `?pscope` year picker there lists only the CAP financial years present (`AGRI_FINANCIAL_YEARS`).

  **A page narrower than the corpus MUST resolve the inbound scope.** `pscope` is in the `usePreserveParams` allowlist, so any in-app link carries a scope minted where it was valid onto a page that cannot serve it (`y:2026` on `/culture`, whose НФЦ register ends 2025; `y:2019` on `/subsidies`, a hole in the CAP corpus; anything past the last Доклад on `/sector/administration`). Pass the page's coverage to the hook — `useScope({ years, allowAll })` — and hand `<ScopeControl>` the SAME resolved value via `value`/`onChange`; then the pill and the numbers are one value. Two failure modes this closes, both of which look like real data: an unresolved year reaching the aggregation (`selYear` on `/administration` labelled the latest report's numbers "2026") and a Radix `<Select>` whose controlled value matches no `<SelectItem>`, which renders EMPTY — not the placeholder — leaving the whole widget reading as the page default. Falling back to `ns` is not the only honest option: `/subsidies` keeps the raw scope and NAMES the gap ("Няма данни за субсидии за 2019"), which is why `ScopeControl` displays an off-list year rather than inventing one. What no page may do is show one window and count another.
- `?q=<term>` — on `/procurement/contracts`, `/procurement/tenders` and `/persons`, seeds the DbDataTable free-text search (used by the combined-search "see all" deep links).
- `?facet` / `?pfacet` / `?role` / `?party` / `?oblast` / `?obshtina` / `?court` / `?decl` / `?held` — the `/persons` browser filters, all owned by `useUrlPersonFilters` (`src/data/persons/`); `?q` seeds its search box. Two distinctions are load-bearing and easy to get backwards. **`?facet` is MEMBERSHIP, `?pfacet` is the PRIMARY facet** — the first asks "is this person also a …" and filters a boolean flag, the second asks "what is this person mainly" and filters the single-valued `primary_facet` the mix bar partitions. And **the multi-valued dimensions filter a space-padded CODE SET, never the display scalar beside it**: `?party=gerb` means "ever affiliated" (keeping the 4,723 switchers), `?oblast=VAR` means "holds any role there" — matching the representative column instead would drop 1,851 people from an oblast they genuinely serve, which reads as "no such people" rather than as a narrowed view. `?obshtina` is the ONE exception: it filters the representative seat, because there is no obshtina code-set column. `?court` carries an institution NAME (the picker facets and filters the same `institution` column, so its counts are exact and no code→name dictionary is needed). Every value is validated on read.
- `?proc` / `?cpv` / `?single` / `?cancelled` / `?year` / `?grade` — the procurement browser filters, all owned by `useUrlProcurementFilters` (`src/data/procurement/`). `?proc` is a bucketed procedure, `?cpv` a division/prefix/comma-set, `?single|?cancelled` a boolean toggle (name differs per browser), `?year` the company/awarder page only. `?grade=D,E,F` is a validated A–F set filtering the **server-side** contract risk index (`risk_grade`, migration 112) — contracts browsers only, since tenders have no per-tender index. Every one is validated on read: unknown values are dropped rather than passed into a `DbColumnFilter`.
- `?cpv` / `?mp` — the `/procurement/contractors` ("Топ изпълнители") filters, owned by `useUrlContractorFilters` (a small local hook, NOT the shared one above, since the leaderboard has no `?proc/?year/?grade` analogue). Here `?cpv` is **single-valued and normalised to a 2-digit CPV division ON WRITE** — `contractor_rank` (122) is a `(scope_key × division)` rollup with an `'ALL'` sentinel, so picking a finer catalogue code stores `?cpv=45` and the division filter is ALWAYS sent (default `'ALL'`); a multi-value set would return N rows per contractor and double-count. `?mp=1` is the MP-tied toggle (`is_mp_tied`). `?q` seeds the search box and `?pscope` the scope, as elsewhere.

### Local-elections routes

Local cycles (`mi*`, `chmi*`) live alongside parliamentary but in their own data tree and URL space:

- `/local/:cycle` — cycle overview (council vote share, mayors-won, município list with SOF pinned)
- `/local/:cycle/:obshtinaCode` — per-município dashboard (section map + compact mayor-candidate & council-party tiles, council hemicycle, kmetstvo mayors, район mayors, top councillors, chmi history). The compact tiles' "see full results" links drill into the dedicated full-breakdown pages below.
- `/local/:cycle/:obshtinaCode/mayor` — full mayor candidate ranking (R1 + R2)
- `/local/:cycle/:obshtinaCode/council` — full council party-by-party breakdown (expandable elected-councillor lists) + hemicycle + top councillors
- `/local/chmi` — chronological feed of all extraordinary (partial + new) elections across cycles
- `/sverka` — national officials-vs-CIK reconciliation table

`<cycle>` is the raw-data folder name: `2023_10_29_mi`, `2019_10_27_mi`, `2024_06_23_chmi`, `2024_10_20_chmi_nov`, etc. The synthetic `SOF` obshtinaCode holds Sofia's city-wide bundle (Sofia districts are the 24 `S2***` shards). Partials never appear in the elections selector — they surface contextually via tile + `/local/chmi` only.

### Data Hook Pattern

```typescript
// All data hooks follow this pattern
const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string]>): Promise<T> => {
  const response = await fetch(`/${queryKey[1]}/resource.json`);
  return response.json();
};

export const useResourceData = () => {
  const { selected } = useElectionContext(); // selected = "YYYY_MM_DD"
  return useQuery({ queryKey: ["resource", selected], queryFn });
};
```

### Data Pipeline (`/scripts`)

- `scripts/main.ts` — CLI entry point (cmd-ts)
- `scripts/parsers/` — Parse raw CSV/ZIP election data
- `scripts/parsers_local/` — Parse local-elections data (mi2023, mi2019, chmi partials). HTML-only ingest from `results.cik.bg/mi{YYYY}/tur1/rezultati/{oikCode}.html` via headed Playwright (CF Turnstile bypass — see `cik_fetch.ts`). One município bundle per shard under `data/<cycle>/municipalities/<obshtinaCode>.json` + national rollups in `index.json` + officials-vs-CIK reconciliation in `officials_diff.json` + per-município sidecars `officials_diff/<obshtinaCode>.json`. Aggregated cross-cycle chmi history at `data/local_chmi_history.json`. CLI: `npm run data -- --local-ingest <slug>` (where slug is `mi2023`, `mi2019`, or `chmi2024-2026/<YYYY-MM-DD>_chastichen` / `_nov`); `--local --local-date <folder>` re-parses already-downloaded raw data.
- `scripts/reports/` — Generate analytical reports (turnout, concentration, top gainers/losers, invalid ballots, recount metrics, machine flash memory)
- `scripts/stats/` — Aggregate statistics
- `scripts/search/` — Full-text search index generation
- `scripts/smetna_palata/` — Campaign financing parsing

### Path Aliases

`@/*` maps to `./src/*` (configured in `tsconfig.json` and `vite.config.ts`).

### Environment Variables

`.env.local` with `GEMINI_API_KEY` — injected into the frontend build via `vite.config.ts` as `process.env.API_KEY`.
