# Elections hub — full implementation plan

**Status:** ready to execute  
**Product brief:** [elections-hub-research-v1.md](./elections-hub-research-v1.md)  
**Scope:** parliamentary and local election results at country, abroad, region, municipality, settlement, and polling-section levels  
**Version:** v1 — additive route and shared surface system; no public-URL migration

## 1. Outcome

Ship `/elections` as the single entry into a shared, results-first election experience while preserving the depth and public URLs that already exist.

The reader should be able to answer the primary question for the current place in the first screen:

- parliamentary: who led, by how much, with how many votes/seats, and where;
- local: who won the relevant mayoral office, which group leads the council, and whether control is split;
- abroad: which party led and where, using votes cast rather than a false turnout denominator;
- section: what each ballot recorded and how to open the official evidence.

The implementation must simplify hierarchy, not remove maps, mayors, council composition, candidates, histories, flows, or evidence tables. Those remain below the first result surface or behind an existing complete-results destination.

## 2. Fixed v1 decisions

These decisions are implementation constraints, not open design questions.

1. Add a canonical `/elections` entry.
2. Preserve `/`, `/elections/:date`, `/local/:cycle`, and every current place/result leaf. Do not introduce redirects or a new `/elections/:kind/:cycle/...` family in v1.
3. Merge the two top-navigation election menus into one Elections menu, but preserve every existing destination.
4. Use one shared page grammar and shared primitives. Keep parliamentary and local outcome contracts as discriminated types; do not normalize mayor and council votes into a single ranking.
5. Create a small, generated `surface` projection per route scope. It is a display projection of canonical result files, not a new result authority.
6. Keep geometry, full history, vote-flow matrices, long candidate lists, and evidence tables out of the surface projection and lazy-load them through the existing hooks.
7. On mobile, the ranked result precedes the map in DOM and visual order. On desktop, they appear side by side.
8. A map always has a complete text/list equivalent. Color is never the only winner or state encoding.
9. Local country and region render mayor and council as separate modes/panels. Municipality renders separate mayor and council panels when those ballots exist.
10. Never publish turnout abroad unless a valid eligible/registered-voter denominator exists. The v1 parliamentary-abroad surface uses total votes cast and valid votes.
11. Show at most four outcome facts and three standouts above the deeper analysis.
12. A statistical signal is a review lead, never evidence of fraud. Every signal must expose scope, metric, baseline, sample size, status, and an evidence destination.
13. Generated surface data lands invisibly before each UI migration. Every migrated page retains a legacy fallback until its generated artifact passes data and route tests.
14. Every new canonical page ships with prerender, both sitemap declarations/artifacts, canonical metadata, internal reachability, and a dedicated OG image in the same phase.

## 3. Existing contracts to preserve

### Routes

Parliamentary:

- country: `/` and historical `/elections/:date`;
- region and abroad: `/municipality/:id`, where `32` is abroad;
- municipality: `/settlement/:id`;
- settlement: `/sections/:id`;
- section: `/section/:id`.

Local:

- country: `/local/:cycle`;
- region: `/local/:cycle/region/:oblast`;
- municipality: `/local/:cycle/:obshtinaCode`;
- settlement: `/local/:cycle/settlement/:ekatte`;
- section: `/local/:cycle/:obshtinaCode/section/:sectionCode`;
- complete mayor/council/section and leaderboard leaves remain unchanged.

The parliamentary route names are historically one geographic level off. User-facing copy and the new surface types must use the real level; route segments remain untouched in v1.

### Existing data authorities

- Parliamentary country: `data/<cycle>/national_summary.json` plus canonical election shards.
- Parliamentary subnational summaries: canonical region/municipality/settlement/section shards and their prior-cycle stats; current React hooks compute the summaries client-side.
- Local country: `data/<cycle>/index.json`, `regions_summary.json`, `national_leaders.json`, and `national_municipalities.json`.
- Local region: `data/<cycle>/region/<oblast>.json`.
- Local municipality: `data/<cycle>/municipalities/<obshtinaCode>.json`.
- Local settlement: the parent municipality bundle plus the resolved `kmetstva[]` contest.
- Local section: `data/<cycle>/sections/<obshtina>/<sectionCode>.json`.

The new projection must be reproducible from these files and must not become an independently edited source.

### Components worth retaining

