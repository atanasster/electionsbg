# Context-sensitive header selectors — implementation plan v1

Status: proposed — revised 2026-09-01 after a working-tree audit

Date: 2026-09-01

Scope: header context, parliamentary elections, local-election cycles, and URL-backed `pscope`

## 0. What the audit changed

Every claim below was checked against the working tree. The ledger in §6.1 survived intact —
all 18 routes exist, all five `officials_diff.json` artifacts exist, and the
`nsLabelOverride`-means-three-things diagnosis in §3.5 is correct. Seven things did not, and
they are folded in place rather than listed as errata, because a plan is read forwards:

- **`HubHead.scope` is not a `pscope` slot** (§6.3). Two of its call sites carry a different
  dimension entirely, so "remove the slot" would break them.
- **A second renderer blinds the repo's one scope gate** (§4.3). `scopeContract.test.ts`
  matches the literal `<ScopeControl` opening tag; `<HeaderScopeControl` matches nothing. The
  plan now takes a `variant` prop on one component instead.
- **There are no partial local cycles** (§3.2, §3.4). The catalogue holds five entries, all
  `regular`. The partial-route work is re-labelled forward-looking.
- **`setSelected` writes with `replace: true`** (§4.4), so today it creates no history entry at
  all. The atomic action is a behaviour change, not a preserved invariant.
- **Retiring `/sverka` is an SEO change, not a route change** (§3.4, §10). It is prerendered,
  carries an og image, and sits in both sitemap lists.
- **The portal's two-pass mount meets a CLS gate** (§4.2, §7.1) that has no `pscope` route in it.
- **The census (§5.3) has to be a committed file with a test**, or "classification is
  reviewable" is not checkable.

Two smaller corrections — the `useChmiHistory` cutoff is narrower than §5.1 assumed, and
`scopeMode="corpus"` has no call sites — are noted where they land.

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

⚠️ **That last symptom has a cause the header cannot see, and fixing the header without it
leaves two answers to one question.** `useElectionContext` decides query-vs-path ownership by
sniffing `useParams<{ date?: string }>()` — an untyped param-NAME match, not a route match.
`/votes/:date` uses the same param name and escapes only because its ISO values
(`2025-06-19`) never collide with an election folder (`2026_04_19`). The moment
`resolveRouteHeaderContext` (§4.1) becomes the source of `ownership`, that sniff has to go or
be narrowed to the `/elections/:date` family explicitly. See §4.1.

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

