# /data map — layout and framing, v1

The `/data` map screen pairs two things that both want to be tall and narrow: a
**portrait** graph and a fixed 360 px detail rail. The rail is charged at every
width while it only earns its space on a selection, and below ~1478 px it is the
reason the map cannot be drawn at 1:1.

Everything below was measured on 2026-09-01 in Chromium against the dev server,
at 375 / 768 / 1024 / 1280 / 1440 px, on `data/data_map.json` as committed that
day (108 nodes, 182 edges, 18 lateral links, 4 tours, 7 views).

## 1. The measurements

`scripts/data_map/build_manifest.ts` runs ELK layered with
`elk.partitioning.activate`, which pins the three kinds into three 296 px
columns. With 46 sources in the tallest of them the graph comes out
**1046 × 3684 CSS px — aspect 0.28**.

| viewport | canvas width | 1046 px needed for 1:1 | panel   | document height |
| -------- | ------------ | ---------------------- | ------- | --------------- |
| 1440     | **1008**     | ✗ (−38)                | 360     | 4180            |
| 1280     | **873**      | ✗ (−173)               | 360     | 3704            |
| 1024     | **617**      | ✗ (−429)               | 360     | 2822            |
| 768      | 737 stacked  | ✗                      | full    | 3639            |
| 375      | 359 stacked  | ✗                      | full    | 2576            |

Two things follow:

- **The docked split needs ≈1478 px of viewport** — 1046 graph + 360 rail +
  16 gap + 56 page padding. It currently switches on at `lg` (1024), so the
  whole 1024–1478 band is the rail squeezing the map below 1:1.
- **The `lg` breakpoint inverts the sizing.** A 768 px tablet gets a **737 px**
  map; a 1024 px tablet gets **617 px**. Moving to a bigger screen makes the map
  smaller.

The rail's contents are also mostly not detail. Its empty state carries a hint
paragraph, the 46/36/26 counters, a freshness note and the four stories — all
page-level metadata, held in a contextual sidebar, sticky at `top-20` beside a
3550 px canvas. For ~85 % of the scroll it is a repeated onboarding card.

## 2. The framing bug found while measuring

React Flow's `fitView` **never applies**. The console logs error #004 ("the
parent container needs a width and a height") at mount and the viewport stays at
`translate(0px, 0px) scale(1)` at every width tested, on a fresh load. So the
graph renders at 1:1 anchored top-left:

- at **375 px** the box is 359 × 1264 while `tier:feature` sits at x = 734,
  w = 296 — the dataset and feature tiers are **entirely off-canvas** and two
  thirds of the sources column is clipped. A phone sees ~12 % of the map.
- at **1440 px** it clips the feature column by ~38 px, which is small enough
  that the failure survived unnoticed on a laptop.

The zoom +/− buttons work and centre correctly on the real pane dimensions, and
the fit button does nothing — so the store's width/height are sound and the node
**bounds** are what fitView cannot resolve. A window resize recovers it.

## 3. Tiers

### T1 — deterministic framing (prerequisite) — done 2026-09-01

The manifest already carries every node's box, so the bounds never needed
measuring from the DOM. `src/data/dataMap/viewport.ts` derives them and the
canvas hands React Flow an explicit `setViewport`, mirroring
`getViewportForBounds` for the numeric-padding shape this canvas uses so the
framing the old `fitViewOptions` asked for is reproduced rather than quietly
redefined — pinned by a parity test against the installed upstream, because
v12 already rewrote those semantics once. The screen's aspect-ratio box reads
its extent from the same module, so the box and the framing read one set of
bounds.

The fit control is **ours**: `<Controls onFitView>` is additive, not a
replacement — Controls runs `fitView(fitViewOptions)` first and calls the
handler after — and upstream's `fitView` starts working once the nodes have
painted, so wiring it there framed twice per click (an instant snap to padding
0.1 / maxZoom 2, then a 300 ms animation to 0.03 / 1.15: a 6.8 % zoom pop and a
109 px jump at a 1008 px pane). `showFitView={false}` plus a `ControlButton`.

Measured after the fix, at 375 px: `scale(0.334)` with the feature tier's right
edge at 352 px inside the 359 px box — the whole graph on screen, where before
it ended at 1031 px.

A layout change cannot be verified while the map never fits, which is why this
lands first.

### T2 — A: price the rail correctly

Move the docked split from `lg` (1024) to `2xl` (1536) — the measured threshold
is ≈1478 — and cap the canvas at the width the graph can actually use. Below
`2xl` the map is full-width and the panel stacks under it, which also removes
the 768 → 1024 inversion.

### T3 — B: demote the rail to selection-only

Move the page-level content out of the panel and into the head: the 46/36/26
counts as a compact strip, the four stories as a chip row beside the lens pills
(they are a *mode*, the same family as the view and lens pills), the hint as one
line. The panel then renders only when a node is selected.

Mobile constraint: the head already costs **527 px** before the map starts at
375 px, so the strip is one inline line and the stories are a single
horizontally-scrollable row — the head must not grow.

### T4 — C: overlay the detail below `2xl`

With T3 done the rail is empty when nothing is selected, so a *docked* rail that
appears and disappears would shift the layout by 376 px on every click. Instead:

- **≥ 2xl** — the column stays reserved (the screen has the width to spare), so
  no shift.
- **lg … 2xl** — the detail is a sticky card overlaying the canvas's top-right,
  rendered only on selection. The map keeps the full width; the idle cost is
  zero.
- **< lg** — unchanged: an inline card below the canvas, scrolled into view.

## 4. Not in this plan

**Fix the shape, not the layout.** The deepest lever is
`elk.partitioning.activate` in `scripts/data_map/build_manifest.ts`, which is
what turns 46 sources into one 3668 px column. ELK's own answer to a long
layered graph is `elk.layered.wrapping.strategy: MULTI_EDGE` with
`elk.aspectRatio`, folding it into stacked bands — roughly 1400 × 1900 instead
of 1046 × 3684. That would make a viewport-height explorer pane viable, kill the
4 m scroll, and make the mobile view a legible whole rather than a 0.34 zoom.
It is a generator change with its own gates and belongs in its own plan.