- `PlaceHeader` and its place breadcrumb/switcher behavior;
- current map tiles at every level;
- `PartyResultsTile`, `LocalRankedBar`, mayor runoff, council hemicycle, MPs/candidates, and source/protocol links;
- the deeper `DashboardSection` bodies and their existing complete-result leaves;
- current local place-resolution special cases for Sofia and Plovdiv/Varna districts.

## 4. Target page grammar

Every election result page uses this order:

1. `PlaceHeader` — place identity and cross-module navigation;
2. `ElectionScopeBar` — kind, cycle, round/contest when relevant, finder, result status, source;
3. `ElectionOutcomeStrip` — zero to four non-duplicative facts;
4. `ElectionOutcomeCanvas` — ranked result plus map;
5. `ElectionStandouts` — zero to three grounded findings;
6. existing detailed sections in a stable order;
7. `ElectionSourcePanel` — method, downloads, protocols, update state.

Desktop canvas:

```text
┌ map / geography question ───────────┬ ranked result ──────────────┐
│ synchronized selection and legend  │ votes · % · seats/margin   │
└─────────────────────────────────────┴─────────────────────────────┘
```

Mobile DOM order:

```text
scope → facts → ranked result → map → standouts → detail
```

The map remains prominent. CSS grid placement must not use `order` to create a visual order that differs from the DOM.

## 5. Shared data contract

Create the browser/script-shared types in `src/data/elections/surfaceTypes.ts` and keep them free of React or Node imports.

```ts
type ElectionKind = "parliamentary" | "local";
type ElectionPlaceLevel =
  | "country"
  | "abroad"
  | "region"
  | "municipality"
  | "settlement"
  | "section";

type ElectionResultStatus =
  | "projection"
  | "provisional"
  | "final"
  | "runoff_pending"
  | "partial_election";

type TurnoutBasis = "registered_voters" | "eligible_population" | "unavailable";

type BallotKind =
  | "parliamentary_list"
  | "municipality_mayor"
  | "district_mayor"
  | "settlement_mayor"
  | "municipal_council";

type ElectionSurfaceV1 = {
  schemaVersion: 1;
  kind: ElectionKind;
  cycle: string;
  place: {
    level: ElectionPlaceLevel;
    id: string;
    parent?: { level: ElectionPlaceLevel; id: string };
  };
  status: {
    result: ElectionResultStatus;
    updatedAt?: string;
    countedPct?: number;
    sourceLabel: "cik";
    sourceUrl?: string;
    downloadUrl?: string;
  };
  ballots: ElectionSurfaceBallot[];
  facts: ElectionSurfaceFact[]; // maximum 4 across active ballot
  standouts: ElectionStandout[]; // maximum 3
  destinations: ElectionDestinations;
};
```

`ElectionSurfaceBallot` must include:

- `kind`, `round`, and `resultStatus`;
- a ranked preview of no more than eight entries;
- explicit `votes`, `pct`, optional `seats`, and optional `marginPct`;
- totals with `votesCast`, `validVotes`, optional `registeredVoters`, optional `turnoutPct`, and mandatory `turnoutBasis`;
- map metadata only: default question, allowed modes, geography grain, and the existing data/geometry destination;
- a complete-results destination;
- an optional official protocol/video/scan destination at section level.

`ElectionSurfaceFact` is a typed fact code plus values and basis, not generated prose. Renderers map fact codes to Bulgarian/English translations. At minimum support:

- winner/leader and margin;
- seats and majority threshold;
- turnout with basis;
- valid votes or total votes cast;
- runoff state;
- split control;
- wasted vote/threshold where applicable.

`ElectionStandout` must contain:

```ts
type ElectionStandout = {
  id: string;
  category: "outcome" | "participation" | "review";
  signal: string; // closed enum in the actual implementation
  metric: number;
  unit: "votes" | "pct" | "pct_point" | "count" | "seats";
  scope: { level: ElectionPlaceLevel; id: string };
  baseline: { kind: string; labelParams: Record<string, string | number> };
  sampleSize: number;
  resultStatus: ElectionResultStatus;
  evidenceTo: string;
  labelParams: Record<string, string | number>;
};
```

Do not store translated sentences in generated files. Do not emit a standout when its denominator, baseline, or evidence destination is missing.

### Artifact paths

Artifacts stay inside each existing cycle directory:

```text
data/<cycle>/surface/country.json
data/<cycle>/surface/region/<oblast>.json
data/<cycle>/surface/municipality/<obshtina>.json
data/<cycle>/surface/settlement/<ekatte>.json
data/<cycle>/surface/section/<sectionCode>.json
data/<local-cycle>/surface/section/<obshtina>/<sectionCode>.json
```

