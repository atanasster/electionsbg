# Bulgaria home dashboard — full implementation plan

**Status:** ready to execute
**Product research:** [home-dashboard-research-v1.md](./home-dashboard-research-v1.md)
**Related election work:** [elections-hub-implementation-v1.md](./elections-hub-implementation-v1.md)
**Scope:** replace the parliamentary-only `/` with a global Bulgaria-in-data front door, preserve the election experience at `/elections`, and add a typed national change feed
**Version:** v1 — staged route migration, generated home artifacts, no account or notification delivery system

## 1. Outcome

Ship `/` as a useful answer to “What is happening in Bulgaria?” rather than as an alias for the latest parliamentary election.

The first screen must give a defensible national pulse, a fast way to find a place/person/institution/topic, and direct entry to the subjects people repeatedly seek:

- prices and consumption;
- municipalities and “my area”;
- elections;
- budget, debt, and taxes;
- public procurement;
- EU funds and open calls;
- concrete public sectors such as schools, hospitals, pensions, roads, energy, and justice;
- parliament and government accountability.

Below that stable front door, “What changed” is a small typed feed of material, dated events: new procedures and contracts, calls opening or closing, meaningful price movements and promotions, election events, budget changes, and debt issuance. It is not a scraped news stream, a raw ingest log, or a claim that first discovery equals real-world occurrence.

The implementation must preserve every existing election result and analysis. The current country dashboard moves intact to `/elections` before `/` changes meaning; historical `/elections/:date` and every deep result URL remain unchanged.

## 2. Fixed v1 decisions

These are implementation constraints, not design questions to defer into code review.

1. `/` becomes the canonical global home. It is not redirected.
2. `/elections` becomes the canonical current parliamentary/election entry. The existing `/elections/:date`, local-election routes, and deep parliamentary routes remain unchanged.
3. Route preservation is a prerequisite: `/elections` must render the current country election experience before the root cutover is allowed.
4. The stable hierarchy is search-led and durable. Elections receive normal prominence outside an election period and may be promoted through a data-driven seasonal mode; they never take over root routing again.
5. The head contains exactly four national pulse figures in v1: real GDP growth, CPI inflation, seasonally adjusted unemployment, and general-government debt as a share of GDP. Each figure carries period, basis, source, and a destination.
6. Head and tile numbers are folds of destination-owned figures. The home generator does not invent parallel formulas and never sums overlapping procurement, funds, or sector corpora.
7. One finder serves the home. It reuses existing place, people, awarder/company, procurement/funds, and product search authorities; it does not build a second global index.
8. The grid has eight primary destinations in two semantic bands of four. Every tile has one destination and at most one non-duplicative metric; descriptor-only is valid when no honest metric exists.
9. Home uses two generated artifacts: `data/home/hub_stats.json` for small numeric facts and `data/home/feed.json` for typed event rows. Text/event details do not inflate the stats blob.
10. `HomeEvent` stores date semantics explicitly. `occurredAt`, `publishedAt`, and `firstSeenAt` are different fields; the UI never relabels first-seen time as the event date.
11. Generated artifacts carry enum/fact arguments, not translated sentences. Bulgarian and English rendering lives in locale bundles.
12. Missing data is absent, never zero. Partial-source states keep the page useful and disclose coverage.
13. The root feed renders no more than six events, no more than two from one category, and at least three categories when the available material permits it.
14. Bulk backfills collapse into a labelled corpus-update summary. They do not become hundreds of “new today” news items.
15. Automatic publication is restricted to events whose source and date semantics meet the event-kind contract. Ambiguous international debt issues and document-only budget changes require editorial review in v1.
16. “Alerts” continues to mean an on-site recent-activity experience in v1. This plan does not promise email, push, login, saved delivery preferences, or real-time monitoring.
17. Every new canonical page ships with prerender body, both sitemap declarations and committed XML, canonical metadata, internal reachability, and a dedicated inspected OG image in the same phase.
18. Root is a hub-of-hubs and composes `HubHead`, `TileHubGrid`/`TileHubSection`, and `HubSearch`. It does not create parallel header, tile, or search systems.
19. All artifacts must be regenerated deterministically, registered in the full refresh, published to the data bucket, and verified from the same public path the browser reads.
20. Each rollout phase has an independent rollback and ships as a separate reviewed commit.

## 3. Current-state contracts and migration boundary

### 3.1 Root ownership today

The present root is an election result page:

- `src/routes.tsx` maps the index route to `src/screens/DashboardScreen.tsx`;
- `DashboardScreen` renders the parliamentary `PlaceHeader` and `DashboardCards`;
- `src/screens/dashboard/DashboardCards.tsx` owns the latest national result and analyses;
- `scripts/prerender/routes.ts` gives `/` election title, body, Dataset JSON-LD, and `/og/dashboard-2026-04-19.png`;
- `src/layout/header/reportMenus.ts`, `ElectionsBreadcrumb`, `placeViews`, and `crossElectionLink` use `/` as the parliamentary-country destination.

The cutover must change all of those contracts together. Changing only the React route would leave breadcrumbs, prerender, sitemaps, navigation state, and cross-election links pointing at unrelated home content.

### 3.2 Route target after migration

| Purpose | Canonical route after v1 | Migration rule |
| --- | --- | --- |
| global Bulgaria dashboard | `/` | new content; no redirect |
| current election entry/country result | `/elections` | receives the current root result composition |
| historical parliamentary country | `/elections/:date` | unchanged |
| parliamentary region/municipality/settlement/section | existing routes | unchanged |
| local-election hierarchy | `/local/:cycle/**` | unchanged |

