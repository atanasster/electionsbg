# Context-sensitive header selectors — implementation plan v1

Status: proposed

Date: 2026-09-01

Scope: header context, parliamentary elections, local-election cycles, and URL-backed `pscope`

## 1. Decision

Replace the permanently visible mixed elections dropdown with one stable **context slot** in
the header. The slot shows exactly one control when the current page has a page-wide time or
election context, and nothing on global/scope-free pages.

The slot has four states:

1. **Parliamentary cycle** — on parliamentary-result, election-analysis, and parliament-term
   pages whose primary answer changes with `ElectionContext.selected`.
2. **Local cycle** — on regular `/local/:cycle/**` pages; it lists regular local elections only.
3. **Data period** — on full-page views governed by the URL-backed `?pscope` contract. This is
   a compact header rendering of the page's own resolved scope model.
4. **Empty** — on `/`, general governance, consumption, reference/methodology, and any other
   page where changing an election or period would not change the primary answer.

Use a **hybrid ownership model**:

- an import-free, positive route classifier chooses parliamentary/local/empty states;
- a page renders its dataset-specific scope control into the stable header slot with a React
  portal;
- the header never imports sector registries, dataset hooks, or route-specific year lists.

Do **not** migrate the application from declarative `<BrowserRouter><Routes>` routing merely to
gain route `handle` metadata. React Router's `useMatches`/`handle` pattern is attractive, but
`useMatches` only works with a data router. That migration is unrelated, broad, and unnecessary
for this feature.

Do **not** move every component that happens to reuse `ScopeControl`. The migration criterion is
page-wide URL ownership, not component appearance:

- URL-backed `?pscope` governing the whole page: move to the header;
- caller-owned `useState` year/range picker: keep in content;
- `?pscope` governing only one section of a mixed entity profile: keep beside that section in
  v1, with an explicit “Procurement period” label.

## 2. Why this is the best fit for the current codebase

### 2.1 Current behavior is globally visible but not globally meaningful

`src/layout/header/Header.tsx` always renders `ElectionsSelect` after the logo. The new root
dashboard is global, so the date shown on `/` looks like it scopes the home page even though the
page is no longer an election result.

`src/layout/header/ElectionsSelect.tsx` also combines two unrelated state transitions:

- a parliamentary row writes `?elections=YYYY_MM_DD`;
- a local row navigates to `/local/:cycle`;
- the trigger nevertheless always displays the selected parliamentary date;
- previous/next arrows only traverse parliamentary elections.

On a local route, the trigger therefore displays the wrong kind of context. On
`/elections/:date`, changing the query cannot change the effective selection because the path
date wins in `ElectionContext`; a path-aware picker must navigate to another path instead.

### 2.2 `pscope=ns` is a two-dimensional state

The public-money URL contract is:

- absent `pscope` / `pscope=ns`: the window of the **selected parliamentary election**;
- `pscope=all`: full corpus;
- `pscope=y:YYYY`: one calendar year.

Therefore moving the existing `ScopeControl` into the header while hiding the election picker
would make the active parliament impossible to change. The header version must preserve both
dimensions. A compact single dropdown can do this without showing two large controls:

- parliamentary dates select `elections=<date>` and `pscope=ns` atomically;
- “All years” selects `pscope=all`;
- a year selects `pscope=y:YYYY`;
- the last parliamentary election remains latent while a year/all mode is active and returns
  when the reader selects “This parliament.”

### 2.3 Dataset coverage belongs to the page chunk

The generic picker has important page-specific contracts already:

- agriculture exposes sparse financial years;
- culture film subsidies have their own year range and no separate all-mode;
- administration and collector packs derive supported years from fetched data;
- declarations have parliament/all-parliaments modes and no calendar-year choices;
- some pages intentionally show an unsupported requested year as a no-data state;
- others resolve unsupported values back to their own default.

Recreating those rules in `Header.tsx` would duplicate business logic and pull lazy route data
into the entry chunk. A portal changes physical DOM placement while leaving the component in its
page's React tree, with the same hooks, context, callbacks, and lazy boundary.

### 2.4 Positive classification is safer than the current negative default