`region/32.json` declares `place.level: "abroad"`. Local generation never emits an abroad artifact.

Avoid duplicating an already route-sized detail file. Local section details are already emitted one station at a time, so the preferred implementation is to add a `surface` projection to `data/<local-cycle>/sections/<obshtina>/<sectionCode>.json` and let `surfacePath.ts` read that file. Use the sidecar path above only where changing the canonical detail shape would break an existing consumer. Parliamentary sections currently live in oblast shards, so they need a route-sized sidecar unless the underlying section publication is refactored first. Record generated file-count and total-byte deltas alongside the per-file budget; a fast page is not sufficient justification for an uncontrolled six-figure file expansion.

### Size and fetch budgets

- country surface: at most 24 KiB uncompressed JSON;
- every subnational surface: at most 16 KiB;
- section surface: at most 8 KiB;
- no geometry, history series, flow matrix, full candidate list, or full section list in a surface;
- one surface request may determine the strip, ranking, status, and standouts;
- the map may issue its current result/geometry requests, but the first result may not fan out across child-place bundles;
- new chart/map libraries remain outside the entry chunk and are loaded only when their panel mounts.

These are initial ceilings. Measure actual output after the first country and municipality fixtures and tighten before merging if the maximum is less than 70% of a ceiling.

No new runtime package is expected. Use the existing React Query, cmdk/search catalogs, map implementations, Tailwind primitives, i18n, Vitest, and Playwright stack. A new dependency requires a measured reason and an entry-chunk comparison.

## 6. Descriptor and component architecture

### New files

```text
src/data/elections/surfaceTypes.ts
src/data/elections/surfacePath.ts
src/data/elections/useElectionSurface.ts
src/data/elections/electionSurfaceAvailability.ts

src/screens/elections/ElectionsHubScreen.tsx
src/screens/elections/ElectionResultsShell.tsx
src/screens/elections/electionSurfaceDescriptors.ts
src/screens/elections/ElectionScopeBar.tsx
src/screens/elections/ElectionPlaceFinder.tsx
src/screens/elections/ElectionStatusRow.tsx
src/screens/elections/ElectionOutcomeStrip.tsx
src/screens/elections/ElectionOutcomeCanvas.tsx
src/screens/elections/ElectionRankedResult.tsx
src/screens/elections/ElectionMapPanel.tsx
src/screens/elections/ElectionStandouts.tsx
src/screens/elections/ElectionSourcePanel.tsx
src/screens/elections/ElectionSurfaceBoundary.tsx
```

### Descriptor matrix

`electionSurfaceDescriptors.ts` is a pure-data, exhaustive matrix keyed by `kind × level`. It declares composition, not numbers:

- active ballot(s) and their label;
- default map question and allowed mode labels;
- fact priority and maximum count;
- ranked-result columns;
- deeper section order;
- absence/empty-state copy;
- whether a finder, official protocol, or child-place preview is available.

The matrix must be type-exhaustive. A new election kind or level should fail TypeScript until it has a descriptor.

Do not build a universal component with dozens of optional props. `ElectionResultsShell` owns order and accessibility; descriptor-selected adapters provide parliamentary/local differences.

### Adapters

`ElectionMapPanel` wraps existing map tiles through typed slots rather than reimplementing maps. Initial adapters:

- parliamentary country → `RegionsMapTile`;
- parliamentary region/abroad → `RegionMunicipalitiesMapTile`;
- parliamentary municipality → existing municipality/section map variants;
- parliamentary settlement → `SectionsMapTile`;
- local country → two `LocalRegionsControlMapTile` modes;
- local region → existing local municipality-control map;
- local municipality → mayor/council section maps where data exists;
- local settlement → contest-appropriate parent/section geography;
- a single section → no decorative map.

`ElectionRankedResult` owns accessible list/table semantics. It supports party votes/seats, mayor candidates/margin/round, and council votes/seats as explicit variants.

### Finder

Build `ElectionPlaceFinder` from `src/data/search/placeSearchItems.ts` and the existing place catalogs. Route resolution must go through `placeViewUrl`/`localUrl`, including Sofia and city-district special cases.

- Results are grouped by region, municipality, settlement, and section.
- The current election kind and cycle are preserved when a destination exists.
- Local-unavailable places show a disabled explanation or fall back to the nearest served parent; they never lead to an empty page.
- Abroad search is parliamentary-only.
- Selecting a polling section while switching kind explicitly announces the settlement fallback.

## 7. Standout selection rules