The header logo continues to link to `/`. Election menus and election breadcrumbs link to `/elections`. A home link is not added as a fake leaf inside the Elections menu.

### 3.3 Existing artifacts to retain

`public/og/dashboard-2026-04-19.png` is also referenced by historical/article content. Stop using it for root metadata, but do not delete it until a reference test proves no remaining consumer.

The existing election `DashboardSkeleton` follows the preserved election screen. Root gets a new `HomeDashboardSkeleton` so a future election-shell change cannot alter home loading geometry.

### 3.4 User-owned overlap

`Header.tsx`, `package.json`, and other files may already contain unrelated work. The implementation must rebase each phase on the then-current tree, inspect overlapping diffs, and make narrow edits. This plan authorizes no cleanup of unrelated changes.

## 4. Product information architecture

### 4.1 Page order

Root renders in this order:

1. `HubHead` — eyebrow/freshness, one H1, short deck, four pulse figures, and the finder;
2. “Everyday Bulgaria” band — prices, my area, elections, sectors;
3. “Public money and power” band — budget, procurement, EU funds, governance/parliament;
4. “What changed” — at most six typed events with a route to the relevant full destination;
5. methods/source note — how dates, coverage, and updates are defined.

No full-width map, decorative hero illustration, or election result chart appears above the primary destinations. Root is a navigation and orientation surface, not a duplicate of any destination dashboard.

### 4.2 Tile registry

Create `src/screens/home/homeRegistry.ts` with bands nested as the only source of tile order:

```text
Everyday Bulgaria
  prices       -> /consumption
  my-area      -> /my-area
  elections    -> /elections
  sectors      -> /governance/sectors

Public money and power
  budget       -> /budget
  procurement  -> /procurement?pscope=all
  funds        -> /funds
  governance   -> /governance
```

The exact Bulgarian and English labels are translation keys. The semantics and order are fixed for v1. `/open-calls` is an action link within the funds tile/feed, not a ninth peer tile. Parliament remains directly reachable from the governance destination and may be a feed destination.

Create `src/screens/home/homeScenes.tsx` for the eight bespoke scenes. `HOME_BANDS` owns the nested tile list and `HOME_TILES` is derived with `flatMap`; no second hand-maintained registry exists.

Tile gates assert:

- exactly two described bands and four tiles per band at the desktop four-column breakpoint;
- one scene per tile and no accent collision across the composed page;
- absolute, routed destinations and preserved forced scopes;
- no per-tile CTA or instruction-shaped heading such as “Explore” or “More”;
- no tile number duplicated in the head or another tile;
- every shown number has value, basis, destination, source availability, and period;
- absent data renders the descriptor, not `0` or a skeleton forever.

### 4.3 Seasonal election prominence

Do not reorder the permanent registry by hand. Add a small `homeMode` field to `hub_stats.json`:

```ts
type HomeMode = "standard" | "election_upcoming" | "election_live" | "election_recent";
```

The generator derives it from the canonical election registry/status, not the current date alone:

- `election_upcoming`: a scheduled national election is within 45 days;
- `election_live`: projection/provisional/counting status;
- `election_recent`: final result within 14 days;
- otherwise `standard`.

Mode may add a compact election notice between the head and bands, using the `/elections` destination. It does not hide the pulse, change the root canonical, or remove other subjects. Unknown status falls back to `standard`.

## 5. Home statistics data contract

### 5.1 Shared types

Create import-safe browser/script types at `src/data/home/homeTypes.ts`:

```ts
type HomeFigureId =
  | "gdp_growth"
  | "inflation_cpi"
  | "unemployment_sa"
  | "government_debt_gdp";

type HomeBasis = {
  period: string;
  frequency: "monthly" | "quarterly" | "annual" | "snapshot";
  unit: "pct" | "pct_gdp" | "eur" | "count";
  adjustment?: "seasonally_adjusted" | "unadjusted";
  comparison?: "yoy" | "qoq" | "level" | "snapshot";
};

type HomeFigure = {
  id: HomeFigureId;
  value: number;
  basis: HomeBasis;
  to: string;
  sourceId: string;
};

type HomeTileMetric = {
  tileId: string;
  value: number;
  unit: "pct" | "eur" | "count" | "date";
  basisKey: string;
  period?: string;
  to: string;
  sourceId: string;
  scope?: string;
};

type HomeHubStatsV1 = {
  schemaVersion: 1;
  computedAt: string;
  homeMode: HomeMode;
  figures: HomeFigure[];
  tiles: Partial<Record<string, HomeTileMetric>>;
  sources: Record<string, {
    available: boolean;
    asOf?: string;
    sourceUrl?: string;
    datasetCode?: string;
  }>;
};
```

The real type may tighten string unions, but must not add React or Node imports. `computedAt` is the maximum meaningful source vintage in the artifact, not `new Date()` on every rebuild.

### 5.2 Four head figures

`scripts/db/gen_home/hub_stats.ts` reads the canonical values already maintained in `data/macro.json`:

| Figure | Canonical selector | Required basis | Destination |
| --- | --- | --- | --- |
| real GDP growth | latest valid `series.gdpGrowth` observation | quarter, YoY/QoQ meaning from source | `/indicators/economy` |
| CPI inflation | `latestMonthly.inflation` | month and YoY | `/indicators/economy` |
| unemployment | `latestMonthly.unemployment` | month and seasonally adjusted | `/indicators/economy` |
| government debt | latest valid `series.govDebt` observation | quarter and % GDP | `/indicators/fiscal` |

Selectors must copy `period`, source URL, dataset code, and adjustment/comparison metadata from the source. Tests fail if a selector silently chooses an older valid-looking observation after a schema change.