**The negative default has already drifted, and its gate did not notice — which is the
argument, not an analogy.** `electionsMenu.test.ts` holds a hand-copied duplicate of the rule
whose `GOVERNANCE` array is four entries; `Header.tsx` has about twenty-five and does **not**
include `/my-area`. So `/my-area` — a live route — is tinted „Избори" in production while the
test asserts it is not, because the test exercises the copy. The file's own non-vacuity check
(„the copied rule still matches Header.tsx") asserts only the expression SHAPE
(`location.pathname !== "/"`, `!inGovernance`, …) and never the prefix lists, so the copy rotted
with nothing red.

Retiring that copy is therefore not tidying: it is how the drift becomes visible. Expect Phase 1
to surface at least the `/my-area` tint and budget the fix. Whatever replaces it must be an
imported rule, not a re-copied one — and it must stay import-free, since `src/entryGraph.test.ts`
gates what `Header.tsx` can reach.

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
| `/local/:partialCycle/**` | — | **No such route exists today. Forward-looking only — see the note below.** |
| Full-page URL-backed `pscope` view | data-period control | Page portal owns exact options and overrides any generic route control. |
| Local `useState` year picker (`/defense`, `/judiciary`) | none in v1; keep inline | These are not `pscope` and should not gain global URL semantics accidentally. |
| Mixed company/awarder/person profile where `pscope` affects procurement only | keep inline beside procurement | A header control would falsely imply that identity, declarations, subsidies, and health data are scoped too. |

The route registry should encode the rule “does this control change the primary answer?”, not
“which top navigation menu is active?”. This is why `/votes` can have a parliamentary control
while Governance remains highlighted, and why a fixed election article can have none.

⚠️ **THERE ARE NO PARTIAL CYCLES IN THE CATALOGUE, and an earlier draft of this plan budgeted
several phases of work for them.** `src/data/json/elections.json`'s local sibling holds exactly
**five entries, every one `kind: "regular"`** — 2023, 2019, 2015, 2011, 2007. `/local/chmi` is
fed by `local_chmi_history.json`, a different artifact with no `/local/:cycle` route behind it,
and `routes.tsx` declares no partial-cycle path.

So the `localCycleKind` discriminator, the read-only partial context, and the "partials get
mixed into the regular menu" risk are all **insurance against a shape that does not exist**.
Keep the discriminator — the catalogue already declares `kind`, so reading it costs one filter
and makes the menu's promise structural rather than incidental — and **cut the partial-route
branch from Phase 2, its two §9.1/§9.2 tests, and its §11 risk row**. Restore them in the same
commit that first ingests a partial cycle.

The distinction matters because the two failure modes are opposite: a menu that would admit a
partial is a bug the day one lands, while a route branch for a path nobody can reach is untested
code that will have rotted by then.

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

Recommended path-switch behavior. **The suffix set is 24 routes, not four kinds** — enumerate
them in `localCycleHref`'s table rather than leaning on the catch-all row, which was doing most
of the work in the first draft:

| Current local path kind | Routes | Next-cycle destination |
| --- | --- | --- |
| cycle overview | `/local/:cycle` | replace `:cycle` |
| cycle-level leaderboard/list | `regions`, `mayors-by-party`, `council-votes`, `strongest-mandates`, `closest-races`, `swing`, `municipalities`, `runoffs`, `split-control`, `independents` | replace only `:cycle`, preserve suffix |
| region | `region/:oblast` and its five sub-pages (`mayors-by-party`, `council-seats`, `municipalities`, `runoffs`, `split-control`) | replace `:cycle`, preserve `:oblast` + suffix |
| settlement | `settlement/:ekatte` | replace `:cycle`, preserve `:ekatte` |
| municipality | `:obshtinaCode`, `:obshtinaCode/mayor`, `:obshtinaCode/council`, `:obshtinaCode/sections` | replace `:cycle`, preserve `:obshtinaCode` |
| section detail | `:obshtinaCode/section/:sectionCode` | replace cycle and fall back to the municipality's `/sections` page; section codes are not stable across cycles |
| unrecognized/unsupported suffix | — | next cycle root |

⚠️ **THE CYCLES DO NOT COVER THE SAME SURFACE, so "preserve the stable geographic id" mints dead
links unless the helper knows the coverage.** Measured over `data/<cycle>/`:

| cycle | municipality shards | `sections/` | `problem_sections.json` |
| --- | --- | --- | --- |
| `2023_10_29_mi` | 289 | ✅ | ✅ |
| `2019_10_27_mi` | 289 | ✅ | ✅ |
| `2015_10_25_mi` | 289 | ✅ | ✅ |
| `2011_10_23_mi` | **262** | ✅ | ✅ |
| `2007_10_28_mi` | 288 | **absent** | **absent** |

So switching to 2011 from 27 municipalities, and to 2007 from **any** `/sections` or
`/section/:code` path, lands on a page with nothing behind it. Ship a **capability matrix**
(cycle → which suffix families it can serve, derived from the tree, not hand-typed) and have
`localCycleHref` degrade to the nearest servable ancestor **before** navigating. The
destination's empty state is the fallback, not the design: „preserve the id and let the page
apologise" is how a cycle switch becomes a dead end the reader has to back out of.

#### Retiring `/sverka`

Move the reconciliation view to the same explicit contract:

- add canonical `/local/:cycle/sverka`;
- redirect legacy `/sverka` to `/local/${LATEST_LOCAL_CYCLE}/sverka`;
- use the path cycle in `useOfficialsDiff(cycle)`;
- include all five regular cycles, whose `officials_diff.json` artifacts already exist
  (verified — all five are on disk).

⚠️ **This is an SEO change wearing a route change's clothes, and the redirect is the smallest
part of it.** `/sverka` today is prerendered (`scripts/prerender/routes.ts`, with
`ogImage: "/og/sverka.png"`), has a body builder (`scripts/prerender/bodyBuilders.ts`), and
appears **twice** in `scripts/sitemap/route_defs.ts`. Consequences, none of which the first
draft carried:

- **A client-side `<Navigate>` is not a redirect.** `dist/sverka/index.html` keeps serving at
  **200** with its own canonical, so a crawler never sees the move. The repo's mechanism is a
  `firebase.json` `redirects` entry with `type: 301` — and **every entry needs an `/en` twin**,
  which is how every other 301 in that file is written.
- **The legacy entries must be REMOVED, not left beside the new ones.** A sitemap `<loc>` that
  301s is exactly what `tests/seo.spec.ts` gates against, and `scripts/sitemap/families.data.test.ts`
  additionally requires a real `dist/<path>/index.html` behind every `<loc>` — so the new family
  has to be prerendered in the same change, not after it.
- **The new family is 5 pages × 2 languages**, each needing a prerender route, a `<loc>` in
  **both** `route_defs.ts` lists, and — per the repository's hub rules — its own og:image rather
  than the site-wide default.

If that cost is not wanted in this feature, the honest alternative is to keep `/sverka` as the
canonical URL and give it an inline cycle picker, and say so here. What must not happen is a
half-move that leaves a prerendered page and two `<loc>`s pointing at a URL the SPA redirects
away from.

### 3.5 Public-money header control

Add a compact **header variant of `ScopeControl`** — `<ScopeControl variant="header">` — rather
than a second component and rather than applying header CSS to the inline one.

⚠️ **A SECOND COMPONENT BLINDS THE REPO'S ONE SCOPE GATE.**
`src/screens/components/scopeContract.test.ts` is a static-analysis gate over the SOURCE of every
call site: it globs `src/**/*.tsx` and walks each `<ScopeControl` opening tag by
`src.indexOf("<ScopeControl")`. `<HeaderScopeControl` does not contain that substring. So the
moment a page in §6.1 migrates, it stops being a call site the gate can see — and what the gate
holds is precisely the invariant this whole section is about: that a narrowed picker
(`years=` / `allowAll={false}`) may not read the scope unresolved. Every migrated page would
leave the contract silently, at a 200, with nothing red. That is the failure this repository
names as a gate going half-blind, and it is worse than the defect it would be hiding.

The stated reason for two renderers was CSS. A `variant` prop solves CSS. One component keeps
one gate, one call-site census, one accessible-name pattern, and one resolution contract.

If two components are chosen anyway, **widening `scopeContract.test.ts` to match both tags is
part of the same commit as the new renderer** — not a Phase 4 tidy-up. The gate is only worth
anything while it is the thing that cannot be forgotten.

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
duplicate function stayed in sync. Expect that retirement to surface the `/my-area` tint drift
described in §2.4 — fix it in the same change rather than porting the drift into the new rule.

Keep nav active-state resolution separate. Selector context and highlighted menu answer
different questions.

⚠️ **THE RESOLVER MUST BECOME THE ONLY SOURCE OF `ownership`, WHICH MEANS `ElectionContext` HAS
TO STOP SNIFFING `useParams()`.** Today ownership is decided by an untyped param-NAME match
inside `useElectionContext` — `useParams<{ date?: string }>()` — and `/votes/:date` shares that
name, escaping only because its ISO values never collide with an election folder id. Leaving
that in place while the resolver also answers the question gives two authorities for one fact,
which is the exact duplication this section exists to remove, and it is the ROOT of the
`/elections/:date` symptom §2.1 describes rather than a separate bug.

Two acceptable shapes, and the plan should pick one before Phase 1:

- the resolver returns `ownership`, and `ElectionContext` takes the path date as an explicit
  argument/prop from the one route family that owns it; or
- `ElectionContext` keeps reading the param but narrows the read to a route match rather than a
  param name, sharing the resolver's own patterns.

Either way `Header` and the page must agree by construction, not by both happening to be right.

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
  <ScopeControl variant="header" model={model} />
</HeaderContextPortal>
```

Requirements:

- host DOM node is stable for the lifetime of `Layout`;
- portal content remains in the route/page React tree;
- a development invariant reports more than one page owner **committed at the same time**;
- route change cleanup cannot leave the previous page's control behind;
- `page-scope` routes reserve the compact trigger width while the lazy chunk loads to avoid
  header layout shift;
- all full-page scope controls render above their screen's data/error early returns, so a failed
  request does not remove the way out;
- the portal primitive and route resolver stay tiny enough for the entry chunk.

The header-variant control must only be imported by lazy route chunks. `Header.tsx` must not
statically import `ScopeControl`, sector configs, agriculture constants, or data hooks.

⚠️ **`Layout` IS MOUNTED PER ROUTE, and the host ref is null on the first render of every
navigation.** Each route's `element` is its own `<LayoutScreen>`, so `Header` (and the host) is
part of the page's element tree rather than a persistent shell above it. A page can therefore
only `createPortal` into the host after an effect has read the ref and a state update has
re-rendered — a guaranteed two-pass mount, on every navigation, after hydration.

That is a post-hydration header mutation, and the header is measured by a `ResizeObserver` into
`--header-height`, which `Layout` uses as the page's `padding-top`. A trigger that appears late
and wraps the header therefore shifts the **whole document**, not just the header — and
`tests/perf.spec.ts` gates CLS below 0.1, including a slow-JSON variant, on routes chosen
precisely for "content injected asynchronously". No `pscope` route is in either list today.

Three requirements follow:

- the reserved width in §7.1 is a **measured constant**, taken from the widest real trigger in
  both languages, not a range;
- the reservation is rendered by the HOST on `page-scope` routes, so it exists on the first
  paint of the navigation rather than when the page's chunk arrives;
- `/procurement` joins `SLOW_CLS_ROUTES` in `tests/perf.spec.ts`, with one 390 px mobile case,
  in the same phase that migrates it.

The "more than one owner" invariant needs the same care about timing. `ProcurementOverviewScreen`
already renders its section header in two mutually exclusive early returns — which is correct,
and is what "render above the data/error early returns" asks for — so a naive owner COUNT will
false-positive across a Suspense or transition boundary where both trees are briefly alive.
Ref-count by owner id and assert on what is committed, not on how many components rendered.

### 4.3 Shared scope state, one component, two presentations

Extract the semantic option/label construction currently embedded in `ScopeControl` into a
headless helper or hook, and keep **one** component with two presentations:

- `variant="inline"` (default): the existing segmented control, for local-state and
  mixed-section cases;
- `variant="header"`: compact non-modal dropdown for page-wide URL scope.

See §3.5 for why this is one component rather than two — `scopeContract.test.ts` matches the
literal `<ScopeControl` tag, and a differently-named renderer leaves that gate seeing nothing.

Both presentations must receive the same **resolved** `scope`, `setScope`, and support object
that the page's data query uses. Do not let the header presentation fall through to
`ScopeControl`'s own bare `useScope()` when a page has narrower coverage — that internal call
resolves against the full corpus band and is the documented source of "the pill read 2022 above
€7,4 млрд for 2025".

### 4.4 Atomic URL updates

Add one helper for the combined public-money transition. Selecting a parliamentary row from a
scope menu must update `elections` and remove `pscope` in one `setSearchParams` callback. Two
sequential setters can issue an intermediate fetch under a mismatched label and make Back
traverse half a logical action.

⚠️ **THE TWO PARAMETERS DISAGREE ABOUT HISTORY TODAY, AND THE PLAN MUST DECIDE RATHER THAN
INHERIT.** `setSelected` goes through `useSearchParam("elections", { replace: true })` — it
creates **no history entry at all** — while `useScope`'s `setScope` writes with
`{ replace: false }` and does. So "one history entry" is not the current behaviour of the
election half, and §9.3's "Back/Forward restores cycle/scope in one step" is a **behaviour
change** for it, not a preserved invariant.

Both policies are defensible: `replace` treats the election as a view preference and keeps the
Back button meaning "the previous page", `push` treats it as a navigation the reader can undo.
What is not defensible is the atomic helper picking one implicitly. State the choice here, apply
it to BOTH parameters, and make §9.1's "one logical history transition" test assert the chosen
policy explicitly — a test that merely counts one entry passes under `replace` and under `push`
for different reasons.

Preserve the existing public URL contract:

- no new parameter;
- absent `pscope` remains canonical `ns`;
- existing `?elections=` and `?pscope=` links continue to work;
- an all/year view may retain an inactive `elections` value, but the trigger must not imply that
  the date scopes the active year;
- direct URLs with irrelevant parameters may remain valid, but hidden parameters must not
  affect a scope-free page.

For local-cycle navigation, use the path as the only cycle authority, and filter stale context
parameters (`elections`, `pscope`) from links the local selector creates.

⚠️ **Name WHICH link builder, because the repository has two policies and they are opposites.**
`usePreserveParams` is an ALLOWLIST — it already strips everything unlisted, `cabinet` included,
so a local link built through `@/ux/Link` needs nothing added. `useScopedHref` forwards the
**whole** query string, by an explicit decision recorded in its own header (carrying a filtered
browser's filters through a drill-down is wanted behaviour there). A local-cycle link must
therefore be built through the allowlist path, or through a third dedicated builder — never
through `useScopedHref`, which would carry `?pscope` and every procurement filter onto a page
that owns neither.

`elections` is the one that actually bites: it IS in the allowlist, so it rides onto
`/local/**` on ordinary in-app links, which is the mechanism behind §5.1.

## 5. Hidden-context audit required before hiding the global election picker

This is a prerequisite, not follow-up polish. A control cannot disappear while its hidden query
value still changes the primary answer.

### 5.1 Local-election dependencies

Current local fallback hooks derive a local cycle “as of” the selected parliamentary election
(`useLatestLocalCycle` → `useLocalAsOf` → `localAsOf`), and `useChmiHistory*` filters events by
that election.

⚠️ **The exposure is narrower than it looks, and the narrowing changes the cheapest fix.**
`useChmiHistory` computes `asOfDate` only when `selected !== elections[0]` — on the default
(latest) election it filters nothing. And the `/local/:cycle/**` detail routes already pass
their cycle explicitly, so the cycle itself is not at risk; what is at risk is the chmi overlay
inside them. The failure mode is therefore precise: **a reader arrives on a local page carrying
a stale `?elections`**, which happens because `elections` is in the `usePreserveParams`
allowlist (§4.4).

That admits a much smaller fix than the list below, and the plan should price both before
committing to the larger one:

- **Narrow (preferred if it holds):** strip `elections` from links into `/local/**` and have
  local routes ignore an inbound one — the chmi overlay then always answers "as of today", which
  is what a reader on a cycle page expects, and no hook signature changes.
- **Broad (the list below):** thread the cycle explicitly through every local hook.

The narrow fix is not free of judgement: it removes a real, if undiscoverable, capability (an
as-of view of a município's re-elections). If that view is worth keeping, it needs its own
visible control on the page, which is the last bullet below. Decide that explicitly — do not let
it survive as an invisible query parameter, which is the state this whole section exists to end.

After local paths own their cycle:

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

**This is the plan's highest-value artifact and it is currently only prose, which makes Phase 0's
exit criterion („classification is reviewable") uncheckable.** Give it a shape now:

```ts
// src/layout/header/headerContextRegistry.ts — import-free, like the resolver.
export const HEADER_CONTEXT_REGISTRY: Record<
  string,                       // the route PATTERN, verbatim from routes.tsx
  {
    context: RouteHeaderContext["kind"];
    dependency:
      | "primary-visible" | "explicit-path" | "secondary-section"
      | "derived-default" | "metadata-only";
    why: string;                // one sentence — why a reader would or would not expect a control
  }
> = { /* … */ };
```

and give it two gates, because each catches a different rot:

1. **Exhaustiveness.** Every `path=` in `src/routes.tsx` has an entry. A new route cannot land
   without someone answering the question; the answer may be `metadata-only`, but it has to be
   written down. Without this, "unknown defaults to `none`" (§4.1) is a silent default rather
   than a decision.
2. **Agreement.** For every pattern, `resolveRouteHeaderContext(<a concrete path>)` returns the
   registry's `context`. Otherwise the registry becomes documentation that drifts from the code —
   which is the `electionsMenu.test.ts` failure in §2.4, rebuilt one file over.

The `why` column is not decoration: §3.2's rule is "does this control change the primary
answer?", and that is a judgement the next reader has to be able to re-check.

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

There are **three** placements today, not two, and the ledger touches all of them:
`ProcurementSectionHeader`'s nav row, `HubHead`'s `scope` slot, and freestanding renders inside
a screen (`ProcurementSettlementDetailScreen`, `SectorDashboardScreen`, `PersonContractsScreen`,
`WaterScreen`, `CultureProcurementScreen`, `JudiciaryScreen`). The third class has no shared
wrapper, so each is its own edit — size Phase 3 accordingly.

- `ProcurementSectionHeader`: keep breadcrumb responsibility; replace its inline control with a
  header portal for `toggle`, and render nothing for `none`.
  **`scopeMode="corpus"` has zero call sites** — the mode is documented and unused. Either delete
  it in this change, or decide its placement (§7.2 assumes corpus badges reach the header as
  non-focusable text). Do not leave a third mode undecided in a component the migration rewrites.
- `AgriScopePicker` / `AgriScopeGate`: add explicit placement/ownership rather than globally
  changing every use; subsidy route screens opt into header, embedded agriculture packs stay
  inline. `AgriScopeGate` is also the shared four-state fallback for seven `/subsidies` sub-pages
  and is a declared exception in `scopeContract.test.ts` — moving its picker must not move the
  `noData` card, which is what makes that exception true.
- `PackScopeControl`: expose a header control node/model while preserving the “same resolved
  value drives picker and figures” invariant and rendering above pack error returns.
  Its `nsLabelOverride` is a **hardcoded bilingual literal** (`bg ? "Последна година" : "Latest
  year"`), not a `t()` key. The §3.5 `labels` model is the moment to key it; leaving a literal in
  a control that now renders in the shared header is how one page's wording becomes the site's.