The top-nav active state currently treats almost every route not owned by another section as an
election route. That was useful when `/` was an election dashboard; it is unsafe for a selector
that changes data. The new context resolver must positively name only surfaces where the
control is meaningful. An unknown/new route defaults to `none`, not to an election date.

## 3. Product behavior

### 3.1 Header order

Keep the context slot in the current visual position:

`logo → context slot → cabinet anchor (when active) → area anchor → search/navigation`

The slot is stable in DOM and keyboard order even when it is empty. The `CabinetAnchorPill` and
`AreaPill` remain independent global anchors; neither becomes part of the time selector.

### 3.2 Context matrix

| Surface | Header context | Notes |
| --- | --- | --- |
| `/` global home | none | No date placeholder and no reserved empty button. |
| General governance, budget, funds, consumption, data/about pages | none unless the page registers `pscope` | An inert inbound query parameter never makes a selector appear. |
| `/parliamentary`, its analysis/reports hubs, result geographies, party/candidate result views, election risk/report views | parliamentary cycle | Show only when changing the cycle changes the primary answer or navigates to its homologous page. |
| `/votes/**`, `/parliament/**` | parliamentary cycle | The active nav can still be Governance; header context and nav taxonomy are orthogonal. Label the control as parliament/term context. |
| `/elections/:date` | parliamentary cycle, path-owned | Selecting another cycle navigates to `/elections/:nextDate`; it must not merely write an ignored query. |
| Election methodology or fixed article pages | none | A selector that does not change the document is misleading. Preserve an article's own election label in content. |
| Regular `/local/:cycle/**` | local cycle | Only regular cycles from `local_elections.json`; current path cycle is selected. |
| `/local/chmi` | read-only “Partial elections” context or empty | Partials remain contextual and never enter the regular-cycle list. |
| `/local/:partialCycle/**` | read-only partial-election date plus link to its parent regular cycle | Never mark a partial as regular. |
| Full-page URL-backed `pscope` view | data-period control | Page portal owns exact options and overrides any generic route control. |
| Local `useState` year picker (`/defense`, `/judiciary`) | none in v1; keep inline | These are not `pscope` and should not gain global URL semantics accidentally. |
| Mixed company/awarder/person profile where `pscope` affects procurement only | keep inline beside procurement | A header control would falsely imply that identity, declarations, subsidies, and health data are scoped too. |

The route registry should encode the rule “does this control change the primary answer?”, not
“which top navigation menu is active?”. This is why `/votes` can have a parliamentary control
while Governance remains highlighted, and why a fixed election article can have none.

### 3.3 Parliamentary control

Refactor the parliamentary part of `ElectionsSelect` into a dedicated control:

- trigger: `Parliament · 19.04.2026` on term pages, or just the localized date on result pages;
- menu rows: date, winner/turnout metadata where already available, selected checkmark;
- previous/next arrows: keep only at wide desktop if user testing shows value; hide below `xl`;
- query-owned routes call `setSelected`;
- path-owned `/elections/:date` routes navigate to the next dated path;
- prefetch remains on hover/focus;
- local rows are removed from this menu.

The trigger's accessible name must describe its function and value, for example
“Parliamentary election: 19 April 2026,” rather than only “Select election year.”

### 3.4 Local-cycle control

Create `LocalCycleSelect` from the regular catalogue returned by `useLocalElectionList()`:

- sort newest first;
- display round-one dates and, where useful, the year label;
- selected state comes from the `:cycle` path parameter, never from `ElectionContext`;
- previous/next traverse regular cycles only;
- a menu change navigates to a homologous path through one tested helper;
- partial cycles are never options.

Recommended path-switch behavior:

| Current local path kind | Next-cycle destination |
| --- | --- |
| cycle overview or cycle-level leaderboard/list | replace only `:cycle`, preserve suffix |
| region, municipality, settlement | replace `:cycle`, preserve the stable geographic id |
| section detail | replace cycle and fall back to the municipality's `/sections` page; section codes are not stable across cycles |
| unrecognized/unsupported suffix | next cycle root |

If a stable geographic entity has no data in an older cycle, its existing empty/not-found state
must offer the cycle root. Do not silently jump to an unrelated place.