The generator does not hard-code the currently observed values. Missing one indicator yields three cells plus a disclosed partial state; it never substitutes zero, a prior hard-coded value, or a different indicator.

### 5.3 Tile metric ownership

The generator folds only metrics whose destination already owns the definition:

- prices: a current basket/deal/coverage metric from the consumption payload with its exact observation window;
- my area: descriptor-only in v1 unless the canonical place catalog provides a stable, meaningful coverage count;
- elections: date/status of the selected current event, not another result percentage;
- sectors: destination registry coverage count, never a sum of sector money;
- budget: the same planned/projected selector and basis used by the budget/governance generator;
- procurement: the destination `hub_stats` all-scope metric, with `?pscope=all` preserved;
- funds: currently open, actionable calls or a destination-owned funds metric; never ISUN + Interreg + agriculture added together;
- governance: a destination-owned people/institution/parliament coverage metric not used elsewhere on root.

If a destination does not expose a compatible value, the tile is descriptor-only. Adding a home-only query merely to fill every tile is explicitly rejected.

### 5.4 Artifact and publication budget

- path: `data/home/hub_stats.json`;
- uncompressed ceiling: 16 KiB;
- one request supplies all head and tile figures;
- stable key ordering and deterministic serialization;
- no localized prose, raw row lists, or duplicated source documents;
- rebuild with unchanged semantic content is byte-identical;
- a missing source changes `available`, not unrelated values;
- bucket path: `home/hub_stats.json`.

Add `db:gen-home-hub-stats` to `package.json`, `REFRESH_GENERATORS` in `scripts/db/refresh_coverage.ts`, and the end of `db:refresh` after `db:gen-governance-hub-stats`. Governance must continue after its sibling hubs; home is last because it folds destination artifacts.

## 6. “What changed” event contract

### 6.1 Type and date semantics

Add to `homeTypes.ts`:

```ts
type HomeEventCategory =
  | "prices"
  | "local"
  | "procurement"
  | "funds"
  | "budget_debt"
  | "parliament_elections";

type HomeDateBasis =
  | "occurred"
  | "published"
  | "effective"
  | "deadline"
  | "first_seen";

type HomeVerification = "automatic" | "editorial_review";

type HomeEventV1 = {
  schemaVersion: 1;
  id: string;
  kind: string;
  category: HomeEventCategory;
  occurredAt?: string;
  publishedAt?: string;
  effectiveAt?: string;
  deadlineAt?: string;
  firstSeenAt: string;
  dateBasis: HomeDateBasis;
  scope: { level: "national" | "oblast" | "municipality"; id?: string };
  source: { id: string; url?: string; labelKey: string };
  coverage: { complete: boolean; noteKey?: string };
  route: string;
  factKey: string;
  factArgs: Record<string, string | number>;
  backfill: boolean;
  verification: HomeVerification;
  materiality: number;
  actionability: number;
};

type HomeFeedV1 = {
  schemaVersion: 1;
  computedAt: string;
  windowDays: number;
  events: HomeEventV1[];
  sourceCoverage: Record<string, { available: boolean; asOf?: string }>;
};
```

`id` is stable from source kind + source record identity + event transition. It must not contain ingestion time. `dateBasis` tells the renderer which date is being presented and which label to use. When only `firstSeenAt` exists, copy says “found/added to the data”, never “happened”.

### 6.2 Source adapters

Implement `scripts/db/gen_home/feed.ts` and adapters under `scripts/db/gen_home/events/`. Each adapter owns its event kinds, source gate, materiality rule, and date basis.

| Adapter | V1 events | Date authority | Publication rule |
| --- | --- | --- | --- |
| procurement | tender announced, contract awarded, material annex | source notice/award/annex date; `firstSeenAt` separately | automatic when record route and real date exist |
| funds | project added/modified, call opened, deadline approaching/closed | source publication/effective/deadline; detection separately | automatic; changed amount needs before/after values |
| local | council resolution, capital programme, local/partial election | resolution/election/effective date | automatic only for ingested municipalities; coverage disclosed |
| parliament/elections | new sitting/vote, election scheduled, polling/results status transition | sitting/election/status time | automatic for canonical lifecycle transitions |
| prices | official CPI release, material basket movement, verified promotion start/end | observation/release/window date | automatic when comparison window and sample coverage pass |
| budget/debt | KFP release, enacted budget amendment, domestic debt auction/result | document effective/release/auction date | automatic only for structured domestic sources |
| international debt | Eurobond issue/terms | official issue/publication date | `editorial_review` until a structured authority exists |
| budget document | draft/revision document discovered | publication/first-seen | document notice automatic; numeric “budget changed” remains review-gated |

Reuse `recent_updates()` only for first-seen/changelog evidence and source identities. It is not the occurrence clock. Its summary-mode rows become one corpus-update event; detail rows still require the source adapter to supply the real date and destination.

Do not build the national feed by reading and merging all 265 `myarea_alerts` responses. The feed uses their upstream authorities or common builders so one local item is not copied 265 times and national events are not polluted by municipality-specific prose.

### 6.3 Price materiality

The first implementation uses documented deterministic thresholds, stored beside tests rather than in the UI:

- compare identical product/store coverage or a defined basket cohort;
- require the minimum sample count already used by the consumption destination;
- emit a basket move only when absolute 7-day movement is at least the reviewed threshold;
- emit a promotion only from a source promotion/discount field or a defensible regular-price baseline, never from a single low observation;
- name the window, observation count, geography, and coverage change;
- suppress an event if coverage movement could explain the price movement.

The exact numeric threshold is finalized against a 90-day replay in Phase 5. The review artifact records event count/day, false positives, missing days, and category dominance before the threshold is accepted.

