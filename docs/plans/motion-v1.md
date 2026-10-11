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
4. **Chart object constancy** — recharts is `isAnimationActive={false}` in 58 places; enable
   a keyed morph only on a state change (never on mount), chart by chart.
5. **Shape-aware skeletons** — a chart's ghost (axis + baseline) whose bars grow into the
   real values, replacing generic `animate-pulse` blocks; keep reserved heights for the
   `data-kpi-cell` height gates.
6. **Hand-drawn mark for HTML** — the same loop / underline around one key figure in a tile.