Move the reconciliation view to the same explicit contract:

- add canonical `/local/:cycle/sverka`;
- redirect legacy `/sverka` to `/local/${LATEST_LOCAL_CYCLE}/sverka`;
- use the path cycle in `useOfficialsDiff(cycle)`;
- include all five regular cycles, whose `officials_diff.json` artifacts already exist.

### 3.5 Public-money header control

Create a compact `HeaderScopeControl` renderer rather than applying header CSS to the existing
inline `ScopeControl`.

The control should be driven by an explicit semantic model, not inferred from translated label
overrides:

```ts
type HeaderScopeBasis =
  | { kind: "parliament"; selectedElection: string }
  | { kind: "latest-year"; latestYear: number | null }
  | { kind: "all-years" }
  | { kind: "parliament-register"; selectedElection: string };

type HeaderScopeModel = {
  scope: Scope;
  setScope(next: Scope): void;
  support: ScopeSupport;
  basis: HeaderScopeBasis;
  labels: { group: string; all?: string; latest?: string; years?: string };
};
```

The exact shape can be refined during implementation, but `basis` must be explicit. Today
`nsLabelOverride` means three different things (“latest year,” “all years,” and “selected
parliament”), and a header component cannot safely reverse-engineer semantics from copy.

For a standard parliamentary public-money window, one dropdown contains:

- group **Parliament**: the parliamentary dates; selecting one updates `elections` and resets
  `pscope` to `ns` in one URL mutation;
- group **Period**: all years and the supported calendar years.

Suggested active trigger labels:

- `Parliament · 19.04.2026` for `ns`;
- `2024` for `y:2024`;
- `All years` for `all`;
- `Latest · 2025` for a latest-year dataset;
- `All parliaments` for the declarations roll-up.

Use the header's non-modal dropdown primitive (`modal={false}`), not the current Radix Select,
to avoid body scroll lock and fixed-header horizontal shift.

## 4. Architecture

### 4.1 Import-free route context resolver

Add `src/layout/header/headerContextRoutes.ts` with no route-screen or dataset imports:

```ts
export type RouteHeaderContext =
  | { kind: "none" }
  | { kind: "parliamentary"; ownership: "query" | "path" }
  | { kind: "local"; cycle: string; cycleKind: "regular" | "partial" }
  | { kind: "page-scope" };

export function resolveRouteHeaderContext(pathname: string): RouteHeaderContext;
```

Use positive `matchPath` patterns with precedence:

1. full-page `pscope` route families (reserve a slot for the page portal);
2. static `/local/chmi`;
3. `/local/:cycle/**`, classified with `localCycleKind`;
4. path-owned `/elections/:date`;
5. query-owned parliamentary/term families;
6. `none`.

Export and test the resolver directly. Retire the copied negative-default rule in
`src/layout/header/electionsMenu.test.ts`; tests should not parse `Header.tsx` source to prove a
duplicate function stayed in sync.

Keep nav active-state resolution separate. Selector context and highlighted menu answer
different questions.

### 4.2 Stable portal host

Add a small provider around `Header` and `main` in `Layout`:

```tsx
<HeaderContextSlotProvider>
  <Header />
  <main>{children}</main>
</HeaderContextSlotProvider>
```

`Header` renders the host element directly after the logo/divider. A page renders:

```tsx
<HeaderContextPortal owner="procurement">
  <HeaderScopeControl model={model} />
</HeaderContextPortal>
```

Requirements:

- host DOM node is stable for the lifetime of `Layout`;
- portal content remains in the route/page React tree;
- a development invariant reports more than one page owner;
- route change cleanup cannot leave the previous page's control behind;
- `page-scope` routes reserve the compact trigger width while the lazy chunk loads to avoid
  header layout shift;
- all full-page scope controls render above their screen's data/error early returns, so a failed
  request does not remove the way out;
- the portal primitive and route resolver stay tiny enough for the entry chunk.

The page-specific `HeaderScopeControl` implementation must only be imported by lazy route
chunks. `Header.tsx` must not statically import `ScopeControl`, sector configs, agriculture
constants, or data hooks.

### 4.3 Shared scope state, two renderers