### 6.4 Ranking and diversity

The generator calculates a deterministic rank from:

```text
date recency on the declared basis
+ materiality
+ actionability
+ national relevance
- backfill penalty
- incomplete-coverage penalty
```

It then applies:

- maximum 40 rows in the artifact;
- maximum two rows per category in the first six;
- at least three categories in the first six when eligible rows exist;
- national rows before local rows at equal score;
- a municipality row only if material nationally or relevant to a selected place in a later personalized view;
- no stale row solely to satisfy diversity;
- stable tie-break by `id`.

The browser may take the already-ranked first six; it must not invent a different ranking.

### 6.5 Feed rendering

Create `src/screens/home/HomeChangeCard.tsx` as a small renderer around or beside the existing `NewsCard` primitive. It must show:

- category/kind label;
- fact rendered from `factKey` + `factArgs`;
- the date with its date-basis label;
- amount/change/deadline only when present;
- a clear internal destination;
- source/coverage note when incomplete;
- a backfill or editorial-review label where applicable.

Internal destinations use the app `Link`; source evidence is an external anchor. The card never displays a review-gated event on root until its verification state is promoted by the reviewed artifact path.

### 6.6 Feed artifact budget

- path: `data/home/feed.json`;
- uncompressed ceiling: 64 KiB;
- maximum 40 events;
- default window: 30 days, with event-kind-specific deadline windows documented in adapters;
- no bilingual prose;
- deterministic and byte-stable under unchanged inputs;
- bucket path: `home/feed.json`;
- home fetch failure hides the feed behind a disclosed unavailable state; it does not fail the head or grid.

Add `db:gen-home-feed` to `package.json`, `REFRESH_GENERATORS`, and after the stats generator at the end of `db:refresh`. If source ordering means the feed must precede stats, neither may read the other; define a final umbrella `db:gen-home` that runs both in a pinned order and register the two artifacts independently.

## 7. Alerts convergence

### 7.1 Immediate correctness repair

Before reusing alert concepts, fix the existing contract drift:

- `scripts/myarea/build_alerts.ts` emits `open_call`;
- `src/data/myarea/useMyAreaAlerts.tsx` omits `open_call` from `MyAreaAlertKind`;
- icon/color/kind rendering therefore falls through a generic runtime branch while TypeScript claims the kind cannot exist.

Create `src/data/alerts/alertKinds.ts` as an import-safe exhaustive registry shared by builder output validation and UI mapping. It includes all current kinds, icon/style token, category, default date basis, and translation key. Tests enumerate builder kinds against the registry and make an unhandled kind a compile/data failure.

Do not put translated headlines into the new home event artifact. The existing bilingual `myarea_alerts` storage may remain for compatibility; new kinds use structured facts, and a later migration can converge the old rows.

### 7.2 Freshness and invalidation

`useMyAreaAlerts` currently uses `staleTime: Infinity`. Replace it with one of these explicit mechanisms in the alert repair phase:

- preferred: response `refreshedAt`/version included in a short-lived query (30 minutes); or
- immutable versioned URL/query key published by the loader.

The home hooks use a 30-minute stale time and surface their artifact `computedAt`. A tab can remain open without showing yesterday’s alert/feed indefinitely.

### 7.3 Popular-topic alert additions

Add kinds only where there is an upstream authority and an actionable destination:

- `price_drop`, `basket_change`, `promotion_ending`;
- `tender_announced`, `contract_awarded`, `contract_amended` (split the broad procurement label in presentation while preserving notice type);
- `call_opened`, `call_deadline`, `fund_project_changed`;
- `budget_release`, `budget_amendment`, `debt_auction`;
- `election_scheduled`, `election_status`, `partial_election`;
- `council_resolution`, already present, with explicit municipal coverage.

V1 exposes these on-site. Account-backed subscriptions, per-entity cursors, delivery channels, and notification preferences are a later tier after event stability is measured.

### 7.4 Watchlist evolution, later tier

The current aggregate watchlist signature can tell that a collection changed, not which event the reader has seen. A real alert system requires:

```ts
type WatchSubject =
  | { kind: "place"; id: string }
  | { kind: "company"; id: string }
  | { kind: "institution"; id: string }
  | { kind: "product"; id: string }
  | { kind: "programme"; id: string }
  | { kind: "sector"; id: string };

type WatchCursor = { subjectKey: string; lastSeenEventId: string; lastSeenAt: string };
```

Do not implement this schema until the home feed event IDs survive a 30-day stability test across rebuilds and backfills.

## 8. Finder architecture

### 8.1 One home search configuration

Create `src/screens/home/useHomeSearch.tsx` using `HubSearch`, `hubSearchSources`, `buildEntityIndex`, and existing adapters. Search groups, in order:

1. places — settlements, municipalities, regions;
2. people — officials and MPs;
3. institutions and companies — awarders/contractors;
4. contracts, tenders, funds, and calls;
5. products/prices.

The search is armed only after focus/intent. Place catalogs remain lazy; product and server endpoints are not called on initial page load.

### 8.2 Reuse and refactor boundary

- reuse `buildPlaceItems` and the existing slim place catalog;
- reuse the people search source used by governance;
- extract the shared `/api/db/procurement-search` request/normalization from the procurement/governance consumers so home does not send duplicate requests for awarders, companies, contracts, tenders, funds, and Interreg;
- reuse `/api/db/price-search` for products;
- cap each group and the total result count;
- pass query text to a “see all” destination only where that destination actually reads the parameter.

No new catch-all search API is needed in v1. If parallel existing endpoints exceed the measured latency budget, record the trace before proposing an aggregator.

