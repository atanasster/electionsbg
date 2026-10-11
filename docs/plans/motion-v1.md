# Motion v1 — movement that means something

Status: **Tier 1 shipped 2026-10-12.** Tier 2 is proposed, not started.

## §0 Why, and the one rule

Anthropic's published motion language is thin but consistent: the Claude „spark" is still
while Claude listens and flutters only while it responds (Kinfolk, *The Artisans of AI*); the
identity „leans into the imperfections of human, handmade things"; the aim is trust, not
spectacle. The Claude Code spinner proves personality needs no animation library — it is
cycling glyphs.

Translated into one rule for this site:

> **MOTION MEANS STATE.** Nothing animates on first paint. Things move when the READER
> changed something (election, `?pscope`, metric, a layer toggle) or when the data itself is
> new. Between those, stillness.

Consequences that every piece below obeys:

- **First paint is the prerendered value, verbatim** — no count-up from zero on load. LCP,
  CLS and the perf budgets in `tests/perf.spec.ts` are untouched by construction.
- **Transform / opacity / SVG paint only.** Nothing animates layout.
- **Reduced motion keeps every state and drops only the travel** — the new colour, the arrow,
  the loop, the spark are all still there; they simply arrive at once.
- **No new dependency.** CSS keyframes + ~250 lines of TS in `src/ux/motion/`.

## §1 Tokens

`src/ux/motion/motionTokens.ts` (JS) and `--motion-*` in `src/index.css` (CSS) carry the same
values, so a keyframe and a JS tween started together finish together:
`fast 120 ms` (hover, focus) · `base 240 ms` (a mark appearing) · `slow 480 ms` (anything the
eye should follow) · one curve, `--motion-ease-out` = `easeOutCubic`.

## §2 Tier 1 — shipped

| piece | where | what moves, and when |
| ----- | ----- | -------------------- |
| **Rolling KPI figures** | `AnimatedText` / `useTweenedText` in `HubHead`'s `KpiCell` | A hub KPI rolls from its old to its new value when the scope changes — **only where the cell stays mounted**, i.e. the new scope's stats are already in memory (`/procurement` reads one blob). A hub that fetches per scope without `placeholderData` (`useAgriHubStats` on `/subsidies`) drops to the skeleton on an uncached scope, and the figure then arrives verbatim. Adding `placeholderData: keepPreviousData` to those hooks is open work. |
| **Region re-fill** | `.motion-fill` via `FeatureMap`'s opt-in `animateFill` | An election-map region (`MapElement`) cross-fades to its new colour on an election switch. Opt-in because a fill transition repaints every path for its duration, and `MapElement` sets it only once a real party colour exists, so a map never fades in from its grey loading placeholder. The other choropleths do not opt in. |
| **Growing shift arrows** | `.motion-grow` in `MapShiftArrow` | Arrows grow out of their centroid when the shift layer is turned on or the comparison changes; the biggest shifts land first. Keyed on `deltaPp`, so a re-render of the same comparison does not replay. |
| **Pen loop on a flipped region** | `handDrawnLoopPath` + `.motion-draw-on` in `MapShiftArrow` | Where the leading party CHANGED, a coral hand-drawn loop is drawn around the arrow — the editorial „circle the thing that matters". Seeded by EKATTE, so each loop is unique and identical on every render. |
| **Freshness spark** | `MotionSpark` + `isFreshlySeen` in `HomeChangeCard` | A row first seen in the last 24 h of the reader's clock carries a coral asterisk that flutters three times and then rests. Never on a backfill. |
| **Reduced-motion budget morph** | `BudgetFlowGraphic` | The existing fiscal-year morph now snaps under `prefers-reduced-motion`. |

### `tweenNumberText` refuses rather than guesses

`HubKpi.value` is an already-formatted string, so the tween reads the figure's own text as its
template. Every ambiguity is a **snap, never a wrong number**: a unit change (`€930 млн.` →
`€1,2 млрд.`), two numeric runs (`2019–2023`), a precision change, or a lone `,`/`.` before
exactly three digits (`1,234` is 1234 in en and 1.234 in bg) — unless the hook passes the
locale's decimal separator, which it does from `i18n.language`. At t = 1 it returns the target
string verbatim.

### Verifying it in the in-app browser

⚠️ **The Claude desktop browser pane, when hidden, runs `requestAnimationFrame` at ~2 fps and
freezes CSS animation timelines at t = 0.** A 480 ms roll therefore completes inside one
frame and reads as a snap, and arrows sit at `scale(0)`. That is the pane, not the code —
`document.getAnimations().forEach(a => a.finish())` shows the end state. Measured 2026-10-12.

## §3 Tier 2