Extract the semantic option/label construction currently embedded in `ScopeControl` into a
headless helper or hook. Keep two renderers:

- `ScopeControl`: existing inline segmented control for local-state and mixed-section cases;
- `HeaderScopeControl`: compact non-modal dropdown for page-wide URL scope.

Both must receive the same **resolved** `scope`, `setScope`, and support object that the page's
data query uses. Do not let the header renderer call a second bare `useScope()` when a page has
narrower coverage.

### 4.4 Atomic URL updates

Add one helper for the combined public-money transition. Selecting a parliamentary row from a
scope menu must update `elections` and remove `pscope` in one `setSearchParams` callback and one
history entry. Two sequential setters can issue an intermediate fetch under a mismatched label
and make Back traverse half a logical action.

Preserve the existing public URL contract:

- no new parameter;
- absent `pscope` remains canonical `ns`;
- existing `?elections=` and `?pscope=` links continue to work;
- an all/year view may retain an inactive `elections` value, but the trigger must not imply that
  the date scopes the active year;
- direct URLs with irrelevant parameters may remain valid, but hidden parameters must not
  affect a scope-free page.

For local-cycle navigation, use the path as the only cycle authority. Filter stale context
parameters (`elections`, `pscope`, `cabinet`) from links created by the local selector; retain
only parameters the destination actually owns, such as the global area anchor and documented
local filters.

## 5. Hidden-context audit required before hiding the global election picker

This is a prerequisite, not follow-up polish. A control cannot disappear while its hidden query
value still changes the primary answer.

### 5.1 Local-election dependencies

Current local fallback hooks derive a local cycle “as of” the selected parliamentary election,
and `useChmiHistory*` filters events by that election. After local paths own their cycle:

- explicit `/local/:cycle/**` data hooks take the path cycle explicitly;
- `/local/chmi` shows the full partial-election feed unless it gains its own visible as-of
  control;
- regular-cycle detail pages derive a documented partial-election window from the local cycle
  (after that regular election and before the next regular election; through today for the
  latest), rather than an invisible parliamentary query;
- `/local/:cycle/sverka` passes the cycle explicitly;
- general place/My Area components either use the latest regular cycle explicitly or show an
  inline cycle label/control wherever they intentionally offer an historical as-of view.

Do not change `useLatestLocalCycle` globally without a caller audit; it currently powers place
links, officials comparisons, and cross-election navigation as well as local pages.

### 5.2 Indicators and cabinet views

Indicators currently have a cabinet anchor and also contain election-derived fallback logic.
If the parliamentary picker is hidden there, default indicator dates must come from their own
latest published data/cabinet model, and an explicit cabinet anchor must be the only header
control that re-anchors them. An inherited invisible `?elections` value must not alter their KPI
band.

### 5.3 Election-context census

Build a route/caller audit from all `useElectionContext()` and `useLatestLocalCycle()` call sites.
For each route, classify the dependency as:

- `primary-visible`: keep parliamentary/local context in the header;
- `explicit-path`: path owns it; selector navigates the path;
- `secondary-section`: keep an inline label/control in that section;
- `derived-default`: replace with the route's own latest/default;
- `metadata-only`: no selector.

Commit the resulting registry/test fixture so a new primary caller on a `none` route fails a
reviewable gate rather than silently acquiring hidden global state.

## 6. `pscope` migration ledger

### 6.1 Move to header in v1

| Family | Routes / owners | Model |
| --- | --- | --- |
| Procurement hub and analyses | `/procurement`, `/procurement/overview`, `/procurement/tenders`, `/procurement/appeals`, `/procurement/flags`, `/procurement/by-settlement`, `/procurement/contracts`, `/procurement/ngos`, `/procurement/settlement/:ekatte`, `/procurement/contractors`, `/procurement/awarders`, `/procurement/mps`, `/procurement/sectors` | parliament + all years + calendar years |
| Sector procurement | `/governance/sectors`, ordinary `/sector/:id`, `/water`, `/water/operators`, `/culture/procurement` | parliament + all years + calendar years |
| Dynamic single-year packs | collector-owned `/sector/customs` and `/sector/revenue` pack controls | latest year + fetched supported years; no all mode |
| Administration | `/sector/administration` | latest year + fetched supported years; no all mode |
| Agriculture | `/subsidies`; `/subsidies/{political,cross-programme,untraceable,recipients,schemes,concentration,places,browse}` | latest financial year + sparse supported years + corpus where supported |
| Culture film subsidies | `/culture/subsidies` | all covered years default + supported single years; preserve resolved value |
| Declarations | `/governance/declarations`, `/mp-assets`, `/mp-cars` | selected parliament + all parliaments; no calendar years |
| Person contract browser | `/person/:name/contracts` | parliament + all years + calendar years |