### 8.3 Search gates

- no search/catalog request before the finder is armed;
- one procurement request per normalized query;
- cancellation/debounce follows the shared source helper;
- keyboard, screen reader group labels, empty/error states, and Bulgarian/Latin query folding work;
- representative place, official, awarder, contractor, tender, fund, and product rows resolve to live routes;
- queries and result labels do not leak raw source fields or unsafe HTML;
- the finder does not exceed the head height budget at 390 px.

## 9. Screen and route implementation

### 9.1 New home files

```text
src/screens/HomeDashboardScreen.tsx
src/screens/home/HomeDashboardSkeleton.tsx
src/screens/home/homeRegistry.ts
src/screens/home/homeScenes.tsx
src/screens/home/homeFigures.ts
src/screens/home/useHomeSearch.tsx
src/screens/home/HomeChangeFeed.tsx
src/screens/home/HomeChangeCard.tsx
src/screens/home/homeHubBands.test.ts
src/screens/home/homeFigures.test.ts
src/screens/home/HomeDashboardScreen.test.tsx

src/data/home/homeTypes.ts
src/data/home/useHomeHubStats.tsx
src/data/home/useHomeFeed.tsx

scripts/db/gen_home/hub_stats.ts
scripts/db/gen_home/feed.ts
scripts/db/gen_home/events/*.ts
scripts/db/tests/home_hub_stats.data.test.ts
scripts/db/tests/home_feed.data.test.ts
```

Keep `HomeDashboardScreen` composition-only. Figure formatting lives in `homeFigures.ts`, descriptors in the registry, data fetching in hooks, and generation in scripts.

### 9.2 Election preservation bridge

Before changing the root index:

1. Add static `/elections` in `src/routes.tsx`, above or beside the existing `/elections/:date` declaration.
2. Point it at the current `DashboardScreen`/`DashboardCards` composition, preserving its lazy boundary and election skeleton.
3. Make `/elections` render the same selected/latest cycle semantics the root currently renders. Where `?elections` is present, caption the selected cycle and do not silently show a different one.
4. Change parliamentary country destinations in:
   - `src/data/local/placeViews.ts`;
   - `src/data/local/crossElectionLink.ts`;
   - `src/screens/components/ElectionsBreadcrumb.tsx`;
   - `src/layout/header/reportMenus.ts`;
   - `PlaceHeader` fallback helpers and any tests that encode `/`.
5. Update `Header.tsx` active-section logic so `/` is neutral/global, `/elections` and parliamentary deep routes activate Elections, local-election routes activate Elections, and governance/consumption remain independent.
6. Keep the logo route `/`; update its accessible description from election-only copy to the platform/global description.
7. Search production and tests for remaining root-as-election assumptions; every intentional historical/article reference receives a comment or fixture name rather than a blanket replacement.

Only after route, link, prerender, sitemap, and browser parity gates pass does `src/routes.tsx` change the index route to `HomeDashboardScreen`.

### 9.3 Runtime behavior

`useHomeHubStats` and `useHomeFeed` use separate React Query keys and fetch `dataUrl()` bucket paths. Stats failure renders a descriptor-complete hub with an unavailable pulse note. Feed failure renders a small unavailable state below the grid. One failure never blanks the other surface.

Loading skeletons reserve final geometry. Heavy destination charts/maps are not imported by the home route. Tile scenes are plain SVG/React and remain within the route chunk.

## 10. Internationalization

Add `home` to `LOCALE_BUNDLES` in `scripts/i18n/bundles.ts` and tag the root route with `withBundle("home", ...)`. Run `scripts/i18n/split_bundles.ts --apply` after the static reachability set is complete.

The home bundle contains:

- head/deck/source/freshness copy;
- band/tile labels and descriptions;
- figure basis labels;
- every `HomeEvent.kind`, `dateBasis`, coverage, backfill, and verification state;
- finder group/empty/error labels;
- methods copy and seasonal election notice.

Generated JSON contains only enums, codes, and fact arguments. Locale parity enumerates every generator-emittable code in Bulgarian and English. Write Bulgarian copy natively and review it beside English.

The election implementation plan’s bundle decision changes with this route migration: election-hub-exclusive copy may use an `elections` bundle, while shared result components stay in core unless reachability proves they are exclusive. Measure and re-ratchet `tests/perf.spec.ts`; do not assume moving root automatically removes all election strings from core.

## 11. SEO, prerender, sitemap, and OG

### 11.1 Root

Replace root election metadata in `scripts/prerender/routes.ts` with unique Bulgarian/English home metadata and a real static body covering the pulse, eight destinations, change feed meaning, and source methodology.

Root structured data uses:

- `WebSite` + `Organization` identity;
- an `ItemList` for the primary data destinations;
- Dataset descriptions only for the actual national indicators/corpora represented, not one election Dataset relabelled as a country dashboard.

Root `lastmod` points to `data/home/hub_stats.json` (and the route generator may take the max with `feed.json` if the sitemap contract supports multiple files). Add and inspect `public/og/home.png`.

### 11.2 Elections

Move the former root election body, Dataset JSON-LD, canonical, and appropriate title/description to static `/elections`. Add `public/og/elections.png`; do not reuse the global home image. Point `/elections` sitemap `file:` at the election artifact the page renders.

### 11.3 Coverage changes

