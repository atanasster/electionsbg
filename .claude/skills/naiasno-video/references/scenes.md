# Scenes — visual types, maps, and walkthroughs

Load when choosing a `visual.type`, animating a map, or scripting a walkthrough.

## The visual vocabulary mirrors `cardKit`

`visual.type` deliberately matches `scripts/posts/cardKit.ts`'s renderer selection,
so a card and a video of the same finding are the same design language and there is
one place to change the look.

| `visual.type` | Shape | Use when |
|---|---|---|
| `stat` | one big number + label | the fact IS one number with nothing to compare |
| `bars` | 3–6 `{label, value, note?}` | **the default** — any ranking, breakdown, EU peers, before/after |
| `series` | 2–4 lines over `labels` | the story is a TREND — *when* it changed matters |
| `rows` | table, ≤6×6 | the claim is a grid and a bar chart would discard an axis |
| `map` | choropleth / fill-in | the story is geographic distribution |
| `capture` | recorded page | "this is the real tool" — see walkthroughs below |

**Prefer `bars` over `stat`**, same rule as `naiasno-post`: when a figure naturally
decomposes (by year, party, region, or against a benchmark), pull out 3–6 components.
A single number with nothing beside it is a weaker scene than a comparison.

Colour, palette and theme come from `cardKit`'s `THEME` (navy `#0b1224` / coral
`#df6b43`). Port the tokens; do not invent a second palette.

**Signed vs magnitude:** as in `cardKit`, a change gets an explicit `+`/`−` so
direction survives greyscale; a share/count/amount sets `signed: false` so values do
not gain a misleading `+`.

## Lessons from the first rendered scenes (T1, 2026-08-08)

- **A bar's note belongs on its own line.** Name + note + value inline nearly
  collided on the first render ("БСП — Обединена левица" · "0 мандата" · "2,90 €"),
  and a longer party name would have overlapped outright. `BarsScene` now puts the
  note under the name, with ellipsis on the name as a backstop.
- **The wordmark needs a reserved band.** It is absolutely positioned, so tall
  content runs underneath it — six bars did, in the 4:5 cut. `Frame` pads the content
  area clear of it.
- **Compress spacing to fit, never type** (`fit` factor in `BarsScene`). The ~84/44px
  minimums are a legibility floor on a phone.
- **A decoration that does not render is worse than none.** A hairline rule at 0.55
  opacity in `rule` on `bg` was invisible in every extracted frame; it was a DOM node
  per frame that drew nothing.

## Designing the canvas for a MULTI-PART subject (E2)

E1's canvas is one line chart whose window and series opacity tween for the whole
run. That does not serve a subject built from ten components — five meters, a
collapse, seven columns, band boundaries and a context strip. What does:

**Three acts on ONE surface, and the canvas changes KIND exactly once.** Five
integrity meters fill one at a time → they COLLAPSE into a single column → that
column takes its place among seven comparable elections → the bands wash in behind
it. The collapse is the argument, not a transition: five measurements becoming the
one number the video opened on. Everything else accretes.

**Do not morph — crossfade and re-gate.** The five meters fade as `mode` goes 0→1
while the subject column grows in its FINAL position, then the other six arrive on a
separate field. A real five-bars-into-one-column morph is a lot of work for a beat
the narration already carries, and out-of-order frame rendering handles it worst.

**Scalars, not arrays, for per-item progress.** `m1`…`m5`, not `meters: number[]`.
The timeline merges each scene's PARTIAL onto the previous state, so a partial array
would replace rather than merge (a scene lighting meter 3 would have to restate 1
and 2); and the blend tweens numbers and SNAPS everything else, so an array would
pop instead of growing.

**Separate "the row exists" from "the row has a value"** (`rows` vs `m1`…`m5`). One
field cannot express an empty labelled track — a fill of 0.02 renders as a score of
1, which is a number the video never claims.

**Give each part something to change.** A focused-but-empty row held for five scenes
is a dead canvas. E2 added a per-meter scale-end annotation and a two-kind callout
panel so the section and concentration parts had their own visual content; without
them ~50 s of the video was a static frame with the rail doing all the work.

**A second canvas means a discriminant, not a second composition.** `canvasKind` on
the spec, the spec generic over its state (`ExplainerSpec<C>`, defaulting to
`unknown` so gate1/synthesize/emit_vtt can hold specs with different canvases in one
map), and the shared timeline machinery in `canvasTimeline.ts`. Duplicating the
Stage/Rail/Audio/Captions wiring per canvas is the wrong seam.

## Legibility minimums

A card is viewed at full size; a Reel is viewed on a phone at arm's length. Scaled
from a 1080 px-wide composition:

- Headline ≥ **84 px**, important supporting text ≥ **44 px**
- Key content ≥ **80 px** from the sides, ≥ **100 px** from top and bottom
- One idea per scene — decide what the viewer notices first and build the frame
  around that. Drop anything redundant.

`cardKit`'s sizes are tuned for the still and are **not** safe to reuse directly.

## Glyph safety

`cardKit` draws with `@napi-rs/canvas` and a missing glyph comes out as a **silent
tofu box** — nothing throws. Arrows (`→`, `⟶`) are not available; write «от X на Y»
or use an em dash. In video this failure multiplies across ~900 frames for a short,
so it is checked at gate 2 by extracting frames and Reading them.

## Maps — build them in SVG, not with a tile provider

**Built and working: `MapScene` + `scripts/video/build_map_t2.ts`.**

