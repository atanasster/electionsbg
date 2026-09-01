import { describe, expect, it } from "vitest";
import {
  DATA_MAP_MARGIN,
  dataMapBounds,
  dataMapExtent,
  dataMapGraphBounds,
  viewportForBounds,
  type DataMapBounds,
} from "./viewport";
import { getViewportForBounds } from "@xyflow/react";
import type { DataMapManifest, DataMapNode } from "./useDataMap";

// The real manifest's geometry, measured 2026-09-01 from data/data_map.json:
// three ELK partitions, 1046 x 3684 with the margin — a PORTRAIT graph at
// aspect 0.28. Every framing regression this module exists to prevent is a
// consequence of that shape, so the fixture reproduces it rather than using
// round numbers.
const TIERS: DataMapManifest["tiers"] = [
  {
    kind: "source",
    label: { bg: "Източници", en: "Sources" },
    x: 0,
    y: 0,
    w: 296,
    h: 3668,
  },
  {
    kind: "dataset",
    label: { bg: "Данни", en: "Datasets" },
    x: 350,
    y: 278,
    w: 296,
    h: 3088,
  },
  {
    kind: "feature",
    label: { bg: "Функции", en: "Features" },
    x: 734,
    y: 263,
    w: 296,
    h: 3114,
  },
];

// No `as` cast: the annotation alone is what makes a future required field on
// DataMapNode fail this fixture loudly instead of letting it compile as a node
// it no longer represents.
const node = (id: string, x: number, y: number): DataMapNode => ({
  id,
  kind: "dataset",
  label: { bg: id, en: id },
  detail: { bg: "", en: "" },
  desc: { bg: "", en: "" },
  tags: [],
  x,
  y,
  w: 240,
  h: 62,
});

const manifest = {
  tiers: TIERS,
  nodes: [node("a", 28, 40), node("b", 762, 3000)],
} satisfies Pick<DataMapManifest, "tiers" | "nodes">;

const FIT = { padding: 0.03, minZoom: 0.12, maxZoom: 1.15 };
const FOCUS = { padding: 0.15, minZoom: 0.12, maxZoom: 1 };

describe("dataMapBounds", () => {
  it("returns null for an empty set", () => {
    expect(dataMapBounds([])).toBeNull();
  });

  it("unions boxes rather than taking the first", () => {
    expect(
      dataMapBounds([
        { x: 10, y: 20, w: 100, h: 50 },
        { x: 200, y: 5, w: 40, h: 400 },
      ]),
    ).toEqual({ x: 10, y: 5, width: 230, height: 400 });
  });

  it("handles a single box", () => {
    expect(dataMapBounds([{ x: 4, y: 8, w: 16, h: 32 }])).toEqual({
      x: 4,
      y: 8,
      width: 16,
      height: 32,
    });
  });
});

describe("dataMapGraphBounds", () => {
  it("spans the full portrait graph", () => {
    expect(dataMapGraphBounds(manifest)).toEqual({
      x: 0,
      y: 0,
      width: 1030,
      height: 3668,
    });
  });

  // The tier frames enclose their nodes today. Taking the union rather than
  // trusting that is what keeps a node placed outside its frame — an ELK
  // change, a hand-edited manifest — inside the framing instead of clipped.
  it("includes a node that escapes its tier frame", () => {
    const escaped = {
      ...manifest,
      nodes: [...manifest.nodes, node("x", 1200, 0)],
    };
    expect(dataMapGraphBounds(escaped)?.width).toBe(1440);
  });
});

describe("dataMapExtent", () => {
  it("adds the margin to the graph's far edge", () => {
    expect(dataMapExtent(manifest)).toEqual({
      w: 1030 + DATA_MAP_MARGIN,
      h: 3668 + DATA_MAP_MARGIN,
    });
  });

  // The box is the flow pane's coordinate space, which starts at 0 — so
  // leading whitespace counts. This is the ONE way the box and the framing can
  // size different rectangles, so it is a pinned contract rather than a
  // property of today's manifest (whose origin is 0, 0).
  it("anchors the extent at the origin, not at the graph's own left edge", () => {
    expect(dataMapExtent({ tiers: [], nodes: [node("a", 500, 300)] })).toEqual({
      w: 500 + 240 + DATA_MAP_MARGIN,
      h: 300 + 62 + DATA_MAP_MARGIN,
    });
  });

  it("degrades to a 1:1 box for an empty manifest", () => {
    expect(dataMapExtent({ tiers: [], nodes: [] })).toEqual({ w: 1, h: 1 });
  });
});