`/subsidies/coverage` remains scope-free because its subject is the corpus coverage itself.
`/procurement/watchlist`, project/dossier/methodology pages, and contract/tender records remain
scope-free unless their primary queries actually consume `pscope`.

### 6.2 Keep inline in v1

| Surface | Reason |
| --- | --- |
| `/defense`, `/judiciary` | Controlled local year state; not URL-backed `pscope`. Moving it is a separate product choice. |
| `/company/:eik/awarders`, `/awarder/:eik/contractors` | Caller-owned local scope state. |
| `/company/:eik`, `/awarder/:eik` | `pscope` governs only procurement sections on mixed identity/money pages. Keep an explicitly labelled section control. |
| Any embedded sector/agriculture pack inside another entity page | Embedded content does not own the page header. |

Delete or document unreachable legacy `ScopeControl` call sites during the census; do not expand
the header plan to migrate dead screens.

### 6.3 Shared component changes

- `ProcurementSectionHeader`: keep breadcrumb responsibility; replace its inline control with a
  header portal for `toggle`, and render nothing for `none`.
- `AgriScopePicker`: add explicit placement/ownership rather than globally changing every use;
  subsidy route screens opt into header, embedded agriculture packs stay inline.
- `PackScopeControl`: expose a header control node/model while preserving the “same resolved
  value drives picker and figures” invariant and rendering above pack error returns.
- `HubHead` call sites: render the portal as a sibling, remove the `scope` slot, then remeasure
  head-height budgets. Do not leave an empty layout wrapper.
- `/mp-assets` and `/mp-cars`: replace bespoke buttons with the shared two-state header model so
  all three declarations surfaces keep one URL contract and one accessible labeling pattern.

## 7. Responsive and interaction design

### 7.1 Width policy

- one-line trigger, approximately 112–180 px depending on viewport and context;
- full localized value in the open menu; truncate only the closed trigger;
- hide external previous/next arrows below `xl`;
- when an area anchor is active, prefer compact trigger copy before truncating the place name;
- never hide the only active page context behind the hamburger;
- allow the existing measured header to wrap only at the already-supported extreme width, not
  at ordinary 320/390 px mobile widths.

Reserve the expected trigger width for lazy `page-scope` routes so hydration does not shift
search/navigation. The empty global-home state reserves no visible gap.

### 7.2 Keyboard and screen-reader behavior

- the physical portal host sits after the logo, so focus order matches visual order;
- every trigger exposes dimension **and current value** in its accessible name;
- same function has the same name across pages (“Data period,” “Local election cycle,” etc.);
- selected menu item uses checked/selected semantics, not color alone;
- minimum target is 24×24 CSS px; retain the current 32 px-class controls where space permits;
- `Escape` closes and returns focus to the trigger;
- route navigation occurs only after explicit selection;
- non-interactive partial/corpus badges are not focusable buttons.

The portal must be tested for focus order because React events follow the React tree while DOM
and keyboard placement follow the portal host.

## 8. Implementation phases

### Phase 0 — freeze the behavior contract

1. Add the route-context resolver and a table-driven test covering every route family and all
   precedence collisions (`/local/chmi` before `/local/:cycle`, static procurement exceptions,
   path-owned elections).
2. Add the election-context caller census described in §5.3.
3. Replace `tests/ui.spec.ts`'s “date exists somewhere on home” assertion with a real global-home
   contract: the home renders and the contextual selector is absent.
4. Record desktop/mobile screenshots and header height/width baselines on `/`, `/parliamentary`,
   `/local/2023_10_29_mi`, `/procurement`, `/subsidies`, and `/governance/declarations`.