Implement pure selectors in `scripts/elections/standouts.ts` with fixture tests. Selection happens at generation time.

Priority slots:

1. outcome/change — winner margin, lead change, threshold/majority, split control, runoff;
2. participation/competition — turnout change where the denominator is valid, unusually close contest, unusually fragmented council;
3. review — only a documented existing review signal with a direct evidence destination.

Rules:

- emit at most one standout per category;
- prefer a material local fact over a weaker national comparison;
- require a minimum sample size appropriate to the metric;
- include the actual comparison group and cycle in the baseline;
- suppress turnout comparison when `turnoutBasis === "unavailable"`;
- suppress a review signal if the evidence leaf is absent for that cycle/scope;
- use neutral copy: “stands out”, “differs from”, “flagged for review”; never “fraud”, “manipulation”, or causal language;
- Benford-only output never receives a headline slot;
- deterministic tie-breaking is metric, then sample size, then stable place/result ID.

The implementation phase must freeze numeric thresholds in a short method note beside the selector and expose them in the source panel. Threshold changes require fixture updates.

## 8. Level-by-level composition

| Level        | Parliamentary lead                                                                  | Local lead                                                                          | Required deeper links                                                   |
| ------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Country      | party votes, seats, winner/margin map, threshold/wasted vote, valid turnout         | separate mayor-control and council-support modes, runoffs, split control            | regions, municipalities, analyses, reports, partial elections           |
| Abroad       | party votes, total votes cast, countries/cities, voting mode; no turnout percentage | unavailable with explanation                                                        | countries/cities/sections and source guidance                           |
| Region       | party result/change, MPs/candidates, municipality map                               | mayor control and council control by municipality, runoffs/split control            | all municipalities and full leaderboards                                |
| Municipality | party result/change/preferences and child-place map                                 | elected mayor or runoff pair plus council seats/majority; split control explicit    | full mayor result, full council result, settlements/districts, sections |
| Settlement   | party result/change and leading sections                                            | own settlement-mayor contest only when held; parent council clearly labeled context | section list, full parent context, source                               |
| Section      | ranked parliamentary result and protocol/audit context                              | separate mayor/council/district ballot panels only when data exists                 | official protocol, scan/video, parent settlement                        |

At section level, a missing ballot is “not held/not available”, not zero votes. Mayor and council totals are never added.

## 9. Delivery phases

Each phase ends with targeted tests, a focused code review of only that phase, repair of all valid findings, and a separate commit. Do not start the next phase with known defects.

Critical path:

```text
definitions → generated data → runtime primitives → /elections
                                          ├→ country/region
                                          ├→ municipality
                                          └→ settlement/section
all migrated levels → measured reduction → optional URL study
```

The data generator is the only hard blocker for production migration. SEO/OG work for `/elections`, fixture-based component work, and finder/navigation tests can proceed after the schema freezes, but none should merge with invented fixture-only facts in the live route.

### Phase 0 — definitions and executable prototypes

**Goal:** remove ambiguity before data generation or route changes.

Work:

1. Add `surfaceTypes.ts` with the discriminated contracts above.
2. Add `electionSurfaceDescriptors.ts` for every kind/level combination.
3. Freeze status vocabulary, turnout bases, fact priority, and standout categories in `docs/methodology/election-surfaces.md`.
4. Create static fixture payloads for:
   - parliamentary country;
   - parliamentary abroad;
   - local country;
   - local municipality with runoff and split control;
   - local settlement without its own mayoral ballot;
   - section with multiple local ballots.
5. Build an isolated `ElectionResultsShell` component story/test page using fixtures at 390 px and 1440 px.
6. Validate the four research tasks with internal walkthroughs before generator work.

Tests/gates:

- exhaustive descriptor type test;
- schema invariant tests;
- DOM-order test: ranked result before map;
- keyboard focus order and visible focus;
- map alternative/list always present;
- no more than four facts and three standouts;
- contrast check in light/dark mode.

Exit criterion: product/design accepts the country and municipality grammar and the schema can represent every level without generic `unknown` payloads.

### Phase 1 — generated surface data

**Goal:** produce small, deterministic projections before any production page consumes them.

New script files:

```text
scripts/elections/build_surfaces.ts
scripts/elections/build_parliamentary_surface.ts
scripts/elections/build_local_surface.ts
scripts/elections/standouts.ts
scripts/elections/source_links.ts
scripts/elections/surface_budget.test.ts
scripts/elections/build_surfaces.test.ts
scripts/tests/election/surfaces.data.test.ts
```