- `HubHead` call sites: render the portal as a sibling and remeasure head-height budgets. Do not
  leave an empty layout wrapper.

  ⚠️ **DO NOT REMOVE THE `scope` PROP — it is not a `pscope` slot.** Of its call sites, two carry
  a completely different dimension: `/companies` puts its `?scope=` browse toggle there (a raw
  `Select`, with a comment explaining why it is not a facet), and `/persons` puts its `sector`
  state Select there. Neither is in §6.1, neither is URL-backed `pscope`, and „remove the slot"
  would delete both. The prop stays; only the ledgered call sites stop passing a `ScopeControl`
  to it.

  That leaves a product question this plan should answer rather than discover: after the
  migration, `/persons` shows an „Обхват" control in its head while a *different* scope dimension
  lives in the header on neighbouring pages. Either accept it and label both precisely, or move
  those two to the header as their own context kind — but not by accident.
- `/mp-assets` and `/mp-cars`: replace bespoke buttons with the shared two-state header model so
  all three declarations surfaces keep one URL contract and one accessible labeling pattern.
  `useMpAssetsScope` already returns the resolved `pscope` for exactly this reason — the header
  presentation must consume it, not re-read the param.

## 7. Responsive and interaction design

### 7.1 Width policy

- one-line trigger at a **measured** width, not a guessed range. Take it from the widest real
  trigger in BOTH languages across all four states (parliamentary date, `Parliament · date`,
  „Всички години", the longest `nsLabelOverride`) and pin it as a constant the host and the
  control share. The existing election trigger is `w-[125px] md:w-[150px]`, dropping to
  `w-[110px]` when an area anchor is present — start from those and re-measure, since the header
  variant carries more copy than a bare date;
- full localized value in the open menu; truncate only the closed trigger;
- hide external previous/next arrows below `xl`;
- when an area anchor is active, prefer compact trigger copy before truncating the place name;
- never hide the only active page context behind the hamburger;
- allow the existing measured header to wrap only at the already-supported extreme width, not
  at ordinary 320/390 px mobile widths.

Reserve that width **from the host**, on `page-scope` routes, so it exists on the navigation's
first paint rather than when the page chunk resolves — see §4.2 for why the portal is always a
two-pass mount and why an unreserved slot shifts the whole document rather than only the header.
The empty global-home state reserves no visible gap.

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
2. Add the election-context caller census described in §5.3 — as the committed
   `headerContextRegistry.ts` with both gates, not as prose. This is the phase's actual
   deliverable; everything else here is measurement.
2b. Decide, and record here, the two things §4 leaves open: the history policy for the atomic
   URL action (§4.4) and where `ownership` is decided now that two authorities answer it (§4.1).
   Both are cheap to write down now and expensive to retrofit in Phase 3.
3. Replace `tests/ui.spec.ts`'s “date exists somewhere on home” assertion with a real global-home
   contract: the home renders and the contextual selector is absent.
4. Record desktop/mobile screenshots and header height/width baselines on `/`, `/parliamentary`,
   `/local/2023_10_29_mi`, `/procurement`, `/subsidies`, and `/governance/declarations`. Capture
   the widest real trigger per language for §7.1's measured constant while here.
5. Derive the local-cycle **capability matrix** in §3.4 from `data/<cycle>/` rather than hand-typing
   it, and commit it with the fixture — 2011 and 2007 do not cover what 2023 does, and
   `localCycleHref` needs that before Phase 2, not after.
6. Record the entry chunk's current byte size, so §10's claim can be checked rather than asserted.

Exit: classification is reviewable, and the two open decisions are made, before any control moves.

### Phase 1 — header slot and parliamentary control

1. Add portal provider/host to `Layout` and render the host after the logo.
2. Split `ElectionsSelect` into parliamentary rows/control and reusable row helpers; remove local
   rows from it.
3. Make query-owned vs path-owned transitions explicit.
4. Render parliamentary control only for positively classified routes; render none on `/`.
5. Keep nav active-state logic behaviorally separate and update its tests to import real helpers.
   Fix the `/my-area` tint the retirement surfaces (§2.4) in this step.
6. Prune the i18n keys the split orphans (`select_election_year`, `prior_elections`,
   `next_elections`, `local_elections_badge` are the candidates) — `scripts/i18n/key_usage.test.ts`
   fails on a corpus that outlives its call sites, so this is a gate, not tidying.
7. Run entry-graph and bundle gates; verify no route registry/data module leaked into the shell,
   **and record the entry-chunk delta against the Phase 0 baseline** (§10).

Exit: the screenshot's home header no longer displays `19/04/2026`; parliamentary pages retain
all cycle switching behavior, `/elections/:date` actually changes path, and the entry chunk did
not grow.

### Phase 2 — local cycles and hidden local dependencies

1. Add `LocalCycleSelect` and `localCycleHref` with the path-preservation rules and the
   capability matrix in §3.4. The matrix is a prerequisite of the helper, not a refinement.
2. Add `/local/:cycle/sverka` and retire `/sverka` per §3.4: a `firebase.json` 301 **with its
   `/en` twin**, five new prerender routes ×2 languages with their own og images, ten new `<loc>`s
   in **both** `route_defs.ts` lists, and **removal** of the legacy prerender route, body builder
   and two `<loc>`s. Run `tests/seo.spec.ts` and `scripts/sitemap/families.data.test.ts` — the
   second needs a built `dist/`.
   If that cost is not wanted now, take the documented alternative in §3.4 (keep `/sverka`
   canonical, give it an inline cycle picker) and say so — but do not ship the half-move.
3. Refactor local pages and CHMI hooks away from hidden parliamentary selection per §5.1, taking
   the narrow or the broad fix as decided there.
4. Render read-only context on `/local/chmi`. **Skip the partial-route branch** — no such route
   exists (§3.2); restore it with the first partial cycle ingested.
5. Test all five regular cycles and representative stable/unstable deep paths, including the
   2011 (262-shard) and 2007 (no `sections/`) degradations by name.

Exit: every regular local page displays its own cycle, switching cycles is path-based, and no
hidden parliamentary query changes local content.

### Phase 3 — page-wide `pscope` migration

**Split by OWNERSHIP MODEL, not by section.** The first draft was ten steps over ~30 routes in
one phase — a phase that cannot land incrementally, because a half-migrated section shows two
controls. Each model below has its own `basis`, its own option set and its own failure mode, so
each is a shippable unit with its own gate.

**3.0 — foundations (blocks everything else)**

1. Extract the explicit scope model (§3.5) and implement `variant="header"` on `ScopeControl`.
   If two components were chosen instead, widen `scopeContract.test.ts` in this same step (§3.5).
2. Add the atomic parliament+scope URL action under the history policy decided in Phase 0 (§4.4).
3. Add `/procurement` to `SLOW_CLS_ROUTES` in `tests/perf.spec.ts` **before** migrating it, so the
   gate is in place when the portal first mounts there (§4.2).

**3a — parliament + all years + calendar years** (the standard model, and the largest group)
Shared procurement call sites first (`ProcurementSectionHeader`, then the `HubHead` and
freestanding renders), then ordinary sector / water / culture procurement pages, then the
full-page person contracts browser. Failure mode: the trigger implies a date scopes an
active year view.

**3b — latest year + fetched years, no all-mode** (`/sector/administration`, the collector packs)
Support is page-derived and arrives asynchronously, so the control must render above the pack's
early returns and must not remount the host when options land. Key `PackScopeControl`'s
hardcoded label (§6.3). Failure mode: a pill painted from a year list the page cannot serve.

**3c — two-state parliament model** (`/governance/declarations`, `/mp-assets`, `/mp-cars`)
No calendar years at all. Consume `useMpAssetsScope`'s resolved `pscope`; do not re-read the
param. Failure mode: the hub tile and the page it opens count different slices.

**3d — sparse years with a named gap** (`/subsidies` family, `/culture/subsidies`)
These deliberately keep an unsupported year and NAME it rather than resolving it, which is a
declared exception in `scopeContract.test.ts`. Moving the picker must not move the `noData` card
(§6.3). Failure mode: the exception silently becomes false.

**3e — close out**

1. Leave §6.2 exceptions inline and label them narrowly.
2. Stop passing `ScopeControl` to `HubHead.scope` at ledgered call sites only; **the prop and its
   two non-`pscope` users stay** (§6.3). Update stale comments saying the selector lives in the
   dashboard head.

Exit: exactly one page-wide data-period control is in the header, with the same resolved value as
the data below it, on every ledgered route; `scopeContract.test.ts` still sees every call site;
CLS gates green on the migrated routes.

### Phase 4 — responsive, accessibility, and rollout

1. Tune width priorities with area/cabinet anchors present.
2. Complete keyboard, focus, target-size, light/dark, BG/EN, and 200% zoom checks.
3. Remeasure `HUB_HEAD_BUDGETS`: moving a control out of `HubHead` legitimately shortens several
   heads, so update measured values and explanatory comments rather than only widening ceilings.
4. Run route smoke, entry graph, build budgets, prerender, sitemap, and OG coverage.
5. Ship behind a temporary `contextualHeaderControls` flag only if visual QA cannot cover all
   families in one release.

⚠️ **The route resolver is NOT a rollback boundary once Phase 3 has run.** It can turn the header
control off, but the inline controls it replaced are gone by then, so flipping it leaves migrated
pages with **no** time control at all — strictly worse than either end state. There are two honest
options and the plan must pick one:

- **Reversible:** keep each page's inline control behind the flag through one release, so the flag
  chooses a placement rather than a presence. Costs a release of duplicated markup (and a
  temporary `scopeContract.test.ts` exception, since both would be call sites).
- **One-way:** state plainly that Phase 3 is not revertible per-page and that the rollback is
  `git revert` of the phase. Acceptable, but only if it is written down before the release rather
  than discovered during one.

Phases 1 and 2 are separately revertible either way; it is only 3 that has this property.

Exit: no overlap or unexpected wrap at supported widths, no duplicate controls, no hidden
context dependencies, and no entry-chunk regression.

## 9. Test plan

### 9.1 Unit tests

- `resolveRouteHeaderContext`: representative and boundary path for every family; unknown route
  → `none`.
- `localCycleHref`: root, all ten cycle-level leaderboards, region + its five sub-pages,
  municipality, settlement, section fallback, malformed path — plus the two coverage
  degradations by name (a 2011-missing municipality, any `/sections` path into 2007).
- the local capability matrix: derived from `data/<cycle>/`, not hand-typed, and non-vacuous
  (2007 must report `sections: false`, or the matrix is checking nothing).
- local menu: exactly the five regular catalogue entries.
- scope option model: `ns`, `all`, supported/unsupported years, sparse years, no-all mode,
  declarations' empty year list.
- atomic URL action: one mutation, preserving unrelated filters, under the history policy
  decided in Phase 0 — assert `replace` vs `push` explicitly, since a bare "one entry" count
  passes under both for different reasons (§4.4).
- path-owned election action: changes `/elections/:date`, not only the query.
- `headerContextRegistry`: exhaustive over `routes.tsx`, and agreeing with the resolver (§5.3).
- link builders: a local-cycle href carries no `pscope`/`elections`/procurement filters (§4.4).

### 9.2 Component tests

- `/` header has no contextual trigger.
- parliamentary, local, and page-scope routes each show one correctly named trigger.
- switching between routes removes the previous portal content.
- a page error/loading state still exposes its scope control when options are known.
- a dynamic-year model updates options without remounting the header host.
- selecting a parliament from standard `pscope` sets both effective values atomically.
- declarations never offer calendar years.
- mixed entity pages retain their section control and do not portal it.
- `/companies` and `/persons` keep their own `HubHead.scope` control after the migration — the
  regression §6.3 exists to prevent, and the one no `pscope` test would catch.
- the owner invariant does not fire across a Suspense/transition boundary where two page trees
  are briefly alive (§4.2).

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
- root smoke assertion no longer passes merely because an election tile contains a date;
- CLS stays under 0.1 on `/procurement` with slow JSON, desktop and 390 px — the portal's
  two-pass mount is exactly the "content injected asynchronously" shape that gate exists for
  (§4.2), and the header feeds `--header-height`, so a late wrap shifts the whole document.

### 9.4 Existing gates to run/update

```bash
npx vitest run src/layout/header src/data/scope src/data/local
npx vitest run src/entryGraph.test.ts src/screens/components/scopeContract.test.ts
npx vitest run scripts/i18n/key_usage.test.ts scripts/i18n/bundle_reachability.test.ts
npm test
npm run build
```

`src/screens/components/scopeContract.test.ts` **exists** — an earlier draft hedged about it.
What it needs is not restoring but protecting: it matches the literal `<ScopeControl` opening tag
over `src/**/*.tsx`, so §3.5's one-component decision is what keeps it seeing the migrated pages.

Two more gates are in scope and were missing:

- `scripts/i18n/key_usage.test.ts` — Phase 1 orphans header keys, and this fails on a corpus that
  outlives its call sites.
- `scripts/i18n/bundle_reachability.test.ts` — the header slot is reachable from every route, so
  any string the HOST renders must stay in the core corpus. Strings rendered by the portalled
  control may legitimately be bundle-scoped, since that component ships with the page chunk; do
  not "fix" that by hoisting them to core.

Add, per §3.4, a built-`dist/` run of `tests/seo.spec.ts` and
`scripts/sitemap/families.data.test.ts` in Phase 2. Run the relevant Playwright route/header
subset and the full suite before release.

## 10. Performance, prerender, and SEO constraints

- the header may import the small route resolver and parliamentary/local control data already in
  the shell, but no scope page's data hook or registry;
- **claim the entry-chunk win rather than only defending against a loss.** As written the change
  is net ADDITION to the shell (resolver + `matchPath` + provider). But `ElectionsSelect` today
  drags `useCanonicalParties`, `totalAllVotes`, `Hint` and `useTouch` into the entry chunk for all
  ~400 routes, to render a control the plan makes conditional. Once the resolver gates it, both
  the parliamentary and local controls can be `lazy()` behind it, leaving only the resolver and
  the host eager. Record the measured delta against Phase 0's baseline and put it in §12 —
  otherwise "no entry-chunk regression" is satisfied by breaking even on a change that should
  have paid;
- `src/entryGraph.test.ts` remains green and gains a direct assertion that the header cannot reach
  sector/agriculture scope modules;
- page-scope controls arrive with their lazy page chunks; the stable host reserves geometry;
- portal content is interaction chrome and does not need to enter prerendered article bodies;
- adding `/local/:cycle/sverka` is an SEO change, not a route change — see §3.4 for the full
  cost (a `firebase.json` 301 with its `/en` twin, 5 pages × 2 languages prerendered with og
  images, ten `<loc>`s across both `route_defs.ts` lists, and REMOVAL of the legacy prerender
  route, body builder and two `<loc>`s). A sitemap `<loc>` that 301s fails `tests/seo.spec.ts`,
  and every `<loc>` needs a real `dist/<path>/index.html` per `scripts/sitemap/families.data.test.ts`;
- removing a selector from `/` does not change its canonical/metadata, but OG/browser screenshots
  must be recaptured if the header is visible in them.

## 11. Risks and mitigations

**Every risk here fails at a 200 — a wrong window under a confident label, not an error.** That
is this repository's dominant defect class, so each row carries how it would be NOTICED. A row
whose only answer is „visual QA" is not mitigated; it is deferred.

| Risk | Mitigation | How we notice |
| --- | --- | --- |
| Hidden `elections` still changes a page whose selector disappeared | Phase 0 caller census (§5.3) and §5 prerequisite fixes. | Registry exhaustiveness gate: a primary caller on a `none` route has no entry. |
| Header duplicates a page control during lazy transitions | Stable single host, committed-owner invariant, positive `page-scope` classification. | Dev invariant + route-change component test (§9.2). |
| Header scope label and figures disagree | Page supplies the same resolved value/support to both query and renderer; never re-read bare `useScope()`. | `scopeContract.test.ts` — **only while it can still see the call sites** (§3.5). |
| A second renderer leaves `scopeContract.test.ts` matching nothing | One component with `variant` (§3.5). | Nothing, if it happens — which is why the decision is the mitigation. |
| Entry bundle absorbs sector/data modules | Portal keeps ownership in lazy page; import-free resolver. | `src/entryGraph.test.ts` + the measured delta in §10. |
| Local switch produces a dead deep link | Derived capability matrix; degrade before navigating (§3.4). | `localCycleHref` unit tests naming the 2011 and 2007 gaps (§9.1). |
| `HubHead.scope` removed from its two non-`pscope` users | Keep the prop; migrate ledgered call sites only (§6.3). | Component test asserting `/companies` and `/persons` keep their control (§9.2). |
| Two URL setters create an intermediate fetch | One functional `setSearchParams` action. | Unit test on the action, asserting the chosen history policy (§9.1). |
| Portal's two-pass mount shifts the document | Host-side measured width reservation (§7.1). | CLS gate on `/procurement`, slow-JSON, desktop + 390 px (§9.3). |
| Header becomes too wide with area/cabinet anchors | Single compact trigger, wide-only arrows, measured responsive matrix. | Browser matrix at five widths × two languages (§9.3). |
| Portal harms focus order | Host is physically in header order; non-modal dropdown. | Keyboard/browser tests (§9.3). |
| Moving control shortens hub heads and breaks visual budgets | Remeasure and update declared baselines/comments. | `HUB_HEAD_BUDGETS` in `tests/ui.spec.ts` — note its `cells` field exists because a ceiling cannot tell „it fits" from „it is gone". |
| Phase 3 is not revertible per-page | Decide reversible-behind-flag vs one-way (Phase 4). | Nothing — this is a decision, and the mitigation is making it in writing beforehand. |

## 12. Acceptance criteria

- `/` and every scope-free route show no election/time selector.
- Every route whose primary content changes by parliamentary election has a visible, working
  parliamentary control; path-owned dated routes navigate their path.
- Every regular local-election route shows the matching regular cycle and can switch cycles, and
  a switch into a cycle that cannot serve the current suffix degrades to a servable ancestor
  rather than a dead page.
- The regular-cycle menu is built from the catalogue's `kind === "regular"` filter, so it cannot
  admit a partial the day one is ingested.
- Every full-page URL-backed `pscope` route in §6.1 shows one header period control and no inline
  duplicate.
- The header control and page query use the same resolved scope and supported-year set, and
  `scopeContract.test.ts` still counts every one of them as a call site.
- Controlled local selectors and mixed-section controls remain inline and accurately labelled;
  `/companies` and `/persons` keep their own `HubHead.scope` control.
- No hidden `elections` value affects local, indicator, or other scope-free primary content.
- `headerContextRegistry` covers every `path=` in `routes.tsx` and agrees with the resolver.
- The entry chunk is **no larger than the Phase 0 baseline**, and the plan records the measured
  delta rather than asserting parity.
- `/sverka` returns a 301 (both languages), carries no sitemap `<loc>`, and its five successors
  each have a prerendered page, a `<loc>` in both lists, and an og:image.
- BG/EN, keyboard, dark/light, zoom, mobile, route history, entry graph, build, prerender,
  sitemap, CLS, i18n key-usage, and route smoke gates pass.

## 13. Explicitly out of scope

- a full React Router data-router migration;
- changing the public `elections`/`pscope` parameter names or encoding;
- adding partial elections to the regular local-cycle selector — and, per §3.2, **any**
  partial-cycle route handling, since no such route or catalogue entry exists yet;
- moving all page-local year filters to global URL state;
- redesigning the four top navigation menus;
- making mixed entity profiles wholly time-scoped when only their procurement section is;
- moving `/companies`' and `/persons`' own scope controls into the header — a separate product
  question raised by §6.3, deliberately not answered here.