- add `/elections` to Bulgarian `routeDefs(year)` and `ENGLISH_STATIC_PAGES`;
- retain root in both languages with its new meaning;
- run `npm run sitemap` and commit `public/sitemap*.xml` in the implementation phase;
- add both pages to `scripts/prerender/ogAndSitemapCoverage.test.ts`, `scripts/og/capture_routes.test.ts`, and SEO body-length coverage;
- add capture entries in `scripts/og/capture-screens.ts` using stable `data-og` anchors and data-populated wait conditions;
- run OG capture and sitemap before `npm run build`, because the build copies `public/` to `dist/`;
- open both 1200×630 files and inspect them in light/dark-independent capture styling.

## 12. Generation, refresh, and publication

### 12.1 Full refresh ordering

The required tail of `db:refresh` becomes conceptually:

```text
... destination loaders and generators
db:gen-culture-hub-stats
db:gen-governance-hub-stats
db:gen-home-hub-stats
db:gen-home-feed
person slug/data checks as currently ordered
test:data
```

Do not move governance ahead of a destination it folds. Home runs only after every available destination artifact and event source. `scripts/db/refresh_coverage.test.ts` must assert both new unconditional committed-artifact generators are registered, ordered, tracked, and publishable.

### 12.2 Watcher/update-skill integration

Update the process-watch runbook so any successful ingest that changes a home source schedules the relevant home generator after all selected downstream skills complete:

- prices/macro → stats + feed;
- procurement/funds/open calls/council/elections/parliament/budget → feed;
- destination hub stats → home stats;
- any home artifact change → include `data/home` in the upload manifest.

Generate once per watcher run, not once after every source. Publication happens after both files are final. A generator failure leaves the previous public artifact in place and makes the watcher report red; it must not upload a half-written file.

### 12.3 Determinism and atomicity

- build in memory, validate, write a temporary sibling, then rename;
- semantic `computedAt` derives from sources;
- sort source records and object keys explicitly;
- validate routes and enum codes before write;
- preserve previous bytes when output is semantically identical;
- `db:check-generated` re-derives and compares the committed files;
- dry-run bucket sync shows only the two expected objects before publication;
- fetch both public object URLs and validate schema/version before browser gates.

## 13. Analytics and success criteria

Use the existing analytics mechanism; do not add a vendor. Record a two-week pre-cutover baseline and the first four weeks after launch.

Events:

```text
home_view                 locale, viewport, homeMode, statsAvailable, feedAvailable
home_tile_open            tileId, bandId, position
home_search_open          input method
home_search_result_open   group, rank
home_feed_open            eventKind, category, rank, dateBasis
home_election_notice_open homeMode
```

No raw query text, person name, company name, municipality selection, or watch subject is sent unless the existing privacy contract already permits it.

V1 success/guardrails:

- at least 35% of non-bounce root sessions open a tile, result, or feed item within four weeks;
- at least five of eight tiles receive meaningful traffic; no single tile exceeds 60% outside `election_live` mode;
- finder p75 result-ready latency below 500 ms on the tested production profile after it is armed;
- root JavaScript and LCP remain within the existing performance ceilings; CLS < 0.1;
- feed has at least three eligible categories in 80% of days where three categories have events;
- source/date correction rate below the agreed editorial threshold after the 30-day replay;
- alert/feed unknown-kind and missing-date-basis counts remain zero.

These are decision inputs, not vanity targets. Low traffic to a tile leads to copy/order review; it does not authorize hiding an important accountability destination without research.

## 14. Test and review matrix

### 14.1 Data gates

`home_hub_stats.data.test.ts` independently re-derives every figure and metric from canonical sources and asserts:

- schema and enum completeness;
- figure uniqueness, correct selector/period/basis/destination;
- no head/tile duplication;
- all-scope procurement route honesty;
- no overlapping-source sum;
- missing is absent, not zero;
- source availability and size ceiling;
- byte-identical double generation.

`home_feed.data.test.ts` asserts:

- stable unique IDs and allowed routes;
- exactly one honest display date basis per row;
- `firstSeenAt` never replaces known occurrence/publication/effective/deadline time;
- every kind has a source adapter, renderer, translations, and materiality rule;
- bulk loads summarize;
- review-gated kinds do not appear in the public automatic set;
- max rows, category cap/diversity, stable ordering, and byte ceiling;
- no localized prose or unsafe external route in facts.

### 14.2 Unit/component gates

- tile registry/scenes/bands/accent/destination gate;
- `homeFigures` formatting and basis gate;
- full, partial, unavailable, stale, and malformed stats states;
- feed loading/error/empty/backfill/review/date-basis rendering;
- alert-kind exhaustive mapping including `open_call`;
- finder lazy-load, grouping, route, debounce, and cancellation;
- root route renders home; `/elections` renders preserved election body;
- breadcrumbs, place links, cross-election links, and header active state use the new route contract;
- `HomeDashboardScreen` joins `HUB_SCREENS` and has exactly one `HubHead`/H1/SEO owner.

### 14.3 Static/SEO gates

- root and `/en` static bodies describe the global dashboard;
- `/elections` and `/en/elections` static bodies describe elections;
- unique canonical/title/description/H1 for both;
- both sitemap lists and committed XML contain the right routes;
- every sitemap `file:` exists;
- every OG path exists and capture route is registered;
- root no longer emits election-only Dataset metadata;
- no page falls through to root metadata.

### 14.4 Browser/accessibility gates

Test 390, 768, 1280, and 1440 px; Bulgarian and English; light and dark:

- first screen shows one H1, four KPI cells when data is complete, finder, and the start of primary destinations within the hub height budget;
- DOM and visual order agree;
- keyboard can open finder, traverse groups, open a tile/feed item, and return focus;
- dates, changes, and status do not rely on color/arrows alone;
- SVG scenes and muted text meet contrast; reduced motion is respected;
- skeleton-to-content shift stays below CLS 0.1;
- no console/network errors other than deliberately simulated failure cases;
- all eight tiles, six representative feed items, logo, election breadcrumb, and cross-module paths resolve;
- `/elections` is visually/functionally equivalent to the former root before root cutover.

