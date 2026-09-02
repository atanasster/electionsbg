# /data map — a layout per view, v1

`docs/plans/data-map-layout-v1.md` §4 proposed reshaping the graph with ELK's
`elk.layered.wrapping.strategy` to get a landscape aspect. **That was a
prediction and it is wrong.** This plan records the refutation, because the idea
is an inviting one and the next person will otherwise re-derive it, and then
builds the thing the same measurements say does work.

## 1. Why the wrapping idea fails

Measured 2026-09-02 against the committed `data/data_map.json` (108 nodes,
182 edges), re-running ELK with the generator's own options. Figures in this
section are **raw node bounds** — the spike measured ELK's output directly,
without the tier frames and margin the screen adds — so they read ~44 px
narrower and ~90 px shorter than §2's. They are internally consistent, which
is all the comparison here needs; §2 quotes the committed scale.

**ELK's wrapping is a no-op on this graph.** It cuts a layered graph along the
**layer** axis, and this graph has **three layers** — source → dataset →
feature. There is nothing to cut. `MULTI_EDGE` and `SINGLE_EDGE` at aspect
ratios 1.0 / 1.4 / 1.6 / 2.0, with and without `elk.partitioning.activate`,
all returned the identical **986 × 3584**. What is long here is the *within*-layer
direction: 46 sources stacked in one column, which wrapping does not address.