1. **Money that visibly flows** — ✅ shipped. `FlowParticles` (`src/ux/motion/`) puts beads
   on a Sankey link via SMIL `<animateMotion>`, count ∝ the link's share of the largest
   (`particleCount`, 1–4). **They flow only on the links of the node the reader is tracing**,
   not always: §0's rule over the original „paused on hover" wording, because every link
   flowing at once drowns the one path the reader asked about. Wired into
   `BudgetFlowGraphic` (spending beads run the path in reverse — both layouts are leaf → total
   in source → target terms) and `VoteFlowSankey`. Nothing under reduced motion. The flyover
   arcs needed nothing: `render.ts` already animates their dash offset.
2. **Shared-element route transitions** — ✅ shipped for hub tiles. Clicking an
   `InfographicTile` morphs its title into the destination `<h1>` over a root cross-fade
   (`src/ux/motion/titleTransition.ts` + the `::view-transition-*` rules in `index.css`).
   Two findings shaped it:
   - **`<Link viewTransition>` does nothing here** — the app runs the declarative
     `<BrowserRouter>`, and that prop needs a data router. The tile calls
     `document.startViewTransition` itself.
   - **`flushSync` cannot commit the navigation** — React Router v7 dispatches it inside
     `startTransition`, so the "new" snapshot was still the hub (measured: the only named
     element after the update was the tile). The update callback instead resolves when the
     clicked tile has left the DOM, capped at 1.5 s. That same wait covers lazy routes, because
     React keeps the old page mounted while the chunk loads.
   Names are unique per snapshot by construction: at click time the old page's `<h1>`s are
   opted out inline and only the tile is named; `:root[data-vt-title] h1` names the new page's
   heading. Modified clicks, browsers without the API, and reduced motion get the plain link.
   ⚠️ The Claude desktop browser pane, when hidden, aborts EVERY view transition with
   „aborted because of invalid state" (an empty `startViewTransition(() => {})` does too), so
   the morph itself must be checked in a visible browser; the navigation still completes.
3. **Map drill-down camera** — ✅ shipped for the election maps. Clicking (or Enter on) a
   region in a `MapElement` map flies the map into that region, then opens its page
   (`useMapDrillDown` + the pure `drillTransform` fit in `src/ux/motion/`). Measured on
   `/parliamentary`: Варна zooms 3.87× and the route lands on `/municipality/VAR` with no
   leftover animation on the new map.
   **Not built on the flyover camera, deliberately**: `src/lib/flyover/camera.ts` is a 3D
   pinhole projector over a pre-projected canvas world, while these maps are a Leaflet tile
   layer under an SVG overlay. The zoom is one composited Web Animation on their shared
   parent box, so tiles, regions, arrows and labels move as one picture; the magnification is
   capped at 4× because the tiles are raster. Navigation fires at 80% of the flight, and the
   zoom is cancelled on the next location change rather than on finish, because
   `startTransition` keeps the old page up until the new route commits. The hook runs ONCE
   PER MAP (`useMapElements`), never per region: settlement maps carry thousands of paths, and
   the zoom must outlive the clicked region when the next route reuses the map with fewer
   features. A call during a flight is ignored, so a double click or a held Enter cannot
   navigate twice.
4. **Chart object constancy** — ✅ shipped as a primitive plus its first two charts.
   `useChartMotion(key)` (`src/ux/motion/`) returns a per-series `motion(id)` to spread onto
   each series: animation stays off on mount and turns on IN THE SAME RENDER the
   reader-controlled `key` first changes, so the series morphs from its previous points. It is
   PER SERIES because mount is per series — a peer added after the year moved, or polygons
   arriving after a loading skeleton, appear still; a series not drawn in a commit is
   forgotten. Wired into the two WGI radars on `/indicators/compare` (`EuCompareWgiRadar`,
   `EuCompareWgiSmallMultiples`), which redraw when the cabinet anchor moves the snapshot year.
   What the recharts source settled, so nobody re-derives it:
   - **Turning animation on in a later render, without a data change, plays the MOUNT
     animation a frame late** — the series records its previous points only when
     `animationId` changes, so they are still unset. Hence „same render as the change".
   - **Bar, Line, Area and Radar morph correctly**: their `getDerivedStateFromProps` keeps the
     previous points regardless of `isAnimationActive`, and a data change bumps `animationId`.
   - **`<Pie>` does not**: it checks an `isAnimationActive` flip first and resets
     `prevSectors` to `[]`, so its first change sweeps the donut from nothing. `BudgetDonut`
     (which redraws per fiscal year) is therefore left static. A zero `animationDuration` is no
     workaround — react-smooth computes t = 0/0 on its first frame.
   The other files with `isAnimationActive={false}` were screened by a grep for reader state
   (`useState` / `useScope` / a year selector), not read one by one; the remaining candidates it
   surfaced (`GovernmentTimeline`, `NzokReportCardTile`, the pension tiles, …) are open work —
   opt each in only after confirming it redraws on a reader action and is not a `<Pie>`.