### 14.5 Performance gates

- home route stays lazy from the entry graph;
- no Leaflet/recharts/d3 election modules join the home initial chunk;
- exactly one locale bundle loads for root;
- no finder endpoints/catalogs before intent;
- one stats and one feed request, independently cacheable;
- stats ≤16 KiB and feed ≤64 KiB raw;
- head inside the shared measured height budget with four `data-kpi-cell` nodes;
- `tests/perf.spec.ts`, `tests/ui.spec.ts`, entry-graph, and route-chunk budgets are measured and re-ratcheted with recorded deltas.

## 15. Implementation phases

Every phase ends with targeted tests, browser inspection where applicable, focused review, repair, a repeated green gate, and its own commit.

### Phase 0 — contracts, baselines, and alert repair

**Goal:** remove known semantic drift and make success measurable before route work.

Work:

1. Add `homeTypes.ts` with stats/event/date/source contracts.
2. Add the exhaustive shared alert-kind registry; include `open_call`; repair icon/style/type coverage.
3. Replace indefinite alert freshness with explicit invalidation and show refreshed/source basis.
4. Capture payload, route chunk, LCP/CLS, root navigation, search, and analytics baselines.
5. Add fixtures for date-basis, backfill, missing source, and unknown-kind failure.

Exit: builders and UI agree on every current alert kind; baseline report committed; shared types compile in browser and script tests; no visible root change.

Rollback: revert registry/hook changes; no route or data artifact dependency exists yet.

### Phase 1 — preserve elections at `/elections`

**Goal:** create a parity bridge before root changes meaning.

Work:

1. Add the static route and lazy boundary.
2. Move/alias the current country election screen there without changing its internal result logic.
3. Update menu, breadcrumb, place/cross-election, header active-state, and accessibility copy.
4. Move election prerender/SEO to `/elections`; add sitemap and OG coverage.
5. Add route/link parity and browser screenshots against the former root.

Exit: every former root election validation passes at `/elections`; no existing deep URL changes; root still temporarily renders elections until the phase is deployed and verified.

Rollback: remove the static route/link changes; root is still the old election page.

### Phase 2 — generated home stats and stable hub shell

**Goal:** launch a useful global home without depending on the news feed.

Work:

1. Implement deterministic stats generator, tests, refresh registry/order, and publication.
2. Implement hooks, `HubHead`, four figures, two tile bands, scenes, descriptors, and partial states.
3. Add home locale bundle, route skeleton, analytics, accessibility/performance gates.
4. Cut the index route to `HomeDashboardScreen`.
5. Replace root prerender/SEO/JSON-LD/sitemap/OG; retain `/elections` artifacts.

Exit: root is a global, bilingual, indexable hub; `/elections` owns the election experience; all eight destinations work; public stats artifact validates; feed is not required.

Rollback: point index route and root static metadata back to the preserved election screen. `/elections` remains valid and additive.

### Phase 3 — unified finder

**Goal:** make the stable hub useful for direct tasks without loading search corpora at startup.

Work:

1. Implement `useHomeSearch` and place/people/product sources.
2. Extract/reuse one normalized procurement search request.
3. Add lazy-intent, grouping, keyboard, error, and latency gates.
4. Measure endpoint fanout and result-ready latency before/after.

Exit: representative entities across all five groups resolve; no initial search traffic; p75 target and accessibility gates pass.

Rollback: remove the search slot while retaining head, figures, and tiles.

### Phase 4 — core change feed

**Goal:** publish the first honest feed from mature existing event sources.

Initial adapters: procurement, funds/open calls, council/local events, parliament/election lifecycle.

Work:

1. Implement adapters, stable IDs, date semantics, ranking/diversity, backfill summary, and artifact tests.
2. Register generator/refresher/publication paths.
3. Implement feed/card rendering and translations.
4. Replay 30 days and review false dates, duplicates, route quality, and category balance.
5. Render the first six below the tile grid only after replay acceptance.

Exit: public feed artifact passes schema/date/diversity/size gates; every rendered fact has a working destination and source basis; no ingest timestamp is mislabeled as occurrence.

Rollback: hide the feed section; stats/grid/search remain independent and the prior feed artifact may stay published.

### Phase 5 — prices, budget, and debt events

**Goal:** cover the highest persistent-interest topics with stricter source-specific gates.

Work:

1. Run the 90-day price threshold replay and approve comparison/sample rules.
2. Add official CPI and qualified basket/promotion events.
3. Add KFP releases, enacted amendments, and structured domestic debt auction/results.
4. Add document-only budget notices without claiming numeric change.
5. Add editorial-review flow for international debt; do not auto-publish until a structured authority exists.

Exit: replay and editorial samples meet accepted correction/volume thresholds; price coverage changes cannot masquerade as price moves; debt/budget date basis is explicit.

Rollback: disable individual adapters by source registry; other categories continue.

### Phase 6 — watcher integration and operational hardening

**Goal:** keep artifacts current without manual generator memory.

Work:

1. Wire process-watch source mapping and one final home generation step.
2. Add upload-manifest coverage and public fetch/schema checks.
3. Add failure reporting, atomic writes, determinism, and stale-source monitoring.
4. Document operator replay/review/runbook and recovery.

Exit: a controlled source change regenerates exactly the expected home files, publishes them, and is visible in the browser; a failed adapter preserves the prior public artifact and reports red.

Rollback: remove watcher mapping; manual `db:gen-home-*` remains available.

### Phase 7 — personalization evaluation, not automatic delivery

