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

- **The `lg` breakpoint inverts the sizing.** A 768 px tablet gets a **737 px**
  map; a 1024 px tablet gets **617 px**. Moving to a bigger screen makes the map
  smaller.
- **A docked rail cannot be afforded at ANY breakpoint** — corrected 2026-09-01,
  see §3 T2. `Layout.tsx` wraps every screen in `container p-2`, and
  `theme.container.screens` clamps `.container` to `max-width: 1400px` from
  1400 px up (`p-2`'s 8 px a side beats the container's `2rem`, because
  utilities follow components in `index.css`). So

  ```
  content = min(viewport, 1400) − 16      # frozen at 1384 px however wide the screen
  ```

  and a docked canvas is `1384 − 360 − 16 = 1008 px` at every width — 38 px
  short of the 1046 px this graph needs for 1:1, and unreachable, since
  `content ≥ 1422` would require a viewport of 1438 against a 1400 clamp.

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

### T2 — A: price the rail correctly — done 2026-09-01

**The rail is gone from the flow at every width, not moved to a wider one.**
The first cut docked it at `2xl` on a stated threshold of ≈1478 px; the review
of that cut showed the threshold does not exist (§1), and that docking at 1536
would have introduced a *new* 16 % step DOWN — 1203 px stacked at 1280–1535,
1008 px docked above it — which is the same inversion this tier set out to
remove, relocated rather than fixed.

So the map takes the full content width at every size and the panel stacks
under it, and the box is capped at `extent.w × DATA_MAP_FIT_MAX_ZOOM`, because
past the fit ceiling a wider box only adds empty space. Both bounds read the
ceiling the canvas actually frames with — the framing constants moved into
`viewport.ts` so the cap and the ceiling are one definition.

Measured on fresh loads, canvas width and fit zoom:

| viewport | before | after |
| -------- | ------ | ----- |
| 1024 | 617 px · 0.575 | **993 px · 0.925** |
| 1280 | 873 px · never fit | **1203 px · 1.121** |
| 1600 | 1008 px · 0.939 | **1203 px · 1.121** |

The curve is monotonic now: it rises to the cap and stays there. What the dock
was FOR — a selection answering beside the map rather than below it — is T4's
overlay, which needs no width at all.

### T3 — B: demote the rail to selection-only — done 2026-09-02

The page-level content moved out of the panel and into the head: the 46/36/26
counts as one inline line, the four stories as a chip row beside the lens pills
(they are a *mode*, the same family as the view and lens pills), the hint as one
sentence. The panel renders only when a node is selected, and its wrapper is
`empty:hidden` so a null panel does not spend the row's 16 px gap either.

Measured at 375 px: the panel is **0 px** when idle and 431 px on a selection;
page height **2576 → 2114**.

⚠️ **The head grew, against the constraint this tier set itself.** It costs
**527 → 677 px** before the map starts at 375 px. The constraint said it must
not grow at all, and that was not achievable while also moving four blocks into
it; what the first cut got wrong was *how much*, at 745 px, and the trims that
brought it down are the ones the plan had already prescribed and the code had
not followed — the hint on one line rather than a `max-w-2xl` paragraph, the
stories beside the lens pills rather than as a fifth head item.

The trade is recorded rather than excused: +150 px of head buys −462 px of page,
and the content it holds was previously below a 1264 px map, which on a phone is
not "lower down" but unreachable. Nothing above it moves, so there is no layout
shift. If the head has to shrink further, the honest target is the four pill
rows that were already there (DataNav wraps to 3 rows at 375 px and the view
pills to 3), not the content this tier rescued.

### T4 — C: overlay the detail — done 2026-09-02

T2 removed the dock and T3 left the panel with nothing to say when nothing is
selected, so the detail is an overlay rather than a column:

- **≥ lg** — a sticky card over the canvas, rendered only on selection. The
  column is absolute and spans the canvas's whole height (4,237 px at the cap,
  from a 3,684 px graph) so the card can stick down it; `pointer-events` are off on the column and back on for the
  card, so the empty space above and below it still pans the map.
- **< lg** — unchanged: an inline card below the canvas, scrolled into view.

**It hangs off an edge that does not reach the selected node.** Features are
the right-hand column so their card goes left; sources are the left-hand column
so theirs goes right. Datasets are the *middle* column, which neither edge
reaches at any `lg`+ width — so a dataset selection leaves the card where it is.

That last clause is hysteresis and it is load-bearing: recomputing the side from
every selection flipped it on **216 of 364 neighbour-chip traversals (59 %)** and
mid-tour in **3 of the 4 guided stories** — a ~1,000 px sideways jump, with no
transition, on the majority of clicks.

**The zoom / fit controls take whichever bottom corner the card is not using.**
They are the only two things that float over this canvas and both defaulted to
bottom-right; a sticky card unpins at the bottom of its column and pins its own
bottom edge 15 px from where the controls sit, so the overlap was permanent at
the bottom of a 4,237 px map — over the bespoke fit button T1 built — on the 82
of 108 nodes that put the card on the right. One value decides both sides.

The wrapper is capped to the canvas's own width, so both edges anchor to the
**map** rather than to the 1384 px content box; without it a right-hand card
hung 181 px off the map at ≥1400 while a left-hand one sat flush. It also
carries `isolate`, because the card's `z-10` would otherwise share the root
stacking context with the fixed header's.

At `lg`+ a selection produces no viewport movement at all, so the column is a
`role="region"` with `aria-live="polite"` and Escape closes it.

The scroll-nudge is suppressed exactly where the card overlays, through
`useMediaQueryMatch("lg")` rather than a width comparison — `window.innerWidth`
counts the scrollbar and disagrees with the CSS breakpoint by ~15 px.

Measured 2026-09-02:

| viewport | column | card | where |
| -------- | ------ | ---- | ----- |
| 1440 | absolute | 360 px, sticky | flush to the canvas's right edge |
| 1024 | absolute | 320 px, sticky | flush to the canvas edge |
| 768 | static | 737 px | stacked below the map |

Nothing is spent when no node is selected, at any width.

The first draft of this tier reserved a column at `2xl` "because the screen has
the width to spare". It does not: the container clamp freezes content at
1384 px however wide the screen, so there is no width above which a reserved
column is free — which is what makes the overlay necessary rather than merely
tidy.

## 4. Not in this plan — and one prediction that was refuted

**Fix the shape, not the layout.** The deepest lever *looked* like
`elk.partitioning.activate` in `scripts/data_map/build_manifest.ts`, which is
what turns 46 sources into one 3,668 px column, with ELK's
`elk.layered.wrapping.strategy: MULTI_EDGE` as the fix.

⚠️ **That was a prediction and it is wrong — measured 2026-09-02. Do not
re-derive it.** Wrapping cuts a layered graph along the LAYER axis and this
graph has three layers, so nine configurations returned an identical layout;
and any landscape reflow is drawn SMALLER, because the shell caps the canvas at
1,203 px while a landscape fold needs 1,866 px or more (0.63× against today's
1.15×). It would not have helped mobile either.

What the same measurements showed does work — a baked ELK layout per `?view=`,
so the filter reflows instead of dimming — shipped as
**`docs/plans/data-map-view-layouts-v1.md`**. That plan carries the full
refutation, the per-view figures and the cost of the edge filter.