Exit: classification is reviewable before any control moves.

### Phase 1 — header slot and parliamentary control

1. Add portal provider/host to `Layout` and render the host after the logo.
2. Split `ElectionsSelect` into parliamentary rows/control and reusable row helpers; remove local
   rows from it.
3. Make query-owned vs path-owned transitions explicit.
4. Render parliamentary control only for positively classified routes; render none on `/`.
5. Keep nav active-state logic behaviorally separate and update its tests to import real helpers.
6. Run entry-graph and bundle gates; verify no route registry/data module leaked into the shell.

Exit: the screenshot's home header no longer displays `19/04/2026`; parliamentary pages retain
all cycle switching behavior, and `/elections/:date` actually changes path.

### Phase 2 — local cycles and hidden local dependencies

1. Add `LocalCycleSelect` and `localCycleHref` with the path-preservation rules in §3.4.
2. Add `/local/:cycle/sverka`; redirect legacy `/sverka` to latest; update menu, breadcrumbs,
   prerender/sitemap/English mirrors as required by repository route contracts.
3. Refactor explicit local pages and CHMI hooks away from hidden parliamentary selection per
   §5.1.
4. Render read-only partial context on partial routes and `/local/chmi`; never add partials to the
   regular menu.
5. Test all five regular cycles and representative stable/unstable deep paths.

Exit: every regular local page displays its own cycle, switching cycles is path-based, and no
hidden parliamentary query changes local content.

### Phase 3 — page-wide `pscope` migration

1. Extract the explicit scope model and implement compact `HeaderScopeControl`.
2. Add the atomic parliament+scope URL action.
3. Migrate shared procurement header call sites first.
4. Migrate ordinary sector/water/culture procurement pages.
5. Migrate dynamic-year administration/collector packs, keeping page-derived support.
6. Migrate agriculture and culture subsidies, including unsupported/no-data behavior.
7. Migrate declarations hub, MP assets, and MP cars to the two-state parliament model.
8. Migrate the full-page person contracts browser.
9. Leave §6.2 exceptions inline and label them narrowly.
10. Remove empty `HubHead.scope` layouts and update stale comments saying the selector lives in
    the dashboard head.

Exit: exactly one page-wide data-period control is in the header, with the same resolved value as
the data below it, on every ledgered route.

### Phase 4 — responsive, accessibility, and rollout

1. Tune width priorities with area/cabinet anchors present.
2. Complete keyboard, focus, target-size, light/dark, BG/EN, and 200% zoom checks.
3. Remeasure `HUB_HEAD_BUDGETS`: moving a control out of `HubHead` legitimately shortens several
   heads, so update measured values and explanatory comments rather than only widening ceilings.
4. Run route smoke, entry graph, build budgets, prerender, sitemap, and OG coverage.
5. Ship behind a temporary `contextualHeaderControls` flag only if visual QA cannot cover all
   families in one release; otherwise the route resolver itself is the rollback boundary.

Exit: no overlap or unexpected wrap at supported widths, no duplicate controls, no hidden
context dependencies, and no entry-chunk regression.

## 9. Test plan

### 9.1 Unit tests

- `resolveRouteHeaderContext`: representative and boundary path for every family; unknown route
  → `none`.
- `localCycleHref`: root, cycle view, region, municipality, settlement, section fallback,
  partial, malformed path.
- local menu: exactly the five regular catalogue entries; no `_chmi`/`_chmi_nov`.
- scope option model: `ns`, `all`, supported/unsupported years, sparse years, no-all mode,
  declarations' empty year list.
- atomic URL action: one mutation preserves unrelated filters and creates one logical history
  transition.
- path-owned election action: changes `/elections/:date`, not only the query.

### 9.2 Component tests

- `/` header has no contextual trigger.
- parliamentary, local, and page-scope routes each show one correctly named trigger.
- switching between routes removes the previous portal content.
- a page error/loading state still exposes its scope control when options are known.
- a dynamic-year model updates options without remounting the header host.
- selecting a parliament from standard `pscope` sets both effective values atomically.
- declarations never offer calendar years.
- local partial routes never show the regular cycle as selected.
- mixed entity pages retain their section control and do not portal it.