Integration:

1. Parliamentary country generation reuses `generateNationalSummary` outputs.
2. Parliamentary subnational generation reads canonical shards and prior-cycle stats once in Node; it replaces the headline computation currently repeated in `useRegionSummary`, `useMunicipalitySummary`, `useSettlementSummary`, and `useSectionSummary`.
3. Local country/region generation runs after `buildLocalRollups` and projects the already-built index, region summaries, leaderboards, and municipality rows.
4. Local municipality/settlement/section generation reads one canonical municipality/section bundle at a time and releases it; do not hold the full local corpus in memory.
5. Add `--election-surfaces` and optional `--date`/`--local-date` wiring in `scripts/main.ts`.
6. Invoke the relevant surface build at the end of parliamentary summaries and local rollups. Keep the standalone flag for repair/rebuild.
7. Add the new JSON name/path to bucket upload and gzip rules only after confirming the existing cycle subtree wildcard does not already include it.

Data gates:

- schema and version valid for every emitted file;
- output facts reconcile exactly to canonical vote/protocol/seat totals;
- local mayor and council denominators remain distinct;
- an elected mayor resolves to the decisive round;
- settlement surfaces never attribute a parent council as a settlement office;
- `region/32` has no turnout percentage and declares `turnoutBasis: "unavailable"`;
- every standout evidence route/file exists;
- every map mode is allowed by the data available at that scope;
- artifact budgets pass for the largest country, municipality, settlement, and section cases;
- deterministic rebuild produces byte-identical JSON.

Exit criterion: all current parliamentary cycles and regular local cycles can generate valid artifacts, and the latest cycles pass reconciliation and size gates.

### Phase 2 — shared runtime primitives

**Goal:** land the shell and adapters behind data-availability fallbacks without changing public composition.

Work:

1. Implement `surfacePath.ts` and `useElectionSurface.ts` using `dataUrl` and React Query.
2. Implement `ElectionSurfaceBoundary`; it renders the new surface only for `schemaVersion === 1`, otherwise the existing composition.
3. Implement scope bar, finder, status row, strip, canvas, ranking, standouts, and source panel.
4. Reuse existing maps through adapters; do not import Leaflet/d3/recharts into the shell module.
5. Add loading skeletons with fixed dimensions matching the final ranking/map layout.
6. Add Bulgarian and English keys to the core election copy with locale parity tests. Keep long existing analysis copy in its current bundles.

Runtime gates:

- one surface fetch produces identity facts/ranking/status/standouts;
- a missing/corrupt surface falls back without an empty first screen;
- map modules stay lazy and absent on the section composition;
- screen-reader labels include value, unit, candidate/party, and basis;
- selected map feature is reflected in the ranked list and vice versa;
- no layout shift when the map arrives.

Exit criterion: fixture and live-data component tests pass while every production page still renders its legacy composition.

### Phase 3 — `/elections`, combined navigation, and route artifacts

**Goal:** establish the unified entry without moving any result URL.

Route/UI work:

1. Add a static `elections` route before `elections/:date` in `src/routes.tsx`, lazy-loading `ElectionsHubScreen`.
2. `/elections` defaults to the latest election event and offers Parliamentary/Local selection with explicit dates/status. Selection navigates to the existing canonical full result (`/elections/:date` or `/local/:cycle`) rather than inventing a hidden client-only result state.
3. The lead area uses one latest-event outcome canvas, not two simultaneous maps. A compact adjacent latest-cycle link exposes the other election kind.
4. Add one “Find my place” control and curated entry links to analyses, reports, places, and partial local elections below the lead result.
5. Merge `electionsMenu` and `localMenu` in `src/layout/header/reportMenus.ts`; update `Header.tsx` to render one Elections top-level item. Preserve all current leaves, grouped as Results, Places, Analysis and review, and Partial/local administration.
6. Keep the current Parliamentary and Local pills in `PlaceViewNav` in v1; the shared `ElectionScopeBar` provides the family relationship. Re-evaluate pill consolidation only with the optional URL migration.

Artifact work in the same commit:

1. Add `/elections` BG and `/en/elections` to `scripts/prerender/routes.ts`.
2. Add the static path to `scripts/sitemap/route_defs.ts` and regenerate committed sitemaps.
3. Add dedicated SEO title, description, canonical, H1, and indexable body.
4. Add a dedicated `public/og/elections.png` capture in `scripts/og/capture-screens.ts`, anchored to the rendered outcome canvas.
5. Add `/elections` to `scripts/og/capture_routes.test.ts`, `scripts/prerender/ogAndSitemapCoverage.test.ts`, and `tests/seo.spec.ts`.
6. Add a direct header link and at least one contextual link from `/` and `/local/:cycle` so reachability does not depend on the sitemap.