describe("viewportForBounds", () => {
  const bounds = dataMapGraphBounds(manifest)!;

  // The state React Flow error #004 reports: the pane has not been measured.
  // Returning null keeps the current viewport instead of centring the graph
  // on a zero-sized pane.
  it("returns null for an unmeasured pane", () => {
    expect(viewportForBounds(bounds, 0, 0, FIT)).toBeNull();
    expect(viewportForBounds(bounds, 359, 0, FIT)).toBeNull();
  });

  it("returns null for degenerate bounds", () => {
    expect(
      viewportForBounds({ x: 0, y: 0, width: 0, height: 0 }, 359, 1264, FIT),
    ).toBeNull();
  });

  // THE regression. At 375px the canvas box measures 359 x 1264 and the
  // unfixed map rendered at zoom 1 anchored top-left, which puts the feature
  // tier (x 734..1030) entirely off-canvas. Asserting the transformed right
  // and bottom edges land inside the pane fails for that transform and
  // passes only for a real fit.
  it("keeps the whole graph inside a phone-width pane", () => {
    const vp = viewportForBounds(bounds, 359, 1264, FIT)!;
    expect(vp.zoom).toBeLessThan(0.4);
    expect(vp.x + (bounds.x + bounds.width) * vp.zoom).toBeLessThanOrEqual(359);
    expect(vp.y + (bounds.y + bounds.height) * vp.zoom).toBeLessThanOrEqual(
      1264,
    );
    expect(vp.x + bounds.x * vp.zoom).toBeGreaterThanOrEqual(0);
    expect(vp.y + bounds.y * vp.zoom).toBeGreaterThanOrEqual(0);
  });

  it("still fits the graph on a laptop-width pane", () => {
    // 1440px viewport gave the canvas 1008px before the layout work — narrower
    // than the 1030px graph, so 1:1 clipped the feature column.
    const vp = viewportForBounds(bounds, 1008, 3550, FIT)!;
    expect(vp.zoom).toBeLessThan(1);
    expect(vp.x + (bounds.x + bounds.width) * vp.zoom).toBeLessThanOrEqual(
      1008,
    );
  });

  it("clamps to maxZoom rather than magnifying on a huge pane", () => {
    const vp = viewportForBounds(bounds, 4000, 20000, FIT)!;
    expect(vp.zoom).toBe(FIT.maxZoom);
  });

  it("clamps to minZoom rather than vanishing in a tiny pane", () => {
    const vp = viewportForBounds(bounds, 40, 40, FIT)!;
    expect(vp.zoom).toBe(FIT.minZoom);
  });

  it("centres the bounds in the pane", () => {
    const vp = viewportForBounds(
      { x: 0, y: 0, width: 100, height: 100 },
      400,
      400,
      { padding: 0, minZoom: 0.1, maxZoom: 4 },
    )!;
    expect(vp.zoom).toBe(4);
    expect(vp.x).toBe(0);
    expect(vp.y).toBe(0);
  });

  // A selection's closure is framed with the same function — the padding and
  // ceiling differ, the maths does not.
  it("frames a subset without moving the subset off-pane", () => {
    const sub = dataMapBounds([{ x: 734, y: 3000, w: 296, h: 200 }])!;
    const vp = viewportForBounds(sub, 359, 1264, {
      padding: 0.15,
      minZoom: 0.12,
      maxZoom: 1,
    })!;
    expect(vp.x + sub.x * vp.zoom).toBeGreaterThanOrEqual(0);
    expect(vp.x + (sub.x + sub.width) * vp.zoom).toBeLessThanOrEqual(359);
  });
});

describe("viewportForBounds tracks React Flow's getViewportForBounds", () => {
  // The module's whole justification is that it REPRODUCES React Flow's
  // framing rather than redefining it, and that claim is load-bearing: v11's
  // `width / (bounds.width * (1 + padding))` became v12's
  // `(width - p.x) / bounds.width`, and the two agree only because
  // `parsePadding` back-compats a NUMERIC padding. A release retiring that
  // back-compat would silently reframe the map — the same class of invisible
  // library mechanic lateralHandles.test.ts exists to pin.
  const GRAPH = dataMapGraphBounds(manifest)!;
  const SUB = dataMapBounds([{ x: 734, y: 3000, w: 296, h: 200 }])!;

  const CASES: [string, DataMapBounds, number, number, typeof FIT][] = [
    ["phone fit", GRAPH, 359, 1264, FIT],
    ["laptop fit", GRAPH, 1008, 3550, FIT],
    ["maxZoom clamp", GRAPH, 4000, 20000, FIT],
    ["minZoom clamp", GRAPH, 40, 40, FIT],
    ["focus subset", SUB, 359, 1264, FOCUS],
  ];

  it.each(CASES)("%s", (_name, bounds, width, height, opts) => {
    const mine = viewportForBounds(bounds, width, height, opts)!;
    const upstream = getViewportForBounds(
      bounds,
      width,
      height,
      opts.minZoom,
      opts.maxZoom,
      opts.padding,
    );
    // 1px / 1e-3 covers upstream's Math.floor on the resolved pixel padding
    // (measured max divergence 2026-09-01: 0.7px in y, 0.0004 in zoom).
    expect(mine.zoom).toBeCloseTo(upstream.zoom, 3);
    expect(Math.abs(mine.x - upstream.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(mine.y - upstream.y)).toBeLessThanOrEqual(1);
  });
});
