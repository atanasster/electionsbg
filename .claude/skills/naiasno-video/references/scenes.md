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

For a Bulgarian administrative map (municipalities, oblasts, settlements), use
`d3-geo` directly: `cardKit` already imports `geoMercator` + `geoPath`, so shapes
become React `<path>` elements with an animated `fill`.

No API key, no WebGL, no headless-render shimmer, no 4096 px renderbuffer ceiling,
and deterministic frame to frame. The basemap carries no information in this
content — **the data is the map** — so a tile layer is cost with no payload.

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