Exit criterion: `/elections` is unique, indexable, reachable, bilingual, and all existing election links still resolve to their original destinations.

### Phase 4 — country and region migration

**Goal:** make the most-used levels consistently results-first.

Parliamentary files:

- `src/screens/DashboardScreen.tsx`;
- `src/screens/ElectionScreen.tsx`;
- `src/screens/dashboard/DashboardCards.tsx`;
- `src/screens/MunicipalitiesScreen.tsx`;
- `src/screens/dashboard/RegionDashboardCards.tsx`.

Local files:

- country branch in `src/screens/LocalElectionScreen.tsx`;
- `src/screens/dashboard/local/LocalCountryDashboardCards.tsx`;
- `src/screens/LocalRegionDashboardScreen.tsx`;
- `src/screens/dashboard/local/LocalRegionDashboardCards.tsx`.

Work:

1. Insert `ElectionScopeBar` immediately after `PlaceHeader`.
2. Replace the legacy KPI row and first votes section with `ElectionResultsShell` backed by the surface artifact.
3. Preserve all current deeper sections after standouts; remove only numbers duplicated by the new strip/canvas.
4. Parliamentary country/region lead with winner+margin map and ranked party result.
5. Local country/region expose Mayor and Council as explicit modes with independent legends, totals, and ranked equivalents.
6. Abroad uses the parliamentary region adapter, total votes cast, country/city ranking, and no turnout fact/card.
7. Upgrade `electionsResultsFirst.gates.test.ts` from legacy source scanning to rendered shell/descriptor assertions; retain a route-level anti-vacuity test.

Exit criterion: country, region, and abroad pass the shared result-first gates, and every old deep result/analysis remains reachable within one click from its migrated page.

### Phase 5 — municipality migration

**Goal:** answer the highest-value local question without flattening the ballots.

Files:

- `src/screens/SettlementsScreen.tsx`;
- `src/screens/dashboard/MunicipalityDashboardCards.tsx`;
- municipality branch in `src/screens/LocalElectionScreen.tsx`;
- local mayor/council compact tiles and maps under `src/screens/dashboard/local/`.

Work:

1. Parliamentary municipality: lead with ranked party result and child geography; preferences remain directly below when available.
2. Local municipality: show the decisive mayor result or runoff pair first, including margin and current/by-election status.
3. Render council composition separately with seats, majority threshold, lead group, vote share, and full-results link.
4. Emit and render a split-control standout when mayor and leading council group differ.
5. Keep district mayors, settlement mayors, council members, trends, officials reconciliation, and section analysis below the shared surface.
6. Preserve Sofia city/rayon and Plovdiv/Varna district behavior through existing catalogs and adapters.

Exit criterion: task 2 — “Who is mayor, which group leads the council, and are they the same?” — is answerable without scrolling on 390 px and 1440 px for outright, runoff, split-control, independent, and city-district fixtures.

### Phase 6 — settlement and section migration

**Goal:** make ballot availability and official evidence unambiguous at the finest levels.

Files:

- `src/screens/SectionsScreen.tsx`;
- `src/screens/dashboard/SettlementDashboardCards.tsx`;
- `src/screens/SectionScreen.tsx`;
- `src/screens/dashboard/SectionDashboardCards.tsx`;
- `src/screens/LocalSettlementDashboardScreen.tsx`;
- `src/screens/dashboard/local/LocalSettlementDashboardCards.tsx`;
- `src/screens/LocalSectionScreen.tsx`.

Work:

1. Parliamentary settlement keeps ranked result before sections map on mobile and provides leading-section preview and complete list.
2. Local settlement renders its own settlement-mayor contest only when the ballot existed. Otherwise render a plain explanation and a clearly labeled parent-municipality council context.
3. Parliamentary section removes decorative geography and leads with result, address, risk/review context, and official scan/video/protocol links.
4. Local section renders separate compact panels for council, municipality mayor, and district mayor only when each vote array/denominator exists.
5. Do not infer zeros for absent arrays or unavailable older-cycle ballots.
6. Kind switching from a section falls back to the settlement and announces why section codes do not map reliably between election kinds/cycles.
7. Add source-link reconciliation tests for CEC protocol, scan, video, and download URLs.