### 9.3 Browser tests

Test BG and EN at 320, 390, 768, 1024, and 1280 px:

- no horizontal overflow, collision, or unexpected two-line header;
- header height CSS variable follows any genuine wrap;
- visual and tab order are logo → context → cabinet/area → search/navigation;
- menu remains usable at 200% zoom;
- fixed header does not shift when dropdown opens;
- Back/Forward restores cycle/scope in one step;
- direct shared URLs render a trigger matching the data window;
- navigation sequence `/` → parliamentary → local → procurement → `/` leaves no stale control;
- local switch preserves stable geographic context and drops unstable section context;
- root smoke assertion no longer passes merely because an election tile contains a date.

### 9.4 Existing gates to run/update

```bash
npx vitest run src/layout/header src/data/scope src/data/local
npx vitest run src/entryGraph.test.ts src/screens/components/scopeContract.test.ts
npm test
npm run build
```

Locate the current scope-contract test before implementation; comments reference
`src/screens/components/scopeContract.test.ts`, but the working tree census must verify the file
and restore/add the gate if it is absent. Run the relevant Playwright route/header subset and the
full suite before release.

## 10. Performance, prerender, and SEO constraints

- the header may import the small route resolver and parliamentary/local control data already in
  the shell, but no scope page's data hook or registry;
- `src/entryGraph.test.ts` remains green and gains a direct assertion that the header cannot reach
  sector/agriculture scope modules;
- page-scope controls arrive with their lazy page chunks; the stable host reserves geometry;
- portal content is interaction chrome and does not need to enter prerendered article bodies;
- adding `/local/:cycle/sverka` requires the same route, sitemap, prerender, and English-prefix
  treatment as other local-cycle pages or an explicit noindex decision;
- removing a selector from `/` does not change its canonical/metadata, but OG/browser screenshots
  must be recaptured if the header is visible in them.

## 11. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Hidden `elections` still changes a page whose selector disappeared | Phase 0 caller census and §5 prerequisite fixes. |
| Header duplicates a page control during lazy transitions | Stable single portal host, owner invariant, positive `page-scope` classification, route-change test. |
| Header scope label and figures disagree | Page supplies the same resolved value/support to both query and renderer; never re-read bare `useScope()`. |
| Entry bundle absorbs sector/data modules | Portal keeps ownership in lazy page; import-free resolver; entry-graph gate. |
| Local switch produces a dead deep link | Tested suffix policy; preserve stable ids only; section fallback; cycle-root recovery. |
| Partial local elections get mixed into regular cycles | `localCycleKind` precedence and catalogue-only options; read-only partial context. |
| Two URL setters create intermediate fetch/history entries | One functional `setSearchParams` action. |
| Header becomes too wide with area/cabinet anchors | Single compact trigger, wide-only arrows, measured responsive matrix. |
| Portal harms focus order | Host is physically in header order; keyboard/browser tests; non-modal dropdown. |
| Moving control shortens hub heads and breaks visual budgets | Remeasure and update declared baselines/comments. |

## 12. Acceptance criteria

- `/` and every scope-free route show no election/time selector.
- Every route whose primary content changes by parliamentary election has a visible, working
  parliamentary control; path-owned dated routes navigate their path.
- Every regular local-election route shows the matching regular cycle and can switch cycles.
- Partials never appear in the regular-cycle menu.
- Every full-page URL-backed `pscope` route in §6.1 shows one header period control and no inline
  duplicate.
- The header control and page query use the same resolved scope and supported-year set.
- Controlled local selectors and mixed-section controls remain inline and accurately labelled.
- No hidden `elections` value affects local, indicator, or other scope-free primary content.
- BG/EN, keyboard, dark/light, zoom, mobile, route history, entry graph, build, prerender, and
  route smoke gates pass.

## 13. Explicitly out of scope

- a full React Router data-router migration;
- changing the public `elections`/`pscope` parameter names or encoding;
- adding partial elections to the regular local-cycle selector;
- moving all page-local year filters to global URL state;
- redesigning the four top navigation menus;
- making mixed entity profiles wholly time-scoped when only their procurement section is.