Use `d3-geo` directly — `cardKit` already imports `geoMercator` + `geoPath`, so
shapes become React `<path>` elements with an animated `fill`. No API key, no WebGL,
no headless-render shimmer, no 4096 px renderbuffer ceiling, deterministic frame to
frame. The basemap carries no information in this content — **the data is the map** —
so a tile layer is cost with no payload.

**Project once, offline, into `video/src/generated/`.** A build script reads
`data/maps/regions/*.json` (municipality polygons keyed by `nuts4`), projects with
`fitExtent` into a fixed viewBox, rounds coordinates to 0.1px and emits path strings
with their per-feature verdict. The scene then **imports** the JSON: no per-frame
projection, and no `delayRender` around a fetch. 288 polygons ≈ 122 KB.

**⚠️ Size the `<svg>` with CSS, never with width/height attributes.** In a flex
column the attributes lose to the flex algorithm — the first map render came out at
about a third of its intended size in an ocean of empty frame. The robust shape,
which also removes any hand-computed height estimate:

```tsx
<div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center" }}>
  <svg viewBox={MAP.viewBox} preserveAspectRatio="xMidYMid meet"
       style={{ width: "100%", height: "100%" }}>
```

**⚠️ Put a legend ABOVE the map, not below.** Burned-in captions occupy the bottom
band; a legend there collides with them. (Reading the key before the map is better
anyway.) The same applies to any bottom-anchored scene content.

### ⚠️ The per-item timing rule

**Never drive per-item animation from a slice of one global 0→1 reveal.** Drive each
item from **time since its own trigger**, with a **constant per-item duration**.

Why it matters concretely: 265 municipalities on a 30-second timeline. A global-reveal
slice gives each fill ~110 ms — the map reads as noise rather than as a sweep. Trigger
by arrival order, hold each fill a constant ~600 ms, and let the overall beat be as
long as the sequence needs.

```ts
const t = frame / fps;                       // seconds, always
const FILL_S = 0.6;                          // CONSTANT per item
const trigger = (i: number) => START + (i / n) * (END - START);
const p = clamp01((t - trigger(i)) / FILL_S); // time since trigger, not global progress
```

The same rule governs any staggered set: bars appearing, rows filling, dots landing.

## ⭐ Capture vs canvas — the rule

Both are built (`ScreenPlate` + `npm run video:screens`, and the drawn canvas).
Decided by building the same subject twice, 2026-08-08:

| | **Drawn canvas** | **Captured screen** |
|---|---|---|
| Claims about a **figure** | ✅ | ❌ |
| Claims about the **tool** | ❌ | ✅ |
| Can animate the data | ✅ window, markers, series | ❌ it is a still |
| Staleness | regenerates from committed data, **asserted** | real numbers baked into a PNG, nothing guards them |
| Breadth on screen | what you drew | the whole page — 10 indicators at once |

**Use ONE capture beat per explainer, on a "go and check it yourself" line — not
on a number.** At a legible zoom a wide table crops columns, so a capture beat
that cites a specific value risks saying something the frame does not show, which
is rule 6. E1's scene 10 is the worked example: the figures were all made on the
canvas first, and the plate only has to prove the page exists.

## Walkthroughs — showing the real product

Four approaches. **None of them needs GSAP** — the cursor is an `interpolate` along a
path, the zoom is a plate transform, the highlight is opacity and scale.

**A · Screen-recording app** (Screen Studio, Tella). Auto-zoom on click, smoothed
cursor, no build. Fastest to polished. Not reproducible; a UI change means
re-recording by hand. *Right for a one-off pillar video when speed beats repeatability.*

**B · Playwright capture → composited in Remotion** ⭐ **the pipeline answer.**
The repo already has **7** capture scripts (`scripts/capture-*.mjs`, Playwright, 2×
DPI, clip-by-heading), so this extends an existing capability.

The part that makes it better than a screen recorder rather than merely reproducible:
**have the Playwright script emit an action log** —
`{tMs, type: "click" | "scroll" | "hover", x, y, selector}` — and let the composition
consume that log as the **zoom and cursor choreography**. Screen Studio's auto-zoom,
except the automation script *is* the storyboard: diffable, re-runnable when the UI
moves, and reviewable before anything renders.

The zoom is the **fixed-plate** pattern (`references/remotion.md`): capture oversized
(≤4096 px), then translate/scale the plate. Never re-render the page per frame.

**C · Mount the site's real React components in Remotion.** The site is React 19;
Remotion is React. Import the component, drive its props across frames. Pixel-perfect,
**vector text** (crisp Cyrillic at any scale, no canvas-font tofu risk), deterministic
by construction, no browser automation.

Cost is the context stack, with fixtures instead of network: React Query (prefilled
cache), Router, i18n, `ElectionContext`, `cabinetAnchorContext`, `useScope`. Bounded
and known, but real. *Right for component-level beats, not whole journeys.*

**D · iframe the live site.** Cross-origin, `delayRender` and determinism problems.
Not recommended.

**Use C for component beats, B for journeys, A as an escape hatch.**

## ⚠️ Walkthroughs go stale in a way card videos do not

A walkthrough records **real pages showing real numbers**, and those numbers move: a
`db:refresh`, a contracts reload, a new ИСУН ingest, and the recorded page disagrees
with the live site. The video keeps asserting the old figure at a 200 with nothing
failing — the same silent-staleness shape CLAUDE.md documents for a dozen loaders.

So:

- Walkthroughs should be about **the mechanics of the tool** ("how to trace a contract
  to its buyer") — evergreen — not about a specific contract's value.
- Where a figure must appear on screen, put it in the scene's `grounding` block so a
  corpus reload can flag the video for re-recording.
- Anything whose *point* is a number belongs in a card-based format instead.