Exit criterion: task 4 — open the official protocol for a station — succeeds from both parliamentary and local section pages, and no page combines unlike ballots.

### Phase 7 — progressive reduction and analysis integration

**Goal:** reduce repetition after the shared surfaces prove useful, without deleting depth.

Work:

1. Instrument clicks from surface facts, map/list selections, standouts, finder, and “see all” links using the existing analytics seam if present at implementation time; do not add a vendor solely for this feature.
2. Run the four research tasks with at least five readers across phone and desktop, including one keyboard-only walkthrough.
3. Use findings to remove duplicate KPI bands and repeated charts. Every removal requires an existing reachable complete-results destination and a regression test for it.
4. Reorder deeper sections consistently: Outcome detail → Geography → Comparison/history → People/representation → Review signals → Data/method.
5. Keep `DashboardSection` for deep content; do not turn the result surface into the ordinary hub tile registry.
6. Add a short methods disclosure explaining standout selection, limitations, and result status.

Exit criterion: primary-task completion improves or remains stable, no evidence destination loses reachability, and the first viewport meets the information budget at every level.

### Phase 8 — optional URL migration, separately approved

This phase is not part of v1 shipping and must not begin automatically.

Evaluate `/elections/:kind/:cycle/<scope>` only after all existing surfaces have parity. A migration proposal must include:

- old→new route table for every scope and special case;
- redirect/canonical behavior;
- full internal-link rewrite;
- prerender count and build-time impact;
- both sitemap producers and committed artifact regeneration;
- per-family OG strategy;
- search-index and external-link risk;
- rollback redirects;
- a measured reason the cleaner URLs justify the migration.

## 10. Cross-cutting test matrix

### Data correctness

- national totals equal the sum of canonical region totals;
- preview ranking is a stable prefix of the complete ranking;
- winner, runner-up, margin, seats, and majority threshold reconcile;
- current and prior cycles use the same party/candidate identity rules as existing summaries;
- local elected winner comes from resolved decisive round;
- council seat totals match elected mandates;
- independent/local-only groups retain their existing canonical buckets;
- status and update time come from source/ingest metadata, not browser time;
- no abroad turnout without an approved basis;
- absent ballot and zero-vote ballot are distinct.

### Component/accessibility

- one H1 and logical H2 order;
- result/list available without map interaction;
- map legend uses labels/symbols in addition to color;
- map/list selection has keyboard support and announced state;
- tables retain headers and captions on mobile overflow;
- fact deltas announce direction and unit, not only arrow/color;
- focus is not moved on mode/cycle changes unless navigation occurs;
- reduced-motion preference disables nonessential transitions;
- light/dark contrast passes for party colors against their rendered background, with text/pattern fallback where a party color cannot pass.

### Route/navigation

- every kind/level descriptor resolves to a live canonical route;
- finder destinations exist for representative normal, Sofia, city-district, abroad, and section-fallback cases;
- all previous menu destinations still appear after menu merge;
- local is unavailable abroad;
- historical `/elections/:date` continues to override the query election context;
- no stale breadcrumb uses the historical route segment as the geographic label.

### SEO/artifacts

- `/elections` and `/en/elections` unique title, H1, description, canonical, body;
- per-election and place pages keep their existing canonicals in v1;
- every new page has prerender, sitemap, and dedicated OG coverage;
- OG capture waits for a populated result canvas, not its skeleton;
- committed sitemap contains both language variants where supported;
- no route falls through to home shell metadata.

### Performance

- raw surface budgets enforced in unit/data tests;
- `/elections` route chunk remains lazy from the app entry;
- heavy map/chart vendor chunks do not join the entry static graph;
- result text becomes available before or independently of map geometry;
- CLS below 0.1 for `/elections`, parliamentary/local country, one municipality, and both section variants;
- localhost LCP smoke below the existing 4 s ceiling;
- no first-screen child-bundle fanout;
- exactly one language bundle is fetched.

### Required representative fixtures/routes

- latest parliamentary country;
- parliamentary abroad (`32`);
- one multi-municipality region and one single-municipality redirect case;
- ordinary municipality and Sofia/city-district special case;
- ordinary settlement and one with no local mayor ballot;
- parliamentary section with scan/video and without optional evidence;
- local country;
- local region;
- local municipality: outright winner, runoff, independent, split control;
- local section: council only, council+municipality mayor, district mayor.

## 11. Commands and phase gates

