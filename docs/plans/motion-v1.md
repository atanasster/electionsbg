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
2. **Shared-element route transitions** — `<Link viewTransition>` from a hub tile to its
   detail header; needs measuring against lazy routes + Suspense before rolling out.
3. **Map drill-down camera** — reuse the flyover's blendable `FlyoverState`
   (`src/lib/flyover/state.ts`) for country → oblast → município instead of a hard route jump.
4. **Chart object constancy** — recharts is `isAnimationActive={false}` in 58 places; enable
   a keyed morph only on a state change (never on mount), chart by chart.
5. **Shape-aware skeletons** — a chart's ghost (axis + baseline) whose bars grow into the
   real values, replacing generic `animate-pulse` blocks; keep reserved heights for the
   `data-kpi-cell` height gates.
6. **Hand-drawn mark for HTML** — the same loop / underline around one key figure in a tile.