**A landscape graph would be drawn smaller, not bigger.** The shell clamps
content to 1384 px (`Layout.tsx`'s `container p-2` + `theme.container.screens`),
so the canvas caps at 1203 px. Folding each tier's column into sub-columns —
the only way to reach a landscape aspect — costs zoom monotonically:

| layout | extent | ratio | drawn at |
| ------ | ------ | ----- | -------- |
| today (3 columns) | 986 × 3584 | 0.28 | **1.15×** |
| 2 sub-columns each | 1866 × 1794 | 1.04 | 0.63× |
| 3 sub-columns each | 2634 × 1248 | 2.11 | 0.44× |
| 4 sub-columns each | 3402 × 936 | 3.63 | 0.34× |

Vertical space is free — the page scrolls. Horizontal space is capped and
scarce. **Portrait is width-optimal here**, and going landscape spends the
scarce axis to save the free one.

**And it would not have helped the case it was proposed for.** At 375 px, 108
nodes 240 px wide are unreadable at any aspect: 0.334× today, 0.19× after a
2-column fold. The node COUNT is the constraint, not the shape.

## 2. What the same measurement shows does work

The `?view=` filter has existed since the map shipped and only ever **dimmed**:
the graph stays 108 nodes at full size whatever is selected. Laying out only a
view's members, with the generator's own options:

Extents below are the **committed** ones, as the screen consumes them —
`dataMapExtent`, tier frames and margin included. (The exploratory spike that
produced this table measured node bounds only and read ~44 px narrower and
~90 px shorter; `scripts/data_map/layouts.test.ts` is the authority.) `page`
is the whole document at 1440 px, measured live.

| view | nodes | extent | drawn at | page | vs `all` |
| ---- | ----- | ------ | -------- | ---- | -------- |
| prices | 9 | 1012 × 422 | **1.13×** | 1,264 px | −75 % |
| parliament | 14 | 1012 × 579 | **1.13×** | 1,444 px | −71 % |
| elections | 20 | 1012 × 724 | **1.13×** | 1,611 px | −68 % |
| local | 25 | 1442 × 968 | 0.94× | 1,708 px | −66 % |
| indicators | 34 | 1012 × 1266 | **1.13×** | 2,235 px | −55 % |
| fiscal | 64 | 1012 × 2202 | **1.13×** | 3,311 px | −34 % |
| `all` | 108 | 1046 × 3684 | 1.13× | 5,015 px | — |

That is §4's actual goal — no four-metre scroll, full zoom — reached by the
lever that exists. `local` is the one view that goes wide enough to lose zoom,
and it is recorded rather than tuned away.

## 3. Design

**The manifest carries one baked layout per view.** ELK is a ~1.4 MB engine that
deliberately never ships to the client, so the positions are computed offline
like every other layout in this file. Positions are cheap: the extra payload is
one `{id, x, y}` per (view, member) pair — **274 in total** (166 across the six
tagged views, plus 108 for `all`), **29 KB of a 257 KB manifest** that gzips to
58 KB, against a file whose bulk is labels and descriptions.

- `manifest.layouts[viewId] = { nodes: [{id, x, y}], tiers }` for **every** view,
  `all` included, so the resolver has no special case.
- `manifest.nodes[].x/y` and `manifest.tiers` stay as they are — they are the
  `all` layout, and an older cached manifest with no `layouts` must keep
  working.

**`dataMapView(manifest, viewId)` is the one resolver**, in `useDataMap.ts`. It
returns the nodes (subset, positions overridden), tiers, edges and links for the
active view, plus `dimNonMembers` — false when a baked layout was found, true on
the fallback path, which is the pre-existing dim-everything-else behaviour.

**`?view=` is validated against the manifest's own view list, and the layout
lookup is own-property-only.** The value comes straight off the query string and
the manifest comes from `JSON.parse`, so `layouts["constructor"]`,
`["__proto__"]`, `["toString"]`, `["valueOf"]` and `["hasOwnProperty"]` are all
truthy — the `!layout` fallback would be skipped and `layout.nodes.map` would
throw, inside a render-time `useMemo`, with no ErrorBoundary anywhere in `src/`.
`/data?view=constructor` would be a blank page rather than a degraded one, on a
shareable and crawlable URL. `?lens=` twenty lines away was already validated
this way, and CLAUDE.md's URL-contract section states the rule.

An id the manifest does not know falls back to the whole graph and does **not**
dim — it is not a narrower view, it is no view at all — and so does a view whose
layout is present but empty, which would otherwise give a 1 px canvas.

**A selection outside the active view resets the view to `all`.** A neighbour
chip, a deep link or a tour step can name a node the current view does not
contain; without this the panel would describe a node the map does not draw.

## 4. Tiers with no members

`buildTiers` takes `Math.min(...members)` per kind, which is `Infinity` for an
empty set. A view need not contain all three kinds, so a tier with no members is
omitted rather than emitted with garbage bounds.

## 5. What the edge filter costs, and why the alternative is worse

A view's membership is a curated `tags` array per node and **does not follow
lineage**, so filtering edges to the members can leave a card with every arrow
in one direction gone. Measured on the committed manifest:

| view | drawn | islands (no edge at all) | loses all upstream |
| ---- | ----- | ------------------------ | ------------------ |
| elections | 20 | `src:ofac`, `src:comdos`, `src:regulators` | `ds:demographics` |
| local | 25 | the same three | — |
| prices | 9 | `src:eurostat` | — |
| parliament / fiscal / indicators | 14 / 64 / 34 | none | none |

On a page whose whole subject is provenance, a card with no arrows is not a
neutral omission — it reads as an answer. And the generator already treats this
state as a **build failure** at corpus level (`build_manifest.ts`: "node(s) with
no edges"), so the per-view layouts were silently abandoning an invariant the
`all` graph declares.

**Closing each view over one lineage hop was the obvious fix and is measurably
worse.** It would make every view a connected subgraph by construction, but the
real cost is not the "+2 / +3" a spot check suggests — the full 1-hop closure is:

| view | tagged | closed | |
| ---- | ------ | ------ | - |
| elections | 20 | **48** | +28 |
| prices | 9 | **34** | +25 |
| parliament | 14 | **44** | +30 |
| local | 25 | **59** | +34 |

That gives back most of the collapse the layouts exist for — `prices` would go
from 422 px to roughly 1,100 — so it is rejected.

**What shipped instead: the card says how many connections the view is not
showing** (`dataMapView` returns `hidden` per node; `DataMapNodeCard` renders a
`+n` badge with a title). A view is a window, and the honest fix is to say so on
the cards where something is behind the frame rather than to widen the window
until nothing is. The panel keeps the FULL manifest, so selecting such a card
still lists its true neighbours — and clicking one trips the widen-to-`all`
effect above.

## 6. Known duplication

`scripts/data_map/build_manifest.ts` and `src/data/dataMap/useDataMap.ts` each
declare the manifest's shape, kept in step by hand. The generator's interfaces
carry fields the client does not need, so they are not the same type — but
`ManifestLayout` / `DataMapLayout` are, and a third pair would be worth
extracting a shared module for.