Exact commands may be narrowed per phase, but the final v1 gate is:

```bash
npm run data -- --election-surfaces
npm run data -- --local-rollups --election-surfaces
npx vitest run scripts/elections src/data/elections src/screens/elections
npx vitest run scripts/tests/election/surfaces.data.test.ts
npx vitest run src/data/local/placeViews.test.ts src/locales/parity.test.ts
npx vitest run scripts/prerender/ogAndSitemapCoverage.test.ts scripts/og/capture_routes.test.ts
npm run sitemap
npm run build
npm run test:seo
npm run test:perf
```

Before using this block, implement the CLI so one standalone `--election-surfaces` run discovers both parliamentary and local cycle directories; do not make operators repeat the second line if the final interface can safely cover both.

For every phase:

1. run the narrowest generator/tests first;
2. render affected routes at 390, 768, 1280, and 1440 px in Bulgarian and English;
3. inspect light/dark mode and keyboard traversal;
4. run a focused code review on the phase diff;
5. repair all valid findings;
6. run the targeted suite again;
7. commit the phase separately.

## 12. Rollout and rollback

Roll out by data capability, not a global boolean feature flag.

1. Deploy additive `surface` JSON files; no UI reads them yet.
2. Deploy shared components with `ElectionSurfaceBoundary` legacy fallback.
3. Launch `/elections` and combined navigation.
4. Enable country/region adapters.
5. Enable municipality.
6. Enable settlement/section.
7. Remove legacy first-screen code only after monitoring and task validation.

Rollback boundaries:

- a missing or invalid artifact automatically renders the legacy body;
- `/elections` can be removed from navigation without affecting any old route;
- generated surface files are additive and may remain published during UI rollback;
- each level adapter can be reverted independently;
- no redirect/canonical migration exists to unwind in v1.

Do not silently fall back after a valid surface request returns malformed data. Log the schema error, render the legacy page, and fail the data/monitoring gate so the corruption is visible.

## 13. Risks and mitigations

| Risk                                        | Mitigation                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Shared UI erases mayor/council differences  | Discriminated ballot types, separate panels/totals, local fixtures and reconciliation gates                            |
| Projection drifts from canonical files      | Generator-only artifacts, exact total reconciliation, deterministic rebuild test                                       |
| First surface becomes another KPI band      | Hard fact/standout caps and required map+ranking composition                                                           |
| Large scope files create fanout or slow LCP | Small route projection, no geometry/history, request and byte budgets                                                  |
| Abroad shows impossible turnout             | Required turnout basis and `region/32` negative data/UI tests                                                          |
| Statistical flags imply wrongdoing          | Neutral closed copy, evidence/baseline requirement, no Benford headline                                                |
| Route cleanup breaks SEO                    | No v1 migration; route artifacts ship atomically; optional migration separately approved                               |
| New shell loses existing depth              | Existing detailed sections remain; every reduction requires a reachable complete-results leaf                          |
| Sofia/district edge cases regress           | Finder/routes use existing catalogs; mandatory special-case fixture set                                                |
| Local older cycles lack ballot fields       | Availability-driven panels; missing is not zero; per-cycle data gates                                                  |
| Duplicate `/` and `/elections` content      | `/elections` is a concise cross-kind entry with unique copy/links; `/` remains the full parliamentary result canonical |

## 14. Definition of done

v1 is complete only when all of the following are true:

- `/elections` is the visible top-navigation entry for parliamentary and local elections;
- every requested level uses the shared scope/status grammar where data exists;
- country and region show map plus ranked result first;
- municipality makes mayor, runoff, council, majority, and split control immediately legible;
- settlement shows only offices actually elected there and labels parent context;
- section pages are result/evidence-first and never combine unlike ballots;
- abroad never displays a turnout percentage without a valid denominator;
- every standout is reproducible, neutral, and evidence-linked;
- surface payload, entry bundle, CLS, LCP, accessibility, i18n, and artifact gates pass;
- all old routes and deep analyses remain reachable;
- the four validation tasks succeed on phone and desktop;
- final review finds no unresolved correctness, accessibility, performance, route, or SEO issue.

## 15. Explicitly out of scope for v1

- changing election result authorities or ingest sources;
- real-time election-night infrastructure beyond representing projection/provisional/final states;
- predicting winners;
- aggregating unlike local ballots;
- a national cartogram without a separate validated prototype;
- deleting existing report/analysis leaves;
- migrating the public route tree;
- adding a new analytics vendor;
- rewriting every existing map before the shared shell ships.