**Goal:** decide whether event-level watchlists are ready.

Work:

1. Measure 30-day event-ID stability across rebuilds/backfills.
2. Prototype subject matching for place/company/institution/product/programme/sector.
3. Test per-subject precision and volume with internal fixtures.
4. Write a separate authorization/product plan for accounts and delivery channels if justified.

Exit: an evidence-backed go/no-go decision. Email/push is not part of this plan’s definition of done.

## 16. Required command gates

Exact test file arguments may be narrowed per phase, but final v1 validation includes:

```bash
# Generate and compare
npm run db:gen-home-hub-stats
npm run db:gen-home-feed
npm run db:check-generated

# Data/unit/route/i18n
npx vitest run scripts/db/tests/home_hub_stats.data.test.ts
npx vitest run scripts/db/tests/home_feed.data.test.ts
npx vitest run src/screens/home src/data/home src/data/alerts
npx vitest run src/ux/infographic/hubHead.gates.test.ts
npx vitest run scripts/prerender/ogAndSitemapCoverage.test.ts scripts/og/capture_routes.test.ts

# Publish before live-data browser gates
npm run bucket:sync:paths -- --dry-run home
npm run bucket:sync:paths -- home

# Write public artifacts before build
npx tsx scripts/og/capture-screens.ts home
npx tsx scripts/og/capture-screens.ts elections
npm run sitemap

# Full rendered gates
npm run build
npm run test:seo
npm run test:perf
npm run test:unit -- tests/ui.spec.ts
```

Before using the block, implement/verify the capture CLI’s accepted route names and the bucket sync path. Do not copy a command into automation until its dry run proves the target set.

For each phase:

1. run generator/unit gates;
2. inspect the exact generated diff and byte sizes;
3. publish only after a dry run;
4. fetch the public object and validate it;
5. render affected routes at required breakpoints/locales/themes;
6. inspect OG images, sitemap, console, and network;
7. perform focused review and repair valid findings;
8. rerun the narrow and affected shared suites;
9. commit the phase separately.

## 17. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Root cutover destroys election discoverability | parity bridge at `/elections`, route/link/SEO migration before root switch, seasonal notice |
| Home becomes a list of every dataset | fixed eight-tile registry, two semantic bands, one number per destination at most |
| Head repeats destination dashboards | four disjoint national pulse figures with explicit destination ownership |
| Numbers from overlapping corpora are added | fold destination-owned values only; data tests reject cross-corpus sums |
| “News” is really ingest chronology | separate occurrence/publication/effective/deadline/first-seen fields and labelled rendering |
| Backfill floods the feed | summary mode, backfill flag/penalty, per-category cap |
| Prices generate noisy or false discounts | same-cohort/sample/coverage gates and 90-day replay before launch |
| Debt/budget claims outrun sources | structured domestic auto path; international/numeric ambiguity is editorial-review gated |
| Local feed overrepresents active municipalities | national relevance rule, max two/category, source coverage disclosure |
| Home initial load pulls every search corpus | finder arms on intent; source reuse and request-count tests |
| Static artifacts become stale | refresh registry, watcher mapping, bucket publication, public fetch and freshness monitoring |
| Generator rewrites files daily with no data change | source-vintage computedAt, stable sort, byte-identical determinism gate |
| Alert builder/UI kinds drift again | shared exhaustive registry and builder-to-renderer enumeration |
| Home locale copy bloats core | dedicated `home` bundle, reachability analysis, measured brotli budgets |
| New root ships stale election metadata | atomic prerender/sitemap/OG phase and coverage tests for both routes |
| Unrelated dirty work is overwritten | phase-level status/diff inspection and narrow patches/staging |

## 18. Definition of done

V1 is complete only when:

- `/` is the canonical global Bulgaria dashboard and `/elections` is the preserved canonical current election entry;
- every old deep parliamentary and local-election URL remains valid and reachable;
- root composes `HubHead`, shows four sourced/based pulse figures, one lazy finder, and eight tested destination tiles;
- home statistics and feed artifacts are deterministic, budgeted, registered, refreshed, published, and verified from the public path;
- the first six feed rows obey typed date semantics, source/coverage disclosure, materiality, backfill, diversity, and route gates;
- `open_call` and every other alert kind is exhaustively shared between output and UI;
- no missing source renders as zero and no first-seen timestamp renders as occurrence;
- Bulgarian and English locale parity covers every generated enum/fact kind without localized artifact prose;
- root and `/elections` have unique prerender body, canonical, metadata, sitemap entries, JSON-LD, and inspected OG images;
- loading, partial, error, stale, mobile, keyboard, dark/light, contrast, CLS, LCP, entry-graph, and payload gates pass;
- process-watch can regenerate and publish only the expected home artifacts after an eligible source change;
- launch analytics are privacy-safe and the first four-week review is scheduled/documented;
- no email, push, account, or real-time-delivery promise appears in UI or documentation without a separate approved plan;
- final review finds no unresolved correctness, date/source integrity, accessibility, performance, navigation, publication, or SEO issue.

## 19. Explicitly out of scope

- replacing destination dashboards with home summaries;
- redesigning the full election result hierarchy beyond preserving it at `/elections`;
- a live newsroom or general-media aggregation product;
- user accounts, email, push, SMS, or real-time notification infrastructure;
- predicting elections, prices, debt terms, or budget outcomes;
- creating a single total for overlapping public-money sources;
- scraping all 265 municipal feeds into a national feed;
- adding a new analytics/search dependency without a measured need;
- changing canonical source authorities or ingest ownership;
- deleting the historical election OG asset while another route/article references it;
- automatically promoting editorial-review events.