5. **Shape-aware skeletons** — ✅ shipped as `ChartGhost` (`src/ux/motion/`): a baseline and
   faint bars (or scatter dots) under a slow shimmer, in the same `rounded-xl border bg-card`
   shell and height class as the pulsing box it replaces, so nothing moves on arrival. Wired
   into the chart-shaped `Suspense` fallbacks: the three sector-pack slots in
   `SectorDashboardScreen` and the context scatter on `/education`.
   **The ghost does NOT grow into the real values**, against the original wording: the marks
   are invented, and morphing them into real bars would animate data arriving on first paint —
   the fade-from-placeholder §0 rules out, and the reason `FeatureMap` never fades in from its
   grey. The shimmer is the only motion (it means „loading") and stops under reduced motion.
   `ElectionSurfaceSkeleton` was left alone: it reserves exact per-level geometry measured
   against the producer, which a generic ghost would loosen.
6. **Hand-drawn mark for HTML** — ✅ shipped as `HandDrawnMark` (`src/ux/motion/`): a pen
   underline under inline content, drawn on once it scrolls into view, stroked in
   `currentColor` so it takes the figure's own colour and adds no new encoding. First and only
   use: the budget balance in `BudgetFlowTile`'s headline („€2 137 906 718 дефицит"), the one
   figure that line already sets apart in rose. ONE per block, and only on a figure the copy
   already singles out — sprinkled, the mark stops meaning anything.
   ⚠️ `IntersectionObserver` never fires in the hidden Claude desktop browser pane (it rides
   the rendering loop the pane suspends), so the mark stays at `opacity-0` there; check it in
   a visible browser.

## §4 Tier 3

Selected 2026-10-12 from what Tiers 1–2 left open, by reach × cost (the ranking and the items
deliberately skipped are in the session that chose them; the skipped ones are listed at the end).

1. **Settle the connection graph before revealing it** (the brainstorm's #8). `GraphCanvas`
   draws every tick of a force simulation (`alphaDecay 0.025`, ~270 ticks), so `/connections`
   jiggles for seconds on arrival. ✅ shipped: `preSettle` (`src/ux/motion/`) stops the
   sim's timer and ticks it in ≤8 ms `setTimeout` chunks (no long task; timers, unlike rAF,
   keep running in hidden tabs) until alpha ≤ 0.05 or a 1.5 s budget, then the canvas fades
   in and the faint remainder plays on screen. Reduced motion settles all the way and appears
   still. Measured on `/connections`: hidden → shown 764 ms after navigation, data load
   included. (`GraphCanvas` is the only force simulation in the app; the „person ego graph"
   in the original wording is not a separate one.)
2. **`/subsidies` KPIs roll between scopes** — `placeholderData: keepPreviousData` on
   `useAgriHubStats`, the only hub-stats hook keyed per scope, so the band stays mounted while
   the next scope loads (closes the §2 gap noted against the rolling KPI row). ✅ shipped as
   an OPT-IN `{ keepPrevious }` on the hook, used by a second observer (same query key, one
   fetch) that feeds ONLY the KPI band: during the load the payload is the old scope's, which
   is truthful only where every caption is built from the payload (`subsidiesWindow(hub, …)`),
   as the band's are — every other consumer keeps the plain hook. Never held
   over for a `null` scope (a year the corpus does not cover).
3. **`ChartGhost` rollout, batch 1** — add `rows` (ranked list) and `map` shapes, convert the
   first batch of chart/list/map-shaped `animate-pulse rounded-xl border bg-card` placeholders.
   ✅ shipped: `rows` (label stub + descending bar per row) and `map` (a soft landmass with a
   few points — deliberately not a real outline, so the ghost claims no geography; drawn
   `meet` so it does not stretch with the card), and the 16 sector-pack slots
   (`my-4 h-[280px]` in the 15 `*Pack.tsx` files and on `/company`) converted to `bars`.
   Of the ~80 pulse boxes, these stay pulsing on purpose: small KPI cards, the generic
   dashboard-card skeletons, header / text blocks, and whole-page `h-40` loaders — none is
   chart-shaped, and a ghost chart there would promise content the page does not have.
4. **`ChartGhost` rollout, batch 2.** ✅ shipped — 17 sites, each shape chosen from what the
   placeholder actually stands in for, not its name: `map` for the МВР directorate, transport
   facility / project, school and riverbed-cleaning maps; `dots` for the school context
   scatter; `rows` for the tourism source-market ranking and the tourism thematic card (the
   loading state of two ranked-list tiles); `bars` for the time-series tiles (tourism
   spend-vs-nights and seasonality, water stats, rail subsidy) and the page-body loaders of /water, /judiciary, /pensions, /defense and the culture
   subsidies page.
5. **`ChartGhost` rollout, batch 3** — the remainder that are chart-, list- or map-shaped;
   non-chart placeholders (search boxes, text blocks) keep their pulse.

Deliberately not in Tier 3: drill-down on the non-election choropleths, `useChartMotion` on
more charts (only two candidates surfaced), title morph on more link families (unverifiable in
the hidden pane), and more hand-drawn marks / sparks (they lose meaning when common).
